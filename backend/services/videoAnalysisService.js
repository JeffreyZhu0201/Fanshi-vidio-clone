import logger from '../utils/logger.js';
import { analyzeVideo as analyzeVideoWithGemini } from './geminiService.js';
import {
  analyzeVideoComplete as analyzeVideoWithDoubaoSeed,
  getDoubaoSeedProviderStatus
} from './doubaoSeedService.js';
import { buildVideoAnalysisPrompt } from '../../shared/promptBlueprints.js';

const SUPPORTED_PROVIDERS = ['gemini', 'doubao-seed'];
const DEFAULT_PROVIDER = 'gemini';

/**
 * Get status of all available video analysis providers
 * @returns {object} Provider status map
 */
const getVideoAnalysisProviderStatus = () => {
  const geminiStatus = {
    ready: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_BASE_URL),
    reason: !process.env.GEMINI_API_KEY || !process.env.GEMINI_API_BASE_URL
      ? '缺少 GEMINI_API_KEY 或 GEMINI_API_BASE_URL'
      : '',
    model: 'gemini-2.5-pro'
  };

  const doubaoSeedStatus = getDoubaoSeedProviderStatus();

  return {
    gemini: geminiStatus,
    'doubao-seed': doubaoSeedStatus,
    default: DEFAULT_PROVIDER,
    supported: SUPPORTED_PROVIDERS
  };
};

/**
 * Normalize Doubao-Seed analysis result to match Gemini format
 * @param {string} analysisText - Raw analysis text from Doubao-Seed
 * @param {object} metadata - Video metadata
 * @param {object} analysisOptions - Analysis options
 * @returns {object} Normalized analysis payload
 */
const normalizeDoubaoSeedAnalysisResult = (analysisText, metadata, analysisOptions) => {
  try {
    // Try to parse as JSON
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in Doubao-Seed response');
    }

    const parsedResult = JSON.parse(jsonMatch[0]);

    // Add provider metadata
    return {
      ...parsedResult,
      geminiResponse: {
        provider: 'doubao-seed',
        model: 'doubao-seed-2-0-lite-260215',
        isMock: false,
        fallbackReason: '',
        remoteError: ''
      }
    };
  } catch (error) {
    logger.error('Failed to parse Doubao-Seed analysis result', {
      error: error.message,
      resultPreview: analysisText.slice(0, 500)
    });
    throw new Error(`Doubao-Seed 分析结果解析失败: ${error.message}`);
  }
};

/**
 * Analyze video with selected provider
 * @param {object} params - Analysis parameters
 * @param {object} params.video - Video record
 * @param {object} params.metadata - Video metadata
 * @param {string} params.videoAbsolutePath - Absolute path to video file
 * @param {object} params.analysisOptions - Analysis options
 * @param {string} params.provider - Provider name ('gemini' or 'doubao-seed')
 * @returns {Promise<object>} Analysis result
 */
const analyzeVideoWithProvider = async ({
  video,
  metadata,
  videoAbsolutePath,
  analysisOptions = null,
  provider = DEFAULT_PROVIDER
}) => {
  const normalizedProvider = String(provider || DEFAULT_PROVIDER).toLowerCase().trim();

  if (!SUPPORTED_PROVIDERS.includes(normalizedProvider)) {
    throw new Error(
      `不支持的视频分析提供商: ${normalizedProvider}。支持的提供商: ${SUPPORTED_PROVIDERS.join(', ')}`
    );
  }

  const providerStatus = getVideoAnalysisProviderStatus();

  logger.info('Starting video analysis with provider', {
    provider: normalizedProvider,
    videoId: video?.id,
    videoPath: videoAbsolutePath,
    providerReady: providerStatus[normalizedProvider]?.ready
  });

  if (normalizedProvider === 'gemini') {
    return analyzeVideoWithGemini({
      video,
      metadata,
      videoAbsolutePath,
      analysisOptions
    });
  }

  if (normalizedProvider === 'doubao-seed') {
    const prompt = buildVideoAnalysisPrompt({
      video,
      metadata,
      analysisOptions
    });

    const { result, metadata: doubaoMetadata } = await analyzeVideoWithDoubaoSeed(
      videoAbsolutePath,
      prompt,
      {
        fps: 5, // 使用5fps以支持时序感知
        temperature: 0.7,
        maxTokens: 16000
      }
    );

    logger.info('Doubao-Seed analysis completed (temporal-aware), normalizing result', {
      fileName: doubaoMetadata.fileName,
      resultLength: result.length,
      elapsedMs: doubaoMetadata.elapsedMs,
      fps: doubaoMetadata.fps
    });

    return normalizeDoubaoSeedAnalysisResult(result, metadata, analysisOptions);
  }

  throw new Error(`Provider ${normalizedProvider} not implemented`);
};

export {
  analyzeVideoWithProvider,
  getVideoAnalysisProviderStatus,
  SUPPORTED_PROVIDERS,
  DEFAULT_PROVIDER
};
