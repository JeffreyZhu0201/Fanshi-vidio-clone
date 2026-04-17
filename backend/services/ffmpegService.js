import os from 'node:os';
import path from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import logger from '../utils/logger.js';
import {
  createOutputRelativePath,
  duplicateToUploadPath,
  ensureParentDirectory,
  resolveUploadPath,
  toPublicUploadUrl
} from './fileService.js';

const execFileAsync = promisify(execFile);
const binaryAvailability = new Map();

const isBinaryAvailable = async (binaryName) => {
  if (binaryAvailability.has(binaryName)) {
    return binaryAvailability.get(binaryName);
  }

  const availabilityPromise = execFileAsync(binaryName, ['-version'])
    .then(() => true)
    .catch(() => false);

  binaryAvailability.set(binaryName, availabilityPromise);
  return availabilityPromise;
};

const getVideoMetadata = async (absolutePath) => {
  const ffprobeAvailable = await isBinaryAvailable('ffprobe');

  if (!ffprobeAvailable) {
    return {
      duration: null,
      durationSecondsExact: null,
      width: null,
      height: null,
      codec: null,
      engine: 'mock'
    };
  }

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=width,height,codec_name',
      '-of',
      'json',
      absolutePath
    ]);

    const parsed = JSON.parse(stdout);
    const videoStream = parsed.streams?.find((item) => item.width || item.height) ?? {};
    const rawDurationSeconds = parsed.format?.duration ? Number(parsed.format.duration) : null;

    return {
      duration: Number.isFinite(rawDurationSeconds) ? Math.round(rawDurationSeconds) : null,
      durationSecondsExact: Number.isFinite(rawDurationSeconds) ? rawDurationSeconds : null,
      width: videoStream.width ?? null,
      height: videoStream.height ?? null,
      codec: videoStream.codec_name ?? null,
      engine: 'ffprobe'
    };
  } catch (error) {
    logger.warn('Failed to extract video metadata with ffprobe, using fallback metadata.', {
      message: error.message,
      absolutePath
    });

    return {
      duration: null,
      durationSecondsExact: null,
      width: null,
      height: null,
      codec: null,
      engine: 'mock'
    };
  }
};

const splitVideo = async (absoluteSourcePath, timeAnchors, { basename = 'segment', onProgress } = {}) => {
  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');
  const extension = path.extname(absoluteSourcePath) || '.mp4';
  const segments = [];

  for (const [index, anchor] of timeAnchors.entries()) {
    const relativePath = createOutputRelativePath('segments', `${basename}-part-${index}`, extension);
    const absoluteTargetPath = resolveUploadPath(relativePath);
    await ensureParentDirectory(absoluteTargetPath);

    const duration = Math.max(0.1, Number(anchor.endTime) - Number(anchor.startTime));
    let engine = 'mock-copy';

    if (ffmpegAvailable) {
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-ss',
          String(anchor.startTime),
          '-i',
          absoluteSourcePath,
          '-t',
          String(duration),
          '-c',
          'copy',
          absoluteTargetPath
        ]);
        engine = 'ffmpeg';
      } catch (error) {
        logger.warn('FFmpeg split failed, falling back to file copy for development flow.', {
          message: error.message,
          absoluteSourcePath
        });
        await duplicateToUploadPath(absoluteSourcePath, relativePath);
      }
    } else {
      await duplicateToUploadPath(absoluteSourcePath, relativePath);
    }

    segments.push({
      segmentIndex: index,
      startTime: Number(anchor.startTime),
      endTime: Number(anchor.endTime),
      filePath: relativePath,
      fileUrl: toPublicUploadUrl(relativePath),
      engine
    });

    if (typeof onProgress === 'function') {
      onProgress(Math.round(((index + 1) / timeAnchors.length) * 100));
    }
  }

  return segments;
};

const mergeVideos = async (absoluteInputPaths, { basename = 'merged-video', onProgress } = {}) => {
  if (!absoluteInputPaths.length) {
    throw new Error('No input files available for merging.');
  }

  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');
  const extension = path.extname(absoluteInputPaths[0]) || '.mp4';
  const relativePath = createOutputRelativePath('outputs', basename, extension);
  const absoluteTargetPath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absoluteTargetPath);

  let engine = 'mock-copy';

  if (ffmpegAvailable && absoluteInputPaths.length > 1) {
    const listFilePath = path.join(os.tmpdir(), `fanshi-merge-${Date.now()}.txt`);

    try {
      const listContent = absoluteInputPaths
        .map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`)
        .join('\n');

      await writeFile(listFilePath, listContent, 'utf8');
      if (typeof onProgress === 'function') {
        onProgress(35);
      }

      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFilePath,
        '-c',
        'copy',
        absoluteTargetPath
      ]);

      engine = 'ffmpeg';
    } catch (error) {
      logger.warn('FFmpeg merge failed, falling back to mock merge strategy.', {
        message: error.message
      });
      await duplicateToUploadPath(absoluteInputPaths[0], relativePath);
    } finally {
      await rm(listFilePath, { force: true });
    }
  } else {
    await duplicateToUploadPath(absoluteInputPaths[0], relativePath);
  }

  if (typeof onProgress === 'function') {
    onProgress(100);
  }

  return {
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    engine
  };
};

export { getVideoMetadata, splitVideo, mergeVideos };
