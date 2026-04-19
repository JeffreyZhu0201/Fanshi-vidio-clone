import path from 'node:path';

import { GenerationTask, Segment, Video } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { analyzeSegmentContent, getAnalysisRecordByVideoId } from './analysisService.js';
import { resolveUploadPath, toPublicUploadUrl } from './fileService.js';
import { completeTask, createTask, failTask, updateTask } from './taskService.js';
import { splitVideo } from './ffmpegService.js';
import { getVideoRecordById, resolveVideoAbsolutePath } from './videoService.js';

const serializeGenerationTask = (task) => {
  if (!task) {
    return null;
  }

  const taskMeta = task.meta ?? {};

  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    prompt: task.prompt,
    optimized_prompt: task.optimizedPrompt,
    result_url: task.resultUrl,
    error_message: task.errorMessage,
    engine: String(taskMeta.engine ?? '').trim(),
    is_mock: Boolean(taskMeta.isMock),
    remote_task_id: String(taskMeta.remoteTaskId ?? '').trim(),
    fallback_reason: String(taskMeta.fallbackReason ?? '').trim(),
    provider_error: String(taskMeta.providerError ?? '').trim(),
    created_at: task.createdAt,
    updated_at: task.updatedAt
  };
};

const serializeSegment = (segment, latestCompletedGenerationTask = null, latestAttemptTask = null) => ({
  id: segment.id,
  segment_index: segment.segmentIndex,
  start_time: Number(segment.startTime),
  end_time: Number(segment.endTime),
  file_path: segment.filePath,
  file_url: toPublicUploadUrl(segment.filePath),
  analysis: segment.analysis,
  // Keep the display source aligned with merge: both use the latest completed generation result.
  latest_generation_task: serializeGenerationTask(latestCompletedGenerationTask),
  latest_attempt_task: serializeGenerationTask(latestAttemptTask)
});

const normalizeTimeAnchors = (timeAnchors) => {
  return (timeAnchors ?? [])
    .map((item, index) => {
      const representativeFrameTime = Number(
        item.representativeFrameTime ?? item.representative_frame_time
      );

      return {
        startTime: Number(item.startTime ?? item.start_time),
        endTime: Number(item.endTime ?? item.end_time),
        sceneSummary: item.sceneSummary ?? item.scene_summary ?? `Segment ${index + 1}`,
        scenePrompt: item.scenePrompt ?? item.scene_prompt ?? '',
        representativeFrameTime:
          Number.isFinite(representativeFrameTime) && representativeFrameTime >= 0
            ? representativeFrameTime
            : null,
        representativeFrameNote:
          item.representativeFrameNote ?? item.representative_frame_note ?? '',
        backgroundId: String(item.backgroundId ?? item.background_id ?? '').trim(),
        backgroundAction: String(item.backgroundAction ?? item.background_action ?? '').trim(),
        backgroundName: String(item.backgroundName ?? item.background_name ?? '').trim()
      };
    })
    .sort((left, right) => left.startTime - right.startTime);
};

const getBackgroundLibraryById = (overallAnalysis) => {
  return new Map(
    (overallAnalysis?.backgrounds ?? [])
      .filter(Boolean)
      .map((background, index) => [
        String(background.id ?? `background_${index + 1}`),
        {
          id: String(background.id ?? `background_${index + 1}`),
          name: String(background.name ?? `场景 ${index + 1}`),
          description: String(background.description ?? background.summary ?? '').trim(),
          scenePrompt: String(background.scenePrompt ?? background.scene_prompt ?? '').trim(),
          representativeFrameTime: Number(
            background.representativeFrameTime ?? background.representative_frame_time
          ),
          representativeFrameNote: String(
            background.representativeFrameNote ?? background.representative_frame_note ?? ''
          ).trim()
        }
      ])
  );
};

const normalizeSceneNameList = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
};

const buildBaseSegmentAnalysis = ({ segment, timeAnchor = {}, overallAnalysis, previousAnalysis = {} }) => {
  const backgroundLibrary = getBackgroundLibraryById(overallAnalysis);
  const backgroundId =
    String(
      timeAnchor.backgroundId ??
        timeAnchor.background_id ??
        previousAnalysis.backgroundId ??
        previousAnalysis.background_id ??
        ''
    ).trim() || `background_${Number(segment.segmentIndex) + 1}`;
  const background = backgroundLibrary.get(backgroundId);
  const sceneSummary =
    String(timeAnchor.sceneSummary ?? timeAnchor.scene_summary ?? previousAnalysis.sceneSummary ?? '').trim() ||
    previousAnalysis.scene ||
    '';
  const scenePrompt =
    String(timeAnchor.scenePrompt ?? timeAnchor.scene_prompt ?? previousAnalysis.scenePrompt ?? '').trim() ||
    previousAnalysis.prompt ||
    '';
  const representativeFrameTime = Number(
    timeAnchor.representativeFrameTime ??
      timeAnchor.representative_frame_time ??
      previousAnalysis.representativeFrameTime
  );
  const backgroundName =
    String(
      timeAnchor.backgroundName ??
        timeAnchor.background_name ??
        previousAnalysis.backgroundName ??
        previousAnalysis.background_name ??
        background?.name ??
        `场景 ${Number(segment.segmentIndex) + 1}`
    ).trim() || `场景 ${Number(segment.segmentIndex) + 1}`;
  const scenes = normalizeSceneNameList(previousAnalysis.scenes);

  return {
    sceneSummary,
    scenePrompt,
    backgroundId,
    backgroundAction:
      String(
        timeAnchor.backgroundAction ??
          timeAnchor.background_action ??
          previousAnalysis.backgroundAction ??
          previousAnalysis.background_action ??
          ''
      ).trim() || 'create_new',
    backgroundName,
    backgroundPrompt:
      String(previousAnalysis.backgroundPrompt ?? background?.scenePrompt ?? scenePrompt ?? '').trim() ||
      scenePrompt,
    representativeFrameTime:
      Number.isFinite(representativeFrameTime) && representativeFrameTime >= 0
        ? Number(representativeFrameTime.toFixed(2))
        : null,
    representativeFrameNote: String(
      timeAnchor.representativeFrameNote ??
        timeAnchor.representative_frame_note ??
        previousAnalysis.representativeFrameNote ??
        background?.representativeFrameNote ??
        ''
    ).trim(),
    scenes: scenes.length ? scenes : backgroundName ? [backgroundName] : [],
    characters: Array.isArray(previousAnalysis.characters) ? previousAnalysis.characters : [],
    scene: String(previousAnalysis.scene ?? sceneSummary).trim(),
    action: String(previousAnalysis.action ?? '').trim(),
    prompt: String(previousAnalysis.prompt ?? scenePrompt).trim()
  };
};

const mergeSegmentAnalysis = ({ baseAnalysis, nextSegmentAnalysis = {} }) => {
  return {
    ...baseAnalysis,
    scenes:
      Array.isArray(nextSegmentAnalysis.scenes) && nextSegmentAnalysis.scenes.length
        ? nextSegmentAnalysis.scenes
        : baseAnalysis.scenes ?? [],
    characters:
      Array.isArray(nextSegmentAnalysis.characters) && nextSegmentAnalysis.characters.length
        ? nextSegmentAnalysis.characters
        : baseAnalysis.characters ?? [],
    scene: String(nextSegmentAnalysis.scene ?? '').trim() || baseAnalysis.scene || baseAnalysis.sceneSummary,
    action: String(nextSegmentAnalysis.action ?? '').trim() || baseAnalysis.action || '',
    prompt:
      String(nextSegmentAnalysis.prompt ?? '').trim() ||
      baseAnalysis.prompt ||
      baseAnalysis.scenePrompt ||
      baseAnalysis.backgroundPrompt
  };
};

const getSegmentRecordById = async (segmentId, options = {}) => {
  const segment = await Segment.findByPk(segmentId, options);

  if (!segment) {
    throw new AppError('Segment not found.', 404, {
      segment_id: segmentId
    });
  }

  return segment;
};

const getLatestTasksBySegmentIds = async (segmentIds) => {
  if (!segmentIds.length) {
    return {
      latestAttemptTaskBySegmentId: new Map(),
      latestCompletedTaskBySegmentId: new Map()
    };
  }

  const latestTasks = await GenerationTask.findAll({
    where: {
      segmentId: segmentIds
    },
    order: [['createdAt', 'DESC']]
  });

  const latestAttemptTaskBySegmentId = new Map();
  const latestCompletedTaskBySegmentId = new Map();

  latestTasks.forEach((task) => {
    if (!latestAttemptTaskBySegmentId.has(task.segmentId)) {
      latestAttemptTaskBySegmentId.set(task.segmentId, task);
    }

    if (task.status === 'completed' && !latestCompletedTaskBySegmentId.has(task.segmentId)) {
      latestCompletedTaskBySegmentId.set(task.segmentId, task);
    }
  });

  return {
    latestAttemptTaskBySegmentId,
    latestCompletedTaskBySegmentId
  };
};

const processSplitTask = async (taskId, videoId, timeAnchors) => {
  try {
    updateTask(taskId, {
      status: 'processing',
      progress: 5,
      message: 'Loading video and time anchors'
    });

    const video = await getVideoRecordById(videoId);
    const overallAnalysis = await getAnalysisRecordByVideoId(videoId);
    const providedAnchors = normalizeTimeAnchors(timeAnchors);
    const normalizedAnchors =
      providedAnchors.length > 0
        ? providedAnchors
        : normalizeTimeAnchors(overallAnalysis?.timeAnchors ?? []);

    if (!normalizedAnchors.length) {
      throw new AppError('No time anchors are available for splitting.', 400, {
        video_id: videoId
      });
    }

    await Segment.destroy({
      where: {
        videoId
      }
    });

    const splitSegments = await splitVideo(resolveVideoAbsolutePath(video), normalizedAnchors, {
      basename: path.basename(video.filename, path.extname(video.filename)),
      onProgress: (progress) => {
        updateTask(taskId, {
          status: 'processing',
          progress: Math.min(60, Math.max(10, Math.round(progress * 0.6))),
          message: 'Splitting source video'
        });
      }
    });

    const createdSegments = [];

    for (const segmentInfo of splitSegments) {
      const timeAnchor = normalizedAnchors[segmentInfo.segmentIndex] ?? {};
      const baseSegmentAnalysis = buildBaseSegmentAnalysis({
        segment: segmentInfo,
        timeAnchor,
        overallAnalysis
      });
      const analyzedSegment = await analyzeSegmentContent({
        segment: {
          ...segmentInfo,
          analysis: baseSegmentAnalysis
        },
        overallAnalysis,
        segmentAbsolutePath: resolveUploadPath(segmentInfo.filePath)
      });
      const segmentAnalysis = mergeSegmentAnalysis({
        baseAnalysis: baseSegmentAnalysis,
        nextSegmentAnalysis: analyzedSegment
      });

      const segment = await Segment.create({
        videoId,
        segmentIndex: segmentInfo.segmentIndex,
        startTime: segmentInfo.startTime,
        endTime: segmentInfo.endTime,
        filePath: segmentInfo.filePath,
        analysis: segmentAnalysis
      });

      createdSegments.push(segment);

      updateTask(taskId, {
        status: 'processing',
        progress: 60 + Math.round((createdSegments.length / splitSegments.length) * 35),
        message: 'Analyzing video segments'
      });
    }

    completeTask(
      taskId,
      {
        video_id: videoId,
        segment_count: createdSegments.length
      },
      'Video split completed'
    );
  } catch (error) {
    failTask(taskId, error.message);
  }
};

const startSplitVideo = async ({ videoId, timeAnchors }) => {
  await getVideoRecordById(videoId);

  const task = createTask({
    type: 'split',
    meta: {
      videoId
    },
    message: 'Split task queued'
  });

  queueMicrotask(() => {
    void processSplitTask(task.id, videoId, timeAnchors);
  });

  return {
    task_id: task.id,
    status: task.status,
    progress: task.progress
  };
};

const analyzeSegmentById = async (segmentId) => {
  const segment = await getSegmentRecordById(segmentId);
  const overallAnalysis = await getAnalysisRecordByVideoId(segment.videoId);

  if (!overallAnalysis) {
    throw new AppError('请先完成整片分析，再执行片段分析。', 400, {
      segment_id: segmentId,
      video_id: segment.videoId
    });
  }

  const timeAnchor = normalizeTimeAnchors(overallAnalysis.timeAnchors ?? [])[segment.segmentIndex] ?? {};
  const baseSegmentAnalysis = buildBaseSegmentAnalysis({
    segment: {
      id: segment.id,
      segmentIndex: segment.segmentIndex,
      startTime: Number(segment.startTime),
      endTime: Number(segment.endTime),
      filePath: segment.filePath
    },
    timeAnchor,
    overallAnalysis,
    previousAnalysis: segment.analysis ?? {}
  });
  const nextSegmentAnalysis = await analyzeSegmentContent({
    segment: {
      id: segment.id,
      segmentIndex: segment.segmentIndex,
      startTime: Number(segment.startTime),
      endTime: Number(segment.endTime),
      filePath: segment.filePath,
      analysis: baseSegmentAnalysis
    },
    overallAnalysis,
    segmentAbsolutePath: resolveUploadPath(segment.filePath)
  });

  await segment.update({
    analysis: mergeSegmentAnalysis({
      baseAnalysis: baseSegmentAnalysis,
      nextSegmentAnalysis
    })
  });

  const { latestAttemptTaskBySegmentId, latestCompletedTaskBySegmentId } = await getLatestTasksBySegmentIds([
    segment.id
  ]);

  return serializeSegment(
    segment,
    latestCompletedTaskBySegmentId.get(segment.id) ?? null,
    latestAttemptTaskBySegmentId.get(segment.id) ?? null
  );
};

const listSegmentsByVideoId = async (videoId) => {
  await getVideoRecordById(videoId);

  const segments = await Segment.findAll({
    where: {
      videoId
    },
    order: [['segmentIndex', 'ASC']]
  });

  if (!segments.length) {
    return [];
  }

  const { latestAttemptTaskBySegmentId, latestCompletedTaskBySegmentId } = await getLatestTasksBySegmentIds(
    segments.map((segment) => segment.id)
  );

  return segments.map((segment) =>
    serializeSegment(
      segment,
      latestCompletedTaskBySegmentId.get(segment.id) ?? null,
      latestAttemptTaskBySegmentId.get(segment.id) ?? null
    )
  );
};

export { startSplitVideo, listSegmentsByVideoId, analyzeSegmentById, getSegmentRecordById };
