import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import env from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import { getVideoMetadata, sliceVideoClip } from './ffmpegService.js';
import {
  createOutputRelativePath,
  duplicateToUploadPath,
  ensureParentDirectory,
  publicUrlToRelativePath,
  removeFileIfExists,
  resolveUploadPath,
  toPublicUploadUrl
} from './fileService.js';

const canUseRemoteSeedDance = Boolean(env.SEED_DANCE_API_KEY && env.SEED_DANCE_API_BASE_URL);
const REFERENCE_IMAGE_LIMIT = 9;
const IMAGE_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
};
const VIDEO_MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm'
};
const AUDIO_MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg'
};
const SEED_DANCE_REMOTE_STATUS_LABELS = {
  queued: '远端排队中',
  running: '远端生成中',
  succeeded: '远端已完成',
  completed: '远端已完成',
  success: '远端已完成',
  failed: '远端失败',
  expired: '远端超时',
  cancelled: '远端已取消'
};
const MIN_REFERENCE_VIDEO_DURATION_SECONDS = 1.8;
const MIN_REFERENCE_VIDEO_DIMENSION = 300;
const MIN_REFERENCE_VIDEO_PIXEL_COUNT = 409600;
const MIN_SEED_DANCE_GENERATION_DURATION_SECONDS = 4;
const SEED_DANCE_SENSITIVE_IMAGE_ERROR_PATTERN = /InputImageSensitiveContentDetected(?:\.[A-Za-z]+)?/u;

const shouldAllowSeedDanceMockFallback = () => {
  return Boolean(env.SEED_DANCE_ALLOW_MOCK_FALLBACK);
};

const shouldUseStrictRemoteSeedDance = () => {
  return canUseRemoteSeedDance && env.SEED_DANCE_STRICT_REMOTE;
};

const isWebUrl = (value = '') => /^https?:\/\//iu.test(String(value).trim());

const getSeedDanceProviderStatus = () => {
  const missingFields = [];

  if (!env.SEED_DANCE_API_KEY) {
    missingFields.push('SEED_DANCE_API_KEY');
  }

  if (!env.SEED_DANCE_API_BASE_URL) {
    missingFields.push('SEED_DANCE_API_BASE_URL');
  }

  return {
    ready: canUseRemoteSeedDance,
    reason: missingFields.length ? `缺少 ${missingFields.join('、')}` : '',
    model: env.SEED_DANCE_MODEL,
    allow_mock_fallback: shouldAllowSeedDanceMockFallback(),
    warning: !env.PUBLIC_ASSET_BASE_URL
      ? '未配置 PUBLIC_ASSET_BASE_URL，Seedance 将跳过本地 reference_video，仅使用公网视频 URL 或图像参考。'
      : ''
  };
};

const assertSeedDanceReady = () => {
  const providerStatus = getSeedDanceProviderStatus();

  if (providerStatus.ready) {
    return providerStatus;
  }

  throw new AppError(
    `Seedance 未配置完成，无法发起真实片段生成。${providerStatus.reason ? ` ${providerStatus.reason}` : ''}`,
    503,
    {
      provider: 'seedance',
      reason: providerStatus.reason,
      allow_mock_fallback: providerStatus.allow_mock_fallback
    }
  );
};

const sleep = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const isRemoteHttpUrl = (value = '') => isWebUrl(value);

const isDataUrl = (value = '') => /^data:/iu.test(String(value).trim());

const isPublicUploadUrl = (value = '') => /^\/?uploads\//u.test(String(value).trim());

const resolveSeedDanceCreateEndpoint = () => {
  const trimmedBaseUrl = env.SEED_DANCE_API_BASE_URL.replace(/\/+$/u, '');

  if (trimmedBaseUrl.endsWith('/contents/generations/tasks')) {
    return trimmedBaseUrl;
  }

  if (trimmedBaseUrl.endsWith('/api/v3')) {
    return `${trimmedBaseUrl}/contents/generations/tasks`;
  }

  return `${trimmedBaseUrl}/api/v3/contents/generations/tasks`;
};

const resolveSeedDanceTaskEndpoint = (taskId) => {
  return `${resolveSeedDanceCreateEndpoint()}/${encodeURIComponent(taskId)}`;
};

const normalizeRequestedSeedDanceDuration = (duration) => {
  const parsedDuration = Number(duration);

  if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
    return Number(env.SEED_DANCE_DURATION_SECONDS) || MIN_SEED_DANCE_GENERATION_DURATION_SECONDS;
  }

  return Number(parsedDuration.toFixed(2));
};

const resolveSeedDanceProviderDuration = (duration) => {
  return Math.max(
    MIN_SEED_DANCE_GENERATION_DURATION_SECONDS,
    Math.ceil(normalizeRequestedSeedDanceDuration(duration))
  );
};

const normalizeReferenceEntry = (entry, defaultRole) => {
  if (!entry) {
    return null;
  }

  if (typeof entry === 'string') {
    const trimmedValue = entry.trim();

    return trimmedValue
      ? {
          url: trimmedValue,
          role: defaultRole
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
      entry.value ??
      entry.dataUrl ??
      entry.data_url ??
      entry.base64 ??
      entry.assetId ??
      entry.asset_id ??
      ''
  ).trim();
  const absolutePath = String(
    entry.absolutePath ?? entry.absolute_path ?? (path.isAbsolute(String(entry.path ?? '').trim()) ? entry.path : '')
  ).trim();
  const relativePath = String(
    entry.relativePath ??
      entry.relative_path ??
      entry.filePath ??
      entry.file_path ??
      (!path.isAbsolute(String(entry.path ?? '').trim()) ? entry.path ?? '' : '')
  ).trim();

  if (!url && !absolutePath && !relativePath) {
    return null;
  }

  return {
    url,
    absolutePath,
    relativePath,
    role: String(entry.role || defaultRole).trim() || defaultRole
  };
};

const dedupeReferenceEntries = (entries = []) => {
  const seenKeys = new Set();

  return entries.filter((entry) => {
    const dedupeKey = `${entry.role}|${entry.url || ''}|${entry.absolutePath || ''}|${entry.relativePath || ''}`;

    if (seenKeys.has(dedupeKey)) {
      return false;
    }

    seenKeys.add(dedupeKey);
    return true;
  });
};

const resolveSeedDanceMimeType = (absolutePath, mediaType) => {
  const extension = path.extname(String(absolutePath || '')).toLowerCase();

  if (mediaType === 'image') {
    return IMAGE_MIME_TYPES[extension] || 'image/png';
  }

  if (mediaType === 'audio') {
    return AUDIO_MIME_TYPES[extension] || 'audio/mpeg';
  }

  return VIDEO_MIME_TYPES[extension] || 'video/mp4';
};

const resolveSeedDanceDataUrl = async (absolutePath, mediaType) => {
  const fileBuffer = await readFile(absolutePath);
  const mimeType = resolveSeedDanceMimeType(absolutePath, mediaType);

  return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
};

const resolveLocalReferenceAbsolutePath = (rawValue = '') => {
  const normalizedValue = String(rawValue ?? '').trim();

  if (!normalizedValue) {
    return '';
  }

  if (isPublicUploadUrl(normalizedValue)) {
    return resolveUploadPath(publicUrlToRelativePath(normalizedValue));
  }

  if (/^(?:\.{1,2}\/)?uploads\//u.test(normalizedValue)) {
    return resolveUploadPath(normalizedValue.replace(/^(?:\.{1,2}\/)?uploads\//u, ''));
  }

  if (path.isAbsolute(normalizedValue)) {
    return normalizedValue;
  }

  return '';
};

const resolveReferenceEntryAbsolutePath = (entry) => {
  const directAbsolutePath = String(entry?.absolutePath ?? '').trim();

  if (directAbsolutePath) {
    return directAbsolutePath;
  }

  const relativePath = String(entry?.relativePath ?? '').trim();

  if (relativePath) {
    return resolveUploadPath(relativePath);
  }

  return resolveLocalReferenceAbsolutePath(String(entry?.url ?? '').trim());
};

const getReferenceVideoEntryIssues = async (entry) => {
  const absolutePath = resolveReferenceEntryAbsolutePath(entry);

  if (!absolutePath) {
    return [];
  }

  const metadata = await getVideoMetadata(absolutePath);
  const durationSeconds =
    Number.isFinite(Number(metadata.durationSecondsExact)) && Number(metadata.durationSecondsExact) > 0
      ? Number(metadata.durationSecondsExact)
      : Number.isFinite(Number(metadata.duration)) && Number(metadata.duration) > 0
        ? Number(metadata.duration)
        : null;
  const width = Number.isFinite(Number(metadata.width)) && Number(metadata.width) > 0 ? Number(metadata.width) : null;
  const height =
    Number.isFinite(Number(metadata.height)) && Number(metadata.height) > 0 ? Number(metadata.height) : null;
  const pixelCount = width !== null && height !== null ? width * height : null;
  const issues = [];

  if (durationSeconds !== null && durationSeconds < MIN_REFERENCE_VIDEO_DURATION_SECONDS) {
    issues.push(`duration<${MIN_REFERENCE_VIDEO_DURATION_SECONDS}s`);
  }

  if (width !== null && width < MIN_REFERENCE_VIDEO_DIMENSION) {
    issues.push(`width<${MIN_REFERENCE_VIDEO_DIMENSION}`);
  }

  if (height !== null && height < MIN_REFERENCE_VIDEO_DIMENSION) {
    issues.push(`height<${MIN_REFERENCE_VIDEO_DIMENSION}`);
  }

  if (pixelCount !== null && pixelCount < MIN_REFERENCE_VIDEO_PIXEL_COUNT) {
    issues.push(`pixelCount<${MIN_REFERENCE_VIDEO_PIXEL_COUNT}`);
  }

  return issues;
};

const resolveReferenceEntryUrl = async (entry, mediaType) => {
  if (entry.url) {
    if (isRemoteHttpUrl(entry.url) || isDataUrl(entry.url)) {
      return entry.url;
    }

    const localReferencePath = resolveLocalReferenceAbsolutePath(entry.url);

    if (localReferencePath) {
      return resolveSeedDanceDataUrl(localReferencePath, mediaType);
    }

    return entry.url;
  }

  const absolutePath = entry.absolutePath || (entry.relativePath ? resolveUploadPath(entry.relativePath) : '');

  if (!absolutePath) {
    return '';
  }

  return resolveSeedDanceDataUrl(absolutePath, mediaType);
};

const buildSeedDanceContentItems = async ({
  prompt,
  sourcePublicUrl = '',
  sourceAbsolutePath = '',
  referenceImages = [],
  referenceVideos = [],
  referenceAudios = []
}) => {
  const content = [
    {
      type: 'text',
      text: prompt
    }
  ];

  const normalizedReferenceImages = dedupeReferenceEntries(
    referenceImages.map((entry) => normalizeReferenceEntry(entry, 'reference_image')).filter(Boolean)
  ).slice(0, REFERENCE_IMAGE_LIMIT);
  const normalizedReferenceVideos = dedupeReferenceEntries(
    [
      ...(isWebUrl(sourcePublicUrl)
        ? [
            {
              url: String(sourcePublicUrl || '').trim(),
              absolutePath: String(sourceAbsolutePath || '').trim(),
              role: 'reference_video'
            }
          ]
        : []),
      ...referenceVideos.map((entry) => normalizeReferenceEntry(entry, 'reference_video')).filter(Boolean)
    ]
  );
  const normalizedReferenceAudios = dedupeReferenceEntries(
    referenceAudios.map((entry) => normalizeReferenceEntry(entry, 'reference_audio')).filter(Boolean)
  );

  for (const referenceImage of normalizedReferenceImages) {
    const resolvedUrl = await resolveReferenceEntryUrl(referenceImage, 'image');

    if (!resolvedUrl) {
      continue;
    }

    content.push({
      type: 'image_url',
      image_url: {
        url: resolvedUrl
      },
      role: referenceImage.role || 'reference_image'
    });
  }

  for (const referenceVideo of normalizedReferenceVideos) {
    const referenceVideoIssues = await getReferenceVideoEntryIssues(referenceVideo);

    if (referenceVideoIssues.length) {
      logger.warn('Skipping Seedance reference video because it does not satisfy provider minimum requirements.', {
        url: String(referenceVideo.url || '').trim(),
        relativePath: String(referenceVideo.relativePath || '').trim(),
        absolutePath: String(referenceVideo.absolutePath || '').trim(),
        minimumDurationSeconds: MIN_REFERENCE_VIDEO_DURATION_SECONDS,
        minimumDimension: MIN_REFERENCE_VIDEO_DIMENSION,
        minimumPixelCount: MIN_REFERENCE_VIDEO_PIXEL_COUNT,
        issues: referenceVideoIssues
      });
      continue;
    }

    const resolvedUrl = String(referenceVideo.url || '').trim();

    if (!isWebUrl(resolvedUrl)) {
      continue;
    }

    content.push({
      type: 'video_url',
      video_url: {
        url: resolvedUrl
      },
      role: referenceVideo.role || 'reference_video'
    });
  }

  for (const referenceAudio of normalizedReferenceAudios) {
    const resolvedUrl = await resolveReferenceEntryUrl(referenceAudio, 'audio');

    if (!resolvedUrl) {
      continue;
    }

    content.push({
      type: 'audio_url',
      audio_url: {
        url: resolvedUrl
      },
      role: referenceAudio.role || 'reference_audio'
    });
  }

  return content;
};

const buildSeedDanceRequestBody = async ({
  prompt,
  sourcePublicUrl = '',
  sourceAbsolutePath = '',
  referenceImages = [],
  referenceVideos = [],
  referenceAudios = [],
  model = env.SEED_DANCE_MODEL,
  ratio = env.SEED_DANCE_RATIO,
  duration = env.SEED_DANCE_DURATION_SECONDS,
  resolution = env.SEED_DANCE_RESOLUTION,
  generateAudio = env.SEED_DANCE_GENERATE_AUDIO,
  watermark = env.SEED_DANCE_WATERMARK
}) => {
  const providerDuration = resolveSeedDanceProviderDuration(duration);

  return {
    model,
    content: await buildSeedDanceContentItems({
      prompt,
      sourcePublicUrl,
      sourceAbsolutePath,
      referenceImages,
      referenceVideos,
      referenceAudios
    }),
    ratio,
    duration: providerDuration,
    resolution,
    generate_audio: generateAudio,
    watermark
  };
};

const fetchSeedDanceJson = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.SEED_DANCE_API_KEY}`,
      ...(init.headers ?? {})
    },
    signal: AbortSignal.timeout(env.EXTERNAL_REQUEST_TIMEOUT)
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Seed Dance request failed with status ${response.status}: ${responseText.slice(0, 240)}`);
  }

  return responseText ? JSON.parse(responseText) : {};
};

const unwrapSeedDancePayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  return payload.data && typeof payload.data === 'object' ? payload.data : payload;
};

const extractSeedDanceTaskId = (responsePayload) => {
  const payload = unwrapSeedDancePayload(responsePayload);

  return (
    payload?.id ??
    payload?.task_id ??
    payload?.taskId ??
    payload?.task?.id ??
    payload?.task?.task_id ??
    ''
  );
};

const extractRemoteVideoUrl = (responsePayload) => {
  const payload = unwrapSeedDancePayload(responsePayload);

  return (
    payload?.content?.video_url ??
    payload?.content?.file_url ??
    payload?.output?.video_url ??
    payload?.output?.file_url ??
    payload?.result?.video_url ??
    payload?.result?.file_url ??
    payload?.video_url ??
    payload?.file_url ??
    ''
  );
};

const extractSeedDanceTaskStatus = (responsePayload) => {
  const payload = unwrapSeedDancePayload(responsePayload);
  return String(payload?.status ?? '').trim().toLowerCase();
};

const getSeedDanceRemoteStatusLabel = (status = '') => {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  return SEED_DANCE_REMOTE_STATUS_LABELS[normalizedStatus] || '远端处理中';
};

const extractSeedDanceTaskTimestamps = (responsePayload) => {
  const payload = unwrapSeedDancePayload(responsePayload);

  return {
    createdAt:
      Number.isFinite(Number(payload?.created_at)) && Number(payload.created_at) > 0
        ? Number(payload.created_at)
        : null,
    updatedAt:
      Number.isFinite(Number(payload?.updated_at)) && Number(payload.updated_at) > 0
        ? Number(payload.updated_at)
        : null
  };
};

// Volcengine's task query API exposes task states such as queued/running/succeeded,
// but does not provide a numeric progress percentage. We estimate UI progress
// from those official states so users can still see motion while polling.
const estimateSeedDanceTaskProgress = ({ status = '', pollCount = 0, currentProgress = 0 }) => {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  const safeCurrentProgress = Number.isFinite(Number(currentProgress)) ? Number(currentProgress) : 0;

  if (['succeeded', 'completed', 'success'].includes(normalizedStatus)) {
    return Math.max(safeCurrentProgress, 97);
  }

  if (normalizedStatus === 'queued') {
    return Math.min(64, Math.max(safeCurrentProgress, 52 + pollCount * 3));
  }

  if (normalizedStatus === 'running') {
    return Math.min(94, Math.max(safeCurrentProgress, 68 + pollCount * 5));
  }

  if (['failed', 'expired', 'cancelled'].includes(normalizedStatus)) {
    return Math.max(safeCurrentProgress, 95);
  }

  return Math.max(safeCurrentProgress, 50);
};

const notifyRemoteProgress = async (onProgress, responsePayload, context = {}) => {
  if (typeof onProgress !== 'function') {
    return null;
  }

  const status = extractSeedDanceTaskStatus(responsePayload);
  const { createdAt, updatedAt } = extractSeedDanceTaskTimestamps(responsePayload);

  const progressPayload = {
    taskId: extractSeedDanceTaskId(responsePayload) || String(context.taskId ?? '').trim(),
    status,
    statusLabel: getSeedDanceRemoteStatusLabel(status),
    progress: estimateSeedDanceTaskProgress({
      status,
      pollCount: Number(context.pollCount ?? 0) || 0,
      currentProgress: Number(context.currentProgress ?? 0) || 0
    }),
    createdAt,
    updatedAt
  };

  await onProgress(progressPayload);
  return progressPayload;
};

const downloadRemoteVideoToUploads = async (remoteUrl, basename) => {
  const resolvedUrl = String(remoteUrl ?? '').trim();

  if (!resolvedUrl) {
    throw new Error('Seed Dance 未返回可下载的视频地址。');
  }

  const url = new URL(resolvedUrl);
  const extension = path.extname(url.pathname) || '.mp4';
  const relativePath = createOutputRelativePath('outputs', basename, extension);
  const absolutePath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absolutePath);

  const response = await fetch(resolvedUrl, {
    signal: AbortSignal.timeout(env.EXTERNAL_REQUEST_TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(`下载 Seed Dance 生成结果失败，状态码 ${response.status}。`);
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer());
  await writeFile(absolutePath, fileBuffer);

  return {
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    remoteUrl: resolvedUrl
  };
};

const trimDownloadedSeedDanceVideo = async ({
  downloadedAsset,
  basename,
  targetDurationSeconds
}) => {
  const safeTargetDurationSeconds = normalizeRequestedSeedDanceDuration(targetDurationSeconds);

  if (!downloadedAsset?.filePath || safeTargetDurationSeconds <= 0) {
    return downloadedAsset;
  }

  const trimmedAsset = await sliceVideoClip(
    resolveUploadPath(downloadedAsset.filePath),
    0,
    safeTargetDurationSeconds,
    {
      basename: `${basename}-trimmed`,
      directory: 'outputs'
    }
  );

  if (trimmedAsset?.filePath && trimmedAsset.filePath !== downloadedAsset.filePath) {
    await removeFileIfExists(downloadedAsset.filePath);
  }

  return {
    ...downloadedAsset,
    filePath: trimmedAsset?.filePath || downloadedAsset.filePath,
    fileUrl: trimmedAsset?.fileUrl || downloadedAsset.fileUrl
  };
};

const createRemoteGenerationTask = async ({
  prompt,
  sourcePublicUrl = '',
  sourceAbsolutePath = '',
  referenceImages = [],
  referenceVideos = [],
  referenceAudios = [],
  generateAudio = env.SEED_DANCE_GENERATE_AUDIO,
  ratio,
  duration
}) => {
  return fetchSeedDanceJson(resolveSeedDanceCreateEndpoint(), {
    method: 'POST',
    body: JSON.stringify(
      await buildSeedDanceRequestBody({
        prompt,
        sourcePublicUrl,
        sourceAbsolutePath,
        referenceImages,
        referenceVideos,
        referenceAudios,
        generateAudio,
        ratio,
        duration
      })
    )
  });
};

const isSeedDanceSensitiveImageError = (error) => {
  const message = String(error?.message ?? '').trim();
  return Boolean(message) && SEED_DANCE_SENSITIVE_IMAGE_ERROR_PATTERN.test(message);
};

const isFrameDerivedReferenceImage = (entry) => {
  const normalizedEntry = normalizeReferenceEntry(entry, 'reference_image');

  if (!normalizedEntry) {
    return false;
  }

  const candidates = [
    normalizedEntry.relativePath,
    normalizedEntry.absolutePath,
    normalizedEntry.url
  ]
    .filter(Boolean)
    .map((value) => String(value).replace(/\\/gu, '/').toLowerCase());

  return candidates.some((value) => /(^|\/)frames\//u.test(value) || value.includes('/frames/'));
};

const createRemoteGenerationTaskWithImageFallback = async ({
  prompt,
  sourcePublicUrl = '',
  sourceAbsolutePath = '',
  referenceImages = [],
  referenceVideos = [],
  referenceAudios = [],
  generateAudio = env.SEED_DANCE_GENERATE_AUDIO,
  ratio,
  duration
}) => {
  const attempts = [
    {
      referenceImages,
      fallbackReason: ''
    }
  ];
  const referenceImagesWithoutFrames = referenceImages.filter((entry) => !isFrameDerivedReferenceImage(entry));

  if (referenceImagesWithoutFrames.length < referenceImages.length) {
    attempts.push({
      referenceImages: referenceImagesWithoutFrames,
      fallbackReason: 'seedance_retried_without_frame_reference_images'
    });
  }

  if (referenceImages.length) {
    attempts.push({
      referenceImages: [],
      fallbackReason: 'seedance_retried_without_any_reference_images'
    });
  }

  let lastError = null;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    const attempt = attempts[attemptIndex];

    try {
      const createResult = await createRemoteGenerationTask({
        prompt,
        sourcePublicUrl,
        sourceAbsolutePath,
        referenceImages: attempt.referenceImages,
        referenceVideos,
        referenceAudios,
        generateAudio,
        ratio,
        duration
      });

      return {
        createResult,
        fallbackReason: attempts
          .slice(1, attemptIndex + 1)
          .map((item) => item.fallbackReason)
          .filter(Boolean)
          .join(';')
      };
    } catch (error) {
      lastError = error;

      if (!isSeedDanceSensitiveImageError(error) || attemptIndex === attempts.length - 1) {
        throw error;
      }

      logger.warn('Seedance rejected reference images because of sensitive-content screening, retrying with fewer images.', {
        message: error.message,
        attemptIndex,
        nextFallbackReason: attempts[attemptIndex + 1]?.fallbackReason || 'none',
        originalReferenceImageCount: referenceImages.length,
        nextReferenceImageCount: attempts[attemptIndex + 1]?.referenceImages?.length ?? 0
      });
    }
  }

  throw lastError ?? new Error('Seed Dance 创建远端任务失败。');
};

const waitForRemoteGeneration = async (taskId, { onProgress } = {}) => {
  const startedAt = Date.now();
  let pollCount = 0;
  let currentProgress = 0;

  while (Date.now() - startedAt <= env.SEED_DANCE_MAX_WAIT_MS) {
    const taskResponsePayload = await fetchSeedDanceJson(resolveSeedDanceTaskEndpoint(taskId), {
      method: 'GET'
    });
    const taskPayload = unwrapSeedDancePayload(taskResponsePayload);
    const status = extractSeedDanceTaskStatus(taskPayload);

    const progressPayload = await notifyRemoteProgress(onProgress, taskPayload, {
      taskId,
      pollCount,
      currentProgress
    });

    if (Number.isFinite(Number(progressPayload?.progress))) {
      currentProgress = Number(progressPayload.progress);
    }

    if (['succeeded', 'completed', 'success'].includes(status)) {
      return taskPayload;
    }

    if (['failed', 'expired', 'cancelled'].includes(status)) {
      const providerError =
        taskPayload?.error?.message ??
        taskPayload?.error?.code ??
        taskPayload?.error ??
        taskPayload?.message ??
        'Seed Dance 生成失败。';

      throw new Error(String(providerError));
    }

    pollCount += 1;
    await sleep(env.SEED_DANCE_POLL_INTERVAL_MS);
  }

  throw new Error('Seed Dance 生成超时，请稍后在任务列表中重试。');
};

const finalizeRemoteGenerationResult = async ({
  completedTask,
  taskId,
  basename,
  targetDurationSeconds
}) => {
  const requestedDuration = normalizeRequestedSeedDanceDuration(targetDurationSeconds);
  const providerDuration = resolveSeedDanceProviderDuration(targetDurationSeconds);
  let downloadedAsset = await downloadRemoteVideoToUploads(
    extractRemoteVideoUrl(completedTask),
    basename
  );

  if (requestedDuration + 0.05 < providerDuration) {
    downloadedAsset = await trimDownloadedSeedDanceVideo({
      downloadedAsset,
      basename,
      targetDurationSeconds: requestedDuration
    });
  }

  return {
    filePath: downloadedAsset.filePath,
    fileUrl: downloadedAsset.fileUrl,
    remoteUrl: downloadedAsset.remoteUrl,
    remoteTaskId: taskId,
    engine: 'seed-dance-remote',
    isMock: false,
    requestedDurationSeconds: requestedDuration,
    providerDurationSeconds: providerDuration,
    fallbackReason: '',
    providerError: ''
  };
};

const resumeRemoteGenerationTask = async ({
  remoteTaskId,
  basename = 'generated-segment',
  duration,
  onProgress
}) => {
  const safeRemoteTaskId = String(remoteTaskId ?? '').trim();

  if (!safeRemoteTaskId) {
    throw new Error('缺少远端任务 ID，无法恢复 Seed Dance 任务。');
  }

  const completedTask = await waitForRemoteGeneration(safeRemoteTaskId, {
    onProgress
  });

  return finalizeRemoteGenerationResult({
    completedTask,
    taskId: safeRemoteTaskId,
    basename,
    targetDurationSeconds: duration
  });
};

const generateSegment = async ({
  sourceAbsolutePath,
  sourcePublicUrl = '',
  prompt,
  basename = 'generated-segment',
  referenceImages = [],
  referenceVideos = [],
  referenceAudios = [],
  generateAudio = env.SEED_DANCE_GENERATE_AUDIO,
  ratio,
  duration,
  onProgress
}) => {
  const extension = path.extname(sourceAbsolutePath) || '.mp4';
  const allowMockFallback = shouldAllowSeedDanceMockFallback();
  const requestedDuration = normalizeRequestedSeedDanceDuration(duration);
  const providerDuration = resolveSeedDanceProviderDuration(duration);

  if (canUseRemoteSeedDance) {
    try {
      const {
        createResult,
        fallbackReason: imageFallbackReason
      } = await createRemoteGenerationTaskWithImageFallback({
        prompt,
        sourcePublicUrl,
        sourceAbsolutePath,
        referenceImages,
        referenceVideos,
        referenceAudios,
        generateAudio,
        ratio,
        duration: providerDuration
      });
      const taskId = extractSeedDanceTaskId(createResult);

      if (!taskId) {
        throw new Error('Seed Dance 未返回任务 ID。');
      }

      await onProgress?.({
        taskId,
        status: 'queued',
        statusLabel: getSeedDanceRemoteStatusLabel('queued'),
        progress: estimateSeedDanceTaskProgress({
          status: 'queued',
          pollCount: 0,
          currentProgress: 0
        }),
        createdAt: null,
        updatedAt: null
      });

      const completedTask = await waitForRemoteGeneration(taskId, {
        onProgress
      });
      const finalizedResult = await finalizeRemoteGenerationResult({
        completedTask,
        taskId,
        basename,
        targetDurationSeconds: requestedDuration
      });

      return {
        ...finalizedResult,
        fallbackReason: [
          !isWebUrl(sourcePublicUrl) ? 'seedance_skipped_non_public_reference_video' : '',
          imageFallbackReason
        ]
          .filter(Boolean)
          .join(';'),
        providerError: ''
      };
    } catch (error) {
      if (shouldUseStrictRemoteSeedDance() || !allowMockFallback) {
        throw error;
      }

      logger.warn('Remote Seed Dance generation failed, using local mock generation instead.', {
        message: error.message
      });
    }
  } else if (!allowMockFallback) {
    assertSeedDanceReady();
  }

  const relativePath = createOutputRelativePath('outputs', basename, extension);
  await duplicateToUploadPath(sourceAbsolutePath, relativePath);

  return {
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    engine: 'mock-copy',
    isMock: true,
    fallbackReason: canUseRemoteSeedDance ? 'remote_generation_failed' : 'missing_remote_config',
    providerError: canUseRemoteSeedDance ? 'Seed Dance 远端生成失败，已使用本地 mock 回退。' : getSeedDanceProviderStatus().reason
  };
};

export {
  buildSeedDanceContentItems,
  buildSeedDanceRequestBody,
  generateSegment,
  canUseRemoteSeedDance,
  getSeedDanceProviderStatus,
  assertSeedDanceReady,
  estimateSeedDanceTaskProgress,
  getSeedDanceRemoteStatusLabel,
  extractSeedDanceTaskStatus,
  resolveSeedDanceProviderDuration,
  resumeRemoteGenerationTask
};
