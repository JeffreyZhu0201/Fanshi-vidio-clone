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
    '请对输入的整条视频做一次完整的整体视频理解，并严格返回 JSON。',
    '不要输出 Markdown，不要输出解释，不要输出额外文本。',
    '这次返回必须一次性包含整片剧情、角色、场景资源、大片段和每个大片段下的全部小镜头信息。',
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
            endTime: 7,
            sceneSummary: '片段解释',
            scenePrompt: '该片段可直接复用的场景提示词',
            representativeFrameTime: 1.6,
            backgroundId: 'background_1',
            backgroundAction: 'create_new',
            backgroundName: '场景名称',
            shots: [
              {
                id: 'shot_1',
                startTime: 0,
                endTime: 2,
                summary: '镜头解释',
                prompt: '@角色名 位于画面中的明确位置，在 #场景名称 中完成该镜头动作，包含景别、机位、运动方向、视线和遮挡关系的可编辑中文提示词',
                sceneNames: ['场景名称'],
                characterNames: ['角色名'],
                representativeFrameTime: 1.1,
                representativeFrameNote: '该镜头的典型帧说明'
              }
            ]
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
    '5. backgrounds 需要尽量多提取对后续重生成有价值的可复用场景资源，不只提大场景；同一大场景中的稳定子空间、机位常驻区域、布景核心角落、走廊、门口、窗边、吧台、沙发区等，只要能独立复用，都可以沉淀成单独场景资源。',
    '6. 每个 background 都要返回 scenePrompt，内容是可直接用于生成该场景的中文场景提示词，同时返回 representativeFrameTime 和 representativeFrameNote。',
    '7. 先识别整片有哪些可复用场景，并把它们沉淀到 backgrounds 这个场景资源库里；如果同一大场景内部有多个视觉差异稳定且值得复用的子空间，也要拆开沉淀。',
    '8. timeAnchors 必须覆盖完整视频，startTime 和 endTime 为数字秒，严格按时间升序，不要重叠，不要遗漏关键内容。',
    '9. 片段切分必须以场景切换为硬边界；只有在同一场景内动作阶段明显不同且确实需要独立生成时，才继续细分。',
    '10. 每个 timeAnchor 代表一个后续可独立生成的片段，而不是纯观感镜头；片段边界要尽量保证动作完整、人物连续、场景切换清晰、前后文衔接稳定。',
    '11. 避免输出明显过短且没有独立生成价值的片段；如果视频较短，也要保证切分结果仍然覆盖全片。',
    '12. 每个 timeAnchor 都要给出 sceneSummary 和 scenePrompt；sceneSummary 用中文解释该片段发生了什么，scenePrompt 必须是可直接复用的片段场景提示词，包含场景、光线、主体关系、空间结构和镜头氛围，不要只写事件摘要。',
    '13. 每个 timeAnchor 都必须绑定 backgroundId、backgroundAction、backgroundName。',
    '14. 同一 backgroundId 首次出现的片段标记为 create_new，后续再次出现的同场景片段标记为 reuse_existing。',
    '15. 每个 timeAnchor 都要返回 representativeFrameTime，且该时间点必须落在 startTime 到 endTime 之间；优先选择最适合做预览、最能代表人物或场景的画面，而不是机械取中点。',
    '16. 如果同一场景在多个片段重复出现，允许每个片段返回更贴合该片段语境的 scenePrompt，但 backgroundId 必须保持一致。',
    '17. 每个 timeAnchor 内都必须返回 shots 数组，用于描述该大片段下的小镜头；shots 是后续小镜头切片与生成的唯一真值来源。',
    '18. shots 必须尽量按真实镜头切点拆分，优先对齐真实剪辑边界、机位变化、镜头运动变化、景别变化、构图重心变化、主体关系变化、场景切换、视线反打、人物进出画、明显动作 beat、焦点转移、对白换气节点和说话节奏断点，不要机械均分时间。',
    '19. 如果同一连续动作里出现了明显的左/中/右站位变化、前后景关系变化、镜头角度变化、横移推拉变化、遮挡关系变化、表演节奏断点、口型状态切换或说话人主次变化，也应该继续拆成新的 shot。',
    '20. 对 60 秒以内的视频，要尽量把观众能明显感知到的真实镜头都拆出来；不要把多个连续 cut、多个表演 beat 或多个构图中心合并成一个 shot。',
    '21. 如果没有硬切，也要按动作阶段、视线关系、说话段落、镜头运动阶段和构图稳定区间细分 shot；除非画面长时间稳定且动作单一，否则单个 shot 尽量不要超过 4 秒。',
    '22. shots 必须按整片绝对时间返回 startTime 和 endTime，严格落在所属 timeAnchor 范围内，按时间升序、无重叠，并尽量覆盖该大片段；timeAnchor 和 shot 的时间请尽量精确到 0.1 秒，不要只给粗略整秒。',
    '23. 每个 shot 都要返回 id、summary、prompt、sceneNames、characterNames、representativeFrameTime、representativeFrameNote；sceneNames 和 characterNames 都不能为空。',
    '24. shot.summary 不能只写发生了什么，还要简要点出镜头核心动作、主体关系、构图变化或切分依据，让人能看出为什么这里单独成镜头。',
    '25. representativeFrameTime 必须选择该镜头最有代表性的画面，不允许机械取中点；优先选择最适合作为预览图和生成参考图、最能体现该镜头构图、动作状态和人物表情的画面。',
    '26. representativeFrameNote 需要说明这个时间点对应的关键画面，例如哪个动作定格、哪个表情瞬间、哪个构图最稳定。',
    '27. shot.prompt 必须直接服务镜头级视频生成，必须写清：角色数量、谁在前景/中景/后景、人物在画面中的左/中/右位置、远近层次、朝向与视线方向、肢体姿态、运动轨迹、进出画方式、遮挡关系、镜头景别、拍摄角度、镜头运动、光线氛围、说话状态或口型是否明显，以及与前后镜头的连续关系。',
    '28. shot.prompt 必须同时使用至少一个 @角色名 和至少一个 #场景名 引用，不要把资源正文直接展开，也不要只重复大片段摘要。',
    '29. 如果一个 shot 涉及多个场景，需要在 sceneNames 中全部列出，并在 prompt 中按顺序引用对应的 #场景名。',
    '30. 如果一个 shot 涉及多个角色，需要明确每个角色各自的位置、主次关系、视线关系和表演状态，而不是只列名字；如果角色是不完整出镜、背影、手部或 POV，也必须绑定稳定的人物名。',
    '31. 如果角色较少，也至少保证 characters 返回 1 个对象。',
    '32. 输出必须是合法 JSON，字段名保持与示例完全一致。'
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
        prompt: '@角色名 + #场景名 + 动作 + 镜头语言 的可编辑中文提示词'
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
    '5. prompt 中涉及场景时，用 #场景名 标记，而不是直接展开真实场景资源提示词。',
    '6. 如果片段中出现多个场景，请在 scenes 中列全，并在 prompt 里按顺序引用对应的 #场景名。',
    '7. 当前片段必须服从已绑定的 backgroundId/backgroundAction/backgroundName，不要重新发明新的场景决策。',
    '8. 如果当前片段标记为 reuse_existing，需要在 scene 和 prompt 中强调延续同一场景资源，只变化动作、表演或镜头阶段。',
    '9. 输出必须是有效 JSON。'
  ].join('\n');
};

const buildPromptOptimizationPrompt = ({
  prompt,
  characters,
  backgrounds,
  mode = 'generation',
  segmentPrompt = '',
  shotPrompt = '',
  sceneNames = [],
  characterNames = []
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
      '4. 不要使用 #场景名，也不要引入任何场景资源。',
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
      '4. 不要使用 @角色名 或 #场景名。',
      '5. 只返回 JSON。'
    ].join('\n');
  }

  if (mode === 'shot_generation') {
    return [
      '你是一名镜头级视频生成提示词优化助手。',
      '请在不改变当前镜头核心语义的前提下，结合大片段叙事目标优化当前小镜头提示词，并严格返回 JSON。',
      '不要输出 Markdown，不要输出解释，不要输出额外文本。',
      '返回结构必须完全符合：',
      JSON.stringify(
        {
          optimizedPrompt: '@角色名 在 #场景名 中完成更清晰的单镜头描述'
        },
        null,
        2
      ),
      `大片段最终提示词：${segmentPrompt ?? ''}`,
      `当前小镜头提示词：${shotPrompt || prompt || ''}`,
      `角色列表：${safeStringify(characters ?? [])}`,
      `场景资源库：${safeStringify(backgrounds ?? [])}`,
      `镜头涉及场景：${safeStringify(sceneNames ?? [])}`,
      `镜头涉及角色：${safeStringify(characterNames ?? [])}`,
      '要求：',
      '1. 输出必须服务于单镜头生成，而不是复述大片段摘要。',
      '2. 必须保留并优先使用 @角色名 和 #场景名，不要把资源正文直接展开。',
      '3. 必须补足单镜头级别的动作、表演节奏、镜头语言、构图和氛围，但不要偏离当前镜头原意。',
      '4. 必须写清人物数量、主次关系、人物在画面中的左/中/右位置、前景/中景/后景关系、朝向、视线、肢体姿态、运动路径、进出画方式、遮挡关系、景别、机位角度和镜头运动。',
      '5. 需要与大片段最终提示词保持叙事和视觉连续性，尽量还原原片镜头语言。',
      '6. 如果给了镜头涉及场景和角色，优先围绕这些对象优化。',
      '7. 只返回 JSON。'
    ].join('\n');
  }

  return [
    '你是一名视频生成提示词优化助手。',
    '请优化下面的提示词，并严格返回 JSON，不要输出 Markdown 或额外解释。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        optimizedPrompt: '@角色名 在 #场景名 中完成更清晰的镜头描述'
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
    '3. 如果提示词中出现了场景资源库中的场景名称，也统一替换成 #场景名。',
    '4. 如果原始提示词已经包含 @角色名 或 #场景名，继续保留这种引用形式，不要把资源提示词正文直接展开。',
    '5. 提示词要更适合视频生成或资源设计，补足镜头、场景、动作、氛围，以及主体站位、景别、机位、视线和运动方向，但不要改变核心语义。',
    '6. 只返回 JSON。'
  ].join('\n');
};

const expandResourceMentions = (prompt = '', characters = [], backgrounds = []) => {
  const normalizedCharacters = (characters ?? []).map(normalizeCharacterResource).filter(Boolean);
  const normalizedBackgrounds = (backgrounds ?? []).map(normalizeBackgroundResource).filter(Boolean);

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
  buildVideoAnalysisPrompt,
  expandResourceMentions
};
