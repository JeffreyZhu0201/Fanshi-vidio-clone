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

const buildCharacterViewPrompts = ({
  resourceName,
  prompt,
  appearancePrompt = '',
  personalityPrompt = ''
}) => {
  const basePrompt = String(prompt || '').trim();
  const appearanceLine = String(appearancePrompt || '').trim();
  const personalityLine = String(personalityPrompt || '').trim();

  return [
    {
      id: 'front',
      label: '正面',
      prompt: [
        `请使用 Gemini 生图模型生成角色 ${resourceName || '未命名角色'} 的三视图之一：正面视图。`,
        '要求：单人、全身、居中站立、正对镜头、中性站姿、完整保留头部到脚部。',
        '要求：纯白无缝背景，背景不能带任何场景、环境、道具、阴影文字、拼贴版式或其他人物。',
        '要求：写实电影美术设定风格，服装结构、面部特征、发型、配饰需要稳定且清晰。',
        appearanceLine ? `角色外表描述：${appearanceLine}` : '',
        personalityLine ? `角色性格气质：${personalityLine}` : '',
        `角色资源提示词：${basePrompt || '无'}`
      ]
        .filter(Boolean)
        .join('\n')
    },
    {
      id: 'side',
      label: '侧面',
      prompt: [
        `请使用 Gemini 生图模型生成角色 ${resourceName || '未命名角色'} 的三视图之一：左侧面视图。`,
        '要求：单人、全身、严格侧身站立、镜头平视、完整保留头部到脚部。',
        '要求：背景必须保持纯白无缝，与正面视图保持相同布光和材质表达，不要额外角色和道具。',
        '要求：强调发型轮廓、服装侧面结构、肩线与腰线层次，保持人物身份一致。',
        appearanceLine ? `角色外表描述：${appearanceLine}` : '',
        personalityLine ? `角色性格气质：${personalityLine}` : '',
        `角色资源提示词：${basePrompt || '无'}`
      ]
        .filter(Boolean)
        .join('\n')
    },
    {
      id: 'back',
      label: '背面',
      prompt: [
        `请使用 Gemini 生图模型生成角色 ${resourceName || '未命名角色'} 的三视图之一：背面视图。`,
        '要求：单人、全身、背对镜头、中性站姿、完整保留头部到脚部。',
        '要求：背景必须保持纯白无缝，不要文字、不要道具、不要额外人物，强调服装背部结构和发型后部轮廓。',
        '要求：与正面和侧面保持同一角色身份、服装材质和电影美术风格。',
        appearanceLine ? `角色外表描述：${appearanceLine}` : '',
        personalityLine ? `角色性格气质：${personalityLine}` : '',
        `角色资源提示词：${basePrompt || '无'}`
      ]
        .filter(Boolean)
        .join('\n')
    }
  ];
};

const buildSceneAnglePrompts = ({ resourceName, prompt }) => {
  const basePrompt = String(prompt || '').trim();

  return [
    {
      id: 'establishing',
      label: '正视广角',
      prompt: [
        `请使用 Gemini 生图模型为场景 ${resourceName || '未命名场景'} 生成第一张背景参考图：正视广角建立镜头。`,
        '要求：只生成纯场景背景，不要人物，不要文字，不要水印，不要 UI 元素。',
        '要求：突出空间结构、主背景层次、材质、光线方向与景深关系，适合作为主场景参考。',
        `场景资源提示词：${basePrompt || '无'}`
      ].join('\n')
    },
    {
      id: 'three-quarter',
      label: '45度斜侧',
      prompt: [
        `请使用 Gemini 生图模型为场景 ${resourceName || '未命名场景'} 生成第二张背景参考图：45 度斜侧视角。`,
        '要求：保持与第一张相同场景、相同时间与布光逻辑，只改变观察角度。',
        '要求：只生成纯背景，不要人物，不要文字，强调空间转折、前中后景和透视关系。',
        `场景资源提示词：${basePrompt || '无'}`
      ].join('\n')
    },
    {
      id: 'elevated',
      label: '高位俯视',
      prompt: [
        `请使用 Gemini 生图模型为场景 ${resourceName || '未命名场景'} 生成第三张背景参考图：高位三分之四俯视角。`,
        '要求：保持同一场景与同一视觉设定，只改变机位高度与俯视角度，便于后续做场景补充参考。',
        '要求：只生成纯背景，不要人物，不要文字，突出地面结构、天花结构或纵深层次。',
        `场景资源提示词：${basePrompt || '无'}`
      ].join('\n')
    }
  ];
};

const buildAutoCharacterResources = (analysis = null) => {
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
        personalityPrompt: getCharacterPersonalityPrompt(character)
      })
    };
  });
};

const buildAutoSceneResources = (analysis = null) => {
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
        prompt: sourcePrompt
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
