import path from 'node:path';

import { GenerationTask, Segment } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { mergeVideos } from './ffmpegService.js';
import { createTask, getTask, completeTask, failTask, updateTask } from './taskService.js';
import { publicUrlToRelativePath, resolveUploadPath } from './fileService.js';
import { getVideoRecordById } from './videoService.js';

const processMergeTask = async (taskId, videoId) => {
  try {
    updateTask(taskId, {
      status: 'processing',
      progress: 10,
      message: 'Loading video segments'
    });

    await getVideoRecordById(videoId);

    const segments = await Segment.findAll({
      where: {
        videoId
      },
      order: [['segmentIndex', 'ASC']]
    });

    if (!segments.length) {
      throw new AppError('No segments available for merging.', 400, {
        video_id: videoId
      });
    }

    const generationTasks = await GenerationTask.findAll({
      where: {
        segmentId: segments.map((segment) => segment.id),
        status: 'completed'
      },
      order: [['createdAt', 'DESC']]
    });

    const latestCompletedTaskBySegmentId = new Map();
    generationTasks.forEach((task) => {
      if (!latestCompletedTaskBySegmentId.has(task.segmentId)) {
        latestCompletedTaskBySegmentId.set(task.segmentId, task);
      }
    });

    const mergeInputPaths = segments.map((segment) => {
      const latestTask = latestCompletedTaskBySegmentId.get(segment.id);

      if (latestTask?.resultUrl && !/^https?:\/\//i.test(latestTask.resultUrl)) {
        return resolveUploadPath(publicUrlToRelativePath(latestTask.resultUrl));
      }

      return resolveUploadPath(segment.filePath);
    });

    updateTask(taskId, {
      status: 'processing',
      progress: 35,
      message: 'Merging video outputs'
    });

    const mergedResult = await mergeVideos(mergeInputPaths, {
      basename: `video-${videoId}-merged`,
      onProgress: (progress) => {
        updateTask(taskId, {
          status: 'processing',
          progress: 35 + Math.round(progress * 0.6),
          message: 'Merging video outputs'
        });
      }
    });

    completeTask(
      taskId,
      {
        video_id: videoId,
        file_path: mergedResult.filePath,
        file_url: mergedResult.fileUrl,
        filename: path.basename(mergedResult.filePath)
      },
      'Merge completed'
    );
  } catch (error) {
    failTask(taskId, error.message);
  }
};

const startMerge = async ({ videoId }) => {
  await getVideoRecordById(videoId);

  const task = createTask({
    type: 'merge',
    meta: {
      videoId
    },
    message: 'Merge task queued'
  });

  queueMicrotask(() => {
    void processMergeTask(task.id, videoId);
  });

  return {
    task_id: task.id,
    status: task.status
  };
};

const getMergeTaskProgress = (taskId) => {
  const task = getTask(taskId);

  if (!task || task.type !== 'merge') {
    throw new AppError('Merge task not found.', 404, {
      task_id: taskId
    });
  }

  return {
    progress: task.progress,
    status: task.status,
    message: task.errorMessage || task.message
  };
};

const getMergeTaskDownload = (taskId) => {
  const task = getTask(taskId);

  if (!task || task.type !== 'merge') {
    throw new AppError('Merge task not found.', 404, {
      task_id: taskId
    });
  }

  if (task.status !== 'completed' || !task.result?.file_path) {
    throw new AppError('Merged video is not ready for download.', 409, {
      task_id: taskId,
      status: task.status
    });
  }

  return {
    absolutePath: resolveUploadPath(task.result.file_path),
    filename: task.result.filename
  };
};

export { startMerge, getMergeTaskProgress, getMergeTaskDownload };
