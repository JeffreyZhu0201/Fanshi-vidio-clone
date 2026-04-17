import axios from 'axios';

import { getEnv } from '../utils/env.js';

const API_BASE_URL = getEnv('VITE_API_BASE_URL', 'http://localhost:5000/api');
const API_TIMEOUT = Number(getEnv('VITE_API_TIMEOUT', '30000'));
const MAX_RETRIES = 3;
const RETRYABLE_METHODS = new Set(['get', 'head', 'options']);
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const resolveRuntimeOrigin = () => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'http://localhost:5173';
};

const API_ORIGIN = new URL(API_BASE_URL, resolveRuntimeOrigin()).origin;

const createApiError = (error) => {
  const message =
    error.response?.data?.message ||
    error.response?.data?.error ||
    (error.code === 'ECONNABORTED'
      ? '请求超时，请稍后重试。'
      : '当前无法连接到服务端，请检查网络或后端服务状态。');

  const normalizedError = new Error(message);
  normalizedError.code = error.code ?? '';
  normalizedError.statusCode = error.response?.status ?? 0;
  normalizedError.details = error.response?.data?.details ?? null;
  normalizedError.isTimeout = error.code === 'ECONNABORTED';
  normalizedError.isNetworkError = !error.response;
  normalizedError.originalError = error;

  return normalizedError;
};

const isTransientApiError = (error) => {
  return Boolean(error?.isTimeout || error?.isNetworkError || error?.statusCode === 0);
};

const shouldRetry = (error) => {
  const method = error.config?.method?.toLowerCase?.() ?? 'get';
  const retryCount = error.config?.__retryCount ?? 0;

  if (retryCount >= MAX_RETRIES) {
    return false;
  }

  if (!RETRYABLE_METHODS.has(method)) {
    return false;
  }

  if (!error.response) {
    return true;
  }

  return RETRYABLE_STATUS_CODES.has(error.response.status);
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT
});

api.interceptors.request.use(
  (config) => {
    const nextConfig = {
      ...config,
      headers: {
        Accept: 'application/json',
        ...config.headers
      }
    };

    return nextConfig;
  },
  (error) => Promise.reject(createApiError(error))
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (shouldRetry(error)) {
      const nextRetryCount = (error.config.__retryCount ?? 0) + 1;

      error.config.__retryCount = nextRetryCount;

      await new Promise((resolve) => {
        window.setTimeout(resolve, nextRetryCount * 350);
      });

      return api(error.config);
    }

    return Promise.reject(createApiError(error));
  }
);

const parseDownloadFilename = (contentDisposition = '') => {
  const matchedFilename = contentDisposition.match(/filename="?([^"]+)"?/i);
  return matchedFilename?.[1] ?? 'fanshi-output.mp4';
};

const toAbsoluteAssetUrl = (assetPath) => {
  if (!assetPath) {
    return '';
  }

  if (/^(blob:|data:|https?:\/\/)/i.test(assetPath)) {
    return assetPath;
  }

  return new URL(assetPath.startsWith('/') ? assetPath : `/${assetPath}`, API_ORIGIN).toString();
};

const checkHealth = async () => {
  const response = await api.get('/health');
  return response.data;
};

const uploadVideo = async (file, options = {}) => {
  const formData = new FormData();
  formData.append('video', file);

  if (options.projectName) {
    formData.append('project_name', options.projectName);
  }

  const response = await api.post('/videos/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    },
    onUploadProgress: options.onUploadProgress
  });

  return response.data;
};

const analyzeVideo = async (videoId) => {
  const response = await api.post('/analysis/analyze', { video_id: videoId });
  return response.data;
};

const getAnalysis = async (videoId) => {
  const response = await api.get(`/analysis/${videoId}`);
  return response.data;
};

const getVideo = async (videoId) => {
  const response = await api.get(`/videos/${videoId}`);
  return response.data;
};

const optimizePrompt = async (prompt, characters = []) => {
  const response = await api.post('/analysis/optimize-prompt', {
    prompt,
    characters
  });

  return response.data;
};

const splitVideo = async (videoId, timeAnchors) => {
  const response = await api.post('/segments/split', {
    video_id: videoId,
    time_anchors: timeAnchors
  });

  return response.data;
};

const getSegments = async (videoId) => {
  const response = await api.get(`/segments/${videoId}`);
  return response.data;
};

const getTaskStatus = async (taskId) => {
  const response = await api.get(`/tasks/${taskId}`);
  return response.data;
};

const generateSegment = async (segmentId, prompt) => {
  const response = await api.post('/generation/generate', {
    segment_id: segmentId,
    prompt
  });

  return response.data;
};

const getGenerationTask = async (taskId) => {
  const response = await api.get(`/generation/${taskId}`);
  return response.data;
};

const mergeVideos = async (videoId) => {
  const response = await api.post('/merge/start', { video_id: videoId });
  return response.data;
};

const getMergeProgress = async (taskId) => {
  const response = await api.get(`/merge/${taskId}/progress`);
  return response.data;
};

const downloadVideo = async (taskId) => {
  const response = await api.get(`/merge/${taskId}/download`, {
    responseType: 'blob'
  });

  return {
    blob: response.data,
    filename: parseDownloadFilename(response.headers['content-disposition'])
  };
};

export {
  API_BASE_URL,
  API_ORIGIN,
  analyzeVideo,
  checkHealth,
  downloadVideo,
  generateSegment,
  getAnalysis,
  getGenerationTask,
  getMergeProgress,
  getSegments,
  getTaskStatus,
  getVideo,
  isTransientApiError,
  mergeVideos,
  optimizePrompt,
  splitVideo,
  toAbsoluteAssetUrl,
  uploadVideo
};

export default api;
