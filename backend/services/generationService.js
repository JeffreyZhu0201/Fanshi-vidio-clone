import { Analysis, GenerationTask, Segment, Video } from '../models/index.js';
import env from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { TASK_STATUS } from '../config/constants.js';
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
    source: String(taskMeta.source ?? '').trim(),
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

  return dedupeReferenceEntries(referenceImages).slice(0, 9);
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
    ]).slice(0, 2);

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
      .slice(0, 2);

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

  return dedupeReferenceEntries(referenceImages).slice(0, 6);
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

const doesSegmentTaskMatchGenerationRequest = ({ task, prompt, ratio }) => {
  if (!task) {
    return false;
  }

  return (
    normalizeComparablePrompt(task.prompt) === normalizeComparablePrompt(prompt) &&
    normalizeGenerationRatio(task.meta?.ratio) === normalizeGenerationRatio(ratio)
  );
};

const buildSeedDanceReconstructionPrompt = ({
  prompt = '',
  plot = '',
  segmentPrompt = '',
  shotPrompt = '',
  characterNames = [],
  sceneNames = [],
  speech = null,
  isShot = false
}) => {
  const normalizedCharacterNames = dedupeNameList(characterNames, normalizeCharacterIdentity);
  const normalizedSceneNames = dedupeNameList(sceneNames, normalizeSceneIdentity);
  const basePrompt = String(prompt ?? '').trim();
  const hasDialogue = Boolean(speech?.hasDialogue);
  const speechTranscript = String(speech?.transcript ?? '').trim();
  const speechStyle = String(speech?.speechStyle ?? '').trim();
  const speechSubtitleLines = Array.isArray(speech?.subtitleLines) ? speech.subtitleLines : [];
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
    basePrompt ? `资源展开后的生成真值：${basePrompt}` : '',
    isShot ? '严格还原原片当前小镜头，不要把多个镜头语义混成一个新镜头。' : '严格延续原片当前片段的剧情、镜头语言和表演逻辑。',
    isShot
      ? '第一张参考图是该小镜头的典型帧，必须优先用它锁定构图、景别、机位朝向、人物站位、前后景关系、视线方向和动作瞬间。'
      : '参考视频是当前片段的原始镜头依据，必须优先沿用它的运动节奏、镜头顺序和空间连续性。',
    normalizedCharacterNames.length
      ? `必须把这些角色三视图作为人物身份真值：${normalizedCharacterNames.map((name) => `@${name}`).join('、')}。`
      : '如果提供了角色三视图，必须优先用它们锁定角色身份、脸型、发型、服装、比例和体态。',
    normalizedSceneNames.length
      ? `必须把这些场景参考图作为空间真值：${normalizedSceneNames.map((name) => `#${name}`).join('、')}。`
      : '如果提供了场景参考图，必须优先用它们锁定空间结构、布景、材质、布光和色彩。',
    '保持原片相同或最接近的景别、拍摄高度、视角方向、人物左右位置、前中后景层次、遮挡关系、进出画路径、视线方向、镜头运动和动作节奏。',
    '不要新增原片没有的角色、场景切换、道具焦点、情节动作或夸张镜头运动。',
    isShot && hasDialogue ? '当前镜头必须有人物说话和明显口型同步，并且生成对应音频。' : '',
    isShot && hasDialogue && speechTranscript ? `对白文本真值：${speechTranscript}` : '',
    isShot && hasDialogue && speechTimingSummary ? `字幕节奏参考：${speechTimingSummary}` : '',
    isShot && hasDialogue && speechStyle ? `说话方式：${speechStyle}` : '',
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

    if (remoteTaskId) {
      const result = await resumeRemoteGenerationTask({
        remoteTaskId,
        basename: `segment-${task.segmentId}-task-${task.id}`,
        duration: getSeedDanceDurationForSegment(task.segment),
        onProgress: async (progressPayload) => {
          await applySeedDanceTaskProgress(task, progressPayload);
        }
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
          fallbackReason: result.fallbackReason || '',
          providerError: result.providerError || ''
        }
      });
      broadcastGenerationTaskUpdate(task);
      return;
    }

    const characters = task.segment?.video?.analysis?.characters ?? [];
    const overallAnalysis = task.segment?.video?.analysis ?? null;
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
    const seedDancePrompt = buildSeedDanceReconstructionPrompt({
      prompt: optimizedPrompt,
      plot: overallAnalysis?.plot ?? '',
      segmentPrompt: task.prompt,
      characterNames: [...getPromptMentionNames(task.prompt), ...getSegmentCharacterNames(task.segment)],
      sceneNames: [
        ...getPromptSceneNames(task.prompt),
        ...getSegmentSceneNames(task.segment),
        backgroundBinding?.backgroundName || ''
      ],
      isShot: false
    });
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
    const referenceImages = dedupeReferenceEntries([
      ...characterReferenceImages,
      ...sceneReferenceImages
    ]).slice(0, 9);

    await task.update({
      optimizedPrompt,
      progress: 45
    });
    broadcastGenerationTaskUpdate(task);

    const result = await generateWithSeedDance({
      sourceAbsolutePath,
      sourcePublicUrl,
      sourceReferenceSourceKind: 'source_video',
      sourceReferenceDisplayLabel: '大片段源视频',
      prompt: seedDancePrompt,
      basename: `segment-${task.segmentId}-task-${task.id}`,
      ratio: normalizeGenerationRatio(task.meta?.ratio),
      duration: getSeedDanceDurationForSegment(task.segment),
      onProgress: async (progressPayload) => {
        await applySeedDanceTaskProgress(task, progressPayload);
      },
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
        remoteTaskId: result.remoteTaskId || '',
        remoteUrl: result.remoteUrl || '',
        sentReferenceImages: result.sentReferenceImages ?? task.meta?.sentReferenceImages ?? [],
        sentReferenceVideos: result.sentReferenceVideos ?? task.meta?.sentReferenceVideos ?? [],
        sentReferenceAudios: result.sentReferenceAudios ?? task.meta?.sentReferenceAudios ?? [],
        remoteStatus: 'succeeded',
        remoteStatusLabel: '远端已完成',
        remoteCreatedAt: task.meta?.remoteCreatedAt ?? null,
        remoteUpdatedAt: task.meta?.remoteUpdatedAt ?? null,
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

const startGeneration = async ({ segmentId, prompt, ratio }) => {
  const segment = await Segment.findByPk(segmentId);

  if (!segment) {
    throw new AppError('Segment not found.', 404, {
      segment_id: segmentId
    });
  }

  assertSeedDanceReady();

  const resolvedRatio = normalizeGenerationRatio(ratio);
  const latestTasks = await GenerationTask.findAll({
    where: {
      segmentId
    },
    order: [['createdAt', 'DESC']]
  });
  const latestAttemptTask = latestTasks[0] ?? null;
  const latestCompletedTask = latestTasks.find((task) => isUsableCompletedGenerationTask(task)) ?? null;

  if (
    latestAttemptTask &&
    [TASK_STATUS.pending, TASK_STATUS.processing].includes(latestAttemptTask.status) &&
    doesSegmentTaskMatchGenerationRequest({
      task: latestAttemptTask,
      prompt,
      ratio: resolvedRatio
    })
  ) {
    return {
      task_id: latestAttemptTask.id,
      status: latestAttemptTask.status,
      progress: latestAttemptTask.progress,
      ratio: resolvedRatio
    };
  }

  if (
    isUsableCompletedGenerationTask(latestCompletedTask) &&
    doesSegmentTaskMatchGenerationRequest({
      task: latestCompletedTask,
      prompt,
      ratio: resolvedRatio
    })
  ) {
    return {
      task_id: latestCompletedTask.id,
      status: latestCompletedTask.status,
      progress: latestCompletedTask.progress,
      ratio: resolvedRatio
    };
  }

  const task = await GenerationTask.create({
    segmentId,
    prompt,
    status: TASK_STATUS.pending,
    progress: 0,
    meta: {
      source: 'segment_generation',
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
  broadcastGenerationTaskUpdate(task);

  queueMicrotask(() => {
    void processGenerationTask(task.id);
  });

  return {
    task_id: task.id,
    status: task.status,
    progress: task.progress,
    ratio: resolvedRatio
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
  buildSeedDanceReconstructionPrompt,
  broadcastGenerationTaskUpdate,
  collectCharacterReferenceImages,
  collectSceneReferenceImages,
  expandPromptMentions,
  getBackgroundBindingForSegment,
  getPromptMentionNames,
  getPromptSceneNames,
  getGenerationTaskStatus,
  processGenerationTask,
  resolveRelevantCharacters,
  resolveRelevantScenes,
  serializeGenerationTask,
  startGeneration
};
