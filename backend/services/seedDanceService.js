import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import env from '../config/env.js';
import logger from '../utils/logger.js';
import {
  createOutputRelativePath,
  duplicateToUploadPath,
  ensureParentDirectory,
  resolveUploadPath,
  toPublicUploadUrl
} from './fileService.js';

const canUseRemoteSeedDance = Boolean(env.SEED_DANCE_API_KEY && env.SEED_DANCE_API_BASE_URL);

const shouldUseStrictRemoteSeedDance = () => {
  return canUseRemoteSeedDance && env.SEED_DANCE_STRICT_REMOTE;
};

const sleep = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

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

const extractRemoteVideoUrl = (responsePayload) => {
  return (
    responsePayload?.content?.video_url ??
    responsePayload?.content?.file_url ??
    responsePayload?.video_url ??
    responsePayload?.file_url ??
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

const createRemoteGenerationTask = async ({ prompt, sourcePublicUrl = '' }) => {
  const content = [
    {
      type: 'text',
      text: prompt
    }
  ];

  if (/^https?:\/\//iu.test(sourcePublicUrl)) {
    content.push({
      type: 'video_url',
      video_url: {
        url: sourcePublicUrl
      },
      role: 'reference_video'
    });
  }

  return fetchSeedDanceJson(resolveSeedDanceCreateEndpoint(), {
    method: 'POST',
    body: JSON.stringify({
      model: env.SEED_DANCE_MODEL,
      content,
      ratio: env.SEED_DANCE_RATIO,
      duration: env.SEED_DANCE_DURATION_SECONDS,
      resolution: env.SEED_DANCE_RESOLUTION,
      generate_audio: env.SEED_DANCE_GENERATE_AUDIO,
      watermark: env.SEED_DANCE_WATERMARK
    })
  });
};

const waitForRemoteGeneration = async (taskId) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= env.SEED_DANCE_MAX_WAIT_MS) {
    const taskPayload = await fetchSeedDanceJson(resolveSeedDanceTaskEndpoint(taskId), {
      method: 'GET'
    });
    const status = String(taskPayload.status ?? '').toLowerCase();

    if (status === 'succeeded') {
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
  basename = 'generated-segment'
}) => {
  const extension = path.extname(sourceAbsolutePath) || '.mp4';

  if (canUseRemoteSeedDance) {
    try {
      const createResult = await createRemoteGenerationTask({
        prompt,
        sourcePublicUrl
      });
      const taskId = createResult.id ?? createResult.task_id ?? '';

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
        engine: 'seed-dance-remote'
      };
    } catch (error) {
      if (shouldUseStrictRemoteSeedDance()) {
        throw error;
      }

      logger.warn('Remote Seed Dance generation failed, using local mock generation instead.', {
        message: error.message
      });
    }
  }

  const relativePath = createOutputRelativePath('outputs', basename, extension);
  await duplicateToUploadPath(sourceAbsolutePath, relativePath);

  return {
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    engine: 'mock-copy'
  };
};

export { generateSegment };
