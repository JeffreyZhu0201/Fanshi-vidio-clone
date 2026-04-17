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

import { useGeneration } from '../useGeneration.js';
import { useSegments } from '../useSegments.js';
import { getSegments } from '../../services/api.js';
import { useAnalysisStore } from '../../store/analysisStore.js';
import { useGenerationStore } from '../../store/generationStore.js';
import { useVideoStore } from '../../store/videoStore.js';
import { websocketService } from '../../services/websocket.js';

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

describe('segment source consistency', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    websocketService.__reset();
  });

  it('uses the latest completed generation as preview source while keeping the latest failed attempt status', async () => {
    useVideoStore.setState({
      currentVideo: {
        id: 901,
        filename: 'segment-source.mp4'
      }
    });

    getSegments.mockResolvedValue([
      {
        id: 1001,
        segment_index: 0,
        start_time: 0,
        end_time: 4,
        file_path: 'segments/source/segment-0.mp4',
        file_url: '/uploads/segments/source/segment-0.mp4',
        analysis: {
          prompt: '@主角 继续推进剧情',
          characters: ['主角']
        },
        latest_generation_task: {
          id: 5001,
          status: 'completed',
          progress: 100,
          result_url: '/uploads/outputs/segment-0-success.mp4',
          error_message: null
        },
        latest_attempt_task: {
          id: 5002,
          status: 'failed',
          progress: 100,
          result_url: null,
          error_message: 'Seed 生成失败'
        }
      }
    ]);

    const { unmount } = renderHook(() => useSegments());

    await waitFor(() => {
      expect(getSegments).toHaveBeenCalledWith(901);
    });

    await waitFor(() => {
      expect(useGenerationStore.getState().segments).toHaveLength(1);
    });

    const hydratedSegment = useGenerationStore.getState().segments[0];

    expect(hydratedSegment.generatedUrl).toBe('/uploads/outputs/segment-0-success.mp4');
    expect(hydratedSegment.latestCompletedGenerationTask.task_id).toBe(5001);
    expect(hydratedSegment.latestGenerationTask.task_id).toBe(5002);
    expect(hydratedSegment.latestGenerationTask.status).toBe('failed');
    expect(hydratedSegment.latestGenerationTask.error_message).toBe('Seed 生成失败');

    unmount();
  });

  it('keeps the last successful preview when a new generation attempt fails', () => {
    useGenerationStore.setState({
      segments: [
        {
          id: 1001,
          prompt: '@主角 继续推进剧情',
          generatedUrl: '/uploads/outputs/segment-0-success.mp4',
          latestCompletedGenerationTask: {
            task_id: 5001,
            status: 'completed',
            progress: 100,
            result_url: '/uploads/outputs/segment-0-success.mp4',
            error_message: ''
          },
          latestGenerationTask: {
            task_id: 5001,
            status: 'completed',
            progress: 100,
            result_url: '/uploads/outputs/segment-0-success.mp4',
            error_message: ''
          }
        }
      ]
    });

    const { unmount } = renderHook(() => useGeneration());

    act(() => {
      websocketService.emitLocal('generation:progress', {
        task_id: 5003,
        segment_id: 1001,
        status: 'failed',
        progress: 100,
        error_message: '最新任务失败'
      });
    });

    const updatedSegment = useGenerationStore.getState().segments[0];

    expect(updatedSegment.generatedUrl).toBe('/uploads/outputs/segment-0-success.mp4');
    expect(updatedSegment.latestCompletedGenerationTask.task_id).toBe(5001);
    expect(updatedSegment.latestGenerationTask.task_id).toBe(5003);
    expect(updatedSegment.latestGenerationTask.status).toBe('failed');
    expect(updatedSegment.latestGenerationTask.error_message).toBe('最新任务失败');

    unmount();
  });
});
