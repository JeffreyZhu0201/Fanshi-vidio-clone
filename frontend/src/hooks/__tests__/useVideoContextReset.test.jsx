import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('../../services/api.js', () => ({
  analyzeVideo: jest.fn(),
  getAnalysis: jest.fn(),
  getSegments: jest.fn(),
  getTaskStatus: jest.fn(),
  getVideo: jest.fn(),
  isTransientApiError: jest.fn(() => false),
  splitVideo: jest.fn(),
  toAbsoluteAssetUrl: jest.fn((value) => value),
  uploadVideo: jest.fn()
}));

jest.mock('../../services/websocket.js', () => {
  const listeners = new Map();

  const websocketService = {
    subscribe: jest.fn((eventType, listener) => {
      const eventListeners = listeners.get(eventType) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventType, eventListeners);

      return () => {
        eventListeners.delete(listener);
      };
    }),
    emitLocal: jest.fn((eventType, payload) => {
      const eventListeners = listeners.get(eventType);

      if (!eventListeners) {
        return;
      }

      [...eventListeners].forEach((listener) => {
        listener(payload);
      });
    }),
    __reset: () => {
      listeners.clear();
      websocketService.subscribe.mockClear();
      websocketService.emitLocal.mockClear();
    }
  };

  return {
    websocketService
  };
});

jest.mock('../../utils/env.js', () => ({
  getEnv: jest.fn((_, fallbackValue) => fallbackValue)
}));

import { useAnalysis } from '../useAnalysis.js';
import { useSegments } from '../useSegments.js';
import { useVideoUpload } from '../useVideoUpload.js';
import { getAnalysis, getSegments, uploadVideo } from '../../services/api.js';
import { websocketService } from '../../services/websocket.js';
import { useAnalysisStore } from '../../store/analysisStore.js';
import { generationSessionStorage, useGenerationStore } from '../../store/generationStore.js';
import { useVideoStore } from '../../store/videoStore.js';

const createDeferred = () => {
  let resolve;

  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve
  };
};

const oldVideo = {
  id: 1001,
  filename: 'old-video.mp4',
  status: 'analyzed'
};

const newVideo = {
  id: 1002,
  filename: 'new-video.mp4',
  status: 'uploaded'
};

const oldAnalysis = {
  id: 7001,
  video_id: oldVideo.id,
  plot: '旧视频剧情',
  characters: [{ id: 'hero', name: '旧主角' }],
  backgrounds: ['旧背景'],
  time_anchors: [{ startTime: 0, endTime: 3.2, sceneSummary: '旧镜头' }]
};

const oldSegments = [
  {
    id: 8001,
    segmentIndex: 0,
    startTime: 0,
    endTime: 3.2,
    sourceUrl: '/uploads/segments/source/old-0.mp4',
    generatedUrl: '/uploads/outputs/old-0.mp4',
    prompt: '@旧主角 继续前进',
    characters: ['旧主角'],
    highlightedPrompt: '@旧主角 继续前进',
    latestGenerationTask: {
      task_id: 'task-old-1',
      status: 'completed',
      progress: 100,
      result_url: '/uploads/outputs/old-0.mp4',
      error_message: ''
    },
    latestCompletedGenerationTask: {
      task_id: 'task-old-1',
      status: 'completed',
      progress: 100,
      result_url: '/uploads/outputs/old-0.mp4',
      error_message: ''
    }
  }
];

const resetStores = () => {
  window.sessionStorage.clear();

  useVideoStore.setState({
    currentVideo: null,
    videos: [],
    uploadProgress: 0,
    uploadStatus: 'idle',
    uploadError: '',
    validationMessage: '',
    uploadStartedAt: null,
    uploadCompletedAt: null
  });

  useAnalysisStore.setState({
    analysis: null,
    loading: false,
    error: '',
    progress: 0,
    status: 'idle',
    statusMessage: '等待分析',
    lastUpdatedAt: null
  });

  useGenerationStore.setState({
    segments: [],
    tasks: [],
    mergeProgress: {
      taskId: '',
      status: 'idle',
      progress: 0,
      message: '等待拼接',
      errorMessage: '',
      updatedAt: null
    },
    splitProgress: {
      taskId: '',
      status: 'idle',
      progress: 0,
      message: '等待分割',
      errorMessage: '',
      updatedAt: null
    },
    segmentsLoading: false,
    segmentsError: ''
  });
};

describe('video context reset', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    websocketService.__reset();
  });

  it('clears analysis and generation context immediately when currentVideo switches', async () => {
    const pendingOldAnalysis = createDeferred();
    const pendingNewAnalysis = createDeferred();
    const pendingOldSegments = createDeferred();
    const pendingNewSegments = createDeferred();

    getAnalysis.mockImplementation((videoId) => {
      if (Number(videoId) === Number(newVideo.id)) {
        return pendingNewAnalysis.promise;
      }

      return pendingOldAnalysis.promise;
    });

    getSegments.mockImplementation((videoId) => {
      if (Number(videoId) === Number(newVideo.id)) {
        return pendingNewSegments.promise;
      }

      return pendingOldSegments.promise;
    });

    generationSessionStorage.setSplitTaskId('split-task-old');
    generationSessionStorage.setMergeTaskId('merge-task-old');

    useVideoStore.setState({
      currentVideo: oldVideo
    });
    useAnalysisStore.setState({
      analysis: oldAnalysis,
      loading: false,
      error: '',
      progress: 100,
      status: 'completed',
      statusMessage: '旧视频分析完成',
      lastUpdatedAt: '2026-04-17T00:00:00.000Z'
    });
    useGenerationStore.setState({
      segments: oldSegments,
      tasks: [{ task_id: 'task-old-1', segment_id: 8001, status: 'completed' }],
      mergeProgress: {
        taskId: 'merge-task-old',
        status: 'completed',
        progress: 100,
        message: '旧拼接完成',
        errorMessage: '',
        updatedAt: '2026-04-17T00:01:00.000Z'
      },
      splitProgress: {
        taskId: 'split-task-old',
        status: 'completed',
        progress: 100,
        message: '旧分割完成',
        errorMessage: '',
        updatedAt: '2026-04-17T00:02:00.000Z'
      },
      segmentsLoading: false,
      segmentsError: ''
    });

    const { unmount: unmountAnalysis } = renderHook(() => useAnalysis());
    const { unmount: unmountSegments } = renderHook(() => useSegments());

    await waitFor(() => {
      expect(getAnalysis).toHaveBeenCalledWith(oldVideo.id);
    });

    await waitFor(() => {
      expect(getSegments).toHaveBeenCalledWith(oldVideo.id);
    });

    act(() => {
      useVideoStore.getState().setCurrentVideo(newVideo);
    });

    await waitFor(() => {
      expect(getAnalysis).toHaveBeenCalledWith(newVideo.id);
    });

    await waitFor(() => {
      expect(getSegments).toHaveBeenCalledWith(newVideo.id);
    });

    expect(useAnalysisStore.getState().analysis).toBeNull();
    expect(useGenerationStore.getState().segments).toEqual([]);
    expect(useGenerationStore.getState().tasks).toEqual([]);
    expect(useGenerationStore.getState().splitProgress.status).toBe('idle');
    expect(useGenerationStore.getState().mergeProgress.status).toBe('idle');
    expect(generationSessionStorage.getSplitTaskId()).toBe('');
    expect(generationSessionStorage.getMergeTaskId()).toBe('');

    unmountAnalysis();
    unmountSegments();
  });

  it('clears old context before hydrating the newly uploaded video', async () => {
    const pendingOldAnalysis = createDeferred();
    const pendingNewAnalysis = createDeferred();
    const pendingOldSegments = createDeferred();
    const pendingNewSegments = createDeferred();

    getAnalysis.mockImplementation((videoId) => {
      if (Number(videoId) === Number(newVideo.id)) {
        return pendingNewAnalysis.promise;
      }

      return pendingOldAnalysis.promise;
    });

    getSegments.mockImplementation((videoId) => {
      if (Number(videoId) === Number(newVideo.id)) {
        return pendingNewSegments.promise;
      }

      return pendingOldSegments.promise;
    });

    uploadVideo.mockResolvedValue(newVideo);

    useVideoStore.setState({
      currentVideo: oldVideo
    });
    useAnalysisStore.setState({
      analysis: oldAnalysis,
      loading: false,
      error: '',
      progress: 100,
      status: 'completed',
      statusMessage: '旧视频分析完成',
      lastUpdatedAt: '2026-04-17T00:00:00.000Z'
    });
    useGenerationStore.setState({
      segments: oldSegments,
      tasks: [{ task_id: 'task-old-1', segment_id: 8001, status: 'completed' }],
      mergeProgress: {
        taskId: 'merge-task-old',
        status: 'completed',
        progress: 100,
        message: '旧拼接完成',
        errorMessage: '',
        updatedAt: '2026-04-17T00:01:00.000Z'
      },
      splitProgress: {
        taskId: 'split-task-old',
        status: 'completed',
        progress: 100,
        message: '旧分割完成',
        errorMessage: '',
        updatedAt: '2026-04-17T00:02:00.000Z'
      },
      segmentsLoading: false,
      segmentsError: ''
    });

    const { result: uploadResult, unmount: unmountUpload } = renderHook(() => useVideoUpload());
    const { unmount: unmountAnalysis } = renderHook(() => useAnalysis());
    const { unmount: unmountSegments } = renderHook(() => useSegments());

    await waitFor(() => {
      expect(getAnalysis).toHaveBeenCalledWith(oldVideo.id);
    });

    await waitFor(() => {
      expect(getSegments).toHaveBeenCalledWith(oldVideo.id);
    });

    const file = new File(['demo'], 'new-video.mp4', {
      type: 'video/mp4'
    });

    let uploadedVideo;

    await act(async () => {
      uploadedVideo = await uploadResult.current.uploadSelectedFile(file);
    });

    expect(uploadedVideo).toEqual(newVideo);

    await waitFor(() => {
      expect(useVideoStore.getState().currentVideo?.id).toBe(newVideo.id);
    });

    await waitFor(() => {
      expect(getAnalysis).toHaveBeenCalledWith(newVideo.id);
    });

    await waitFor(() => {
      expect(getSegments).toHaveBeenCalledWith(newVideo.id);
    });

    expect(useAnalysisStore.getState().analysis).toBeNull();
    expect(useGenerationStore.getState().segments).toEqual([]);
    expect(useGenerationStore.getState().tasks).toEqual([]);
    expect(useGenerationStore.getState().splitProgress.status).toBe('idle');
    expect(useGenerationStore.getState().mergeProgress.status).toBe('idle');

    unmountUpload();
    unmountAnalysis();
    unmountSegments();
  });
});
