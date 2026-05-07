import { Analysis, Segment } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { VIDEO_STATUS } from '../config/constants.js';
import { analyzeSegment, optimizePrompt as optimizePromptWithGemini } from './geminiService.js';
import { analyzeVideoWithProvider } from './videoAnalysisService.js';
import { broadcastRealtimeEvent } from './realtimeService.js';
import { normalizeAnalysisOptions } from './shotSpeechService.js';
import { getVideoRecordById, resolveVideoAbsolutePath } from './videoService.js';
import logger from '../utils/logger.js';
import {
  hydrateCharacterStateRefsForAnchors,
  hydrateCharacterStateRefsForShots,
  normalizeAnalysisCharacters,
  rebuildCharacterStateFrameAssets
} from './characterStateService.js';

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
    analysis_options: normalizeAnalysisOptions(analysis.analysisOptions),
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

const analyzeVideoById = async (videoId, analysisOptions = null, provider = 'gemini') => {
  console.log('[analysisService] analyzeVideoById called with:', {
    videoId,
    provider,
    analysisOptions
  });

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
    console.log('[analysisService] Calling analyzeVideoWithProvider with provider:', provider);
    const rawAnalysisPayload = await analyzeVideoWithProvider({
      video,
      metadata: {
        duration: video.duration
      },
      videoAbsolutePath: resolveVideoAbsolutePath(video),
      analysisOptions: normalizeAnalysisOptions(analysisOptions),
      provider
    });
    const nextCharacters = await rebuildCharacterStateFrameAssets({
      video,
      characters: normalizeAnalysisCharacters(rawAnalysisPayload.characters ?? [], {
        videoDuration: Number(video.duration ?? 0)
      }),
      previousCharacters: normalizeAnalysisCharacters(video.analysis?.characters ?? [], {
        videoDuration: Number(video.duration ?? 0)
      }),
      cleanupExisting: Boolean(video.analysis?.characters?.length)
    });
    const analysisPayload = {
      ...rawAnalysisPayload,
      characters: nextCharacters,
      timeAnchors: hydrateCharacterStateRefsForAnchors({
        timeAnchors: rawAnalysisPayload.timeAnchors ?? [],
        characters: nextCharacters
      })
    };

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
  styleMode = '',
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
    styleMode,
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

const updateAnalysisCharactersByVideoId = async (videoId, characters) => {
  const video = await getVideoRecordById(videoId, {
    include: [
      {
        model: Analysis,
        as: 'analysis'
      }
    ]
  });

  if (!video.analysis) {
    throw new AppError('请先完成整片分析，再编辑角色状态。', 400, {
      video_id: videoId
    });
  }

  const currentAnalysis = video.analysis;
  const normalizedCharacters = normalizeAnalysisCharacters(characters, {
    videoDuration: Number(video.duration ?? 0)
  });
  const rebuiltCharacters = await rebuildCharacterStateFrameAssets({
    video,
    characters: normalizedCharacters,
    previousCharacters: normalizeAnalysisCharacters(currentAnalysis.characters ?? [], {
      videoDuration: Number(video.duration ?? 0)
    }),
    cleanupExisting: true
  });
  const nextTimeAnchors = hydrateCharacterStateRefsForAnchors({
    timeAnchors: currentAnalysis.timeAnchors ?? [],
    characters: rebuiltCharacters
  });

  await currentAnalysis.update({
    characters: rebuiltCharacters,
    timeAnchors: nextTimeAnchors
  });

  const segments = await Segment.findAll({
    where: {
      videoId
    }
  });

  await Promise.all(
    segments.map(async (segment) => {
      const segmentAnalysis = segment.analysis ?? {};
      const nextShots = hydrateCharacterStateRefsForShots({
        shots: Array.isArray(segmentAnalysis.shots) ? segmentAnalysis.shots : [],
        characters: rebuiltCharacters
      });

      await segment.update({
        analysis: {
          ...segmentAnalysis,
          shots: nextShots
        }
      });
    })
  );

  return serializeAnalysis(currentAnalysis);
};

/**
 * Extract scene keywords from scene summary text
 * @param {string} sceneSummary - Scene description text
 * @returns {Array<string>} Array of extracted keywords
 */
const extractSceneKeywords = (sceneSummary) => {
  const text = String(sceneSummary || '').toLowerCase();

  // Common scene keywords list
  const sceneKeywords = [
    '礼堂', '教室', '走廊', '操场', '图书馆', '食堂', '宿舍',
    '办公室', '会议室', '实验室', '体育馆', '停车场',
    '入口', '出口', '大厅', '楼梯', '电梯',
    '室内', '室外', '户外', '街道', '公园'
  ];

  // Extract matching keywords
  return sceneKeywords.filter(keyword => text.includes(keyword));
};

/**
 * Check if two segments belong to the same scene
 * @param {object} segment1 - First segment
 * @param {object} segment2 - Second segment
 * @returns {boolean} True if same scene
 */
const isSameScene = (segment1, segment2) => {
  // Strategy 1: If both have sceneId, compare directly
  if (segment1.sceneId && segment2.sceneId) {
    return segment1.sceneId === segment2.sceneId;
  }

  // Strategy 2: Extract scene keywords for fuzzy matching
  const keywords1 = extractSceneKeywords(segment1.sceneSummary || '');
  const keywords2 = extractSceneKeywords(segment2.sceneSummary || '');

  // If there are common keywords, consider them the same scene
  return keywords1.some(k => keywords2.includes(k));
};

/**
 * Merge adjacent segments with the same scene
 * @param {Array} timeAnchors - Original time anchors array
 * @returns {Array} Merged time anchors array
 */
const mergeAdjacentSegments = (timeAnchors) => {
  if (!Array.isArray(timeAnchors) || timeAnchors.length <= 1) {
    return timeAnchors;
  }

  const merged = [];
  let current = { ...timeAnchors[0], shots: [...(timeAnchors[0].shots || [])] };

  for (let i = 1; i < timeAnchors.length; i++) {
    const next = timeAnchors[i];

    // Check if same scene
    if (isSameScene(current, next)) {
      // Merge: extend time range, merge shots
      current.endTime = next.endTime;
      current.shots = [...current.shots, ...(next.shots || [])];

      // Update scene description to mark as continuation
      if (!current.sceneSummary.includes('（延续）')) {
        current.sceneSummary = `${current.sceneSummary}（延续）`;
      }
    } else {
      // Different scene: save current, start new segment
      merged.push(current);
      current = { ...next, shots: [...(next.shots || [])] };
    }
  }

  merged.push(current);

  logger.info('Segment merging completed', {
    originalCount: timeAnchors.length,
    mergedCount: merged.length,
    reduction: timeAnchors.length - merged.length
  });

  return merged;
};

const analyzeSegmentContent = async ({
  segment,
  overallAnalysis,
  segmentAbsolutePath = '',
  styleMode = '',
  segmentAnalysisStylePrompt = ''
}) => {
  return analyzeSegment({
    segment,
    overallAnalysis,
    segmentAbsolutePath,
    styleMode,
    segmentAnalysisStylePrompt
  });
};

export {
  analyzeVideoById,
  getAnalysisByVideoId,
  getAnalysisRecordByVideoId,
  optimizePrompt,
  analyzeSegmentContent,
  serializeAnalysis,
  updateAnalysisCharactersByVideoId,
  extractSceneKeywords,
  isSameScene,
  mergeAdjacentSegments
};
