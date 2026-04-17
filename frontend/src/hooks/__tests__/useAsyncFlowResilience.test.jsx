import { act, renderHook, waitFor } from '@testing-library/react';

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

jest.mock('../../utils/sleep.js', () => ({
  sleep: jest.fn(() => Promise.resolve())
}));

import { useGeneration } from '../useGeneration.js';
import { useSegments } from '../useSegments.js';
import {
  analyzeSegment,
  generateSegment,
  getGenerationTask,
  getMergeProgress,
  getSegments,
  getTaskStatus,
  mergeVideos,
  optimizePrompt,
  splitVideo
} from '../../services/api.js';
import { useAnalysisStore } from '../../store/analysisStore.js';
import { useGenerationStore } from '../../store/generationStore.js';
import { useVideoStore } from '../../store/videoStore.js';
import { websocketService } from '../../services/websocket.js';

const createServerError = () =>
  Object.assign(new Error('Internal Server Error'), {
    statusCode: 500
  });

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

describe('async flow resilience', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    websocketService.__reset();
  });

  it('marks split progress as failed when split polling returns a 500 error', async () => {
    useVideoStore.setState({
      currentVideo: {
        id: 801,
        filename: 'split-error.mp4',
        status: 'analyzed'
      }
    });

    useAnalysisStore.setState({
      analysis: {
        time_anchors: [
          {
            startTime: 0,
            endTime: 3.5,
            sceneSummary: '主角进入大厅'
          }
        ]
      }
    });

    getSegments.mockResolvedValue([]);
    splitVideo.mockResolvedValue({
      task_id: 'split-801',
      status: 'pending',
      progress: 0
    });
    getTaskStatus.mockRejectedValue(createServerError());

    const { result, unmount } = renderHook(() => useSegments());

    await waitFor(() => {
      expect(getSegments).toHaveBeenCalledWith(801);
    });

    let splitResult;

    await act(async () => {
      splitResult = await result.current.splitFromAnalysis();
    });

    expect(splitResult).toBeNull();
    expect(useGenerationStore.getState().splitProgress.status).toBe('failed');
    expect(useGenerationStore.getState().splitProgress.message).toBe('分割任务查询失败');
    expect(useGenerationStore.getState().segmentsError).toBe('服务端处理视频分割轮询时出错，请稍后重试。');

    unmount();
  });

  it('restores the optimize button state when prompt optimization times out', async () => {
    useVideoStore.setState({
      currentVideo: {
        id: 901,
        filename: 'optimize-timeout.mp4',
        status: 'analyzed'
      }
    });

    useGenerationStore.setState({
      segments: [
        {
          id: 301,
          prompt: '@主角 继续推进剧情',
          generatedUrl: '',
          characters: ['主角'],
          highlightedPrompt: '',
          latestGenerationTask: null,
          latestCompletedGenerationTask: null
        }
      ]
    });

    optimizePrompt.mockRejectedValue(createTimeoutError());

    const { result, unmount } = renderHook(() => useGeneration());

    let optimizeResult;

    await act(async () => {
      optimizeResult = await result.current.optimizeSegmentPrompt(301);
    });

    expect(optimizeResult).toBeNull();
    expect(useGenerationStore.getState().segmentsError).toBe('提示词优化请求超时，请稍后重试。');
    expect(result.current.optimizingSegmentId).toBe(0);

    unmount();
  });

  it('updates segment understanding when segment analysis succeeds', async () => {
    useVideoStore.setState({
      currentVideo: {
        id: 904,
        filename: 'segment-analysis.mp4',
        status: 'analyzed'
      }
    });

    useGenerationStore.setState({
      segments: [
        {
          id: 303,
          prompt: '@主角 继续推进剧情',
          scene: '旧场景',
          action: '旧动作',
          generatedUrl: '',
          characters: ['主角'],
          highlightedPrompt: '',
          latestGenerationTask: null,
          latestCompletedGenerationTask: null
        }
      ]
    });

    analyzeSegment.mockResolvedValue({
      id: 303,
      analysis: {
        scene: '新场景',
        action: '新动作',
        prompt: '@主角 在新场景中继续推进剧情',
        characters: ['主角', '配角']
      },
      latest_generation_task: null,
      latest_attempt_task: null
    });

    const { result, unmount } = renderHook(() => useGeneration());

    let analysisResult;

    await act(async () => {
      analysisResult = await result.current.analyzeSegmentById(303);
    });

    expect(analysisResult).not.toBeNull();
    expect(useGenerationStore.getState().segments[0]).toMatchObject({
      scene: '新场景',
      action: '新动作',
      prompt: '@主角 在新场景中继续推进剧情',
      characters: ['主角', '配角']
    });
    expect(result.current.analyzingSegmentId).toBe(0);

    unmount();
  });

  it('uses the latest editor prompt when optimizing a segment prompt', async () => {
    useVideoStore.setState({
      currentVideo: {
        id: 905,
        filename: 'optimize-latest-draft.mp4',
        status: 'analyzed'
      }
    });

    useAnalysisStore.setState({
      analysis: {
        characters: [{ name: '主角', appearancePrompt: '稳定角色设定' }]
      }
    });

    useGenerationStore.setState({
      segments: [
        {
          id: 304,
          prompt: '@主角 旧提示词',
          generatedUrl: '',
          characters: ['主角'],
          highlightedPrompt: '',
          latestGenerationTask: null,
          latestCompletedGenerationTask: null
        }
      ]
    });

    optimizePrompt.mockResolvedValue({
      optimized_prompt: '@主角 新提示词，镜头更明确',
      highlighted_prompt: '<span class="mention text-blue-500">@主角</span> 新提示词，镜头更明确'
    });

    const { result, unmount } = renderHook(() => useGeneration());

    await act(async () => {
      await result.current.optimizeSegmentPrompt(304, '@主角 新提示词');
    });

    expect(optimizePrompt).toHaveBeenCalledWith('@主角 新提示词', [
      {
        name: '主角',
        appearancePrompt: '稳定角色设定'
      }
    ]);
    expect(useGenerationStore.getState().segments[0].prompt).toBe('@主角 新提示词，镜头更明确');

    unmount();
  });

  it('resets generation state when generation polling fails in the middle', async () => {
    useVideoStore.setState({
      currentVideo: {
        id: 902,
        filename: 'generation-error.mp4',
        status: 'analyzed'
      }
    });

    useGenerationStore.setState({
      segments: [
        {
          id: 302,
          prompt: '@主角 冲出巷口',
          generatedUrl: '',
          characters: ['主角'],
          highlightedPrompt: '',
          latestGenerationTask: null,
          latestCompletedGenerationTask: null
        }
      ]
    });

    generateSegment.mockResolvedValue({
      task_id: 'generation-302',
      status: 'pending',
      progress: 0
    });
    getGenerationTask.mockRejectedValue(createServerError());

    const { result, unmount } = renderHook(() => useGeneration());

    let generationResult;

    await act(async () => {
      generationResult = await result.current.generateSegmentVideo(302);
    });

    expect(generationResult).toBeNull();
    expect(useGenerationStore.getState().segmentsError).toBe('服务端处理片段生成轮询时出错，请稍后重试。');
    expect(useGenerationStore.getState().segments[0].latestGenerationTask).toMatchObject({
      task_id: 'generation-302',
      status: 'failed',
      error_message: '服务端处理片段生成轮询时出错，请稍后重试。'
    });
    expect(result.current.generatingSegmentIds).toEqual([]);

    unmount();
  });

  it('ignores stale merge polling updates after switching to another video', async () => {
    const deferredProgress = createDeferred();

    useVideoStore.setState({
      currentVideo: {
        id: 903,
        filename: 'merge-old.mp4',
        status: 'analyzed'
      }
    });

    mergeVideos.mockResolvedValue({
      task_id: 'merge-903',
      status: 'pending'
    });
    getMergeProgress.mockImplementation(() => deferredProgress.promise);

    const { result, unmount } = renderHook(() => useGeneration());

    let mergePromise;

    await act(async () => {
      mergePromise = result.current.startMerge();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mergeVideos).toHaveBeenCalledWith(903);
    });

    await act(async () => {
      useVideoStore.setState({
        currentVideo: {
          id: 904,
          filename: 'merge-new.mp4',
          status: 'analyzed'
        }
      });
      await Promise.resolve();
    });

    deferredProgress.resolve({
      status: 'completed',
      progress: 100,
      message: '拼接完成'
    });

    let mergeResult;

    await act(async () => {
      mergeResult = await mergePromise;
    });

    expect(mergeResult).toBeNull();
    expect(useGenerationStore.getState().mergeProgress.status).not.toBe('completed');

    unmount();
  });
});
