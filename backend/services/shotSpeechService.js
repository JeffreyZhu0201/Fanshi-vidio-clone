import { writeFile } from 'node:fs/promises';

import {
  DEFAULT_STYLE_MODE,
  getEditableStyleTemplateDefaults,
  normalizeStyleMode
} from '../../shared/styleTemplates.js';
import { extractAudioClip } from './ffmpegService.js';
import {
  createOutputRelativePath,
  ensureParentDirectory,
  removeFileIfExists,
  resolveUploadPath,
  toPublicUploadUrl
} from './fileService.js';
import logger from '../utils/logger.js';

const DEFAULT_ANALYSIS_OPTIONS = Object.freeze({
  extractSubtitles: true,
  parseAudio: true,
  styleMode: DEFAULT_STYLE_MODE,
  styleTemplates: Object.freeze(getEditableStyleTemplateDefaults())
});

const normalizeAnalysisOptions = (value = null) => {
  const nextStyleTemplates = getEditableStyleTemplateDefaults();
  const inputStyleTemplates = value?.styleTemplates ?? value?.style_templates ?? null;

  Object.keys(nextStyleTemplates).forEach((styleMode) => {
    Object.keys(nextStyleTemplates[styleMode]).forEach((templateKey) => {
      if (inputStyleTemplates?.[styleMode] && Object.prototype.hasOwnProperty.call(inputStyleTemplates[styleMode], templateKey)) {
        nextStyleTemplates[styleMode][templateKey] = String(inputStyleTemplates[styleMode][templateKey] ?? '');
      }
    });
  });

  return {
    extractSubtitles:
      typeof value?.extractSubtitles === 'boolean' || typeof value?.extract_subtitles === 'boolean'
        ? Boolean(value?.extractSubtitles ?? value?.extract_subtitles)
        : DEFAULT_ANALYSIS_OPTIONS.extractSubtitles,
    parseAudio:
      typeof value?.parseAudio === 'boolean' || typeof value?.parse_audio === 'boolean'
        ? Boolean(value?.parseAudio ?? value?.parse_audio)
        : DEFAULT_ANALYSIS_OPTIONS.parseAudio,
    styleMode: normalizeStyleMode(value?.styleMode ?? value?.style_mode ?? DEFAULT_ANALYSIS_OPTIONS.styleMode),
    styleTemplates: nextStyleTemplates
  };
};

const isSpeechAnalysisEnabled = (analysisOptions = null) => {
  const normalizedOptions = normalizeAnalysisOptions(analysisOptions);
  return normalizedOptions.extractSubtitles || normalizedOptions.parseAudio;
};

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

const normalizeSubtitleLines = (subtitleLines = [], durationSeconds = 0) => {
  const safeDurationSeconds = Math.max(0.3, Number(durationSeconds) || 0.3);

  return (Array.isArray(subtitleLines) ? subtitleLines : [])
    .map((line, index) => {
      const rawStartTime = normalizeOptionalNumber(line?.startTime ?? line?.start_time) ?? 0;
      const rawEndTime = normalizeOptionalNumber(line?.endTime ?? line?.end_time) ?? rawStartTime + 0.2;
      const startTime = clampNumber(rawStartTime, 0, safeDurationSeconds);
      const endTime = clampNumber(rawEndTime, startTime + 0.1, safeDurationSeconds);
      const text = String(line?.text ?? '').trim();

      if (!text) {
        return null;
      }

      return {
        id: String(line?.id ?? `subtitle_${index + 1}`),
        startTime: Number(startTime.toFixed(2)),
        endTime: Number(endTime.toFixed(2)),
        text
      };
    })
    .filter(Boolean);
};

const buildTranscriptFromSubtitleLines = (subtitleLines = []) => {
  return normalizeSubtitleLines(subtitleLines, 9999)
    .map((line) => line.text)
    .join(' ')
    .trim();
};

const createEmptySpeech = ({ extractionStatus = 'idle', extractionError = '', sourceOfTruth = 'extracted' } = {}) => {
  return {
    transcript: '',
    subtitleLines: [],
    speechStyle: '',
    hasDialogue: false,
    extractionStatus,
    extractionError: String(extractionError ?? '').trim(),
    subtitleFilePath: '',
    subtitleFileUrl: '',
    sourceOfTruth
  };
};

const normalizeShotSpeech = (speech = null, { durationSeconds = 0, fallbackStatus = 'completed' } = {}) => {
  if (!speech || typeof speech !== 'object') {
    return createEmptySpeech({
      extractionStatus: fallbackStatus === 'completed' ? 'completed' : fallbackStatus
    });
  }

  const subtitleLines = normalizeSubtitleLines(
    speech.subtitleLines ?? speech.subtitle_lines ?? [],
    durationSeconds
  );
  const transcript =
    String(speech.transcript ?? '').trim() || buildTranscriptFromSubtitleLines(subtitleLines);
  const sourceOfTruth = String(speech.sourceOfTruth ?? speech.source_of_truth ?? 'extracted').trim() || 'extracted';
  const extractionStatus = String(
    speech.extractionStatus ?? speech.extraction_status ?? (subtitleLines.length || transcript ? 'completed' : fallbackStatus)
  )
    .trim()
    .toLowerCase();

  return {
    transcript,
    subtitleLines,
    speechStyle: String(speech.speechStyle ?? speech.speech_style ?? '').trim(),
    hasDialogue:
      typeof speech.hasDialogue === 'boolean'
        ? speech.hasDialogue
        : typeof speech.has_dialogue === 'boolean'
          ? speech.has_dialogue
          : Boolean(transcript || subtitleLines.length),
    extractionStatus: extractionStatus || fallbackStatus,
    extractionError: String(speech.extractionError ?? speech.extraction_error ?? '').trim(),
    subtitleFilePath: String(speech.subtitleFilePath ?? speech.subtitle_file_path ?? '').trim(),
    subtitleFileUrl: String(speech.subtitleFileUrl ?? speech.subtitle_file_url ?? '').trim(),
    sourceOfTruth
  };
};

const toSrtTimestamp = (value) => {
  const safeValue = Math.max(0, Number(value) || 0);
  const hours = Math.floor(safeValue / 3600);
  const minutes = Math.floor((safeValue % 3600) / 60);
  const seconds = Math.floor(safeValue % 60);
  const milliseconds = Math.round((safeValue - Math.floor(safeValue)) * 1000);

  return [hours, minutes, seconds]
    .map((item) => String(item).padStart(2, '0'))
    .join(':')
    .concat(',', String(milliseconds).padStart(3, '0'));
};

const buildSrtContent = (subtitleLines = []) => {
  return normalizeSubtitleLines(subtitleLines, 9999)
    .map((line, index) => {
      return [
        String(index + 1),
        `${toSrtTimestamp(line.startTime)} --> ${toSrtTimestamp(line.endTime)}`,
        line.text
      ].join('\n');
    })
    .join('\n\n');
};

const buildSubtitleBasename = (segment, shot, shotIndex = 0) => {
  const rawSegmentId = String(segment?.id ?? segment?.segmentIndex ?? 'segment').trim() || 'segment';
  const rawShotId = String(shot?.id ?? `shot_${shotIndex + 1}`).trim() || `shot_${shotIndex + 1}`;
  const sanitize = (value) =>
    value.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'asset';

  return `segment-${sanitize(rawSegmentId)}-${sanitize(rawShotId)}`;
};

const persistShotSubtitleFile = async ({
  segment,
  shot,
  shotIndex = 0,
  speech = null,
  previousSpeech = null
}) => {
  const normalizedSpeech = normalizeShotSpeech(speech, {
    durationSeconds: Number(shot?.durationSeconds ?? 0)
  });
  const subtitleLines = normalizedSpeech.subtitleLines;
  const previousSubtitlePath = String(
    previousSpeech?.subtitleFilePath ?? previousSpeech?.subtitle_file_path ?? ''
  ).trim();

  if (!subtitleLines.length) {
    if (previousSubtitlePath) {
      await removeFileIfExists(previousSubtitlePath);
    }

    return {
      ...normalizedSpeech,
      subtitleFilePath: '',
      subtitleFileUrl: ''
    };
  }

  const relativePath = createOutputRelativePath('subtitles', `${buildSubtitleBasename(segment, shot, shotIndex)}-speech`, '.srt');
  const absolutePath = resolveUploadPath(relativePath);
  await ensureParentDirectory(absolutePath);
  await writeFile(absolutePath, buildSrtContent(subtitleLines), 'utf8');

  if (previousSubtitlePath && previousSubtitlePath !== relativePath) {
    await removeFileIfExists(previousSubtitlePath);
  }

  return {
    ...normalizedSpeech,
    subtitleFilePath: relativePath,
    subtitleFileUrl: toPublicUploadUrl(relativePath)
  };
};

const cleanupShotSpeechAssets = async (shots = []) => {
  const assetPaths = shots.flatMap((shot) => [
    String(shot?.sourceAudioFilePath ?? '').trim(),
    String(shot?.speech?.subtitleFilePath ?? shot?.speech?.subtitle_file_path ?? '').trim()
  ]).filter(Boolean);

  await Promise.allSettled(assetPaths.map((assetPath) => removeFileIfExists(assetPath)));
};

const rebuildShotSpeechAssetsForSegment = async ({
  segment,
  shots = [],
  previousShots = [],
  analysisOptions = null,
  cleanupExisting = false
}) => {
  const normalizedOptions = normalizeAnalysisOptions(analysisOptions);
  const speechEnabled = isSpeechAnalysisEnabled(normalizedOptions);

  if (!Array.isArray(shots) || !shots.length) {
    return [];
  }

  if (cleanupExisting && Array.isArray(previousShots) && previousShots.length) {
    await cleanupShotSpeechAssets(previousShots);
  }

  return Promise.all(
    shots.map(async (shot, shotIndex) => {
      const previousShot = Array.isArray(previousShots)
        ? previousShots.find((candidate) => String(candidate?.id ?? '').trim() === String(shot?.id ?? '').trim()) ?? null
        : null;
      let sourceAudio = null;

      if (speechEnabled && shot?.sourceFilePath) {
        try {
          sourceAudio = await extractAudioClip(resolveUploadPath(shot.sourceFilePath), 0, Number(shot.durationSeconds ?? 0), {
            basename: `${buildSubtitleBasename(segment, shot, shotIndex)}-source-audio`
          });
        } catch (error) {
          logger.warn('Failed to build persistent shot source audio clip.', {
            message: error.message,
            segmentId: segment?.id,
            shotId: shot?.id
          });
        }
      }

      if (!speechEnabled) {
        return {
          ...shot,
          sourceAudioFilePath: '',
          sourceAudioFileUrl: '',
          speech: createEmptySpeech()
        };
      }

      const existingSpeech = normalizeShotSpeech(shot?.speech ?? null, {
        durationSeconds: Number(shot?.durationSeconds ?? 0),
        fallbackStatus: 'idle'
      });
      const previousSpeech = normalizeShotSpeech(previousShot?.speech ?? null, {
        durationSeconds: Number(shot?.durationSeconds ?? 0),
        fallbackStatus: 'idle'
      });
      const wholeVideoSpeech =
        existingSpeech.sourceOfTruth === 'edited_text' ||
        existingSpeech.transcript ||
        existingSpeech.subtitleLines.length ||
        existingSpeech.hasDialogue
          ? existingSpeech
          : previousSpeech.sourceOfTruth === 'edited_text' ||
              previousSpeech.transcript ||
              previousSpeech.subtitleLines.length ||
              previousSpeech.hasDialogue
            ? previousSpeech
            : createEmptySpeech({
                extractionStatus: 'idle'
              });
      const persistedSpeech = await persistShotSubtitleFile({
        segment,
        shot,
        shotIndex,
        speech: {
          ...wholeVideoSpeech,
          extractionStatus:
            wholeVideoSpeech.extractionStatus ||
            (wholeVideoSpeech.transcript || wholeVideoSpeech.subtitleLines.length || wholeVideoSpeech.hasDialogue
              ? 'completed'
              : 'idle'),
          extractionError:
            wholeVideoSpeech.extractionError ||
            ''
        },
        previousSpeech: previousShot?.speech ?? null
      });

      return {
        ...shot,
        sourceAudioFilePath: String(sourceAudio?.filePath ?? '').trim(),
        sourceAudioFileUrl: String(sourceAudio?.fileUrl ?? '').trim(),
        speech: persistedSpeech
      };
    })
  );
};

const persistShotSpeechEditsForSegment = async ({
  segment,
  shots = [],
  previousShots = [],
  analysisOptions = null
}) => {
  const speechEnabled = isSpeechAnalysisEnabled(analysisOptions);

  return Promise.all(
    (Array.isArray(shots) ? shots : []).map(async (shot, shotIndex) => {
      const previousShot = Array.isArray(previousShots)
        ? previousShots.find((candidate) => String(candidate?.id ?? '').trim() === String(shot?.id ?? '').trim()) ?? null
        : null;

      if (!speechEnabled) {
        if (previousShot?.speech?.subtitleFilePath) {
          await removeFileIfExists(previousShot.speech.subtitleFilePath);
        }

        return {
          ...shot,
          sourceAudioFilePath: '',
          sourceAudioFileUrl: '',
          speech: createEmptySpeech()
        };
      }

      const normalizedSpeech = normalizeShotSpeech(shot?.speech ?? previousShot?.speech, {
        durationSeconds: Number(shot?.durationSeconds ?? 0),
        fallbackStatus: 'completed'
      });
      const persistedSpeech = await persistShotSubtitleFile({
        segment,
        shot,
        shotIndex,
        speech: {
          ...normalizedSpeech,
          sourceOfTruth:
            normalizedSpeech.sourceOfTruth === 'edited_text' || normalizedSpeech.transcript || normalizedSpeech.subtitleLines.length
              ? 'edited_text'
              : normalizedSpeech.sourceOfTruth
        },
        previousSpeech: previousShot?.speech ?? null
      });

      return {
        ...shot,
        sourceAudioFilePath: String(shot?.sourceAudioFilePath ?? previousShot?.sourceAudioFilePath ?? '').trim(),
        sourceAudioFileUrl: String(shot?.sourceAudioFileUrl ?? previousShot?.sourceAudioFileUrl ?? '').trim(),
        speech: persistedSpeech
      };
    })
  );
};

const shotSpeechAssetsNeedRebuild = (shots = [], analysisOptions = null) => {
  if (!isSpeechAnalysisEnabled(analysisOptions)) {
    return false;
  }

  return (Array.isArray(shots) ? shots : []).some((shot) => {
    const sourceAudioFilePath = String(shot?.sourceAudioFilePath ?? '').trim();
    const speech = normalizeShotSpeech(shot?.speech ?? null, {
      durationSeconds: Number(shot?.durationSeconds ?? 0),
      fallbackStatus: 'idle'
    });
    const requiresSubtitleFile = Boolean(speech.transcript || speech.subtitleLines.length || speech.hasDialogue);

    return !sourceAudioFilePath || (requiresSubtitleFile && !speech.subtitleFilePath);
  });
};

export {
  DEFAULT_ANALYSIS_OPTIONS,
  normalizeAnalysisOptions,
  isSpeechAnalysisEnabled,
  normalizeSubtitleLines,
  buildTranscriptFromSubtitleLines,
  createEmptySpeech,
  normalizeShotSpeech,
  buildSrtContent,
  rebuildShotSpeechAssetsForSegment,
  persistShotSpeechEditsForSegment,
  shotSpeechAssetsNeedRebuild
};
