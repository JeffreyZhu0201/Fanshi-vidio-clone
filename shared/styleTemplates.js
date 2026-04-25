const DEFAULT_STYLE_MODE = 'realistic';

const STYLE_MODE_OPTIONS = Object.freeze([
  {
    value: 'realistic',
    label: '写实'
  },
  {
    value: 'comic_drama',
    label: '漫剧'
  }
]);

const STYLE_MODE_LABELS = Object.freeze(
  STYLE_MODE_OPTIONS.reduce((accumulator, item) => {
    accumulator[item.value] = item.label;
    return accumulator;
  }, {})
);

const EDITABLE_STYLE_TEMPLATE_KEYS = Object.freeze(['videoAnalysisStylePrompt', 'segmentAnalysisStylePrompt']);

const STYLE_TEMPLATE_PRESETS = Object.freeze({
  realistic: Object.freeze({
    videoAnalysisStylePrompt:
      '整体理解请按写实影视重建思路输出。默认按真人电影质感理解人物、场景和镜头，不要把角色、布景或动作卡通化。人物外观、服装材质、肤色、布光、镜头运动和景深关系要贴近真实拍摄语法，优先保留原片的现实空间逻辑与表演细节。',
    segmentAnalysisStylePrompt:
      '当前大片段提示词请继续按写实影视风格整理。保持真人电影镜头语言、真实材质、真实布光、真实动作惯性和真实空间关系，避免夸张漫画化表达；重点把人物站位、视线、景别、机位和运动关系写清楚。',
    characterThreeViewStylePrompt:
      '风格统一为写实影视美术设定。强调真人比例、真实服装结构、真实材质、稳定五官和清晰发型轮廓，适合作为后续写实视频生成的人物形象真值。',
    sceneThreeViewStylePrompt:
      '风格统一为写实影视场景设定。强调真实空间结构、真实材质、真实布光和可连续复用的摄影空间关系，适合作为写实视频重建的场景真值。',
    videoGenerationStylePrompt:
      '整体视觉风格保持写实影视质感，优先还原原片的真实人物比例、真实服装材质、真实场景结构、真实光线方向和真实镜头运动，不要生成漫画线稿感、夸张二次元比例或明显插画质感。生成结果要像同一镜头的重拍版本：人物身份、站位、镜头节奏和空间结构与原片高度相似，但表情细节、材质纹理、背景小物和光影层次允许合理重构，不要逐帧临摹原片。',
    promptOptimizationStylePrompt:
      '优化后的提示词必须继续服务写实影视生成，强调真实表演、真实构图、真实空间关系和真实光影，不要改写成漫画分镜或二次元角色描述。 '
  }),
  comic_drama: Object.freeze({
    videoAnalysisStylePrompt:
      '整体理解请按国漫影视化风格输出。人物、场景和镜头都要适配漫剧重建：允许明确分镜感、轮廓感和漫画化美术概括，但仍要保持影视连续性、镜头可执行性和人物身份稳定。不要写成日漫纯赛璐璐，也不要写成夸张美漫；目标是国漫影视化、厚涂与赛璐璐混合、人物轮廓稳定、场景漫画化但镜头语言真实。',
    segmentAnalysisStylePrompt:
      '当前大片段提示词请按国漫影视化风格整理。保持分镜感、角色轮廓稳定、色块与光影概括更明确，但镜头调度、人物站位、视线关系、运动节奏和空间连续性仍要符合真实影视镜头语法。',
    characterThreeViewStylePrompt:
      '风格统一为国漫影视化角色设定。强调稳定人物轮廓、清晰发型与服装剪影、适度厚涂与赛璐璐混合、影视化光影，但不要变成夸张 Q 版、纯日漫扁平赛璐璐或美漫画风。',
    sceneThreeViewStylePrompt:
      '风格统一为国漫影视化场景设定。强调漫画化概括的空间层次、明确轮廓和影视化布光，同时保持可复用的真实场景结构与镜头连续性。',
    videoGenerationStylePrompt:
      '整体视觉风格保持国漫影视化。人物比例、轮廓和妆造要稳定，画面允许更强的分镜感、边缘概括和漫画化色彩组织，但镜头运动、空间关系、动作衔接和表演节奏仍需贴近原片，避免纯写实或纯二次元平面化。生成结果要像同一镜头的国漫影视化重拍版本：人物身份、站位、镜头节奏和空间结构与原片高度相似，但表情细节、材质纹理、背景小物和光影层次允许合理重构，不要逐帧复制原片。',
    promptOptimizationStylePrompt:
      '优化后的提示词必须服务国漫影视化生成，强调分镜感、角色轮廓稳定、场景漫画化概括和影视连续性，但不要偏成日漫纯赛璐璐、美漫夸张透视或写实摄影描述。'
  })
});

const isKnownStyleMode = (value) => STYLE_MODE_OPTIONS.some((item) => item.value === value);

const normalizeStyleMode = (value) => {
  const normalizedValue = String(value ?? '').trim().toLowerCase();
  return isKnownStyleMode(normalizedValue) ? normalizedValue : DEFAULT_STYLE_MODE;
};

const cloneEditableStyleTemplates = (sourceTemplates = null) => {
  const normalizedTemplates = {};

  Object.keys(STYLE_TEMPLATE_PRESETS).forEach((styleMode) => {
    normalizedTemplates[styleMode] = {};

    EDITABLE_STYLE_TEMPLATE_KEYS.forEach((templateKey) => {
      if (sourceTemplates?.[styleMode] && Object.prototype.hasOwnProperty.call(sourceTemplates[styleMode], templateKey)) {
        normalizedTemplates[styleMode][templateKey] = String(sourceTemplates[styleMode][templateKey] ?? '');
        return;
      }

      normalizedTemplates[styleMode][templateKey] = STYLE_TEMPLATE_PRESETS[styleMode][templateKey];
    });
  });

  return normalizedTemplates;
};

const resolveStyleTemplate = ({
  styleMode = DEFAULT_STYLE_MODE,
  styleTemplates = null,
  templateKey = ''
} = {}) => {
  const normalizedStyleMode = normalizeStyleMode(styleMode);

  if (
    EDITABLE_STYLE_TEMPLATE_KEYS.includes(templateKey) &&
    styleTemplates?.[normalizedStyleMode] &&
    Object.prototype.hasOwnProperty.call(styleTemplates[normalizedStyleMode], templateKey)
  ) {
    return String(styleTemplates[normalizedStyleMode][templateKey] ?? '');
  }

  return String(STYLE_TEMPLATE_PRESETS[normalizedStyleMode]?.[templateKey] ?? '').trim();
};

const getEditableStyleTemplateDefaults = () => cloneEditableStyleTemplates();

export {
  DEFAULT_STYLE_MODE,
  EDITABLE_STYLE_TEMPLATE_KEYS,
  STYLE_MODE_LABELS,
  STYLE_MODE_OPTIONS,
  STYLE_TEMPLATE_PRESETS,
  cloneEditableStyleTemplates,
  getEditableStyleTemplateDefaults,
  normalizeStyleMode,
  resolveStyleTemplate
};
