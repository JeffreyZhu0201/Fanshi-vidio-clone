import { Analysis, GenerationTask, Segment, ShotGenerationTask, Video } from '../models/index.js';
import env from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { TASK_STATUS } from '../config/constants.js';
import {
  DEFAULT_STYLE_MODE,
  normalizeStyleMode,
  resolveStyleTemplate
} from '../../shared/styleTemplates.js';
import { ensureBackgroundAsset } from './backgroundAssetService.js';
import {
  buildSeedDanceReconstructionPrompt,
  broadcastGenerationTaskUpdate,
  collectCharacterReferenceImages,
  collectSceneReferenceImages,
  composeSeedDanceReferenceImages,
  expandPromptMentions,
  getBackgroundBindingForSegment,
  normalizeUseReferenceFrame,
  normalizeUseReferenceVideo,
  getPromptMentionNames,
  getPromptSceneNames
} from './generationService.js';
import { publicUrlToRelativePath, resolveUploadPath, toAbsolutePublicUploadUrl } from './fileService.js';
import {
  compressAudioClipToDuration,
  extractVideoFrame,
  getVideoMetadata,
  mergeVideos,
  padAudioClipToDuration
} from './ffmpegService.js';
import {
  MAX_SEED_DANCE_REFERENCE_AUDIO_COMPRESSION_RATIO,
  MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS,
  buildDialogueDeliveryConstraint,
  resolveDialogueTimingPlan,
  scaleSubtitleLinesForCompression
} from './dialogueTimingService.js';
import { broadcastRealtimeEvent } from './realtimeService.js';
import {
  assertSeedDanceReady,
  generateSegment as generateWithSeedDance,
  resolveSeedDanceProviderDuration,
  resumeRemoteGenerationTask
} from './seedDanceService.js';
import { rebuildShotAssetsForSegment, shotAssetsNeedRebuild } from './shotAssetService.js';
import {
  buildTranscriptFromSubtitleLines,
  isSpeechAnalysisEnabled,
  normalizeAnalysisOptions,
  normalizeShotSpeech
  ,
  rebuildShotSpeechAssetsForSegment,
  shotSpeechAssetsNeedRebuild
} from './shotSpeechService.js';
import { normalizeCharacterStateRefs } from './characterStateService.js';

const SHOT_TASK_EVENT = 'shot:progress';
const SHOT_ASSEMBLY_EVENT = 'shot-assembly:progress';
const inflightShotGenerationTaskProcesses = new Map();

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
        ) ?? null,
      sourceAudioFilePath: String(shot.sourceAudioFilePath ?? shot.source_audio_file_path ?? '').trim(),
      sourceAudioFileUrl: String(shot.sourceAudioFileUrl ?? shot.source_audio_file_url ?? '').trim(),
      speech: normalizeShotSpeech(shot.speech ?? null, {
        durationSeconds: Number(Math.max(0.3, safeEndTime - shotStartTime).toFixed(2)),
        fallbackStatus: 'idle'
      }),
      characterStateRefs: normalizeCharacterStateRefs(
        shot.characterStateRefs ?? shot.character_state_refs ?? []
      )
    };
  });
};

const normalizeGenerationRatio = (value) => {
  const trimmedValue = String(value ?? '').trim();
  return /^[1-9]\d{0,2}:[1-9]\d{0,2}$/u.test(trimmedValue) ? trimmedValue : env.SEED_DANCE_RATIO;
};

const normalizeComparablePrompt = (value) => String(value ?? '').trim();

const areNumericTaskFieldsEqual = (leftValue, rightValue) => {
  const leftNumber = Number(leftValue);
  const rightNumber = Number(rightValue);

  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false;
  }

  return Math.abs(leftNumber - rightNumber) < 0.01;
};

const buildShotSpeechSignature = (shot) => {
  const normalizedSpeech = normalizeShotSpeech(shot?.speech ?? null, {
    durationSeconds: Number(shot?.durationSeconds ?? 0),
    fallbackStatus: 'idle'
  });

  return JSON.stringify({
    transcript: String(normalizedSpeech.transcript ?? '').trim(),
    subtitleLines: normalizedSpeech.subtitleLines ?? [],
    speechStyle: String(normalizedSpeech.speechStyle ?? '').trim(),
    hasDialogue: Boolean(normalizedSpeech.hasDialogue),
    sourceOfTruth: String(normalizedSpeech.sourceOfTruth ?? '').trim()
  });
};

const buildShotCharacterStateSignature = (shot) => {
  const normalizedStateRefs = normalizeCharacterStateRefs(shot?.characterStateRefs ?? shot?.character_state_refs ?? []);

  return JSON.stringify(
    normalizedStateRefs.map((stateRef) => ({
      characterName: stateRef.characterName,
      stateId: stateRef.stateId,
      stateName: stateRef.stateName,
      continuityPrompt: stateRef.continuityPrompt,
      representativeFrameImagePath: stateRef.representativeFrameImagePath,
      representativeFrameImageUrl: stateRef.representativeFrameImageUrl
    }))
  );
};

const estimateTranscriptDurationSeconds = (speech = null) => {
  const normalizedSpeech = normalizeShotSpeech(speech ?? null, {
    durationSeconds: 9999,
    fallbackStatus: 'idle'
  });
  const lastSubtitleEndTime = normalizedSpeech.subtitleLines.length
    ? Number(normalizedSpeech.subtitleLines[normalizedSpeech.subtitleLines.length - 1].endTime ?? 0)
    : 0;
  const transcriptLength = Array.from(String(normalizedSpeech.transcript ?? '').replace(/\s+/gu, '')).length;
  const heuristicTranscriptDuration = transcriptLength ? transcriptLength / 4.5 : 0;

  return Number(Math.max(lastSubtitleEndTime, heuristicTranscriptDuration, 0).toFixed(2));
};

const resolveShotGenerationStyleMode = (styleMode = '', analysisOptions = null) => {
  return normalizeStyleMode(styleMode || analysisOptions?.styleMode || analysisOptions?.style_mode || DEFAULT_STYLE_MODE);
};

const prepareDialogueGenerationPayload = async ({
  segment,
  shot,
  shotSpeech,
  shotDurationSeconds,
  sourceAudioAbsolutePath = '',
  sourceAudioPublicUrl = '',
  taskId,
  styleMode = ''
}) => {
  let effectiveAudioAbsolutePath = sourceAudioAbsolutePath;
  let effectiveAudioPublicUrl = sourceAudioPublicUrl;
  const generationWarnings = [];
  let speechForGeneration = {
    ...shotSpeech,
    subtitleLines: Array.isArray(shotSpeech.subtitleLines) ? shotSpeech.subtitleLines : []
  };

  if (!speechForGeneration.hasDialogue) {
    return {
      effectiveAudioAbsolutePath,
      effectiveAudioPublicUrl,
      speechForGeneration,
      generationWarnings
    };
  }

  const transcript = speechForGeneration.transcript || buildTranscriptFromSubtitleLines(speechForGeneration.subtitleLines);
  const estimatedTranscriptDurationSeconds = estimateTranscriptDurationSeconds({
    ...speechForGeneration,
    transcript
  });
  const providerDurationSeconds = resolveSeedDanceProviderDuration(shotDurationSeconds);

  if (!sourceAudioAbsolutePath) {
    const dialogueTimingPlan = resolveDialogueTimingPlan({
      shotDurationSeconds,
      providerDurationSeconds,
      estimatedTranscriptDurationSeconds
    });
    const estimatedCompressionRatio = dialogueTimingPlan.requiredCompressionRatio;

    if (estimatedCompressionRatio > MAX_SEED_DANCE_REFERENCE_AUDIO_COMPRESSION_RATIO) {
      throw new AppError(
        `当前镜头对白按文字估算需要约 ${estimatedTranscriptDurationSeconds.toFixed(2)} 秒，已超过镜头 ${shotDurationSeconds.toFixed(
          2
        )} 秒可承载范围；需要压缩到 ${estimatedCompressionRatio.toFixed(2)}x，超过 1.5x 上限，请先拆镜头或缩短台词。`,
        409,
        {
          segment_id: segment?.id,
          shot_id: shot?.id,
          estimated_transcript_duration_seconds: estimatedTranscriptDurationSeconds,
          shot_duration_seconds: shotDurationSeconds,
          required_compression_ratio: Number(estimatedCompressionRatio.toFixed(3))
        }
      );
    }

    speechForGeneration = {
      ...speechForGeneration,
      transcript,
      subtitleLines:
        estimatedCompressionRatio > 1.001
          ? scaleSubtitleLinesForCompression(
              speechForGeneration.subtitleLines,
              estimatedCompressionRatio,
              dialogueTimingPlan.dialogueCompletionTimeSeconds
            )
          : speechForGeneration.subtitleLines,
      fitWithinDuration:
        estimatedCompressionRatio > 1.02 ||
        dialogueTimingPlan.providerTailPaddingSeconds > 0.05 ||
        dialogueTimingPlan.trimSafetyTailSeconds > 0.02,
      deliveryRateMultiplier: estimatedCompressionRatio > 1 ? Number(estimatedCompressionRatio.toFixed(2)) : 1,
      dialogueCompletionTimeSeconds: dialogueTimingPlan.dialogueCompletionTimeSeconds,
      providerTargetDurationSeconds: dialogueTimingPlan.providerDurationSeconds,
      trimSafetyTailSeconds: dialogueTimingPlan.trimSafetyTailSeconds,
      providerTailPaddingSeconds: dialogueTimingPlan.providerTailPaddingSeconds,
      deliveryConstraint: buildDialogueDeliveryConstraint(dialogueTimingPlan)
    };

    return {
      effectiveAudioAbsolutePath,
      effectiveAudioPublicUrl,
      speechForGeneration,
      generationWarnings
    };
  }

  const audioMetadata = await getVideoMetadata(sourceAudioAbsolutePath);
  const originalAudioDurationSeconds = Number(audioMetadata?.durationSecondsExact ?? audioMetadata?.duration ?? 0);
  const dialogueTimingPlan = resolveDialogueTimingPlan({
    shotDurationSeconds,
    providerDurationSeconds,
    sourceAudioDurationSeconds: originalAudioDurationSeconds,
    estimatedTranscriptDurationSeconds
  });
  const compressionRatio = dialogueTimingPlan.requiredCompressionRatio;

  if (compressionRatio > MAX_SEED_DANCE_REFERENCE_AUDIO_COMPRESSION_RATIO) {
    throw new AppError(
      `当前镜头参考音频约 ${originalAudioDurationSeconds.toFixed(2)} 秒，已超过镜头 ${shotDurationSeconds.toFixed(
        2
      )} 秒可承载范围；需要压缩到 ${compressionRatio.toFixed(2)}x，超过 1.5x 上限，请先拆镜头或缩短台词。`,
      409,
      {
        segment_id: segment?.id,
        shot_id: shot?.id,
        reference_audio_duration_seconds: originalAudioDurationSeconds,
        shot_duration_seconds: shotDurationSeconds,
        required_compression_ratio: Number(compressionRatio.toFixed(3))
      }
    );
  }

  let effectiveAudioDurationSeconds = originalAudioDurationSeconds;

  if (compressionRatio > 1.001) {
    const compressedAudio = await compressAudioClipToDuration(
      sourceAudioAbsolutePath,
      dialogueTimingPlan.dialogueCompletionTimeSeconds,
      {
      basename: `segment-${segment.id}-${shot.id}-task-${taskId}-speech-audio-fitted`
      }
    );

    if (!compressedAudio?.filePath) {
      throw new AppError('参考音频压缩失败，已停止本次镜头生成，请稍后重试。', 500, {
        segment_id: segment?.id,
        shot_id: shot?.id
      });
    }

    effectiveAudioAbsolutePath = resolveUploadPath(compressedAudio.filePath);
    effectiveAudioPublicUrl = toAbsolutePublicUploadUrl(compressedAudio.filePath) || compressedAudio.fileUrl || '';
    effectiveAudioDurationSeconds = dialogueTimingPlan.dialogueCompletionTimeSeconds;
    speechForGeneration = {
      ...speechForGeneration,
      transcript,
      subtitleLines: scaleSubtitleLinesForCompression(
        speechForGeneration.subtitleLines,
        compressionRatio,
        dialogueTimingPlan.dialogueCompletionTimeSeconds
      ),
      fitWithinDuration: true,
      deliveryRateMultiplier: Number(compressionRatio.toFixed(2)),
      dialogueCompletionTimeSeconds: dialogueTimingPlan.dialogueCompletionTimeSeconds,
      providerTargetDurationSeconds: dialogueTimingPlan.providerDurationSeconds,
      trimSafetyTailSeconds: dialogueTimingPlan.trimSafetyTailSeconds,
      providerTailPaddingSeconds: dialogueTimingPlan.providerTailPaddingSeconds,
      deliveryConstraint: buildDialogueDeliveryConstraint(dialogueTimingPlan)
    };
    generationWarnings.push(
      `小镜头参考音频长于镜头时长，已先按 ${compressionRatio.toFixed(2)}x 压缩到约 ${dialogueTimingPlan.dialogueCompletionTimeSeconds.toFixed(
        2
      )} 秒的镜头有效时长内`
    );
  } else {
    speechForGeneration = {
      ...speechForGeneration,
      transcript,
      fitWithinDuration:
        dialogueTimingPlan.providerTailPaddingSeconds > 0.05 || dialogueTimingPlan.trimSafetyTailSeconds > 0.02,
      dialogueCompletionTimeSeconds: dialogueTimingPlan.dialogueCompletionTimeSeconds,
      providerTargetDurationSeconds: dialogueTimingPlan.providerDurationSeconds,
      trimSafetyTailSeconds: dialogueTimingPlan.trimSafetyTailSeconds,
      providerTailPaddingSeconds: dialogueTimingPlan.providerTailPaddingSeconds,
      deliveryConstraint: buildDialogueDeliveryConstraint(dialogueTimingPlan)
    };
  }

  if (
    effectiveAudioAbsolutePath &&
    dialogueTimingPlan.finalReferenceAudioDurationSeconds > effectiveAudioDurationSeconds + 0.01
  ) {
    const paddedAudio = await padAudioClipToDuration(
      effectiveAudioAbsolutePath,
      dialogueTimingPlan.finalReferenceAudioDurationSeconds,
      {
        basename: `segment-${segment.id}-${shot.id}-task-${taskId}-speech-audio-padded`
      }
    );

    if (paddedAudio?.filePath) {
      effectiveAudioAbsolutePath = resolveUploadPath(paddedAudio.filePath);
      effectiveAudioPublicUrl = toAbsolutePublicUploadUrl(paddedAudio.filePath) || paddedAudio.fileUrl || '';
      effectiveAudioDurationSeconds = dialogueTimingPlan.finalReferenceAudioDurationSeconds;
      generationWarnings.push(
        `对白参考音频已补到 ${dialogueTimingPlan.finalReferenceAudioDurationSeconds.toFixed(
          2
        )} 秒，确保裁回镜头时台词仍完整，并尽量贴近镜头末尾收口`
      );
    } else if (effectiveAudioDurationSeconds < MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS) {
      generationWarnings.push(
        `小镜头参考音频不足 ${MIN_SEED_DANCE_REFERENCE_AUDIO_DURATION_SECONDS} 秒，补静音失败，已仅使用文本对白约束`
      );
      effectiveAudioAbsolutePath = '';
      effectiveAudioPublicUrl = '';
    } else {
      generationWarnings.push(
        `对白参考音频未能补到 ${dialogueTimingPlan.finalReferenceAudioDurationSeconds.toFixed(
          2
        )} 秒，将继续使用当前音频并依赖提示词约束控制对白完成点`
      );
    }
  }

  return {
    effectiveAudioAbsolutePath,
    effectiveAudioPublicUrl,
    speechForGeneration: speechForGeneration
      ? {
          ...speechForGeneration,
          styleMode: resolveShotGenerationStyleMode(styleMode)
        }
      : speechForGeneration,
    generationWarnings
  };
};

const doesShotTaskMatchGenerationRequest = ({
  task,
  shot,
  prompt,
  ratio,
  styleMode = '',
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  if (!task || !shot) {
    return false;
  }

  return (
    String(task.shotId ?? '').trim() === String(shot.id ?? '').trim() &&
    normalizeComparablePrompt(task.prompt) === normalizeComparablePrompt(prompt) &&
    normalizeGenerationRatio(task.meta?.ratio) === normalizeGenerationRatio(ratio) &&
    normalizeUseReferenceVideo(task.meta?.useReferenceVideo ?? task.meta?.use_reference_video, true) ===
      normalizeUseReferenceVideo(useReferenceVideo, true) &&
    normalizeUseReferenceFrame(task.meta?.useReferenceFrame ?? task.meta?.use_reference_frame, true) ===
      normalizeUseReferenceFrame(useReferenceFrame, true) &&
    normalizeStyleMode(task.meta?.styleMode ?? task.meta?.style_mode ?? DEFAULT_STYLE_MODE) ===
      resolveShotGenerationStyleMode(styleMode || task.meta?.styleMode || task.meta?.style_mode || DEFAULT_STYLE_MODE) &&
    String(task.meta?.speechSignature ?? '').trim() === buildShotSpeechSignature(shot) &&
    String(task.meta?.characterStateSignature ?? '').trim() === buildShotCharacterStateSignature(shot) &&
    areNumericTaskFieldsEqual(task.startTime, shot.startTime) &&
    areNumericTaskFieldsEqual(task.endTime, shot.endTime) &&
    areNumericTaskFieldsEqual(task.durationSeconds, shot.durationSeconds)
  );
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

const isUsableCompletedShotTask = (task) => {
  return Boolean(task?.status === TASK_STATUS.completed && task?.resultUrl && !isTaskMarkedMock(task));
};

const getExistingReusableShotTask = ({
  latestAttemptTaskByShotId = new Map(),
  latestCompletedTaskByShotId = new Map(),
  shot,
  prompt,
  ratio,
  styleMode = '',
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  const latestAttemptTask = latestAttemptTaskByShotId.get(String(shot?.id ?? '').trim()) ?? null;

  if (
    latestAttemptTask &&
    [TASK_STATUS.pending, TASK_STATUS.processing].includes(latestAttemptTask.status) &&
    doesShotTaskMatchGenerationRequest({
      task: latestAttemptTask,
      shot,
      prompt,
      ratio,
      styleMode,
      useReferenceVideo,
      useReferenceFrame
    })
  ) {
    return latestAttemptTask;
  }

  const latestCompletedTask = latestCompletedTaskByShotId.get(String(shot?.id ?? '').trim()) ?? null;

  if (
    isUsableCompletedShotTask(latestCompletedTask) &&
    doesShotTaskMatchGenerationRequest({
      task: latestCompletedTask,
      shot,
      prompt,
      ratio,
      styleMode,
      useReferenceVideo,
      useReferenceFrame
    })
  ) {
    return latestCompletedTask;
  }

  return null;
};

const shouldRestartLocalShotTask = (task) => {
  if (!task || ![TASK_STATUS.pending, TASK_STATUS.processing].includes(task.status)) {
    return false;
  }

  if (String(task.meta?.remoteTaskId ?? '').trim()) {
    return false;
  }

  const updatedAtMs = task?.updatedAt ? Date.parse(task.updatedAt) : 0;
  const staleAfterMs = Math.max(30000, Number(env.SEED_DANCE_CREATE_TIMEOUT_MS ?? 120000) + 10000);

  return Boolean(updatedAtMs) && Date.now() - updatedAtMs > staleAfterMs;
};

const createCompletedReuseTaskForBatch = async ({
  segmentId,
  shot,
  prompt,
  ratio,
  styleMode = '',
  startedAt,
  sourceTask
}) => {
  const reuseTask = await ShotGenerationTask.create({
    segmentId,
    shotId: shot.id,
    shotIndex: shot.shotIndex,
    prompt,
    optimizedPrompt: sourceTask.optimizedPrompt || prompt,
    startTime: shot.startTime,
    endTime: shot.endTime,
    durationSeconds: shot.durationSeconds,
    status: TASK_STATUS.completed,
    progress: 100,
    resultUrl: sourceTask.resultUrl,
    errorMessage: null,
    meta: {
      ...(sourceTask.meta ?? {}),
      source: 'shot_generation_batch_reuse',
      batchStartedAt: startedAt,
      ratio: normalizeGenerationRatio(ratio),
      styleMode: resolveShotGenerationStyleMode(styleMode),
      useReferenceVideo: normalizeUseReferenceVideo(sourceTask.meta?.useReferenceVideo ?? sourceTask.meta?.use_reference_video, true),
      useReferenceFrame: normalizeUseReferenceFrame(sourceTask.meta?.useReferenceFrame ?? sourceTask.meta?.use_reference_frame, true),
      speechSignature: buildShotSpeechSignature(shot),
      characterStateSignature: buildShotCharacterStateSignature(shot),
      reusedFromTaskId: sourceTask.id
    }
  });

  broadcastShotGenerationTaskUpdate(reuseTask);
  return reuseTask;
};

const createResumedReuseTaskForBatch = async ({
  segmentId,
  shot,
  prompt,
  ratio,
  styleMode = '',
  startedAt,
  sourceTask
}) => {
  const resumedTask = await ShotGenerationTask.create({
    segmentId,
    shotId: shot.id,
    shotIndex: shot.shotIndex,
    prompt,
    optimizedPrompt: sourceTask.optimizedPrompt || prompt,
    startTime: shot.startTime,
    endTime: shot.endTime,
    durationSeconds: shot.durationSeconds,
    status: TASK_STATUS.pending,
    progress: Math.max(0, Number(sourceTask.progress ?? 0) || 0),
    meta: {
      ...(sourceTask.meta ?? {}),
      source: 'shot_generation_batch_resume',
      batchStartedAt: startedAt,
      ratio: normalizeGenerationRatio(ratio),
      styleMode: resolveShotGenerationStyleMode(styleMode),
      useReferenceVideo: normalizeUseReferenceVideo(sourceTask.meta?.useReferenceVideo ?? sourceTask.meta?.use_reference_video, true),
      useReferenceFrame: normalizeUseReferenceFrame(sourceTask.meta?.useReferenceFrame ?? sourceTask.meta?.use_reference_frame, true),
      speechSignature: buildShotSpeechSignature(shot),
      characterStateSignature: buildShotCharacterStateSignature(shot),
      reusedFromTaskId: sourceTask.id
    }
  });

  broadcastShotGenerationTaskUpdate(resumedTask);
  return resumedTask;
};

const serializeShotGenerationMeta = (task) => {
  const taskMeta = task?.meta ?? {};

  return {
    engine: String(taskMeta.engine ?? '').trim(),
    ratio: String(taskMeta.ratio ?? '').trim(),
    style_mode: normalizeStyleMode(taskMeta.styleMode ?? taskMeta.style_mode ?? DEFAULT_STYLE_MODE),
    use_reference_video: normalizeUseReferenceVideo(taskMeta.useReferenceVideo ?? taskMeta.use_reference_video, true),
    use_reference_frame: normalizeUseReferenceFrame(taskMeta.useReferenceFrame ?? taskMeta.use_reference_frame, true),
    remote_status: String(taskMeta.remoteStatus ?? '').trim(),
    remote_status_label: String(taskMeta.remoteStatusLabel ?? '').trim(),
    remote_created_at: Number(taskMeta.remoteCreatedAt ?? 0) || null,
    remote_updated_at: Number(taskMeta.remoteUpdatedAt ?? 0) || null,
    is_mock: Boolean(taskMeta.isMock),
    remote_task_id: String(taskMeta.remoteTaskId ?? '').trim(),
    fallback_reason: String(taskMeta.fallbackReason ?? '').trim(),
    provider_error: String(taskMeta.providerError ?? '').trim(),
    source: String(taskMeta.source ?? '').trim(),
    sent_reference_images: Array.isArray(taskMeta.sentReferenceImages) ? taskMeta.sentReferenceImages : [],
    sent_reference_videos: Array.isArray(taskMeta.sentReferenceVideos) ? taskMeta.sentReferenceVideos : [],
    sent_reference_audios: Array.isArray(taskMeta.sentReferenceAudios) ? taskMeta.sentReferenceAudios : []
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
        : taskMeta.remoteUpdatedAt ?? null,
    sentReferenceImages: Array.isArray(progressPayload.sentReferenceImages)
      ? progressPayload.sentReferenceImages
      : taskMeta.sentReferenceImages ?? [],
    sentReferenceVideos: Array.isArray(progressPayload.sentReferenceVideos)
      ? progressPayload.sentReferenceVideos
      : taskMeta.sentReferenceVideos ?? [],
    sentReferenceAudios: Array.isArray(progressPayload.sentReferenceAudios)
      ? progressPayload.sentReferenceAudios
      : taskMeta.sentReferenceAudios ?? []
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

    if (isUsableCompletedShotTask(task)) {
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
  const hasAllRealShotResults = totalShotCount > 0 && completedShotCount === totalShotCount;
  const hasAssemblyResult = hasAllRealShotResults && Boolean(shotAssembly?.resultUrl || shotAssembly?.result_url);
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
      resultUrl: hasAssemblyResult ? shotAssembly?.resultUrl ?? shotAssembly?.result_url ?? '' : '',
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
      sourceAudioFilePath: shot.sourceAudioFilePath,
      sourceAudioFileUrl: shot.sourceAudioFileUrl,
      speech: shot.speech,
      characterStateRefs: shot.characterStateRefs,
      latestGenerationTask: serializeShotGenerationTask(latestGenerationTask),
      latestCompletedGenerationTask: serializeShotGenerationTask(latestCompletedGenerationTask),
      generatedUrl: latestCompletedGenerationTask?.resultUrl || ''
    };
  });
};

const ensureSegmentShotAssets = async (segment) => {
  const currentShots = Array.isArray(segment?.analysis?.shots) ? segment.analysis.shots : [];
  const analysisOptions = normalizeAnalysisOptions(segment?.analysis?.analysisOptions);
  let nextShots = currentShots;
  let shouldPersist = false;

  if (!currentShots.length) {
    return getNormalizedSegmentShots(segment);
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
  }

  if (!shouldPersist) {
    return getNormalizedSegmentShots(segment);
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
  if (shotTasks.some((task) => !isUsableCompletedShotTask(task))) {
    throw new AppError('小镜头结果包含非真实 Seedance 输出，已禁止拼回大片段。', 409, {
      segment_id: segment.id,
      shot_task_ids: shotTasks.map((task) => task?.id).filter(Boolean)
    });
  }

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
      isMock: false,
      remoteTaskId: '',
      fallbackReason: '',
      providerError: '',
      shotGenerationWarnings: shotTasks
        .map((task) => String(task.meta?.fallbackReason ?? '').trim())
        .filter(Boolean),
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

const processShotGenerationTaskUnlocked = async (taskId, { attemptAssembly = true } = {}) => {
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
    const analysisOptions = normalizeAnalysisOptions(
      segment?.analysis?.analysisOptions ?? overallAnalysis?.analysisOptions
    );
    const resolvedStyleMode = resolveShotGenerationStyleMode(
      task.meta?.styleMode ?? task.meta?.style_mode ?? '',
      analysisOptions
    );
    const useReferenceVideo = normalizeUseReferenceVideo(task.meta?.useReferenceVideo ?? task.meta?.use_reference_video, true);
    const useReferenceFrame = normalizeUseReferenceFrame(task.meta?.useReferenceFrame ?? task.meta?.use_reference_frame, true);
    const videoGenerationStylePrompt = resolveStyleTemplate({
      styleMode: resolvedStyleMode,
      styleTemplates: analysisOptions?.styleTemplates ?? overallAnalysis?.analysisOptions?.styleTemplates ?? null,
      templateKey: 'videoGenerationStylePrompt'
    });
    const speechEnabled = isSpeechAnalysisEnabled(analysisOptions);
    const shotSpeech = normalizeShotSpeech(shot?.speech ?? null, {
      durationSeconds: shot?.durationSeconds,
      fallbackStatus: 'idle'
    });
    const shouldGenerateDialogue = speechEnabled && Boolean(shotSpeech.hasDialogue);
    const segmentSourceAbsolutePath = resolveUploadPath(segment.filePath);
    const segmentSourcePublicUrl = toAbsolutePublicUploadUrl(segment.filePath) || segment.filePath;
    const shotSourceAbsolutePath = shot.sourceFilePath ? resolveUploadPath(shot.sourceFilePath) : '';
    const shotSourcePublicUrl =
      shot.sourceFileUrl || (shot.sourceFilePath ? toAbsolutePublicUploadUrl(shot.sourceFilePath) : '');
    const shotSourceAudioAbsolutePath = shot.sourceAudioFilePath ? resolveUploadPath(shot.sourceAudioFilePath) : '';
    const shotSourceAudioPublicUrl =
      shot.sourceAudioFileUrl || (shot.sourceAudioFilePath ? toAbsolutePublicUploadUrl(shot.sourceAudioFilePath) : '');
    let effectiveShotSourceAudioAbsolutePath = shotSourceAudioAbsolutePath;
    let effectiveShotSourceAudioPublicUrl = shotSourceAudioPublicUrl;
    const sourceVideoAbsolutePath = segment?.video?.filePath ? resolveUploadPath(segment.video.filePath) : '';
    const generationWarnings = [];
    const sourceAbsolutePath = shotSourceAbsolutePath || segmentSourceAbsolutePath;
    const sourcePublicUrl = shotSourcePublicUrl || segmentSourcePublicUrl;
    const remoteTaskId = String(task.meta?.remoteTaskId ?? '').trim();
    let speechForGeneration = shouldGenerateDialogue ? shotSpeech : null;

    if (remoteTaskId) {
      const result = await resumeRemoteGenerationTask({
        remoteTaskId,
        basename: `segment-${segment.id}-${task.shotId}-task-${task.id}`,
        duration: getShotDurationForGeneration(shot),
        expectAudioTrack: shouldGenerateDialogue || Boolean(task.meta?.generateAudio),
        onProgress: async (progressPayload) => {
          await applySeedDanceShotTaskProgress(task, progressPayload);
        }
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
          remoteTaskId: result.remoteTaskId || remoteTaskId,
          remoteUrl: result.remoteUrl || '',
          sentReferenceImages: task.meta?.sentReferenceImages ?? [],
          sentReferenceVideos: task.meta?.sentReferenceVideos ?? [],
          sentReferenceAudios: task.meta?.sentReferenceAudios ?? [],
          remoteStatus: 'succeeded',
          remoteStatusLabel: '远端已完成',
          remoteCreatedAt: task.meta?.remoteCreatedAt ?? null,
          remoteUpdatedAt: task.meta?.remoteUpdatedAt ?? null,
          fallbackReason: result.fallbackReason || '',
          providerError: result.providerError || ''
        }
      });
      broadcastShotGenerationTaskUpdate(task);
      await refreshShotAssemblyProgressFromTasks(task.segmentId);

      if (attemptAssembly) {
        try {
          await attemptPendingShotAssembly(task.segmentId);
        } catch (error) {
          const refreshedSegment = await Segment.findByPk(task.segmentId);

          if (refreshedSegment?.analysis?.shotAssembly) {
            await updateSegmentShotAssembly(refreshedSegment, {
              status: TASK_STATUS.failed,
              progress: 100,
              errorMessage: error.message
            });
          }
        }
      }

      return ShotGenerationTask.findByPk(task.id);
    }

    if (!shotSourceAbsolutePath) {
      generationWarnings.push('小镜头源视频缺失，已回退到大片段源视频');
    }

    if (shouldGenerateDialogue && !shotSourceAudioAbsolutePath) {
      generationWarnings.push('小镜头参考音频缺失，已仅使用字幕与说话方式约束');
    }

    if (shouldGenerateDialogue) {
      const dialoguePayload = await prepareDialogueGenerationPayload({
        segment,
        shot,
        shotSpeech,
        shotDurationSeconds: Number(shot?.durationSeconds ?? 0),
        sourceAudioAbsolutePath: shotSourceAudioAbsolutePath,
        sourceAudioPublicUrl: shotSourceAudioPublicUrl,
        taskId: task.id,
        styleMode: resolvedStyleMode
      });

      effectiveShotSourceAudioAbsolutePath = dialoguePayload.effectiveAudioAbsolutePath;
      effectiveShotSourceAudioPublicUrl = dialoguePayload.effectiveAudioPublicUrl;
      speechForGeneration = dialoguePayload.speechForGeneration;
      generationWarnings.push(...dialoguePayload.generationWarnings);
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
      plot: overallAnalysis?.plot ?? '',
      segmentPrompt: segment?.analysis?.prompt ?? segment?.analysis?.scenePrompt ?? '',
      shotPrompt: task.prompt,
      videoGenerationStylePrompt,
      characterNames: [...getPromptMentionNames(task.prompt), ...(Array.isArray(shot.characterNames) ? shot.characterNames : [])],
      sceneNames: [...getPromptSceneNames(task.prompt), ...(Array.isArray(shot.sceneNames) ? shot.sceneNames : []), backgroundBinding?.backgroundName || ''],
      characterStateRefs: shot.characterStateRefs ?? [],
      speech:
        shouldGenerateDialogue && speechForGeneration
          ? {
              ...speechForGeneration,
              transcript:
                speechForGeneration.transcript ||
                buildTranscriptFromSubtitleLines(speechForGeneration.subtitleLines)
            }
          : null,
      isShot: true,
      durationSeconds: getShotDurationForGeneration(shot),
      useReferenceVideo,
      useReferenceFrame
    });
    let primaryShotReferenceImage = null;

    if (useReferenceFrame && (shot.representativeFrameImagePath || shot.representativeFrameImageUrl)) {
      primaryShotReferenceImage = {
        relativePath: shot.representativeFrameImagePath || '',
        url: shot.representativeFrameImageUrl || '',
        role: 'reference_image',
        sourceKind: 'shot_representative_frame',
        displayLabel: '小镜头典型帧'
      };
    } else if (useReferenceFrame) {
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
          role: 'reference_image',
          sourceKind: 'shot_representative_frame',
          displayLabel: '动态抽帧典型帧'
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
    const referenceImages = composeSeedDanceReferenceImages({
      primaryImages: primaryShotReferenceImage ? [primaryShotReferenceImage] : [],
      characterImages: characterReferenceImages,
      sceneImages: sceneReferenceImages,
      primaryImagePlacement: 'after_assets'
    });

    await task.update({
      optimizedPrompt,
      progress: 45
    });
    broadcastShotGenerationTaskUpdate(task);

    const result = await generateWithSeedDance({
      sourceAbsolutePath: useReferenceVideo ? sourceAbsolutePath : '',
      sourcePublicUrl: useReferenceVideo ? sourcePublicUrl : '',
      sourceReferenceSourceKind: 'source_video',
      sourceReferenceDisplayLabel: '小镜头源视频',
      prompt: seedDancePrompt,
      basename: `segment-${segment.id}-${task.shotId}-task-${task.id}`,
      ratio: normalizeGenerationRatio(task.meta?.ratio),
      duration: getShotDurationForGeneration(shot),
      onProgress: async (progressPayload) => {
        await applySeedDanceShotTaskProgress(task, progressPayload);
      },
      generateAudio: shouldGenerateDialogue,
      expectAudioTrack: shouldGenerateDialogue,
      referenceImages,
      referenceAudios:
        shouldGenerateDialogue && (effectiveShotSourceAudioAbsolutePath || effectiveShotSourceAudioPublicUrl)
          ? [
              {
                absolutePath: effectiveShotSourceAudioAbsolutePath,
                relativePath:
                  effectiveShotSourceAudioAbsolutePath === shotSourceAudioAbsolutePath ? shot.sourceAudioFilePath || '' : '',
                url: effectiveShotSourceAudioPublicUrl,
                role: 'reference_audio',
                sourceKind: 'shot_reference_audio',
                displayLabel: '小镜头参考音频'
              }
            ]
          : [],
      referenceVideos: [
        backgroundAsset?.assetPath || backgroundAsset?.assetUrl
          ? {
              url: toAbsolutePublicUploadUrl(backgroundAsset.assetPath) || backgroundAsset.assetUrl,
              relativePath: backgroundAsset.assetPath || '',
              role: 'reference_video',
              sourceKind: 'background_asset_video',
              displayLabel: `#${String(backgroundBinding?.backgroundName || backgroundAsset.name || '场景').trim()} 背景资产视频`
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
        useReferenceVideo,
        useReferenceFrame,
        remoteTaskId: result.remoteTaskId || '',
        remoteUrl: result.remoteUrl || '',
        sentReferenceImages: result.sentReferenceImages ?? task.meta?.sentReferenceImages ?? [],
        sentReferenceVideos: result.sentReferenceVideos ?? task.meta?.sentReferenceVideos ?? [],
        sentReferenceAudios: result.sentReferenceAudios ?? task.meta?.sentReferenceAudios ?? [],
        remoteStatus: 'succeeded',
        remoteStatusLabel: '远端已完成',
        remoteCreatedAt: task.meta?.remoteCreatedAt ?? null,
        remoteUpdatedAt: task.meta?.remoteUpdatedAt ?? null,
        fallbackReason: [generationWarnings.join('；'), result.fallbackReason || ''].filter(Boolean).join('；'),
        providerError: result.providerError || '',
        speechSignature: buildShotSpeechSignature(shot),
        characterStateSignature: buildShotCharacterStateSignature(shot),
        generateAudio: shouldGenerateDialogue
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

const processShotGenerationTask = async (taskId, options = {}) => {
  const taskKey = String(taskId ?? '').trim();

  if (!taskKey) {
    return null;
  }

  const inflightProcess = inflightShotGenerationTaskProcesses.get(taskKey);

  if (inflightProcess) {
    return inflightProcess;
  }

  const processPromise = processShotGenerationTaskUnlocked(taskId, options).finally(() => {
    inflightShotGenerationTaskProcesses.delete(taskKey);
  });

  inflightShotGenerationTaskProcesses.set(taskKey, processPromise);
  return processPromise;
};

const startShotGeneration = async ({
  segmentId,
  shotId,
  prompt,
  ratio,
  styleMode = '',
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  const segment = await getSegmentWithContextById(segmentId);
  const shot = getShotByIdFromSegment(segment, shotId);
  const resolvedPrompt = String(prompt ?? '').trim() || shot.prompt;
  const resolvedRatio = normalizeGenerationRatio(ratio);
  const resolvedStyleMode = resolveShotGenerationStyleMode(
    styleMode,
    normalizeAnalysisOptions(segment?.analysis?.analysisOptions ?? segment?.video?.analysis?.analysisOptions)
  );
  const resolvedUseReferenceVideo = normalizeUseReferenceVideo(useReferenceVideo, true);
  const resolvedUseReferenceFrame = normalizeUseReferenceFrame(useReferenceFrame, true);

  if (!resolvedPrompt) {
    throw new AppError('请先提供镜头提示词，再生成小镜头。', 400, {
      segment_id: segmentId,
      shot_id: shotId
    });
  }

  assertSeedDanceReady();

  const { latestAttemptTaskBySegmentId, latestCompletedTaskBySegmentId } = await getLatestShotTaskMapsBySegmentIds([
    segmentId
  ]);
  const existingTask = getExistingReusableShotTask({
    latestAttemptTaskByShotId: latestAttemptTaskBySegmentId.get(segmentId) ?? new Map(),
    latestCompletedTaskByShotId: latestCompletedTaskBySegmentId.get(segmentId) ?? new Map(),
    shot,
    prompt: resolvedPrompt,
    ratio: resolvedRatio,
    styleMode: resolvedStyleMode,
    useReferenceVideo: resolvedUseReferenceVideo,
    useReferenceFrame: resolvedUseReferenceFrame
  });

  if (existingTask) {
    if (shouldRestartLocalShotTask(existingTask)) {
      queueMicrotask(() => {
        void processShotGenerationTask(existingTask.id, {
          attemptAssembly: true
        });
      });
    }

    return serializeShotGenerationTask(existingTask);
  }

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
      styleMode: resolvedStyleMode,
      useReferenceVideo: resolvedUseReferenceVideo,
      useReferenceFrame: resolvedUseReferenceFrame,
      engine: '',
      remoteStatus: '',
      remoteStatusLabel: '',
      remoteCreatedAt: null,
      remoteUpdatedAt: null,
      isMock: false,
      remoteTaskId: '',
      fallbackReason: '',
      providerError: '',
      speechSignature: buildShotSpeechSignature(shot),
      characterStateSignature: buildShotCharacterStateSignature(shot),
      generateAudio: isSpeechAnalysisEnabled(
        normalizeAnalysisOptions(segment?.analysis?.analysisOptions ?? segment?.video?.analysis?.analysisOptions)
      ) && Boolean(normalizeShotSpeech(shot?.speech ?? null, {
        durationSeconds: shot?.durationSeconds,
        fallbackStatus: 'idle'
      }).hasDialogue)
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

const processShotBatchGeneration = async ({
  segmentId,
  promptOverrides = {},
  ratio,
  styleMode = '',
  useReferenceVideo = true,
  useReferenceFrame = true,
  startedAt = ''
}) => {
  const segment = await getSegmentWithContextById(segmentId);
  const normalizedShots = getNormalizedSegmentShots(segment);
  const resolvedRatio = normalizeGenerationRatio(ratio);
  const resolvedStyleMode = resolveShotGenerationStyleMode(
    styleMode,
    normalizeAnalysisOptions(segment?.analysis?.analysisOptions ?? segment?.video?.analysis?.analysisOptions)
  );
  const resolvedUseReferenceVideo = normalizeUseReferenceVideo(useReferenceVideo, true);
  const resolvedUseReferenceFrame = normalizeUseReferenceFrame(useReferenceFrame, true);
  const { latestAttemptTaskBySegmentId, latestCompletedTaskBySegmentId } = await getLatestShotTaskMapsBySegmentIds([
    segmentId
  ]);
  const latestAttemptTaskByShotId = latestAttemptTaskBySegmentId.get(segmentId) ?? new Map();
  const latestCompletedTaskByShotId = latestCompletedTaskBySegmentId.get(segmentId) ?? new Map();

  for (const shot of normalizedShots) {
    const overridePrompt = String(promptOverrides[shot.id] ?? '').trim();
    const targetPrompt = overridePrompt || shot.prompt;
    const reusableTask = getExistingReusableShotTask({
      latestAttemptTaskByShotId,
      latestCompletedTaskByShotId,
      shot,
      prompt: targetPrompt,
      ratio: resolvedRatio,
      styleMode: resolvedStyleMode,
      useReferenceVideo: resolvedUseReferenceVideo,
      useReferenceFrame: resolvedUseReferenceFrame
    });

    if (reusableTask?.status === TASK_STATUS.completed && reusableTask.resultUrl) {
      await createCompletedReuseTaskForBatch({
        segmentId,
        shot,
        prompt: targetPrompt,
        ratio: resolvedRatio,
        styleMode: resolvedStyleMode,
        startedAt,
        sourceTask: reusableTask
      });
      continue;
    }

    if (reusableTask && [TASK_STATUS.pending, TASK_STATUS.processing].includes(reusableTask.status)) {
      const resumedTask = await createResumedReuseTaskForBatch({
        segmentId,
        shot,
        prompt: targetPrompt,
        ratio: resolvedRatio,
        styleMode: resolvedStyleMode,
        startedAt,
        sourceTask: reusableTask
      });

      await processShotGenerationTask(resumedTask.id, {
        attemptAssembly: false
      });
      continue;
    }

    const task = await ShotGenerationTask.create({
      segmentId,
      shotId: shot.id,
      shotIndex: shot.shotIndex,
      prompt: targetPrompt,
      startTime: shot.startTime,
      endTime: shot.endTime,
      durationSeconds: shot.durationSeconds,
      status: TASK_STATUS.pending,
      progress: 0,
      meta: {
        source: 'shot_generation_batch',
        batchStartedAt: startedAt,
        ratio: resolvedRatio,
        styleMode: resolvedStyleMode,
        useReferenceVideo: resolvedUseReferenceVideo,
        useReferenceFrame: resolvedUseReferenceFrame,
        engine: '',
        remoteStatus: '',
        remoteStatusLabel: '',
        remoteCreatedAt: null,
        remoteUpdatedAt: null,
        isMock: false,
        remoteTaskId: '',
        fallbackReason: '',
        providerError: '',
        speechSignature: buildShotSpeechSignature(shot),
        characterStateSignature: buildShotCharacterStateSignature(shot),
        generateAudio: isSpeechAnalysisEnabled(
          normalizeAnalysisOptions(segment?.analysis?.analysisOptions ?? segment?.video?.analysis?.analysisOptions)
        ) && Boolean(normalizeShotSpeech(shot?.speech ?? null, {
          durationSeconds: shot?.durationSeconds,
          fallbackStatus: 'idle'
        }).hasDialogue)
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

const startShotBatchGeneration = async ({
  segmentId,
  shots = [],
  ratio,
  styleMode = '',
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  const segment = await getSegmentWithContextById(segmentId);
  const normalizedShots = getNormalizedSegmentShots(segment);
  const resolvedRatio = normalizeGenerationRatio(ratio);
  const resolvedStyleMode = resolveShotGenerationStyleMode(
    styleMode,
    normalizeAnalysisOptions(segment?.analysis?.analysisOptions ?? segment?.video?.analysis?.analysisOptions)
  );
  const resolvedUseReferenceVideo = normalizeUseReferenceVideo(useReferenceVideo, true);
  const resolvedUseReferenceFrame = normalizeUseReferenceFrame(useReferenceFrame, true);

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
  const existingAssemblyStatus = String(segment.analysis?.shotAssembly?.status ?? '').trim().toLowerCase();

  if (
    Boolean(segment.analysis?.shotAssembly?.pendingAssembly) &&
    [TASK_STATUS.pending, TASK_STATUS.processing].includes(existingAssemblyStatus)
  ) {
    const currentSummary = await getShotGenerationSummaryForSegment(segment, {
      createdAfter: segment.analysis?.shotAssembly?.startedAt ?? segment.analysis?.shotAssembly?.started_at ?? ''
    });

    if (
      Number(currentSummary.processing_shot_count ?? 0) > 0 ||
      Number(currentSummary.failed_shot_count ?? 0) > 0 ||
      String(currentSummary.result_url ?? '').trim()
    ) {
      return {
        segment_id: segmentId,
        shot_count: normalizedShots.length,
        status: currentSummary.status,
        started_at: currentSummary.started_at ?? segment.analysis?.shotAssembly?.startedAt ?? '',
        ratio: resolvedRatio,
        style_mode: resolvedStyleMode,
        use_reference_video: resolvedUseReferenceVideo,
        use_reference_frame: resolvedUseReferenceFrame,
        progress: currentSummary.progress,
        completed_shot_count: currentSummary.completed_shot_count,
        failed_shot_count: currentSummary.failed_shot_count,
        processing_shot_count: currentSummary.processing_shot_count,
        pending_assembly: currentSummary.pending_assembly,
        result_url: currentSummary.result_url || '',
        reused_existing_result: true
      };
    }
  }

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
      styleMode: resolvedStyleMode,
      useReferenceVideo: resolvedUseReferenceVideo,
      useReferenceFrame: resolvedUseReferenceFrame,
      startedAt
    });
  });

  return {
    segment_id: segmentId,
    shot_count: normalizedShots.length,
    status: TASK_STATUS.processing,
    started_at: startedAt,
    ratio: resolvedRatio,
    style_mode: resolvedStyleMode,
    use_reference_video: resolvedUseReferenceVideo,
    use_reference_frame: resolvedUseReferenceFrame
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
  attemptPendingShotAssembly,
  processShotGenerationTask,
  serializeShotGenerationTask,
  startShotBatchGeneration,
  startShotGeneration
};
