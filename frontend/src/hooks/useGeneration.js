import { useEffect, useState } from 'react';

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
import { useGenerationStore } from '../store/generationStore.js';
import { useVideoStore } from '../store/videoStore.js';
import { downloadBlobInBrowser } from '../utils/browserDownload.js';
import { sleep } from '../utils/sleep.js';

const useGeneration = () => {
  const currentVideo = useVideoStore((state) => state.currentVideo);
  const analysis = useAnalysisStore((state) => state.analysis);
  const segments = useGenerationStore((state) => state.segments);
  const tasks = useGenerationStore((state) => state.tasks);
  const mergeProgress = useGenerationStore((state) => state.mergeProgress);
  const updateSegment = useGenerationStore((state) => state.updateSegment);
  const addTask = useGenerationStore((state) => state.addTask);
  const updateTask = useGenerationStore((state) => state.updateTask);
  const setMergeProgress = useGenerationStore((state) => state.setMergeProgress);
  const [optimizingSegmentId, setOptimizingSegmentId] = useState(0);
  const [generatingSegmentIds, setGeneratingSegmentIds] = useState([]);
  const characters = analysis?.characters ?? [];

  useEffect(() => {
    return websocketService.subscribe('generation:progress', (payload) => {
      updateTask(payload.task_id, payload);

      if (payload.segment_id) {
        updateSegment(payload.segment_id, {
          latestGenerationTask: {
            task_id: payload.task_id,
            status: payload.status,
            progress: payload.progress,
            result_url: toAbsoluteAssetUrl(payload.result_url)
          },
          generatedUrl: toAbsoluteAssetUrl(payload.result_url)
        });
      }
    });
  }, [updateSegment, updateTask]);

  useEffect(() => {
    return websocketService.subscribe('merge:progress', (payload) => {
      setMergeProgress({
        taskId: payload.task_id ?? payload.taskId ?? '',
        status: payload.status ?? 'processing',
        progress: payload.progress ?? 0,
        message: payload.message ?? '正在拼接视频',
        errorMessage: payload.error_message ?? ''
      });
    });
  }, [setMergeProgress]);

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

    setOptimizingSegmentId(segmentId);

    try {
      const optimizedPayload = await optimizePrompt(segment.prompt, characters);

      updateSegment(segmentId, {
        prompt: optimizedPayload.optimized_prompt || segment.prompt,
        highlightedPrompt: optimizedPayload.highlighted_prompt || ''
      });

      return optimizedPayload;
    } finally {
      setOptimizingSegmentId(0);
    }
  };

  const generateSegmentVideo = async (segmentId) => {
    const segment = segments.find((item) => item.id === segmentId);

    if (!segment) {
      return null;
    }

    setGeneratingSegmentIds((state) => [...state, segmentId]);

    try {
      const startPayload = await generateSegment(segmentId, segment.prompt);

      addTask({
        ...startPayload,
        segment_id: segmentId
      });
      websocketService.emitLocal('generation:progress', {
        ...startPayload,
        segment_id: segmentId
      });

      while (true) {
        const taskPayload = await getGenerationTask(startPayload.task_id);
        websocketService.emitLocal('generation:progress', taskPayload);

        if (taskPayload.status === 'completed' || taskPayload.status === 'failed') {
          return taskPayload;
        }

        await sleep(1200);
      }
    } finally {
      setGeneratingSegmentIds((state) => state.filter((item) => item !== segmentId));
    }
  };

  const startMerge = async () => {
    if (!currentVideo?.id) {
      setMergeProgress({
        status: 'failed',
        progress: 0,
        message: '请先上传并处理视频，再执行拼接。'
      });
      return null;
    }

    const mergeTask = await mergeVideos(currentVideo.id);

    websocketService.emitLocal('merge:progress', {
      task_id: mergeTask.task_id,
      status: mergeTask.status,
      progress: 0,
      message: '拼接任务已提交'
    });

    while (true) {
      const mergeTaskProgress = await getMergeProgress(mergeTask.task_id);

      websocketService.emitLocal('merge:progress', {
        task_id: mergeTask.task_id,
        ...mergeTaskProgress
      });

      if (mergeTaskProgress.status === 'completed' || mergeTaskProgress.status === 'failed') {
        return mergeTaskProgress;
      }

      await sleep(1200);
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
