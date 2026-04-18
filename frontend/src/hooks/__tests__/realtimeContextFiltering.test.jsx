import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('../../services/api.js', () => ({
  analyzeSegment: jest.fn(),
  analyzeVideo: jest.fn(),
  downloadVideo: jest.fn(),
  generateSegment: jest.fn(),
  getAnalysis: jest.fn(),
  getGenerationTask: jest.fn(),
  getMergeProgress: jest.fn(),
  getSegments: jest.fn(),
  getTaskStatus: jest.fn(),
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

import { useAnalysis } from '../useAnalysis.js';
import { useGeneration } from '../useGeneration.js';
import { useSegments } from '../useSegments.js';
import {
  getAnalysis,
  getSegments
} from '../../services/api.js';
import { websocketService } from '../../services/websocket.js';
import { useAnalysisStore } from '../../store/analysisStore.js';
import { useGenerationStore } from '../../store/generationStore.js';
import { useVideoStore } from '../../store/videoStore.js';

const resetStores = () => {
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

describe('realtime context filtering', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    websocketService.__reset();
  });

  it('ignores analysis progress events from other videos', async () => {
    getAnalysis.mockRejectedValue(Object.assign(new Error('Not found'), { statusCode: 404 }));

    useVideoStore.setState({
      currentVideo: {
        id: 101,
        filename: 'current.mp4',
        status: 'analyzed'
      }
    });

    const { unmount } = renderHook(() => useAnalysis());

    await waitFor(() => {
      expect(getAnalysis).toHaveBeenCalledWith(101);
    });

    act(() => {
      websocketService.emitLocal('analysis:progress', {
        video_id: 999,
        progress: 76,
        status: 'processing',
        message: 'wrong video'
      });
    });

    expect(useAnalysisStore.getState().progress).toBe(0);
    expect(useAnalysisStore.getState().status).toBe('idle');

    act(() => {
      websocketService.emitLocal('analysis:progress', {
        video_id: 101,
        progress: 48,
        status: 'processing',
        message: 'current video'
      });
    });

    expect(useAnalysisStore.getState().progress).toBe(48);
    expect(useAnalysisStore.getState().status).toBe('processing');
    expect(useAnalysisStore.getState().statusMessage).toBe('current video');

    unmount();
  });

  it('ignores split progress events that do not match the active split task', async () => {
    getSegments.mockResolvedValue([]);

    useVideoStore.setState({
      currentVideo: {
        id: 201,
        filename: 'segments.mp4'
      }
    });

    const { unmount } = renderHook(() => useSegments());

    await waitFor(() => {
      expect(getSegments).toHaveBeenCalledWith(201);
    });

    act(() => {
      useGenerationStore.getState().beginSplitProgress({
        taskId: 'split-task-201',
        status: 'pending',
        progress: 0,
        message: 'queued'
      });
    });

    act(() => {
      websocketService.emitLocal('split:progress', {
        task_id: 'split-task-other',
        progress: 90,
        status: 'processing',
        message: 'other task'
      });
    });

    expect(useGenerationStore.getState().splitProgress.progress).toBe(0);
    expect(useGenerationStore.getState().splitProgress.message).toBe('queued');

    act(() => {
      websocketService.emitLocal('split:progress', {
        task_id: 'split-task-201',
        progress: 55,
        status: 'processing',
        message: 'current split'
      });
    });

    expect(useGenerationStore.getState().splitProgress.progress).toBe(55);
    expect(useGenerationStore.getState().splitProgress.status).toBe('processing');
    expect(useGenerationStore.getState().splitProgress.message).toBe('current split');

    unmount();
  });

  it('only applies generation and merge progress to tracked segments and active merge tasks', () => {
    useGenerationStore.setState({
      segments: [
        {
          id: 301,
          prompt: '@主角 继续向前',
          generatedUrl: '',
          latestGenerationTask: null
        }
      ],
      tasks: [],
      mergeProgress: {
        taskId: '',
        status: 'idle',
        progress: 0,
        message: '等待拼接',
        errorMessage: '',
        updatedAt: null
      }
    });

    const { unmount } = renderHook(() => useGeneration());

    act(() => {
      websocketService.emitLocal('generation:progress', {
        task_id: 7001,
        segment_id: 999,
        status: 'processing',
        progress: 30
      });
    });

    expect(useGenerationStore.getState().tasks).toHaveLength(0);
    expect(useGenerationStore.getState().segments[0].latestGenerationTask).toBeNull();

    act(() => {
      websocketService.emitLocal('generation:progress', {
        task_id: 7002,
        segment_id: 301,
        status: 'processing',
        progress: 44,
        result_url: '/uploads/generated/segment-301.mp4'
      });
    });

    expect(useGenerationStore.getState().tasks).toHaveLength(1);
    expect(useGenerationStore.getState().tasks[0].task_id).toBe(7002);
    expect(useGenerationStore.getState().segments[0].latestGenerationTask).toMatchObject({
      task_id: 7002,
      progress: 44,
      status: 'processing'
    });

    act(() => {
      useGenerationStore.getState().beginMergeProgress({
        taskId: 'merge-task-301',
        status: 'pending',
        progress: 0,
        message: 'merge queued'
      });
    });

    act(() => {
      websocketService.emitLocal('merge:progress', {
        task_id: 'merge-task-other',
        status: 'processing',
        progress: 82,
        message: 'wrong merge'
      });
    });

    expect(useGenerationStore.getState().mergeProgress.progress).toBe(0);
    expect(useGenerationStore.getState().mergeProgress.message).toBe('merge queued');

    act(() => {
      websocketService.emitLocal('merge:progress', {
        task_id: 'merge-task-301',
        status: 'processing',
        progress: 67,
        message: 'current merge'
      });
    });

    expect(useGenerationStore.getState().mergeProgress.progress).toBe(67);
    expect(useGenerationStore.getState().mergeProgress.message).toBe('current merge');
    expect(useGenerationStore.getState().mergeProgress.status).toBe('processing');

    unmount();
  });
});
