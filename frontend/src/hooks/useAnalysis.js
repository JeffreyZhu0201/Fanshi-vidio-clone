import { useEffect, useLayoutEffect, useRef } from 'react';

import { analyzeVideo, getAnalysis, isTransientApiError } from '../services/api.js';
import { websocketService } from '../services/websocket.js';
import { useAnalysisStore } from '../store/analysisStore.js';
import { useVideoStore } from '../store/videoStore.js';
import { sleep } from '../utils/sleep.js';

const ANALYSIS_RESULT_CONFIRM_MAX_RETRIES = 8;
const ANALYSIS_RESULT_CONFIRM_INTERVAL_MS = 3000;

const createAnalysisRecoveryError = () => {
  return '分析请求超时，且在确认窗口内未获取到结果，请稍后重试。';
};

const getAnalysisErrorMessage = (error) => {
  if (error?.statusCode === 404) {
    return '当前视频分析结果不存在或已失效，请刷新后重试。';
  }

  if (error?.isTimeout || error?.code === 'ECONNABORTED') {
    return '整片分析请求超时，请稍后重试。';
  }

  if (error?.isNetworkError || error?.statusCode === 0) {
    return '当前无法连接分析服务，请检查网络或后端服务状态。';
  }

  if (error?.statusCode >= 500) {
    return '服务端处理整片分析时出错，请稍后重试。';
  }

  return error?.message || '整片分析失败，请稍后重试。';
};

const useAnalysis = () => {
  const currentVideo = useVideoStore((state) => state.currentVideo);
  const updateCurrentVideo = useVideoStore((state) => state.updateCurrentVideo);
  const analysis = useAnalysisStore((state) => state.analysis);
  const loading = useAnalysisStore((state) => state.loading);
  const error = useAnalysisStore((state) => state.error);
  const progress = useAnalysisStore((state) => state.progress);
  const status = useAnalysisStore((state) => state.status);
  const statusMessage = useAnalysisStore((state) => state.statusMessage);
  const analysisOptions = useAnalysisStore((state) => state.analysisOptions);
  const setAnalysis = useAnalysisStore((state) => state.setAnalysis);
  const setAnalysisOptions = useAnalysisStore((state) => state.setAnalysisOptions);
  const setError = useAnalysisStore((state) => state.setError);
  const setProgressState = useAnalysisStore((state) => state.setProgressState);
  const clearAnalysis = useAnalysisStore((state) => state.clearAnalysis);
  const resetAnalysisState = useAnalysisStore((state) => state.resetAnalysisState);
  const mountedRef = useRef(false);
  const activeVideoIdRef = useRef(currentVideo?.id ?? null);
  const previousVideoIdRef = useRef(currentVideo?.id ?? null);
  const analysisRequestTokenRef = useRef(0);

  const cancelAnalysisRequest = () => {
    analysisRequestTokenRef.current += 1;
  };

  const beginAnalysisRequest = () => {
    const nextToken = analysisRequestTokenRef.current + 1;
    analysisRequestTokenRef.current = nextToken;
    return nextToken;
  };

  const isAnalysisRequestCancelled = (requestToken, videoId) => {
    const latestVideoId = useVideoStore.getState().currentVideo?.id ?? activeVideoIdRef.current ?? 0;

    return (
      !mountedRef.current ||
      Number(latestVideoId) !== Number(videoId ?? 0) ||
      analysisRequestTokenRef.current !== requestToken
    );
  };

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cancelAnalysisRequest();
    };
  }, []);

  useEffect(() => {
    activeVideoIdRef.current = currentVideo?.id ?? null;
    cancelAnalysisRequest();
  }, [currentVideo?.id]);

  useLayoutEffect(() => {
    const previousVideoId = previousVideoIdRef.current ?? null;
    const nextVideoId = currentVideo?.id ?? null;

    if (previousVideoId && Number(previousVideoId) !== Number(nextVideoId ?? 0)) {
      resetAnalysisState();
    }

    previousVideoIdRef.current = nextVideoId;
  }, [currentVideo?.id, resetAnalysisState]);

  const confirmAnalysisResult = async (videoId, requestToken) => {
    if (isAnalysisRequestCancelled(requestToken, videoId)) {
      return null;
    }

    setProgressState({
      progress: 92,
      status: 'processing',
      message: '分析请求超时，正在确认结果'
    });

    for (let attempt = 0; attempt < ANALYSIS_RESULT_CONFIRM_MAX_RETRIES; attempt += 1) {
      if (isAnalysisRequestCancelled(requestToken, videoId)) {
        return null;
      }

      const analysisState = useAnalysisStore.getState();

      if (analysisState.status === 'failed' && analysisState.error) {
        return null;
      }

      try {
        const analysisPayload = await getAnalysis(videoId);

        if (isAnalysisRequestCancelled(requestToken, videoId)) {
          return null;
        }

        setAnalysis(analysisPayload);
        updateCurrentVideo({
          status: 'analyzed'
        });

        return analysisPayload;
      } catch (errorInstance) {
        const isLastAttempt = attempt === ANALYSIS_RESULT_CONFIRM_MAX_RETRIES - 1;
        const canRetry = errorInstance.statusCode === 404 || isTransientApiError(errorInstance);

        if (!canRetry) {
          if (!isAnalysisRequestCancelled(requestToken, videoId)) {
            setError(getAnalysisErrorMessage(errorInstance));
          }
          return null;
        }

        if (isLastAttempt) {
          if (!isAnalysisRequestCancelled(requestToken, videoId)) {
            setError(createAnalysisRecoveryError());
          }
          return null;
        }

        await sleep(ANALYSIS_RESULT_CONFIRM_INTERVAL_MS);
      }
    }

    if (!isAnalysisRequestCancelled(requestToken, videoId)) {
      setError(createAnalysisRecoveryError());
    }

    return null;
  };

  useEffect(() => {
    return websocketService.subscribe('analysis:progress', (payload) => {
      const activeVideoId = useVideoStore.getState().currentVideo?.id;
      const payloadVideoId = Number(payload.video_id ?? payload.videoId ?? 0);

      // Analysis progress should only mutate the panel for the currently selected video.
      if (!activeVideoId || payloadVideoId !== Number(activeVideoId)) {
        return;
      }

      setProgressState({
        progress: payload.progress ?? 0,
        status: payload.status ?? 'processing',
        message: payload.message ?? '正在分析整片视频'
      });

      if (payload.status === 'failed') {
        setError(payload.message || '分析失败');
      }
    });
  }, [setError, setProgressState]);

  useEffect(() => {
    if (!currentVideo?.id) {
      clearAnalysis();
      return undefined;
    }

    if (currentVideo.status !== 'analyzed') {
      clearAnalysis();
      return undefined;
    }

    let active = true;

    const hydrateExistingAnalysis = async () => {
      try {
        const analysisPayload = await getAnalysis(currentVideo.id);

        if (active) {
          setAnalysis(analysisPayload);
        }
      } catch (errorInstance) {
        if (!active) {
          return;
        }

        if (errorInstance.statusCode === 404) {
          clearAnalysis();
          return;
        }

        setError(errorInstance.message);
      }
    };

    void hydrateExistingAnalysis();

    return () => {
      active = false;
    };
  }, [clearAnalysis, currentVideo?.id, setAnalysis, setError]);

  const runAnalysis = async () => {
    if (!currentVideo?.id) {
      setError('请先上传视频，再执行整片分析。');
      return null;
    }

    const currentVideoId = currentVideo.id;
    const requestToken = beginAnalysisRequest();
    updateCurrentVideo({
      status: 'analyzing'
    });

    websocketService.emitLocal('analysis:progress', {
      video_id: currentVideoId,
      progress: 12,
      status: 'processing',
      message: '正在提交 Gemini 整片分析任务'
    });

    try {
      const analysisPayload = await analyzeVideo(currentVideo.id, analysisOptions);

      if (isAnalysisRequestCancelled(requestToken, currentVideoId)) {
        return null;
      }

      setAnalysis(analysisPayload);
      updateCurrentVideo({
        status: 'analyzed'
      });

      websocketService.emitLocal('analysis:progress', {
        video_id: currentVideoId,
        progress: 100,
        status: 'completed',
        message: '整片分析已完成'
      });

      return analysisPayload;
    } catch (errorInstance) {
      if (isAnalysisRequestCancelled(requestToken, currentVideoId)) {
        return null;
      }

      if (isTransientApiError(errorInstance)) {
        return confirmAnalysisResult(currentVideoId, requestToken);
      }

      const errorMessage = getAnalysisErrorMessage(errorInstance);

      websocketService.emitLocal('analysis:progress', {
        video_id: currentVideoId,
        progress: 100,
        status: 'failed',
        message: errorMessage
      });

      setError(errorMessage);

      return null;
    }
  };

  return {
    analysis,
    analysisOptions,
    loading,
    error,
    progress,
    status,
    statusMessage,
    runAnalysis,
    setAnalysisOptions
  };
};

export { useAnalysis };
