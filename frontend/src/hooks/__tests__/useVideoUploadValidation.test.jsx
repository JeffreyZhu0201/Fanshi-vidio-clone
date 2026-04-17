import { act, renderHook } from '@testing-library/react';

jest.mock('../../services/api.js', () => ({
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

import { useVideoUpload } from '../useVideoUpload.js';
import { uploadVideo } from '../../services/api.js';
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

const mockVideoMetadataProbe = (durationSeconds) => {
  const originalCreateElement = document.createElement.bind(document);
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  URL.createObjectURL = jest.fn(() => 'blob:video-preview');
  URL.revokeObjectURL = jest.fn(() => {});

  const createElementSpy = jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
    if (tagName !== 'video') {
      return originalCreateElement(tagName);
    }

    const videoElement = {
      duration: durationSeconds,
      preload: 'metadata',
      onloadedmetadata: null,
      onerror: null,
      set src(_value) {
        Promise.resolve().then(() => {
          this.onloadedmetadata?.();
        });
      }
    };

    return videoElement;
  });

  return () => {
    createElementSpy.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  };
};

describe('useVideoUpload validation', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    websocketService.__reset();
  });

  it('rejects duplicate uploads before calling the backend', async () => {
    useVideoStore.setState({
      currentVideo: {
        id: 901,
        filename: 'duplicate.mp4',
        file_size: 4,
        status: 'uploaded'
      },
      videos: []
    });

    const { result, unmount } = renderHook(() => useVideoUpload());
    const file = new File(['demo'], 'duplicate.mp4', { type: 'video/mp4' });

    let uploadResult;

    await act(async () => {
      uploadResult = await result.current.uploadSelectedFile(file);
    });

    expect(uploadResult).toBeNull();
    expect(uploadVideo).not.toHaveBeenCalled();
    expect(useVideoStore.getState().uploadStatus).toBe('error');
    expect(useVideoStore.getState().uploadError).toBe('当前项目中已存在同名且大小一致的视频，请勿重复上传。');

    unmount();
  });

  it('rejects videos that exceed the duration limit before upload starts', async () => {
    const restoreMetadataProbe = mockVideoMetadataProbe(601);
    const { result, unmount } = renderHook(() => useVideoUpload());
    const file = new File(['demo'], 'too-long.mp4', { type: 'video/mp4' });

    let uploadResult;

    await act(async () => {
      uploadResult = await result.current.uploadSelectedFile(file);
    });

    expect(uploadResult).toBeNull();
    expect(uploadVideo).not.toHaveBeenCalled();
    expect(useVideoStore.getState().uploadStatus).toBe('error');
    expect(useVideoStore.getState().uploadError).toBe('视频时长不能超过 10:00。');

    restoreMetadataProbe();
    unmount();
  });
});
