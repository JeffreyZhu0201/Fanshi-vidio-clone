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

const imageApiKey = env.GEMINI_IMAGE_API_KEY || '';
const fallbackGeminiApiKey = env.GEMINI_API_KEY || '';
const imageApiBaseUrl = env.GEMINI_IMAGE_API_BASE_URL || env.GEMINI_API_BASE_URL || '';
const imageModel = env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';
const canUseRemoteGeminiImage = Boolean((imageApiKey || fallbackGeminiApiKey) && imageApiBaseUrl);
const unavailableGeminiImageCredentialSources = new Set();
let preferredGeminiImageCredentialSource = '';

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
    if (!fallbackGeminiApiKey) {
      missingFields.push('GEMINI_IMAGE_API_KEY / GEMINI_API_KEY');
    }
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

const getGeminiImageCredentialCandidates = () => {
  const candidates = [
    {
      token: imageApiKey,
      source: 'GEMINI_IMAGE_API_KEY'
    },
    {
      token: fallbackGeminiApiKey,
      source: 'GEMINI_API_KEY'
    }
  ].filter((item) => item.token);
  const seenTokens = new Set();

  return candidates.filter((item) => {
    if (seenTokens.has(item.token)) {
      return false;
    }

    seenTokens.add(item.token);
    return true;
  }).sort((left, right) => {
    const leftPreferred = left.source === preferredGeminiImageCredentialSource ? -2 : 0;
    const rightPreferred = right.source === preferredGeminiImageCredentialSource ? -2 : 0;
    const leftUnavailable = unavailableGeminiImageCredentialSources.has(left.source) ? 1 : 0;
    const rightUnavailable = unavailableGeminiImageCredentialSources.has(right.source) ? 1 : 0;

    return leftPreferred + leftUnavailable - (rightPreferred + rightUnavailable);
  });
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
    responseModalities: ['IMAGE'],
    imageConfig: {}
  };

  if (env.GEMINI_IMAGE_ASPECT_RATIO) {
    generationConfig.imageConfig.aspectRatio = env.GEMINI_IMAGE_ASPECT_RATIO;
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

const isRetryableGeminiStatus = (statusCode) => {
  return [408, 429, 500, 502, 503, 504].includes(Number(statusCode));
};

const isCredentialFallbackWorthy = (error) => {
  const message = String(error?.message ?? '').trim();
  const statusCode = Number(error?.statusCode ?? 0);

  if ([400, 401, 403, 404].includes(statusCode)) {
    return true;
  }

  if (statusCode === 503 && /无可用渠道|distributor/iu.test(message)) {
    return true;
  }

  return false;
};

const callRemoteGeminiImage = async ({ prompt }) => {
  const requestBody = buildGeminiImagePayload(prompt);
  let lastError = null;

  for (const credentialCandidate of getGeminiImageCredentialCandidates()) {
    const endpoint = appendKeyQuery(resolveGeminiImageEndpoint(), credentialCandidate.token);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${credentialCandidate.token}`
          },
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
          error.authVariant = 'bearer+query-key';
          error.credentialSource = credentialCandidate.source;
          throw error;
        }

        return {
          authVariant: 'bearer+query-key',
          credentialSource: credentialCandidate.source,
          responsePayload: responseText ? JSON.parse(responseText) : {}
        };
      } catch (error) {
        lastError = error;
        error.credentialSource = error.credentialSource || credentialCandidate.source;

        if (isCredentialFallbackWorthy(error)) {
          unavailableGeminiImageCredentialSources.add(credentialCandidate.source);
        }

        if (attempt < 3 && isRetryableGeminiStatus(error.statusCode) && !isCredentialFallbackWorthy(error)) {
          await sleep(attempt * 750);
          continue;
        }

        break;
      }
    }

    if (!lastError || !isCredentialFallbackWorthy(lastError)) {
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
    const { authVariant, credentialSource, responsePayload } = await callRemoteGeminiImage({ prompt });
    preferredGeminiImageCredentialSource = credentialSource || preferredGeminiImageCredentialSource;
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
      credentialSource,
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
