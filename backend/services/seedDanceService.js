import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import env from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';
import {
  createOutputRelativePath,
  duplicateToUploadPath,
  ensureParentDirectory,
  publicUrlToRelativePath,
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
    duration,
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

const createRemoteGenerationTask = async ({
  prompt,
  sourcePublicUrl = '',
  sourceAbsolutePath = '',
  referenceImages = [],
  referenceVideos = [],
  referenceAudios = [],
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
        duration
      })
    )
  });
};

const waitForRemoteGeneration = async (taskId) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= env.SEED_DANCE_MAX_WAIT_MS) {
    const taskResponsePayload = await fetchSeedDanceJson(resolveSeedDanceTaskEndpoint(taskId), {
      method: 'GET'
    });
    const taskPayload = unwrapSeedDancePayload(taskResponsePayload);
    const status = String(taskPayload.status ?? '').toLowerCase();

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

    await sleep(env.SEED_DANCE_POLL_INTERVAL_MS);
  }

  throw new Error('Seed Dance 生成超时，请稍后在任务列表中重试。');
};

const generateSegment = async ({
  sourceAbsolutePath,
  sourcePublicUrl = '',
  prompt,
  basename = 'generated-segment',
  referenceImages = [],
  referenceVideos = [],
  referenceAudios = [],
  duration
}) => {
  const extension = path.extname(sourceAbsolutePath) || '.mp4';
  const allowMockFallback = shouldAllowSeedDanceMockFallback();

  if (canUseRemoteSeedDance) {
    try {
      const createResult = await createRemoteGenerationTask({
        prompt,
        sourcePublicUrl,
        sourceAbsolutePath,
        referenceImages,
        referenceVideos,
        referenceAudios,
        duration
      });
      const taskId = extractSeedDanceTaskId(createResult);

      if (!taskId) {
        throw new Error('Seed Dance 未返回任务 ID。');
      }

      const completedTask = await waitForRemoteGeneration(taskId);
      const downloadedAsset = await downloadRemoteVideoToUploads(
        extractRemoteVideoUrl(completedTask),
        basename
      );

      return {
        filePath: downloadedAsset.filePath,
        fileUrl: downloadedAsset.fileUrl,
        remoteUrl: downloadedAsset.remoteUrl,
        remoteTaskId: taskId,
        engine: 'seed-dance-remote',
        isMock: false,
        fallbackReason: !isWebUrl(sourcePublicUrl)
          ? 'seedance_skipped_non_public_reference_video'
          : '',
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
  assertSeedDanceReady
};
