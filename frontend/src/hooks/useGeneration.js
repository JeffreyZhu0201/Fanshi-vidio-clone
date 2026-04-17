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
import { generationSessionStorage, useGenerationStore } from '../store/generationStore.js';
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
  const beginMergeProgress = useGenerationStore((state) => state.beginMergeProgress);
  const resetMergeProgress = useGenerationStore((state) => state.resetMergeProgress);
  const updateTask = useGenerationStore((state) => state.updateTask);
  const setMergeProgress = useGenerationStore((state) => state.setMergeProgress);
  const [optimizingSegmentId, setOptimizingSegmentId] = useState(0);
  const [generatingSegmentIds, setGeneratingSegmentIds] = useState([]);
  const characters = analysis?.characters ?? [];

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

      updateSegment(resolvedSegmentId, {
        latestGenerationTask: {
          task_id: payloadTaskId,
          status: payload.status,
          progress: payload.progress,
          result_url: toAbsoluteAssetUrl(payload.result_url)
        },
        generatedUrl: toAbsoluteAssetUrl(payload.result_url)
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
        errorMessage: payload.error_message ?? ''
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
      beginMergeProgress({
        taskId: '',
        status: 'failed',
        progress: 0,
        message: '请先上传并处理视频，再执行拼接。'
      });
      return null;
    }

    const mergeTask = await mergeVideos(currentVideo.id);
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
