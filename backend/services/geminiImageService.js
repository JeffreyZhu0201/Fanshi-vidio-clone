import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import env from '../config/env.js';
import logger from '../utils/logger.js';
import { requestExternalJson } from './externalHttpService.js';
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

const describeGeminiImageTransportError = (error) => {
  const primaryMessage = String(error?.message ?? '').trim();
  const causeMessage = String(error?.cause?.message ?? '').trim();

  if (primaryMessage && causeMessage && !primaryMessage.includes(causeMessage)) {
    return `${primaryMessage} (${causeMessage})`;
  }

  return primaryMessage || causeMessage || 'Unknown Gemini image transport error';
};

const isNetworkLikeGeminiImageError = (error) => {
  const statusCode = Number(error?.statusCode ?? 0);
  const normalizedMessage = describeGeminiImageTransportError(error);

  if (statusCode > 0) {
    return false;
  }

  return /fetch failed|connect timeout|tls connection|socket disconnected|econnreset|enotfound|eai_again|timed out|unexpected eof/iu.test(
    normalizedMessage
  );
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

const isGeminiImageModelUnavailableError = (error) => {
  const statusCode = Number(error?.statusCode ?? 0);
  const message = describeGeminiImageTransportError(error);

  if ([400, 404].includes(statusCode)) {
    return true;
  }

  return /model_not_found|无可用渠道|distributor|模型不可用|上游负载已饱和/iu.test(message);
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

const getGeminiImageModelCandidates = (requestedModel = imageModel) => {
  const fallbackModels = [
    requestedModel,
    imageModel,
    'gemini-3-image-preview',
    'gemini-3-pro-image-preview',
    'gemini-2.5-flash-image'
  ];
  const seenModels = new Set();

  return fallbackModels
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .filter((item) => {
      if (seenModels.has(item)) {
        return false;
      }

      seenModels.add(item);
      return true;
    });
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

const resolveGeminiImageEndpoint = (model = imageModel) => {
  const trimmedBaseUrl = imageApiBaseUrl.replace(/\/+$/u, '');

  if (trimmedBaseUrl.endsWith(':generateContent')) {
    return trimmedBaseUrl.replace(
      /\/v1beta\/models\/[^/:]+:generateContent$/u,
      `/v1beta/models/${model}:generateContent`
    );
  }

  return `${trimmedBaseUrl}/v1beta/models/${model}:generateContent`;
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

const callRemoteGeminiImageOverHttp = async ({
  url,
  headers = {},
  requestBody,
  timeoutMs = env.GEMINI_IMAGE_REQUEST_TIMEOUT,
  authVariant = '',
  credentialSource = '',
  model = imageModel
}) => {
  const { response, responseText, responsePayload } = await requestExternalJson(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    timeoutMs
  });
  const statusCode = response.status;

  if (statusCode < 200 || statusCode >= 300) {
    const providerMessage = String(
      responsePayload?.error?.message ?? responsePayload?.message ?? responseText
    ).trim();
    const error = new Error(
      `Gemini image request failed with status ${statusCode}: ${providerMessage.slice(0, 240)}`
    );
    error.statusCode = statusCode;
    error.authVariant = authVariant;
    error.credentialSource = credentialSource;
    error.model = model;
    throw error;
  }

  return {
    authVariant,
    credentialSource,
    model,
    responsePayload
  };
};

const callRemoteGeminiImage = async ({ prompt, model = imageModel }) => {
  const requestBody = buildGeminiImagePayload(prompt);
  let lastError = null;

  for (const modelCandidate of getGeminiImageModelCandidates(model)) {
    for (const credentialCandidate of getGeminiImageCredentialCandidates()) {
      const requestVariants = [
        {
          name: 'bearer+query-key',
          url: appendKeyQuery(resolveGeminiImageEndpoint(modelCandidate), credentialCandidate.token),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${credentialCandidate.token}`
          }
        },
        {
          name: 'query-key',
          url: appendKeyQuery(resolveGeminiImageEndpoint(modelCandidate), credentialCandidate.token),
          headers: {
            'Content-Type': 'application/json'
          }
        },
        {
          name: 'bearer',
          url: resolveGeminiImageEndpoint(modelCandidate),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${credentialCandidate.token}`
          }
        }
      ];

      for (const requestVariant of requestVariants) {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            return await callRemoteGeminiImageOverHttp({
              url: requestVariant.url,
              headers: requestVariant.headers,
              requestBody,
              timeoutMs: env.GEMINI_IMAGE_REQUEST_TIMEOUT,
              authVariant: `${requestVariant.name}+node`,
              credentialSource: credentialCandidate.source,
              model: modelCandidate
            });
          } catch (error) {
            lastError = error;
            error.credentialSource = error.credentialSource || credentialCandidate.source;
            error.model = error.model || modelCandidate;

            if (isCredentialFallbackWorthy(error)) {
              unavailableGeminiImageCredentialSources.add(credentialCandidate.source);
            }

            if (
              attempt < 3 &&
              (isRetryableGeminiStatus(error.statusCode) || isNetworkLikeGeminiImageError(error)) &&
              !isCredentialFallbackWorthy(error)
            ) {
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

      if (!lastError || !isCredentialFallbackWorthy(lastError)) {
        break;
      }
    }

    if (!lastError || !isGeminiImageModelUnavailableError(lastError)) {
      break;
    }

    logger.warn('Gemini image primary model unavailable, retrying with fallback model.', {
      requestedModel: model,
      fallbackModel: modelCandidate,
      message: describeGeminiImageTransportError(lastError)
    });
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
    const { authVariant, credentialSource, responsePayload, model: resolvedModel } = await callRemoteGeminiImage({
      prompt,
      model: imageModel
    });
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
      model: resolvedModel || imageModel,
      authVariant,
      credentialSource,
      rawResponse: responsePayload
    };
  } catch (error) {
    logger.warn('Remote Gemini image generation failed.', {
      message: describeGeminiImageTransportError(error)
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
