import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('../../services/api.js', () => ({
  checkHealth: jest.fn(),
  getSegments: jest.fn(),
  getTaskStatus: jest.fn(),
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

import { useAppHealth } from '../useAppHealth.js';
import { useSegments } from '../useSegments.js';
import { checkHealth, getSegments, getTaskStatus } from '../../services/api.js';
import { websocketService } from '../../services/websocket.js';
import { useAppStore } from '../../store/appStore.js';
import { generationSessionStorage, useGenerationStore } from '../../store/generationStore.js';
import { useAnalysisStore } from '../../store/analysisStore.js';
import { useVideoStore } from '../../store/videoStore.js';

const videoPayload = {
  id: 901,
  filename: 'contract-check.mp4',
  status: 'analyzed'
};

const resetAppStore = () => {
  useAppStore.setState({
    backendStatus: 'checking',
    errorMessage: '',
    lastCheckedAt: null,
    realtimeStatus: 'idle',
    providerStatuses: {
      seedance: {
        ready: false,
        reason: '',
        allowMockFallback: false,
        model: ''
      },
      geminiImage: {
        ready: false,
        reason: '',
        model: ''
      }
    }
  });
};

const resetFlowStores = () => {
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

describe('health and error contract alignment', () => {
  beforeEach(() => {
    resetAppStore();
    resetFlowStores();
    jest.clearAllMocks();
    websocketService.__reset();
  });

  it('maps a healthy backend response to online', async () => {
    checkHealth.mockResolvedValue({
      success: true,
      status: 'ok',
      database: {
        connected: true
      },
      providers: {
        seedance: {
          ready: false,
          reason: '缺少 SEED_DANCE_API_KEY',
          allow_mock_fallback: false,
          model: 'doubao-seedance-2-0-260128'
        },
        gemini_image: {
          ready: true,
          reason: '',
          model: 'gemini-3-pro-image-preview'
        }
      }
    });

    const { unmount } = renderHook(() => useAppHealth());

    await waitFor(() => {
      expect(useAppStore.getState().backendStatus).toBe('online');
    });

    expect(useAppStore.getState().errorMessage).toBe('');
    expect(useAppStore.getState().providerStatuses.seedance.reason).toBe('缺少 SEED_DANCE_API_KEY');
    expect(useAppStore.getState().providerStatuses.geminiImage.ready).toBe(true);

    unmount();
  });

  it('maps a degraded backend response to degraded and keeps the database error detail', async () => {
    checkHealth.mockResolvedValue({
      success: true,
      status: 'degraded',
      database: {
        connected: false,
        errorMessage: 'connect ECONNREFUSED 127.0.0.1:3306'
      }
    });

    const { unmount } = renderHook(() => useAppHealth());

    await waitFor(() => {
      expect(useAppStore.getState().backendStatus).toBe('degraded');
    });

    expect(useAppStore.getState().errorMessage).toBe('connect ECONNREFUSED 127.0.0.1:3306');

    unmount();
  });

  it('marks the backend as offline when the health request fails', async () => {
    checkHealth.mockRejectedValue(new Error('health request failed'));

    const { unmount } = renderHook(() => useAppHealth());

    await waitFor(() => {
      expect(useAppStore.getState().backendStatus).toBe('offline');
    });

    expect(useAppStore.getState().errorMessage).toBe('health request failed');

    unmount();
  });

  it('restores split failures from task polling even when the backend only returns message', async () => {
    useVideoStore.setState({
      currentVideo: videoPayload
    });
    generationSessionStorage.setSplitTaskId('split-task-901');
    getSegments.mockResolvedValue([]);
    getTaskStatus.mockResolvedValue({
      task_id: 'split-task-901',
      type: 'split',
      status: 'failed',
      progress: 64,
      message: 'FFmpeg split command failed.'
    });

    const { unmount } = renderHook(() => useSegments());

    await waitFor(() => {
      expect(getTaskStatus).toHaveBeenCalledWith('split-task-901');
    });

    await waitFor(() => {
      expect(useGenerationStore.getState().splitProgress.status).toBe('failed');
    });

    expect(useGenerationStore.getState().splitProgress.errorMessage).toBe('FFmpeg split command failed.');
    expect(useGenerationStore.getState().segmentsError).toBe('FFmpeg split command failed.');

    unmount();
  });

  it('consumes split websocket error_message without losing the original progress message', async () => {
    useVideoStore.setState({
      currentVideo: videoPayload
    });
    useGenerationStore.setState({
      splitProgress: {
        taskId: 'split-live-901',
        status: 'processing',
        progress: 40,
        message: '正在切分视频',
        errorMessage: '',
        updatedAt: null
      }
    });
    getSegments.mockResolvedValue([]);

    const { unmount } = renderHook(() => useSegments());

    await waitFor(() => {
      expect(getSegments).toHaveBeenCalledWith(videoPayload.id);
    });

    act(() => {
      websocketService.emitLocal('split:progress', {
        task_id: 'split-live-901',
        status: 'failed',
        progress: 40,
        message: '分割失败',
        error_message: 'FFmpeg exited with code 1.'
      });
    });

    await waitFor(() => {
      expect(useGenerationStore.getState().splitProgress.errorMessage).toBe('FFmpeg exited with code 1.');
    });

    expect(useGenerationStore.getState().splitProgress.message).toBe('分割失败');

    unmount();
  });
});
