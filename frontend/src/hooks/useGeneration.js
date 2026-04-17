import { useEffect, useRef, useState } from 'react';

import {
  downloadVideo,
  generateSegment,
  getGenerationTask,
  getMergeProgress,
  mergeVideos,
  optimizePrompt,
  toAbsoluteAssetUrl
} from '../services/api.js';
import { websocketService } from '../services/websocket.js';
import { useAnalysisStore } from '../store/analysisStore.js';
import { generationSessionStorage, useGenerationStore } from '../store/generationStore.js';
import { useVideoStore } from '../store/videoStore.js';
import { downloadBlobInBrowser } from '../utils/browserDownload.js';
import { sleep } from '../utils/sleep.js';

const getGenerationErrorMessage = (error, phase = '片段生成') => {
  if (error?.statusCode === 404) {
    return `${phase}任务不存在或已失效，请刷新后重试。`;
  }

  if (error?.isTimeout || error?.code === 'ECONNABORTED') {
    return `${phase}请求超时，请稍后重试。`;
  }

  if (error?.isNetworkError || error?.statusCode === 0) {
    return `${phase}暂时无法连接服务端，请检查网络或后端状态。`;
  }

  if (error?.statusCode >= 500) {
    return `服务端处理${phase}时出错，请稍后重试。`;
  }

  return error?.message || `${phase}失败，请稍后重试。`;
};

const useGeneration = () => {
  const currentVideo = useVideoStore((state) => state.currentVideo);
  const analysis = useAnalysisStore((state) => state.analysis);
  const segments = useGenerationStore((state) => state.segments);
  const tasks = useGenerationStore((state) => state.tasks);
  const mergeProgress = useGenerationStore((state) => state.mergeProgress);
  const updateSegment = useGenerationStore((state) => state.updateSegment);
  const addTask = useGenerationStore((state) => state.addTask);
  const beginMergeProgress = useGenerationStore((state) => state.beginMergeProgress);
  const resetMergeProgress = useGenerationStore((state) => state.resetMergeProgress);
  const updateTask = useGenerationStore((state) => state.updateTask);
  const setMergeProgress = useGenerationStore((state) => state.setMergeProgress);
  const setSegmentsError = useGenerationStore((state) => state.setSegmentsError);
  const [optimizingSegmentId, setOptimizingSegmentId] = useState(0);
  const [generatingSegmentIds, setGeneratingSegmentIds] = useState([]);
  const characters = analysis?.characters ?? [];
  const mountedRef = useRef(false);
  const activeVideoIdRef = useRef(currentVideo?.id ?? null);
  const previousVideoIdRef = useRef(currentVideo?.id ?? null);
  const optimizeRequestTokenRef = useRef(0);
  const generationPollingTokenRef = useRef(new Map());
  const mergePollingTokenRef = useRef(0);

  const isVideoScopedRequestCancelled = (requestToken, videoId, tokenRef) => {
    const latestVideoId = useVideoStore.getState().currentVideo?.id ?? activeVideoIdRef.current ?? 0;

    return (
      !mountedRef.current ||
      Number(latestVideoId) !== Number(videoId ?? 0) ||
      tokenRef.current !== requestToken
    );
  };

  const beginOptimizeRequest = () => {
    const nextToken = optimizeRequestTokenRef.current + 1;
    optimizeRequestTokenRef.current = nextToken;
    return nextToken;
  };

  const beginGenerationPolling = (segmentId) => {
    const currentToken = generationPollingTokenRef.current.get(segmentId) ?? 0;
    const nextToken = currentToken + 1;
    generationPollingTokenRef.current.set(segmentId, nextToken);
    return nextToken;
  };

  const isGenerationPollingCancelled = (segmentId, requestToken, videoId) => {
    const latestVideoId = useVideoStore.getState().currentVideo?.id ?? activeVideoIdRef.current ?? 0;

    return (
      !mountedRef.current ||
      Number(latestVideoId) !== Number(videoId ?? 0) ||
      generationPollingTokenRef.current.get(segmentId) !== requestToken
    );
  };

  const beginMergePolling = () => {
    const nextToken = mergePollingTokenRef.current + 1;
    mergePollingTokenRef.current = nextToken;
    return nextToken;
  };

  const markSegmentGenerating = (segmentId, isGenerating) => {
    if (!mountedRef.current) {
      return;
    }

    setGeneratingSegmentIds((state) =>
      isGenerating ? [...new Set([...state, segmentId])] : state.filter((item) => item !== segmentId)
    );
  };

  const markSegmentGenerationFailure = (segmentId, message, taskId = '') => {
    const state = useGenerationStore.getState();
    const currentSegment = state.segments.find((segment) => segment.id === segmentId);

    if (!currentSegment) {
      return;
    }

    const failedTask = {
      task_id: taskId || currentSegment.latestGenerationTask?.task_id || '',
      status: 'failed',
      progress: currentSegment.latestGenerationTask?.progress ?? 0,
      result_url: currentSegment.latestGenerationTask?.result_url ?? '',
      error_message: message,
      created_at: currentSegment.latestGenerationTask?.created_at,
      updated_at: new Date().toISOString()
    };

    updateSegment(segmentId, {
      latestGenerationTask: failedTask,
      latestCompletedGenerationTask: currentSegment.latestCompletedGenerationTask ?? null,
      generatedUrl: currentSegment.generatedUrl ?? ''
    });

    if (failedTask.task_id) {
      updateTask(failedTask.task_id, {
        ...failedTask,
        segment_id: segmentId
      });
    }
  };

  const markMergeFailure = ({ taskId = '', progress = 0, message, title }) => {
    if (taskId) {
      setMergeProgress({
        taskId,
        status: 'failed',
        progress,
        message: title,
        errorMessage: message
      });

      return;
    }

    resetMergeProgress();
    setMergeProgress({
      status: 'failed',
      progress,
      message: title,
      errorMessage: message
    });
  };

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      optimizeRequestTokenRef.current += 1;
      generationPollingTokenRef.current = new Map();
      mergePollingTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const previousVideoId = previousVideoIdRef.current;
    activeVideoIdRef.current = currentVideo?.id ?? null;
    optimizeRequestTokenRef.current += 1;
    generationPollingTokenRef.current = new Map();
    mergePollingTokenRef.current += 1;

    if (
      mountedRef.current &&
      previousVideoId &&
      currentVideo?.id &&
      Number(previousVideoId) !== Number(currentVideo.id) &&
      useGenerationStore.getState().mergeProgress.taskId
    ) {
      generationSessionStorage.clearMergeTaskId();
      resetMergeProgress();
    }

    if (mountedRef.current) {
      setOptimizingSegmentId(0);
      setGeneratingSegmentIds([]);
    }

    previousVideoIdRef.current = currentVideo?.id ?? null;
  }, [currentVideo?.id, resetMergeProgress]);

  useEffect(() => {
    return websocketService.subscribe('generation:progress', (payload) => {
      const state = useGenerationStore.getState();
      const payloadTaskId = payload.task_id;
      const payloadSegmentId = Number(payload.segment_id ?? 0);
      const trackedTask = state.tasks.find((task) => task.task_id === payloadTaskId);
      const resolvedSegmentId = payloadSegmentId || trackedTask?.segment_id || 0;
      const isTrackedSegment = state.segments.some((segment) => segment.id === resolvedSegmentId);

      // Generation updates are ignored unless they belong to a segment rendered for the active video.
      if (!payloadTaskId || !resolvedSegmentId || !isTrackedSegment) {
        return;
      }

      updateTask(payloadTaskId, {
        ...payload,
        segment_id: resolvedSegmentId
      });

      const currentSegment = state.segments.find((segment) => segment.id === resolvedSegmentId);
      const nextGenerationTask = {
        task_id: payloadTaskId,
        status: payload.status,
        progress: payload.progress,
        result_url: toAbsoluteAssetUrl(payload.result_url),
        error_message: payload.error_message ?? payload.message ?? '',
        created_at: payload.created_at,
        updated_at: payload.updated_at
      };

      updateSegment(resolvedSegmentId, {
        latestGenerationTask: nextGenerationTask,
        latestCompletedGenerationTask:
          payload.status === 'completed' && payload.result_url
            ? nextGenerationTask
            : currentSegment?.latestCompletedGenerationTask ?? null,
        generatedUrl:
          payload.status === 'completed' && payload.result_url
            ? toAbsoluteAssetUrl(payload.result_url)
            : currentSegment?.generatedUrl ?? ''
      });
    });
  }, [updateSegment, updateTask]);

  useEffect(() => {
    return websocketService.subscribe('merge:progress', (payload) => {
      const activeMergeTaskId = useGenerationStore.getState().mergeProgress.taskId;
      const payloadTaskId = payload.task_id ?? payload.taskId ?? '';

      // Merge progress should only update the actively tracked merge task.
      if (!activeMergeTaskId || !payloadTaskId || payloadTaskId !== activeMergeTaskId) {
        return;
      }

      setMergeProgress({
        taskId: payloadTaskId,
        status: payload.status ?? 'processing',
        progress: payload.progress ?? 0,
        message: payload.message ?? '正在拼接视频',
        errorMessage:
          payload.error_message ??
          (payload.status === 'failed' ? payload.message ?? '' : '')
      });
    });
  }, [setMergeProgress]);

  useEffect(() => {
    if (!currentVideo?.id) {
      return undefined;
    }

    const persistedMergeTaskId = generationSessionStorage.getMergeTaskId();

    if (!persistedMergeTaskId) {
      return undefined;
    }

    let active = true;

    const restoreMergeProgress = async () => {
      try {
        const mergeTaskPayload = await getMergeProgress(persistedMergeTaskId);

        if (!active) {
          return;
        }

        beginMergeProgress({
          taskId: persistedMergeTaskId,
          status: mergeTaskPayload.status ?? 'processing',
          progress: mergeTaskPayload.progress ?? 0,
          message: mergeTaskPayload.message ?? '正在拼接视频'
        });

        setMergeProgress({
          taskId: persistedMergeTaskId,
          status: mergeTaskPayload.status ?? 'processing',
          progress: mergeTaskPayload.progress ?? 0,
          message: mergeTaskPayload.message ?? '正在拼接视频',
          errorMessage:
            mergeTaskPayload.error_message ??
            (mergeTaskPayload.status === 'failed' ? mergeTaskPayload.message ?? '' : '')
        });
      } catch (error) {
        generationSessionStorage.clearMergeTaskId();

        if (!active) {
          return;
        }

        resetMergeProgress();
      }
    };

    void restoreMergeProgress();

    return () => {
      active = false;
    };
  }, [beginMergeProgress, currentVideo?.id, resetMergeProgress, setMergeProgress]);

  const setSegmentPrompt = (segmentId, prompt) => {
    updateSegment(segmentId, {
      prompt
    });
  };

  const optimizeSegmentPrompt = async (segmentId) => {
    const segment = segments.find((item) => item.id === segmentId);

    if (!segment) {
      return null;
    }

    const requestVideoId = Number(currentVideo?.id ?? 0);
    const requestToken = beginOptimizeRequest();

    setSegmentsError('');
    setOptimizingSegmentId(segmentId);

    try {
      const optimizedPayload = await optimizePrompt(segment.prompt, characters);

      if (isVideoScopedRequestCancelled(requestToken, requestVideoId, optimizeRequestTokenRef)) {
        return null;
      }

      updateSegment(segmentId, {
        prompt: optimizedPayload.optimized_prompt || segment.prompt,
        highlightedPrompt: optimizedPayload.highlighted_prompt || ''
      });

      return optimizedPayload;
    } catch (error) {
      if (isVideoScopedRequestCancelled(requestToken, requestVideoId, optimizeRequestTokenRef)) {
        return null;
      }

      setSegmentsError(getGenerationErrorMessage(error, '提示词优化'));
      return null;
    } finally {
      if (!isVideoScopedRequestCancelled(requestToken, requestVideoId, optimizeRequestTokenRef)) {
        setOptimizingSegmentId(0);
      }
    }
  };

  const generateSegmentVideo = async (segmentId) => {
    const segment = segments.find((item) => item.id === segmentId);

    if (!segment) {
      return null;
    }

    if (!currentVideo?.id) {
      setSegmentsError('请先上传并选择视频，再生成片段。');
      return null;
    }

    const requestVideoId = Number(currentVideo.id);
    const requestToken = beginGenerationPolling(segmentId);
    let activeTaskId = '';

    setSegmentsError('');
    markSegmentGenerating(segmentId, true);

    try {
      const startPayload = await generateSegment(segmentId, segment.prompt);
      activeTaskId = startPayload.task_id ?? '';

      if (isGenerationPollingCancelled(segmentId, requestToken, requestVideoId)) {
        return null;
      }

      addTask({
        ...startPayload,
        segment_id: segmentId
      });
      websocketService.emitLocal('generation:progress', {
        ...startPayload,
        segment_id: segmentId
      });

      while (!isGenerationPollingCancelled(segmentId, requestToken, requestVideoId)) {
        let taskPayload;

        try {
          taskPayload = await getGenerationTask(startPayload.task_id);
        } catch (error) {
          if (isGenerationPollingCancelled(segmentId, requestToken, requestVideoId)) {
            return null;
          }

          const errorMessage = getGenerationErrorMessage(error, '片段生成轮询');

          setSegmentsError(errorMessage);
          markSegmentGenerationFailure(segmentId, errorMessage, startPayload.task_id);
          return null;
        }

        if (isGenerationPollingCancelled(segmentId, requestToken, requestVideoId)) {
          return null;
        }

        websocketService.emitLocal('generation:progress', taskPayload);

        if (taskPayload.status === 'completed' || taskPayload.status === 'failed') {
          return taskPayload;
        }

        await sleep(1200);
      }

      return null;
    } catch (error) {
      if (isGenerationPollingCancelled(segmentId, requestToken, requestVideoId)) {
        return null;
      }

      const errorMessage = getGenerationErrorMessage(error, activeTaskId ? '片段生成' : '片段生成启动');

      setSegmentsError(errorMessage);
      markSegmentGenerationFailure(segmentId, errorMessage, activeTaskId);
      return null;
    } finally {
      if (!isGenerationPollingCancelled(segmentId, requestToken, requestVideoId)) {
        markSegmentGenerating(segmentId, false);
      }
    }
  };

  const startMerge = async () => {
    if (!currentVideo?.id) {
      beginMergeProgress({
        taskId: '',
        status: 'failed',
        progress: 0,
        message: '请先上传并处理视频，再执行拼接。'
      });
      setMergeProgress({
        status: 'failed',
        progress: 0,
        message: '请先上传并处理视频，再执行拼接。',
        errorMessage: '请先上传并处理视频，再执行拼接。'
      });
      return null;
    }

    const requestVideoId = Number(currentVideo.id);
    const requestToken = beginMergePolling();
    let activeTaskId = '';

    try {
      const mergeTask = await mergeVideos(currentVideo.id);
      activeTaskId = mergeTask.task_id ?? '';

      if (isVideoScopedRequestCancelled(requestToken, requestVideoId, mergePollingTokenRef)) {
        return null;
      }

      beginMergeProgress({
        taskId: mergeTask.task_id,
        status: mergeTask.status,
        progress: 0,
        message: '拼接任务已提交'
      });

      websocketService.emitLocal('merge:progress', {
        task_id: mergeTask.task_id,
        status: mergeTask.status,
        progress: 0,
        message: '拼接任务已提交'
      });

      while (!isVideoScopedRequestCancelled(requestToken, requestVideoId, mergePollingTokenRef)) {
        let mergeTaskProgress;

        try {
          mergeTaskProgress = await getMergeProgress(mergeTask.task_id);
        } catch (error) {
          if (isVideoScopedRequestCancelled(requestToken, requestVideoId, mergePollingTokenRef)) {
            return null;
          }

          const errorMessage = getGenerationErrorMessage(error, '视频拼接轮询');
          const currentProgress = useGenerationStore.getState().mergeProgress.progress ?? 0;

          markMergeFailure({
            taskId: mergeTask.task_id,
            progress: currentProgress,
            message: errorMessage,
            title: '拼接任务查询失败'
          });

          return null;
        }

        if (isVideoScopedRequestCancelled(requestToken, requestVideoId, mergePollingTokenRef)) {
          return null;
        }

        websocketService.emitLocal('merge:progress', {
          task_id: mergeTask.task_id,
          ...mergeTaskProgress
        });

        if (mergeTaskProgress.status === 'completed' || mergeTaskProgress.status === 'failed') {
          return mergeTaskProgress;
        }

        await sleep(1200);
      }

      return null;
    } catch (error) {
      if (isVideoScopedRequestCancelled(requestToken, requestVideoId, mergePollingTokenRef)) {
        return null;
      }

      const errorMessage = getGenerationErrorMessage(error, activeTaskId ? '视频拼接' : '拼接任务启动');
      const currentProgress = useGenerationStore.getState().mergeProgress.progress ?? 0;

      markMergeFailure({
        taskId: activeTaskId,
        progress: activeTaskId ? currentProgress : 0,
        message: errorMessage,
        title: activeTaskId ? '拼接任务失败' : '拼接任务启动失败'
      });

      return null;
    }
  };

  const downloadMergedVideo = async () => {
    if (!mergeProgress.taskId) {
      return null;
    }

    const { blob, filename } = await downloadVideo(mergeProgress.taskId);
    downloadBlobInBrowser(blob, filename);

    return filename;
  };

  return {
    tasks,
    mergeProgress,
    optimizingSegmentId,
    generatingSegmentIds,
    setSegmentPrompt,
    optimizeSegmentPrompt,
    generateSegmentVideo,
    startMerge,
    downloadMergedVideo
  };
};

export { useGeneration };
