import { useEffect } from 'react';

import { uploadVideo } from '../services/api.js';
import { websocketService } from '../services/websocket.js';
import { useAnalysisStore } from '../store/analysisStore.js';
import { useGenerationStore } from '../store/generationStore.js';
import { useVideoStore } from '../store/videoStore.js';
import { formatBytes } from '../utils/formatBytes.js';
import { formatDuration } from '../utils/formatDuration.js';
import { getEnv } from '../utils/env.js';

const uploadLimit = Number(getEnv('VITE_UPLOAD_LIMIT', '524288000'));
const uploadDurationLimitSeconds = 600;
const allowedMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo']);
const allowedExtensions = ['.mp4', '.mov', '.avi'];

const collectKnownVideos = ({ currentVideo, videos }) => {
  const currentVideoEntry = currentVideo ? [currentVideo] : [];
  const knownVideos = [...currentVideoEntry, ...(videos ?? [])];
  const uniqueVideoMap = new Map();

  knownVideos.forEach((video) => {
    if (video?.id) {
      uniqueVideoMap.set(video.id, video);
      return;
    }

    uniqueVideoMap.set(`${video?.filename ?? 'unknown'}-${video?.file_size ?? video?.fileSize ?? 0}`, video);
  });

  return [...uniqueVideoMap.values()];
};

const getKnownVideoFileSize = (video) => {
  const comparableFileSize = Number(video?.file_size ?? video?.fileSize ?? 0);
  return Number.isFinite(comparableFileSize) && comparableFileSize > 0 ? comparableFileSize : 0;
};

const probeVideoDurationSeconds = async (file) => {
  if (
    typeof document === 'undefined' ||
    typeof window === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const durationSeconds = await new Promise((resolve) => {
      const videoElement = document.createElement('video');
      let settled = false;

      const finish = (duration) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        resolve(duration);
      };

      const timeoutId = window.setTimeout(() => {
        finish(null);
      }, 3000);

      videoElement.preload = 'metadata';
      videoElement.onloadedmetadata = () => {
        const nextDuration = Number(videoElement.duration);
        finish(Number.isFinite(nextDuration) && nextDuration > 0 ? nextDuration : null);
      };
      videoElement.onerror = () => {
        finish(null);
      };
      videoElement.src = objectUrl;
    });

    return durationSeconds;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const validateVideoFile = async (file, { currentVideo, videos } = {}) => {
  if (!file) {
    return '请先选择一个视频文件。';
  }

  const lowerCaseFileName = file.name.toLowerCase();
  const hasSupportedExtension = allowedExtensions.some((extension) =>
    lowerCaseFileName.endsWith(extension)
  );

  if (!hasSupportedExtension || (file.type && !allowedMimeTypes.has(file.type))) {
    return '仅支持 MP4、MOV、AVI 视频文件。';
  }

  if (file.size > uploadLimit) {
    return `文件大小不能超过 ${formatBytes(uploadLimit)}。`;
  }

  const knownVideos = collectKnownVideos({
    currentVideo,
    videos
  });
  const duplicateVideo = knownVideos.find((video) => {
    return video?.filename === file.name && getKnownVideoFileSize(video) === file.size;
  });

  if (duplicateVideo) {
    return '当前项目中已存在同名且大小一致的视频，请勿重复上传。';
  }

  const durationSeconds = await probeVideoDurationSeconds(file);

  if (durationSeconds && durationSeconds > uploadDurationLimitSeconds) {
    return `视频时长不能超过 ${formatDuration(uploadDurationLimitSeconds)}。`;
  }

  return '';
};

const useVideoUpload = () => {
  const currentVideo = useVideoStore((state) => state.currentVideo);
  const videos = useVideoStore((state) => state.videos);
  const uploadProgress = useVideoStore((state) => state.uploadProgress);
  const uploadStatus = useVideoStore((state) => state.uploadStatus);
  const uploadError = useVideoStore((state) => state.uploadError);
  const validationMessage = useVideoStore((state) => state.validationMessage);
  const uploadStartedAt = useVideoStore((state) => state.uploadStartedAt);
  const uploadCompletedAt = useVideoStore((state) => state.uploadCompletedAt);
  const addVideo = useVideoStore((state) => state.addVideo);
  const updateProgress = useVideoStore((state) => state.updateProgress);
  const setValidationMessage = useVideoStore((state) => state.setValidationMessage);
  const setUploadState = useVideoStore((state) => state.setUploadState);
  const resetAnalysisState = useAnalysisStore((state) => state.resetAnalysisState);
  const resetGenerationContext = useGenerationStore((state) => state.resetGenerationContext);

  useEffect(() => {
    return websocketService.subscribe('upload:progress', (payload) => {
      updateProgress(payload.progress ?? 0);

      if (payload.status) {
        setUploadState({
          uploadStatus: payload.status,
          uploadError: payload.errorMessage ?? '',
          uploadCompletedAt:
            ['completed', 'error', 'failed'].includes(payload.status)
              ? new Date().toISOString()
              : null
        });
      }
    });
  }, [setUploadState, updateProgress]);

  const uploadSelectedFile = async (file) => {
    const validationError = await validateVideoFile(file, {
      currentVideo,
      videos
    });

    if (validationError) {
      setUploadState({
        uploadStatus: 'error',
        uploadError: validationError,
        uploadProgress: 0,
        uploadCompletedAt: new Date().toISOString()
      });
      setValidationMessage(validationError);
      return null;
    }

    setValidationMessage(`校验通过，准备上传 ${file.name}`);
    setUploadState({
      uploadStatus: 'uploading',
      uploadError: '',
      uploadProgress: 0,
      uploadStartedAt: new Date().toISOString(),
      uploadCompletedAt: null
    });

    try {
      const video = await uploadVideo(file, {
        projectName: 'Fanshi Frontend Workspace',
        onUploadProgress: (event) => {
          const nextProgress = event.total
            ? Math.round((event.loaded / event.total) * 100)
            : uploadProgress;

          websocketService.emitLocal('upload:progress', {
            progress: nextProgress,
            status: 'uploading'
          });
        }
      });

      const activeCurrentVideo = useVideoStore.getState().currentVideo;

      if (!activeCurrentVideo || Number(activeCurrentVideo.id) !== Number(video.id)) {
        resetAnalysisState();
        resetGenerationContext();
      }

      addVideo(video);
      websocketService.emitLocal('upload:progress', {
        progress: 100,
        status: 'completed'
      });
      setValidationMessage(`上传完成，当前视频 ID：${video.id}`);
      return video;
    } catch (error) {
      setValidationMessage('上传失败，请稍后重试。');
      websocketService.emitLocal('upload:progress', {
        progress: 0,
        status: 'error',
        errorMessage: error.message
      });
      return null;
    }
  };

  return {
    currentVideo,
    videos,
    uploadProgress,
    uploadStatus,
    uploadError,
    validationMessage,
    uploadStartedAt,
    uploadCompletedAt,
    uploadSelectedFile,
    uploadLimit
  };
};

export { useVideoUpload };
