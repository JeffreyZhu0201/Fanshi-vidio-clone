import { useEffect } from 'react';

import { getSegments, getTaskStatus, splitVideo, toAbsoluteAssetUrl } from '../services/api.js';
import { websocketService } from '../services/websocket.js';
import { useAnalysisStore } from '../store/analysisStore.js';
import { useGenerationStore } from '../store/generationStore.js';
import { useVideoStore } from '../store/videoStore.js';
import { sleep } from '../utils/sleep.js';

const normalizeSegment = (segment) => ({
  id: segment.id,
  segmentIndex: segment.segment_index,
  startTime: Number(segment.start_time),
  endTime: Number(segment.end_time),
  sourceUrl: toAbsoluteAssetUrl(segment.file_url),
  sourcePath: segment.file_path,
  generatedUrl: toAbsoluteAssetUrl(segment.latest_generation_task?.result_url),
  scene: segment.analysis?.scene ?? '',
  action: segment.analysis?.action ?? '',
  prompt: segment.analysis?.prompt ?? '',
  characters: segment.analysis?.characters ?? [],
  highlightedPrompt: '',
  latestGenerationTask: segment.latest_generation_task
    ? {
        task_id: segment.latest_generation_task.id,
        status: segment.latest_generation_task.status,
        progress: segment.latest_generation_task.progress,
        result_url: toAbsoluteAssetUrl(segment.latest_generation_task.result_url)
      }
    : null
});

const useSegments = () => {
  const currentVideo = useVideoStore((state) => state.currentVideo);
  const analysis = useAnalysisStore((state) => state.analysis);
  const segments = useGenerationStore((state) => state.segments);
  const splitProgress = useGenerationStore((state) => state.splitProgress);
  const segmentsLoading = useGenerationStore((state) => state.segmentsLoading);
  const segmentsError = useGenerationStore((state) => state.segmentsError);
  const setSegments = useGenerationStore((state) => state.setSegments);
  const setSplitProgress = useGenerationStore((state) => state.setSplitProgress);
  const setSegmentsLoading = useGenerationStore((state) => state.setSegmentsLoading);
  const setSegmentsError = useGenerationStore((state) => state.setSegmentsError);

  useEffect(() => {
    return websocketService.subscribe('split:progress', (payload) => {
      setSplitProgress({
        taskId: payload.task_id ?? payload.taskId ?? '',
        status: payload.status ?? 'processing',
        progress: payload.progress ?? 0,
        message: payload.message ?? '正在切分视频',
        errorMessage: payload.errorMessage ?? ''
      });
    });
  }, [setSplitProgress]);

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

  const refreshSegments = async () => {
    if (!currentVideo?.id) {
      return [];
    }

    setSegmentsLoading(true);

    try {
      const segmentPayload = await getSegments(currentVideo.id);
      const normalizedSegments = segmentPayload.map(normalizeSegment);
      setSegments(normalizedSegments);
      return normalizedSegments;
    } catch (error) {
      setSegmentsError(error.message);
      return [];
    }
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

    const splitTask = await splitVideo(currentVideo.id, analysis.time_anchors);
    websocketService.emitLocal('split:progress', {
      task_id: splitTask.task_id,
      status: splitTask.status,
      progress: splitTask.progress ?? 0,
      message: '分割任务已提交'
    });

    while (true) {
      const progressPayload = await getTaskStatus(splitTask.task_id);

      websocketService.emitLocal('split:progress', progressPayload);

      if (progressPayload.status === 'completed') {
        await refreshSegments();
        return progressPayload;
      }

      if (progressPayload.status === 'failed') {
        setSegmentsError(progressPayload.message || '视频分割失败。');
        return progressPayload;
      }

      await sleep(1200);
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
