import { Analysis, GenerationTask, Segment, ShotGenerationTask, Video } from '../models/index.js';
import env from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { TASK_STATUS } from '../config/constants.js';
import { ensureBackgroundAsset } from './backgroundAssetService.js';
import {
  buildSeedDanceReconstructionPrompt,
  broadcastGenerationTaskUpdate,
  collectCharacterReferenceImages,
  collectSceneReferenceImages,
  expandPromptMentions,
  getBackgroundBindingForSegment,
  getPromptMentionNames,
  getPromptSceneNames
} from './generationService.js';
import { publicUrlToRelativePath, resolveUploadPath, toAbsolutePublicUploadUrl } from './fileService.js';
import { extractVideoFrame, mergeVideos } from './ffmpegService.js';
import { broadcastRealtimeEvent } from './realtimeService.js';
import { assertSeedDanceReady, generateSegment as generateWithSeedDance } from './seedDanceService.js';
import { rebuildShotAssetsForSegment, shotAssetsNeedRebuild } from './shotAssetService.js';

const SHOT_TASK_EVENT = 'shot:progress';
const SHOT_ASSEMBLY_EVENT = 'shot-assembly:progress';

const normalizeOptionalNumber = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Number(parsedValue.toFixed(2));
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
};

const getNormalizedSegmentShots = (segment) => {
  const segmentAnalysis = segment?.analysis ?? {};
  const segmentStartTime = Number(segment?.startTime ?? 0);
  const segmentEndTime = Number(segment?.endTime ?? segmentStartTime);
  const rawShots = Array.isArray(segmentAnalysis.shots) ? segmentAnalysis.shots : [];

  return rawShots.map((shot, shotIndex) => {
    const shotStartTime = normalizeOptionalNumber(shot.startTime ?? shot.start_time) ?? segmentStartTime;
    const shotEndTime =
      normalizeOptionalNumber(shot.endTime ?? shot.end_time) ?? Math.max(segmentStartTime + 0.3, segmentEndTime);
    const safeEndTime = shotEndTime > shotStartTime ? shotEndTime : Number((shotStartTime + 0.3).toFixed(2));
    const localStartTime = Number(Math.max(0, shotStartTime - segmentStartTime).toFixed(2));
    const localEndTime = Number(Math.max(localStartTime, safeEndTime - segmentStartTime).toFixed(2));

    return {
      id: String(shot.id ?? `shot_${shotIndex + 1}`),
      shotIndex,
      startTime: shotStartTime,
      endTime: safeEndTime,
      localStartTime,
      localEndTime,
      durationSeconds: Number(Math.max(0.3, safeEndTime - shotStartTime).toFixed(2)),
      summary: String(shot.summary ?? shot.sceneSummary ?? shot.scene_summary ?? `镜头 ${shotIndex + 1}`).trim(),
      prompt: String(
        shot.prompt ??
          shot.scenePrompt ??
          shot.scene_prompt ??
          shot.summary ??
          shot.sceneSummary ??
          shot.scene_summary ??
          `镜头 ${shotIndex + 1}`
      ).trim(),
      sceneNames: normalizeStringArray(shot.sceneNames ?? shot.scene_names ?? shot.scenes),
      characterNames: normalizeStringArray(shot.characterNames ?? shot.character_names ?? shot.characters),
      representativeFrameTime:
        normalizeOptionalNumber(shot.representativeFrameTime ?? shot.representative_frame_time) ?? null,
      representativeFrameNote: String(
        shot.representativeFrameNote ??
          shot.representative_frame_note ??
          shot.representativeFrameReason ??
          shot.representative_frame_reason ??
          ''
      ).trim(),
      sourceFilePath: String(shot.sourceFilePath ?? shot.source_file_path ?? '').trim(),
      sourceFileUrl: String(shot.sourceFileUrl ?? shot.source_file_url ?? '').trim(),
      sourceLocalStartTime:
        normalizeOptionalNumber(shot.sourceLocalStartTime ?? shot.source_local_start_time) ?? localStartTime,
      sourceLocalEndTime:
        normalizeOptionalNumber(shot.sourceLocalEndTime ?? shot.source_local_end_time) ?? localEndTime,
      representativeFrameImagePath: String(
        shot.representativeFrameImagePath ?? shot.representative_frame_image_path ?? ''
      ).trim(),
      representativeFrameImageUrl: String(
        shot.representativeFrameImageUrl ?? shot.representative_frame_image_url ?? ''
      ).trim(),
      representativeFrameActualTime:
        normalizeOptionalNumber(
          shot.representativeFrameActualTime ?? shot.representative_frame_actual_time
        ) ?? null
    };
  });
};

const normalizeGenerationRatio = (value) => {
  const trimmedValue = String(value ?? '').trim();
  return /^[1-9]\d{0,2}:[1-9]\d{0,2}$/u.test(trimmedValue) ? trimmedValue : env.SEED_DANCE_RATIO;
};

const serializeShotGenerationMeta = (task) => {
  const taskMeta = task?.meta ?? {};

  return {
    engine: String(taskMeta.engine ?? '').trim(),
    ratio: String(taskMeta.ratio ?? '').trim(),
    remote_status: String(taskMeta.remoteStatus ?? '').trim(),
    remote_status_label: String(taskMeta.remoteStatusLabel ?? '').trim(),
    remote_created_at: Number(taskMeta.remoteCreatedAt ?? 0) || null,
    remote_updated_at: Number(taskMeta.remoteUpdatedAt ?? 0) || null,
    is_mock: Boolean(taskMeta.isMock),
    remote_task_id: String(taskMeta.remoteTaskId ?? '').trim(),
    fallback_reason: String(taskMeta.fallbackReason ?? '').trim(),
    provider_error: String(taskMeta.providerError ?? '').trim(),
    source: String(taskMeta.source ?? '').trim()
  };
};

const serializeShotGenerationTask = (task) => {
  if (!task) {
    return null;
  }

  return {
    task_id: task.id,
    segment_id: task.segmentId,
    shot_id: task.shotId,
    shot_index: task.shotIndex,
    prompt: task.prompt,
    optimized_prompt: task.optimizedPrompt,
    start_time: normalizeOptionalNumber(task.startTime),
    end_time: normalizeOptionalNumber(task.endTime),
    duration_seconds: normalizeOptionalNumber(task.durationSeconds),
    status: task.status,
    progress: task.progress,
    result_url: task.resultUrl,
    error_message: task.errorMessage,
    ...serializeShotGenerationMeta(task),
    created_at: task.createdAt,
    updated_at: task.updatedAt
  };
};

const broadcastShotGenerationTaskUpdate = (task) => {
  broadcastRealtimeEvent(SHOT_TASK_EVENT, serializeShotGenerationTask(task));
};

const applySeedDanceShotTaskProgress = async (task, progressPayload = {}) => {
  if (!task) {
    return;
  }

  const taskMeta = task.meta ?? {};
  const nextProgress = Math.max(
    Number(task.progress ?? 0) || 0,
    Math.min(99, Math.max(0, Number(progressPayload.progress ?? 0) || 0))
  );
  const nextMeta = {
    ...taskMeta,
    remoteTaskId: String(progressPayload.taskId ?? taskMeta.remoteTaskId ?? '').trim(),
    remoteStatus: String(progressPayload.status ?? taskMeta.remoteStatus ?? '').trim(),
    remoteStatusLabel: String(progressPayload.statusLabel ?? taskMeta.remoteStatusLabel ?? '').trim(),
    remoteCreatedAt:
      Number.isFinite(Number(progressPayload.createdAt)) && Number(progressPayload.createdAt) > 0
        ? Number(progressPayload.createdAt)
        : taskMeta.remoteCreatedAt ?? null,
    remoteUpdatedAt:
      Number.isFinite(Number(progressPayload.updatedAt)) && Number(progressPayload.updatedAt) > 0
        ? Number(progressPayload.updatedAt)
        : taskMeta.remoteUpdatedAt ?? null
  };

  if (
    nextProgress === Number(task.progress ?? 0) &&
    nextMeta.remoteTaskId === String(taskMeta.remoteTaskId ?? '').trim() &&
    nextMeta.remoteStatus === String(taskMeta.remoteStatus ?? '').trim() &&
    nextMeta.remoteStatusLabel === String(taskMeta.remoteStatusLabel ?? '').trim() &&
    Number(nextMeta.remoteCreatedAt ?? 0) === Number(taskMeta.remoteCreatedAt ?? 0) &&
    Number(nextMeta.remoteUpdatedAt ?? 0) === Number(taskMeta.remoteUpdatedAt ?? 0)
  ) {
    return;
  }

  await task.update({
    progress: nextProgress,
    meta: nextMeta
  });
  broadcastShotGenerationTaskUpdate(task);
};

const serializeShotAssemblyState = (segmentId, shotAssembly = {}, fallbackSummary = {}) => {
  return {
    segment_id: segmentId,
    status: String(shotAssembly.status ?? fallbackSummary.status ?? 'idle').trim() || 'idle',
    progress: Number(shotAssembly.progress ?? fallbackSummary.progress ?? 0),
    total_shot_count: Number(shotAssembly.totalShotCount ?? fallbackSummary.total_shot_count ?? 0),
    completed_shot_count: Number(shotAssembly.completedShotCount ?? fallbackSummary.completed_shot_count ?? 0),
    failed_shot_count: Number(shotAssembly.failedShotCount ?? fallbackSummary.failed_shot_count ?? 0),
    processing_shot_count: Number(shotAssembly.processingShotCount ?? fallbackSummary.processing_shot_count ?? 0),
    pending_assembly: Boolean(shotAssembly.pendingAssembly ?? fallbackSummary.pending_assembly),
    result_url: String(shotAssembly.resultUrl ?? fallbackSummary.result_url ?? '').trim(),
    error_message: String(shotAssembly.errorMessage ?? fallbackSummary.error_message ?? '').trim(),
    assembly_generation_task_id: Number(
      shotAssembly.assemblyGenerationTaskId ?? fallbackSummary.assembly_generation_task_id ?? 0
    ) || null,
    source: String(shotAssembly.source ?? fallbackSummary.source ?? 'shot_assembly').trim() || 'shot_assembly',
    started_at: shotAssembly.startedAt ?? fallbackSummary.started_at ?? '',
    updated_at: shotAssembly.updatedAt ?? fallbackSummary.updated_at ?? ''
  };
};

const broadcastShotAssemblyUpdate = (segmentId, shotAssembly, fallbackSummary = {}) => {
  broadcastRealtimeEvent(SHOT_ASSEMBLY_EVENT, serializeShotAssemblyState(segmentId, shotAssembly, fallbackSummary));
};

const buildShotTaskLookup = (tasks = [], segmentIds = [], { createdAfter = '' } = {}) => {
  const rawCreatedAfterMs = createdAfter ? Date.parse(createdAfter) : 0;
  const createdAfterMs = rawCreatedAfterMs ? Math.floor(rawCreatedAfterMs / 1000) * 1000 : 0;
  const latestAttemptTaskBySegmentId = new Map(segmentIds.map((segmentId) => [Number(segmentId), new Map()]));
  const latestCompletedTaskBySegmentId = new Map(segmentIds.map((segmentId) => [Number(segmentId), new Map()]));

  tasks.forEach((task) => {
    const taskCreatedAtMs = task?.createdAt ? Date.parse(task.createdAt) : 0;

    if (createdAfterMs && taskCreatedAtMs && taskCreatedAtMs < createdAfterMs) {
      return;
    }

    const segmentId = Number(task.segmentId);
    const shotId = String(task.shotId ?? '').trim();

    if (!shotId) {
      return;
    }

    const latestAttemptByShotId = latestAttemptTaskBySegmentId.get(segmentId) ?? new Map();

    if (!latestAttemptByShotId.has(shotId)) {
      latestAttemptByShotId.set(shotId, task);
      latestAttemptTaskBySegmentId.set(segmentId, latestAttemptByShotId);
    }

    if (task.status === TASK_STATUS.completed) {
      const latestCompletedByShotId = latestCompletedTaskBySegmentId.get(segmentId) ?? new Map();

      if (!latestCompletedByShotId.has(shotId)) {
        latestCompletedByShotId.set(shotId, task);
        latestCompletedTaskBySegmentId.set(segmentId, latestCompletedByShotId);
      }
    }
  });

  return {
    latestAttemptTaskBySegmentId,
    latestCompletedTaskBySegmentId
  };
};

const getLatestShotTaskMapsBySegmentIds = async (segmentIds, { createdAfter = '' } = {}) => {
  if (!segmentIds.length) {
    return {
      latestAttemptTaskBySegmentId: new Map(),
      latestCompletedTaskBySegmentId: new Map()
    };
  }

  const tasks = await ShotGenerationTask.findAll({
    where: {
      segmentId: segmentIds
    },
    order: [['createdAt', 'DESC']]
  });

  return buildShotTaskLookup(tasks, segmentIds, {
    createdAfter
  });
};

const buildShotGenerationSummary = ({
  segmentId,
  shots = [],
  latestAttemptTaskByShotId = new Map(),
  latestCompletedTaskByShotId = new Map(),
  shotAssembly = {}
}) => {
  const totalShotCount = shots.length;
  const completedShotCount = shots.filter((shot) => latestCompletedTaskByShotId.has(shot.id)).length;
  const failedShotCount = shots.filter((shot) => latestAttemptTaskByShotId.get(shot.id)?.status === TASK_STATUS.failed)
    .length;
  const processingShotCount = shots.filter((shot) =>
    [TASK_STATUS.pending, TASK_STATUS.processing].includes(latestAttemptTaskByShotId.get(shot.id)?.status)
  ).length;
  const hasAssemblyResult = Boolean(shotAssembly?.resultUrl || shotAssembly?.result_url);
  let status = String(shotAssembly?.status ?? '').trim();

  if (!status) {
    if (processingShotCount > 0) {
      status = TASK_STATUS.processing;
    } else if (failedShotCount > 0) {
      status = TASK_STATUS.failed;
    } else if (hasAssemblyResult) {
      status = TASK_STATUS.completed;
    } else if (completedShotCount > 0) {
      status = 'partial';
    } else {
      status = 'idle';
    }
  }

  let progress = Number(shotAssembly?.progress ?? 0);

  if (!Number.isFinite(progress) || progress <= 0) {
    if (!totalShotCount) {
      progress = 0;
    } else if (hasAssemblyResult) {
      progress = 100;
    } else {
      progress = Math.min(95, Math.round(((completedShotCount + failedShotCount) / totalShotCount) * 100));
    }
  }

  return serializeShotAssemblyState(
    segmentId,
    {
      ...shotAssembly,
      status,
      progress,
      totalShotCount,
      completedShotCount,
      failedShotCount,
      processingShotCount
    },
    {}
  );
};

const hydrateAnalysisShotsWithTasks = ({
  segment,
  latestAttemptTaskByShotId = new Map(),
  latestCompletedTaskByShotId = new Map()
}) => {
  const normalizedShots = getNormalizedSegmentShots(segment);

  return normalizedShots.map((shot) => {
    const latestGenerationTask = latestAttemptTaskByShotId.get(shot.id) ?? null;
    const latestCompletedGenerationTask = latestCompletedTaskByShotId.get(shot.id) ?? null;

    return {
      id: shot.id,
      shotIndex: shot.shotIndex,
      startTime: shot.startTime,
      endTime: shot.endTime,
      localStartTime: shot.localStartTime,
      localEndTime: shot.localEndTime,
      durationSeconds: shot.durationSeconds,
      summary: shot.summary,
      prompt: shot.prompt,
      sceneNames: shot.sceneNames,
      characterNames: shot.characterNames,
      representativeFrameTime: shot.representativeFrameTime,
      representativeFrameNote: shot.representativeFrameNote,
      sourceFilePath: shot.sourceFilePath,
      sourceFileUrl: shot.sourceFileUrl,
      sourceLocalStartTime: shot.sourceLocalStartTime,
      sourceLocalEndTime: shot.sourceLocalEndTime,
      representativeFrameImagePath: shot.representativeFrameImagePath,
      representativeFrameImageUrl: shot.representativeFrameImageUrl,
      representativeFrameActualTime: shot.representativeFrameActualTime,
      latestGenerationTask: serializeShotGenerationTask(latestGenerationTask),
      latestCompletedGenerationTask: serializeShotGenerationTask(latestCompletedGenerationTask),
      generatedUrl: latestCompletedGenerationTask?.resultUrl || ''
    };
  });
};

const ensureSegmentShotAssets = async (segment) => {
  const currentShots = Array.isArray(segment?.analysis?.shots) ? segment.analysis.shots : [];

  if (!currentShots.length || !shotAssetsNeedRebuild(currentShots)) {
    return getNormalizedSegmentShots(segment);
  }

  const rebuiltShots = await rebuildShotAssetsForSegment({
    segment,
    shots: currentShots,
    previousShots: currentShots,
    cleanupExisting: false
  });
  const nextAnalysis = {
    ...(segment.analysis ?? {}),
    shots: rebuiltShots
  };

  await segment.update({
    analysis: nextAnalysis
  });
  segment.analysis = nextAnalysis;

  return getNormalizedSegmentShots(segment);
};

const getShotGenerationSummaryForSegment = async (segment, { createdAfter = '' } = {}) => {
  const normalizedShots = getNormalizedSegmentShots(segment);
  const { latestAttemptTaskBySegmentId, latestCompletedTaskBySegmentId } = await getLatestShotTaskMapsBySegmentIds(
    [segment.id],
    { createdAfter }
  );

  return buildShotGenerationSummary({
    segmentId: segment.id,
    shots: normalizedShots,
    latestAttemptTaskByShotId: latestAttemptTaskBySegmentId.get(segment.id) ?? new Map(),
    latestCompletedTaskByShotId: latestCompletedTaskBySegmentId.get(segment.id) ?? new Map(),
    shotAssembly: segment.analysis?.shotAssembly ?? {}
  });
};

const getSegmentWithContextById = async (segmentId) => {
  const segment = await Segment.findByPk(segmentId, {
    include: [
      {
        model: Video,
        as: 'video',
        include: [
          {
            model: Analysis,
            as: 'analysis'
          }
        ]
      }
    ]
  });

  if (!segment) {
    throw new AppError('Segment not found.', 404, {
      segment_id: segmentId
    });
  }

  return segment;
};

const getShotByIdFromSegment = (segment, shotId) => {
  const normalizedShots = getNormalizedSegmentShots(segment);
  const matchedShot = normalizedShots.find((shot) => shot.id === String(shotId ?? '').trim());

  if (!matchedShot) {
    throw new AppError('Shot not found for this segment.', 404, {
      segment_id: segment.id,
      shot_id: shotId
    });
  }

  return matchedShot;
};

const updateSegmentShotAssembly = async (segment, partialShotAssembly) => {
  const nextShotAssembly = {
    ...(segment.analysis?.shotAssembly ?? {}),
    ...partialShotAssembly,
    updatedAt: new Date().toISOString()
  };
  const nextAnalysis = {
    ...(segment.analysis ?? {}),
    shotAssembly: nextShotAssembly
  };

  await segment.update({
    analysis: nextAnalysis
  });
  segment.analysis = nextAnalysis;

  const summary = await getShotGenerationSummaryForSegment(segment, {
    createdAfter: nextShotAssembly.startedAt ?? nextShotAssembly.started_at ?? ''
  });
  broadcastShotAssemblyUpdate(segment.id, nextShotAssembly, summary);
  return nextShotAssembly;
};

const refreshShotAssemblyProgressFromTasks = async (segmentId) => {
  const segment = await Segment.findByPk(segmentId);

  if (!segment?.analysis?.shotAssembly) {
    return null;
  }

  const startedAt = segment.analysis.shotAssembly.startedAt ?? segment.analysis.shotAssembly.started_at ?? '';
  const summary = await getShotGenerationSummaryForSegment(segment, {
    createdAfter: startedAt
  });
  const nextStatus =
    summary.result_url
      ? TASK_STATUS.completed
      : summary.processing_shot_count > 0
        ? TASK_STATUS.processing
        : summary.failed_shot_count > 0
          ? TASK_STATUS.failed
          : summary.completed_shot_count === summary.total_shot_count && summary.total_shot_count
            ? TASK_STATUS.processing
            : TASK_STATUS.pending;

  return updateSegmentShotAssembly(segment, {
    status: nextStatus,
    progress: summary.result_url ? 100 : summary.progress,
    totalShotCount: summary.total_shot_count,
    completedShotCount: summary.completed_shot_count,
    failedShotCount: summary.failed_shot_count,
    processingShotCount: summary.processing_shot_count,
    resultUrl: summary.result_url || segment.analysis.shotAssembly.resultUrl || '',
    errorMessage:
      summary.failed_shot_count > 0 && !summary.result_url
        ? segment.analysis.shotAssembly.errorMessage || '部分小镜头生成失败，请重试失败镜头。'
        : ''
  });
};

const createSegmentAssemblyGenerationTask = async ({
  segment,
  mergedResult,
  shotTasks = [],
  prompt = ''
}) => {
  const assemblyTask = await GenerationTask.create({
    segmentId: segment.id,
    prompt,
    optimizedPrompt: prompt,
    status: TASK_STATUS.completed,
    progress: 100,
    resultUrl: mergedResult.fileUrl,
    meta: {
      source: 'shot_assembly',
      engine: mergedResult.engine || '',
      isMock: shotTasks.some((task) => Boolean(task.meta?.isMock)),
      remoteTaskId: '',
      fallbackReason: shotTasks.some((task) => String(task.meta?.fallbackReason ?? '').trim())
        ? 'contains_shot_fallback'
        : '',
      providerError: '',
      shotTaskIds: shotTasks.map((task) => task.id),
      shotIds: shotTasks.map((task) => task.shotId)
    }
  });

  broadcastGenerationTaskUpdate(assemblyTask);
  return assemblyTask;
};

const attemptPendingShotAssembly = async (segmentId) => {
  const segment = await getSegmentWithContextById(segmentId);
  const shotAssembly = segment.analysis?.shotAssembly ?? null;

  if (!shotAssembly?.pendingAssembly) {
    return null;
  }

  const startedAt = shotAssembly.startedAt ?? shotAssembly.started_at ?? '';
  const normalizedShots = getNormalizedSegmentShots(segment);
  const { latestCompletedTaskBySegmentId } = await getLatestShotTaskMapsBySegmentIds([segmentId], {
    createdAfter: startedAt
  });
  const latestCompletedTaskByShotId = latestCompletedTaskBySegmentId.get(segmentId) ?? new Map();

  if (!normalizedShots.length || normalizedShots.some((shot) => !latestCompletedTaskByShotId.has(shot.id))) {
    return null;
  }

  await updateSegmentShotAssembly(segment, {
    status: TASK_STATUS.processing,
    progress: 96,
    errorMessage: ''
  });

  const mergeInputPaths = normalizedShots.map((shot) => {
    const task = latestCompletedTaskByShotId.get(shot.id);

    if (!task?.resultUrl) {
      throw new AppError('缺少镜头生成结果，无法拼回大片段。', 409, {
        segment_id: segmentId,
        shot_id: shot.id
      });
    }

    return resolveUploadPath(publicUrlToRelativePath(task.resultUrl));
  });

  const mergedResult = await mergeVideos(mergeInputPaths, {
    basename: `segment-${segmentId}-shot-assembly`
  });
  const assemblyPrompt = normalizedShots
    .map((shot) => latestCompletedTaskByShotId.get(shot.id)?.optimizedPrompt || latestCompletedTaskByShotId.get(shot.id)?.prompt || shot.prompt)
    .filter(Boolean)
    .join('\n');
  const assemblyTask = await createSegmentAssemblyGenerationTask({
    segment,
    mergedResult,
    shotTasks: normalizedShots
      .map((shot) => latestCompletedTaskByShotId.get(shot.id))
      .filter(Boolean),
    prompt: assemblyPrompt || segment.analysis?.prompt || segment.analysis?.scenePrompt || 'shot assembly'
  });

  await updateSegmentShotAssembly(segment, {
    status: TASK_STATUS.completed,
    progress: 100,
    pendingAssembly: false,
    resultUrl: mergedResult.fileUrl,
    errorMessage: '',
    assemblyGenerationTaskId: assemblyTask.id,
    source: 'shot_assembly'
  });

  return {
    mergedResult,
    assemblyTask
  };
};

const getShotDurationForGeneration = (shot) => {
  const durationSeconds = Number(shot?.durationSeconds ?? Number(shot?.endTime) - Number(shot?.startTime));

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  return Number(durationSeconds.toFixed(2));
};

const processShotGenerationTask = async (taskId, { attemptAssembly = true } = {}) => {
  const task = await ShotGenerationTask.findByPk(taskId, {
    include: [
      {
        model: Segment,
        as: 'segment',
        include: [
          {
            model: Video,
            as: 'video',
            include: [
              {
                model: Analysis,
                as: 'analysis'
              }
            ]
          }
        ]
      }
    ]
  });

  if (!task) {
    return null;
  }

  try {
    await task.update({
      status: TASK_STATUS.processing,
      progress: 10
    });
    broadcastShotGenerationTaskUpdate(task);
    await refreshShotAssemblyProgressFromTasks(task.segmentId);

    const segment = task.segment;
    const overallAnalysis = segment?.video?.analysis ?? null;
    const characters = overallAnalysis?.characters ?? [];
    const normalizedShots = await ensureSegmentShotAssets(segment);
    let shot =
      normalizedShots.find((item) => item.id === String(task.shotId ?? '').trim()) ??
      getShotByIdFromSegment(segment, task.shotId);
    const backgroundBinding = getBackgroundBindingForSegment(segment, overallAnalysis);
    const segmentSourceAbsolutePath = resolveUploadPath(segment.filePath);
    const segmentSourcePublicUrl = toAbsolutePublicUploadUrl(segment.filePath) || segment.filePath;
    const shotSourceAbsolutePath = shot.sourceFilePath ? resolveUploadPath(shot.sourceFilePath) : '';
    const shotSourcePublicUrl =
      shot.sourceFileUrl || (shot.sourceFilePath ? toAbsolutePublicUploadUrl(shot.sourceFilePath) : '');
    const sourceVideoAbsolutePath = segment?.video?.filePath ? resolveUploadPath(segment.video.filePath) : '';
    const generationWarnings = [];
    const sourceAbsolutePath = shotSourceAbsolutePath || segmentSourceAbsolutePath;
    const sourcePublicUrl = shotSourcePublicUrl || segmentSourcePublicUrl;

    if (!shotSourceAbsolutePath) {
      generationWarnings.push('小镜头源视频缺失，已回退到大片段源视频');
    }

    let backgroundAsset = null;

    if (backgroundBinding) {
      await task.update({
        progress: 20
      });
      broadcastShotGenerationTaskUpdate(task);

      backgroundAsset = await ensureBackgroundAsset({
        video: segment.video,
        segment,
        backgroundId: backgroundBinding.backgroundId,
        backgroundName: backgroundBinding.backgroundName,
        backgroundDescription: backgroundBinding.description,
        backgroundPrompt: backgroundBinding.backgroundPrompt,
        representativeFrameTime: Number.isFinite(backgroundBinding.representativeFrameTime)
          ? Number(backgroundBinding.representativeFrameTime.toFixed(2))
          : null,
        segmentSceneSummary: shot.summary || backgroundBinding.sceneSummary,
        sourcePublicUrl,
        sourceAbsolutePath
      });
    }

    const optimizedPrompt = expandPromptMentions(task.prompt, characters, overallAnalysis?.backgrounds ?? []);
    const seedDancePrompt = buildSeedDanceReconstructionPrompt({
      prompt: optimizedPrompt,
      characterNames: [...getPromptMentionNames(task.prompt), ...(Array.isArray(shot.characterNames) ? shot.characterNames : [])],
      sceneNames: [...getPromptSceneNames(task.prompt), ...(Array.isArray(shot.sceneNames) ? shot.sceneNames : []), backgroundBinding?.backgroundName || ''],
      isShot: true
    });
    let primaryShotReferenceImage = null;

    if (shot.representativeFrameImagePath || shot.representativeFrameImageUrl) {
      primaryShotReferenceImage = {
        relativePath: shot.representativeFrameImagePath || '',
        url: shot.representativeFrameImageUrl || '',
        role: 'reference_image'
      };
    } else {
      const fallbackFrameSourceAbsolutePath = shotSourceAbsolutePath || segmentSourceAbsolutePath;
      const fallbackFrameTime = shotSourceAbsolutePath
        ? shot.representativeFrameActualTime ??
          Number(Math.max(0, Number(shot.representativeFrameTime ?? shot.startTime) - Number(shot.startTime)).toFixed(2))
        : shot.representativeFrameActualTime ??
          shot.sourceLocalStartTime ??
          Number(Math.max(0, Number(shot.representativeFrameTime ?? shot.startTime) - Number(segment.startTime)).toFixed(2));
      const extractedShotFrame = await extractVideoFrame(fallbackFrameSourceAbsolutePath, fallbackFrameTime, {
        basename: `segment-${segment.id}-${task.shotId}-task-${task.id}-shot-frame-fallback`
      });

      if (extractedShotFrame?.filePath) {
        primaryShotReferenceImage = {
          relativePath: extractedShotFrame.filePath,
          url: extractedShotFrame.fileUrl,
          role: 'reference_image'
        };
        generationWarnings.push('小镜头典型帧缺失，已改为动态抽帧');
      } else {
        generationWarnings.push('小镜头典型帧缺失，且动态抽帧失败');
      }
    }

    const characterReferenceImages = await collectCharacterReferenceImages({
      videoId: segment?.video?.id,
      segment,
      overallAnalysis,
      prompt: task.prompt,
      sourceVideoAbsolutePath,
      basenamePrefix: `segment-${segment.id}-${task.shotId}-task-${task.id}`
    });
    const sceneReferenceImages = await collectSceneReferenceImages({
      videoId: segment?.video?.id,
      segment,
      overallAnalysis,
      prompt: task.prompt,
      sceneNames: shot.sceneNames,
      backgroundBinding,
      sourceVideoAbsolutePath,
      basenamePrefix: `segment-${segment.id}-${task.shotId}-task-${task.id}`
    });
    const referenceImages = [
      ...(primaryShotReferenceImage ? [primaryShotReferenceImage] : []),
      ...characterReferenceImages,
      ...sceneReferenceImages
    ].slice(0, 9);

    await task.update({
      optimizedPrompt,
      progress: 45
    });
    broadcastShotGenerationTaskUpdate(task);

    const result = await generateWithSeedDance({
      sourceAbsolutePath,
      sourcePublicUrl,
      prompt: seedDancePrompt,
      basename: `segment-${segment.id}-${task.shotId}-task-${task.id}`,
      ratio: normalizeGenerationRatio(task.meta?.ratio),
      duration: getShotDurationForGeneration(shot),
      onProgress: async (progressPayload) => {
        await applySeedDanceShotTaskProgress(task, progressPayload);
      },
      referenceImages,
      referenceVideos: [
        backgroundAsset?.assetPath || backgroundAsset?.assetUrl
          ? {
              url: toAbsolutePublicUploadUrl(backgroundAsset.assetPath) || backgroundAsset.assetUrl,
              relativePath: backgroundAsset.assetPath || '',
              role: 'reference_video'
            }
          : null
      ].filter(Boolean)
    });

    await task.update({
      status: TASK_STATUS.completed,
      progress: 100,
      resultUrl: result.fileUrl,
      errorMessage: null,
      meta: {
        ...(task.meta ?? {}),
        source: 'shot_generation',
        engine: result.engine || '',
        isMock: Boolean(result.isMock),
        remoteTaskId: result.remoteTaskId || '',
        remoteStatus: 'succeeded',
        remoteStatusLabel: '远端已完成',
        remoteCreatedAt: task.meta?.remoteCreatedAt ?? null,
        remoteUpdatedAt: task.meta?.remoteUpdatedAt ?? null,
        fallbackReason: [generationWarnings.join('；'), result.fallbackReason || ''].filter(Boolean).join('；'),
        providerError: result.providerError || ''
      }
    });
    broadcastShotGenerationTaskUpdate(task);
  } catch (error) {
    await task.update({
      status: TASK_STATUS.failed,
      errorMessage: error.message,
      meta: {
        ...(task.meta ?? {}),
        source: 'shot_generation',
        remoteStatus: String(task.meta?.remoteStatus ?? '').trim(),
        remoteStatusLabel: String(task.meta?.remoteStatusLabel ?? '').trim(),
        remoteCreatedAt: task.meta?.remoteCreatedAt ?? null,
        remoteUpdatedAt: task.meta?.remoteUpdatedAt ?? null,
        providerError: error.message
      }
    });
    broadcastShotGenerationTaskUpdate(task);
  }

  await refreshShotAssemblyProgressFromTasks(task.segmentId);

  if (attemptAssembly) {
    try {
      await attemptPendingShotAssembly(task.segmentId);
    } catch (error) {
      const segment = await Segment.findByPk(task.segmentId);

      if (segment?.analysis?.shotAssembly) {
        await updateSegmentShotAssembly(segment, {
          status: TASK_STATUS.failed,
          progress: 100,
          errorMessage: error.message
        });
      }
    }
  }

  return ShotGenerationTask.findByPk(task.id);
};

const startShotGeneration = async ({ segmentId, shotId, prompt, ratio }) => {
  const segment = await getSegmentWithContextById(segmentId);
  const shot = getShotByIdFromSegment(segment, shotId);
  const resolvedPrompt = String(prompt ?? '').trim() || shot.prompt;
  const resolvedRatio = normalizeGenerationRatio(ratio);

  if (!resolvedPrompt) {
    throw new AppError('请先提供镜头提示词，再生成小镜头。', 400, {
      segment_id: segmentId,
      shot_id: shotId
    });
  }

  assertSeedDanceReady();

  const task = await ShotGenerationTask.create({
    segmentId,
    shotId: shot.id,
    shotIndex: shot.shotIndex,
    prompt: resolvedPrompt,
    startTime: shot.startTime,
    endTime: shot.endTime,
    durationSeconds: shot.durationSeconds,
    status: TASK_STATUS.pending,
    progress: 0,
    meta: {
      source: 'shot_generation',
      ratio: resolvedRatio,
      engine: '',
      remoteStatus: '',
      remoteStatusLabel: '',
      remoteCreatedAt: null,
      remoteUpdatedAt: null,
      isMock: false,
      remoteTaskId: '',
      fallbackReason: '',
      providerError: ''
    }
  });
  broadcastShotGenerationTaskUpdate(task);

  queueMicrotask(() => {
    void processShotGenerationTask(task.id, {
      attemptAssembly: true
    });
  });

  return serializeShotGenerationTask(task);
};

const processShotBatchGeneration = async ({ segmentId, promptOverrides = {}, ratio, startedAt = '' }) => {
  const segment = await getSegmentWithContextById(segmentId);
  const normalizedShots = getNormalizedSegmentShots(segment);
  const resolvedRatio = normalizeGenerationRatio(ratio);

  for (const shot of normalizedShots) {
    const overridePrompt = String(promptOverrides[shot.id] ?? '').trim();
    const task = await ShotGenerationTask.create({
      segmentId,
      shotId: shot.id,
      shotIndex: shot.shotIndex,
      prompt: overridePrompt || shot.prompt,
      startTime: shot.startTime,
      endTime: shot.endTime,
      durationSeconds: shot.durationSeconds,
      status: TASK_STATUS.pending,
      progress: 0,
      meta: {
        source: 'shot_generation_batch',
        batchStartedAt: startedAt,
        ratio: resolvedRatio,
        engine: '',
        remoteStatus: '',
        remoteStatusLabel: '',
        remoteCreatedAt: null,
        remoteUpdatedAt: null,
        isMock: false,
        remoteTaskId: '',
        fallbackReason: '',
        providerError: ''
      }
    });

    broadcastShotGenerationTaskUpdate(task);
    await processShotGenerationTask(task.id, {
      attemptAssembly: false
    });
  }

  try {
    await attemptPendingShotAssembly(segmentId);
  } catch (error) {
    const refreshedSegment = await Segment.findByPk(segmentId);

    if (refreshedSegment?.analysis?.shotAssembly) {
      await updateSegmentShotAssembly(refreshedSegment, {
        status: TASK_STATUS.failed,
        progress: 100,
        errorMessage: error.message
      });
    }
  }
};

const startShotBatchGeneration = async ({ segmentId, shots = [], ratio }) => {
  const segment = await getSegmentWithContextById(segmentId);
  const normalizedShots = getNormalizedSegmentShots(segment);
  const resolvedRatio = normalizeGenerationRatio(ratio);

  if (!normalizedShots.length) {
    throw new AppError('当前大片段没有可用的小镜头。', 400, {
      segment_id: segmentId
    });
  }

  assertSeedDanceReady();

  const promptOverrides = shots.reduce((accumulator, shot) => {
    const shotId = String(shot?.shot_id ?? shot?.shotId ?? '').trim();
    const prompt = String(shot?.prompt ?? '').trim();

    if (shotId && prompt) {
      accumulator[shotId] = prompt;
    }

    return accumulator;
  }, {});
  const startedAt = new Date().toISOString();

  await updateSegmentShotAssembly(segment, {
    status: TASK_STATUS.processing,
    progress: 0,
    pendingAssembly: true,
    resultUrl: '',
    errorMessage: '',
    startedAt,
    totalShotCount: normalizedShots.length,
    completedShotCount: 0,
    failedShotCount: 0,
    processingShotCount: normalizedShots.length,
    source: 'shot_assembly'
  });

  queueMicrotask(() => {
    void processShotBatchGeneration({
      segmentId,
      promptOverrides,
      ratio: resolvedRatio,
      startedAt
    });
  });

  return {
    segment_id: segmentId,
    shot_count: normalizedShots.length,
    status: TASK_STATUS.processing,
    started_at: startedAt,
    ratio: resolvedRatio
  };
};

const getShotGenerationTaskStatus = async (taskId) => {
  const task = await ShotGenerationTask.findByPk(taskId);

  if (!task) {
    throw new AppError('Shot generation task not found.', 404, {
      task_id: taskId
    });
  }

  return serializeShotGenerationTask(task);
};

export {
  buildShotGenerationSummary,
  getLatestShotTaskMapsBySegmentIds,
  getNormalizedSegmentShots,
  getShotGenerationSummaryForSegment,
  getShotGenerationTaskStatus,
  hydrateAnalysisShotsWithTasks,
  serializeShotGenerationTask,
  startShotBatchGeneration,
  startShotGeneration
};
