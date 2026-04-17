import { renderHook, waitFor } from '@testing-library/react';

jest.mock('../../services/api.js', () => ({
  analyzeSegment: jest.fn(),
  downloadVideo: jest.fn(),
  generateSegment: jest.fn(),
  getGenerationTask: jest.fn(),
  getMergeProgress: jest.fn(),
  getSegments: jest.fn(),
  getTaskStatus: jest.fn(),
  getVideo: jest.fn(),
  mergeVideos: jest.fn(),
  optimizePrompt: jest.fn(),
  splitVideo: jest.fn(),
  toAbsoluteAssetUrl: jest.fn((value) => value)
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

jest.mock('../../utils/browserDownload.js', () => ({
  downloadBlobInBrowser: jest.fn()
}));

import { useGeneration } from '../useGeneration.js';
import { useSegments } from '../useSegments.js';
import { getMergeProgress, getSegments, getTaskStatus, getVideo } from '../../services/api.js';
import { useAnalysisStore } from '../../store/analysisStore.js';
import { generationSessionStorage, useGenerationStore } from '../../store/generationStore.js';
import { useVideoStore, videoSessionStorage } from '../../store/videoStore.js';
import { websocketService } from '../../services/websocket.js';

const videoPayload = {
  id: 701,
  filename: 'refresh-restore.mp4',
  duration: 12,
  status: 'uploaded',
  project_id: 91,
  file_path: 'videos/refresh-restore.mp4',
  file_url: '/uploads/videos/refresh-restore.mp4',
  file_size: 1024
};

const segmentPayload = [
  {
    id: 801,
    segment_index: 0,
    start_time: 0,
    end_time: 4,
    file_path: 'segments/source/segment-0.mp4',
    file_url: '/uploads/segments/source/segment-0.mp4',
    analysis: {
      scene: '主角进入房间',
      action: '推门进入',
      prompt: '@主角 推门进入房间',
      characters: ['主角']
    },
    latest_generation_task: null
  }
];

const createNotFoundError = (message) =>
  Object.assign(new Error(message), {
    statusCode: 404
  });

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

describe('refresh recovery', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    websocketService.__reset();
  });

  it('restores current video and completed split progress after a page refresh', async () => {
    videoSessionStorage.setCurrentVideoId(videoPayload.id);
    generationSessionStorage.setSplitTaskId('split-task-701');

    getVideo.mockResolvedValue(videoPayload);
    getSegments.mockResolvedValue(segmentPayload);
    getTaskStatus.mockResolvedValue({
      task_id: 'split-task-701',
      type: 'split',
      status: 'completed',
      progress: 100,
      message: '视频分割完成'
    });

    const { unmount } = renderHook(() => useSegments());

    await waitFor(() => {
      expect(getVideo).toHaveBeenCalledWith(videoPayload.id);
    });

    await waitFor(() => {
      expect(useVideoStore.getState().currentVideo?.id).toBe(videoPayload.id);
    });

    await waitFor(() => {
      expect(getTaskStatus).toHaveBeenCalledWith('split-task-701');
    });

    await waitFor(() => {
      expect(useGenerationStore.getState().splitProgress.status).toBe('completed');
    });

    await waitFor(() => {
      expect(getSegments.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(useGenerationStore.getState().segments).toHaveLength(1);
    expect(useGenerationStore.getState().segments[0].id).toBe(801);

    unmount();
  });

  it('clears stale persisted refresh context when the saved video cannot be restored', async () => {
    videoSessionStorage.setCurrentVideoId(9999);
    generationSessionStorage.setSplitTaskId('split-task-stale');
    generationSessionStorage.setMergeTaskId('merge-task-stale');

    getVideo.mockRejectedValue(createNotFoundError('Video not found.'));

    const { unmount } = renderHook(() => useSegments());

    await waitFor(() => {
      expect(getVideo).toHaveBeenCalledWith(9999);
    });

    await waitFor(() => {
      expect(videoSessionStorage.getCurrentVideoId()).toBeNull();
    });

    expect(generationSessionStorage.getSplitTaskId()).toBe('');
    expect(generationSessionStorage.getMergeTaskId()).toBe('');
    expect(useVideoStore.getState().currentVideo).toBeNull();
    expect(useGenerationStore.getState().splitProgress.status).toBe('idle');

    unmount();
  });

  it('restores merge progress after refresh and preserves the completed download state', async () => {
    useVideoStore.setState({
      currentVideo: videoPayload
    });
    generationSessionStorage.setMergeTaskId('merge-task-701');

    getMergeProgress.mockResolvedValue({
      status: 'completed',
      progress: 100,
      message: '拼接完成'
    });

    const { result, unmount } = renderHook(() => useGeneration());

    await waitFor(() => {
      expect(getMergeProgress).toHaveBeenCalledWith('merge-task-701');
    });

    await waitFor(() => {
      expect(useGenerationStore.getState().mergeProgress.status).toBe('completed');
    });

    expect(result.current.mergeProgress.taskId).toBe('merge-task-701');
    expect(result.current.mergeProgress.progress).toBe(100);
    expect(generationSessionStorage.getMergeTaskId()).toBe('merge-task-701');

    unmount();
  });
});
