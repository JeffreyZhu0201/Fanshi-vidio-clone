import { Project, Segment, Video, GenerationTask } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { VIDEO_DURATION_LIMIT_SECONDS, VIDEO_STATUS } from '../config/constants.js';
import { getVideoMetadata } from './ffmpegService.js';
import {
  removeFileIfExists,
  resolveUploadPath,
  toPublicUploadUrl,
  toRelativeUploadPath
} from './fileService.js';

const buildDefaultProjectName = (filename) => {
  const baseName = filename.replace(/\.[^.]+$/, '');
  return `Imported Project - ${baseName}`;
};

const createDurationLimitErrorMessage = () => {
  const durationMinutes = Math.floor(VIDEO_DURATION_LIMIT_SECONDS / 60);
  return `视频时长不能超过 ${durationMinutes} 分钟。`;
};

const createInvalidUploadMetadataErrorMessage = () => {
  return '无法解析视频元数据，请确认文件未损坏且为有效的视频文件。';
};

const serializeVideo = (video, { metadata = null } = {}) => ({
  id: video.id,
  filename: video.filename,
  duration: video.duration,
  status: video.status,
  project_id: video.projectId,
  file_path: video.filePath,
  file_url: toPublicUploadUrl(video.filePath),
  file_size: video.fileSize,
  metadata
});

const getComparableDurationSeconds = (metadata = {}) => {
  const exactDurationSeconds = Number(metadata.durationSecondsExact);

  if (Number.isFinite(exactDurationSeconds) && exactDurationSeconds > 0) {
    return exactDurationSeconds;
  }

  const roundedDurationSeconds = Number(metadata.duration);
  return Number.isFinite(roundedDurationSeconds) && roundedDurationSeconds > 0 ? roundedDurationSeconds : null;
};

const ensureUploadDurationWithinLimit = (metadata = {}) => {
  const comparableDurationSeconds = getComparableDurationSeconds(metadata);

  if (comparableDurationSeconds && comparableDurationSeconds > VIDEO_DURATION_LIMIT_SECONDS) {
    throw new AppError(createDurationLimitErrorMessage(), 400, {
      duration_seconds: comparableDurationSeconds,
      limit_seconds: VIDEO_DURATION_LIMIT_SECONDS
    });
  }
};

const ensureUploadMetadataIsValid = (metadata = {}) => {
  const comparableDurationSeconds = getComparableDurationSeconds(metadata);
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const codec = typeof metadata.codec === 'string' ? metadata.codec.trim() : '';
  const hasVisualTrackShape = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const hasProbeBackedDuration = Number.isFinite(comparableDurationSeconds) && comparableDurationSeconds > 0;

  if (hasProbeBackedDuration && (hasVisualTrackShape || codec)) {
    return;
  }

  throw new AppError(createInvalidUploadMetadataErrorMessage(), 400, {
    engine: metadata.engine ?? null,
    duration: metadata.duration ?? null,
    duration_seconds_exact: metadata.durationSecondsExact ?? null,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    codec: metadata.codec ?? null
  });
};

const ensureProject = async ({ projectId, projectName, filename }) => {
  if (projectId) {
    const project = await Project.findByPk(projectId);

    if (!project) {
      throw new AppError('Project not found.', 404, {
        project_id: projectId
      });
    }

    return project;
  }

  return Project.create({
    name: projectName || buildDefaultProjectName(filename),
    description: 'Automatically created during video upload.',
    status: 'draft'
  });
};

const createVideoFromUpload = async ({ file, projectId, projectName }) => {
  if (!file) {
    throw new AppError('Video file is required.', 400);
  }

  let shouldCleanupUploadedFile = true;

  try {
    const metadata = await getVideoMetadata(file.path);
    ensureUploadMetadataIsValid(metadata);
    ensureUploadDurationWithinLimit(metadata);

    const project = await ensureProject({
      projectId,
      projectName,
      filename: file.originalname
    });

    const video = await Video.create({
      projectId: project.id,
      filename: file.originalname,
      filePath: toRelativeUploadPath(file.path),
      duration: metadata.duration,
      fileSize: file.size,
      status: VIDEO_STATUS.uploaded
    });

    shouldCleanupUploadedFile = false;
    return serializeVideo(video, { metadata });
  } catch (error) {
    if (shouldCleanupUploadedFile) {
      await removeFileIfExists(file.path);
    }

    throw error;
  }
};

const getVideoById = async (videoId) => {
  const video = await Video.findByPk(videoId);

  if (!video) {
    throw new AppError('Video not found.', 404, {
      video_id: videoId
    });
  }

  return serializeVideo(video);
};

const getVideoRecordById = async (videoId, options = {}) => {
  const video = await Video.findByPk(videoId, options);

  if (!video) {
    throw new AppError('Video not found.', 404, {
      video_id: videoId
    });
  }

  return video;
};

const resolveVideoAbsolutePath = (video) => {
  return resolveUploadPath(video.filePath);
};

const deleteVideoById = async (videoId) => {
  const video = await Video.findByPk(videoId, {
    include: [
      {
        model: Segment,
        as: 'segments',
        include: [
          {
            model: GenerationTask,
            as: 'generationTasks'
          }
        ]
      }
    ]
  });

  if (!video) {
    throw new AppError('Video not found.', 404, {
      video_id: videoId
    });
  }

  await removeFileIfExists(video.filePath);

  for (const segment of video.segments ?? []) {
    await removeFileIfExists(segment.filePath);

    for (const task of segment.generationTasks ?? []) {
      if (task.resultUrl && !/^https?:\/\//i.test(task.resultUrl)) {
        await removeFileIfExists(task.resultUrl);
      }
    }
  }

  await video.destroy();

  return {
    success: true
  };
};

export {
  createVideoFromUpload,
  getVideoById,
  getVideoRecordById,
  resolveVideoAbsolutePath,
  deleteVideoById
};
