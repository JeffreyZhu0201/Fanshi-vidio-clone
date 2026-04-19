import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import env from '../config/env.js';
import logger from '../utils/logger.js';
import {
  createOutputRelativePath,
  ensureParentDirectory,
  resolveUploadPath,
  toPublicUploadUrl
} from './fileService.js';

const imageApiKey = env.GEMINI_IMAGE_API_KEY || env.GEMINI_API_KEY || '';
const imageApiBaseUrl = env.GEMINI_IMAGE_API_BASE_URL || env.GEMINI_API_BASE_URL || '';
const imageModel = env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';
const canUseRemoteGeminiImage = Boolean(imageApiKey && imageApiBaseUrl);

const IMAGE_MIME_TO_EXTENSION = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
});

const shouldUseStrictRemoteGeminiImage = () => {
  return canUseRemoteGeminiImage && env.GEMINI_IMAGE_STRICT_REMOTE;
};

const getGeminiImageProviderStatus = () => {
  const missingFields = [];

  if (!imageApiKey) {
    missingFields.push('GEMINI_IMAGE_API_KEY');
  }

  if (!imageApiBaseUrl) {
    missingFields.push('GEMINI_IMAGE_API_BASE_URL');
  }

  return {
    ready: canUseRemoteGeminiImage,
    reason: missingFields.length ? `缺少 ${missingFields.join('、')}` : '',
    model: imageModel
  };
};

const appendKeyQuery = (endpoint, token) => {
  const url = new URL(endpoint);
  url.searchParams.set('key', token);
  return url.toString();
};

const resolveGeminiImageEndpoint = () => {
  const trimmedBaseUrl = imageApiBaseUrl.replace(/\/+$/u, '');

  if (trimmedBaseUrl.endsWith(':generateContent')) {
    return trimmedBaseUrl;
  }

  return `${trimmedBaseUrl}/v1beta/models/${imageModel}:generateContent`;
};

const buildGeminiImagePayload = (prompt) => {
  const generationConfig = {
    responseModalities: ['IMAGE']
  };

  if (env.GEMINI_IMAGE_ASPECT_RATIO) {
    generationConfig.imageConfig = {
      aspectRatio: env.GEMINI_IMAGE_ASPECT_RATIO
    };
  }

  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig
  };
};

const isAuthLikeGeminiStatus = (statusCode) => {
  return [400, 401, 403, 404].includes(Number(statusCode));
};

const isRetryableGeminiStatus = (statusCode) => {
  return [408, 429, 500, 502, 503, 504].includes(Number(statusCode));
};

const callRemoteGeminiImage = async ({ prompt }) => {
  const endpoint = resolveGeminiImageEndpoint();
  const requestBody = buildGeminiImagePayload(prompt);
  const requestVariants = [
    {
      name: 'bearer+query-key',
      url: appendKeyQuery(endpoint, imageApiKey),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${imageApiKey}`
      }
    },
    {
      name: 'query-key',
      url: appendKeyQuery(endpoint, imageApiKey),
      headers: {
        'Content-Type': 'application/json'
      }
    },
    {
      name: 'bearer',
      url: endpoint,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${imageApiKey}`
      }
    }
  ];

  let lastError = null;

  for (let variantIndex = 0; variantIndex < requestVariants.length; variantIndex += 1) {
    const requestVariant = requestVariants[variantIndex];

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(requestVariant.url, {
          method: 'POST',
          headers: requestVariant.headers,
          body: JSON.stringify(requestBody),
          redirect: 'follow',
          signal: AbortSignal.timeout(env.GEMINI_IMAGE_REQUEST_TIMEOUT)
        });
        const responseText = await response.text();

        if (!response.ok) {
          const error = new Error(
            `Gemini image request failed with status ${response.status}: ${responseText.slice(0, 240)}`
          );
          error.statusCode = response.status;
          error.authVariant = requestVariant.name;
          throw error;
        }

        return {
          authVariant: requestVariant.name,
          responsePayload: responseText ? JSON.parse(responseText) : {}
        };
      } catch (error) {
        lastError = error;

        if (isAuthLikeGeminiStatus(error.statusCode) && variantIndex < requestVariants.length - 1) {
          break;
        }

        if (attempt >= 3 || !isRetryableGeminiStatus(error.statusCode)) {
          break;
        }

        await sleep(attempt * 750);
      }
    }

    if (lastError && !isAuthLikeGeminiStatus(lastError.statusCode)) {
      break;
    }
  }

  throw lastError ?? new Error('Gemini image request failed.');
};

const extractGeneratedImages = (responsePayload = {}) => {
  const parts = responsePayload?.candidates?.flatMap((candidate) => candidate?.content?.parts ?? []) ?? [];

  const images = parts
    .map((part) => {
      const inlineData = part?.inlineData ?? part?.inline_data ?? null;
      const mimeType = String(inlineData?.mimeType ?? inlineData?.mime_type ?? '').trim();
      const data = String(inlineData?.data ?? '').trim();

      if (!mimeType.startsWith('image/') || !data) {
        return null;
      }

      return {
        mimeType,
        data
      };
    })
    .filter(Boolean);

  if (!images.length) {
    throw new Error('Gemini 图片生成未返回图片数据。');
  }

  return images;
};

const saveGeneratedImageToUploads = async ({ mimeType, data, basename }) => {
  const extension = IMAGE_MIME_TO_EXTENSION[mimeType] || '.png';
  const relativePath = createOutputRelativePath('resource-images', basename, extension);
  const absolutePath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absolutePath);
  await writeFile(absolutePath, Buffer.from(data, 'base64'));

  return {
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    mimeType
  };
};

const generateImageAsset = async ({ prompt, basename }) => {
  if (!canUseRemoteGeminiImage) {
    throw new Error('Gemini 图片生成未配置远端密钥或地址。');
  }

  try {
    const { authVariant, responsePayload } = await callRemoteGeminiImage({ prompt });
    const [firstImage] = extractGeneratedImages(responsePayload);
    const savedAsset = await saveGeneratedImageToUploads({
      mimeType: firstImage.mimeType,
      data: firstImage.data,
      basename
    });

    return {
      ...savedAsset,
      provider: 'remote-gemini-image',
      model: imageModel,
      authVariant,
      rawResponse: responsePayload
    };
  } catch (error) {
    logger.warn('Remote Gemini image generation failed.', {
      message: error.message
    });

    if (shouldUseStrictRemoteGeminiImage()) {
      throw error;
    }

    throw error;
  }
};

export {
  canUseRemoteGeminiImage,
  generateImageAsset,
  extractGeneratedImages,
  buildGeminiImagePayload,
  getGeminiImageProviderStatus
};
