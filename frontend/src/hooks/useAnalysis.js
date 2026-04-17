import { useEffect } from 'react';

import { analyzeVideo, getAnalysis } from '../services/api.js';
import { websocketService } from '../services/websocket.js';
import { useAnalysisStore } from '../store/analysisStore.js';
import { useVideoStore } from '../store/videoStore.js';

const useAnalysis = () => {
  const currentVideo = useVideoStore((state) => state.currentVideo);
  const updateCurrentVideo = useVideoStore((state) => state.updateCurrentVideo);
  const analysis = useAnalysisStore((state) => state.analysis);
  const loading = useAnalysisStore((state) => state.loading);
  const error = useAnalysisStore((state) => state.error);
  const progress = useAnalysisStore((state) => state.progress);
  const status = useAnalysisStore((state) => state.status);
  const statusMessage = useAnalysisStore((state) => state.statusMessage);
  const setAnalysis = useAnalysisStore((state) => state.setAnalysis);
  const setError = useAnalysisStore((state) => state.setError);
  const setProgressState = useAnalysisStore((state) => state.setProgressState);
  const clearAnalysis = useAnalysisStore((state) => state.clearAnalysis);

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

    websocketService.emitLocal('analysis:progress', {
      video_id: currentVideoId,
      progress: 12,
      status: 'processing',
      message: '正在提交 Gemini 整片分析任务'
    });

    try {
      const analysisPayload = await analyzeVideo(currentVideo.id);

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
      websocketService.emitLocal('analysis:progress', {
        video_id: currentVideoId,
        progress: 100,
        status: 'failed',
        message: errorInstance.message
      });

      return null;
    }
  };

  return {
    analysis,
    loading,
    error,
    progress,
    status,
    statusMessage,
    runAnalysis
  };
};

export { useAnalysis };
