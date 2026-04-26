import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { GenerationTask, Segment, ShotGenerationTask } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { completeTask, createTask, failTask, getTask, updateTask } from './taskService.js';
import {
  createOutputRelativePath,
  ensureParentDirectory,
  publicUrlToRelativePath,
  resolveUploadPath,
  toPublicUploadUrl
} from './fileService.js';
import { getVideoMetadata } from './ffmpegService.js';
import { getVideoRecordById } from './videoService.js';

const execFileAsync = promisify(execFile);

const isTaskMarkedMock = (task) => {
  const taskMeta = task?.meta ?? {};
  const engine = String(taskMeta.engine ?? '').trim().toLowerCase();
  const fallbackReason = String(taskMeta.fallbackReason ?? '').trim().toLowerCase();

  return (
    Boolean(taskMeta.isMock) ||
    engine.includes('mock') ||
    fallbackReason.includes('remote_generation_failed') ||
    fallbackReason.includes('missing_remote_config')
  );
};

const isUsableCompletedGenerationTask = (task) => {
  return Boolean(task?.status === 'completed' && task?.resultUrl && !isTaskMarkedMock(task));
};

const normalizeDurationValue = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? Number(parsedValue.toFixed(2)) : null;
};

const resolveTaskActualDurationSeconds = async (task) => {
  const taskMeta = task?.meta ?? {};
  const metaDuration =
    normalizeDurationValue(taskMeta.actualDurationSeconds ?? taskMeta.actual_duration_seconds) ?? null;

  if (metaDuration !== null) {
    return metaDuration;
  }

  if (!task?.resultUrl || /^https?:\/\//iu.test(String(task.resultUrl).trim())) {
    return null;
  }

  const metadata = await getVideoMetadata(resolveUploadPath(publicUrlToRelativePath(task.resultUrl)));
  return normalizeDurationValue(metadata?.durationSecondsExact ?? metadata?.duration);
};

const formatSegmentLabel = (segmentIndex) => String(Number(segmentIndex ?? 0) + 1).padStart(2, '0');

const formatShotLabel = (shotIndex) => String(Number(shotIndex ?? 0) + 1).padStart(2, '0');

const createZipArchive = async ({ sourceDirectory, absoluteZipPath }) => {
  await ensureParentDirectory(absoluteZipPath);

  try {
    await execFileAsync('zip', ['-qr', absoluteZipPath, '.'], {
      cwd: sourceDirectory
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('当前环境缺少 zip 命令，无法生成片段压缩包。');
    }

    throw error;
  }
};

const processSegmentExportTask = async (taskId, videoId) => {
  let tempDirectory = '';

  try {
    updateTask(taskId, {
      status: 'processing',
      progress: 5,
      message: '正在收集大片段和小镜头结果'
    });

    await getVideoRecordById(videoId);

    const segments = await Segment.findAll({
      where: {
        videoId
      },
      order: [['segmentIndex', 'ASC']]
    });

    if (!segments.length) {
      throw new AppError('当前视频还没有片段，无法导出片段压缩包。', 400, {
        video_id: videoId
      });
    }

    const segmentIds = segments.map((segment) => segment.id);
    const generationTasks = await GenerationTask.findAll({
      where: {
        segmentId: segmentIds,
        status: 'completed'
      },
      order: [['createdAt', 'DESC']]
    });
    const shotTasks = await ShotGenerationTask.findAll({
      where: {
        segmentId: segmentIds,
        status: 'completed'
      },
      order: [['createdAt', 'DESC']]
    });

    const latestCompletedSegmentTaskBySegmentId = new Map();
    generationTasks.forEach((generationTask) => {
      if (
        isUsableCompletedGenerationTask(generationTask) &&
        !latestCompletedSegmentTaskBySegmentId.has(generationTask.segmentId)
      ) {
        latestCompletedSegmentTaskBySegmentId.set(generationTask.segmentId, generationTask);
      }
    });

    const latestCompletedShotTaskBySegmentId = new Map();
    shotTasks.forEach((shotTask) => {
      if (!isUsableCompletedGenerationTask(shotTask)) {
        return;
      }

      const segmentShotTaskMap = latestCompletedShotTaskBySegmentId.get(shotTask.segmentId) ?? new Map();

      if (!segmentShotTaskMap.has(String(shotTask.shotId ?? '').trim())) {
        segmentShotTaskMap.set(String(shotTask.shotId ?? '').trim(), shotTask);
        latestCompletedShotTaskBySegmentId.set(shotTask.segmentId, segmentShotTaskMap);
      }
    });

    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'fanshi-segment-export-'));
    const segmentsDirectory = path.join(tempDirectory, 'segments');
    const shotsDirectory = path.join(tempDirectory, 'shots');
    await mkdir(segmentsDirectory, { recursive: true });
    await mkdir(shotsDirectory, { recursive: true });

    const manifest = {
      video_id: Number(videoId),
      exported_at: new Date().toISOString(),
      segments: [],
      shots: [],
      missing: []
    };
    let exportedFileCount = 0;
    let processedEntryCount = 0;
    const totalEntryCount =
      segments.length +
      segments.reduce((totalCount, segment) => {
        return totalCount + (Array.isArray(segment.analysis?.shots) ? segment.analysis.shots.length : 0);
      }, 0);

    for (const segment of segments) {
      const segmentLabel = formatSegmentLabel(segment.segmentIndex);
      const segmentTask = latestCompletedSegmentTaskBySegmentId.get(segment.id) ?? null;

      if (segmentTask?.resultUrl && !/^https?:\/\//iu.test(String(segmentTask.resultUrl).trim())) {
        const sourceRelativePath = publicUrlToRelativePath(segmentTask.resultUrl);
        const extension = path.extname(sourceRelativePath) || '.mp4';
        const filename = `segment-${segmentLabel}${extension}`;
        await copyFile(resolveUploadPath(sourceRelativePath), path.join(segmentsDirectory, filename));
        manifest.segments.push({
          filename: `segments/${filename}`,
          segment_id: segment.id,
          segment_index: Number(segment.segmentIndex ?? 0),
          task_id: segmentTask.id,
          source_type: String(segmentTask.meta?.source ?? 'segment_generation').trim() || 'segment_generation',
          actual_duration_seconds: await resolveTaskActualDurationSeconds(segmentTask)
        });
        exportedFileCount += 1;
      } else {
        manifest.missing.push({
          scope: 'segment',
          segment_id: segment.id,
          segment_index: Number(segment.segmentIndex ?? 0),
          reason: 'missing_real_segment_result'
        });
      }

      processedEntryCount += 1;
      updateTask(taskId, {
        status: 'processing',
        progress: Math.min(70, 5 + Math.round((processedEntryCount / Math.max(totalEntryCount, 1)) * 65)),
        message: '正在整理大片段结果'
      });

      const rawShots = Array.isArray(segment.analysis?.shots) ? segment.analysis.shots : [];
      const orderedShots = rawShots
        .map((shot, shotIndex) => ({
          ...shot,
          shotIndex: Number(shot.shotIndex ?? shot.shot_index ?? shotIndex) || shotIndex
        }))
        .sort((left, right) => left.shotIndex - right.shotIndex);
      const segmentShotsDirectory = path.join(shotsDirectory, `segment-${segmentLabel}`);
      await mkdir(segmentShotsDirectory, { recursive: true });
      const latestShotTaskByShotId = latestCompletedShotTaskBySegmentId.get(segment.id) ?? new Map();

      for (const shot of orderedShots) {
        const shotId = String(shot.id ?? '').trim();
        const shotLabel = formatShotLabel(shot.shotIndex);
        const shotTask = latestShotTaskByShotId.get(shotId) ?? null;

        if (shotTask?.resultUrl && !/^https?:\/\//iu.test(String(shotTask.resultUrl).trim())) {
          const sourceRelativePath = publicUrlToRelativePath(shotTask.resultUrl);
          const extension = path.extname(sourceRelativePath) || '.mp4';
          const filename = `shot-${shotLabel}${extension}`;
          await copyFile(resolveUploadPath(sourceRelativePath), path.join(segmentShotsDirectory, filename));
          manifest.shots.push({
            filename: `shots/segment-${segmentLabel}/${filename}`,
            segment_id: segment.id,
            segment_index: Number(segment.segmentIndex ?? 0),
            shot_id: shotId,
            shot_index: Number(shot.shotIndex ?? 0),
            task_id: shotTask.id,
            source_type: String(shotTask.meta?.source ?? 'shot_generation').trim() || 'shot_generation',
            actual_duration_seconds: await resolveTaskActualDurationSeconds(shotTask)
          });
          exportedFileCount += 1;
        } else {
          manifest.missing.push({
            scope: 'shot',
            segment_id: segment.id,
            segment_index: Number(segment.segmentIndex ?? 0),
            shot_id: shotId,
            shot_index: Number(shot.shotIndex ?? 0),
            reason: 'missing_real_shot_result'
          });
        }

        processedEntryCount += 1;
        updateTask(taskId, {
          status: 'processing',
          progress: Math.min(70, 5 + Math.round((processedEntryCount / Math.max(totalEntryCount, 1)) * 65)),
          message: '正在整理小镜头结果'
        });
      }
    }

    if (!exportedFileCount) {
      throw new AppError('当前没有任何真实生成结果可导出，请先完成至少一个大片段或小镜头生成。', 409, {
        video_id: videoId
      });
    }

    await writeFile(path.join(tempDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    updateTask(taskId, {
      status: 'processing',
      progress: 82,
      message: '正在打包导出压缩包'
    });

    const relativeZipPath = createOutputRelativePath('exports', `video-${videoId}-segments-export`, '.zip');
    const absoluteZipPath = resolveUploadPath(relativeZipPath);
    await createZipArchive({
      sourceDirectory: tempDirectory,
      absoluteZipPath
    });

    completeTask(
      taskId,
      {
        video_id: videoId,
        file_path: relativeZipPath,
        file_url: toPublicUploadUrl(relativeZipPath),
        filename: path.basename(relativeZipPath),
        manifest
      },
      'Segment export completed'
    );
  } catch (error) {
    failTask(taskId, error.message);
  } finally {
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }
};

const startSegmentExport = async ({ videoId }) => {
  await getVideoRecordById(videoId);

  const task = createTask({
    type: 'segment_export',
    meta: {
      videoId
    },
    message: 'Segment export task queued'
  });

  queueMicrotask(() => {
    void processSegmentExportTask(task.id, videoId);
  });

  return {
    task_id: task.id,
    status: task.status
  };
};

const getSegmentExportProgress = (taskId) => {
  const task = getTask(taskId);

  if (!task || task.type !== 'segment_export') {
    throw new AppError('Segment export task not found.', 404, {
      task_id: taskId
    });
  }

  return {
    progress: task.progress,
    status: task.status,
    message: task.errorMessage || task.message
  };
};

const getSegmentExportDownload = (taskId) => {
  const task = getTask(taskId);

  if (!task || task.type !== 'segment_export') {
    throw new AppError('Segment export task not found.', 404, {
      task_id: taskId
    });
  }

  if (task.status !== 'completed' || !task.result?.file_path) {
    throw new AppError('Segment export archive is not ready for download.', 409, {
      task_id: taskId,
      status: task.status
    });
  }

  return {
    absolutePath: resolveUploadPath(task.result.file_path),
    filename: task.result.filename
  };
};

export { startSegmentExport, getSegmentExportProgress, getSegmentExportDownload };
