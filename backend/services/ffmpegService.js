import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
const SLICE_VIDEO_TRANSCODE_CANDIDATES = [
  {
    engine: 'ffmpeg-slice-openh264',
    args: ['-c:v', 'libopenh264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
  },
  {
    engine: 'ffmpeg-slice-mpeg4',
    args: ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac']
  }
];
const ANALYSIS_PROXY_TRANSCODE_CANDIDATES = [
  {
    engine: 'ffmpeg-analysis-proxy-libx264',
    args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p']
  },
  {
    engine: 'ffmpeg-analysis-proxy-openh264',
    args: ['-c:v', 'libopenh264', '-b:v', '700k', '-pix_fmt', 'yuv420p']
  },
  {
    engine: 'ffmpeg-analysis-proxy-mpeg4',
    args: ['-c:v', 'mpeg4', '-q:v', '12']
  }
];
const MERGE_TRANSCODE_CANDIDATES = [
  {
    engine: 'ffmpeg-merge-libx264',
    args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']
  },
  {
    engine: 'ffmpeg-merge-mpeg4',
    args: ['-c:v', 'mpeg4', '-q:v', '4']
  }
];

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
      'format=duration:stream=codec_type,width,height,codec_name',
      '-of',
      'json',
      absolutePath
    ]);

    const parsed = JSON.parse(stdout);
    const videoStream = parsed.streams?.find((item) => item.width || item.height) ?? {};
    const audioStream = parsed.streams?.find((item) => item.codec_type === 'audio') ?? {};
    const rawDurationSeconds = parsed.format?.duration ? Number(parsed.format.duration) : null;

    return {
      duration: Number.isFinite(rawDurationSeconds) ? Math.round(rawDurationSeconds) : null,
      durationSecondsExact: Number.isFinite(rawDurationSeconds) ? rawDurationSeconds : null,
      width: videoStream.width ?? null,
      height: videoStream.height ?? null,
      codec: videoStream.codec_name ?? null,
      hasAudio: audioStream.codec_name ? true : false,
      audioCodec: audioStream.codec_name ?? null,
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
      hasAudio: null,
      audioCodec: null,
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

const sliceVideoClip = async (
  absoluteSourcePath,
  startTimeSeconds,
  endTimeSeconds,
  { basename = 'shot', directory = 'shots' } = {}
) => {
  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');
  const extension = path.extname(absoluteSourcePath) || '.mp4';
  const relativePath = createOutputRelativePath(directory, basename, extension);
  const absoluteTargetPath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absoluteTargetPath);

  const safeStartTime = Math.max(0, Number(startTimeSeconds) || 0);
  const safeEndTime = Math.max(safeStartTime + 0.1, Number(endTimeSeconds) || safeStartTime + 0.1);
  const duration = Number((safeEndTime - safeStartTime).toFixed(3));
  let engine = 'mock-copy';

  if (ffmpegAvailable) {
    let lastTranscodeError = null;

    for (const candidate of SLICE_VIDEO_TRANSCODE_CANDIDATES) {
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          absoluteSourcePath,
          '-ss',
          String(Number(safeStartTime.toFixed(3))),
          '-t',
          String(duration),
          ...candidate.args,
          '-movflags',
          '+faststart',
          absoluteTargetPath
        ]);
        engine = candidate.engine;
        lastTranscodeError = null;
        break;
      } catch (error) {
        lastTranscodeError = error;
      }
    }

    if (engine === 'mock-copy') {
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-ss',
          String(Number(safeStartTime.toFixed(3))),
          '-i',
          absoluteSourcePath,
          '-t',
          String(duration),
          '-c',
          'copy',
          absoluteTargetPath
        ]);
        engine = 'ffmpeg-slice-copy';
      } catch (error) {
        logger.warn('FFmpeg clip slicing failed, falling back to file copy for development flow.', {
          message: (lastTranscodeError || error).message,
          absoluteSourcePath,
          startTimeSeconds: safeStartTime,
          endTimeSeconds: safeEndTime
        });
        await duplicateToUploadPath(absoluteSourcePath, relativePath);
      }
    }
  } else {
    await duplicateToUploadPath(absoluteSourcePath, relativePath);
  }

  return {
    startTime: safeStartTime,
    endTime: safeEndTime,
    duration,
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    engine
  };
};

const extractAudioClip = async (
  absoluteSourcePath,
  startTimeSeconds,
  endTimeSeconds,
  { basename = 'shot-audio', directory = 'audio', extension = '.mp3' } = {}
) => {
  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');

  if (!ffmpegAvailable) {
    return null;
  }

  const safeStartTime = Math.max(0, Number(startTimeSeconds) || 0);
  const safeEndTime = Math.max(safeStartTime + 0.1, Number(endTimeSeconds) || safeStartTime + 0.1);
  const duration = Number((safeEndTime - safeStartTime).toFixed(3));
  const relativePath = createOutputRelativePath(directory, basename, extension);
  const absoluteTargetPath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absoluteTargetPath);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss',
      String(Number(safeStartTime.toFixed(3))),
      '-i',
      absoluteSourcePath,
      '-t',
      String(duration),
      '-vn',
      '-acodec',
      extension === '.wav' ? 'pcm_s16le' : 'libmp3lame',
      absoluteTargetPath
    ]);
  } catch (error) {
    logger.warn('FFmpeg audio extraction failed, skipping shot audio asset.', {
      message: error.message,
      absoluteSourcePath,
      startTimeSeconds: safeStartTime,
      endTimeSeconds: safeEndTime
    });
    return null;
  }

  return {
    startTime: safeStartTime,
    endTime: safeEndTime,
    duration,
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    engine: 'ffmpeg-audio-extract'
  };
};

const padAudioClipToDuration = async (
  absoluteSourcePath,
  targetDurationSeconds,
  { basename = 'shot-audio-padded', directory = 'audio', extension = '.mp3' } = {}
) => {
  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');

  if (!ffmpegAvailable) {
    return null;
  }

  const safeTargetDurationSeconds = Number(targetDurationSeconds);

  if (!Number.isFinite(safeTargetDurationSeconds) || safeTargetDurationSeconds <= 0) {
    return null;
  }

  const relativePath = createOutputRelativePath(directory, basename, extension);
  const absoluteTargetPath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absoluteTargetPath);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      absoluteSourcePath,
      '-af',
      'apad',
      '-t',
      String(Number(safeTargetDurationSeconds.toFixed(3))),
      '-acodec',
      extension === '.wav' ? 'pcm_s16le' : 'libmp3lame',
      absoluteTargetPath
    ]);
  } catch (error) {
    logger.warn('FFmpeg audio padding failed, keeping the original shot audio clip.', {
      message: error.message,
      absoluteSourcePath,
      targetDurationSeconds: safeTargetDurationSeconds
    });
    return null;
  }

  return {
    duration: Number(safeTargetDurationSeconds.toFixed(3)),
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    engine: 'ffmpeg-audio-pad'
  };
};

const buildAtempoFilterChain = (tempoMultiplier) => {
  const filters = [];
  let remainingMultiplier = Number(tempoMultiplier);

  if (!Number.isFinite(remainingMultiplier) || remainingMultiplier <= 0) {
    return '';
  }

  while (remainingMultiplier > 2) {
    filters.push('atempo=2');
    remainingMultiplier /= 2;
  }

  while (remainingMultiplier < 0.5) {
    filters.push('atempo=0.5');
    remainingMultiplier /= 0.5;
  }

  filters.push(`atempo=${Number(remainingMultiplier.toFixed(6))}`);
  return filters.join(',');
};

const compressAudioClipToDuration = async (
  absoluteSourcePath,
  targetDurationSeconds,
  {
    basename = 'shot-audio-fitted',
    directory = 'audio',
    extension = '.mp3',
    originalDurationSeconds = null
  } = {}
) => {
  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');

  if (!ffmpegAvailable) {
    return null;
  }

  const safeTargetDurationSeconds = Number(targetDurationSeconds);
  const safeOriginalDurationSeconds =
    Number.isFinite(Number(originalDurationSeconds)) && Number(originalDurationSeconds) > 0
      ? Number(originalDurationSeconds)
      : Number((await getVideoMetadata(absoluteSourcePath))?.durationSecondsExact ?? 0);

  if (
    !Number.isFinite(safeTargetDurationSeconds) ||
    safeTargetDurationSeconds <= 0 ||
    !Number.isFinite(safeOriginalDurationSeconds) ||
    safeOriginalDurationSeconds <= 0
  ) {
    return null;
  }

  const compressionRatio = safeOriginalDurationSeconds / safeTargetDurationSeconds;

  if (compressionRatio <= 1.001) {
    return {
      duration: Number(Math.min(safeOriginalDurationSeconds, safeTargetDurationSeconds).toFixed(3)),
      originalDuration: Number(safeOriginalDurationSeconds.toFixed(3)),
      compressionRatio: Number(compressionRatio.toFixed(3)),
      filePath: '',
      fileUrl: '',
      engine: 'audio-fit-skip'
    };
  }

  const atempoFilter = buildAtempoFilterChain(compressionRatio);

  if (!atempoFilter) {
    return null;
  }

  const relativePath = createOutputRelativePath(directory, basename, extension);
  const absoluteTargetPath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absoluteTargetPath);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      absoluteSourcePath,
      '-filter:a',
      atempoFilter,
      '-t',
      String(Number(safeTargetDurationSeconds.toFixed(3))),
      '-acodec',
      extension === '.wav' ? 'pcm_s16le' : 'libmp3lame',
      absoluteTargetPath
    ]);
  } catch (error) {
    logger.warn('FFmpeg audio compression failed.', {
      message: error.message,
      absoluteSourcePath,
      targetDurationSeconds: safeTargetDurationSeconds,
      originalDurationSeconds: safeOriginalDurationSeconds
    });
    return null;
  }

  return {
    duration: Number(safeTargetDurationSeconds.toFixed(3)),
    originalDuration: Number(safeOriginalDurationSeconds.toFixed(3)),
    compressionRatio: Number(compressionRatio.toFixed(3)),
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    engine: 'ffmpeg-audio-compress'
  };
};

const extractVideoFrame = async (
  absoluteSourcePath,
  timeSeconds,
  { basename = 'frame', extension = '.jpg' } = {}
) => {
  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');

  if (!ffmpegAvailable) {
    return null;
  }

  const safeTimeSeconds = Number(timeSeconds);

  if (!Number.isFinite(safeTimeSeconds) || safeTimeSeconds < 0) {
    return null;
  }

  const relativePath = createOutputRelativePath('frames', basename, extension);
  const absoluteTargetPath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absoluteTargetPath);

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss',
      String(Number(safeTimeSeconds.toFixed(2))),
      '-i',
      absoluteSourcePath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      absoluteTargetPath
    ]);

    return {
      filePath: relativePath,
      fileUrl: toPublicUploadUrl(relativePath),
      engine: 'ffmpeg-frame'
    };
  } catch (error) {
    logger.warn('FFmpeg frame extraction failed.', {
      message: error.message,
      absoluteSourcePath,
      timeSeconds: safeTimeSeconds
    });

    return null;
  }
};

const transcodeVideoForAnalysis = async (
  absoluteSourcePath,
  {
    basename = 'analysis-proxy',
    directory = 'analysis-proxies',
    extension = '.mp4',
    maxLongSide = 720,
    maxFps = 6,
    includeAudio = true,
    audioBitrateKbps = 48
  } = {}
) => {
  const ffmpegAvailable = await isBinaryAvailable('ffmpeg');

  if (!ffmpegAvailable) {
    return null;
  }

  const safeMaxLongSide = Math.max(240, Number(maxLongSide) || 720);
  const safeMaxFps = Math.max(1, Number(maxFps) || 6);
  const safeAudioBitrateKbps = Math.max(24, Number(audioBitrateKbps) || 48);
  const relativePath = createOutputRelativePath(directory, basename, extension);
  const absoluteTargetPath = resolveUploadPath(relativePath);
  const videoFilter = [
    `scale=${safeMaxLongSide}:${safeMaxLongSide}:force_original_aspect_ratio=decrease`,
    `fps=${safeMaxFps}`,
    'pad=ceil(iw/2)*2:ceil(ih/2)*2'
  ].join(',');
  await ensureParentDirectory(absoluteTargetPath);

  let lastError = null;

  for (const candidate of ANALYSIS_PROXY_TRANSCODE_CANDIDATES) {
    try {
      const commandArgs = [
        '-y',
        '-i',
        absoluteSourcePath,
        '-map',
        '0:v:0',
        '-vf',
        videoFilter,
        ...candidate.args
      ];

      if (includeAudio) {
        commandArgs.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', `${safeAudioBitrateKbps}k`, '-ac', '1', '-ar', '32000');
      } else {
        commandArgs.push('-an');
      }

      commandArgs.push('-movflags', '+faststart', absoluteTargetPath);

      await execFileAsync('ffmpeg', commandArgs);

      return {
        absolutePath: absoluteTargetPath,
        filePath: relativePath,
        fileUrl: toPublicUploadUrl(relativePath),
        engine: candidate.engine,
        includeAudio: Boolean(includeAudio)
      };
    } catch (error) {
      lastError = error;
    }
  }

  logger.warn('FFmpeg analysis proxy transcode failed, falling back to original source video.', {
    message: lastError?.message || 'unknown',
    absoluteSourcePath
  });
  await rm(absoluteTargetPath, { force: true });
  return null;
};

const transcodeVideoForMerge = async (
  absoluteSourcePath,
  absoluteTargetPath,
  { forceSilentAudio = false, hasAudio = null } = {}
) => {
  let lastError = null;

  for (const candidate of MERGE_TRANSCODE_CANDIDATES) {
    try {
      const commandArgs = ['-y', '-fflags', '+genpts', '-i', absoluteSourcePath];

      if (forceSilentAudio) {
        commandArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      }

      commandArgs.push('-map', '0:v:0');
      commandArgs.push('-map', forceSilentAudio ? '1:a:0' : '0:a:0?');
      commandArgs.push('-vf', 'setpts=PTS-STARTPTS,format=yuv420p');
      commandArgs.push(...candidate.args);
      commandArgs.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');

      if (forceSilentAudio) {
        commandArgs.push('-shortest');
      } else if (hasAudio === true) {
        commandArgs.push('-af', 'aresample=async=1:first_pts=0');
      }

      commandArgs.push('-movflags', '+faststart', absoluteTargetPath);

      await execFileAsync('ffmpeg', commandArgs);

      return {
        engine: candidate.engine,
        hasAudio: true
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('FFmpeg merge transcode failed.');
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

  if (absoluteInputPaths.length === 1) {
    await duplicateToUploadPath(absoluteInputPaths[0], relativePath);

    if (typeof onProgress === 'function') {
      onProgress(100);
    }

    return {
      filePath: relativePath,
      fileUrl: toPublicUploadUrl(relativePath),
      engine: 'single-input-copy'
    };
  }

  if (!ffmpegAvailable) {
    throw new Error('FFmpeg is required to merge multiple videos, but it is not available.');
  }

  const listFilePath = path.join(os.tmpdir(), `fanshi-merge-${Date.now()}.txt`);
  const normalizedTempDir = await mkdtemp(path.join(os.tmpdir(), 'fanshi-merge-inputs-'));

  try {
    const normalizedInputPaths = [];

    for (const [index, filePath] of absoluteInputPaths.entries()) {
      const metadata = await getVideoMetadata(filePath);
      const normalizedInputPath = path.join(normalizedTempDir, `normalized-${index}.mp4`);

      await transcodeVideoForMerge(filePath, normalizedInputPath, {
        forceSilentAudio: metadata.hasAudio === false,
        hasAudio: metadata.hasAudio
      });

      normalizedInputPaths.push(normalizedInputPath);

      if (typeof onProgress === 'function') {
        onProgress(Math.max(10, Math.round(((index + 1) / absoluteInputPaths.length) * 30)));
      }
    }

    const listContent = normalizedInputPaths
      .map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`)
      .join('\n');

    await writeFile(listFilePath, listContent, 'utf8');
    if (typeof onProgress === 'function') {
      onProgress(40);
    }

    let mergeCompleted = false;
    let lastMergeError = null;

    for (const candidate of MERGE_TRANSCODE_CANDIDATES) {
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-fflags',
          '+genpts',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listFilePath,
          '-vsync',
          'cfr',
          ...candidate.args,
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-movflags',
          '+faststart',
          absoluteTargetPath
        ]);
        mergeCompleted = true;
        break;
      } catch (error) {
        lastMergeError = error;
      }
    }

    if (!mergeCompleted) {
      throw lastMergeError ?? new Error('FFmpeg merge transcode failed.');
    }
  } catch (error) {
    logger.warn('FFmpeg merge failed; refusing to fake a merged result by copying only the first input.', {
      message: error.message,
      inputCount: absoluteInputPaths.length
    });
    await rm(absoluteTargetPath, { force: true });
    throw new Error('FFmpeg merge failed, so no merged output was produced.');
  } finally {
    await rm(listFilePath, { force: true });
    await rm(normalizedTempDir, { recursive: true, force: true });
  }

  if (typeof onProgress === 'function') {
    onProgress(100);
  }

  return {
    filePath: relativePath,
    fileUrl: toPublicUploadUrl(relativePath),
    engine: 'ffmpeg'
  };
};

export {
  getVideoMetadata,
  splitVideo,
  sliceVideoClip,
  extractAudioClip,
  compressAudioClipToDuration,
  padAudioClipToDuration,
  mergeVideos,
  extractVideoFrame,
  transcodeVideoForAnalysis
};
