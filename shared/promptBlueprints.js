import {
  DEFAULT_STYLE_MODE,
  STYLE_MODE_LABELS,
  normalizeStyleMode,
  resolveStyleTemplate
} from './styleTemplates.js';

const safeStringify = (value) => {
  try {
    return JSON.stringify(value ?? [], null, 2);
  } catch (error) {
    return '[]';
  }
};

const getNormalizedAnalysisOptionsForPrompts = (analysisOptions = null) => {
  return {
    extractSubtitles:
      typeof analysisOptions?.extractSubtitles === 'boolean' || typeof analysisOptions?.extract_subtitles === 'boolean'
        ? Boolean(analysisOptions?.extractSubtitles ?? analysisOptions?.extract_subtitles)
        : true,
    parseAudio:
      typeof analysisOptions?.parseAudio === 'boolean' || typeof analysisOptions?.parse_audio === 'boolean'
        ? Boolean(analysisOptions?.parseAudio ?? analysisOptions?.parse_audio)
        : true,
    styleMode: normalizeStyleMode(analysisOptions?.styleMode ?? analysisOptions?.style_mode),
    styleTemplates: analysisOptions?.styleTemplates ?? analysisOptions?.style_templates ?? null
  };
};

const buildVideoAnalysisPromptSections = ({ video, metadata, analysisOptions = null }) => {
  const normalizedOptions = getNormalizedAnalysisOptionsForPrompts(analysisOptions);
  const styleModeLabel = STYLE_MODE_LABELS[normalizedOptions.styleMode] ?? STYLE_MODE_LABELS[DEFAULT_STYLE_MODE];
  const stylePrompt = resolveStyleTemplate({
    styleMode: normalizedOptions.styleMode,
    styleTemplates: normalizedOptions.styleTemplates,
    templateKey: 'videoAnalysisStylePrompt'
  });
  const speechEnabled = normalizedOptions.extractSubtitles || normalizedOptions.parseAudio;
  const speechSchema = speechEnabled
    ? {
        speech: {
          transcript: '镜头对白全文，没有对白时返回空字符串',
          subtitleLines: [
            {
              id: 'subtitle_1',
              startTime: 0,
              endTime: 0.8,
              text: '第一句字幕'
            }
          ],
          speechStyle: '语速、停顿、情绪、语气、说话力度、口型明显程度等中文说明',
          hasDialogue: true,
          extractionStatus: 'completed',
          extractionError: '',
          sourceOfTruth: 'extracted'
        }
      }
    : {};

  const fixedStructurePrompt = [
    '你是一名资深视频理解与影视拆解助手。',
    '请对输入的整条视频做一次完整的整体视频理解，并严格返回 JSON。',
    '不要输出 Markdown，不要输出解释，不要输出额外文本。',
    '这次整片分析只返回剧情、角色（含状态时间线）、大剧情片段和每个大片段下的小镜头真值。',
    '场景资源库会由后端根据 timeAnchors 派生；不要改写 JSON 结构，也不要删除任何约定字段。',
    speechEnabled
      ? '不要返回 backgrounds 或 characterStateRefs 这两个顶层或镜头级额外字段；角色状态连续性只放在 characters[*].stateTimeline 中；小镜头 speech 需要在这次整片理解里一次性返回。'
      : '不要返回 backgrounds、speech 或 characterStateRefs 这三个顶层或镜头级额外字段；角色状态连续性只放在 characters[*].stateTimeline 中。',
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
            representativeFrameNote: '该角色的典型帧说明',
            stateTimeline: [
              {
                id: 'character_1_state_1',
                startTime: 0,
                endTime: 6.5,
                stateName: '基础状态',
                summary: '角色保持初始外形、服装和身体完整度',
                continuityPrompt: '后续镜头持续保持该角色当前基础形象、服装和身体状态',
                representativeFrameTime: 1.4,
                representativeFrameNote: '该状态最稳定的代表画面'
              }
            ]
          }
        ],
        timeAnchors: [
          {
            startTime: 0,
            endTime: 7,
            sceneSummary: '片段解释',
            scenePrompt: '该片段可直接复用的片段提示词',
            representativeFrameTime: 1.6,
            representativeFrameNote: '该大片段的典型帧说明',
            backgroundName: '场景名称',
            shots: [
              {
                id: 'shot_1',
                startTime: 0,
                endTime: 2,
                summary: '镜头解释',
                prompt:
                  '@角色名 位于画面中的明确位置，在 #场景名称 中完成该镜头动作，包含景别、机位、运动方向、视线和遮挡关系的可编辑中文提示词，不要字幕',
                sceneNames: ['场景名称'],
                characterNames: ['角色名'],
                representativeFrameTime: 1.1,
                representativeFrameNote: '该镜头的典型帧说明',
                ...speechSchema
              }
            ]
          }
        ]
      },
      null,
      2
    ),
    `视频文件名：${video?.filename ?? 'unknown'}`,
    `视频时长（秒）：${metadata?.duration ?? video?.duration ?? 'unknown'}`,
    `分析选项：${JSON.stringify({
      extractSubtitles: normalizedOptions.extractSubtitles,
      parseAudio: normalizedOptions.parseAudio,
      styleMode: normalizedOptions.styleMode
    })}`,
    '要求：',
    '1. plot 用中文概括整条视频的主要剧情、事件推进和结局走向，适合后续片段生成使用。',
    '2. characters 只返回真正重要的角色，name 要稳定；如果无法识别正式名字，就使用稳定标签，例如 主角A、反派A。',
    '3. appearancePrompt 必须是可直接用于视频生成的人物外观设定；personalityPrompt 用中文概括性格气质、情绪底色和表演风格。',
    '4. 每个 character 都要返回 representativeFrameTime 和 representativeFrameNote，方便后续抽典型帧生成三视图。',
    '5. 每个 character 都必须返回 stateTimeline，用整片绝对秒数描述该角色在全片中的阶段性连续状态。',
    '6. stateTimeline 要尽量细，优先覆盖会影响后续重生成连续性的稳定变化，例如受伤、包扎、脏污、破损、湿身、妆造变化、疲惫程度变化、道具佩戴变化、残缺持续状态等；短暂且不稳定的微表情不要单独拆成状态。',
    '7. stateTimeline 的每个节点都必须包含 id、startTime、endTime、stateName、summary、continuityPrompt、representativeFrameTime、representativeFrameNote；状态之间按时间升序，尽量不要重叠。',
    '8. continuityPrompt 必须能直接服务后续视频生成连续性控制，要清楚说明这个阶段必须延续的身体状态、服装状态、妆造状态和可见损伤或变化。',
    '9. 当角色在整片里出现明显阶段切换时，要及时新开状态节点，不要把“完好 -> 受伤 -> 包扎 -> 残缺持续”混成一个笼统状态。',
    '10. timeAnchors 必须覆盖完整视频，startTime 和 endTime 用整片绝对秒数，按时间升序、无重叠。',
    '11. 每个 timeAnchor 代表一个后续可独立生成的大剧情片段，边界优先对齐场景变化和完整动作阶段，不要机械均分。',
    '12. 每个 timeAnchor 都要返回 sceneSummary、scenePrompt、backgroundName、representativeFrameTime、representativeFrameNote。',
    '13. 同一场景反复出现时，backgroundName 必须保持稳定，方便后端把它们合并成同一个场景资源。',
    '14. 每个 timeAnchor 内都必须返回 shots；shots 是后续小镜头切片与生成的唯一真值来源。',
    '15. shots 必须尽量按真实镜头边界细分，优先对齐剪辑点、景别变化、机位变化、人物左中右站位变化、动作 beat、视线切换、焦点转移和说话节奏变化。',
    '16. 对 60 秒左右的视频，要尽量把观众能明显感知到的真实镜头都拆出来；除非画面长时间稳定且动作单一，否则单个 shot 尽量不要超过 4 秒。',
    '17. 每个 shot 的 startTime 和 endTime 都是整片绝对秒数，严格落在所属 timeAnchor 内，尽量精确到 0.1 秒。',
    speechEnabled
      ? '18. 每个 shot 都必须返回 id、summary、prompt、sceneNames、characterNames、representativeFrameTime、representativeFrameNote、speech，sceneNames 和 characterNames 都不能为空。'
      : '18. 每个 shot 都必须返回 id、summary、prompt、sceneNames、characterNames、representativeFrameTime、representativeFrameNote，sceneNames 和 characterNames 都不能为空。',
    '19. shot.summary 要说明镜头核心动作、主体关系和切分依据，而不是只复述剧情。',
    '20. representativeFrameTime 必须选该镜头最有代表性的画面，不要机械取中点；representativeFrameNote 说明为什么这帧最适合作为预览和参考图。',
    '21. shot.prompt 必须直接服务镜头级视频生成，并同时包含至少一个 @角色名 和至少一个 #场景名。',
    '22. 每个 shot.prompt 必须包含完整的镜头描述，包括：景别（大全景/全景/中景/近景/特写）、镜头运动（固定/推进/拉远/横移/跟随）、角色数量、主次关系、人物左中右位置、前景/中景/后景层次、朝向、视线、姿态、动作轨迹、进出画方式、遮挡关系、机位角度、光线氛围。动作描述要具体（不要只写"站着"，要写"站在画面左侧，面向右侧"）。',
    '23. shot.prompt 示例："中景，固定镜头。@露西 穿白色连衣裙站在 #礼堂入口 画面中央，浑身湿透，手里紧握手机，抬眼直视前方，呼吸急促。背景是礼堂大门和暴雨。"',
    '24. 如果角色是不完整出镜、背影、手部、反打或 POV，也必须绑定稳定的人物名；如果一个 shot 涉及多个场景或多个角色，需要在 sceneNames 和 characterNames 中列全。',
    speechEnabled
      ? '25. 当 analysis_options 开启字幕或音频解析时，每个 shot 的 speech 也必须在这次整片理解里一次性返回，不允许留给后续小镜头单独分析。subtitleLines 的时间必须是相对当前 shot 本地时间，不是整片绝对时间。'
      : '25. 所有 prompt 都要明确不要字幕、不要文字、不要 UI、不要水印。',
    speechEnabled
      ? '26. speech.transcript 要写该镜头完整对白；speech.subtitleLines 要按时间升序、无重叠；speech.speechStyle 要概括语速、停顿、情绪、语气、说话力度和口型明显程度；无对白时 hasDialogue=false、transcript=""、subtitleLines=[].'
      : '26. 输出必须是合法 JSON，字段名保持与示例完全一致。',
    speechEnabled
      ? '27. 所有 prompt 都要明确不要字幕、不要文字、不要 UI、不要水印。'
      : '',
    speechEnabled ? '28. 输出必须是合法 JSON，字段名保持与示例完全一致。' : ''
  ]
    .filter(line => line !== '')
    .join('\n');

  const finalPrompt = [fixedStructurePrompt, `风格模式：${styleModeLabel}`, `风格段（可编辑）：\n${stylePrompt}`].join(
    '\n\n'
  );

  return {
    fixedStructurePrompt,
    stylePrompt,
    finalPrompt,
    styleMode: normalizedOptions.styleMode,
    styleModeLabel
  };
};

const buildVideoAnalysisPrompt = ({ video, metadata, analysisOptions = null }) => {
  return buildVideoAnalysisPromptSections({ video, metadata, analysisOptions }).finalPrompt;
};

const buildSegmentAnalysisPromptSections = ({
  segment,
  overallAnalysis,
  analysisOptions = null,
  styleMode: styleModeOverride = '',
  segmentAnalysisStylePrompt = ''
}) => {
  const fallbackAnalysisOptions =
    analysisOptions ??
    overallAnalysis?.analysis_options ??
    overallAnalysis?.analysisOptions ??
    segment?.analysis?.analysisOptions ??
    null;
  const normalizedOptions = getNormalizedAnalysisOptionsForPrompts(fallbackAnalysisOptions);
  const resolvedStyleMode = normalizeStyleMode(styleModeOverride || normalizedOptions.styleMode);
  const styleModeLabel = STYLE_MODE_LABELS[resolvedStyleMode] ?? STYLE_MODE_LABELS[DEFAULT_STYLE_MODE];
  const stylePrompt =
    segmentAnalysisStylePrompt ||
    resolveStyleTemplate({
      styleMode: resolvedStyleMode,
      styleTemplates: normalizedOptions.styleTemplates,
      templateKey: 'segmentAnalysisStylePrompt'
    });
  const currentBackgroundBinding = {
    backgroundId: segment?.analysis?.backgroundId ?? segment?.backgroundId ?? '',
    backgroundAction: segment?.analysis?.backgroundAction ?? segment?.backgroundAction ?? '',
    backgroundName: segment?.analysis?.backgroundName ?? segment?.backgroundName ?? '',
    backgroundPrompt: segment?.analysis?.backgroundPrompt ?? segment?.backgroundPrompt ?? '',
    scenePrompt: segment?.analysis?.scenePrompt ?? segment?.scenePrompt ?? '',
    sceneSummary: segment?.analysis?.sceneSummary ?? segment?.sceneSummary ?? segment?.scene ?? ''
  };

  const fixedStructurePrompt = [
    '你是一名资深短视频片段拆解助手。',
    '请分析输入的视频片段，并严格返回 JSON，不要输出 Markdown、解释或额外文本。',
    '本次片段分析只能刷新大片段理解与大片段 prompt，不要重新拆 shots，也不要改写 JSON 结构。',
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
    '3. prompt 必须为后续视频生成可直接编辑的中文提示词，只刷新大片段理解，不要重新拆分 shots。',
    '4. prompt 中涉及角色时，用 @角色名 标记，而不是展开成长描述。',
    '5. prompt 中涉及场景时，用 #场景名 标记，而不是直接展开真实场景资源提示词。',
    '6. 如果片段中出现多个场景，请在 scenes 中列全，并在 prompt 里按顺序引用对应的 #场景名。',
    '7. 当前片段必须服从已绑定的 backgroundId/backgroundAction/backgroundName，不要重新发明新的场景决策。',
    '8. 如果当前片段标记为 reuse_existing，需要在 scene 和 prompt 中强调延续同一场景资源，只变化动作、表演或镜头阶段。',
    '9. 输出必须是有效 JSON。'
  ].join('\n');

  const finalPrompt = [fixedStructurePrompt, `风格模式：${styleModeLabel}`, `风格段（可编辑）：\n${stylePrompt}`].join(
    '\n\n'
  );

  return {
    fixedStructurePrompt,
    stylePrompt,
    finalPrompt,
    styleMode: resolvedStyleMode,
    styleModeLabel
  };
};

const buildSegmentAnalysisPrompt = ({
  segment,
  overallAnalysis,
  analysisOptions = null,
  styleMode = '',
  segmentAnalysisStylePrompt = ''
}) => {
  return buildSegmentAnalysisPromptSections({
    segment,
    overallAnalysis,
    analysisOptions,
    styleMode,
    segmentAnalysisStylePrompt
  }).finalPrompt;
};

const normalizePromptOptimizationMode = (mode = 'generation') => {
  return ['generation', 'character_resource', 'scene_resource', 'shot_generation'].includes(String(mode ?? '').trim())
    ? String(mode ?? '').trim()
    : 'generation';
};

const buildPromptOptimizationPrompt = ({
  prompt,
  characters,
  backgrounds,
  mode = 'generation',
  segmentPrompt = '',
  shotPrompt = '',
  sceneNames = [],
  characterNames = [],
  styleMode = DEFAULT_STYLE_MODE,
  styleTemplates = null
}) => {
  const normalizedMode = normalizePromptOptimizationMode(mode);
  const stylePrompt = resolveStyleTemplate({
    styleMode,
    styleTemplates,
    templateKey: 'promptOptimizationStylePrompt'
  });

  if (normalizedMode === 'character_resource') {
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
      `当前风格模式：${STYLE_MODE_LABELS[normalizeStyleMode(styleMode)] ?? STYLE_MODE_LABELS[DEFAULT_STYLE_MODE]}`,
      `风格约束：${stylePrompt}`,
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

  if (normalizedMode === 'scene_resource') {
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
      `当前风格模式：${STYLE_MODE_LABELS[normalizeStyleMode(styleMode)] ?? STYLE_MODE_LABELS[DEFAULT_STYLE_MODE]}`,
      `风格约束：${stylePrompt}`,
      `场景资源库：${safeStringify(backgrounds ?? [])}`,
      '要求：',
      '1. 只优化场景本身，不要引入人物或角色动作。',
      '2. 强调空间结构、材质、光线、景深和镜头角度兼容性。',
      '3. 输出适合作为多角度背景参考图的纯场景提示词。',
      '4. 不要使用 @角色名 或 #场景名。',
      '5. 只返回 JSON。'
    ].join('\n');
  }

  if (normalizedMode === 'shot_generation') {
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
      `当前风格模式：${STYLE_MODE_LABELS[normalizeStyleMode(styleMode)] ?? STYLE_MODE_LABELS[DEFAULT_STYLE_MODE]}`,
      `风格约束：${stylePrompt}`,
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
      '5. 人物身份和外形主要依赖角色三视图资源与当前提示词锁定；原片镜头更多用于继承站位、机位、动作和节奏，不要把优化结果写成逐帧复制原片的描述。',
      '6. 需要与大片段最终提示词保持叙事和视觉连续性，尽量还原原片镜头语言，但生成结果应像同一镜头的重拍版本，允许表情、材质、光影和背景小物有合理差异。',
      '7. 如果给了镜头涉及场景和角色，优先围绕这些对象优化。',
      '8. 只返回 JSON。'
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
    `当前风格模式：${STYLE_MODE_LABELS[normalizeStyleMode(styleMode)] ?? STYLE_MODE_LABELS[DEFAULT_STYLE_MODE]}`,
    `风格约束：${stylePrompt}`,
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

const buildCharacterViewPrompts = ({
  resourceName,
  prompt,
  appearancePrompt = '',
  personalityPrompt = '',
  styleMode = DEFAULT_STYLE_MODE,
  styleTemplates = null
}) => {
  const basePrompt = String(prompt || '').trim();
  const appearanceLine = String(appearancePrompt || '').trim();
  const personalityLine = String(personalityPrompt || '').trim();
  const stylePrompt = resolveStyleTemplate({
    styleMode,
    styleTemplates,
    templateKey: 'characterThreeViewStylePrompt'
  });

  return [
    {
      id: 'front',
      label: '正面',
      shortLabel: 'F',
      prompt: [
        `请使用 Gemini 生图模型生成角色 ${resourceName || '未命名角色'} 的三视图之一：正面视图。`,
        '要求：单人、全身、居中站立、正对镜头、中性站姿、完整保留头部到脚部。',
        '要求：纯白无缝背景，背景不能带任何场景、环境、道具、阴影文字、拼贴版式或其他人物。',
        `风格要求：${stylePrompt}`,
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
      shortLabel: 'S',
      prompt: [
        `请使用 Gemini 生图模型生成角色 ${resourceName || '未命名角色'} 的三视图之一：左侧面视图。`,
        '要求：单人、全身、严格侧身站立、镜头平视、完整保留头部到脚部。',
        '要求：背景必须保持纯白无缝，与正面视图保持相同布光和材质表达，不要额外角色和道具。',
        `风格要求：${stylePrompt}`,
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
      shortLabel: 'B',
      prompt: [
        `请使用 Gemini 生图模型生成角色 ${resourceName || '未命名角色'} 的三视图之一：背面视图。`,
        '要求：单人、全身、背对镜头、中性站姿、完整保留头部到脚部。',
        '要求：背景必须保持纯白无缝，不要文字、不要道具、不要额外人物，强调服装背部结构和发型后部轮廓。',
        `风格要求：${stylePrompt}`,
        appearanceLine ? `角色外表描述：${appearanceLine}` : '',
        personalityLine ? `角色性格气质：${personalityLine}` : '',
        `角色资源提示词：${basePrompt || '无'}`
      ]
        .filter(Boolean)
        .join('\n')
    }
  ];
};

const buildSceneAnglePrompts = ({
  resourceName,
  prompt,
  styleMode = DEFAULT_STYLE_MODE,
  styleTemplates = null
}) => {
  const basePrompt = String(prompt || '').trim();
  const stylePrompt = resolveStyleTemplate({
    styleMode,
    styleTemplates,
    templateKey: 'sceneThreeViewStylePrompt'
  });

  return [
    {
      id: 'establishing',
      label: '正视广角',
      shortLabel: 'A',
      prompt: [
        `请使用 Gemini 生图模型为场景 ${resourceName || '未命名场景'} 生成第一张背景参考图：正视广角建立镜头。`,
        '要求：只生成纯场景背景，不要人物，不要文字，不要水印，不要 UI 元素。',
        `风格要求：${stylePrompt}`,
        '要求：突出空间结构、主背景层次、材质、光线方向与景深关系，适合作为主场景参考。',
        `场景资源提示词：${basePrompt || '无'}`
      ].join('\n')
    },
    {
      id: 'three-quarter',
      label: '45度斜侧',
      shortLabel: 'B',
      prompt: [
        `请使用 Gemini 生图模型为场景 ${resourceName || '未命名场景'} 生成第二张背景参考图：45 度斜侧视角。`,
        `风格要求：${stylePrompt}`,
        '要求：保持与第一张相同场景、相同时间与布光逻辑，只改变观察角度。',
        '要求：只生成纯背景，不要人物，不要文字，强调空间转折、前中后景和透视关系。',
        `场景资源提示词：${basePrompt || '无'}`
      ].join('\n')
    },
    {
      id: 'elevated',
      label: '高位俯视',
      shortLabel: 'C',
      prompt: [
        `请使用 Gemini 生图模型为场景 ${resourceName || '未命名场景'} 生成第三张背景参考图：高位三分之四俯视角。`,
        `风格要求：${stylePrompt}`,
        '要求：保持同一场景与同一视觉设定，只改变机位高度与俯视角度，便于后续做场景补充参考。',
        '要求：只生成纯背景，不要人物，不要文字，突出地面结构、天花结构或纵深层次。',
        `场景资源提示词：${basePrompt || '无'}`
      ].join('\n')
    }
  ];
};

export {
  buildCharacterViewPrompts,
  buildPromptOptimizationPrompt,
  buildSceneAnglePrompts,
  buildSegmentAnalysisPrompt,
  buildSegmentAnalysisPromptSections,
  buildVideoAnalysisPrompt,
  buildVideoAnalysisPromptSections,
  getNormalizedAnalysisOptionsForPrompts,
  safeStringify
};
