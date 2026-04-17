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

  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    prompt: task.prompt,
    optimized_prompt: task.optimizedPrompt,
    result_url: task.resultUrl,
    error_message: task.errorMessage,
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
          item.representativeFrameNote ?? item.representative_frame_note ?? ''
      };
    })
    .sort((left, right) => left.startTime - right.startTime);
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
      const segmentAnalysis = await analyzeSegmentContent({
        segment: segmentInfo,
        overallAnalysis,
        segmentAbsolutePath: resolveUploadPath(segmentInfo.filePath)
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

  const nextSegmentAnalysis = await analyzeSegmentContent({
    segment: {
      id: segment.id,
      segmentIndex: segment.segmentIndex,
      startTime: Number(segment.startTime),
      endTime: Number(segment.endTime),
      filePath: segment.filePath
    },
    overallAnalysis,
    segmentAbsolutePath: resolveUploadPath(segment.filePath)
  });

  await segment.update({
    analysis: {
      ...(segment.analysis ?? {}),
      ...nextSegmentAnalysis
    }
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
