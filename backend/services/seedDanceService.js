import path from 'node:path';

import env from '../config/env.js';
import logger from '../utils/logger.js';
import {
  createOutputRelativePath,
  duplicateToUploadPath,
  toPublicUploadUrl
} from './fileService.js';

const canUseRemoteSeedDance = Boolean(env.SEED_DANCE_API_KEY && env.SEED_DANCE_API_BASE_URL);

const callRemoteSeedDance = async (payload) => {
  const response = await fetch(env.SEED_DANCE_API_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.SEED_DANCE_API_KEY}`
    },
    body: JSON.stringify({
      model: env.SEED_DANCE_MODEL,
      ...payload
    }),
    signal: AbortSignal.timeout(env.EXTERNAL_REQUEST_TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(`Seed Dance request failed with status ${response.status}`);
  }

  return response.json();
};

const generateSegment = async ({ sourceAbsolutePath, prompt, basename = 'generated-segment' }) => {
  const extension = path.extname(sourceAbsolutePath) || '.mp4';

  if (canUseRemoteSeedDance) {
    try {
      const remoteResponse = await callRemoteSeedDance({
        task: 'generate_segment',
        input: {
          prompt
        }
      });

      return {
        filePath: remoteResponse.filePath ?? null,
        fileUrl: remoteResponse.fileUrl ?? remoteResponse.file_url ?? null,
        engine: 'seed-dance-remote'
      };
    } catch (error) {
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
