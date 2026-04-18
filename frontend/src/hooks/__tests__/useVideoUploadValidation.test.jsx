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

  it('allows uploading a file even when the current project already has the same name and size', async () => {
    const restoreMetadataProbe = mockVideoMetadataProbe(12);
    useVideoStore.setState({
      currentVideo: {
        id: 901,
        filename: 'duplicate.mp4',
        file_size: 4,
        status: 'uploaded'
      },
      videos: []
    });
    uploadVideo.mockResolvedValue({
      id: 902,
      filename: 'duplicate.mp4',
      file_size: 4,
      status: 'uploaded'
    });

    const { result, unmount } = renderHook(() => useVideoUpload());
    const file = new File(['demo'], 'duplicate.mp4', { type: 'video/mp4' });

    let uploadResult;

    await act(async () => {
      uploadResult = await result.current.uploadSelectedFile(file);
    });

    expect(uploadResult).toEqual({
      id: 902,
      filename: 'duplicate.mp4',
      file_size: 4,
      status: 'uploaded'
    });
    expect(uploadVideo).toHaveBeenCalledTimes(1);
    expect(useVideoStore.getState().uploadStatus).toBe('completed');
    expect(useVideoStore.getState().uploadError).toBe('');

    restoreMetadataProbe();
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

  it('surfaces a clearer message when upload times out', async () => {
    const restoreMetadataProbe = mockVideoMetadataProbe(12);
    uploadVideo.mockRejectedValue(
      Object.assign(new Error('上传超时，请检查网络连接，或调大 VITE_UPLOAD_TIMEOUT 后重试。'), {
        isTimeout: true,
        code: 'ECONNABORTED'
      })
    );

    const { result, unmount } = renderHook(() => useVideoUpload());
    const file = new File(['demo'], 'slow-upload.mp4', { type: 'video/mp4' });

    let uploadResult;

    await act(async () => {
      uploadResult = await result.current.uploadSelectedFile(file);
    });

    expect(uploadResult).toBeNull();
    expect(uploadVideo).toHaveBeenCalledTimes(1);
    expect(useVideoStore.getState().uploadStatus).toBe('error');
    expect(useVideoStore.getState().uploadError).toBe(
      '上传超时，请检查网络连接，或调大 VITE_UPLOAD_TIMEOUT 后重试。'
    );
    expect(useVideoStore.getState().validationMessage).toBe('上传超时，请检查网络后重试。');

    restoreMetadataProbe();
    unmount();
  });
});
