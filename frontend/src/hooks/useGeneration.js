import { useEffect, useRef, useState } from 'react';

import {
  analyzeSegment,
  downloadVideo,
  generateSegment,
  generateShot,
  generateShotBatch,
  getBackgroundAssets,
  getGenerationTask,
  getShotGenerationTask,
  getMergeProgress,
  mergeVideos,
  optimizePrompt,
  updateSegmentShots,
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

  if (error?.statusCode === 503 && error?.message) {
    return error.message;
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

const normalizeBackgroundAsset = (backgroundAsset) => {
  return {
    id: backgroundAsset.id,
    videoId: Number(backgroundAsset.video_id),
    backgroundId: backgroundAsset.background_id ?? '',
    assetType: backgroundAsset.asset_type ?? 'reference_video',
    status: backgroundAsset.status ?? 'pending',
    name: backgroundAsset.name ?? '',
    description: backgroundAsset.description ?? '',
    scenePrompt: backgroundAsset.scene_prompt ?? '',
    assetPath: backgroundAsset.asset_path ?? '',
    assetUrl: toAbsoluteAssetUrl(backgroundAsset.asset_url),
    sourceSegmentId: Number(backgroundAsset.source_segment_id ?? 0) || null,
    representativeFrameTime:
      Number.isFinite(Number(backgroundAsset.representative_frame_time)) &&
      Number(backgroundAsset.representative_frame_time) >= 0
        ? Number(Number(backgroundAsset.representative_frame_time).toFixed(2))
        : null,
    errorMessage: backgroundAsset.error_message ?? '',
    meta: backgroundAsset.meta ?? {},
    createdAt: backgroundAsset.created_at,
    updatedAt: backgroundAsset.updated_at
  };
};

const normalizeShotTask = (taskPayload) => {
  if (!taskPayload) {
    return null;
  }

  return {
    task_id: taskPayload.task_id ?? taskPayload.id,
    segment_id: Number(taskPayload.segment_id ?? 0) || null,
    shot_id: taskPayload.shot_id ?? '',
    shot_index: Number(taskPayload.shot_index ?? 0) || 0,
    status: taskPayload.status ?? 'pending',
    progress: Number(taskPayload.progress ?? 0) || 0,
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
    remote_task_id: taskPayload.remote_task_id ?? '',
    remote_status: taskPayload.remote_status ?? '',
    remote_status_label: taskPayload.remote_status_label ?? '',
    remote_created_at:
      Number.isFinite(Number(taskPayload.remote_created_at)) && Number(taskPayload.remote_created_at) > 0
        ? Number(taskPayload.remote_created_at)
        : null,
    remote_updated_at:
      Number.isFinite(Number(taskPayload.remote_updated_at)) && Number(taskPayload.remote_updated_at) > 0
        ? Number(taskPayload.remote_updated_at)
        : null,
    fallback_reason: taskPayload.fallback_reason ?? '',
    provider_error: taskPayload.provider_error ?? '',
    source: taskPayload.source ?? '',
    created_at: taskPayload.created_at,
    updated_at: taskPayload.updated_at
  };
};

const normalizeGenerationTask = (taskPayload) => {
  if (!taskPayload) {
    return null;
  }

  return {
    task_id: taskPayload.task_id ?? taskPayload.id,
    status: taskPayload.status ?? 'pending',
    progress: Number(taskPayload.progress ?? 0) || 0,
    prompt: taskPayload.prompt ?? '',
    optimizedPrompt: taskPayload.optimized_prompt ?? '',
    result_url: toAbsoluteAssetUrl(taskPayload.result_url),
    error_message: taskPayload.error_message ?? '',
    engine: taskPayload.engine ?? '',
    is_mock: Boolean(taskPayload.is_mock),
    remote_task_id: taskPayload.remote_task_id ?? '',
    remote_status: taskPayload.remote_status ?? '',
    remote_status_label: taskPayload.remote_status_label ?? '',
    remote_created_at:
      Number.isFinite(Number(taskPayload.remote_created_at)) && Number(taskPayload.remote_created_at) > 0
        ? Number(taskPayload.remote_created_at)
        : null,
    remote_updated_at:
      Number.isFinite(Number(taskPayload.remote_updated_at)) && Number(taskPayload.remote_updated_at) > 0
        ? Number(taskPayload.remote_updated_at)
        : null,
    fallback_reason: taskPayload.fallback_reason ?? '',
    provider_error: taskPayload.provider_error ?? '',
    source: taskPayload.source ?? '',
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

const normalizeShotAssemblyPayload = (payload) => {
  if (!payload) {
    return null;
  }

  return {
    segment_id: Number(payload.segment_id ?? 0) || null,
    status: payload.status ?? 'idle',
    progress: Number(payload.progress ?? 0) || 0,
    total_shot_count: Number(payload.total_shot_count ?? 0) || 0,
    completed_shot_count: Number(payload.completed_shot_count ?? 0) || 0,
    failed_shot_count: Number(payload.failed_shot_count ?? 0) || 0,
    processing_shot_count: Number(payload.processing_shot_count ?? 0) || 0,
    pending_assembly: Boolean(payload.pending_assembly),
    result_url: toAbsoluteAssetUrl(payload.result_url),
    error_message: payload.error_message ?? '',
    assembly_generation_task_id: Number(payload.assembly_generation_task_id ?? 0) || null,
    source: payload.source ?? '',
    started_at: payload.started_at ?? '',
    updated_at: payload.updated_at ?? ''
  };
};

const getShotRuntimeKey = (segmentId, shotId) => `${segmentId}:${shotId}`;

const buildClientShotSummary = (segment, shots, currentSummary = null) => {
  const totalShotCount = shots.length;
  const completedShotCount = shots.filter((shot) =>
    Boolean(getUsableCompletedTaskResultUrl(shot.latestCompletedGenerationTask))
  ).length;
  const failedShotCount = shots.filter((shot) => shot.latestGenerationTask?.status === 'failed').length;
  const processingShotCount = shots.filter((shot) =>
    ['pending', 'processing'].includes(shot.latestGenerationTask?.status)
  ).length;
  const resultUrl = currentSummary?.result_url ?? '';
  const baseStatus = currentSummary?.status ?? '';
  const status = resultUrl
    ? 'completed'
    : baseStatus === 'processing' && currentSummary?.pending_assembly
      ? 'processing'
      : processingShotCount > 0
        ? 'processing'
        : failedShotCount > 0
          ? 'failed'
          : completedShotCount > 0
            ? 'partial'
            : 'idle';
  const progress = resultUrl
    ? 100
    : totalShotCount
      ? Math.min(95, Math.round(((completedShotCount + failedShotCount) / totalShotCount) * 100))
      : 0;

  return {
    ...(currentSummary ?? {}),
    segment_id: segment.id,
    status,
    progress,
    total_shot_count: totalShotCount,
    completed_shot_count: completedShotCount,
    failed_shot_count: failedShotCount,
    processing_shot_count: processingShotCount
  };
};

const useGeneration = () => {
  const currentVideo = useVideoStore((state) => state.currentVideo);
  const analysis = useAnalysisStore((state) => state.analysis);
  const segments = useGenerationStore((state) => state.segments);
  const backgroundAssets = useGenerationStore((state) => state.backgroundAssets);
  const backgroundAssetsLoading = useGenerationStore((state) => state.backgroundAssetsLoading);
  const backgroundAssetsError = useGenerationStore((state) => state.backgroundAssetsError);
  const tasks = useGenerationStore((state) => state.tasks);
  const mergeProgress = useGenerationStore((state) => state.mergeProgress);
  const updateSegment = useGenerationStore((state) => state.updateSegment);
  const addTask = useGenerationStore((state) => state.addTask);
  const beginMergeProgress = useGenerationStore((state) => state.beginMergeProgress);
  const resetMergeProgress = useGenerationStore((state) => state.resetMergeProgress);
  const setBackgroundAssets = useGenerationStore((state) => state.setBackgroundAssets);
  const setBackgroundAssetsLoading = useGenerationStore((state) => state.setBackgroundAssetsLoading);
  const setBackgroundAssetsError = useGenerationStore((state) => state.setBackgroundAssetsError);
  const updateTask = useGenerationStore((state) => state.updateTask);
  const setMergeProgress = useGenerationStore((state) => state.setMergeProgress);
  const setSegmentsError = useGenerationStore((state) => state.setSegmentsError);
  const videoRatio = useGenerationStore((state) => state.videoRatio);
  const setVideoRatio = useGenerationStore((state) => state.setVideoRatio);
  const [analyzingSegmentId, setAnalyzingSegmentId] = useState(0);
  const [optimizingSegmentId, setOptimizingSegmentId] = useState(0);
  const [generatingSegmentIds, setGeneratingSegmentIds] = useState([]);
  const [generatingShotKeys, setGeneratingShotKeys] = useState([]);
  const [batchGeneratingSegmentIds, setBatchGeneratingSegmentIds] = useState([]);
  const [optimizingShotKeys, setOptimizingShotKeys] = useState([]);
  const [savingShotSegmentIds, setSavingShotSegmentIds] = useState([]);
  const characters = analysis?.characters ?? [];
  const backgrounds = analysis?.backgrounds ?? [];
  const mountedRef = useRef(false);
  const activeVideoIdRef = useRef(currentVideo?.id ?? null);
  const previousVideoIdRef = useRef(currentVideo?.id ?? null);
  const segmentAnalysisRequestTokenRef = useRef(0);
  const optimizeRequestTokenRef = useRef(0);
  const generationPollingTokenRef = useRef(new Map());
  const shotGenerationPollingTokenRef = useRef(new Map());
  const mergePollingTokenRef = useRef(0);

  const getResolvedVideoRatio = () => {
    const normalizedRatio = String(useGenerationStore.getState().videoRatio ?? videoRatio ?? '')
      .trim()
      .toLowerCase();

    return /^[1-9]\d{0,2}:[1-9]\d{0,2}$/u.test(normalizedRatio) ? normalizedRatio : '16:9';
  };

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

  const beginSegmentAnalysisRequest = () => {
    const nextToken = segmentAnalysisRequestTokenRef.current + 1;
    segmentAnalysisRequestTokenRef.current = nextToken;
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

  const beginShotGenerationPolling = (segmentId, shotId) => {
    const shotRuntimeKey = getShotRuntimeKey(segmentId, shotId);
    const currentToken = shotGenerationPollingTokenRef.current.get(shotRuntimeKey) ?? 0;
    const nextToken = currentToken + 1;
    shotGenerationPollingTokenRef.current.set(shotRuntimeKey, nextToken);
    return nextToken;
  };

  const isShotGenerationPollingCancelled = (segmentId, shotId, requestToken, videoId) => {
    const latestVideoId = useVideoStore.getState().currentVideo?.id ?? activeVideoIdRef.current ?? 0;
    const shotRuntimeKey = getShotRuntimeKey(segmentId, shotId);

    return (
      !mountedRef.current ||
      Number(latestVideoId) !== Number(videoId ?? 0) ||
      shotGenerationPollingTokenRef.current.get(shotRuntimeKey) !== requestToken
    );
  };

  const beginMergePolling = () => {
    const nextToken = mergePollingTokenRef.current + 1;
    mergePollingTokenRef.current = nextToken;
    return nextToken;
  };

  const getCurrentSegmentById = (segmentId) => {
    return useGenerationStore.getState().segments.find((item) => item.id === segmentId) ?? null;
  };

  const markSegmentGenerating = (segmentId, isGenerating) => {
    if (!mountedRef.current) {
      return;
    }

    setGeneratingSegmentIds((state) =>
      isGenerating ? [...new Set([...state, segmentId])] : state.filter((item) => item !== segmentId)
    );
  };

  const markShotGenerating = (segmentId, shotId, isGenerating) => {
    if (!mountedRef.current) {
      return;
    }

    const shotRuntimeKey = getShotRuntimeKey(segmentId, shotId);

    setGeneratingShotKeys((state) =>
      isGenerating ? [...new Set([...state, shotRuntimeKey])] : state.filter((item) => item !== shotRuntimeKey)
    );
  };

  const markShotBatchGenerating = (segmentId, isGenerating) => {
    if (!mountedRef.current) {
      return;
    }

    setBatchGeneratingSegmentIds((state) =>
      isGenerating ? [...new Set([...state, segmentId])] : state.filter((item) => item !== segmentId)
    );
  };

  const markShotOptimizing = (segmentId, shotId, isOptimizing) => {
    if (!mountedRef.current) {
      return;
    }

    const shotRuntimeKey = getShotRuntimeKey(segmentId, shotId);

    setOptimizingShotKeys((state) =>
      isOptimizing ? [...new Set([...state, shotRuntimeKey])] : state.filter((item) => item !== shotRuntimeKey)
    );
  };

  const markShotDefinitionsSaving = (segmentId, isSaving) => {
    if (!mountedRef.current) {
      return;
    }

    setSavingShotSegmentIds((state) =>
      isSaving ? [...new Set([...state, segmentId])] : state.filter((item) => item !== segmentId)
    );
  };

  const markSegmentGenerationFailure = (segmentId, message, taskId = '') => {
    const state = useGenerationStore.getState();
    const currentSegment = state.segments.find((segment) => segment.id === segmentId);

    if (!currentSegment) {
      return;
    }

    const failedTask = normalizeGenerationTask({
      ...currentSegment.latestGenerationTask,
      task_id: taskId || currentSegment.latestGenerationTask?.task_id || '',
      status: 'failed',
      progress: currentSegment.latestGenerationTask?.progress ?? 0,
      prompt: currentSegment.latestGenerationTask?.prompt ?? currentSegment.prompt ?? '',
      optimized_prompt: currentSegment.latestGenerationTask?.optimizedPrompt ?? '',
      result_url: currentSegment.latestGenerationTask?.result_url ?? '',
      error_message: message,
      source: currentSegment.latestGenerationTask?.source ?? '',
      created_at: currentSegment.latestGenerationTask?.created_at,
      updated_at: new Date().toISOString()
    });

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

  const updateSegmentShot = (segmentId, shotId, partialShot) => {
    const currentSegment = useGenerationStore.getState().segments.find((segment) => segment.id === segmentId);

    if (!currentSegment) {
      return;
    }

    updateSegment(segmentId, {
      shots: (currentSegment.shots ?? []).map((shot) =>
        shot.id === shotId
          ? {
              ...shot,
              ...partialShot
            }
          : shot
      )
    });
  };

  const hydrateSegmentFromApiPayload = (segmentId, segmentPayload) => {
    const currentSegment = useGenerationStore.getState().segments.find((segment) => segment.id === segmentId);

    if (!currentSegment || !segmentPayload) {
      return null;
    }

    const normalizedShots = Array.isArray(segmentPayload.analysis?.shots)
      ? segmentPayload.analysis.shots.map((shot, shotIndex) => ({
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
          latestGenerationTask: normalizeShotTask(shot.latestGenerationTask ?? shot.latest_generation_task),
          latestCompletedGenerationTask: normalizeShotTask(
            shot.latestCompletedGenerationTask ?? shot.latest_completed_generation_task
          ),
          generatedUrl: getUsableCompletedTaskResultUrl(
            normalizeShotTask(shot.latestCompletedGenerationTask ?? shot.latest_completed_generation_task)
          )
        }))
      : currentSegment.shots ?? [];

    updateSegment(segmentId, {
      scene: segmentPayload.analysis?.scene ?? currentSegment.scene,
      scenes: segmentPayload.analysis?.scenes ?? currentSegment.scenes ?? [],
      action: segmentPayload.analysis?.action ?? currentSegment.action,
      prompt: segmentPayload.analysis?.prompt ?? currentSegment.prompt,
      shots: normalizedShots,
      characters: segmentPayload.analysis?.characters ?? currentSegment.characters,
      sceneSummary: segmentPayload.analysis?.sceneSummary ?? currentSegment.sceneSummary,
      scenePrompt: segmentPayload.analysis?.scenePrompt ?? currentSegment.scenePrompt,
      backgroundId: segmentPayload.analysis?.backgroundId ?? currentSegment.backgroundId,
      backgroundAction: segmentPayload.analysis?.backgroundAction ?? currentSegment.backgroundAction,
      backgroundName: segmentPayload.analysis?.backgroundName ?? currentSegment.backgroundName,
      backgroundPrompt: segmentPayload.analysis?.backgroundPrompt ?? currentSegment.backgroundPrompt,
      shotGenerationSummary:
        normalizeShotAssemblyPayload(segmentPayload.shot_generation_summary) ?? currentSegment.shotGenerationSummary,
      latestShotAssemblyTask:
        normalizeShotAssemblyPayload(segmentPayload.latest_shot_assembly_task) ?? currentSegment.latestShotAssemblyTask,
      representativeFrameTime:
        segmentPayload.analysis?.representativeFrameTime ?? currentSegment.representativeFrameTime,
      representativeFrameNote:
        segmentPayload.analysis?.representativeFrameNote ?? currentSegment.representativeFrameNote,
      highlightedPrompt: '',
      latestCompletedGenerationTask: normalizeGenerationTask(segmentPayload.latest_generation_task),
      latestGenerationTask: normalizeGenerationTask(segmentPayload.latest_attempt_task),
      generatedUrl: getUsableCompletedTaskResultUrl(normalizeGenerationTask(segmentPayload.latest_generation_task))
    });

    return segmentPayload;
  };

  const markShotGenerationFailure = (segmentId, shotId, message, taskId = '') => {
    const currentSegment = useGenerationStore.getState().segments.find((segment) => segment.id === segmentId);
    const currentShot = currentSegment?.shots?.find((shot) => shot.id === shotId);

    if (!currentShot) {
      return;
    }

    updateSegmentShot(segmentId, shotId, {
      latestGenerationTask: normalizeShotTask({
        ...currentShot.latestGenerationTask,
        task_id: taskId || currentShot.latestGenerationTask?.task_id || '',
        segment_id: segmentId,
        shot_id: shotId,
        shot_index: currentShot.shotIndex ?? 0,
        status: 'failed',
        progress: currentShot.latestGenerationTask?.progress ?? 0,
        prompt: currentShot.latestGenerationTask?.prompt ?? currentShot.prompt ?? '',
        optimized_prompt: currentShot.latestGenerationTask?.optimizedPrompt ?? '',
        result_url: currentShot.latestGenerationTask?.result_url ?? '',
        error_message: message,
        created_at: currentShot.latestGenerationTask?.created_at,
        updated_at: new Date().toISOString()
      })
    });
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
      segmentAnalysisRequestTokenRef.current += 1;
      optimizeRequestTokenRef.current += 1;
      generationPollingTokenRef.current = new Map();
      shotGenerationPollingTokenRef.current = new Map();
      mergePollingTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const previousVideoId = previousVideoIdRef.current;
    activeVideoIdRef.current = currentVideo?.id ?? null;
    segmentAnalysisRequestTokenRef.current += 1;
    optimizeRequestTokenRef.current += 1;
    generationPollingTokenRef.current = new Map();
    shotGenerationPollingTokenRef.current = new Map();
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
      setAnalyzingSegmentId(0);
      setOptimizingSegmentId(0);
      setGeneratingSegmentIds([]);
      setGeneratingShotKeys([]);
      setBatchGeneratingSegmentIds([]);
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
      const nextGenerationTask = normalizeGenerationTask({
        ...currentSegment?.latestGenerationTask,
        ...payload,
        task_id: payloadTaskId,
        prompt: payload.prompt ?? currentSegment?.latestGenerationTask?.prompt ?? currentSegment?.prompt ?? '',
        optimized_prompt:
          payload.optimized_prompt ?? currentSegment?.latestGenerationTask?.optimizedPrompt ?? '',
        error_message: payload.error_message ?? payload.message ?? ''
      });
      const nextGeneratedUrl = getUsableCompletedTaskResultUrl(nextGenerationTask);

      updateSegment(resolvedSegmentId, {
        latestGenerationTask: nextGenerationTask,
        latestCompletedGenerationTask:
          nextGeneratedUrl
            ? nextGenerationTask
            : currentSegment?.latestCompletedGenerationTask ?? null,
        generatedUrl: nextGeneratedUrl || currentSegment?.generatedUrl || ''
      });
    });
  }, [updateSegment, updateTask]);

  useEffect(() => {
    return websocketService.subscribe('shot:progress', (payload) => {
      const payloadSegmentId = Number(payload.segment_id ?? 0);
      const payloadShotId = String(payload.shot_id ?? '').trim();
      const currentSegment = useGenerationStore.getState().segments.find((segment) => segment.id === payloadSegmentId);

      if (!payloadSegmentId || !payloadShotId || !currentSegment) {
        return;
      }

      const nextShotTask = normalizeShotTask(payload);
      const nextShotGeneratedUrl = getUsableCompletedTaskResultUrl(nextShotTask);
      const nextShots = (currentSegment.shots ?? []).map((shot) =>
        shot.id === payloadShotId
          ? {
              ...shot,
              latestGenerationTask: nextShotTask,
              latestCompletedGenerationTask:
                nextShotGeneratedUrl
                  ? nextShotTask
                  : shot.latestCompletedGenerationTask ?? null,
              generatedUrl: nextShotGeneratedUrl || shot.generatedUrl || ''
            }
          : shot
      );
      const nextShotSummary = buildClientShotSummary(
        currentSegment,
        nextShots,
        currentSegment.shotGenerationSummary ?? currentSegment.latestShotAssemblyTask ?? null
      );

      updateSegment(payloadSegmentId, {
        shots: nextShots,
        shotGenerationSummary: nextShotSummary,
        latestShotAssemblyTask:
          nextShotSummary.result_url || nextShotSummary.pending_assembly
            ? currentSegment.latestShotAssemblyTask ?? nextShotSummary
            : nextShotSummary
      });

      if (['completed', 'failed'].includes(nextShotTask?.status)) {
        void refreshBackgroundAssets(Number(currentVideo?.id ?? 0), {
          silent: true
        });
      }
    });
  }, [currentVideo?.id, updateSegment]);

  useEffect(() => {
    return websocketService.subscribe('shot-assembly:progress', (payload) => {
      const payloadSegmentId = Number(payload.segment_id ?? 0);
      const currentSegment = useGenerationStore.getState().segments.find((segment) => segment.id === payloadSegmentId);

      if (!payloadSegmentId || !currentSegment) {
        return;
      }

      const normalizedSummary = normalizeShotAssemblyPayload(payload);

      updateSegment(payloadSegmentId, {
        shotGenerationSummary: normalizedSummary,
        latestShotAssemblyTask: normalizedSummary
      });

      if (['completed', 'failed'].includes(normalizedSummary?.status)) {
        markShotBatchGenerating(payloadSegmentId, false);
      }
    });
  }, [updateSegment]);

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

  const refreshBackgroundAssets = async (videoId = Number(currentVideo?.id ?? 0), options = {}) => {
    if (!videoId) {
      setBackgroundAssets([]);
      return [];
    }

    if (!options.silent) {
      setBackgroundAssetsLoading(true);
      setBackgroundAssetsError('');
    }

    try {
      const assetPayload = await getBackgroundAssets(videoId);

      if (Number(useVideoStore.getState().currentVideo?.id ?? activeVideoIdRef.current ?? 0) !== Number(videoId)) {
        return [];
      }

      const normalizedBackgroundAssets = assetPayload.map(normalizeBackgroundAsset);
      setBackgroundAssets(normalizedBackgroundAssets);
      return normalizedBackgroundAssets;
    } catch (error) {
      if (Number(useVideoStore.getState().currentVideo?.id ?? activeVideoIdRef.current ?? 0) === Number(videoId)) {
        setBackgroundAssetsError(getGenerationErrorMessage(error, '背景资产加载'));
      }

      return [];
    }
  };

  useEffect(() => {
    if (!currentVideo?.id) {
      setBackgroundAssets([]);
      return;
    }

    void refreshBackgroundAssets(Number(currentVideo.id));
  }, [currentVideo?.id, setBackgroundAssets]);

  const setSegmentPrompt = (segmentId, prompt) => {
    updateSegment(segmentId, {
      prompt
    });
  };

  const setShotPrompt = (segmentId, shotId, prompt) => {
    updateSegmentShot(segmentId, shotId, {
      prompt
    });
  };

  const analyzeSegmentById = async (segmentId) => {
    const segment = segments.find((item) => item.id === segmentId);

    if (!segment) {
      return null;
    }

    const requestVideoId = Number(currentVideo?.id ?? 0);
    const requestToken = beginSegmentAnalysisRequest();

    setSegmentsError('');
    setAnalyzingSegmentId(segmentId);

    try {
      const analyzedSegment = await analyzeSegment(segmentId);

      if (isVideoScopedRequestCancelled(requestToken, requestVideoId, segmentAnalysisRequestTokenRef)) {
        return null;
      }

      hydrateSegmentFromApiPayload(segmentId, analyzedSegment);

      return analyzedSegment;
    } catch (error) {
      if (isVideoScopedRequestCancelled(requestToken, requestVideoId, segmentAnalysisRequestTokenRef)) {
        return null;
      }

      setSegmentsError(getGenerationErrorMessage(error, '片段分析'));
      return null;
    } finally {
      if (!isVideoScopedRequestCancelled(requestToken, requestVideoId, segmentAnalysisRequestTokenRef)) {
        setAnalyzingSegmentId(0);
      }
    }
  };

  const optimizeSegmentPrompt = async (segmentId, promptOverride = '') => {
    const segment = segments.find((item) => item.id === segmentId);

    if (!segment) {
      return null;
    }

    const sourcePrompt = String(promptOverride ?? '').trim() || segment.prompt;

    if (!sourcePrompt?.trim()) {
      setSegmentsError('请先输入片段提示词，再执行优化。');
      return null;
    }

    const requestVideoId = Number(currentVideo?.id ?? 0);
    const requestToken = beginOptimizeRequest();

    setSegmentsError('');
    setOptimizingSegmentId(segmentId);

    if (sourcePrompt !== segment.prompt) {
      updateSegment(segmentId, {
        prompt: sourcePrompt
      });
    }

    try {
      const optimizedPayload = await optimizePrompt(sourcePrompt, characters, backgrounds);

      if (isVideoScopedRequestCancelled(requestToken, requestVideoId, optimizeRequestTokenRef)) {
        return null;
      }

      updateSegment(segmentId, {
        prompt: optimizedPayload.optimized_prompt || sourcePrompt,
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

  const optimizeShotPrompt = async ({
    segmentId,
    shotId,
    promptOverride = '',
    segmentPromptOverride = '',
    sceneNames = [],
    characterNames = []
  }) => {
    const segment = segments.find((item) => item.id === segmentId);
    const shot = segment?.shots?.find((item) => item.id === shotId);

    if (!segment || !shot) {
      return null;
    }

    const sourceShotPrompt = String(promptOverride ?? '').trim() || shot.prompt;
    const sourceSegmentPrompt = String(segmentPromptOverride ?? '').trim() || segment.prompt || '';

    if (!sourceShotPrompt?.trim()) {
      setSegmentsError('请先输入镜头提示词，再执行优化。');
      return null;
    }

    const requestVideoId = Number(currentVideo?.id ?? 0);
    const requestToken = beginOptimizeRequest();

    setSegmentsError('');
    markShotOptimizing(segmentId, shotId, true);

    try {
      const optimizedPayload = await optimizePrompt(sourceShotPrompt, characters, backgrounds, {
        mode: 'shot_generation',
        segment_prompt: sourceSegmentPrompt,
        shot_prompt: sourceShotPrompt,
        scene_names: sceneNames,
        character_names: characterNames
      });

      if (isVideoScopedRequestCancelled(requestToken, requestVideoId, optimizeRequestTokenRef)) {
        return null;
      }

      return optimizedPayload;
    } catch (error) {
      if (isVideoScopedRequestCancelled(requestToken, requestVideoId, optimizeRequestTokenRef)) {
        return null;
      }

      setSegmentsError(getGenerationErrorMessage(error, '镜头提示词优化'));
      return null;
    } finally {
      if (!isVideoScopedRequestCancelled(requestToken, requestVideoId, optimizeRequestTokenRef)) {
        markShotOptimizing(segmentId, shotId, false);
      }
    }
  };

  const saveSegmentShotDefinitions = async (segmentId, shots) => {
    const segment = getCurrentSegmentById(segmentId);

    if (!segment) {
      return null;
    }

    if (!Array.isArray(shots) || !shots.length) {
      setSegmentsError('请至少保留一个小镜头后再保存。');
      return null;
    }

    setSegmentsError('');
    markShotDefinitionsSaving(segmentId, true);

    try {
      const savedSegmentPayload = await updateSegmentShots(segmentId, shots);
      hydrateSegmentFromApiPayload(segmentId, savedSegmentPayload);
      return savedSegmentPayload;
    } catch (error) {
      setSegmentsError(getGenerationErrorMessage(error, '镜头保存'));
      return null;
    } finally {
      markShotDefinitionsSaving(segmentId, false);
    }
  };

  const generateSegmentVideo = async (segmentId, promptOverride = '') => {
    const segment = segments.find((item) => item.id === segmentId);

    if (!segment) {
      return null;
    }

    if (!currentVideo?.id) {
      setSegmentsError('请先上传并选择视频，再生成片段。');
      return null;
    }

    const sourcePrompt = String(promptOverride ?? '').trim() || segment.prompt;

    if (!sourcePrompt?.trim()) {
      setSegmentsError('请先输入片段提示词，再生成片段。');
      return null;
    }

    const requestVideoId = Number(currentVideo.id);
    const requestToken = beginGenerationPolling(segmentId);
    let activeTaskId = '';

    setSegmentsError('');
    markSegmentGenerating(segmentId, true);

    if (sourcePrompt !== segment.prompt) {
      updateSegment(segmentId, {
        prompt: sourcePrompt
      });
    }

    try {
      const startPayload = await generateSegment(segmentId, sourcePrompt, getResolvedVideoRatio());
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
      window.setTimeout(() => {
        void refreshBackgroundAssets(requestVideoId, {
          silent: true
        });
      }, 500);

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
          void refreshBackgroundAssets(requestVideoId, {
            silent: true
          });
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

  const generateShotVideo = async (segmentId, shotId, promptOverride = '') => {
    const segment = getCurrentSegmentById(segmentId);
    const shot = segment?.shots?.find((item) => item.id === shotId);

    if (!segment || !shot) {
      return null;
    }

    if (!currentVideo?.id) {
      setSegmentsError('请先上传并选择视频，再生成小镜头。');
      return null;
    }

    const sourcePrompt = String(promptOverride ?? '').trim() || shot.prompt;

    if (!sourcePrompt?.trim()) {
      setSegmentsError('请先输入镜头提示词，再生成小镜头。');
      return null;
    }

    const requestVideoId = Number(currentVideo.id);
    const requestToken = beginShotGenerationPolling(segmentId, shotId);
    let activeTaskId = '';

    setSegmentsError('');
    markShotGenerating(segmentId, shotId, true);

    if (sourcePrompt !== shot.prompt) {
      updateSegmentShot(segmentId, shotId, {
        prompt: sourcePrompt
      });
    }

    try {
      const startPayload = await generateShot(segmentId, shotId, sourcePrompt, getResolvedVideoRatio());
      activeTaskId = startPayload.task_id ?? '';

      if (isShotGenerationPollingCancelled(segmentId, shotId, requestToken, requestVideoId)) {
        return null;
      }

      websocketService.emitLocal('shot:progress', startPayload);
      window.setTimeout(() => {
        void refreshBackgroundAssets(requestVideoId, {
          silent: true
        });
      }, 500);

      while (!isShotGenerationPollingCancelled(segmentId, shotId, requestToken, requestVideoId)) {
        let taskPayload;

        try {
          taskPayload = await getShotGenerationTask(startPayload.task_id);
        } catch (error) {
          if (isShotGenerationPollingCancelled(segmentId, shotId, requestToken, requestVideoId)) {
            return null;
          }

          const errorMessage = getGenerationErrorMessage(error, '小镜头生成轮询');
          setSegmentsError(errorMessage);
          markShotGenerationFailure(segmentId, shotId, errorMessage, startPayload.task_id);
          return null;
        }

        if (isShotGenerationPollingCancelled(segmentId, shotId, requestToken, requestVideoId)) {
          return null;
        }

        websocketService.emitLocal('shot:progress', taskPayload);

        if (taskPayload.status === 'completed' || taskPayload.status === 'failed') {
          void refreshBackgroundAssets(requestVideoId, {
            silent: true
          });
          return taskPayload;
        }

        await sleep(1200);
      }

      return null;
    } catch (error) {
      if (isShotGenerationPollingCancelled(segmentId, shotId, requestToken, requestVideoId)) {
        return null;
      }

      const errorMessage = getGenerationErrorMessage(error, activeTaskId ? '小镜头生成' : '小镜头生成启动');
      setSegmentsError(errorMessage);
      markShotGenerationFailure(segmentId, shotId, errorMessage, activeTaskId);
      return null;
    } finally {
      if (!isShotGenerationPollingCancelled(segmentId, shotId, requestToken, requestVideoId)) {
        markShotGenerating(segmentId, shotId, false);
      }
    }
  };

  const generateAllShotsForSegment = async (segmentId, shotsOverride = null) => {
    const segment = getCurrentSegmentById(segmentId);

    if (!segment) {
      return null;
    }

    if (!currentVideo?.id) {
      setSegmentsError('请先上传并选择视频，再生成小镜头。');
      return null;
    }

    const shotsForGeneration =
      Array.isArray(shotsOverride) && shotsOverride.length ? shotsOverride : segment.shots ?? [];

    if (!shotsForGeneration.length) {
      setSegmentsError('当前片段还没有小镜头可生成。');
      return null;
    }

    setSegmentsError('');
    markShotBatchGenerating(segmentId, true);

    try {
      const batchPayload = await generateShotBatch(
        segmentId,
        shotsForGeneration.map((shot) => ({
          shot_id: shot.id,
          prompt: String(shot.prompt ?? '').trim() || String(shot.summary ?? '').trim()
        })),
        getResolvedVideoRatio()
      );
      const nextSummary = {
        segment_id: segmentId,
        status: batchPayload.status ?? 'processing',
        progress: Number(batchPayload.progress ?? (batchPayload.status === 'completed' ? 100 : 0)) || 0,
        total_shot_count: Number(batchPayload.shot_count ?? shotsForGeneration.length) || shotsForGeneration.length,
        completed_shot_count: Number(batchPayload.completed_shot_count ?? 0) || 0,
        failed_shot_count: Number(batchPayload.failed_shot_count ?? 0) || 0,
        processing_shot_count:
          Number(
            batchPayload.processing_shot_count ??
              (batchPayload.status === 'processing'
                ? Number(batchPayload.shot_count ?? shotsForGeneration.length) || shotsForGeneration.length
                : 0)
          ) || 0,
        pending_assembly:
          typeof batchPayload.pending_assembly === 'boolean'
            ? batchPayload.pending_assembly
            : batchPayload.status !== 'completed',
        result_url: toAbsoluteAssetUrl(batchPayload.result_url),
        error_message: batchPayload.error_message ?? '',
        assembly_generation_task_id: null,
        source: 'shot_assembly',
        started_at: batchPayload.started_at ?? '',
        updated_at: new Date().toISOString()
      };

      updateSegment(segmentId, {
        shotGenerationSummary: nextSummary,
        latestShotAssemblyTask: nextSummary
      });

      if (['completed', 'failed'].includes(nextSummary.status)) {
        markShotBatchGenerating(segmentId, false);
      }

      return batchPayload;
    } catch (error) {
      markShotBatchGenerating(segmentId, false);
      const errorMessage = getGenerationErrorMessage(error, '小镜头批量生成');
      setSegmentsError(errorMessage);
      const currentSegment = getCurrentSegmentById(segmentId);

      updateSegment(segmentId, {
        shotGenerationSummary: {
          ...(currentSegment?.shotGenerationSummary ?? segment.shotGenerationSummary ?? {}),
          segment_id: segmentId,
          status: 'failed',
          progress: currentSegment?.shotGenerationSummary?.progress ?? segment.shotGenerationSummary?.progress ?? 0,
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        },
        latestShotAssemblyTask: {
          ...(currentSegment?.latestShotAssemblyTask ?? segment.latestShotAssemblyTask ?? {}),
          segment_id: segmentId,
          status: 'failed',
          progress:
            currentSegment?.latestShotAssemblyTask?.progress ?? segment.latestShotAssemblyTask?.progress ?? 0,
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        }
      });

      return null;
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
    backgroundAssets,
    backgroundAssetsLoading,
    backgroundAssetsError,
    tasks,
    mergeProgress,
    videoRatio,
    analyzingSegmentId,
    optimizingSegmentId,
    generatingSegmentIds,
    generatingShotKeys,
    batchGeneratingSegmentIds,
    optimizingShotKeys,
    savingShotSegmentIds,
    setSegmentPrompt,
    setShotPrompt,
    analyzeSegmentById,
    optimizeSegmentPrompt,
    optimizeShotPrompt,
    saveSegmentShotDefinitions,
    setVideoRatio,
    generateSegmentVideo,
    generateShotVideo,
    generateAllShotsForSegment,
    refreshBackgroundAssets,
    startMerge,
    downloadMergedVideo
  };
};

export { useGeneration };
