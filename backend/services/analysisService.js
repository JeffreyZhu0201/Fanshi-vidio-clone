import { Analysis } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { VIDEO_STATUS } from '../config/constants.js';
import { analyzeSegment, analyzeVideo as analyzeVideoWithGemini, optimizePrompt as optimizePromptWithGemini } from './geminiService.js';
import { broadcastRealtimeEvent } from './realtimeService.js';
import { getVideoRecordById, resolveVideoAbsolutePath } from './videoService.js';

const serializeAnalysis = (analysis, status = 'completed') => ({
  id: analysis.id,
  video_id: analysis.videoId,
  status,
  plot: analysis.plot,
  characters: analysis.characters ?? [],
  backgrounds: analysis.backgrounds ?? [],
  time_anchors: analysis.timeAnchors ?? []
});

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

const optimizePrompt = async ({ prompt, characters }) => {
  const result = await optimizePromptWithGemini({
    prompt,
    characters
  });

  return {
    optimized_prompt: result.optimizedPrompt,
    highlighted_prompt: result.highlightedPrompt
  };
};

const analyzeSegmentContent = async ({ segment, overallAnalysis }) => {
  return analyzeSegment({
    segment,
    overallAnalysis
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
