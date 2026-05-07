import { Analysis, GenerationTask, Segment, Video } from '../models/index.js';
import env from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { TASK_STATUS } from '../config/constants.js';
import {
  DEFAULT_STYLE_MODE,
  normalizeStyleMode,
  resolveStyleTemplate
} from '../../shared/styleTemplates.js';
import { buildFullVideoPrompt, buildSegmentVideoPrompt } from '../../shared/promptBlueprints.js';
import { ensureBackgroundAsset } from './backgroundAssetService.js';
import { listCompletedResourceImageAssetsByResourceKeys } from './resourceImageService.js';
import {
  assertSeedDanceReady,
  generateSegment as generateWithSeedDance,
  resumeRemoteGenerationTask
} from './seedDanceService.js';
import { resolveUploadPath, toAbsolutePublicUploadUrl } from './fileService.js';
import { extractVideoFrame } from './ffmpegService.js';
import { broadcastRealtimeEvent } from './realtimeService.js';

const serializeGenerationMeta = (task) => {
  const taskMeta = task?.meta ?? {};
  const normalizeDurationValue = (value) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? Number(parsedValue.toFixed(2)) : null;
  };

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
    sent_reference_audios: Array.isArray(taskMeta.sentReferenceAudios) ? taskMeta.sentReferenceAudios : []
  };
};

const serializeGenerationTask = (task) => ({
  task_id: task.id,
  segment_id: task.segmentId,
  status: task.status,
  progress: task.progress,
  prompt: task.prompt,
  optimized_prompt: task.optimizedPrompt,
  result_url: task.resultUrl,
  error_message: task.errorMessage,
  ...serializeGenerationMeta(task),
  created_at: task.createdAt,
  updated_at: task.updatedAt
});

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
  return Boolean(task?.status === TASK_STATUS.completed && task?.resultUrl && !isTaskMarkedMock(task));
};

const broadcastGenerationTaskUpdate = (task) => {
  broadcastRealtimeEvent('generation:progress', serializeGenerationTask(task));
};

const normalizeGenerationRatio = (value) => {
  const trimmedValue = String(value ?? '').trim();
  return /^[1-9]\d{0,2}:[1-9]\d{0,2}$/u.test(trimmedValue) ? trimmedValue : env.SEED_DANCE_RATIO;
};

const normalizeUseReferenceVideo = (value, fallbackValue = true) => {
  if (typeof value === 'boolean') {
    return value;
  }

  return fallbackValue;
};

const normalizeUseReferenceFrame = (value, fallbackValue = true) => {
  if (typeof value === 'boolean') {
    return value;
  }

  return fallbackValue;
};

const applySeedDanceTaskProgress = async (task, progressPayload = {}) => {
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
  broadcastGenerationTaskUpdate(task);
};

const CHARACTER_REFERENCE_IMAGE_FIELDS = [
  'referenceImages',
  'reference_images',
  'threeViewImages',
  'three_view_images',
  'threeViews',
  'three_views',
  'generatedImages',
  'generated_images',
  'viewImages',
  'view_images',
  'images',
  'imageUrls',
  'image_urls'
];

const SCENE_REFERENCE_IMAGE_FIELDS = [
  'referenceImages',
  'reference_images',
  'generatedImages',
  'generated_images',
  'backgroundImages',
  'background_images',
  'sceneImages',
  'scene_images',
  'angleImages',
  'angle_images',
  'images',
  'imageUrls',
  'image_urls'
];
const SEED_DANCE_REFERENCE_IMAGE_LIMIT = 9;
const CHARACTER_REFERENCE_IMAGE_BUDGET = 3;
const SCENE_REFERENCE_IMAGE_BUDGET = 3;
const CHARACTER_STATE_REFERENCE_IMAGE_BUDGET = 2;

const sanitizeBasenamePart = (value = '') => {
  return String(value ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
};

const dedupeReferenceEntries = (entries = []) => {
  const seenKeys = new Set();

  return entries.filter((entry) => {
    const dedupeKey = `${entry.url || ''}|${entry.relativePath || ''}|${entry.absolutePath || ''}|${entry.role || ''}`;

    if (seenKeys.has(dedupeKey)) {
      return false;
    }

    seenKeys.add(dedupeKey);
    return true;
  });
};

const pushReferenceEntriesWithBudget = ({
  targetEntries,
  candidateEntries = [],
  budget = Number.POSITIVE_INFINITY,
  seenKeys = new Set(),
  startIndex = 0
}) => {
  if (!Array.isArray(candidateEntries) || budget <= 0) {
    return {
      nextIndex: startIndex,
      addedCount: 0
    };
  }

  let nextIndex = startIndex;
  let addedCount = 0;

  for (; nextIndex < candidateEntries.length; nextIndex += 1) {
    if (addedCount >= budget) {
      break;
    }

    const candidateEntry = candidateEntries[nextIndex];

    if (!candidateEntry) {
      continue;
    }

    const dedupeKey = `${candidateEntry.url || ''}|${candidateEntry.relativePath || ''}|${candidateEntry.absolutePath || ''}|${candidateEntry.role || ''}`;

    if (seenKeys.has(dedupeKey)) {
      continue;
    }

    seenKeys.add(dedupeKey);
    targetEntries.push(candidateEntry);
    addedCount += 1;
  }

  return {
    nextIndex,
    addedCount
  };
};

const composeSeedDanceReferenceImages = ({
  primaryImages = [],
  characterImages = [],
  sceneImages = [],
  characterStateImages = [],
  maxTotal = SEED_DANCE_REFERENCE_IMAGE_LIMIT,
  primaryImagePlacement = 'first'
} = {}) => {
  const combinedEntries = [];
  const seenKeys = new Set();
  const normalizedMaxTotal =
    Number.isFinite(Number(maxTotal)) && Number(maxTotal) > 0 ? Number(maxTotal) : SEED_DANCE_REFERENCE_IMAGE_LIMIT;
  const normalizedPrimaryImages = dedupeReferenceEntries(primaryImages);
  const normalizedCharacterImages = dedupeReferenceEntries(characterImages);
  const normalizedSceneImages = dedupeReferenceEntries(sceneImages);
  const normalizedCharacterStateImages = dedupeReferenceEntries(characterStateImages);
  const placePrimaryAfterAssets = primaryImagePlacement === 'after_assets' && normalizedPrimaryImages.length > 0;
  let remainingBudget = Math.max(0, normalizedMaxTotal - (placePrimaryAfterAssets ? 1 : 0));

  if (!placePrimaryAfterAssets) {
    pushReferenceEntriesWithBudget({
      targetEntries: combinedEntries,
      candidateEntries: normalizedPrimaryImages,
      budget: remainingBudget,
      seenKeys
    });
    remainingBudget = normalizedMaxTotal - combinedEntries.length;
  }

  let characterCursor = 0;
  ({ nextIndex: characterCursor } = pushReferenceEntriesWithBudget({
    targetEntries: combinedEntries,
    candidateEntries: normalizedCharacterImages,
    budget: Math.min(remainingBudget, CHARACTER_REFERENCE_IMAGE_BUDGET),
    seenKeys
  }));
  remainingBudget = normalizedMaxTotal - combinedEntries.length;

  let sceneCursor = 0;
  ({ nextIndex: sceneCursor } = pushReferenceEntriesWithBudget({
    targetEntries: combinedEntries,
    candidateEntries: normalizedSceneImages,
    budget: Math.min(remainingBudget, SCENE_REFERENCE_IMAGE_BUDGET),
    seenKeys
  }));
  remainingBudget = normalizedMaxTotal - combinedEntries.length;

  if (placePrimaryAfterAssets && remainingBudget > 0) {
    pushReferenceEntriesWithBudget({
      targetEntries: combinedEntries,
      candidateEntries: normalizedPrimaryImages,
      budget: remainingBudget,
      seenKeys
    });
    remainingBudget = normalizedMaxTotal - combinedEntries.length;
  }

  let characterStateCursor = 0;
  ({ nextIndex: characterStateCursor } = pushReferenceEntriesWithBudget({
    targetEntries: combinedEntries,
    candidateEntries: normalizedCharacterStateImages,
    budget: Math.min(remainingBudget, CHARACTER_STATE_REFERENCE_IMAGE_BUDGET),
    seenKeys
  }));
  remainingBudget = normalizedMaxTotal - combinedEntries.length;

  if (remainingBudget > 0) {
    ({ nextIndex: characterCursor } = pushReferenceEntriesWithBudget({
      targetEntries: combinedEntries,
      candidateEntries: normalizedCharacterImages,
      budget: remainingBudget,
      seenKeys,
      startIndex: characterCursor
    }));
    remainingBudget = normalizedMaxTotal - combinedEntries.length;
  }

  if (remainingBudget > 0) {
    ({ nextIndex: sceneCursor } = pushReferenceEntriesWithBudget({
      targetEntries: combinedEntries,
      candidateEntries: normalizedSceneImages,
      budget: remainingBudget,
      seenKeys,
      startIndex: sceneCursor
    }));
    remainingBudget = normalizedMaxTotal - combinedEntries.length;
  }

  if (remainingBudget > 0) {
    pushReferenceEntriesWithBudget({
      targetEntries: combinedEntries,
      candidateEntries: normalizedCharacterStateImages,
      budget: remainingBudget,
      seenKeys,
      startIndex: characterStateCursor
    });
  }

  return combinedEntries.slice(0, normalizedMaxTotal);
};

const normalizeReferenceEntry = (entry, role = 'reference_image') => {
  if (!entry) {
    return null;
  }

  if (typeof entry === 'string') {
    const trimmedValue = entry.trim();

    return trimmedValue
      ? {
          url: trimmedValue,
          role
        }
      : null;
  }

  const url = String(
    entry.url ??
      entry.publicUrl ??
      entry.public_url ??
      entry.assetUrl ??
      entry.asset_url ??
      entry.fileUrl ??
      entry.file_url ??
      entry.dataUrl ??
      entry.data_url ??
      entry.assetId ??
      entry.asset_id ??
      ''
  ).trim();
  const relativePath = String(
    entry.relativePath ?? entry.relative_path ?? entry.filePath ?? entry.file_path ?? ''
  ).trim();
  const absolutePath = String(entry.absolutePath ?? entry.absolute_path ?? '').trim();

  if (!url && !relativePath && !absolutePath) {
    return null;
  }

  return {
    url,
    relativePath,
    absolutePath,
    role
  };
};

const expandReferenceEntries = (value, role = 'reference_image') => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => expandReferenceEntries(item, role));
  }

  const normalizedEntry = normalizeReferenceEntry(value, role);

  if (normalizedEntry) {
    return [normalizedEntry];
  }

  if (typeof value === 'object') {
    return Object.values(value).flatMap((item) => expandReferenceEntries(item, role));
  }

  return [];
};

const collectReferenceEntriesFromResource = (resource, fieldNames, role = 'reference_image') => {
  return dedupeReferenceEntries(
    fieldNames.flatMap((fieldName) => expandReferenceEntries(resource?.[fieldName], role))
  );
};

const getPromptReferenceNames = (prompt = '', marker = '@') => {
  const normalizedMarker = String(marker ?? '').trim();

  if (!normalizedMarker) {
    return [];
  }

  const escapedMarker = normalizedMarker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matcher = new RegExp(`${escapedMarker}([\\p{L}\\p{N}_-]+)`, 'gu');

  return Array.from(String(prompt ?? '').matchAll(matcher), (match) => String(match[1] ?? '').trim()).filter(Boolean);
};

const getPromptMentionNames = (prompt = '') => {
  return getPromptReferenceNames(prompt, '@');
};

const normalizeCharacterIdentity = (value) => {
  return String(value ?? '')
    .trim()
    .toLowerCase();
};

const getPromptSceneNames = (prompt = '') => {
  return getPromptReferenceNames(prompt, '#');
};

const normalizeSceneIdentity = (value) => {
  return String(value ?? '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
};

const dedupeNameList = (values = [], normalizer = (value) => String(value ?? '').trim()) => {
  const seenValues = new Set();
  const result = [];

  values.forEach((value) => {
    const trimmedValue = String(value ?? '').trim();

    if (!trimmedValue) {
      return;
    }

    const normalizedValue = normalizer(trimmedValue);

    if (!normalizedValue || seenValues.has(normalizedValue)) {
      return;
    }

    seenValues.add(normalizedValue);
    result.push(trimmedValue);
  });

  return result;
};

const findOrderedResourcesByNames = (resources = [], orderedNames = [], normalizer, getIdentifiers) => {
  const resourceList = Array.isArray(resources) ? resources.filter(Boolean) : [];
  const seenResourceKeys = new Set();
  const result = [];

  orderedNames.forEach((orderedName) => {
    const normalizedOrderedName = normalizer(orderedName);

    if (!normalizedOrderedName) {
      return;
    }

    const matchedResource = resourceList.find((resource) => {
      return getIdentifiers(resource)
        .map((identifier) => normalizer(identifier))
        .filter(Boolean)
        .includes(normalizedOrderedName);
    });

    if (!matchedResource) {
      return;
    }

    const dedupeKey = getIdentifiers(matchedResource)
      .map((identifier) => normalizer(identifier))
      .find(Boolean);

    if (!dedupeKey || seenResourceKeys.has(dedupeKey)) {
      return;
    }

    seenResourceKeys.add(dedupeKey);
    result.push(matchedResource);
  });

  return result;
};

const getSegmentCharacterNames = (segment) => {
  if (!Array.isArray(segment?.analysis?.characters)) {
    return [];
  }

  return segment.analysis.characters
    .map((item) =>
      typeof item === 'string' ? item : String(item?.name ?? item?.id ?? '').trim()
    )
    .filter(Boolean);
};

const getSegmentSceneNames = (segment) => {
  const segmentAnalysis = segment?.analysis ?? {};
  const explicitScenes = Array.isArray(segmentAnalysis.scenes)
    ? segmentAnalysis.scenes.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const backgroundName = String(segmentAnalysis.backgroundName ?? '').trim();

  return dedupeNameList(
    [
      ...explicitScenes,
      backgroundName
    ],
    normalizeSceneIdentity
  );
};

const getSegmentRepresentativeFrameLocalTime = (segment) => {
  const representativeFrameTime = Number(
    segment?.analysis?.representativeFrameTime ?? segment?.analysis?.representative_frame_time
  );
  const segmentStartTime = Number(segment?.startTime ?? 0);
  const segmentEndTime = Number(segment?.endTime ?? segmentStartTime);
  const segmentDuration = Math.max(0, segmentEndTime - segmentStartTime);

  if (!Number.isFinite(representativeFrameTime) || representativeFrameTime < 0 || segmentDuration <= 0) {
    return null;
  }

  return Number(Math.max(0, Math.min(segmentDuration, representativeFrameTime - segmentStartTime)).toFixed(2));
};

const buildSegmentFrameReference = async ({
  segment,
  sourceSegmentAbsolutePath,
  basenamePrefix
}) => {
  const representativeFrameLocalTime = getSegmentRepresentativeFrameLocalTime(segment);

  if (!sourceSegmentAbsolutePath || representativeFrameLocalTime === null) {
    return null;
  }

  const extractedFrame = await extractVideoFrame(sourceSegmentAbsolutePath, representativeFrameLocalTime, {
    basename: `${basenamePrefix}-segment-frame-reference`
  });

  if (!extractedFrame?.filePath) {
    return null;
  }

  return {
    relativePath: extractedFrame.filePath,
    url: extractedFrame.fileUrl,
    role: 'reference_image',
    sourceKind: 'segment_representative_frame',
    displayLabel: '大片段典型帧'
  };
};

const resolveRelevantCharacters = (segment, overallAnalysis, prompt = '') => {
  const overallCharacters = Array.isArray(overallAnalysis?.characters) ? overallAnalysis.characters.filter(Boolean) : [];

  if (!overallCharacters.length) {
    return [];
  }

  const promptMatchedCharacters = findOrderedResourcesByNames(
    overallCharacters,
    getPromptMentionNames(prompt),
    normalizeCharacterIdentity,
    (character) => [character?.name, character?.id]
  );

  if (promptMatchedCharacters.length) {
    return promptMatchedCharacters;
  }

  const segmentMatchedCharacters = findOrderedResourcesByNames(
    overallCharacters,
    getSegmentCharacterNames(segment),
    normalizeCharacterIdentity,
    (character) => [character?.name, character?.id]
  );

  if (segmentMatchedCharacters.length) {
    return segmentMatchedCharacters;
  }

  return overallCharacters;
};

const buildCharacterFrameReference = async ({
  character,
  sourceVideoAbsolutePath,
  basenamePrefix
}) => {
  const representativeFrameTime = Number(
    character?.representativeFrameTime ?? character?.representative_frame_time
  );

  if (!sourceVideoAbsolutePath || !Number.isFinite(representativeFrameTime) || representativeFrameTime < 0) {
    return null;
  }

  const extractedFrame = await extractVideoFrame(sourceVideoAbsolutePath, representativeFrameTime, {
    basename: `${basenamePrefix}-${sanitizeBasenamePart(character?.id || character?.name || 'character') || 'character'}-reference`
  });

  if (!extractedFrame?.filePath) {
    return null;
  }

  return {
    relativePath: extractedFrame.filePath,
    role: 'reference_image',
    sourceKind: 'character_frame_fallback',
    displayLabel: `@${String(character?.name ?? character?.id ?? '角色').trim() || '角色'} 原片人物帧`
  };
};

const buildSceneFrameReference = async ({
  background,
  sourceVideoAbsolutePath,
  basenamePrefix
}) => {
  const representativeFrameTime = Number(
    background?.representativeFrameTime ?? background?.representative_frame_time
  );

  if (!sourceVideoAbsolutePath || !Number.isFinite(representativeFrameTime) || representativeFrameTime < 0) {
    return null;
  }

  const extractedFrame = await extractVideoFrame(sourceVideoAbsolutePath, representativeFrameTime, {
    basename: `${basenamePrefix}-${sanitizeBasenamePart(background?.id || background?.name || 'scene') || 'scene'}-reference`
  });

  if (!extractedFrame?.filePath) {
    return null;
  }

  return {
    relativePath: extractedFrame.filePath,
    role: 'reference_image',
    sourceKind: 'scene_frame_fallback',
    displayLabel: `#${String(background?.name ?? background?.id ?? '场景').trim() || '场景'} 原片场景帧`
  };
};

const collectCharacterReferenceImages = async ({
  videoId,
  segment,
  overallAnalysis,
  prompt,
  sourceVideoAbsolutePath,
  basenamePrefix
}) => {
  const relatedCharacters = resolveRelevantCharacters(segment, overallAnalysis, prompt);
  const persistedCharacterImageAssets = await listCompletedResourceImageAssetsByResourceKeys({
    videoId,
    resourceType: 'character',
    resourceKeys: relatedCharacters.flatMap((character) => [character?.id, character?.name])
  });
  const persistedCharacterAssetMap = persistedCharacterImageAssets.reduce((accumulator, asset) => {
    const currentAssets = accumulator.get(asset.resource_id) ?? [];
    currentAssets.push({
      relativePath: asset.asset_path || '',
      url: asset.asset_url || '',
      role: 'reference_image',
      sourceKind: 'character_asset',
      displayLabel: `@${String(asset.name ?? asset.resource_id ?? '角色').trim() || '角色'} 三视图`
    });
    accumulator.set(asset.resource_id, currentAssets);
    return accumulator;
  }, new Map());
  const referenceImages = [];

  for (const character of relatedCharacters) {
    const persistedAssetsForCharacter = [
      ...(persistedCharacterAssetMap.get(String(character?.id ?? '').trim()) ?? []),
      ...(persistedCharacterAssetMap.get(String(character?.name ?? '').trim()) ?? [])
    ];

    if (persistedAssetsForCharacter.length) {
      referenceImages.push(...dedupeReferenceEntries(persistedAssetsForCharacter));
      continue;
    }

    const explicitReferenceImages = collectReferenceEntriesFromResource(
      character,
      CHARACTER_REFERENCE_IMAGE_FIELDS,
      'reference_image'
    )
      .map((entry) => ({
        ...entry,
        sourceKind: 'character_asset',
        displayLabel: `@${String(character?.name ?? character?.id ?? '角色').trim() || '角色'} 三视图`
      }))
      .slice(0, 3);

    if (explicitReferenceImages.length) {
      referenceImages.push(...explicitReferenceImages);
      continue;
    }

    const fallbackFrameReference = await buildCharacterFrameReference({
      character,
      sourceVideoAbsolutePath,
      basenamePrefix
    });

    if (fallbackFrameReference) {
      referenceImages.push(fallbackFrameReference);
    }
  }

  return dedupeReferenceEntries(referenceImages).slice(0, SEED_DANCE_REFERENCE_IMAGE_LIMIT);
};

const collectCharacterStateReferenceImages = ({ shot = {} } = {}) => {
  const stateRefs = Array.isArray(shot?.characterStateRefs ?? shot?.character_state_refs)
    ? shot.characterStateRefs ?? shot.character_state_refs
    : [];

  return dedupeReferenceEntries(
    stateRefs
      .map((stateRef) => {
        const relativePath = String(
          stateRef?.representativeFrameImagePath ?? stateRef?.representative_frame_image_path ?? ''
        ).trim();
        const url = String(
          stateRef?.representativeFrameImageUrl ?? stateRef?.representative_frame_image_url ?? ''
        ).trim();

        if (!relativePath && !url) {
          return null;
        }

        return {
          relativePath,
          url,
          role: 'reference_image',
          sourceKind: 'character_state_asset',
          displayLabel: `@${String(stateRef?.characterName ?? '角色').trim() || '角色'} 状态参考帧`
        };
      })
      .filter(Boolean)
  ).slice(0, 6);
};

const resolveRelevantScenes = ({ segment, overallAnalysis, prompt = '', sceneNames = [], backgroundBinding = null }) => {
  const overallBackgrounds = Array.isArray(overallAnalysis?.backgrounds) ? overallAnalysis.backgrounds.filter(Boolean) : [];

  if (!overallBackgrounds.length) {
    return [];
  }

  const promptMatchedScenes = findOrderedResourcesByNames(
    overallBackgrounds,
    getPromptSceneNames(prompt),
    normalizeSceneIdentity,
    (background) => [background?.name, background?.id, background?.title, background?.sceneName, background?.scene_name]
  );

  if (promptMatchedScenes.length) {
    return promptMatchedScenes;
  }

  const explicitSceneNames = dedupeNameList(
    [
      ...sceneNames,
      ...getSegmentSceneNames(segment)
    ],
    normalizeSceneIdentity
  );
  const explicitMatchedScenes = findOrderedResourcesByNames(
    overallBackgrounds,
    explicitSceneNames,
    normalizeSceneIdentity,
    (background) => [background?.name, background?.id, background?.title, background?.sceneName, background?.scene_name]
  );

  if (explicitMatchedScenes.length) {
    return explicitMatchedScenes;
  }

  const backgroundMatchedScenes = findOrderedResourcesByNames(
    overallBackgrounds,
    [backgroundBinding?.backgroundId, backgroundBinding?.backgroundName],
    normalizeSceneIdentity,
    (background) => [background?.name, background?.id, background?.title, background?.sceneName, background?.scene_name]
  );

  if (backgroundMatchedScenes.length) {
    return backgroundMatchedScenes;
  }

  return overallBackgrounds;
};

const collectSceneReferenceImages = async ({
  videoId,
  segment,
  overallAnalysis,
  prompt = '',
  sceneNames = [],
  backgroundBinding,
  sourceVideoAbsolutePath = '',
  basenamePrefix = 'scene-reference'
}) => {
  const relatedScenes = resolveRelevantScenes({
    segment,
    overallAnalysis,
    prompt,
    sceneNames,
    backgroundBinding
  });

  if (!relatedScenes.length) {
    return [];
  }

  const persistedSceneAssetMap = new Map();

  if (videoId) {
    const persistedSceneAssets = await listCompletedResourceImageAssetsByResourceKeys({
      videoId,
      resourceType: 'scene',
      resourceKeys: relatedScenes.flatMap((background) => [background?.id, background?.name]).filter(Boolean)
    });

    persistedSceneAssets.forEach((asset) => {
      const currentAssets = persistedSceneAssetMap.get(asset.resource_id) ?? [];
      currentAssets.push({
        relativePath: asset.asset_path || '',
        url: asset.asset_url || '',
        role: 'reference_image',
        sourceKind: 'scene_asset',
        displayLabel: `#${String(asset.name ?? asset.resource_id ?? '场景').trim() || '场景'} 场景图`
      });
      persistedSceneAssetMap.set(asset.resource_id, currentAssets);
    });
  }

  const referenceImages = [];

  for (const background of relatedScenes) {
    const persistedAssetsForScene = dedupeReferenceEntries([
      ...(persistedSceneAssetMap.get(String(background?.id ?? '').trim()) ?? []),
      ...(persistedSceneAssetMap.get(String(background?.name ?? '').trim()) ?? [])
    ]).slice(0, SCENE_REFERENCE_IMAGE_BUDGET);

    if (persistedAssetsForScene.length) {
      referenceImages.push(...persistedAssetsForScene);
      continue;
    }

    const explicitReferenceImages = collectReferenceEntriesFromResource(
      background,
      SCENE_REFERENCE_IMAGE_FIELDS,
      'reference_image'
    )
      .map((entry) => ({
        ...entry,
        sourceKind: 'scene_asset',
        displayLabel: `#${String(background?.name ?? background?.id ?? '场景').trim() || '场景'} 场景图`
      }))
      .slice(0, SCENE_REFERENCE_IMAGE_BUDGET);

    if (explicitReferenceImages.length) {
      referenceImages.push(...explicitReferenceImages);
      continue;
    }

    const fallbackFrameReference = await buildSceneFrameReference({
      background,
      sourceVideoAbsolutePath,
      basenamePrefix
    });

    if (fallbackFrameReference) {
      referenceImages.push(fallbackFrameReference);
    }
  }

  return dedupeReferenceEntries(referenceImages).slice(0, SCENE_REFERENCE_IMAGE_BUDGET * 2);
};

const expandPromptMentions = (prompt, characters, backgrounds) => {
  return prompt.replace(/([@#])([\p{L}\p{N}_-]+)/gu, (match, marker, resourceName) => {
    if (marker === '@') {
      const matchedCharacter = characters.find((item) =>
        typeof item === 'string' ? item === resourceName : item?.name === resourceName
      );

      if (matchedCharacter) {
        if (typeof matchedCharacter === 'string') {
          return matchedCharacter;
        }

        return [
          matchedCharacter?.appearancePrompt || matchedCharacter?.appearance_prompt || resourceName,
          matchedCharacter?.personalityPrompt ||
            matchedCharacter?.personality_prompt ||
            matchedCharacter?.temperament ||
            matchedCharacter?.personality ||
            matchedCharacter?.traits ||
            ''
        ]
          .filter(Boolean)
          .join('，');
      }
    }

    const matchedBackground = backgrounds.find((item, index) =>
      typeof item === 'string'
        ? `场景 ${index + 1}` === resourceName
        : (item?.name || item?.title || item?.sceneName || item?.scene_name) === resourceName
    );

    if (!matchedBackground) {
      return match;
    }

    if (typeof matchedBackground === 'string') {
      return matchedBackground;
    }

    return (
      matchedBackground?.scenePrompt ||
      matchedBackground?.scene_prompt ||
      matchedBackground?.backgroundPrompt ||
      matchedBackground?.background_prompt ||
      matchedBackground?.description ||
      matchedBackground?.summary ||
      resourceName
    );
  });
};

const getBackgroundBindingForSegment = (segment, overallAnalysis) => {
  const segmentAnalysis = segment?.analysis ?? {};
  const timeAnchor = overallAnalysis?.timeAnchors?.[segment.segmentIndex] ?? {};
  const backgroundId = String(
    segmentAnalysis.backgroundId ?? timeAnchor.backgroundId ?? timeAnchor.background_id ?? ''
  ).trim();

  if (!backgroundId) {
    return null;
  }

  const normalizedBackgrounds = overallAnalysis?.backgrounds ?? [];
  const matchedBackground =
    normalizedBackgrounds.find((background) => String(background.id ?? '').trim() === backgroundId) ?? null;

  return {
    backgroundId,
    backgroundAction: String(
      segmentAnalysis.backgroundAction ??
        timeAnchor.backgroundAction ??
        timeAnchor.background_action ??
        'create_new'
    ).trim() || 'create_new',
    backgroundName: String(
      segmentAnalysis.backgroundName ??
        timeAnchor.backgroundName ??
        timeAnchor.background_name ??
        matchedBackground?.name ??
        `场景 ${Number(segment.segmentIndex) + 1}`
    ).trim(),
    description: String(
      matchedBackground?.description ?? matchedBackground?.summary ?? segmentAnalysis.sceneSummary ?? ''
    ).trim(),
    backgroundPrompt: String(
      segmentAnalysis.backgroundPrompt ??
        matchedBackground?.scenePrompt ??
        matchedBackground?.scene_prompt ??
        segmentAnalysis.scenePrompt ??
        timeAnchor.scenePrompt ??
        timeAnchor.scene_prompt ??
        ''
    ).trim(),
    representativeFrameTime: Number(
      matchedBackground?.representativeFrameTime ??
        matchedBackground?.representative_frame_time ??
        segmentAnalysis.representativeFrameTime ??
        timeAnchor.representativeFrameTime ??
        timeAnchor.representative_frame_time
    ),
    sceneSummary: String(
      segmentAnalysis.sceneSummary ?? timeAnchor.sceneSummary ?? timeAnchor.scene_summary ?? segmentAnalysis.scene ?? ''
    ).trim()
  };
};

const getSeedDanceDurationForSegment = (segment) => {
  const startTime = Number(segment?.startTime);
  const endTime = Number(segment?.endTime);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return undefined;
  }

  const roundedDurationSeconds = Math.round(endTime - startTime);

  if (!Number.isFinite(roundedDurationSeconds) || roundedDurationSeconds <= 0) {
    return undefined;
  }

  return Math.min(15, Math.max(4, roundedDurationSeconds));
};

const normalizeComparablePrompt = (value) => String(value ?? '').trim();

const doesSegmentTaskMatchGenerationRequest = ({
  task,
  prompt,
  ratio,
  styleMode = '',
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  if (!task) {
    return false;
  }

  return (
    normalizeComparablePrompt(task.prompt) === normalizeComparablePrompt(prompt) &&
    normalizeGenerationRatio(task.meta?.ratio) === normalizeGenerationRatio(ratio) &&
    normalizeUseReferenceVideo(task.meta?.useReferenceVideo ?? task.meta?.use_reference_video, true) ===
      normalizeUseReferenceVideo(useReferenceVideo, true) &&
    normalizeUseReferenceFrame(task.meta?.useReferenceFrame ?? task.meta?.use_reference_frame, true) ===
      normalizeUseReferenceFrame(useReferenceFrame, true) &&
    normalizeStyleMode(task.meta?.styleMode ?? task.meta?.style_mode ?? DEFAULT_STYLE_MODE) ===
      normalizeStyleMode(styleMode || task.meta?.styleMode || task.meta?.style_mode || DEFAULT_STYLE_MODE)
  );
};

const buildSeedDanceReconstructionPrompt = ({
  prompt = '',
  plot = '',
  segmentPrompt = '',
  shotPrompt = '',
  characterNames = [],
  sceneNames = [],
  characterStateRefs = [],
  speech = null,
  isShot = false,
  videoGenerationStylePrompt = '',
  durationSeconds = null,
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  const normalizedCharacterNames = dedupeNameList(characterNames, normalizeCharacterIdentity);
  const normalizedSceneNames = dedupeNameList(sceneNames, normalizeSceneIdentity);
  const normalizedCharacterStateRefs = Array.isArray(characterStateRefs)
    ? characterStateRefs
        .map((stateRef) => {
          const characterName = String(stateRef?.characterName ?? '').trim();

          if (!characterName) {
            return null;
          }

          return {
            characterName,
            stateName: String(stateRef?.stateName ?? '').trim(),
            summary: String(stateRef?.summary ?? '').trim(),
            continuityPrompt: String(stateRef?.continuityPrompt ?? '').trim()
          };
        })
        .filter(Boolean)
    : [];
  const basePrompt = String(prompt ?? '').trim();
  const hasDialogue = Boolean(speech?.hasDialogue);
  const speechTranscript = String(speech?.transcript ?? '').trim();
  const speechStyle = String(speech?.speechStyle ?? '').trim();
  const speechSubtitleLines = Array.isArray(speech?.subtitleLines) ? speech.subtitleLines : [];
  const speechDeliveryRateMultiplier = Number(speech?.deliveryRateMultiplier ?? speech?.delivery_rate_multiplier ?? 1);
  const speechDialogueCompletionTimeSeconds = Number(
    speech?.dialogueCompletionTimeSeconds ?? speech?.dialogue_completion_time_seconds ?? 0
  );
  const speechProviderTargetDurationSeconds = Number(
    speech?.providerTargetDurationSeconds ?? speech?.provider_target_duration_seconds ?? 0
  );
  const speechTrimSafetyTailSeconds = Number(
    speech?.trimSafetyTailSeconds ?? speech?.trim_safety_tail_seconds ?? 0
  );
  const shouldFitDialogueWithinShot =
    Boolean(speech?.fitWithinDuration ?? speech?.fit_within_duration) ||
    speechDeliveryRateMultiplier > 1.001 ||
    Boolean(String(speech?.deliveryConstraint ?? speech?.delivery_constraint ?? '').trim());
  const speechTimingSummary = speechSubtitleLines.length
    ? speechSubtitleLines
        .map((line) => {
          return `${Number(line.startTime ?? 0).toFixed(2)}-${Number(line.endTime ?? 0).toFixed(2)}秒：${String(line.text ?? '').trim()}`;
        })
        .join(' | ')
    : '';

  return [
    plot ? `整片剧情目标：${plot}` : '',
    segmentPrompt ? `大片段最终提示词：${segmentPrompt}` : '',
    isShot && shotPrompt ? `小镜头最终提示词：${shotPrompt}` : '',
    videoGenerationStylePrompt ? `全局风格硬约束：${videoGenerationStylePrompt}` : '',
    basePrompt ? `资源展开后的生成真值：${basePrompt}` : '',
    '角色三视图、场景参考图和展开后的资源提示词是本次视频重生成的第一视觉真值，优先级高于原片视频、关键帧和原片人物/场景表面细节。',
    isShot ? '严格还原原片当前小镜头，不要把多个镜头语义混成一个新镜头。' : '严格延续原片当前片段的剧情、镜头语言和表演逻辑。',
    isShot
      ? useReferenceFrame
        ? '小镜头典型帧只用于提取当前镜头的人物左中右站位、前后景层次、视线方向、机位朝向和动作瞬间，不能主导人物脸、服装、场景材质和整体美术风格。'
        : '本次不提供小镜头典型帧，人物站位、机位、前后景层次和动作瞬间主要依赖镜头提示词、角色三视图和场景图来重建。'
      : useReferenceVideo
        ? '参考视频只用于继承当前片段的运动节奏、镜头顺序、空间走位和动作骨架，不是人物外观和场景美术的主真值。'
        : '本次不提供原片片段参考视频，必须主要根据大片段提示词、角色三视图、场景图和其它参考重建同剧情方向的新片段。',
    normalizedCharacterNames.length
      ? `必须把这些角色三视图替换进原片对应人物，并把它们作为人物身份真值：${normalizedCharacterNames
          .map((name) => `@${name}`)
          .join('、')}。人物身份、脸型、发型、服装轮廓和体态主要由角色三视图与提示词锁定，原片人物只保留站位、动作骨架和表演节奏参考。`
      : '如果提供了角色三视图，必须优先用它们替换原片人物并锁定角色身份、脸型、发型、服装、比例和体态；不要被原片单帧表面细节带偏。',
    '一旦原片人物局部细节与角色三视图或角色提示词冲突，必须以角色三视图和角色提示词为准。',
    isShot && normalizedCharacterStateRefs.length
      ? `当前镜头还必须继承这些角色阶段状态：${normalizedCharacterStateRefs
          .map((stateRef) =>
            `@${stateRef.characterName}${stateRef.stateName ? ` 的「${stateRef.stateName}」` : ''}${
              stateRef.continuityPrompt ? `，${stateRef.continuityPrompt}` : stateRef.summary ? `，${stateRef.summary}` : ''
            }`
          )
          .join('；')}。`
      : '',
    isShot && normalizedCharacterStateRefs.length
      ? '这些状态连续性来自整片理解的人物状态时间线，必须按文字连续性约束延续当前阶段的伤势、包扎、残缺、服装破损、脏污、妆造变化和疲惫程度，不要回退成角色基础完好状态。'
      : '',
    normalizedSceneNames.length
      ? `必须把这些场景参考图替换进原片对应空间，并把它们作为场景真值：${normalizedSceneNames
          .map((name) => `#${name}`)
          .join('、')}。`
      : '如果提供了场景参考图，必须优先用它们替换原片场景并锁定空间结构、布景、材质、布光和色彩。',
    '一旦原片场景局部细节与场景参考图或场景提示词冲突，必须以场景参考图和场景提示词为准。',
    '保持原片相同或最接近的景别、拍摄高度、视角方向、人物左右位置、前中后景层次、遮挡关系、进出画路径、视线方向、镜头运动和动作节奏。',
    isShot
      ? '小镜头最终提示词里写明的人物左/中/右位置、站姿/坐姿/蹲姿、朝向、视线、遮挡关系和动作阶段都是硬约束。除非小镜头提示词明确写出换位、坐下、起身、转身或移步，否则不要擅自改动。'
      : '',
    isShot
      ? '不要把站立人物生成成坐姿，也不要把坐姿人物生成成站姿；不要把画面左侧人物生成到右侧，也不要把右侧人物生成到左侧。多人镜头里每个人的相对位置、姿态和主次关系都要稳定。'
      : '',
    isShot
      ? useReferenceVideo
        ? '小镜头源视频主要用于继承构图、机位、站位、动作骨架和节奏；人物外观与场景外观应主要由角色三视图、场景图和提示词重建，不要把原片表面纹理、背景小物和微表情逐帧照搬。'
        : '本次不提供小镜头源视频，人物站位、机位、动作关系和节奏主要参考镜头提示词、小镜头典型帧、角色三视图和场景图来重建，不要假设存在未提供的源视频轨迹。'
      : useReferenceVideo
        ? '原片片段主要用于继承构图、机位、站位、动作骨架和节奏；人物与场景的视觉结果仍应主要由资源三视图和资源提示词决定，不要逐帧照搬原片表面纹理。'
        : '本次不提供原片片段视频，构图、机位、站位和节奏主要依赖提示词、角色三视图、场景图与其它参考重建，同时保持与当前剧情目标一致。',
    isShot
      ? '不要让生成结果和关键帧过于相似；保留同镜头的站位、机位和动作关系即可，人物细节、材质纹理、背景纹理和局部表演需要重新生成。'
      : '',
    '生成结果要像同一镜头的重拍版本或平行版本：人物身份、空间结构、站位、动作骨架和镜头节奏与原片高度相似，但表情细节、材质纹理、光影层次、背景小物和动作微差允许合理变化。',
    '不要新增原片没有的角色、场景切换、道具焦点、情节动作或夸张镜头运动。',
    isShot && hasDialogue ? '当前镜头必须有人物说话和明显口型同步，并且生成对应音频。' : '',
    isShot && hasDialogue ? '输出结果必须是带完整音轨的视频文件，不能返回静音视频。' : '',
    isShot && hasDialogue ? '对白必须完整生成，不吞字、不丢尾句，口型张闭、停顿和语气尽量贴合参考。' : '',
    isShot && hasDialogue ? '如果提供了参考音频，生成音频与口型都必须尽量对齐参考音频的字数、停顿、重音和结尾收口。' : '',
    isShot && hasDialogue && speechTranscript ? `对白文本真值（必须完整生成）：${speechTranscript}` : '',
    isShot && hasDialogue && speechTimingSummary ? `字幕节奏参考：${speechTimingSummary}` : '',
    isShot && hasDialogue && speechStyle ? `说话方式：${speechStyle}` : '',
    isShot && hasDialogue && speechDialogueCompletionTimeSeconds > 0
      ? `对白必须尽量覆盖本次目标视频时长，并在第 ${speechDialogueCompletionTimeSeconds.toFixed(2)} 秒附近自然收口。`
      : '',
    isShot &&
    hasDialogue &&
    speechProviderTargetDurationSeconds > Number(durationSeconds ?? 0) + 0.05 &&
    Number.isFinite(Number(durationSeconds))
      ? `如果供应商内部按 ${speechProviderTargetDurationSeconds.toFixed(2)} 秒生成后再裁回当前镜头 ${Number(
          durationSeconds
        ).toFixed(2)} 秒，也要让对白和口型尽量延续到裁切点附近，不要在目标视频中前段提前说完。`
      : '',
    isShot && hasDialogue && speechTrimSafetyTailSeconds > 0.02
      ? `镜头末尾只允许保留约 ${speechTrimSafetyTailSeconds.toFixed(2)} 秒极短收口余量，不要提前长时间闭口。`
      : '',
    isShot && hasDialogue && shouldFitDialogueWithinShot && Number.isFinite(Number(durationSeconds))
      ? `必须把完整对白控制在本次目标视频 ${Number(durationSeconds).toFixed(2)} 秒内说完，允许适度加快语速和压缩停顿，但不要截断台词结尾。`
      : '',
    isShot && hasDialogue && String(speech?.deliveryConstraint ?? speech?.delivery_constraint ?? '').trim()
      ? `对白时长约束：${String(speech?.deliveryConstraint ?? speech?.delivery_constraint ?? '').trim()}`
      : '',
    isShot && hasDialogue ? '对白和字幕只用于口型、表演、语速、停顿和生成音频，不要把任何字幕文字直接显示到画面里。' : '',
    isShot && !hasDialogue ? '当前镜头不要对白、不要唱词、不要明显说话嘴部动作，只生成纯视频画面。' : '',
    '画面里不要任何字幕、台词字卡、贴纸文案、Logo、水印、角标、UI 浮层或其它可见文字。'
  ]
    .filter(Boolean)
    .join('\n');
};

const processGenerationTask = async (taskId) => {
  const task = await GenerationTask.findByPk(taskId, {
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
    return;
  }

  try {
    await task.update({
      status: TASK_STATUS.processing,
      progress: 10
    });
    broadcastGenerationTaskUpdate(task);

    const remoteTaskId = String(task.meta?.remoteTaskId ?? '').trim();
    const requestedDurationSeconds =
      Number(task.meta?.requestedDurationSeconds ?? task.meta?.requested_duration_seconds) ||
      getSeedDanceDurationForSegment(task.segment);
    const providerDurationSeconds =
      Number(task.meta?.providerDurationSeconds ?? task.meta?.provider_duration_seconds) ||
      requestedDurationSeconds;

    if (remoteTaskId) {
      const result = await resumeRemoteGenerationTask({
        remoteTaskId,
        basename: `segment-${task.segmentId}-task-${task.id}`,
        duration: requestedDurationSeconds,
        onProgress: async (progressPayload) => {
          await applySeedDanceTaskProgress(task, progressPayload);
        },
        trimToRequestedDuration: true
      });

      await task.update({
        status: TASK_STATUS.completed,
        progress: 100,
        resultUrl: result.fileUrl,
        errorMessage: null,
        meta: {
          ...(task.meta ?? {}),
          source: 'segment_generation',
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
          requestedDurationSeconds: result.requestedDurationSeconds ?? requestedDurationSeconds,
          providerDurationSeconds: result.providerDurationSeconds ?? providerDurationSeconds,
          actualDurationSeconds: result.actualDurationSeconds ?? null,
          hasDialogue: false,
          trimmedToRequested:
            typeof result.trimmedToRequested === 'boolean' ? result.trimmedToRequested : true,
          fallbackReason: result.fallbackReason || '',
          providerError: result.providerError || ''
        }
      });
      broadcastGenerationTaskUpdate(task);
      return;
    }

    const characters = task.segment?.video?.analysis?.characters ?? [];
    const overallAnalysis = task.segment?.video?.analysis ?? null;
    const resolvedStyleMode = normalizeStyleMode(
      task.meta?.styleMode ??
        task.meta?.style_mode ??
        task.segment?.analysis?.analysisOptions?.styleMode ??
        overallAnalysis?.analysisOptions?.styleMode ??
        overallAnalysis?.analysis_options?.styleMode ??
        DEFAULT_STYLE_MODE
    );
    const useReferenceVideo = normalizeUseReferenceVideo(task.meta?.useReferenceVideo ?? task.meta?.use_reference_video, true);
    const useReferenceFrame = normalizeUseReferenceFrame(task.meta?.useReferenceFrame ?? task.meta?.use_reference_frame, true);
    const videoGenerationStylePrompt = resolveStyleTemplate({
      styleMode: resolvedStyleMode,
      styleTemplates:
        task.segment?.analysis?.analysisOptions?.styleTemplates ??
        overallAnalysis?.analysisOptions?.styleTemplates ??
        overallAnalysis?.analysis_options?.styleTemplates ??
        null,
      templateKey: 'videoGenerationStylePrompt'
    });
    const backgroundBinding = getBackgroundBindingForSegment(task.segment, overallAnalysis);
    const sourceAbsolutePath = resolveUploadPath(task.segment.filePath);
    const sourcePublicUrl = toAbsolutePublicUploadUrl(task.segment.filePath);
    const sourceVideoAbsolutePath = task.segment?.video?.filePath
      ? resolveUploadPath(task.segment.video.filePath)
      : '';

    let backgroundAsset = null;

    if (backgroundBinding) {
      await task.update({
        progress: 20
      });
      broadcastGenerationTaskUpdate(task);

      backgroundAsset = await ensureBackgroundAsset({
        video: task.segment.video,
        segment: task.segment,
        backgroundId: backgroundBinding.backgroundId,
        backgroundName: backgroundBinding.backgroundName,
        backgroundDescription: backgroundBinding.description,
        backgroundPrompt: backgroundBinding.backgroundPrompt,
        representativeFrameTime: Number.isFinite(backgroundBinding.representativeFrameTime)
          ? Number(backgroundBinding.representativeFrameTime.toFixed(2))
          : null,
        segmentSceneSummary: backgroundBinding.sceneSummary,
        sourcePublicUrl,
        sourceAbsolutePath
      });
    }

    const optimizedPrompt = expandPromptMentions(task.prompt, characters, overallAnalysis?.backgrounds ?? []);
    const targetDurationSeconds = getSeedDanceDurationForSegment(task.segment);
    const seedDancePrompt = buildSeedDanceReconstructionPrompt({
      prompt: optimizedPrompt,
      plot: overallAnalysis?.plot ?? '',
      segmentPrompt: task.prompt,
      videoGenerationStylePrompt,
      characterNames: [...getPromptMentionNames(task.prompt), ...getSegmentCharacterNames(task.segment)],
      sceneNames: [
        ...getPromptSceneNames(task.prompt),
        ...getSegmentSceneNames(task.segment),
        backgroundBinding?.backgroundName || ''
      ],
      isShot: false,
      durationSeconds: targetDurationSeconds,
      useReferenceVideo,
      useReferenceFrame
    });
    const primarySegmentReferenceImage = useReferenceFrame
      ? await buildSegmentFrameReference({
          segment: task.segment,
          sourceSegmentAbsolutePath: sourceAbsolutePath,
          basenamePrefix: `segment-${task.segmentId}-task-${task.id}`
        })
      : null;
    const characterReferenceImages = await collectCharacterReferenceImages({
      videoId: task.segment?.video?.id,
      segment: task.segment,
      overallAnalysis,
      prompt: task.prompt,
      sourceVideoAbsolutePath,
      basenamePrefix: `segment-${task.segmentId}-task-${task.id}`
    });
    const sceneReferenceImages = await collectSceneReferenceImages({
      videoId: task.segment?.video?.id,
      segment: task.segment,
      overallAnalysis,
      prompt: task.prompt,
      sceneNames: getSegmentSceneNames(task.segment),
      backgroundBinding,
      sourceVideoAbsolutePath,
      basenamePrefix: `segment-${task.segmentId}-task-${task.id}`
    });
    const referenceImages = composeSeedDanceReferenceImages({
      primaryImages: primarySegmentReferenceImage ? [primarySegmentReferenceImage] : [],
      characterImages: characterReferenceImages,
      sceneImages: sceneReferenceImages,
      primaryImagePlacement: 'after_assets'
    });

    await task.update({
      optimizedPrompt,
      progress: 45,
      meta: {
        ...(task.meta ?? {}),
        requestedDurationSeconds: targetDurationSeconds ?? null,
        providerDurationSeconds: targetDurationSeconds ?? null,
        actualDurationSeconds: null,
        hasDialogue: false,
        trimmedToRequested: true
      }
    });
    broadcastGenerationTaskUpdate(task);

    const result = await generateWithSeedDance({
      sourceAbsolutePath: useReferenceVideo ? sourceAbsolutePath : '',
      sourcePublicUrl: useReferenceVideo ? sourcePublicUrl : '',
      sourceReferenceSourceKind: 'source_video',
      sourceReferenceDisplayLabel: '大片段源视频',
      prompt: seedDancePrompt,
      basename: `segment-${task.segmentId}-task-${task.id}`,
      ratio: normalizeGenerationRatio(task.meta?.ratio),
      duration: targetDurationSeconds,
      onProgress: async (progressPayload) => {
        await applySeedDanceTaskProgress(task, progressPayload);
      },
      trimToRequestedDuration: true,
      referenceImages,
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
        source: 'segment_generation',
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
        requestedDurationSeconds: result.requestedDurationSeconds ?? targetDurationSeconds ?? null,
        providerDurationSeconds: result.providerDurationSeconds ?? targetDurationSeconds ?? null,
        actualDurationSeconds: result.actualDurationSeconds ?? null,
        hasDialogue: false,
        trimmedToRequested:
          typeof result.trimmedToRequested === 'boolean' ? result.trimmedToRequested : true,
        fallbackReason: result.fallbackReason || '',
        providerError: result.providerError || ''
      }
    });
    broadcastGenerationTaskUpdate(task);
  } catch (error) {
    await task.update({
      status: TASK_STATUS.failed,
      errorMessage: error.message,
      meta: {
        ...(task.meta ?? {}),
        source: 'segment_generation',
        remoteStatus: String(task.meta?.remoteStatus ?? '').trim(),
        remoteStatusLabel: String(task.meta?.remoteStatusLabel ?? '').trim(),
        remoteCreatedAt: task.meta?.remoteCreatedAt ?? null,
        remoteUpdatedAt: task.meta?.remoteUpdatedAt ?? null,
        providerError: error.message
      }
    });
    broadcastGenerationTaskUpdate(task);
  }
};

const startGeneration = async ({
  segmentId = null,
  videoId = null,
  prompt = '',
  ratio = env.SEED_DANCE_RATIO,
  styleMode = null,
  useReferenceVideo = true,
  useReferenceFrame = true
}) => {
  // Get video and analysis
  let video = null;
  let segment = null;

  if (segmentId) {
    segment = await Segment.findByPk(segmentId);
    if (!segment) {
      throw new AppError('Segment not found', 404);
    }
    videoId = segment.videoId;
  }

  if (!videoId) {
    throw new AppError('Video ID is required', 400);
  }

  video = await Video.findByPk(videoId);
  if (!video) {
    throw new AppError('Video not found', 404);
  }

  const analysis = await Analysis.findOne({ where: { videoId } });
  if (!analysis) {
    throw new AppError('Analysis not found. Please analyze the video first.', 404);
  }

  assertSeedDanceReady();

  // Determine style mode
  const analysisOptions = analysis.analysisOptions || {};
  const effectiveStyleMode = normalizeStyleMode(styleMode ?? analysisOptions.styleMode);

  // Build prompt based on whether it's segment-level or full-video generation
  let fullPrompt;
  let durationSeconds;

  if (segmentId && segment) {
    // Segment-level generation: use buildSegmentVideoPrompt
    fullPrompt = buildSegmentVideoPrompt({
      segment,
      analysis,
      styleMode: effectiveStyleMode,
      styleTemplates: analysisOptions.styleTemplates
    });
    durationSeconds = Number(segment.endTime - segment.startTime);
  } else {
    // Full-video generation: use buildFullVideoPrompt
    fullPrompt = buildFullVideoPrompt({
      analysis,
      video,
      styleMode: effectiveStyleMode,
      styleTemplates: analysisOptions.styleTemplates,
      useReferenceVideo,
      useReferenceFrame
    });
    durationSeconds = Number(video.duration ?? 0);
  }

  if (durationSeconds <= 0) {
    throw new AppError('Invalid duration', 400);
  }

  // Collect all character reference images
  const allCharacterIds = segmentId && segment
    ? (segment.analysis?.characterNames || [])
    : (analysis.characters || []).map(c => c.id);
  const characterImages = await collectCharacterReferenceImages({
    videoId,
    segment: segment || null,
    overallAnalysis: analysis,
    prompt: fullPrompt,
    sourceVideoAbsolutePath: resolveUploadPath(video.filePath),
    basenamePrefix: segmentId ? `segment-${segmentId}` : `full-video-${videoId}`
  });

  // Collect all scene reference images
  const allSceneIds = segmentId && segment
    ? (segment.analysis?.sceneNames || [])
    : (analysis.backgrounds || []).map(b => b.id);
  const sceneImages = await collectSceneReferenceImages({
    videoId,
    segment: segment || null,
    overallAnalysis: analysis,
    prompt: fullPrompt,
    sceneNames: allSceneIds,
    backgroundBinding: null,
    sourceVideoAbsolutePath: resolveUploadPath(video.filePath),
    basenamePrefix: segmentId ? `segment-${segmentId}` : `full-video-${videoId}`
  });

  // Combine all reference images
  const referenceImages = composeSeedDanceReferenceImages({
    characterImages,
    sceneImages
  });

  // Prepare reference video
  const normalizedUseReferenceVideo = normalizeUseReferenceVideo(useReferenceVideo);
  const referenceVideoPath = normalizedUseReferenceVideo ? resolveUploadPath(video.filePath) : null;
  const referenceVideoUrl = normalizedUseReferenceVideo ? toAbsolutePublicUploadUrl(video.filePath) : null;

  // Create generation task
  const task = await GenerationTask.create({
    videoId,
    segmentId: segmentId || null,
    status: TASK_STATUS.pending,
    progress: 0,
    prompt: fullPrompt,
    optimizedPrompt: fullPrompt,
    resultUrl: null,
    errorMessage: null,
    meta: {
      engine: 'seedance',
      ratio: normalizeGenerationRatio(ratio),
      styleMode: effectiveStyleMode,
      useReferenceVideo: normalizedUseReferenceVideo,
      useReferenceFrame: normalizeUseReferenceFrame(useReferenceFrame),
      source: segmentId ? 'segment_video_generation' : 'full_video_generation',
      requestedDurationSeconds: durationSeconds,
      shotCount: segmentId && segment
        ? (segment.analysis?.shots || []).length
        : (analysis.timeAnchors || []).reduce(
            (sum, anchor) => sum + (anchor.shots || []).length,
            0
          ),
      remoteStatus: '',
      remoteStatusLabel: '',
      remoteCreatedAt: null,
      remoteUpdatedAt: null,
      isMock: false,
      remoteTaskId: '',
      fallbackReason: '',
      providerError: '',
      providerDurationSeconds: durationSeconds,
      actualDurationSeconds: null,
      hasDialogue: false,
      trimmedToRequested: true
    }
  });

  // Broadcast task creation
  broadcastGenerationTaskUpdate(task);

  // Start generation asynchronously
  queueMicrotask(async () => {
    try {
      await task.update({ status: TASK_STATUS.processing, progress: 10 });
      broadcastGenerationTaskUpdate(task);

      // Call Seedance
      const result = await generateWithSeedDance({
        sourceAbsolutePath: referenceVideoPath || '',
        sourcePublicUrl: referenceVideoUrl || '',
        sourceReferenceSourceKind: 'source_video',
        sourceReferenceDisplayLabel: '完整原片视频',
        prompt: fullPrompt,
        basename: `full-video-${videoId}-task-${task.id}`,
        ratio: normalizeGenerationRatio(ratio),
        duration: durationSeconds,
        onProgress: async (progressPayload) => {
          await applySeedDanceTaskProgress(task, progressPayload);
        },
        trimToRequestedDuration: false,
        referenceImages,
        referenceVideos: []
      });

      // Update task with result
      await task.update({
        status: TASK_STATUS.completed,
        progress: 100,
        resultUrl: result.fileUrl,
        errorMessage: null,
        meta: {
          ...task.meta,
          engine: result.engine || 'seedance',
          isMock: Boolean(result.isMock),
          remoteTaskId: result.remoteTaskId || '',
          remoteUrl: result.remoteUrl || '',
          sentReferenceImages: result.sentReferenceImages ?? [],
          sentReferenceVideos: result.sentReferenceVideos ?? [],
          sentReferenceAudios: result.sentReferenceAudios ?? [],
          remoteStatus: 'succeeded',
          remoteStatusLabel: '远端已完成',
          actualDurationSeconds: result.actualDurationSeconds ?? null,
          providerDurationSeconds: result.providerDurationSeconds ?? durationSeconds,
          fallbackReason: result.fallbackReason || '',
          providerError: result.providerError || ''
        }
      });

      broadcastGenerationTaskUpdate(task);
    } catch (error) {
      await task.update({
        status: TASK_STATUS.failed,
        progress: 0,
        errorMessage: error.message || 'Generation failed',
        meta: {
          ...task.meta,
          providerError: error.message || 'Generation failed'
        }
      });

      broadcastGenerationTaskUpdate(task);
    }
  });

  return {
    task_id: task.id,
    status: task.status,
    progress: task.progress,
    ratio: normalizeGenerationRatio(ratio),
    style_mode: effectiveStyleMode,
    use_reference_video: normalizedUseReferenceVideo,
    use_reference_frame: normalizeUseReferenceFrame(useReferenceFrame)
  };
};

const getGenerationTaskStatus = async (taskId) => {
  const task = await GenerationTask.findByPk(taskId);

  if (!task) {
    throw new AppError('Generation task not found.', 404, {
      task_id: taskId
    });
  }

  return serializeGenerationTask(task);
};

export {
  buildFullVideoPrompt,
  buildSeedDanceReconstructionPrompt,
  broadcastGenerationTaskUpdate,
  collectCharacterReferenceImages,
  collectCharacterStateReferenceImages,
  collectSceneReferenceImages,
  composeSeedDanceReferenceImages,
  expandPromptMentions,
  getBackgroundBindingForSegment,
  getPromptMentionNames,
  getPromptSceneNames,
  getGenerationTaskStatus,
  normalizeUseReferenceFrame,
  normalizeUseReferenceVideo,
  processGenerationTask,
  resolveRelevantCharacters,
  resolveRelevantScenes,
  serializeGenerationTask,
  startGeneration
};
