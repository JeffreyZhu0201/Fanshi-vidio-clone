import {
  buildPromptOptimizationPrompt,
  buildSegmentAnalysisPrompt,
  buildSegmentAnalysisPromptSections,
  buildVideoAnalysisPrompt,
  buildVideoAnalysisPromptSections
} from '../../../shared/promptBlueprints.js';

const normalizeCharacterResource = (item) => {
  if (!item) {
    return null;
  }

  if (typeof item === 'string') {
    return {
      name: item,
      prompt: item
    };
  }

  const name = String(item?.name ?? '').trim();

  if (!name) {
    return null;
  }

  return {
    name,
    prompt: [
      String(item?.appearancePrompt ?? item?.appearance_prompt ?? item?.name ?? '').trim() || name,
      String(
        item?.personalityPrompt ??
          item?.personality_prompt ??
          item?.temperament ??
          item?.personality ??
          item?.traits ??
          ''
      ).trim()
    ]
      .filter(Boolean)
      .join('，')
  };
};

const normalizeBackgroundResource = (item, index) => {
  if (!item) {
    return null;
  }

  if (typeof item === 'string') {
    return {
      name: `场景 ${index + 1}`,
      prompt: item
    };
  }

  const name = String(item?.name ?? item?.title ?? item?.sceneName ?? item?.scene_name ?? '').trim();

  if (!name) {
    return null;
  }

  return {
    name,
    prompt:
      String(
        item?.scenePrompt ??
          item?.scene_prompt ??
          item?.backgroundPrompt ??
          item?.background_prompt ??
          item?.description ??
          item?.summary ??
          ''
      ).trim() || name
  };
};

const expandResourceMentions = (prompt = '', characters = [], backgrounds = []) => {
  const normalizedCharacters = (characters ?? []).map(normalizeCharacterResource).filter(Boolean);
  const normalizedBackgrounds = (backgrounds ?? []).map((item, index) => normalizeBackgroundResource(item, index)).filter(Boolean);

  return String(prompt ?? '').replace(/([@#])([\p{L}\p{N}_-]+)/gu, (match, marker, resourceName) => {
    if (marker === '@') {
      const matchedCharacter = normalizedCharacters.find((item) => item.name === resourceName);

      if (matchedCharacter) {
        return matchedCharacter.prompt || match;
      }
    }

    const matchedBackground = normalizedBackgrounds.find((item) => item.name === resourceName);
    return matchedBackground?.prompt || match;
  });
};

export {
  buildPromptOptimizationPrompt,
  buildSegmentAnalysisPrompt,
  buildSegmentAnalysisPromptSections,
  buildVideoAnalysisPrompt,
  buildVideoAnalysisPromptSections,
  expandResourceMentions
};
