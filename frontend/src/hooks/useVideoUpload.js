import { useEffect } from 'react';

import { uploadVideo } from '../services/api.js';
import { websocketService } from '../services/websocket.js';
import { useVideoStore } from '../store/videoStore.js';
import { formatBytes } from '../utils/formatBytes.js';
import { getEnv } from '../utils/env.js';

const uploadLimit = Number(getEnv('VITE_UPLOAD_LIMIT', '524288000'));
const allowedMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo']);
const allowedExtensions = ['.mp4', '.mov', '.avi'];

const validateVideoFile = (file) => {
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
    const validationError = validateVideoFile(file);

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
