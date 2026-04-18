import { Analysis, GenerationTask, Segment, Video } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { TASK_STATUS } from '../config/constants.js';
import { ensureBackgroundAsset } from './backgroundAssetService.js';
import { generateSegment as generateWithSeedDance } from './seedDanceService.js';
import { resolveUploadPath, toAbsolutePublicUploadUrl } from './fileService.js';
import { broadcastRealtimeEvent } from './realtimeService.js';

const serializeGenerationTask = (task) => ({
  task_id: task.id,
  segment_id: task.segmentId,
  status: task.status,
  progress: task.progress,
  prompt: task.prompt,
  optimized_prompt: task.optimizedPrompt,
  result_url: task.resultUrl,
  error_message: task.errorMessage,
  created_at: task.createdAt,
  updated_at: task.updatedAt
});

const broadcastGenerationTaskUpdate = (task) => {
  broadcastRealtimeEvent('generation:progress', serializeGenerationTask(task));
};

const expandPromptMentions = (prompt, characters, backgrounds) => {
  return prompt.replace(/@([\p{L}\p{N}_-]+)/gu, (match, resourceName) => {
    const matchedCharacter = characters.find((item) =>
      typeof item === 'string' ? item === resourceName : item?.name === resourceName
    );

    if (matchedCharacter) {
      if (typeof matchedCharacter === 'string') {
        return matchedCharacter;
      }

      return [
        matchedCharacter?.appearancePrompt || matchedCharacter?.appearance_prompt || resourceName,
        matchedCharacter?.personalityPrompt ||
          matchedCharacter?.personality_prompt ||
          matchedCharacter?.temperament ||
          matchedCharacter?.personality ||
          matchedCharacter?.traits ||
          ''
      ]
        .filter(Boolean)
        .join('，');
    }

    const matchedBackground = backgrounds.find((item, index) =>
      typeof item === 'string'
        ? `场景 ${index + 1}` === resourceName
        : (item?.name || item?.title || item?.sceneName || item?.scene_name) === resourceName
    );

    if (matchedBackground) {
      if (typeof matchedBackground === 'string') {
        return matchedBackground;
      }

      return (
        matchedBackground?.scenePrompt ||
        matchedBackground?.scene_prompt ||
        matchedBackground?.backgroundPrompt ||
        matchedBackground?.background_prompt ||
        matchedBackground?.description ||
        matchedBackground?.summary ||
        resourceName
      );
    }

    return match;
  });
};

const getBackgroundBindingForSegment = (segment, overallAnalysis) => {
  const segmentAnalysis = segment?.analysis ?? {};
  const timeAnchor = overallAnalysis?.timeAnchors?.[segment.segmentIndex] ?? {};
  const backgroundId = String(
    segmentAnalysis.backgroundId ?? timeAnchor.backgroundId ?? timeAnchor.background_id ?? ''
  ).trim();

  if (!backgroundId) {
    return null;
  }

  const normalizedBackgrounds = overallAnalysis?.backgrounds ?? [];
  const matchedBackground =
    normalizedBackgrounds.find((background) => String(background.id ?? '').trim() === backgroundId) ?? null;

  return {
    backgroundId,
    backgroundAction: String(
      segmentAnalysis.backgroundAction ??
        timeAnchor.backgroundAction ??
        timeAnchor.background_action ??
        'create_new'
    ).trim() || 'create_new',
    backgroundName: String(
      segmentAnalysis.backgroundName ??
        timeAnchor.backgroundName ??
        timeAnchor.background_name ??
        matchedBackground?.name ??
        `场景 ${Number(segment.segmentIndex) + 1}`
    ).trim(),
    description: String(
      matchedBackground?.description ?? matchedBackground?.summary ?? segmentAnalysis.sceneSummary ?? ''
    ).trim(),
    backgroundPrompt: String(
      segmentAnalysis.backgroundPrompt ??
        matchedBackground?.scenePrompt ??
        matchedBackground?.scene_prompt ??
        segmentAnalysis.scenePrompt ??
        timeAnchor.scenePrompt ??
        timeAnchor.scene_prompt ??
        ''
    ).trim(),
    representativeFrameTime: Number(
      matchedBackground?.representativeFrameTime ??
        matchedBackground?.representative_frame_time ??
        segmentAnalysis.representativeFrameTime ??
        timeAnchor.representativeFrameTime ??
        timeAnchor.representative_frame_time
    ),
    sceneSummary: String(
      segmentAnalysis.sceneSummary ?? timeAnchor.sceneSummary ?? timeAnchor.scene_summary ?? segmentAnalysis.scene ?? ''
    ).trim()
  };
};

const processGenerationTask = async (taskId) => {
  const task = await GenerationTask.findByPk(taskId, {
    include: [
      {
        model: Segment,
        as: 'segment',
        include: [
          {
            model: Video,
            as: 'video',
            include: [
              {
                model: Analysis,
                as: 'analysis'
              }
            ]
          }
        ]
      }
    ]
  });

  if (!task) {
    return;
  }

  try {
    await task.update({
      status: TASK_STATUS.processing,
      progress: 10
    });
    broadcastGenerationTaskUpdate(task);

    const characters = task.segment?.video?.analysis?.characters ?? [];
    const overallAnalysis = task.segment?.video?.analysis ?? null;
    const backgroundBinding = getBackgroundBindingForSegment(task.segment, overallAnalysis);
    const sourceAbsolutePath = resolveUploadPath(task.segment.filePath);
    const sourcePublicUrl = toAbsolutePublicUploadUrl(task.segment.filePath);

    let backgroundAsset = null;

    if (backgroundBinding) {
      await task.update({
        progress: 20
      });
      broadcastGenerationTaskUpdate(task);

      backgroundAsset = await ensureBackgroundAsset({
        video: task.segment.video,
        segment: task.segment,
        backgroundId: backgroundBinding.backgroundId,
        backgroundName: backgroundBinding.backgroundName,
        backgroundDescription: backgroundBinding.description,
        backgroundPrompt: backgroundBinding.backgroundPrompt,
        representativeFrameTime: Number.isFinite(backgroundBinding.representativeFrameTime)
          ? Number(backgroundBinding.representativeFrameTime.toFixed(2))
          : null,
        segmentSceneSummary: backgroundBinding.sceneSummary,
        sourcePublicUrl,
        sourceAbsolutePath
      });
    }

    const optimizedPrompt = expandPromptMentions(task.prompt, characters, overallAnalysis?.backgrounds ?? []);

    await task.update({
      optimizedPrompt,
      progress: 45
    });
    broadcastGenerationTaskUpdate(task);

    const result = await generateWithSeedDance({
      sourceAbsolutePath,
      sourcePublicUrl,
      prompt: optimizedPrompt,
      basename: `segment-${task.segmentId}-task-${task.id}`,
      referenceVideos: [
        sourcePublicUrl
          ? {
              url: sourcePublicUrl,
              role: 'reference_video'
            }
          : null,
        backgroundAsset?.assetUrl
          ? {
              url: toAbsolutePublicUploadUrl(backgroundAsset.assetPath) || backgroundAsset.assetUrl,
              role: 'reference_video'
            }
          : null
      ].filter(Boolean)
    });

    await task.update({
      status: TASK_STATUS.completed,
      progress: 100,
      resultUrl: result.fileUrl,
      errorMessage: null
    });
    broadcastGenerationTaskUpdate(task);
  } catch (error) {
    await task.update({
      status: TASK_STATUS.failed,
      errorMessage: error.message
    });
    broadcastGenerationTaskUpdate(task);
  }
};

const startGeneration = async ({ segmentId, prompt }) => {
  const segment = await Segment.findByPk(segmentId);

  if (!segment) {
    throw new AppError('Segment not found.', 404, {
      segment_id: segmentId
    });
  }

  const task = await GenerationTask.create({
    segmentId,
    prompt,
    status: TASK_STATUS.pending,
    progress: 0
  });
  broadcastGenerationTaskUpdate(task);

  queueMicrotask(() => {
    void processGenerationTask(task.id);
  });

  return {
    task_id: task.id,
    status: task.status,
    progress: task.progress
  };
};

const getGenerationTaskStatus = async (taskId) => {
  const task = await GenerationTask.findByPk(taskId);

  if (!task) {
    throw new AppError('Generation task not found.', 404, {
      task_id: taskId
    });
  }

  return serializeGenerationTask(task);
};

export { startGeneration, getGenerationTaskStatus, serializeGenerationTask };
