import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { GenerationTask, Segment, Video } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { analyzeSegmentContent, getAnalysisRecordByVideoId } from './analysisService.js';
import { resolveUploadPath, toPublicUploadUrl } from './fileService.js';
import {
  buildShotGenerationSummary,
  getLatestShotTaskMapsBySegmentIds,
  hydrateAnalysisShotsWithTasks
} from './shotGenerationService.js';
import { completeTask, createTask, failTask, updateTask } from './taskService.js';
import { splitVideo } from './ffmpegService.js';
import { rebuildShotAssetsForSegment, shotAssetsNeedRebuild } from './shotAssetService.js';
import {
  normalizeAnalysisOptions,
  normalizeShotSpeech,
  persistShotSpeechEditsForSegment,
  rebuildShotSpeechAssetsForSegment,
  shotSpeechAssetsNeedRebuild
} from './shotSpeechService.js';
import {
  hydrateCharacterStateRefsForShots,
  normalizeCharacterStateRefs
} from './characterStateService.js';
import { getVideoRecordById, resolveVideoAbsolutePath } from './videoService.js';

const serializeGenerationTask = (task) => {
  if (!task) {
    return null;
  }

  const taskMeta = task.meta ?? {};
  const normalizeDurationValue = (value) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? Number(parsedValue.toFixed(2)) : null;
  };

  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    prompt: task.prompt,
    optimized_prompt: task.optimizedPrompt,
    result_url: task.resultUrl,
    error_message: task.errorMessage,
    engine: String(taskMeta.engine ?? '').trim(),
    is_mock: Boolean(taskMeta.isMock),
    use_reference_video: taskMeta.useReferenceVideo ?? taskMeta.use_reference_video ?? true,
    use_reference_frame: taskMeta.useReferenceFrame ?? taskMeta.use_reference_frame ?? true,
    remote_task_id: String(taskMeta.remoteTaskId ?? '').trim(),
    fallback_reason: String(taskMeta.fallbackReason ?? '').trim(),
    provider_error: String(taskMeta.providerError ?? '').trim(),
    source: String(taskMeta.source ?? '').trim(),
    requested_duration_seconds: normalizeDurationValue(
      taskMeta.requestedDurationSeconds ?? taskMeta.requested_duration_seconds
    ),
    provider_duration_seconds: normalizeDurationValue(
      taskMeta.providerDurationSeconds ?? taskMeta.provider_duration_seconds
    ),
    actual_duration_seconds: normalizeDurationValue(taskMeta.actualDurationSeconds ?? taskMeta.actual_duration_seconds),
    has_dialogue:
      typeof (taskMeta.hasDialogue ?? taskMeta.has_dialogue) === 'boolean'
        ? Boolean(taskMeta.hasDialogue ?? taskMeta.has_dialogue)
        : null,
    trimmed_to_requested:
      typeof (taskMeta.trimmedToRequested ?? taskMeta.trimmed_to_requested) === 'boolean'
        ? Boolean(taskMeta.trimmedToRequested ?? taskMeta.trimmed_to_requested)
        : false,
    sent_reference_images: Array.isArray(taskMeta.sentReferenceImages) ? taskMeta.sentReferenceImages : [],
    sent_reference_videos: Array.isArray(taskMeta.sentReferenceVideos) ? taskMeta.sentReferenceVideos : [],
    sent_reference_audios: Array.isArray(taskMeta.sentReferenceAudios) ? taskMeta.sentReferenceAudios : [],
    created_at: task.createdAt,
    updated_at: task.updatedAt
  };
};

const isTaskMarkedMock = (task) => {
  const taskMeta = task?.meta ?? {};
  const engine = String(taskMeta.engine ?? '').trim().toLowerCase();
  const fallbackReason = String(taskMeta.fallbackReason ?? '').trim().toLowerCase();

  return (
    Boolean(taskMeta.isMock) ||
    engine.includes('mock') ||
    fallbackReason.includes('remote_generation_failed') ||
    fallbackReason.includes('missing_remote_config')
  );
};

const isUsableCompletedGenerationTask = (task) => {
  return Boolean(task?.status === 'completed' && task?.resultUrl && !isTaskMarkedMock(task));
};

const normalizeOptionalFrameTime = (value) => {
  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) && parsedValue >= 0 ? Number(parsedValue.toFixed(2)) : null;
};

const normalizeShotDefinitions = (shots, segmentStartTime, segmentEndTime) => {
  if (!Array.isArray(shots)) {
    return [];
  }

  return shots.map((shot, shotIndex) => {
    const startTime = Number(shot.startTime ?? shot.start_time ?? segmentStartTime);
    const endTime = Number(shot.endTime ?? shot.end_time ?? segmentEndTime);
    const safeStartTime = Number.isFinite(startTime) ? Math.max(segmentStartTime, startTime) : segmentStartTime;
    const safeEndTime = Number.isFinite(endTime) && endTime > safeStartTime ? endTime : safeStartTime + 0.3;
    const boundedEndTime = Number(Math.min(segmentEndTime, safeEndTime).toFixed(2));
    const durationSeconds = Number(Math.max(0.3, boundedEndTime - safeStartTime).toFixed(2));

    return {
      id: String(shot.id ?? `shot_${shotIndex + 1}`),
      startTime: Number(safeStartTime.toFixed(2)),
      endTime: boundedEndTime,
      durationSeconds,
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
      sceneNames: normalizeSceneNameList(shot.sceneNames ?? shot.scene_names ?? shot.scenes),
      characterNames: normalizeSceneNameList(shot.characterNames ?? shot.character_names ?? shot.characters),
      representativeFrameTime: normalizeOptionalFrameTime(
        shot.representativeFrameTime ?? shot.representative_frame_time
      ),
      representativeFrameNote: String(
        shot.representativeFrameNote ??
          shot.representative_frame_note ??
          shot.representativeFrameReason ??
          shot.representative_frame_reason ??
          ''
      ).trim(),
      sourceFilePath: String(shot.sourceFilePath ?? shot.source_file_path ?? '').trim(),
      sourceFileUrl: String(shot.sourceFileUrl ?? shot.source_file_url ?? '').trim(),
      sourceLocalStartTime: normalizeOptionalFrameTime(shot.sourceLocalStartTime ?? shot.source_local_start_time),
      sourceLocalEndTime: normalizeOptionalFrameTime(shot.sourceLocalEndTime ?? shot.source_local_end_time),
      representativeFrameImagePath: String(
        shot.representativeFrameImagePath ?? shot.representative_frame_image_path ?? ''
      ).trim(),
      representativeFrameImageUrl: String(
        shot.representativeFrameImageUrl ?? shot.representative_frame_image_url ?? ''
      ).trim(),
      representativeFrameActualTime: normalizeOptionalFrameTime(
        shot.representativeFrameActualTime ?? shot.representative_frame_actual_time
      ),
      sourceAudioFilePath: String(shot.sourceAudioFilePath ?? shot.source_audio_file_path ?? '').trim(),
      sourceAudioFileUrl: String(shot.sourceAudioFileUrl ?? shot.source_audio_file_url ?? '').trim(),
      speech: normalizeShotSpeech(shot.speech ?? null, {
        durationSeconds,
        fallbackStatus: 'idle'
      }),
      characterStateRefs: normalizeCharacterStateRefs(
        shot.characterStateRefs ?? shot.character_state_refs ?? []
      )
    };
  });
};

const getShotDefinitionInvalidatedAt = (segment) => {
  const invalidatedAt = String(segment?.analysis?.shotAssemblyInvalidatedAt ?? '').trim();
  const invalidatedAtMs = invalidatedAt ? Date.parse(invalidatedAt) : 0;

  if (!invalidatedAtMs) {
    return '';
  }

  return new Date(Math.floor(invalidatedAtMs / 1000) * 1000).toISOString();
};

const isTaskStaleShotAssembly = (task, invalidatedAt = '') => {
  if (!task || !invalidatedAt) {
    return false;
  }

  const invalidatedAtMs = Date.parse(invalidatedAt);
  const taskCreatedAtMs = task?.createdAt ? Date.parse(task.createdAt) : 0;
  const source = String(task?.meta?.source ?? '').trim();

  if (!invalidatedAtMs || !taskCreatedAtMs || source !== 'shot_assembly') {
    return false;
  }

  return taskCreatedAtMs < Math.floor(invalidatedAtMs / 1000) * 1000;
};

const buildPersistedShotDefinitions = (shots, segmentStartTime, segmentEndTime) => {
  if (!Array.isArray(shots) || !shots.length) {
    throw new AppError('至少需要保留一个小镜头。', 400);
  }

  const normalizedShots = shots.map((shot, shotIndex) => {
    const startTime = Number(shot?.startTime);
    const endTime = Number(shot?.endTime);
    const summary = String(shot?.summary ?? '').trim();
    const prompt = String(shot?.prompt ?? '').trim();
    const representativeFrameTime = normalizeOptionalFrameTime(shot?.representativeFrameTime);
    const sceneNames = normalizeSceneNameList(shot?.sceneNames);
    const characterNames = normalizeSceneNameList(shot?.characterNames);
    const rawId = String(shot?.id ?? '').trim();

    if (!Number.isFinite(startTime) || startTime < segmentStartTime) {
      throw new AppError(`镜头 ${shotIndex + 1} 的开始时间必须落在父片段范围内。`, 400);
    }

    if (!Number.isFinite(endTime) || endTime > segmentEndTime || endTime <= startTime) {
      throw new AppError(`镜头 ${shotIndex + 1} 的结束时间必须大于开始时间，且落在父片段范围内。`, 400);
    }

    if (representativeFrameTime !== null && (representativeFrameTime < startTime || representativeFrameTime > endTime)) {
      throw new AppError(`镜头 ${shotIndex + 1} 的典型帧时间必须落在镜头时间范围内。`, 400);
    }

    return {
      id: !rawId || rawId.startsWith('temp-shot-') ? `shot_${randomUUID()}` : rawId,
      startTime: Number(startTime.toFixed(2)),
      endTime: Number(endTime.toFixed(2)),
      durationSeconds: Number((endTime - startTime).toFixed(2)),
      summary: summary || `镜头 ${shotIndex + 1}`,
      prompt: prompt || summary || `镜头 ${shotIndex + 1}`,
      sceneNames,
      characterNames,
      representativeFrameTime:
        representativeFrameTime !== null
          ? representativeFrameTime
          : Number(((startTime + endTime) / 2).toFixed(2)),
      representativeFrameNote: String(shot?.representativeFrameNote ?? '').trim(),
      speech: normalizeShotSpeech(shot?.speech ?? null, {
        durationSeconds: Number((endTime - startTime).toFixed(2)),
        fallbackStatus: 'completed'
      }),
      characterStateRefs: normalizeCharacterStateRefs(shot?.characterStateRefs ?? shot?.character_state_refs ?? [])
    };
  });

  const sortedShots = normalizedShots.sort((left, right) => left.startTime - right.startTime);

  sortedShots.forEach((shot, shotIndex) => {
    const previousShot = sortedShots[shotIndex - 1];

    if (previousShot && shot.startTime < previousShot.endTime) {
      throw new AppError('小镜头时间不能重叠，请检查开始时间和结束时间。', 400);
    }
  });

  return sortedShots;
};

const arePersistedShotDefinitionsEqual = (leftShots = [], rightShots = []) => {
  if (!Array.isArray(leftShots) || !Array.isArray(rightShots) || leftShots.length !== rightShots.length) {
    return false;
  }

  return leftShots.every((leftShot, shotIndex) => {
    const rightShot = rightShots[shotIndex];

    if (!rightShot) {
      return false;
    }

    return JSON.stringify(leftShot) === JSON.stringify(rightShot);
  });
};

const getShotPersistenceComparablePayload = (shots = []) => {
  return shots.map((shot) => ({
    id: shot.id,
    startTime: shot.startTime,
    endTime: shot.endTime,
    summary: shot.summary,
    prompt: shot.prompt,
    sceneNames: shot.sceneNames,
    characterNames: shot.characterNames,
    representativeFrameTime: shot.representativeFrameTime,
    representativeFrameNote: shot.representativeFrameNote,
    speech: normalizeShotSpeech(shot.speech, {
      durationSeconds: shot.durationSeconds,
      fallbackStatus: 'completed'
    }),
    characterStateRefs: normalizeCharacterStateRefs(shot.characterStateRefs ?? shot.character_state_refs ?? [])
  }));
};

const getShotRebuildComparablePayload = (shots = []) => {
  return shots.map((shot) => ({
    id: shot.id,
    startTime: shot.startTime,
    endTime: shot.endTime,
    representativeFrameTime: shot.representativeFrameTime
  }));
};

const mergeShotPersistedAssets = (shots = [], currentShots = []) => {
  return shots.map((shot) => {
    const currentShot =
      currentShots.find((item) => String(item?.id ?? '').trim() === String(shot?.id ?? '').trim()) ?? null;

    return {
      ...shot,
      sourceFilePath: String(currentShot?.sourceFilePath ?? '').trim(),
      sourceFileUrl: String(currentShot?.sourceFileUrl ?? '').trim(),
      sourceLocalStartTime: currentShot?.sourceLocalStartTime ?? null,
      sourceLocalEndTime: currentShot?.sourceLocalEndTime ?? null,
      representativeFrameImagePath: String(currentShot?.representativeFrameImagePath ?? '').trim(),
      representativeFrameImageUrl: String(currentShot?.representativeFrameImageUrl ?? '').trim(),
      representativeFrameActualTime: currentShot?.representativeFrameActualTime ?? null,
      sourceAudioFilePath: String(currentShot?.sourceAudioFilePath ?? '').trim(),
      sourceAudioFileUrl: String(currentShot?.sourceAudioFileUrl ?? '').trim()
    };
  });
};

const serializeSegment = (
  segment,
  latestCompletedGenerationTask = null,
  latestAttemptTask = null,
  latestCompletedShotTaskByShotId = new Map(),
  latestAttemptShotTaskByShotId = new Map()
) => {
  const segmentStartTime = Number(segment.startTime);
  const segmentEndTime = Number(segment.endTime);
  const shotDefinitionInvalidatedAt = getShotDefinitionInvalidatedAt(segment);
  const normalizedAnalysis = {
    ...(segment.analysis ?? {})
  };
  const filteredLatestCompletedGenerationTask = isTaskStaleShotAssembly(
    latestCompletedGenerationTask,
    shotDefinitionInvalidatedAt
  )
    ? null
    : latestCompletedGenerationTask;
  const filteredLatestAttemptTask = isTaskStaleShotAssembly(latestAttemptTask, shotDefinitionInvalidatedAt)
    ? null
    : latestAttemptTask;
  const hydratedShots = hydrateAnalysisShotsWithTasks({
    segment,
    latestAttemptTaskByShotId: latestAttemptShotTaskByShotId,
    latestCompletedTaskByShotId: latestCompletedShotTaskByShotId
  });
  const shotGenerationSummary = buildShotGenerationSummary({
    segmentId: segment.id,
    shots: normalizeShotDefinitions(normalizedAnalysis.shots ?? [], segmentStartTime, segmentEndTime),
    latestAttemptTaskByShotId: latestAttemptShotTaskByShotId,
    latestCompletedTaskByShotId: latestCompletedShotTaskByShotId,
    shotAssembly: normalizedAnalysis.shotAssembly ?? {}
  });

  normalizedAnalysis.shots = hydratedShots;

  return {
    id: segment.id,
    segment_index: segment.segmentIndex,
    start_time: segmentStartTime,
    end_time: segmentEndTime,
    file_path: segment.filePath,
    file_url: toPublicUploadUrl(segment.filePath),
    analysis: normalizedAnalysis,
    shot_generation_summary: shotGenerationSummary,
    latest_shot_assembly_task: shotGenerationSummary.total_shot_count ? shotGenerationSummary : null,
    // Keep the display source aligned with merge: both use the latest completed generation result.
    latest_generation_task: serializeGenerationTask(filteredLatestCompletedGenerationTask),
    latest_attempt_task: serializeGenerationTask(filteredLatestAttemptTask)
  };
};

const ensurePersistentShotAssets = async (segment) => {
  const currentShots = Array.isArray(segment?.analysis?.shots) ? segment.analysis.shots : [];
  const analysisOptions = normalizeAnalysisOptions(segment?.analysis?.analysisOptions);
  let nextShots = currentShots;
  let shouldPersist = false;

  if (!currentShots.length) {
    return segment;
  }

  if (shotAssetsNeedRebuild(currentShots)) {
    nextShots = await rebuildShotAssetsForSegment({
      segment,
      shots: currentShots,
      previousShots: currentShots,
      cleanupExisting: false
    });
    shouldPersist = true;
  }

  if (shotSpeechAssetsNeedRebuild(nextShots, analysisOptions)) {
    nextShots = await rebuildShotSpeechAssetsForSegment({
      segment,
      shots: nextShots,
      previousShots: currentShots,
      analysisOptions,
      cleanupExisting: false
    });
    shouldPersist = true;
  } else if (!analysisOptions.extractSubtitles && !analysisOptions.parseAudio) {
    const speechFreeShots = await persistShotSpeechEditsForSegment({
      segment,
      shots: mergeShotPersistedAssets(nextShots, currentShots),
      previousShots: currentShots,
      analysisOptions
    });

    if (JSON.stringify(nextShots) !== JSON.stringify(speechFreeShots)) {
      nextShots = speechFreeShots;
      shouldPersist = true;
    }
  }

  if (!shouldPersist) {
    return segment;
  }

  const nextAnalysis = {
    ...(segment.analysis ?? {}),
    analysisOptions,
    shots: nextShots
  };

  await segment.update({
    analysis: nextAnalysis
  });
  segment.analysis = nextAnalysis;

  return segment;
};

const normalizeTimeAnchors = (timeAnchors) => {
  return (timeAnchors ?? [])
    .map((item, index) => {
      const representativeFrameTime = Number(
        item.representativeFrameTime ?? item.representative_frame_time
      );

      return {
        startTime: Number(item.startTime ?? item.start_time),
        endTime: Number(item.endTime ?? item.end_time),
        sceneSummary: item.sceneSummary ?? item.scene_summary ?? `Segment ${index + 1}`,
        scenePrompt: item.scenePrompt ?? item.scene_prompt ?? '',
        representativeFrameTime:
          Number.isFinite(representativeFrameTime) && representativeFrameTime >= 0
            ? representativeFrameTime
            : null,
        representativeFrameNote:
          item.representativeFrameNote ?? item.representative_frame_note ?? '',
        backgroundId: String(item.backgroundId ?? item.background_id ?? '').trim(),
        backgroundAction: String(item.backgroundAction ?? item.background_action ?? '').trim(),
        backgroundName: String(item.backgroundName ?? item.background_name ?? '').trim(),
        shots: normalizeShotDefinitions(
          item.shots ?? [],
          Number(item.startTime ?? item.start_time),
          Number(item.endTime ?? item.end_time)
        )
      };
    })
    .sort((left, right) => left.startTime - right.startTime);
};

const getBackgroundLibraryById = (overallAnalysis) => {
  return new Map(
    (overallAnalysis?.backgrounds ?? [])
      .filter(Boolean)
      .map((background, index) => [
        String(background.id ?? `background_${index + 1}`),
        {
          id: String(background.id ?? `background_${index + 1}`),
          name: String(background.name ?? `场景 ${index + 1}`),
          description: String(background.description ?? background.summary ?? '').trim(),
          scenePrompt: String(background.scenePrompt ?? background.scene_prompt ?? '').trim(),
          representativeFrameTime: Number(
            background.representativeFrameTime ?? background.representative_frame_time
          ),
          representativeFrameNote: String(
            background.representativeFrameNote ?? background.representative_frame_note ?? ''
          ).trim()
        }
      ])
  );
};

const normalizeSceneNameList = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
};

const buildBaseSegmentAnalysis = ({ segment, timeAnchor = {}, overallAnalysis, previousAnalysis = {} }) => {
  const analysisOptions = normalizeAnalysisOptions(
    previousAnalysis.analysisOptions ?? previousAnalysis.analysis_options ?? overallAnalysis?.analysisOptions
  );
  const backgroundLibrary = getBackgroundLibraryById(overallAnalysis);
  const backgroundId =
    String(
      timeAnchor.backgroundId ??
        timeAnchor.background_id ??
        previousAnalysis.backgroundId ??
        previousAnalysis.background_id ??
        ''
    ).trim() || `background_${Number(segment.segmentIndex) + 1}`;
  const background = backgroundLibrary.get(backgroundId);
  const sceneSummary =
    String(timeAnchor.sceneSummary ?? timeAnchor.scene_summary ?? previousAnalysis.sceneSummary ?? '').trim() ||
    previousAnalysis.scene ||
    '';
  const scenePrompt =
    String(timeAnchor.scenePrompt ?? timeAnchor.scene_prompt ?? previousAnalysis.scenePrompt ?? '').trim() ||
    previousAnalysis.prompt ||
    '';
  const representativeFrameTime = Number(
    timeAnchor.representativeFrameTime ??
      timeAnchor.representative_frame_time ??
      previousAnalysis.representativeFrameTime
  );
  const backgroundName =
    String(
      timeAnchor.backgroundName ??
        timeAnchor.background_name ??
        previousAnalysis.backgroundName ??
        previousAnalysis.background_name ??
        background?.name ??
        `场景 ${Number(segment.segmentIndex) + 1}`
    ).trim() || `场景 ${Number(segment.segmentIndex) + 1}`;
  const scenes = normalizeSceneNameList(previousAnalysis.scenes);
  const shots = normalizeShotDefinitions(
    timeAnchor.shots ?? previousAnalysis.shots ?? [],
    Number(segment.startTime),
    Number(segment.endTime)
  );

  return {
    analysisOptions,
    sceneSummary,
    scenePrompt,
    backgroundId,
    backgroundAction:
      String(
        timeAnchor.backgroundAction ??
          timeAnchor.background_action ??
          previousAnalysis.backgroundAction ??
          previousAnalysis.background_action ??
          ''
      ).trim() || 'create_new',
    backgroundName,
    backgroundPrompt:
      String(previousAnalysis.backgroundPrompt ?? background?.scenePrompt ?? scenePrompt ?? '').trim() ||
      scenePrompt,
    representativeFrameTime:
      Number.isFinite(representativeFrameTime) && representativeFrameTime >= 0
        ? Number(representativeFrameTime.toFixed(2))
        : null,
    representativeFrameNote: String(
      timeAnchor.representativeFrameNote ??
        timeAnchor.representative_frame_note ??
        previousAnalysis.representativeFrameNote ??
        background?.representativeFrameNote ??
        ''
    ).trim(),
    scenes: scenes.length ? scenes : backgroundName ? [backgroundName] : [],
    characters: Array.isArray(previousAnalysis.characters) ? previousAnalysis.characters : [],
    scene: String(previousAnalysis.scene ?? sceneSummary).trim(),
    action: String(previousAnalysis.action ?? '').trim(),
    prompt: String(previousAnalysis.prompt ?? scenePrompt).trim(),
    shots: shots.length
      ? shots
      : [
          {
            id: 'shot_1',
            startTime: Number(segment.startTime),
            endTime: Number(segment.endTime),
            summary: sceneSummary || `片段 ${Number(segment.segmentIndex) + 1} 的主镜头`,
            prompt: String(previousAnalysis.prompt ?? scenePrompt).trim(),
            sceneNames: backgroundName ? [backgroundName] : [],
            characterNames: Array.isArray(previousAnalysis.characters) ? previousAnalysis.characters : [],
            representativeFrameTime:
              Number.isFinite(representativeFrameTime) && representativeFrameTime >= 0
                ? Number(representativeFrameTime.toFixed(2))
                : null,
            representativeFrameNote: String(
              timeAnchor.representativeFrameNote ??
                timeAnchor.representative_frame_note ??
                previousAnalysis.representativeFrameNote ??
                ''
            ).trim(),
            speech: normalizeShotSpeech(previousAnalysis?.shots?.[0]?.speech ?? null, {
              durationSeconds: Number(segment.endTime) - Number(segment.startTime),
              fallbackStatus: 'idle'
            }),
            characterStateRefs: normalizeCharacterStateRefs(
              previousAnalysis?.shots?.[0]?.characterStateRefs ??
                previousAnalysis?.shots?.[0]?.character_state_refs ??
                []
            )
          }
        ],
    shotAssembly: previousAnalysis.shotAssembly ?? null
  };
};

const mergeSegmentAnalysis = ({ baseAnalysis, nextSegmentAnalysis = {} }) => {
  return {
    ...baseAnalysis,
    scenes:
      Array.isArray(nextSegmentAnalysis.scenes) && nextSegmentAnalysis.scenes.length
        ? nextSegmentAnalysis.scenes
        : baseAnalysis.scenes ?? [],
    characters:
      Array.isArray(nextSegmentAnalysis.characters) && nextSegmentAnalysis.characters.length
        ? nextSegmentAnalysis.characters
        : baseAnalysis.characters ?? [],
    scene: String(nextSegmentAnalysis.scene ?? '').trim() || baseAnalysis.scene || baseAnalysis.sceneSummary,
    action: String(nextSegmentAnalysis.action ?? '').trim() || baseAnalysis.action || '',
    prompt:
      String(nextSegmentAnalysis.prompt ?? '').trim() ||
      baseAnalysis.prompt ||
      baseAnalysis.scenePrompt ||
      baseAnalysis.backgroundPrompt,
    analysisOptions: baseAnalysis.analysisOptions ?? normalizeAnalysisOptions(),
    shots: Array.isArray(baseAnalysis.shots) ? baseAnalysis.shots : [],
    shotAssembly: baseAnalysis.shotAssembly ?? null
  };
};

const getSegmentRecordById = async (segmentId, options = {}) => {
  const segment = await Segment.findByPk(segmentId, options);

  if (!segment) {
    throw new AppError('Segment not found.', 404, {
      segment_id: segmentId
    });
  }

  return segment;
};

const getLatestTasksBySegmentIds = async (segmentIds) => {
  if (!segmentIds.length) {
    return {
      latestAttemptTaskBySegmentId: new Map(),
      latestCompletedTaskBySegmentId: new Map()
    };
  }

  const latestTasks = await GenerationTask.findAll({
    where: {
      segmentId: segmentIds
    },
    order: [['createdAt', 'DESC']]
  });

  const latestAttemptTaskBySegmentId = new Map();
  const latestCompletedTaskBySegmentId = new Map();

  latestTasks.forEach((task) => {
    if (!latestAttemptTaskBySegmentId.has(task.segmentId)) {
      latestAttemptTaskBySegmentId.set(task.segmentId, task);
    }

    if (isUsableCompletedGenerationTask(task) && !latestCompletedTaskBySegmentId.has(task.segmentId)) {
      latestCompletedTaskBySegmentId.set(task.segmentId, task);
    }
  });

  return {
    latestAttemptTaskBySegmentId,
    latestCompletedTaskBySegmentId
  };
};

const processSplitTask = async (taskId, videoId, timeAnchors) => {
  try {
    updateTask(taskId, {
      status: 'processing',
      progress: 5,
      message: 'Loading video and time anchors'
    });

    const video = await getVideoRecordById(videoId);
    const overallAnalysis = await getAnalysisRecordByVideoId(videoId);
    const analysisOptions = normalizeAnalysisOptions(overallAnalysis?.analysisOptions);
    const providedAnchors = normalizeTimeAnchors(timeAnchors);
    const normalizedAnchors =
      providedAnchors.length > 0
        ? providedAnchors
        : normalizeTimeAnchors(overallAnalysis?.timeAnchors ?? []);

    if (!normalizedAnchors.length) {
      throw new AppError('No time anchors are available for splitting.', 400, {
        video_id: videoId
      });
    }

    await Segment.destroy({
      where: {
        videoId
      }
    });

    const splitSegments = await splitVideo(resolveVideoAbsolutePath(video), normalizedAnchors, {
      basename: path.basename(video.filename, path.extname(video.filename)),
      onProgress: (progress) => {
        updateTask(taskId, {
          status: 'processing',
          progress: Math.min(60, Math.max(10, Math.round(progress * 0.6))),
          message: 'Splitting source video'
        });
      }
    });

    const createdSegments = [];

    for (const segmentInfo of splitSegments) {
      const timeAnchor = normalizedAnchors[segmentInfo.segmentIndex] ?? {};
      // Split should stay local and fast: the single whole-video Gemini pass already owns
      // the source of truth for segment prompts and shot definitions.
      const segmentAnalysis = buildBaseSegmentAnalysis({
        segment: segmentInfo,
        timeAnchor,
        overallAnalysis
      });
      const nextShots = await rebuildShotAssetsForSegment({
        segment: segmentInfo,
        shots: segmentAnalysis.shots ?? []
      });
      const speechReadyShots = await rebuildShotSpeechAssetsForSegment({
        segment: segmentInfo,
        shots: nextShots,
        analysisOptions
      });

      const segment = await Segment.create({
        videoId,
        segmentIndex: segmentInfo.segmentIndex,
        startTime: segmentInfo.startTime,
        endTime: segmentInfo.endTime,
        filePath: segmentInfo.filePath,
        analysis: {
          ...segmentAnalysis,
          analysisOptions,
          shots: speechReadyShots
        }
      });

      createdSegments.push(segment);

      updateTask(taskId, {
        status: 'processing',
        progress: 60 + Math.round((createdSegments.length / splitSegments.length) * 35),
        message: 'Building segment cards'
      });
    }

    completeTask(
      taskId,
      {
        video_id: videoId,
        segment_count: createdSegments.length
      },
      'Video split completed'
    );
  } catch (error) {
    failTask(taskId, error.message);
  }
};

const startSplitVideo = async ({ videoId, timeAnchors }) => {
  await getVideoRecordById(videoId);

  const task = createTask({
    type: 'split',
    meta: {
      videoId
    },
    message: 'Split task queued'
  });

  queueMicrotask(() => {
    void processSplitTask(task.id, videoId, timeAnchors);
  });

  return {
    task_id: task.id,
    status: task.status,
    progress: task.progress
  };
};

const analyzeSegmentById = async (segmentId, { styleMode = '', segmentAnalysisStylePrompt = '' } = {}) => {
  const segment = await ensurePersistentShotAssets(await getSegmentRecordById(segmentId));
  const overallAnalysis = await getAnalysisRecordByVideoId(segment.videoId);

  if (!overallAnalysis) {
    throw new AppError('请先完成整片分析，再执行片段分析。', 400, {
      segment_id: segmentId,
      video_id: segment.videoId
    });
  }

  const timeAnchor = normalizeTimeAnchors(overallAnalysis.timeAnchors ?? [])[segment.segmentIndex] ?? {};
  const baseSegmentAnalysis = buildBaseSegmentAnalysis({
    segment: {
      id: segment.id,
      segmentIndex: segment.segmentIndex,
      startTime: Number(segment.startTime),
      endTime: Number(segment.endTime),
      filePath: segment.filePath
    },
    timeAnchor,
    overallAnalysis,
    previousAnalysis: segment.analysis ?? {}
  });
  const nextSegmentAnalysis = await analyzeSegmentContent({
    segment: {
      id: segment.id,
      segmentIndex: segment.segmentIndex,
      startTime: Number(segment.startTime),
      endTime: Number(segment.endTime),
      filePath: segment.filePath,
      analysis: baseSegmentAnalysis
    },
    overallAnalysis,
    segmentAbsolutePath: resolveUploadPath(segment.filePath),
    styleMode,
    segmentAnalysisStylePrompt
  });

  await segment.update({
    analysis: mergeSegmentAnalysis({
      baseAnalysis: baseSegmentAnalysis,
      nextSegmentAnalysis
    })
  });

  const { latestAttemptTaskBySegmentId, latestCompletedTaskBySegmentId } = await getLatestTasksBySegmentIds([segment.id]);
  const shotDefinitionInvalidatedAt = getShotDefinitionInvalidatedAt(segment);
  const { latestAttemptTaskBySegmentId: latestAttemptShotTaskBySegmentId, latestCompletedTaskBySegmentId: latestCompletedShotTaskBySegmentId } =
    await getLatestShotTaskMapsBySegmentIds([segment.id], {
      createdAfter: shotDefinitionInvalidatedAt
    });

  return serializeSegment(
    segment,
    latestCompletedTaskBySegmentId.get(segment.id) ?? null,
    latestAttemptTaskBySegmentId.get(segment.id) ?? null,
    latestCompletedShotTaskBySegmentId.get(segment.id) ?? new Map(),
    latestAttemptShotTaskBySegmentId.get(segment.id) ?? new Map()
  );
};

const listSegmentsByVideoId = async (videoId) => {
  await getVideoRecordById(videoId);

  const segments = await Segment.findAll({
    where: {
      videoId
    },
    order: [['segmentIndex', 'ASC']]
  });

  if (!segments.length) {
    return [];
  }

  const hydratedSegments = await Promise.all(segments.map((segment) => ensurePersistentShotAssets(segment)));

  const { latestAttemptTaskBySegmentId, latestCompletedTaskBySegmentId } = await getLatestTasksBySegmentIds(
    hydratedSegments.map((segment) => segment.id)
  );

  return Promise.all(
    hydratedSegments.map(async (segment) => {
      const shotDefinitionInvalidatedAt = getShotDefinitionInvalidatedAt(segment);
      const {
        latestAttemptTaskBySegmentId: latestAttemptShotTaskBySegmentId,
        latestCompletedTaskBySegmentId: latestCompletedShotTaskBySegmentId
      } = await getLatestShotTaskMapsBySegmentIds([segment.id], {
        createdAfter: shotDefinitionInvalidatedAt
      });

      return serializeSegment(
        segment,
        latestCompletedTaskBySegmentId.get(segment.id) ?? null,
        latestAttemptTaskBySegmentId.get(segment.id) ?? null,
        latestCompletedShotTaskBySegmentId.get(segment.id) ?? new Map(),
        latestAttemptShotTaskBySegmentId.get(segment.id) ?? new Map()
      );
    })
  );
};

const updateSegmentShotsById = async (segmentId, shots) => {
  const segment = await getSegmentRecordById(segmentId);
  const segmentStartTime = Number(segment.startTime);
  const segmentEndTime = Number(segment.endTime);
  const overallAnalysis = await getAnalysisRecordByVideoId(segment.videoId);
  const persistedShots = hydrateCharacterStateRefsForShots({
    shots: buildPersistedShotDefinitions(shots, segmentStartTime, segmentEndTime),
    characters: overallAnalysis?.characters ?? []
  });
  const currentPersistedShots = normalizeShotDefinitions(segment.analysis?.shots ?? [], segmentStartTime, segmentEndTime);
  const analysisOptions = normalizeAnalysisOptions(segment.analysis?.analysisOptions);

  if (
    arePersistedShotDefinitionsEqual(
      getShotPersistenceComparablePayload(currentPersistedShots),
      getShotPersistenceComparablePayload(persistedShots)
    )
  ) {
    const { latestAttemptTaskBySegmentId, latestCompletedTaskBySegmentId } = await getLatestTasksBySegmentIds([segment.id]);
    const shotDefinitionInvalidatedAt = getShotDefinitionInvalidatedAt(segment);
    const {
      latestAttemptTaskBySegmentId: latestAttemptShotTaskBySegmentId,
      latestCompletedTaskBySegmentId: latestCompletedShotTaskBySegmentId
    } = await getLatestShotTaskMapsBySegmentIds([segment.id], {
      createdAfter: shotDefinitionInvalidatedAt
    });

    return serializeSegment(
      segment,
      latestCompletedTaskBySegmentId.get(segment.id) ?? null,
      latestAttemptTaskBySegmentId.get(segment.id) ?? null,
      latestCompletedShotTaskBySegmentId.get(segment.id) ?? new Map(),
      latestAttemptShotTaskBySegmentId.get(segment.id) ?? new Map()
    );
  }

  const invalidatedAt = new Date().toISOString();
  const rebuildRequired =
    !arePersistedShotDefinitionsEqual(
      getShotRebuildComparablePayload(currentPersistedShots),
      getShotRebuildComparablePayload(persistedShots)
    ) ||
    shotAssetsNeedRebuild(currentPersistedShots) ||
    shotSpeechAssetsNeedRebuild(currentPersistedShots, analysisOptions);
  const nextShots = rebuildRequired
    ? await rebuildShotSpeechAssetsForSegment({
        segment,
        shots: await rebuildShotAssetsForSegment({
          segment,
          shots: persistedShots,
          previousShots: segment.analysis?.shots ?? []
        }),
        previousShots: segment.analysis?.shots ?? [],
        analysisOptions,
        cleanupExisting: true
      })
    : await persistShotSpeechEditsForSegment({
        segment,
        shots: mergeShotPersistedAssets(persistedShots, currentPersistedShots),
        previousShots: segment.analysis?.shots ?? [],
        analysisOptions
      });
  const nextAnalysis = {
    ...(segment.analysis ?? {}),
    analysisOptions,
    shots: nextShots,
    shotAssembly: null,
    shotAssemblyInvalidatedAt: invalidatedAt
  };

  await segment.update({
    analysis: nextAnalysis
  });
  segment.analysis = nextAnalysis;

  const { latestAttemptTaskBySegmentId, latestCompletedTaskBySegmentId } = await getLatestTasksBySegmentIds([segment.id]);
  const {
    latestAttemptTaskBySegmentId: latestAttemptShotTaskBySegmentId,
    latestCompletedTaskBySegmentId: latestCompletedShotTaskBySegmentId
  } = await getLatestShotTaskMapsBySegmentIds([segment.id], {
    createdAfter: invalidatedAt
  });

  return serializeSegment(
    segment,
    latestCompletedTaskBySegmentId.get(segment.id) ?? null,
    latestAttemptTaskBySegmentId.get(segment.id) ?? null,
    latestCompletedShotTaskBySegmentId.get(segment.id) ?? new Map(),
    latestAttemptShotTaskBySegmentId.get(segment.id) ?? new Map()
  );
};

export { startSplitVideo, listSegmentsByVideoId, analyzeSegmentById, getSegmentRecordById, updateSegmentShotsById };
