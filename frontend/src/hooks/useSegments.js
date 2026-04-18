import { useEffect, useLayoutEffect, useRef } from 'react';

import { getSegments, getTaskStatus, getVideo, splitVideo, toAbsoluteAssetUrl } from '../services/api.js';
import { websocketService } from '../services/websocket.js';
import { useAnalysisStore } from '../store/analysisStore.js';
import { generationSessionStorage, useGenerationStore } from '../store/generationStore.js';
import { useVideoStore, videoSessionStorage } from '../store/videoStore.js';
import { sleep } from '../utils/sleep.js';

const getSplitErrorMessage = (error, phase = '视频分割') => {
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

const getTaskErrorMessage = (taskPayload, fallback = '') => {
  return (
    taskPayload?.error_message ??
    taskPayload?.errorMessage ??
    (taskPayload?.status === 'failed' ? taskPayload?.message ?? fallback : fallback)
  );
};

const normalizeSegment = (segment) => {
  const latestCompletedGenerationTask = segment.latest_generation_task
    ? {
        task_id: segment.latest_generation_task.id,
        status: segment.latest_generation_task.status,
        progress: segment.latest_generation_task.progress,
        prompt: segment.latest_generation_task.prompt ?? '',
        optimizedPrompt: segment.latest_generation_task.optimized_prompt ?? '',
        result_url: toAbsoluteAssetUrl(segment.latest_generation_task.result_url),
        error_message: segment.latest_generation_task.error_message ?? '',
        created_at: segment.latest_generation_task.created_at,
        updated_at: segment.latest_generation_task.updated_at
      }
    : null;
  const latestAttemptTask = segment.latest_attempt_task
    ? {
        task_id: segment.latest_attempt_task.id,
        status: segment.latest_attempt_task.status,
        progress: segment.latest_attempt_task.progress,
        prompt: segment.latest_attempt_task.prompt ?? '',
        optimizedPrompt: segment.latest_attempt_task.optimized_prompt ?? '',
        result_url: toAbsoluteAssetUrl(segment.latest_attempt_task.result_url),
        error_message: segment.latest_attempt_task.error_message ?? '',
        created_at: segment.latest_attempt_task.created_at,
        updated_at: segment.latest_attempt_task.updated_at
      }
    : latestCompletedGenerationTask;

  return {
    id: segment.id,
    segmentIndex: segment.segment_index,
    startTime: Number(segment.start_time),
    endTime: Number(segment.end_time),
    sourceUrl: toAbsoluteAssetUrl(segment.file_url),
    sourcePath: segment.file_path,
    generatedUrl: latestCompletedGenerationTask?.result_url ?? '',
    scene: segment.analysis?.scene ?? '',
    scenes: segment.analysis?.scenes ?? [],
    action: segment.analysis?.action ?? '',
    prompt: segment.analysis?.prompt ?? '',
    sceneSummary: segment.analysis?.sceneSummary ?? '',
    scenePrompt: segment.analysis?.scenePrompt ?? '',
    backgroundId: segment.analysis?.backgroundId ?? '',
    backgroundAction: segment.analysis?.backgroundAction ?? '',
    backgroundName: segment.analysis?.backgroundName ?? '',
    backgroundPrompt: segment.analysis?.backgroundPrompt ?? '',
    representativeFrameTime: segment.analysis?.representativeFrameTime ?? null,
    representativeFrameNote: segment.analysis?.representativeFrameNote ?? '',
    characters: segment.analysis?.characters ?? [],
    highlightedPrompt: '',
    latestCompletedGenerationTask,
    latestGenerationTask: latestAttemptTask
  };
};

const useSegments = () => {
  const currentVideo = useVideoStore((state) => state.currentVideo);
  const setCurrentVideo = useVideoStore((state) => state.setCurrentVideo);
  const analysis = useAnalysisStore((state) => state.analysis);
  const segments = useGenerationStore((state) => state.segments);
  const splitProgress = useGenerationStore((state) => state.splitProgress);
  const segmentsLoading = useGenerationStore((state) => state.segmentsLoading);
  const segmentsError = useGenerationStore((state) => state.segmentsError);
  const setSegments = useGenerationStore((state) => state.setSegments);
  const beginSplitProgress = useGenerationStore((state) => state.beginSplitProgress);
  const resetSplitProgress = useGenerationStore((state) => state.resetSplitProgress);
  const resetGenerationContext = useGenerationStore((state) => state.resetGenerationContext);
  const setSplitProgress = useGenerationStore((state) => state.setSplitProgress);
  const setSegmentsLoading = useGenerationStore((state) => state.setSegmentsLoading);
  const setSegmentsError = useGenerationStore((state) => state.setSegmentsError);
  const mountedRef = useRef(false);
  const activeVideoIdRef = useRef(currentVideo?.id ?? null);
  const previousVideoIdRef = useRef(currentVideo?.id ?? null);
  const splitPollingTokenRef = useRef(0);

  const cancelSplitPolling = () => {
    splitPollingTokenRef.current += 1;
  };

  const beginSplitPolling = () => {
    const nextToken = splitPollingTokenRef.current + 1;
    splitPollingTokenRef.current = nextToken;
    return nextToken;
  };

  const isSplitPollingCancelled = (pollToken, videoId) => {
    const latestVideoId = useVideoStore.getState().currentVideo?.id ?? activeVideoIdRef.current ?? 0;

    return (
      !mountedRef.current ||
      Number(latestVideoId) !== Number(videoId ?? 0) ||
      splitPollingTokenRef.current !== pollToken
    );
  };

  const markSplitFailure = ({ taskId = '', progress = 0, message, title }) => {
    if (taskId) {
      setSplitProgress({
        taskId,
        status: 'failed',
        progress,
        message: title,
        errorMessage: message
      });

      return;
    }

    resetSplitProgress();
    setSplitProgress({
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
      cancelSplitPolling();
    };
  }, []);

  useEffect(() => {
    const previousVideoId = previousVideoIdRef.current;
    activeVideoIdRef.current = currentVideo?.id ?? null;
    cancelSplitPolling();

    if (
      mountedRef.current &&
      previousVideoId &&
      currentVideo?.id &&
      Number(previousVideoId) !== Number(currentVideo.id) &&
      useGenerationStore.getState().splitProgress.taskId
    ) {
      generationSessionStorage.clearSplitTaskId();
      resetSplitProgress();
    }

    previousVideoIdRef.current = currentVideo?.id ?? null;
  }, [currentVideo?.id, resetSplitProgress]);

  useLayoutEffect(() => {
    const previousVideoId = previousVideoIdRef.current ?? null;
    const nextVideoId = currentVideo?.id ?? null;

    if (previousVideoId && Number(previousVideoId) !== Number(nextVideoId ?? 0)) {
      resetGenerationContext();
    }

    previousVideoIdRef.current = nextVideoId;
  }, [currentVideo?.id, resetGenerationContext]);

  const refreshSegmentsByVideoId = async (videoId) => {
    if (!videoId) {
      return [];
    }

    setSegmentsLoading(true);

    try {
      const segmentPayload = await getSegments(videoId);

      if (
        !mountedRef.current ||
        Number(useVideoStore.getState().currentVideo?.id ?? activeVideoIdRef.current ?? 0) !== Number(videoId ?? 0)
      ) {
        return [];
      }

      const normalizedSegments = segmentPayload.map(normalizeSegment);
      setSegments(normalizedSegments);
      return normalizedSegments;
    } catch (error) {
      if (
        mountedRef.current &&
        Number(useVideoStore.getState().currentVideo?.id ?? activeVideoIdRef.current ?? 0) === Number(videoId ?? 0)
      ) {
        setSegmentsError(getSplitErrorMessage(error, '片段列表加载'));
      }

      return [];
    }
  };

  useEffect(() => {
    return websocketService.subscribe('split:progress', (payload) => {
      const activeSplitTaskId = useGenerationStore.getState().splitProgress.taskId;
      const payloadTaskId = payload.task_id ?? payload.taskId ?? '';

      // Split progress belongs to the actively tracked split task only.
      if (!activeSplitTaskId || !payloadTaskId || payloadTaskId !== activeSplitTaskId) {
        return;
      }

      setSplitProgress({
        taskId: payloadTaskId,
        status: payload.status ?? 'processing',
        progress: payload.progress ?? 0,
        message: payload.message ?? '正在切分视频',
        errorMessage: getTaskErrorMessage(payload)
      });
    });
  }, [setSplitProgress]);

  useEffect(() => {
    if (currentVideo?.id) {
      return undefined;
    }

    const persistedVideoId = videoSessionStorage.getCurrentVideoId();

    if (!persistedVideoId) {
      return undefined;
    }

    let active = true;

    const restoreCurrentVideo = async () => {
      try {
        const videoPayload = await getVideo(persistedVideoId);

        if (active) {
          setCurrentVideo(videoPayload);
        }
      } catch (error) {
        videoSessionStorage.clearCurrentVideoId();
        generationSessionStorage.clearSplitTaskId();
        generationSessionStorage.clearMergeTaskId();

        if (!active) {
          return;
        }

        resetSplitProgress();

        if (error.statusCode !== 404) {
          setSegmentsError(error.message);
        }
      }
    };

    void restoreCurrentVideo();

    return () => {
      active = false;
    };
  }, [currentVideo?.id, resetSplitProgress, setCurrentVideo, setSegmentsError]);

  useEffect(() => {
    if (!currentVideo?.id) {
      setSegments([]);
      return undefined;
    }

    let active = true;

    const hydrateSegments = async () => {
      try {
        setSegmentsLoading(true);
        const segmentPayload = await getSegments(currentVideo.id);

        if (active) {
          setSegments(segmentPayload.map(normalizeSegment));
        }
      } catch (error) {
        if (active) {
          setSegmentsError(error.message);
        }
      }
    };

    void hydrateSegments();

    return () => {
      active = false;
    };
  }, [currentVideo?.id, setSegments, setSegmentsError, setSegmentsLoading]);

  useEffect(() => {
    if (!currentVideo?.id) {
      return undefined;
    }

    const persistedSplitTaskId = generationSessionStorage.getSplitTaskId();

    if (!persistedSplitTaskId) {
      return undefined;
    }

    let active = true;

    const restoreSplitProgress = async () => {
      try {
        const progressPayload = await getTaskStatus(persistedSplitTaskId);

        if (!active) {
          return;
        }

        if (progressPayload.type && progressPayload.type !== 'split') {
          generationSessionStorage.clearSplitTaskId();
          resetSplitProgress();
          return;
        }

        beginSplitProgress({
          taskId: persistedSplitTaskId,
          status: progressPayload.status ?? 'processing',
          progress: progressPayload.progress ?? 0,
          message: progressPayload.message ?? '正在切分视频',
        });

        setSplitProgress({
          taskId: persistedSplitTaskId,
          status: progressPayload.status ?? 'processing',
          progress: progressPayload.progress ?? 0,
          message: progressPayload.message ?? '正在切分视频',
          errorMessage: getTaskErrorMessage(progressPayload)
        });

        if (progressPayload.status === 'completed') {
          await refreshSegmentsByVideoId(currentVideo.id);
          return;
        }

        if (progressPayload.status === 'failed') {
          setSegmentsError(getTaskErrorMessage(progressPayload, '视频分割失败。'));
        }
      } catch (error) {
        generationSessionStorage.clearSplitTaskId();

        if (!active) {
          return;
        }

        resetSplitProgress();

        if (error.statusCode !== 404) {
          setSegmentsError(error.message);
        }
      }
    };

    void restoreSplitProgress();

    return () => {
      active = false;
    };
  }, [
    beginSplitProgress,
    currentVideo?.id,
    resetSplitProgress,
    setSegmentsError,
    setSplitProgress,
    setSegmentsLoading,
    setSegments
  ]);

  const refreshSegments = async () => {
    return refreshSegmentsByVideoId(currentVideo?.id);
  };

  const splitFromAnalysis = async () => {
    if (!currentVideo?.id) {
      setSegmentsError('请先上传视频。');
      return null;
    }

    if (!analysis?.time_anchors?.length) {
      setSegmentsError('当前还没有可用的时间锚点，请先完成整片分析。');
      return null;
    }

    setSegmentsError('');
    const currentVideoId = Number(currentVideo.id);
    const pollToken = beginSplitPolling();
    let activeTaskId = '';

    try {
      const splitTask = await splitVideo(currentVideoId, analysis.time_anchors);
      activeTaskId = splitTask.task_id ?? '';

      if (isSplitPollingCancelled(pollToken, currentVideoId)) {
        return null;
      }

      beginSplitProgress({
        taskId: splitTask.task_id,
        status: splitTask.status,
        progress: splitTask.progress ?? 0,
        message: '分割任务已提交'
      });
      websocketService.emitLocal('split:progress', {
        task_id: splitTask.task_id,
        status: splitTask.status,
        progress: splitTask.progress ?? 0,
        message: '分割任务已提交'
      });

      while (!isSplitPollingCancelled(pollToken, currentVideoId)) {
        let progressPayload;

        try {
          progressPayload = await getTaskStatus(splitTask.task_id);
        } catch (error) {
          if (isSplitPollingCancelled(pollToken, currentVideoId)) {
            return null;
          }

          const errorMessage = getSplitErrorMessage(error, '视频分割轮询');
          const currentProgress = useGenerationStore.getState().splitProgress.progress ?? 0;

          setSegmentsError(errorMessage);
          markSplitFailure({
            taskId: splitTask.task_id,
            progress: currentProgress,
            message: errorMessage,
            title: '分割任务查询失败'
          });

          return null;
        }

        if (isSplitPollingCancelled(pollToken, currentVideoId)) {
          return null;
        }

        websocketService.emitLocal('split:progress', {
          task_id: splitTask.task_id,
          ...progressPayload
        });

        if (progressPayload.status === 'completed') {
          await refreshSegmentsByVideoId(currentVideoId);
          return progressPayload;
        }

        if (progressPayload.status === 'failed') {
          setSegmentsError(getTaskErrorMessage(progressPayload, '视频分割失败。'));
          return progressPayload;
        }

        await sleep(1200);
      }

      return null;
    } catch (error) {
      if (isSplitPollingCancelled(pollToken, currentVideoId)) {
        return null;
      }

      const errorMessage = getSplitErrorMessage(error, activeTaskId ? '视频分割' : '分割任务启动');
      const currentProgress = useGenerationStore.getState().splitProgress.progress ?? 0;

      setSegmentsError(errorMessage);
      markSplitFailure({
        taskId: activeTaskId,
        progress: activeTaskId ? currentProgress : 0,
        message: errorMessage,
        title: activeTaskId ? '分割任务失败' : '分割任务启动失败'
      });

      return null;
    }
  };

  return {
    segments,
    splitProgress,
    segmentsLoading,
    segmentsError,
    splitFromAnalysis,
    refreshSegments
  };
};

export { useSegments };
