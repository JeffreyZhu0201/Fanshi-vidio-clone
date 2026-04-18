const safeStringify = (value) => {
  try {
    return JSON.stringify(value ?? [], null, 2);
  } catch (error) {
    return '[]';
  }
};

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

const buildVideoAnalysisPrompt = ({ video }) => {
  return [
    '你是一名资深视频理解与影视拆解助手。',
    '请对输入的整条视频做整体视频理解，并严格返回 JSON。',
    '不要输出 Markdown，不要输出解释，不要输出额外文本。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        plot: 'string',
        characters: [
          {
            id: 'character_1',
            name: '角色名',
            appearancePrompt: '角色完整形象设定',
            personalityPrompt: '角色的性格气质设定',
            representativeFrameTime: 1.2,
            representativeFrameNote: '该角色的典型帧说明'
          }
        ],
        backgrounds: [
          {
            id: 'background_1',
            name: '场景名称',
            description: '片段或场景背景描述',
            scenePrompt: '可直接用于生成该场景的中文提示词',
            representativeFrameTime: 2.8,
            representativeFrameNote: '该场景的典型帧说明'
          }
        ],
        timeAnchors: [
          {
            startTime: 0,
            endTime: 3.2,
            sceneSummary: '片段解释',
            scenePrompt: '该片段可直接复用的场景提示词',
            representativeFrameTime: 1.6,
            backgroundId: 'background_1',
            backgroundAction: 'create_new',
            backgroundName: '场景名称'
          }
        ]
      },
      null,
      2
    ),
    `视频文件名：${video?.filename ?? 'unknown'}`,
    `视频时长（秒）：${video?.duration ?? 'unknown'}`,
    '要求：',
    '1. plot 用中文概括整条视频的主要剧情、事件推进和结局走向，适合后续片段生成使用。',
    '2. characters 至少提取主要角色，name 要稳定，appearancePrompt 必须是可直接用于视频生成的人物外观设定。',
    '3. 每个 character 还必须返回 personalityPrompt，用中文概括角色的性格气质、情绪底色、行为风格或表演状态，方便后续角色资源与生成提示词复用。',
    '4. 每个 character 都要返回 representativeFrameTime，表示最能代表该角色外观的时间点（单位秒）；representativeFrameNote 简要说明为什么选择该帧。',
    '5. backgrounds 需要概括主要场景、环境氛围、光线、天气、布景和空间信息，name 为方便前端展示的场景名称。',
    '6. 每个 background 都要返回 scenePrompt，内容是可直接用于生成该场景的中文场景提示词，同时返回 representativeFrameTime 和 representativeFrameNote。',
    '7. 先识别整片有哪些可复用场景，并把它们沉淀到 backgrounds 这个场景资源库里。',
    '8. timeAnchors 必须覆盖完整视频，startTime 和 endTime 为数字秒，严格按时间升序，不要重叠，不要遗漏关键内容。',
    '9. 片段切分必须以场景切换为硬边界；只有在同一场景内动作阶段明显不同且确实需要独立生成时，才继续细分。',
    '10. 每个 timeAnchor 代表一个后续可独立生成的片段，而不是纯观感镜头；片段边界要尽量保证动作完整、人物连续、场景切换清晰、前后文衔接稳定。',
    '11. 避免输出明显过短且没有独立生成价值的片段；如果视频较短，也要保证切分结果仍然覆盖全片。',
    '12. 每个 timeAnchor 都要给出 sceneSummary 和 scenePrompt；sceneSummary 用中文解释该片段发生了什么，scenePrompt 必须是可直接复用的片段场景提示词，包含场景、光线、主体关系、空间结构和镜头氛围，不要只写事件摘要。',
    '13. 每个 timeAnchor 都必须绑定 backgroundId、backgroundAction、backgroundName。',
    '14. 同一 backgroundId 首次出现的片段标记为 create_new，后续再次出现的同场景片段标记为 reuse_existing。',
    '15. 每个 timeAnchor 都要返回 representativeFrameTime，且该时间点必须落在 startTime 到 endTime 之间；优先选择最适合做预览、最能代表人物或场景的画面，而不是机械取中点。',
    '16. 如果同一场景在多个片段重复出现，允许每个片段返回更贴合该片段语境的 scenePrompt，但 backgroundId 必须保持一致。',
    '17. 如果角色较少，也至少保证 characters 返回 1 个对象。',
    '18. 输出必须是合法 JSON，字段名保持与示例完全一致。'
  ].join('\n');
};

const buildSegmentAnalysisPrompt = ({ segment, overallAnalysis }) => {
  const currentBackgroundBinding = {
    backgroundId: segment?.backgroundId ?? '',
    backgroundAction: segment?.backgroundAction ?? '',
    backgroundName: segment?.backgroundName ?? '',
    backgroundPrompt: segment?.backgroundPrompt ?? '',
    scenePrompt: segment?.scenePrompt ?? '',
    sceneSummary: segment?.sceneSummary ?? segment?.scene ?? ''
  };

  return [
    '你是一名资深短视频片段拆解助手。',
    '请分析输入的视频片段，并严格返回 JSON，不要输出 Markdown、解释或额外文本。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        characters: ['角色名'],
        scenes: ['场景名称'],
        scene: '片段场景描述',
        action: '片段主要动作描述',
        prompt: '@角色名 + @场景名 + 动作 + 镜头语言 的可编辑中文提示词'
      },
      null,
      2
    ),
    `片段序号：${Number(segment?.segmentIndex ?? 0) + 1}`,
    `片段时间：${segment?.startTime ?? 0} - ${segment?.endTime ?? 0} 秒`,
    `整片剧情摘要：${overallAnalysis?.plot ?? '暂无'}`,
    `整片角色设定：${safeStringify(overallAnalysis?.characters ?? [])}`,
    `整片场景资源库：${safeStringify(overallAnalysis?.backgrounds ?? [])}`,
    `当前片段绑定场景：${safeStringify(currentBackgroundBinding)}`,
    '要求：',
    '1. characters 返回当前片段真正出现或应重点关注的角色名称列表。',
    '2. scenes 返回当前片段涉及到的场景资源名称，必须优先复用整片场景资源库里的原始名称，并按叙事出现顺序返回。',
    '3. prompt 必须为后续视频生成可直接编辑的中文提示词。',
    '4. prompt 中涉及角色时，用 @角色名 标记，而不是展开成长描述。',
    '5. prompt 中涉及场景时，用 @场景名 标记，而不是直接展开真实场景资源提示词。',
    '6. 如果片段中出现多个场景，请在 scenes 中列全，并在 prompt 里按顺序引用对应的 @场景名。',
    '7. 当前片段必须服从已绑定的 backgroundId/backgroundAction/backgroundName，不要重新发明新的场景决策。',
    '8. 如果当前片段标记为 reuse_existing，需要在 scene 和 prompt 中强调延续同一场景资源，只变化动作、表演或镜头阶段。',
    '9. 输出必须是有效 JSON。'
  ].join('\n');
};

const buildPromptOptimizationPrompt = ({
  prompt,
  characters,
  backgrounds,
  mode = 'generation'
}) => {
  if (mode === 'character_resource') {
    return [
      '你是一名角色资源提示词优化助手。',
      '请把下面的角色描述整理为适合 Gemini 生图模型生成角色三视图的中文提示词，并严格返回 JSON。',
      '不要输出 Markdown，不要输出解释，不要输出额外文本。',
      '返回结构必须完全符合：',
      JSON.stringify(
        {
          optimizedPrompt: '外表描述 + 性格气质 + 纯白背景角色三视图要求'
        },
        null,
        2
      ),
      `原始提示词：${prompt ?? ''}`,
      `角色列表：${safeStringify(characters ?? [])}`,
      '要求：',
      '1. 只围绕角色本身优化，不要引入任何场景、环境、道具或镜头叙事。',
      '2. 必须综合角色的外貌描述和性格气质，整理为单人角色三视图资源提示词。',
      '3. 明确纯白无缝背景、全身完整入镜、中性站姿、正面/侧面/背面都可复用。',
      '4. 不要使用 @场景名，也不要引入任何场景资源。',
      '5. 不必使用 @角色名，直接输出纯角色资源提示词正文。',
      '6. 只返回 JSON。'
    ].join('\n');
  }

  if (mode === 'scene_resource') {
    return [
      '你是一名场景资源提示词优化助手。',
      '请把下面的场景描述整理为适合 Gemini 生图模型生成背景参考图的中文提示词，并严格返回 JSON。',
      '不要输出 Markdown，不要输出解释，不要输出额外文本。',
      '返回结构必须完全符合：',
      JSON.stringify(
        {
          optimizedPrompt: '纯场景背景参考图提示词'
        },
        null,
        2
      ),
      `原始提示词：${prompt ?? ''}`,
      `场景资源库：${safeStringify(backgrounds ?? [])}`,
      '要求：',
      '1. 只优化场景本身，不要引入人物或角色动作。',
      '2. 强调空间结构、材质、光线、景深和镜头角度兼容性。',
      '3. 输出适合作为多角度背景参考图的纯场景提示词。',
      '4. 不要使用 @角色名 或 @场景名。',
      '5. 只返回 JSON。'
    ].join('\n');
  }

  return [
    '你是一名视频生成提示词优化助手。',
    '请优化下面的提示词，并严格返回 JSON，不要输出 Markdown 或额外解释。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        optimizedPrompt: '@角色名 在 @场景名 中完成更清晰的镜头描述'
      },
      null,
      2
    ),
    `原始提示词：${prompt ?? ''}`,
    `角色列表：${safeStringify(characters ?? [])}`,
    `场景资源库：${safeStringify(backgrounds ?? [])}`,
    '要求：',
    '1. 保持中文输出。',
    '2. 所有角色名称统一替换成 @角色名。',
    '3. 如果提示词中出现了场景资源库中的场景名称，也统一替换成 @场景名。',
    '4. 如果原始提示词已经包含 @角色名 或 @场景名，继续保留这种引用形式，不要把资源提示词正文直接展开。',
    '5. 提示词要更适合视频生成或资源设计，补足镜头、场景、动作、氛围，但不要改变核心语义。',
    '6. 只返回 JSON。'
  ].join('\n');
};

const expandResourceMentions = (prompt = '', characters = [], backgrounds = []) => {
  const normalizedCharacters = (characters ?? []).map(normalizeCharacterResource).filter(Boolean);
  const normalizedBackgrounds = (backgrounds ?? []).map(normalizeBackgroundResource).filter(Boolean);

  return String(prompt ?? '').replace(/@([\p{L}\p{N}_-]+)/gu, (match, resourceName) => {
    const matchedCharacter = normalizedCharacters.find((item) => item.name === resourceName);

    if (!matchedCharacter) {
      const matchedBackground = normalizedBackgrounds.find((item) => item.name === resourceName);
      return matchedBackground?.prompt || match;
    }

    return matchedCharacter.prompt || match;
  });
};

export {
  buildPromptOptimizationPrompt,
  buildSegmentAnalysisPrompt,
  buildVideoAnalysisPrompt,
  expandResourceMentions
};
