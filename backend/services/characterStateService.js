import { existsSync } from 'node:fs';

import { extractVideoFrame } from './ffmpegService.js';
import {
  removeFileIfExists,
  resolveUploadPath,
  toPublicUploadUrl
} from './fileService.js';
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

const normalizeOptionalString = (value, fallback = '') => {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue || fallback;
};

const sanitizeBasenamePart = (value = '') => {
  return String(value ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'asset';
};

const normalizeCharacterStateTimeline = (
  stateTimeline = [],
  {
    fallbackCharacterName = '',
    videoDuration = 0
  } = {}
) => {
  if (!Array.isArray(stateTimeline)) {
    return [];
  }

  const safeVideoDuration = Number.isFinite(Number(videoDuration)) && Number(videoDuration) > 0
    ? Number(videoDuration)
    : 0;

  return stateTimeline
    .map((stateItem, stateIndex) => {
      const rawStartTime = normalizeOptionalNumber(stateItem?.startTime ?? stateItem?.start_time);
      const rawEndTime = normalizeOptionalNumber(stateItem?.endTime ?? stateItem?.end_time);

      if (rawStartTime === null) {
        return null;
      }

      const safeStartTime = rawStartTime;
      const fallbackEndTime = safeVideoDuration > safeStartTime
        ? safeVideoDuration
        : Number((safeStartTime + 0.3).toFixed(2));
      const safeEndTime = rawEndTime !== null && rawEndTime > safeStartTime
        ? rawEndTime
        : fallbackEndTime;
      const boundedEndTime = safeVideoDuration > 0
        ? clampNumber(safeEndTime, Number((safeStartTime + 0.3).toFixed(2)), safeVideoDuration)
        : safeEndTime;
      const representativeFrameTime =
        normalizeOptionalNumber(
          stateItem?.representativeFrameTime ?? stateItem?.representative_frame_time
        ) ??
        Number((safeStartTime + Math.max(0.15, boundedEndTime - safeStartTime) / 2).toFixed(2));

      return {
        id: String(stateItem?.id ?? `state_${stateIndex + 1}`).trim() || `state_${stateIndex + 1}`,
        startTime: Number(safeStartTime.toFixed(2)),
        endTime: Number(boundedEndTime.toFixed(2)),
        stateName:
          normalizeOptionalString(
            stateItem?.stateName ?? stateItem?.state_name,
            `${fallbackCharacterName || '角色'} 状态 ${stateIndex + 1}`
          ),
        summary: normalizeOptionalString(
          stateItem?.summary,
          `${fallbackCharacterName || '角色'} 在该阶段的形象与身体状态。`
        ),
        continuityPrompt: normalizeOptionalString(
          stateItem?.continuityPrompt ?? stateItem?.continuity_prompt,
          normalizeOptionalString(stateItem?.summary, `${fallbackCharacterName || '角色'} 当前状态延续`)
        ),
        representativeFrameTime: Number(
          clampNumber(representativeFrameTime, safeStartTime, boundedEndTime).toFixed(2)
        ),
        representativeFrameNote: normalizeOptionalString(
          stateItem?.representativeFrameNote ??
            stateItem?.representative_frame_note ??
            stateItem?.representativeFrameReason ??
            stateItem?.representative_frame_reason
        ),
        representativeFrameImagePath: normalizeOptionalString(
          stateItem?.representativeFrameImagePath ?? stateItem?.representative_frame_image_path
        ),
        representativeFrameImageUrl: normalizeOptionalString(
          stateItem?.representativeFrameImageUrl ?? stateItem?.representative_frame_image_url
        )
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startTime - right.startTime);
};

const normalizeAnalysisCharacters = (characters = [], { videoDuration = 0 } = {}) => {
  if (!Array.isArray(characters)) {
    return [];
  }

  return characters
    .map((character, characterIndex) => {
      if (!character) {
        return null;
      }

      if (typeof character === 'string') {
        const name = character.trim();

        if (!name) {
          return null;
        }

        return {
          id: `character_${characterIndex + 1}`,
          name,
          appearancePrompt: name,
          personalityPrompt: '',
          representativeFrameTime: null,
          representativeFrameNote: '',
          stateTimeline: []
        };
      }

      const name = String(character?.name ?? character?.label ?? '').trim();

      if (!name) {
        return null;
      }

      return {
        id: String(character?.id ?? `character_${characterIndex + 1}`).trim() || `character_${characterIndex + 1}`,
        name,
        appearancePrompt: normalizeOptionalString(
          character?.appearancePrompt ?? character?.appearance_prompt,
          name
        ),
        personalityPrompt: normalizeOptionalString(
          character?.personalityPrompt ??
            character?.personality_prompt ??
            character?.temperament ??
            character?.personality ??
            character?.traits
        ),
        representativeFrameTime: normalizeOptionalNumber(
          character?.representativeFrameTime ?? character?.representative_frame_time
        ),
        representativeFrameNote: normalizeOptionalString(
          character?.representativeFrameNote ??
            character?.representative_frame_note ??
            character?.representativeFrameReason ??
            character?.representative_frame_reason
        ),
        stateTimeline: normalizeCharacterStateTimeline(
          character?.stateTimeline ?? character?.state_timeline ?? [],
          {
            fallbackCharacterName: name,
            videoDuration
          }
        )
      };
    })
    .filter(Boolean);
};

const normalizeCharacterStateRefs = (value = []) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const characterName = String(entry?.characterName ?? entry?.character_name ?? '').trim();
      const stateId = String(entry?.stateId ?? entry?.state_id ?? '').trim();
      const stateName = String(entry?.stateName ?? entry?.state_name ?? '').trim();
      const continuityPrompt = String(
        entry?.continuityPrompt ?? entry?.continuity_prompt ?? ''
      ).trim();

      if (!characterName) {
        return null;
      }

      return {
        characterName,
        stateId,
        stateName,
        summary: String(entry?.summary ?? '').trim(),
        continuityPrompt,
        representativeFrameTime: normalizeOptionalNumber(
          entry?.representativeFrameTime ?? entry?.representative_frame_time
        ),
        representativeFrameImagePath: String(
          entry?.representativeFrameImagePath ?? entry?.representative_frame_image_path ?? ''
        ).trim(),
        representativeFrameImageUrl: String(
          entry?.representativeFrameImageUrl ?? entry?.representative_frame_image_url ?? ''
        ).trim()
      };
    })
    .filter(Boolean);
};

const resolveCharacterStateAtTime = (character, timeSeconds) => {
  const normalizedTimeline = normalizeCharacterStateTimeline(
    character?.stateTimeline ?? character?.state_timeline ?? [],
    {
      fallbackCharacterName: String(character?.name ?? '').trim()
    }
  );
  const normalizedTime = normalizeOptionalNumber(timeSeconds);

  if (!normalizedTimeline.length || normalizedTime === null) {
    return null;
  }

  const containingState =
    normalizedTimeline.find((stateItem) => normalizedTime >= stateItem.startTime && normalizedTime <= stateItem.endTime) ??
    null;

  if (containingState) {
    return containingState;
  }

  const latestStartedState = [...normalizedTimeline]
    .filter((stateItem) => stateItem.startTime <= normalizedTime)
    .sort((left, right) => right.startTime - left.startTime)[0];

  return latestStartedState ?? null;
};

const buildCharacterStateRefsForShot = ({ shot, characters = [] }) => {
  const normalizedCharacters = normalizeAnalysisCharacters(characters);
  const shotCharacterNames = Array.isArray(shot?.characterNames)
    ? shot.characterNames.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const referenceTime =
    normalizeOptionalNumber(shot?.representativeFrameTime) ??
    normalizeOptionalNumber((Number(shot?.startTime ?? 0) + Number(shot?.endTime ?? 0)) / 2) ??
    normalizeOptionalNumber(shot?.startTime);

  return shotCharacterNames
    .map((characterName) => {
      const character =
        normalizedCharacters.find((candidate) => {
          return (
            String(candidate?.name ?? '').trim() === characterName ||
            String(candidate?.id ?? '').trim() === characterName
          );
        }) ?? null;

      if (!character) {
        return null;
      }

      const matchedState = resolveCharacterStateAtTime(character, referenceTime);

      if (!matchedState) {
        return null;
      }

      return {
        characterName: character.name,
        stateId: matchedState.id,
        stateName: matchedState.stateName,
        summary: matchedState.summary,
        continuityPrompt: matchedState.continuityPrompt,
        representativeFrameTime: matchedState.representativeFrameTime,
        representativeFrameImagePath: matchedState.representativeFrameImagePath,
        representativeFrameImageUrl: matchedState.representativeFrameImageUrl
      };
    })
    .filter(Boolean);
};

const hydrateCharacterStateRefsForShots = ({ shots = [], characters = [] }) => {
  if (!Array.isArray(shots)) {
    return [];
  }

  return shots.map((shot) => ({
    ...shot,
    characterStateRefs: buildCharacterStateRefsForShot({ shot, characters })
  }));
};

const hydrateCharacterStateRefsForAnchors = ({ timeAnchors = [], characters = [] }) => {
  if (!Array.isArray(timeAnchors)) {
    return [];
  }

  return timeAnchors.map((anchor) => ({
    ...anchor,
    shots: hydrateCharacterStateRefsForShots({
      shots: Array.isArray(anchor?.shots) ? anchor.shots : [],
      characters
    })
  }));
};

const cleanupCharacterStateAssets = async (characters = []) => {
  const assetPaths = (Array.isArray(characters) ? characters : []).flatMap((character) => {
    const timeline = Array.isArray(character?.stateTimeline) ? character.stateTimeline : [];

    return timeline
      .map((stateItem) => String(stateItem?.representativeFrameImagePath ?? '').trim())
      .filter(Boolean);
  });

  await Promise.allSettled(assetPaths.map((assetPath) => removeFileIfExists(assetPath)));
};

const rebuildCharacterStateFrameAssets = async ({
  video,
  characters = [],
  previousCharacters = [],
  cleanupExisting = false
}) => {
  if (!Array.isArray(characters) || !characters.length || !video?.filePath) {
    return Array.isArray(characters) ? characters : [];
  }

  if (cleanupExisting && Array.isArray(previousCharacters) && previousCharacters.length) {
    await cleanupCharacterStateAssets(previousCharacters);
  }

  const videoAbsolutePath = resolveUploadPath(video.filePath);

  return Promise.all(
    characters.map(async (character, characterIndex) => {
      const normalizedCharacter = {
        ...character,
        stateTimeline: normalizeCharacterStateTimeline(character?.stateTimeline ?? [], {
          fallbackCharacterName: character?.name ?? `角色 ${characterIndex + 1}`
        })
      };

      const nextStateTimeline = await Promise.all(
        normalizedCharacter.stateTimeline.map(async (stateItem, stateIndex) => {
          try {
            const frameResult = await extractVideoFrame(
              videoAbsolutePath,
              stateItem.representativeFrameTime,
              {
                basename: `character-${sanitizeBasenamePart(character?.id || character?.name || `character-${characterIndex + 1}`)}-${sanitizeBasenamePart(stateItem.id || `state-${stateIndex + 1}`)}-state-reference`
              }
            );

            return {
              ...stateItem,
              representativeFrameImagePath: String(frameResult?.filePath ?? '').trim(),
              representativeFrameImageUrl: String(frameResult?.fileUrl ?? '').trim()
            };
          } catch (error) {
            logger.warn('Failed to build character state reference frame.', {
              message: error.message,
              videoId: video?.id,
              characterId: character?.id,
              stateId: stateItem?.id
            });

            return stateItem;
          }
        })
      );

      return {
        ...normalizedCharacter,
        stateTimeline: nextStateTimeline
      };
    })
  );
};

const characterStateAssetsNeedRebuild = (characters = []) => {
  if (!Array.isArray(characters) || !characters.length) {
    return false;
  }

  return characters.some((character) => {
    const timeline = Array.isArray(character?.stateTimeline) ? character.stateTimeline : [];

    return timeline.some((stateItem) => {
      const imagePath = String(stateItem?.representativeFrameImagePath ?? '').trim();
      const imageUrl = String(stateItem?.representativeFrameImageUrl ?? '').trim();

      return !imagePath || !imageUrl || !existsSync(resolveUploadPath(imagePath));
    });
  });
};

export {
  normalizeCharacterStateTimeline,
  normalizeAnalysisCharacters,
  normalizeCharacterStateRefs,
  resolveCharacterStateAtTime,
  buildCharacterStateRefsForShot,
  hydrateCharacterStateRefsForShots,
  hydrateCharacterStateRefsForAnchors,
  cleanupCharacterStateAssets,
  rebuildCharacterStateFrameAssets,
  characterStateAssetsNeedRebuild
};
