import {
  buildCharacterViewPrompts as buildSharedCharacterViewPrompts,
  buildSceneAnglePrompts as buildSharedSceneAnglePrompts
} from '../../../shared/promptBlueprints.js';

const getRepresentativeFrameTime = (item) => {
  const value = Number(item?.representativeFrameTime ?? item?.representative_frame_time);
  return Number.isFinite(value) && value >= 0 ? Number(value.toFixed(2)) : null;
};

const getCharacterAppearancePrompt = (character) => {
  return (
    character?.appearancePrompt ||
    character?.appearance_prompt ||
    character?.prompt ||
    character?.description ||
    '等待补充角色设定'
  );
};

const getCharacterPersonalityPrompt = (character) => {
  return (
    character?.personalityPrompt ||
    character?.personality_prompt ||
    character?.temperament ||
    character?.personality ||
    character?.traits ||
    '等待补充性格气质'
  );
};

const buildCharacterResourcePrompt = (character) => {
  const appearancePrompt = getCharacterAppearancePrompt(character);
  const personalityPrompt = getCharacterPersonalityPrompt(character);

  return [`外表描述：${appearancePrompt}`, `性格气质：${personalityPrompt}`].filter(Boolean).join('\n');
};

const getBackgroundName = (background, index) => {
  if (typeof background === 'string') {
    return `场景 ${index + 1}`;
  }

  return background?.name || background?.title || background?.sceneName || `场景 ${index + 1}`;
};

const getBackgroundDescription = (background) => {
  if (typeof background === 'string') {
    return background;
  }

  return background?.description || background?.summary || '暂无背景描述';
};

const getScenePrompt = (item, fallback = '暂无场景提示词') => {
  return item?.scenePrompt || item?.scene_prompt || fallback;
};

const buildCharacterViewPrompts = (payload) => buildSharedCharacterViewPrompts(payload);

const buildSceneAnglePrompts = (payload) => buildSharedSceneAnglePrompts(payload);

const buildAutoCharacterResources = (analysis = null, { styleMode = '', styleTemplates = null } = {}) => {
  return (analysis?.characters ?? []).map((character, index) => {
    const resourceId = character.id || character.name || `character_${index + 1}`;
    const resourceName = character.name || `角色 ${index + 1}`;
    const sourcePrompt = buildCharacterResourcePrompt(character);

    return {
      resourceType: 'character',
      resourceId,
      resourceName,
      frameTime: getRepresentativeFrameTime(character),
      appearancePrompt: getCharacterAppearancePrompt(character),
      personalityPrompt: getCharacterPersonalityPrompt(character),
      sourcePrompt,
      variants: buildCharacterViewPrompts({
        resourceName,
        prompt: sourcePrompt,
        appearancePrompt: getCharacterAppearancePrompt(character),
        personalityPrompt: getCharacterPersonalityPrompt(character),
        styleMode,
        styleTemplates
      })
    };
  });
};

const buildAutoSceneResources = (analysis = null, { styleMode = '', styleTemplates = null } = {}) => {
  return (analysis?.backgrounds ?? []).map((background, index) => {
    const resourceId = background?.id || `background_${index + 1}`;
    const resourceName = getBackgroundName(background, index);
    const sourcePrompt = getScenePrompt(background, getBackgroundDescription(background));

    return {
      resourceType: 'scene',
      resourceId,
      resourceName,
      frameTime: getRepresentativeFrameTime(background),
      description: getBackgroundDescription(background),
      sourcePrompt,
      variants: buildSceneAnglePrompts({
        resourceName,
        prompt: sourcePrompt,
        styleMode,
        styleTemplates
      })
    };
  });
};

export {
  buildAutoCharacterResources,
  buildAutoSceneResources,
  buildCharacterViewPrompts,
  buildSceneAnglePrompts
};
