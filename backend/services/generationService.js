import { Analysis, GenerationTask, Segment, Video } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { TASK_STATUS } from '../config/constants.js';
import { ensureBackgroundAsset } from './backgroundAssetService.js';
import { listCompletedResourceImageAssetsByResourceKeys } from './resourceImageService.js';
import { assertSeedDanceReady, generateSegment as generateWithSeedDance } from './seedDanceService.js';
import { resolveUploadPath, toAbsolutePublicUploadUrl } from './fileService.js';
import { extractVideoFrame } from './ffmpegService.js';
import { broadcastRealtimeEvent } from './realtimeService.js';

const serializeGenerationMeta = (task) => {
  const taskMeta = task?.meta ?? {};

  return {
    engine: String(taskMeta.engine ?? '').trim(),
    is_mock: Boolean(taskMeta.isMock),
    remote_task_id: String(taskMeta.remoteTaskId ?? '').trim(),
    fallback_reason: String(taskMeta.fallbackReason ?? '').trim(),
    provider_error: String(taskMeta.providerError ?? '').trim(),
    source: String(taskMeta.source ?? '').trim()
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

const broadcastGenerationTaskUpdate = (task) => {
  broadcastRealtimeEvent('generation:progress', serializeGenerationTask(task));
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

const getPromptMentionNames = (prompt = '') => {
  return Array.from(String(prompt ?? '').matchAll(/@([\p{L}\p{N}_-]+)/gu), (match) => String(match[1] ?? '').trim()).filter(
    Boolean
  );
};

const normalizeCharacterIdentity = (value) => {
  return String(value ?? '')
    .trim()
    .toLowerCase();
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

const resolveRelevantCharacters = (segment, overallAnalysis, prompt = '') => {
  const overallCharacters = Array.isArray(overallAnalysis?.characters) ? overallAnalysis.characters.filter(Boolean) : [];

  if (!overallCharacters.length) {
    return [];
  }

  const segmentCharacterNames = new Set(getSegmentCharacterNames(segment).map(normalizeCharacterIdentity));
  const promptMentionNames = new Set(getPromptMentionNames(prompt).map(normalizeCharacterIdentity));
  const filterCharacters = (nameSet) =>
    overallCharacters.filter((character) => {
      const characterName = normalizeCharacterIdentity(character?.name);
      const characterId = normalizeCharacterIdentity(character?.id);
      return (characterName && nameSet.has(characterName)) || (characterId && nameSet.has(characterId));
    });

  const segmentMatchedCharacters = segmentCharacterNames.size ? filterCharacters(segmentCharacterNames) : [];

  if (segmentMatchedCharacters.length) {
    return segmentMatchedCharacters;
  }

  const promptMatchedCharacters = promptMentionNames.size ? filterCharacters(promptMentionNames) : [];

  if (promptMatchedCharacters.length) {
    return promptMatchedCharacters;
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
    role: 'reference_image'
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
      role: 'reference_image'
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
    ).slice(0, 3);

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

const collectSceneReferenceImages = async ({ videoId, backgroundBinding }) => {
  if (!videoId || !backgroundBinding?.backgroundId) {
    return [];
  }

  const persistedSceneAssets = await listCompletedResourceImageAssetsByResourceKeys({
    videoId,
    resourceType: 'scene',
    resourceKeys: [backgroundBinding.backgroundId, backgroundBinding.backgroundName]
  });

  return dedupeReferenceEntries(
    persistedSceneAssets.map((asset) => ({
      relativePath: asset.asset_path || '',
      url: asset.asset_url || '',
      role: 'reference_image'
    }))
  ).slice(0, 3);
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
      backgroundBinding
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
      prompt: optimizedPrompt,
      basename: `segment-${task.segmentId}-task-${task.id}`,
      duration: getSeedDanceDurationForSegment(task.segment),
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
        source: 'segment_generation',
        engine: result.engine || '',
        isMock: Boolean(result.isMock),
        remoteTaskId: result.remoteTaskId || '',
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
        providerError: error.message
      }
    });
    broadcastGenerationTaskUpdate(task);
  }
};

const startGeneration = async ({ segmentId, prompt }) => {
  const segment = await Segment.findByPk(segmentId);

  if (!segment) {
    throw new AppError('Segment not found.', 404, {
      segment_id: segmentId
    });
  }

  assertSeedDanceReady();

  const task = await GenerationTask.create({
    segmentId,
    prompt,
    status: TASK_STATUS.pending,
    progress: 0,
    meta: {
      source: 'segment_generation',
      engine: '',
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
    progress: task.progress
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
  broadcastGenerationTaskUpdate,
  collectCharacterReferenceImages,
  collectSceneReferenceImages,
  expandPromptMentions,
  getBackgroundBindingForSegment,
  getGenerationTaskStatus,
  serializeGenerationTask,
  startGeneration
};
