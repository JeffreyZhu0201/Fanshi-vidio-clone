import path from 'node:path';

import env from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { requestExternalJson } from './externalHttpService.js';
import { toPublicUploadUrl } from './fileService.js';

const DOUBAO_SEED_API_BASE_URL = 'https://ark.cn-beijing.volces.com';
const DOUBAO_SEED_MODEL = 'doubao-seed-2-0-lite-260215';
const DEFAULT_FPS = 5; // 默认每秒采样5帧（时序感知模式）

const canUseDoubaoSeed = Boolean(env.SEED_DANCE_API_KEY);

const shouldAllowDoubaoSeedMockFallback = () => {
  return !env.SEED_DANCE_STRICT_REMOTE;
};

/**
 * Construct public video URL for Doubao-Seed using SEED_DANCE_PUBLIC_ASSET_BASE_URL
 * @param {string} videoPath - Absolute path to video file
 * @returns {string} Public HTTP URL
 */
const toDoubaoPublicVideoUrl = (videoPath) => {
  const publicUrl = toPublicUploadUrl(videoPath);
  const publicBaseUrl = env.SEED_DANCE_PUBLIC_ASSET_BASE_URL || env.PUBLIC_ASSET_BASE_URL || '';

  if (!publicBaseUrl) {
    return '';
  }

  return new URL(publicUrl, publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`).toString();
};

const getDoubaoSeedProviderStatus = () => {
  const missingFields = [];
  if (!env.SEED_DANCE_API_KEY) missingFields.push('ARK_API_KEY (SEED_DANCE_API_KEY)');
  if (!env.SEED_DANCE_PUBLIC_ASSET_BASE_URL && !env.PUBLIC_ASSET_BASE_URL) {
    missingFields.push('SEED_DANCE_PUBLIC_ASSET_BASE_URL or PUBLIC_ASSET_BASE_URL');
  }

  return {
    ready: canUseDoubaoSeed && Boolean(env.SEED_DANCE_PUBLIC_ASSET_BASE_URL || env.PUBLIC_ASSET_BASE_URL),
    reason: missingFields.length ? `缺少 ${missingFields.join('、')}` : '',
    model: DOUBAO_SEED_MODEL,
    allow_mock_fallback: shouldAllowDoubaoSeedMockFallback(),
    api_base_url: DOUBAO_SEED_API_BASE_URL
  };
};

const assertDoubaoSeedReady = () => {
  const providerStatus = getDoubaoSeedProviderStatus();
  if (providerStatus.ready) return providerStatus;

  throw new AppError(
    `Doubao-Seed 未配置完成: ${providerStatus.reason}`,
    503,
    {
      provider: 'doubao-seed',
      status: providerStatus
    }
  );
};

/**
 * Analyze video using Doubao-Seed Chat Completions API (temporal-aware mode)
 * @param {string} videoUrl - Public HTTP/HTTPS URL to video file
 * @param {string} prompt - Analysis prompt
 * @param {object} options - Additional options
 * @returns {Promise<string>} - Analysis result text
 */
const analyzeVideoWithDoubaoSeed = async (videoUrl, prompt, options = {}) => {
  assertDoubaoSeedReady();

  const startTime = Date.now();
  const {
    temperature = 0.7,
    maxTokens = 16000,
    fps = DEFAULT_FPS
  } = options;

  logger.info('Analyzing video with Doubao-Seed Chat Completions API (temporal-aware)', {
    videoUrl,
    model: DOUBAO_SEED_MODEL,
    fps,
    promptLength: prompt.length
  });

  try {
    const requestBody = {
      model: DOUBAO_SEED_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'video_url',
              video_url: {
                url: videoUrl,
                fps: parseFloat(fps)
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ],
      temperature,
      max_tokens: maxTokens
    };

    const analysisUrl = `${DOUBAO_SEED_API_BASE_URL}/api/v3/chat/completions`;
    const headers = {
      'Authorization': `Bearer ${env.SEED_DANCE_API_KEY}`,
      'Content-Type': 'application/json'
    };

    const { response, responsePayload } = await requestExternalJson(analysisUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      timeoutMs: 600000 // 10 minutes for video analysis
    });

    if (!response.ok) {
      const errorMessage = responsePayload?.error?.message || responsePayload?.message || '未知错误';
      throw new AppError(
        `Doubao-Seed 视频分析失败: ${errorMessage}`,
        response.status,
        {
          statusCode: response.status,
          errorDetails: responsePayload,
          videoUrl
        }
      );
    }

    const analysisResult = responsePayload?.choices?.[0]?.message?.content;
    if (!analysisResult) {
      throw new AppError(
        'Doubao-Seed 分析响应缺少内容',
        502,
        {
          responsePayload,
          videoUrl
        }
      );
    }

    const elapsedMs = Date.now() - startTime;
    const resultLength = analysisResult.length;
    logger.info('Video analysis completed with Doubao-Seed', {
      videoUrl,
      resultLength,
      elapsedMs,
      usage: responsePayload?.usage
    });

    return analysisResult;
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    logger.error('Failed to analyze video with Doubao-Seed', {
      error: error.message,
      videoUrl,
      elapsedMs
    });
    throw error;
  }
};

/**
 * Complete workflow: construct public video URL and analyze it
 * @param {string} videoPath - Absolute path to video file
 * @param {string} prompt - Analysis prompt
 * @param {object} options - Additional options
 * @returns {Promise<{result: string, metadata: object}>}
 */
const analyzeVideoComplete = async (videoPath, prompt, options = {}) => {
  const startTime = Date.now();
  const fileName = path.basename(videoPath);

  logger.info('Starting Doubao-Seed video analysis (temporal-aware mode)', {
    videoPath,
    fileName,
    promptLength: prompt.length
  });

  try {
    // Construct public HTTP URL for video using Doubao-specific base URL
    const videoUrl = toDoubaoPublicVideoUrl(videoPath);

    if (!videoUrl) {
      throw new AppError(
        'SEED_DANCE_PUBLIC_ASSET_BASE_URL 或 PUBLIC_ASSET_BASE_URL 未配置，Doubao-Seed 需要公网可访问的视频 URL',
        500,
        {
          videoPath,
          hint: '请在 .env 中配置 SEED_DANCE_PUBLIC_ASSET_BASE_URL（推荐使用 HTTP）或 PUBLIC_ASSET_BASE_URL'
        }
      );
    }

    // Analyze video using public URL
    const result = await analyzeVideoWithDoubaoSeed(videoUrl, prompt, options);

    const elapsedMs = Date.now() - startTime;
    logger.info('Doubao-Seed analysis completed', {
      fileName,
      videoUrl,
      resultLength: result.length,
      elapsedMs
    });

    return {
      result,
      metadata: {
        fileName,
        videoUrl,
        model: DOUBAO_SEED_MODEL,
        fps: options.fps || DEFAULT_FPS,
        elapsedMs
      }
    };
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    logger.error('Doubao-Seed analysis failed', {
      error: error.message,
      videoPath,
      elapsedMs
    });
    throw error;
  }
};

export {
  getDoubaoSeedProviderStatus,
  assertDoubaoSeedReady,
  analyzeVideoWithDoubaoSeed,
  analyzeVideoComplete
};
