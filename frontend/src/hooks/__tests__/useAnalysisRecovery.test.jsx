import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('../../services/api.js', () => ({
  analyzeVideo: jest.fn(),
  getAnalysis: jest.fn(),
  isTransientApiError: jest.fn((error) => Boolean(error?.isTimeout || error?.isNetworkError || error?.statusCode === 0))
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

jest.mock('../../utils/sleep.js', () => ({
  sleep: jest.fn(() => Promise.resolve())
}));

import { useAnalysis } from '../useAnalysis.js';
import { analyzeVideo, getAnalysis } from '../../services/api.js';
import { useAnalysisStore } from '../../store/analysisStore.js';
import { useVideoStore } from '../../store/videoStore.js';
import { sleep } from '../../utils/sleep.js';
import { websocketService } from '../../services/websocket.js';

const createNotFoundError = () => Object.assign(new Error('Analysis not found.'), { statusCode: 404 });

const createTimeoutError = () =>
  Object.assign(new Error('请求超时，请稍后重试。'), {
    statusCode: 0,
    code: 'ECONNABORTED',
    isTimeout: true,
    isNetworkError: true
  });

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
    analysisOptions: {
      extractSubtitles: false,
      parseAudio: false
    },
    loading: false,
    error: '',
    progress: 0,
    status: 'idle',
    statusMessage: '等待分析',
    lastUpdatedAt: null
  });
};

describe('useAnalysis recovery flow', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    websocketService.__reset();
  });

  it('restores analysis after analyze POST times out but GET eventually succeeds', async () => {
    // Covers the required recovery path: POST timeout but GET polling eventually returns persisted analysis data.
    const analysisPayload = {
      id: 9001,
      video_id: 501,
      plot: '主角在夜色中进入城市中心。',
      characters: [{ id: 'hero', name: '主角' }],
      backgrounds: ['夜晚街景'],
      time_anchors: [{ startTime: 0, endTime: 3.2, sceneSummary: '主角进入街道' }]
    };

    getAnalysis
      .mockRejectedValueOnce(createNotFoundError())
      .mockRejectedValueOnce(createNotFoundError())
      .mockResolvedValueOnce(analysisPayload);
    analyzeVideo.mockRejectedValue(createTimeoutError());

    useVideoStore.setState({
      currentVideo: {
        id: 501,
        filename: 'analysis-timeout.mp4',
        status: 'uploaded'
      }
    });

    const { result, unmount } = renderHook(() => useAnalysis());
    expect(getAnalysis).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(analyzeVideo).toHaveBeenCalledWith(501, {
      extractSubtitles: false,
      parseAudio: false
    });
    expect(getAnalysis).toHaveBeenCalledWith(501);
    expect(sleep).toHaveBeenCalled();
    expect(useAnalysisStore.getState().analysis).toEqual(analysisPayload);
    expect(useAnalysisStore.getState().status).toBe('completed');
    expect(useAnalysisStore.getState().error).toBe('');
    expect(useVideoStore.getState().currentVideo.status).toBe('analyzed');

    unmount();
  });

  it('does not hydrate analysis before the current video enters analyzed state', async () => {
    useVideoStore.setState({
      currentVideo: {
        id: 504,
        filename: 'analysis-not-ready.mp4',
        status: 'uploaded'
      }
    });

    const { unmount } = renderHook(() => useAnalysis());

    await act(async () => {
      await Promise.resolve();
    });

    expect(getAnalysis).not.toHaveBeenCalled();
    expect(useAnalysisStore.getState().analysis).toBeNull();

    unmount();
  });

  it('shows a clear failure when recovery polling exhausts all retries', async () => {
    getAnalysis.mockRejectedValue(createNotFoundError());
    analyzeVideo.mockRejectedValue(createTimeoutError());

    useVideoStore.setState({
      currentVideo: {
        id: 502,
        filename: 'analysis-retry-failed.mp4',
        status: 'uploaded'
      }
    });

    const { result, unmount } = renderHook(() => useAnalysis());
    expect(getAnalysis).not.toHaveBeenCalled();

    let runResult;

    await act(async () => {
      runResult = await result.current.runAnalysis();
    });

    expect(runResult).toBeNull();
    expect(useAnalysisStore.getState().status).toBe('failed');
    expect(useAnalysisStore.getState().error).toBe('分析请求超时，且在确认窗口内未获取到结果，请稍后重试。');

    unmount();
  });

  it('cancels timeout recovery polling when the hook unmounts', async () => {
    const deferredAnalysis = createDeferred();
    const analysisPayload = {
      id: 9003,
      video_id: 503,
      plot: '这条结果不应该在卸载后写回。',
      characters: [],
      backgrounds: [],
      time_anchors: []
    };

    getAnalysis.mockRejectedValueOnce(createNotFoundError()).mockImplementationOnce(() => deferredAnalysis.promise);
    analyzeVideo.mockRejectedValue(createTimeoutError());

    useVideoStore.setState({
      currentVideo: {
        id: 503,
        filename: 'analysis-unmount-cancel.mp4',
        status: 'uploaded'
      }
    });

    const { result, unmount } = renderHook(() => useAnalysis());
    expect(getAnalysis).not.toHaveBeenCalled();

    let runResultPromise;

    await act(async () => {
      runResultPromise = result.current.runAnalysis();
      await Promise.resolve();
    });

    unmount();

    deferredAnalysis.resolve(analysisPayload);

    let runResult;

    await act(async () => {
      runResult = await runResultPromise;
    });

    expect(runResult).toBeNull();
    expect(useAnalysisStore.getState().analysis).toBeNull();
    expect(useAnalysisStore.getState().error).toBe('');
  });
});
