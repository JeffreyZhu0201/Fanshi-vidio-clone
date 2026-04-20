import { Analysis } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { VIDEO_STATUS } from '../config/constants.js';
import { analyzeSegment, analyzeVideo as analyzeVideoWithGemini, optimizePrompt as optimizePromptWithGemini } from './geminiService.js';
import { broadcastRealtimeEvent } from './realtimeService.js';
import { getVideoRecordById, resolveVideoAbsolutePath } from './videoService.js';

const parseGeminiMeta = (geminiResponse) => {
  try {
    const parsed = JSON.parse(geminiResponse || '{}');
    const provider = parsed.provider || 'unknown';
    const inferredIsMock =
      typeof parsed.isMock === 'boolean' ? parsed.isMock : String(provider).toLowerCase().includes('mock');

    return {
      provider,
      model: parsed.model || '',
      mode: parsed.mode || '',
      authVariant: parsed.authVariant || '',
      isMock: inferredIsMock,
      fallbackReason: parsed.fallbackReason || '',
      remoteError: parsed.remoteError || ''
    };
  } catch (error) {
    return {
      provider: 'unknown',
      model: '',
      mode: '',
      authVariant: '',
      isMock: false,
      fallbackReason: '',
      remoteError: ''
    };
  }
};

const serializeAnalysis = (analysis, status = 'completed') => {
  const geminiMeta = parseGeminiMeta(analysis.geminiResponse);

  return {
    id: analysis.id,
    video_id: analysis.videoId,
    status,
    plot: analysis.plot,
    characters: analysis.characters ?? [],
    backgrounds: analysis.backgrounds ?? [],
    time_anchors: analysis.timeAnchors ?? [],
    provider: geminiMeta.provider,
    model: geminiMeta.model,
    mode: geminiMeta.mode,
    auth_variant: geminiMeta.authVariant,
    is_mock: geminiMeta.isMock,
    fallback_reason: geminiMeta.fallbackReason,
    remote_error: geminiMeta.remoteError
  };
};

const analyzeVideoById = async (videoId) => {
  const video = await getVideoRecordById(videoId, {
    include: [
      {
        model: Analysis,
        as: 'analysis'
      }
    ]
  });

  await video.update({
    status: VIDEO_STATUS.analyzing
  });
  broadcastRealtimeEvent('analysis:progress', {
    video_id: videoId,
    status: 'processing',
    progress: 15,
    message: '正在执行整片分析'
  });

  try {
    const analysisPayload = await analyzeVideoWithGemini({
      video,
      metadata: {
        duration: video.duration
      },
      videoAbsolutePath: resolveVideoAbsolutePath(video)
    });

    let analysisRecord = video.analysis;

    if (analysisRecord) {
      await analysisRecord.update(analysisPayload);
    } else {
      analysisRecord = await Analysis.create({
        videoId: video.id,
        ...analysisPayload
      });
    }

    await video.update({
      status: VIDEO_STATUS.analyzed
    });
    broadcastRealtimeEvent('analysis:progress', {
      video_id: videoId,
      status: 'completed',
      progress: 100,
      message: '整片分析完成'
    });

    return serializeAnalysis(analysisRecord);
  } catch (error) {
    await video.update({
      status: VIDEO_STATUS.failed
    });
    broadcastRealtimeEvent('analysis:progress', {
      video_id: videoId,
      status: 'failed',
      progress: 100,
      message: error.message
    });
    throw error;
  }
};

const getAnalysisByVideoId = async (videoId) => {
  const analysis = await Analysis.findOne({
    where: {
      videoId
    }
  });

  if (!analysis) {
    throw new AppError('Analysis not found.', 404, {
      video_id: videoId
    });
  }

  return serializeAnalysis(analysis);
};

const getAnalysisRecordByVideoId = async (videoId) => {
  return Analysis.findOne({
    where: {
      videoId
    }
  });
};

const optimizePrompt = async ({
  prompt,
  characters,
  backgrounds,
  mode = 'generation',
  segmentPrompt = '',
  shotPrompt = '',
  sceneNames = [],
  characterNames = []
}) => {
  const result = await optimizePromptWithGemini({
    prompt,
    characters,
    backgrounds,
    mode,
    segmentPrompt,
    shotPrompt,
    sceneNames,
    characterNames
  });

  return {
    optimized_prompt: result.optimizedPrompt,
    highlighted_prompt: result.highlightedPrompt
  };
};

const analyzeSegmentContent = async ({ segment, overallAnalysis, segmentAbsolutePath = '' }) => {
  return analyzeSegment({
    segment,
    overallAnalysis,
    segmentAbsolutePath
  });
};

export {
  analyzeVideoById,
  getAnalysisByVideoId,
  getAnalysisRecordByVideoId,
  optimizePrompt,
  analyzeSegmentContent,
  serializeAnalysis
};
