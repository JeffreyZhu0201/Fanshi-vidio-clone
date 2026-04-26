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

const normalizeUseReferenceVideo = (value) => value !== false;
const normalizeUseReferenceFrame = (value) => value !== false;

const normalizeShotGenerationTask = (taskPayload) => {
  if (!taskPayload) {
    return null;
  }

  return {
    task_id: taskPayload.task_id ?? taskPayload.id,
    segment_id: Number(taskPayload.segment_id ?? 0) || null,
    shot_id: taskPayload.shot_id ?? '',
    shot_index: Number(taskPayload.shot_index ?? 0) || 0,
    status: taskPayload.status ?? 'pending',
    progress: taskPayload.progress ?? 0,
    prompt: taskPayload.prompt ?? '',
    optimizedPrompt: taskPayload.optimized_prompt ?? '',
    start_time:
      Number.isFinite(Number(taskPayload.start_time)) && Number(taskPayload.start_time) >= 0
        ? Number(Number(taskPayload.start_time).toFixed(2))
        : null,
    end_time:
      Number.isFinite(Number(taskPayload.end_time)) && Number(taskPayload.end_time) >= 0
        ? Number(Number(taskPayload.end_time).toFixed(2))
        : null,
    duration_seconds:
      Number.isFinite(Number(taskPayload.duration_seconds)) && Number(taskPayload.duration_seconds) >= 0
        ? Number(Number(taskPayload.duration_seconds).toFixed(2))
        : null,
    result_url: toAbsoluteAssetUrl(taskPayload.result_url),
    error_message: taskPayload.error_message ?? '',
    engine: taskPayload.engine ?? '',
    is_mock: Boolean(taskPayload.is_mock),
    use_reference_video: normalizeUseReferenceVideo(taskPayload.use_reference_video),
    use_reference_frame: normalizeUseReferenceFrame(taskPayload.use_reference_frame),
    remote_task_id: taskPayload.remote_task_id ?? '',
    fallback_reason: taskPayload.fallback_reason ?? '',
    provider_error: taskPayload.provider_error ?? '',
    source: taskPayload.source ?? '',
    sent_reference_images: Array.isArray(taskPayload.sent_reference_images) ? taskPayload.sent_reference_images : [],
    sent_reference_videos: Array.isArray(taskPayload.sent_reference_videos) ? taskPayload.sent_reference_videos : [],
    sent_reference_audios: Array.isArray(taskPayload.sent_reference_audios) ? taskPayload.sent_reference_audios : [],
    created_at: taskPayload.created_at,
    updated_at: taskPayload.updated_at
  };
};

const isTaskMockLike = (task) => {
  const engine = String(task?.engine ?? '').trim().toLowerCase();
  const fallbackReason = String(task?.fallback_reason ?? '').trim().toLowerCase();

  return (
    Boolean(task?.is_mock) ||
    engine.includes('mock') ||
    fallbackReason.includes('remote_generation_failed') ||
    fallbackReason.includes('missing_remote_config')
  );
};

const getUsableCompletedTaskResultUrl = (task) => {
  if (!task || task.status !== 'completed' || !task.result_url || isTaskMockLike(task)) {
    return '';
  }

  return task.result_url;
};

const normalizeShotGenerationSummary = (summaryPayload) => {
  if (!summaryPayload) {
    return null;
  }

  return {
    segment_id: Number(summaryPayload.segment_id ?? 0) || null,
    status: summaryPayload.status ?? 'idle',
    progress: Number(summaryPayload.progress ?? 0) || 0,
    total_shot_count: Number(summaryPayload.total_shot_count ?? 0) || 0,
    completed_shot_count: Number(summaryPayload.completed_shot_count ?? 0) || 0,
    failed_shot_count: Number(summaryPayload.failed_shot_count ?? 0) || 0,
    processing_shot_count: Number(summaryPayload.processing_shot_count ?? 0) || 0,
    pending_assembly: Boolean(summaryPayload.pending_assembly),
    result_url: toAbsoluteAssetUrl(summaryPayload.result_url),
    error_message: summaryPayload.error_message ?? '',
    assembly_generation_task_id: Number(summaryPayload.assembly_generation_task_id ?? 0) || null,
    source: summaryPayload.source ?? '',
    started_at: summaryPayload.started_at ?? '',
    updated_at: summaryPayload.updated_at ?? ''
  };
};

const normalizeSegment = (segment) => {
  const normalizeGenerationTask = (taskPayload) => {
    if (!taskPayload) {
      return null;
    }

    return {
      task_id: taskPayload.id,
      status: taskPayload.status,
      progress: taskPayload.progress,
      prompt: taskPayload.prompt ?? '',
      optimizedPrompt: taskPayload.optimized_prompt ?? '',
      result_url: toAbsoluteAssetUrl(taskPayload.result_url),
      error_message: taskPayload.error_message ?? '',
      engine: taskPayload.engine ?? '',
      is_mock: Boolean(taskPayload.is_mock),
      use_reference_video: normalizeUseReferenceVideo(taskPayload.use_reference_video),
      use_reference_frame: normalizeUseReferenceFrame(taskPayload.use_reference_frame),
      remote_task_id: taskPayload.remote_task_id ?? '',
      fallback_reason: taskPayload.fallback_reason ?? '',
      provider_error: taskPayload.provider_error ?? '',
      source: taskPayload.source ?? '',
      sent_reference_images: Array.isArray(taskPayload.sent_reference_images) ? taskPayload.sent_reference_images : [],
      sent_reference_videos: Array.isArray(taskPayload.sent_reference_videos) ? taskPayload.sent_reference_videos : [],
      sent_reference_audios: Array.isArray(taskPayload.sent_reference_audios) ? taskPayload.sent_reference_audios : [],
      created_at: taskPayload.created_at,
      updated_at: taskPayload.updated_at
    };
  };

  const latestCompletedGenerationTask = normalizeGenerationTask(segment.latest_generation_task);
  const latestAttemptTask = normalizeGenerationTask(segment.latest_attempt_task) ?? latestCompletedGenerationTask;
  const normalizedShots = Array.isArray(segment.analysis?.shots)
    ? segment.analysis.shots.map((shot, shotIndex) => ({
        id: shot.id ?? `shot_${shotIndex + 1}`,
        shotIndex: Number(shot.shotIndex ?? shot.shot_index ?? shotIndex) || shotIndex,
        startTime:
          Number.isFinite(Number(shot.startTime ?? shot.start_time)) && Number(shot.startTime ?? shot.start_time) >= 0
            ? Number(Number(shot.startTime ?? shot.start_time).toFixed(2))
            : null,
        endTime:
          Number.isFinite(Number(shot.endTime ?? shot.end_time)) && Number(shot.endTime ?? shot.end_time) >= 0
            ? Number(Number(shot.endTime ?? shot.end_time).toFixed(2))
            : null,
        localStartTime:
          Number.isFinite(Number(shot.localStartTime ?? shot.local_start_time)) &&
          Number(shot.localStartTime ?? shot.local_start_time) >= 0
            ? Number(Number(shot.localStartTime ?? shot.local_start_time).toFixed(2))
            : null,
        localEndTime:
          Number.isFinite(Number(shot.localEndTime ?? shot.local_end_time)) &&
          Number(shot.localEndTime ?? shot.local_end_time) >= 0
            ? Number(Number(shot.localEndTime ?? shot.local_end_time).toFixed(2))
            : null,
        durationSeconds:
          Number.isFinite(Number(shot.durationSeconds ?? shot.duration_seconds)) &&
          Number(shot.durationSeconds ?? shot.duration_seconds) >= 0
            ? Number(Number(shot.durationSeconds ?? shot.duration_seconds).toFixed(2))
            : null,
        summary: shot.summary ?? '',
        prompt: shot.prompt ?? '',
        sceneNames: shot.sceneNames ?? shot.scene_names ?? [],
        characterNames: shot.characterNames ?? shot.character_names ?? [],
        representativeFrameTime:
          Number.isFinite(Number(shot.representativeFrameTime ?? shot.representative_frame_time)) &&
          Number(shot.representativeFrameTime ?? shot.representative_frame_time) >= 0
            ? Number(Number(shot.representativeFrameTime ?? shot.representative_frame_time).toFixed(2))
            : null,
        representativeFrameNote: shot.representativeFrameNote ?? shot.representative_frame_note ?? '',
        sourceFilePath: shot.sourceFilePath ?? shot.source_file_path ?? '',
        sourceFileUrl: toAbsoluteAssetUrl(shot.sourceFileUrl ?? shot.source_file_url),
        sourceLocalStartTime:
          Number.isFinite(Number(shot.sourceLocalStartTime ?? shot.source_local_start_time)) &&
          Number(shot.sourceLocalStartTime ?? shot.source_local_start_time) >= 0
            ? Number(Number(shot.sourceLocalStartTime ?? shot.source_local_start_time).toFixed(2))
            : null,
        sourceLocalEndTime:
          Number.isFinite(Number(shot.sourceLocalEndTime ?? shot.source_local_end_time)) &&
          Number(shot.sourceLocalEndTime ?? shot.source_local_end_time) >= 0
            ? Number(Number(shot.sourceLocalEndTime ?? shot.source_local_end_time).toFixed(2))
            : null,
        representativeFrameImagePath:
          shot.representativeFrameImagePath ?? shot.representative_frame_image_path ?? '',
        representativeFrameImageUrl: toAbsoluteAssetUrl(
          shot.representativeFrameImageUrl ?? shot.representative_frame_image_url
        ),
        representativeFrameActualTime:
          Number.isFinite(Number(shot.representativeFrameActualTime ?? shot.representative_frame_actual_time)) &&
          Number(shot.representativeFrameActualTime ?? shot.representative_frame_actual_time) >= 0
            ? Number(Number(shot.representativeFrameActualTime ?? shot.representative_frame_actual_time).toFixed(2))
            : null,
        sourceAudioFilePath: shot.sourceAudioFilePath ?? shot.source_audio_file_path ?? '',
        sourceAudioFileUrl: toAbsoluteAssetUrl(shot.sourceAudioFileUrl ?? shot.source_audio_file_url),
        speech: {
          transcript: shot.speech?.transcript ?? '',
          subtitleLines: Array.isArray(shot.speech?.subtitleLines ?? shot.speech?.subtitle_lines)
            ? (shot.speech?.subtitleLines ?? shot.speech?.subtitle_lines).map((line, lineIndex) => ({
                id: line.id ?? `subtitle_${lineIndex + 1}`,
                startTime:
                  Number.isFinite(Number(line.startTime ?? line.start_time)) &&
                  Number(line.startTime ?? line.start_time) >= 0
                    ? Number(Number(line.startTime ?? line.start_time).toFixed(2))
                    : 0,
                endTime:
                  Number.isFinite(Number(line.endTime ?? line.end_time)) &&
                  Number(line.endTime ?? line.end_time) >= 0
                    ? Number(Number(line.endTime ?? line.end_time).toFixed(2))
                    : 0,
                text: line.text ?? ''
              }))
            : [],
          speechStyle: shot.speech?.speechStyle ?? shot.speech?.speech_style ?? '',
          hasDialogue: Boolean(shot.speech?.hasDialogue ?? shot.speech?.has_dialogue),
          extractionStatus: shot.speech?.extractionStatus ?? shot.speech?.extraction_status ?? 'idle',
          extractionError: shot.speech?.extractionError ?? shot.speech?.extraction_error ?? '',
          subtitleFilePath: shot.speech?.subtitleFilePath ?? shot.speech?.subtitle_file_path ?? '',
          subtitleFileUrl: toAbsoluteAssetUrl(shot.speech?.subtitleFileUrl ?? shot.speech?.subtitle_file_url),
          sourceOfTruth: shot.speech?.sourceOfTruth ?? shot.speech?.source_of_truth ?? 'extracted'
        },
        characterStateRefs: Array.isArray(shot.characterStateRefs ?? shot.character_state_refs)
          ? (shot.characterStateRefs ?? shot.character_state_refs).map((stateRef) => ({
              characterName: stateRef.characterName ?? stateRef.character_name ?? '',
              stateId: stateRef.stateId ?? stateRef.state_id ?? '',
              stateName: stateRef.stateName ?? stateRef.state_name ?? '',
              summary: stateRef.summary ?? '',
              continuityPrompt: stateRef.continuityPrompt ?? stateRef.continuity_prompt ?? '',
              representativeFrameTime:
                Number.isFinite(Number(stateRef.representativeFrameTime ?? stateRef.representative_frame_time)) &&
                Number(stateRef.representativeFrameTime ?? stateRef.representative_frame_time) >= 0
                  ? Number(Number(stateRef.representativeFrameTime ?? stateRef.representative_frame_time).toFixed(2))
                  : null,
              representativeFrameImagePath:
                stateRef.representativeFrameImagePath ?? stateRef.representative_frame_image_path ?? '',
              representativeFrameImageUrl: toAbsoluteAssetUrl(
                stateRef.representativeFrameImageUrl ?? stateRef.representative_frame_image_url
              )
            }))
          : [],
        latestGenerationTask: normalizeShotGenerationTask(shot.latestGenerationTask ?? shot.latest_generation_task),
        latestCompletedGenerationTask: normalizeShotGenerationTask(
          shot.latestCompletedGenerationTask ?? shot.latest_completed_generation_task
        ),
        generatedUrl: getUsableCompletedTaskResultUrl(
          normalizeShotGenerationTask(shot.latestCompletedGenerationTask ?? shot.latest_completed_generation_task)
        )
      }))
    : [];
  const normalizedShotSummary = normalizeShotGenerationSummary(segment.shot_generation_summary);

  return {
    id: segment.id,
    segmentIndex: segment.segment_index,
    startTime: Number(segment.start_time),
    endTime: Number(segment.end_time),
    sourceUrl: toAbsoluteAssetUrl(segment.file_url),
    sourcePath: segment.file_path,
    generatedUrl: getUsableCompletedTaskResultUrl(latestCompletedGenerationTask),
    scene: segment.analysis?.scene ?? '',
    scenes: segment.analysis?.scenes ?? [],
    action: segment.analysis?.action ?? '',
    prompt: segment.analysis?.prompt ?? '',
    sceneSummary: segment.analysis?.sceneSummary ?? '',
    scenePrompt: segment.analysis?.scenePrompt ?? '',
    shots: normalizedShots,
    backgroundId: segment.analysis?.backgroundId ?? '',
    backgroundAction: segment.analysis?.backgroundAction ?? '',
    backgroundName: segment.analysis?.backgroundName ?? '',
    backgroundPrompt: segment.analysis?.backgroundPrompt ?? '',
    representativeFrameTime: segment.analysis?.representativeFrameTime ?? null,
    representativeFrameNote: segment.analysis?.representativeFrameNote ?? '',
    characters: segment.analysis?.characters ?? [],
    analysisOptions: segment.analysis?.analysisOptions ?? segment.analysis?.analysis_options ?? null,
    highlightedPrompt: '',
    shotGenerationSummary: normalizedShotSummary,
    latestShotAssemblyTask: normalizeShotGenerationSummary(segment.latest_shot_assembly_task) ?? normalizedShotSummary,
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
