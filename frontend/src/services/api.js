import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 30000
});

api.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.message ||
      error.message ||
      'Unexpected error occurred while communicating with the API.';

    return Promise.reject(new Error(message));
  }
);

export const checkHealth = async () => {
  const response = await api.get('/health');
  return response.data;
};

export const uploadVideo = async (file) => {
  const formData = new FormData();
  formData.append('video', file);

  const response = await api.post('/videos/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });

  return response.data;
};

export const analyzeVideo = async (videoId) => {
  const response = await api.post('/analysis/analyze', { video_id: videoId });
  return response.data;
};

export const getAnalysis = async (videoId) => {
  const response = await api.get(`/analysis/${videoId}`);
  return response.data;
};

export const optimizePrompt = async (prompt, characters) => {
  const response = await api.post('/analysis/optimize-prompt', {
    prompt,
    characters
  });

  return response.data;
};

export const splitVideo = async (videoId, timeAnchors) => {
  const response = await api.post('/segments/split', {
    video_id: videoId,
    time_anchors: timeAnchors
  });

  return response.data;
};

export const getSegments = async (videoId) => {
  const response = await api.get(`/segments/${videoId}`);
  return response.data;
};

export const generateSegment = async (segmentId, prompt) => {
  const response = await api.post('/generation/generate', {
    segment_id: segmentId,
    prompt
  });

  return response.data;
};

export const mergeVideos = async (videoId) => {
  const response = await api.post('/merge/start', { video_id: videoId });
  return response.data;
};

export const getMergeProgress = async (taskId) => {
  const response = await api.get(`/merge/${taskId}/progress`);
  return response.data;
};

export const downloadVideo = async (taskId) => {
  const response = await api.get(`/merge/${taskId}/download`, {
    responseType: 'blob'
  });

  return response.data;
};

export default api;

