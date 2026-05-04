import path from 'node:path';
import { readFile } from 'node:fs/promises';
import FormData from 'form-data';
import axios from 'axios';

import env from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { requestExternalJson } from './externalHttpService.js';

const DOUBAO_SEED_API_BASE_URL = 'https://ark.cn-beijing.volces.com';
const DOUBAO_SEED_MODEL = 'doubao-seed-2-0-lite-260215';
const DEFAULT_FPS = 0.3; // Default FPS for Files API + Responses API workflow

const canUseDoubaoSeed = Boolean(env.SEED_DANCE_API_KEY);

const shouldAllowDoubaoSeedMockFallback = () => {
  return !env.SEED_DANCE_STRICT_REMOTE;
};

const getDoubaoSeedProviderStatus = () => {
  const missingFields = [];
  if (!env.SEED_DANCE_API_KEY) missingFields.push('ARK_API_KEY (SEED_DANCE_API_KEY)');

  return {
    ready: canUseDoubaoSeed,
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
 * Upload video to Doubao-Seed cloud storage using Files API
 * @param {string} videoPath - Absolute path to video file
 * @returns {Promise<string>} - File ID (e.g., "file-20250101-abc123")
 */
const uploadVideoToDoubaoSeed = async (videoPath) => {
  assertDoubaoSeedReady();

  const startTime = Date.now();
  const fileName = path.basename(videoPath);

  logger.info('Uploading video to Doubao-Seed cloud storage', {
    videoPath,
    fileName
  });

  try {
    const fileBuffer = await readFile(videoPath);
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'video/mp4'
    });
    formData.append('purpose', 'user_data');

    const uploadUrl = `${DOUBAO_SEED_API_BASE_URL}/api/v3/files`;
    const response = await axios.post(uploadUrl, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${env.SEED_DANCE_API_KEY}`
      },
      timeout: 300000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const fileId = response.data?.id;
    if (!fileId) {
      throw new AppError(
        'Doubao-Seed 文件上传响应缺少文件 ID',
        502,
        { responseData: response.data }
      );
    }

    const elapsedMs = Date.now() - startTime;
    logger.info('Video uploaded to Doubao-Seed successfully', {
      fileName,
      fileId,
      elapsedMs
    });

    return fileId;
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    logger.error('Failed to upload video to Doubao-Seed', {
      error: error.message,
      videoPath,
      elapsedMs
    });

    if (error.response) {
      throw new AppError(
        `Doubao-Seed 文件上传失败: ${error.response.data?.error?.message || error.message}`,
        error.response.status,
        {
          statusCode: error.response.status,
          errorDetails: error.response.data
        }
      );
    }
    throw error;
  }
};

/**
 * Analyze video using Responses API with file ID
 * @param {string} fileId - File ID from Files API (e.g., "file-20250101-abc123")
 * @param {string} prompt - Analysis prompt
 * @param {object} options - Additional options
 * @returns {Promise<{result: string, metadata: object}>}
 */
const analyzeVideoWithDoubaoSeed = async (fileId, prompt, options = {}) => {
  assertDoubaoSeedReady();

  const startTime = Date.now();
  const {
    fps = DEFAULT_FPS,
    temperature = 0.7,
    maxTokens = 16000,
    maxRetries = 5,
    retryDelayMs = 2000
  } = options;

  logger.info('Analyzing video with Doubao-Seed Responses API', {
    fileId,
    fps,
    model: DOUBAO_SEED_MODEL,
    promptLength: prompt.length
  });

  const requestBody = {
    model: DOUBAO_SEED_MODEL,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_video',
            file_id: fileId,
            fps: Number(fps)
          },
          {
            type: 'input_text',
            text: prompt
          }
        ]
      }
    ]
  };

  const analysisUrl = `${DOUBAO_SEED_API_BASE_URL}/api/v3/responses`;
  const headers = {
    'Authorization': `Bearer ${env.SEED_DANCE_API_KEY}`,
    'Content-Type': 'application/json'
  };

  // Retry loop to handle file processing state
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = retryDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
        logger.info('Retrying Doubao-Seed analysis after file processing delay', {
          fileId,
          attempt,
          delayMs: delay,
          maxRetries
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const { response, responsePayload } = await requestExternalJson(analysisUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        timeoutMs: 600000
      });

      if (!response.ok) {
        const errorMessage = responsePayload?.error?.message || responsePayload?.message || '未知错误';

        // Check if error is due to file still processing
        if (errorMessage.includes('invalid state: processing') && attempt < maxRetries) {
          logger.warn('File still processing, will retry', {
            fileId,
            attempt,
            maxRetries,
            errorMessage
          });
          lastError = new AppError(
            `Doubao-Seed 文件处理中: ${errorMessage}`,
            response.status,
            { statusCode: response.status, errorDetails: responsePayload, fileId }
          );
          continue; // Retry
        }

        throw new AppError(
          `Doubao-Seed 视频分析失败: ${errorMessage}`,
          response.status,
          {
            statusCode: response.status,
            errorDetails: responsePayload,
            fileId
          }
        );
      }

      // Extract content from output array (Doubao-Seed uses output instead of choices)
      // The output array may contain multiple items with different types (reasoning, message)
      // We need to find the item with type "message" which contains the actual result
      const messageOutput = responsePayload?.output?.find(item => item.type === 'message');
      const analysisResult = messageOutput?.content?.[0]?.text;

      if (!analysisResult) {
        throw new AppError(
          'Doubao-Seed 分析响应缺少内容',
          502,
          {
            responsePayload,
            outputTypes: responsePayload?.output?.map(item => item.type),
            fileId
          }
        );
      }

      const elapsedMs = Date.now() - startTime;
      const resultLength = analysisResult.length;
      logger.info('Video analysis completed with Doubao-Seed', {
        fileId,
        resultLength,
        elapsedMs,
        usage: responsePayload?.usage,
        attemptsNeeded: attempt + 1
      });

      return {
        result: analysisResult,
        metadata: {
          model: DOUBAO_SEED_MODEL,
          fileId,
          fps,
          usage: responsePayload?.usage,
          elapsedMs
        }
      };
    } catch (error) {
      // If it's a processing error and we have retries left, continue
      if (error.message?.includes('invalid state: processing') && attempt < maxRetries) {
        lastError = error;
        continue;
      }
      // Otherwise, throw immediately
      const elapsedMs = Date.now() - startTime;
      logger.error('Failed to analyze video with Doubao-Seed', {
        error: error.message,
        fileId,
        elapsedMs
      });
      throw error;
    }
  }

  // If we exhausted all retries, throw the last error
  const elapsedMs = Date.now() - startTime;
  logger.error('Failed to analyze video with Doubao-Seed after all retries', {
    error: lastError?.message,
    fileId,
    maxRetries,
    elapsedMs
  });
  throw lastError || new AppError('Doubao-Seed 视频分析失败: 超过最大重试次数', 500, { fileId });
};

/**
 * Complete video analysis workflow using Files API + Responses API
 * @param {string} videoPath - Absolute path to video file
 * @param {string} prompt - Analysis prompt
 * @param {object} options - Additional options
 * @returns {Promise<{result: string, metadata: object}>}
 */
const analyzeVideoComplete = async (videoPath, prompt, options = {}) => {
  assertDoubaoSeedReady();

  const fileName = path.basename(videoPath);
  logger.info('Starting Doubao-Seed video analysis workflow', {
    videoPath,
    fileName,
    promptLength: prompt.length
  });

  try {
    // Step 1: Upload video to Doubao-Seed cloud storage
    const fileId = await uploadVideoToDoubaoSeed(videoPath);

    // Step 2: Analyze video using the file ID
    const result = await analyzeVideoWithDoubaoSeed(fileId, prompt, options);

    logger.info('Doubao-Seed video analysis workflow completed', {
      fileName,
      fileId,
      resultLength: result.result.length
    });

    return result;
  } catch (error) {
    logger.error('Doubao-Seed video analysis workflow failed', {
      error: error.message,
      videoPath
    });
    throw error;
  }
};

export {
  getDoubaoSeedProviderStatus,
  assertDoubaoSeedReady,
  uploadVideoToDoubaoSeed,
  analyzeVideoWithDoubaoSeed,
  analyzeVideoComplete
};
