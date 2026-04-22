import { existsSync } from 'node:fs';

import { extractVideoFrame, sliceVideoClip } from './ffmpegService.js';
import { removeFileIfExists, resolveUploadPath } from './fileService.js';
import logger from '../utils/logger.js';

const normalizeOptionalNumber = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Number(parsedValue.toFixed(2));
};

const clampNumber = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};

const getShotTiming = (shot, segmentStartTime, segmentEndTime) => {
  const safeSegmentStartTime = Number(segmentStartTime) || 0;
  const safeSegmentEndTime = Math.max(
    safeSegmentStartTime + 0.3,
    Number(segmentEndTime) || safeSegmentStartTime + 0.3
  );
  const rawStartTime = normalizeOptionalNumber(shot?.startTime) ?? safeSegmentStartTime;
  const clampedStartTime = clampNumber(rawStartTime, safeSegmentStartTime, safeSegmentEndTime - 0.3);
  const rawEndTime = normalizeOptionalNumber(shot?.endTime) ?? safeSegmentEndTime;
  const clampedEndTime = clampNumber(rawEndTime, clampedStartTime + 0.3, safeSegmentEndTime);
  const safeEndTime = clampedEndTime > clampedStartTime
    ? clampedEndTime
    : Number(Math.min(safeSegmentEndTime, clampedStartTime + 0.3).toFixed(2));
  const localStartTime = Number(Math.max(0, clampedStartTime - safeSegmentStartTime).toFixed(2));
  const localEndTime = Number(Math.max(localStartTime + 0.3, safeEndTime - safeSegmentStartTime).toFixed(2));
  const durationSeconds = Number(Math.max(0.3, safeEndTime - clampedStartTime).toFixed(2));

  return {
    startTime: Number(clampedStartTime.toFixed(2)),
    endTime: Number(safeEndTime.toFixed(2)),
    localStartTime,
    localEndTime,
    durationSeconds
  };
};

const getShotRepresentativeFrameTiming = ({
  shot,
  shotTiming,
  segmentStartTime
}) => {
  const desiredAbsoluteFrameTime =
    normalizeOptionalNumber(shot?.representativeFrameTime) ??
    Number((shotTiming.startTime + shotTiming.durationSeconds / 2).toFixed(2));
  const clampedAbsoluteFrameTime = clampNumber(
    desiredAbsoluteFrameTime,
    shotTiming.startTime,
    shotTiming.endTime
  );
  const sourceLocalFrameTime = Number(
    clampNumber(
      clampedAbsoluteFrameTime - Number(segmentStartTime || 0),
      shotTiming.localStartTime,
      shotTiming.localEndTime
    ).toFixed(2)
  );
  const clipLocalFrameTime = Number(
    clampNumber(
      clampedAbsoluteFrameTime - shotTiming.startTime,
      0,
      Math.max(0, shotTiming.durationSeconds - 0.05)
    ).toFixed(2)
  );

  return {
    representativeFrameTime: Number(clampedAbsoluteFrameTime.toFixed(2)),
    sourceLocalFrameTime,
    clipLocalFrameTime
  };
};

const buildShotAssetBasename = (segment, shot, shotIndex) => {
  const rawSegmentId = String(segment?.id ?? segment?.segmentIndex ?? 'segment').trim() || 'segment';
  const rawShotId = String(shot?.id ?? `shot_${shotIndex + 1}`).trim() || `shot_${shotIndex + 1}`;
  const sanitize = (value) =>
    value.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'asset';

  return `segment-${sanitize(rawSegmentId)}-${sanitize(rawShotId)}`;
};

const isClippedSourceEngine = (engine = '') => {
  return String(engine).trim().startsWith('ffmpeg-slice');
};

const uploadAssetExists = (relativePath = '') => {
  const normalizedPath = String(relativePath ?? '').trim();

  if (!normalizedPath) {
    return false;
  }

  return existsSync(resolveUploadPath(normalizedPath));
};

const cleanupShotAssets = async (shots = []) => {
  const assetPaths = shots.flatMap((shot) => [
    String(shot?.sourceFilePath ?? '').trim(),
    String(shot?.representativeFrameImagePath ?? '').trim()
  ]).filter(Boolean);

  await Promise.allSettled(assetPaths.map((assetPath) => removeFileIfExists(assetPath)));
};

const rebuildShotAssetsForSegment = async ({
  segment,
  shots,
  previousShots = [],
  cleanupExisting = true
}) => {
  if (!Array.isArray(shots) || !shots.length) {
    return [];
  }

  if (!segment?.filePath) {
    return shots;
  }

  if (cleanupExisting && Array.isArray(previousShots) && previousShots.length) {
    await cleanupShotAssets(previousShots);
  }

  const segmentStartTime = Number(segment.startTime) || 0;
  const segmentEndTime = Number(segment.endTime) || segmentStartTime + 0.3;
  const segmentAbsolutePath = resolveUploadPath(segment.filePath);

  return Promise.all(
    shots.map(async (shot, shotIndex) => {
      const shotTiming = getShotTiming(shot, segmentStartTime, segmentEndTime);
      const frameTiming = getShotRepresentativeFrameTiming({
        shot,
        shotTiming,
        segmentStartTime
      });
      const basename = buildShotAssetBasename(segment, shot, shotIndex);

      let sourceClip = null;
      let representativeFrame = null;

      try {
        sourceClip = await sliceVideoClip(segmentAbsolutePath, shotTiming.localStartTime, shotTiming.localEndTime, {
          basename: `${basename}-source`
        });
      } catch (error) {
        logger.warn('Failed to build persistent shot source clip.', {
          message: error.message,
          segmentId: segment?.id,
          shotId: shot?.id
        });
      }

      const usesClippedSource = isClippedSourceEngine(sourceClip?.engine);

      try {
        representativeFrame = await extractVideoFrame(
          sourceClip?.filePath ? resolveUploadPath(sourceClip.filePath) : segmentAbsolutePath,
          sourceClip?.filePath && usesClippedSource ? frameTiming.clipLocalFrameTime : frameTiming.sourceLocalFrameTime,
          {
            basename: `${basename}-representative-frame`
          }
        );
      } catch (error) {
        logger.warn('Failed to build persistent representative frame for shot.', {
          message: error.message,
          segmentId: segment?.id,
          shotId: shot?.id
        });
      }

      return {
        ...shot,
        startTime: shotTiming.startTime,
        endTime: shotTiming.endTime,
        representativeFrameTime: frameTiming.representativeFrameTime,
        sourceFilePath: String(sourceClip?.filePath ?? '').trim(),
        sourceFileUrl: String(sourceClip?.fileUrl ?? '').trim(),
        sourceLocalStartTime: shotTiming.localStartTime,
        sourceLocalEndTime: shotTiming.localEndTime,
        representativeFrameImagePath: String(representativeFrame?.filePath ?? '').trim(),
        representativeFrameImageUrl: String(representativeFrame?.fileUrl ?? '').trim(),
        representativeFrameActualTime:
          sourceClip?.filePath && usesClippedSource ? frameTiming.clipLocalFrameTime : frameTiming.sourceLocalFrameTime
      };
    })
  );
};

const shotAssetsNeedRebuild = (shots = []) => {
  if (!Array.isArray(shots) || !shots.length) {
    return false;
  }

  return shots.some((shot) => {
    const sourceFilePath = String(shot?.sourceFilePath ?? '').trim();
    const sourceFileUrl = String(shot?.sourceFileUrl ?? '').trim();
    const representativeFrameImagePath = String(shot?.representativeFrameImagePath ?? '').trim();
    const representativeFrameImageUrl = String(shot?.representativeFrameImageUrl ?? '').trim();
    const representativeFrameActualTime = normalizeOptionalNumber(shot?.representativeFrameActualTime);

    return (
      !sourceFilePath ||
      !sourceFileUrl ||
      !representativeFrameImagePath ||
      !representativeFrameImageUrl ||
      representativeFrameActualTime === null ||
      !uploadAssetExists(sourceFilePath) ||
      !uploadAssetExists(representativeFrameImagePath)
    );
  });
};

export { rebuildShotAssetsForSegment, shotAssetsNeedRebuild };
