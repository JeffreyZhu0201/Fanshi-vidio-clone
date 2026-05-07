import { writeFile } from 'node:fs/promises';

import env from '../config/env.js';
import logger from '../utils/logger.js';
import { requestExternalJson } from './externalHttpService.js';
import {
  createOutputRelativePath,
  ensureParentDirectory,
  resolveUploadPath,
  toPublicUploadUrl
} from './fileService.js';

const seedreamApiKey = env.SEED_DREAM_API_KEY || env.SEED_DANCE_API_KEY || '';
const seedreamApiBaseUrl = env.SEED_DREAM_API_BASE_URL || 'https://ark.cn-beijing.volces.com';
const seedreamModel = env.SEED_DREAM_MODEL || 'doubao-seedream-5-0-260128';
const canUseSeedream = Boolean(seedreamApiKey && seedreamApiBaseUrl);

const IMAGE_MIME_TO_EXTENSION = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
});

/**
 * Get Doubao-Seedream provider status
 */
const getSeedreamProviderStatus = () => {
  const missingFields = [];

  if (!seedreamApiKey) {
    missingFields.push('SEED_DREAM_API_KEY / SEED_DANCE_API_KEY');
  }

  if (!seedreamApiBaseUrl) {
    missingFields.push('SEED_DREAM_API_BASE_URL');
  }

  return {
    ready: canUseSeedream,
    reason: missingFields.length ? `缺少 ${missingFields.join('、')}` : '',
    model: seedreamModel
  };
};

/**
 * Build turnaround prompt for character three-view generation
 */
const buildTurnaroundPrompt = (characterPrompt) => {
  return `请在同一张图片中生成该角色的三视图（正面、侧面、背面），三个视角并排排列。
角色描述：${characterPrompt}

要求：
1. 三个视角必须在同一张图片中，从左到右依次为：正面视图、侧面视图（90度）、背面视图
2. 保持角色的外观、服装、发型、体态完全一致
3. 三个视角的角色大小、比例、站姿保持统一
4. 使用纯色或简洁背景，突出角色本身
5. 清晰展示角色的服装细节、配饰和特征
6. 国漫影视化风格，轮廓清晰，色彩饱和
7. 不要添加文字、标注或水印`;
};

/**
 * Call Doubao-Seedream API for image generation
 */
const callSeedreamImageGeneration = async ({
  prompt,
  referenceImageUrl = null,
  size = '2K',
  outputFormat = 'png'
}) => {
  const endpoint = `${seedreamApiBaseUrl.replace(/\/+$/u, '')}/api/v3/images/generations`;

  const requestBody = {
    model: seedreamModel,
    prompt,
    size,
    output_format: outputFormat,
    watermark: false
  };

  // Add reference image if provided
  if (referenceImageUrl) {
    requestBody.image = referenceImageUrl;
  }

  logger.info('Calling Doubao-Seedream API', {
    model: seedreamModel,
    promptLength: prompt.length,
    hasReferenceImage: Boolean(referenceImageUrl),
    size,
    outputFormat
  });

  const { response, responseText, responsePayload } = await requestExternalJson(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${seedreamApiKey}`
    },
    body: JSON.stringify(requestBody),
    timeoutMs: env.SEED_DREAM_REQUEST_TIMEOUT || 120000
  });

  const statusCode = response.status;

  if (statusCode < 200 || statusCode >= 300) {
    const errorMessage = String(
      responsePayload?.error?.message ?? responsePayload?.message ?? responseText
    ).trim();
    const error = new Error(
      `Doubao-Seedream request failed with status ${statusCode}: ${errorMessage.slice(0, 240)}`
    );
    error.statusCode = statusCode;
    throw error;
  }

  logger.info('Doubao-Seedream API call successful', {
    model: seedreamModel,
    hasData: Boolean(responsePayload?.data?.[0])
  });

  return responsePayload;
};

/**
 * Extract generated image from Seedream response
 */
const extractSeedreamImage = (responsePayload = {}) => {
  const data = responsePayload?.data?.[0];

  if (!data) {
    throw new Error('Doubao-Seedream 未返回图片数据');
  }

  // Seedream returns base64 encoded image in b64_json format
  const base64Data = data.b64_json;
  const url = data.url;

  if (!base64Data && !url) {
    throw new Error('Doubao-Seedream 响应中缺少图片数据（b64_json 或 url）');
  }

  // Determine mime type from output format
  const mimeType = 'image/png'; // Default to PNG as specified in request

  return {
    mimeType,
    data: base64Data,
    url
  };
};

/**
 * Download image from URL
 */
const downloadImageFromUrl = async (url) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download image from URL: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

/**
 * Save generated image to uploads directory
 */
const saveSeedreamImageToUploads = async ({ mimeType, data, url, basename }) => {
  const extension = IMAGE_MIME_TO_EXTENSION[mimeType] || '.png';
  const relativePath = createOutputRelativePath('resource-images', basename, extension);
  const absolutePath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absolutePath);

  let imageBuffer;

  if (data) {
    // Save from base64 data
    imageBuffer = Buffer.from(data, 'base64');
  } else if (url) {
    // Download from URL
    imageBuffer = await downloadImageFromUrl(url);
  } else {
    throw new Error('No image data or URL provided');
  }

  await writeFile(absolutePath, imageBuffer);

  return {
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    mimeType
  };
};

/**
 * Generate character turnaround (three-view) image using Doubao-Seedream
 */
const generateCharacterTurnaround = async ({
  characterPrompt,
  referenceImageUrl = null,
  basename
}) => {
  if (!canUseSeedream) {
    throw new Error('Doubao-Seedream 未配置远端密钥或地址');
  }

  try {
    const turnaroundPrompt = buildTurnaroundPrompt(characterPrompt);

    const responsePayload = await callSeedreamImageGeneration({
      prompt: turnaroundPrompt,
      referenceImageUrl,
      size: '2K',
      outputFormat: 'png'
    });

    const imageData = extractSeedreamImage(responsePayload);

    const savedAsset = await saveSeedreamImageToUploads({
      mimeType: imageData.mimeType,
      data: imageData.data,
      url: imageData.url,
      basename
    });

    logger.info('Character turnaround generated successfully', {
      filePath: savedAsset.filePath,
      hasReferenceImage: Boolean(referenceImageUrl)
    });

    return {
      ...savedAsset,
      provider: 'doubao-seedream',
      model: seedreamModel,
      rawResponse: responsePayload
    };
  } catch (error) {
    logger.error('Doubao-Seedream turnaround generation failed', {
      error: error.message,
      statusCode: error.statusCode
    });
    throw error;
  }
};

/**
 * Generate generic image using Doubao-Seedream
 */
const generateImageAsset = async ({ prompt, referenceImageUrl = null, basename }) => {
  if (!canUseSeedream) {
    throw new Error('Doubao-Seedream 未配置远端密钥或地址');
  }

  try {
    const responsePayload = await callSeedreamImageGeneration({
      prompt,
      referenceImageUrl,
      size: '2K',
      outputFormat: 'png'
    });

    const imageData = extractSeedreamImage(responsePayload);

    const savedAsset = await saveSeedreamImageToUploads({
      mimeType: imageData.mimeType,
      data: imageData.data,
      url: imageData.url,
      basename
    });

    logger.info('Image asset generated successfully', {
      filePath: savedAsset.filePath,
      hasReferenceImage: Boolean(referenceImageUrl)
    });

    return {
      ...savedAsset,
      provider: 'doubao-seedream',
      model: seedreamModel,
      rawResponse: responsePayload
    };
  } catch (error) {
    logger.error('Doubao-Seedream image generation failed', {
      error: error.message,
      statusCode: error.statusCode
    });
    throw error;
  }
};

export {
  canUseSeedream,
  getSeedreamProviderStatus,
  generateCharacterTurnaround,
  generateImageAsset,
  buildTurnaroundPrompt
};
