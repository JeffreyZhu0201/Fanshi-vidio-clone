import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import HoverPopover from './HoverPopover.jsx';
import ModalSheet from './ModalSheet.jsx';
import ProgressBar from './ProgressBar.jsx';
import PromptEditor from './PromptEditor.jsx';
import PromptPreview from './PromptPreview.jsx';
import SectionPanel from './SectionPanel.jsx';
import StatusBadge from './StatusBadge.jsx';
import VideoFramePreview from './VideoFramePreview.jsx';
import { useAppStore } from '../store/appStore.js';
import {
  generateResourceImages as generateResourceImagesRequest,
  getResourceImages,
  optimizePrompt as optimizePromptRequest,
  toAbsoluteAssetUrl,
  updateAnalysisCharacters as updateAnalysisCharactersRequest
} from '../services/api.js';
import { formatDuration } from '../utils/formatDuration.js';
import { buildVideoAnalysisPromptSections } from '../utils/promptBlueprints.js';
import {
  buildCharacterViewPrompts as buildStyledCharacterViewPrompts,
  buildSceneAnglePrompts as buildStyledSceneAnglePrompts
} from '../../../shared/promptBlueprints.js';
import {
  DEFAULT_STYLE_MODE,
  STYLE_MODE_LABELS,
  STYLE_MODE_OPTIONS,
  getEditableStyleTemplateDefaults,
  normalizeStyleMode,
  resolveStyleTemplate
} from '../../../shared/styleTemplates.js';

const EMPTY_ITEMS = Object.freeze([]);

const TAB_ITEMS = [
  { id: 'overview', label: '总览', note: '剧情与整片情报' },
  { id: 'characters', label: '角色', note: '角色资源与三视图' },
  { id: 'scenes', label: '场景', note: '场景资源与背景资产' },
  { id: 'segments', label: '片段分解', note: '切分预案与提示词' }
];

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

const getScenePrompt = (item, fallback = '暂无片段提示词。') => {
  return item?.scenePrompt || item?.scene_prompt || fallback;
};

const getRepresentativeFrameTime = (item) => {
  const value = Number(item?.representativeFrameTime ?? item?.representative_frame_time);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const getRepresentativeFrameNote = (item, fallback = '') => {
  return (
    item?.representativeFrameNote ||
    item?.representative_frame_note ||
    item?.representativeFrameReason ||
    item?.representative_frame_reason ||
    fallback
  );
};

const normalizeResourceImageAsset = (asset) => {
  return {
    id: Number(asset.id ?? 0),
    videoId: Number(asset.video_id ?? 0),
    resourceType: asset.resource_type ?? '',
    resourceId: asset.resource_id ?? '',
    name: asset.name ?? '',
    variantId: asset.variant_id ?? '',
    variantLabel: asset.variant_label ?? '',
    sortOrder: Number(asset.sort_order ?? 0) || 0,
    sourcePrompt: asset.source_prompt ?? '',
    prompt: asset.prompt ?? '',
    status: asset.status ?? 'pending',
    assetPath: asset.asset_path ?? '',
    assetUrl: toAbsoluteAssetUrl(asset.asset_url),
    mimeType: asset.mime_type ?? '',
    representativeFrameTime:
      Number.isFinite(Number(asset.representative_frame_time)) &&
      Number(asset.representative_frame_time) >= 0
        ? Number(Number(asset.representative_frame_time).toFixed(2))
        : null,
    errorMessage: asset.error_message ?? '',
    meta: asset.meta ?? {},
    createdAt: asset.created_at,
    updatedAt: asset.updated_at
  };
};

const mergeResourceImageAssets = (currentAssets = [], nextAssets = []) => {
  const assetMap = new Map();

  [...currentAssets, ...nextAssets].forEach((asset) => {
    const assetKey = asset?.id || `${asset?.resourceType}:${asset?.resourceId}:${asset?.variantId}`;

    assetMap.set(assetKey, asset);
  });

  return Array.from(assetMap.values()).sort((left, right) => {
    const leftKey = `${left.resourceType}:${left.resourceId}`;
    const rightKey = `${right.resourceType}:${right.resourceId}`;

    if (leftKey !== rightKey) {
      return leftKey.localeCompare(rightKey, 'zh-CN');
    }

    return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  });
};

const buildPromptOverridesFromAssets = (assets = []) => {
  const promptMap = new Map();

  assets.forEach((asset) => {
    const resourceKey = `${asset.resourceType}:${asset.resourceId}`;

    if (!promptMap.has(resourceKey) && asset.sourcePrompt) {
      promptMap.set(resourceKey, {
        prompt: asset.sourcePrompt,
        highlightedPrompt: ''
      });
    }
  });

  return Object.fromEntries(promptMap.entries());
};

const summarizeResourceAssetError = (message = '') => {
  const normalizedMessage = String(message ?? '').trim();

  if (!normalizedMessage) {
    return '';
  }

  if (/status 503/iu.test(normalizedMessage) && /distributor|无可用渠道/iu.test(normalizedMessage)) {
    return '当前 Gemini 生图渠道不可用，请稍后重试或切换可用渠道。';
  }

  if (/status 429|quota|resource has been exhausted|并发/iu.test(normalizedMessage)) {
    return '当前 Gemini 生图额度或并发已耗尽，请稍后重试。';
  }

  if (/未配置远端密钥或地址/iu.test(normalizedMessage)) {
    return 'Gemini 生图服务未配置完成，请先检查后端图片模型密钥和地址。';
  }

  return normalizedMessage;
};

const getResourceGenerationSummary = (assets = []) => {
  const completedCount = assets.filter((asset) => asset.status === 'completed').length;
  const failedAssets = assets.filter((asset) => asset.status === 'failed');
  const failedCount = failedAssets.length;
  const errorSummary = Array.from(
    new Set(failedAssets.map((asset) => summarizeResourceAssetError(asset.errorMessage)).filter(Boolean))
  ).join('；');

  return {
    completedCount,
    failedCount,
    partialSuccess: completedCount > 0 && failedCount > 0,
    errorSummary
  };
};

const getBackgroundActionLabel = (backgroundAction) => {
  return backgroundAction === 'reuse_existing' ? '复用背景' : '新建场景';
};

const getBackgroundActionStatus = (backgroundAction) => {
  return backgroundAction === 'reuse_existing' ? 'completed' : 'processing';
};

const getBackgroundAssetStatusLabel = (backgroundAsset) => {
  if (!backgroundAsset) {
    return '待创建资产';
  }

  if (backgroundAsset.status === 'completed') {
    return '资产已就绪';
  }

  if (backgroundAsset.status === 'failed') {
    return '资产失败';
  }

  if (backgroundAsset.status === 'processing') {
    return '资产生成中';
  }

  return '等待生成';
};

const getMockFailureSummary = (analysis) => {
  const remoteError = String(analysis?.remote_error || '');

  if (analysis?.fallback_reason === 'missing_remote_config') {
    return 'Gemini 远端配置缺失，当前展示的是本地回退结果。';
  }

  if (/status 429|resource has been exhausted|quota/iu.test(remoteError)) {
    return 'Gemini 真实分析失败，当前展示的是本地回退结果。上游返回 429，额度或并发已耗尽。';
  }

  return 'Gemini 真实分析失败，当前展示的是本地回退结果。';
};

const shortenText = (value = '', limit = 90) => {
  const normalizedValue = String(value || '').trim();

  if (normalizedValue.length <= limit) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, limit).trim()}…`;
};

const formatFrameIntel = (frameTime) => {
  if (frameTime === null || frameTime === undefined) {
    return '未记录典型帧';
  }

  return `整片 ${formatDuration(frameTime)}`;
};

const MetricCard = ({ label, value, detail }) => {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">{label}</p>
      <p className="mt-1.5 text-lg font-black text-white">{value}</p>
      <p className="mt-1 text-[11px] leading-5 text-white/55">{detail}</p>
    </div>
  );
};

MetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  detail: PropTypes.string.isRequired
};

const createResourceEditorState = () => ({
  resourceType: '',
  resourceId: '',
  resourceName: '',
  frameTime: null,
  frameNote: '',
  appearancePrompt: '',
  personalityPrompt: '',
  voiceProfile: null,
  description: '',
  sourcePrompt: '',
  draftPrompt: '',
  highlightedPrompt: '',
  stateTimeline: []
});

const normalizeEditorFrameTime = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? Number(parsedValue.toFixed(2)) : null;
};

const createCharacterStateTimelineItem = (stateItem = {}, index = 0, fallbackStartTime = 0, fallbackEndTime = 1) => {
  const startTime =
    normalizeEditorFrameTime(stateItem.startTime ?? stateItem.start_time) ?? Number(fallbackStartTime.toFixed(2));
  const safeFallbackEnd = Math.max(startTime + 0.3, fallbackEndTime);
  const endTime =
    normalizeEditorFrameTime(stateItem.endTime ?? stateItem.end_time) ?? Number(safeFallbackEnd.toFixed(2));

  return {
    id: String(stateItem.id ?? `state_${index + 1}`),
    startTime: startTime.toFixed(2),
    endTime: Math.max(startTime + 0.3, endTime).toFixed(2),
    stateName: String(stateItem.stateName ?? stateItem.state_name ?? '').trim(),
    summary: String(stateItem.summary ?? '').trim(),
    continuityPrompt: String(stateItem.continuityPrompt ?? stateItem.continuity_prompt ?? '').trim(),
    representativeFrameTime:
      normalizeEditorFrameTime(stateItem.representativeFrameTime ?? stateItem.representative_frame_time) !== null
        ? Number(
            normalizeEditorFrameTime(stateItem.representativeFrameTime ?? stateItem.representative_frame_time).toFixed(2)
          ).toFixed(2)
        : '',
    representativeFrameNote: String(
      stateItem.representativeFrameNote ??
        stateItem.representative_frame_note ??
        stateItem.representativeFrameReason ??
        stateItem.representative_frame_reason ??
        ''
    ).trim(),
    representativeFrameImagePath:
      String(stateItem.representativeFrameImagePath ?? stateItem.representative_frame_image_path ?? '').trim(),
    representativeFrameImageUrl: toAbsoluteAssetUrl(
      stateItem.representativeFrameImageUrl ?? stateItem.representative_frame_image_url
    )
  };
};

const isResourceEditorEmpty = (state) => {
  return !state?.resourceType && !state?.resourceId && !state?.resourceName && !state?.draftPrompt;
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

  // 只生成一张包含三个视角的图片
  return [
    {
      id: 'turnaround',
      label: '三视图',
      shortLabel: '三视图',
      prompt: [
        appearanceLine || basePrompt || `角色 ${resourceName || '未命名角色'}`,
        personalityLine ? `性格气质：${personalityLine}` : ''
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
      shortLabel: 'A',
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
      shortLabel: 'B',
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
      shortLabel: 'C',
      prompt: [
        `请使用 Gemini 生图模型为场景 ${resourceName || '未命名场景'} 生成第三张背景参考图：高位三分之四俯视角。`,
        '要求：保持同一场景与同一视觉设定，只改变机位高度与俯视角度，便于后续做场景补充参考。',
        '要求：只生成纯背景，不要人物，不要文字，突出地面结构、天花结构或纵深层次。',
        `场景资源提示词：${basePrompt || '无'}`
      ].join('\n')
    }
  ];
};

const AnalysisDisplay = ({
  video = null,
  analysis = null,
  resourceRefreshKey = 0,
  backgroundAssets = [],
  backgroundAssetsLoading = false,
  backgroundAssetsError = '',
  className = '',
  compactMode = false,
  analysisOptions = {
    extractSubtitles: true,
    parseAudio: true,
    styleMode: DEFAULT_STYLE_MODE,
    styleTemplates: getEditableStyleTemplateDefaults()
  },
  loading = false,
  error = '',
  progress = 0,
  status = 'idle',
  statusMessage = '',
  splitProgress = {
    status: 'idle',
    progress: 0,
    message: ''
  },
  onAnalyze,
  onAnalysisOptionsChange = () => {},
  onAnalysisUpdated = () => {},
  onSplit
}) => {
  const [activeTab, setActiveTab] = useState(compactMode ? 'characters' : 'overview');
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [lightboxFrame, setLightboxFrame] = useState(null);
  const [analysisOptionsOpen, setAnalysisOptionsOpen] = useState(false);
  const [resourceEditorOpen, setResourceEditorOpen] = useState(false);
  const [resourceEditor, setResourceEditor] = useState(createResourceEditorState);
  const [resourcePromptOverrides, setResourcePromptOverrides] = useState({});
  const [resourceOptimizingKey, setResourceOptimizingKey] = useState('');
  const [characterTimelineSaving, setCharacterTimelineSaving] = useState(false);
  const [resourceEditorError, setResourceEditorError] = useState('');
  const [resourceImageAssets, setResourceImageAssets] = useState([]);
  const [resourceImageAssetsLoading, setResourceImageAssetsLoading] = useState(false);
  const [resourceImageAssetsError, setResourceImageAssetsError] = useState('');
  const [resourceGeneratingKeys, setResourceGeneratingKeys] = useState([]);
  const [analysisProvider, setAnalysisProvider] = useState('gemini');
  const geminiImageProvider = useAppStore((state) => state.providerStatuses.geminiImage);

  const characters = analysis?.characters ?? EMPTY_ITEMS;
  const backgrounds = analysis?.backgrounds ?? EMPTY_ITEMS;
  const timeAnchors = analysis?.time_anchors ?? EMPTY_ITEMS;
  const backgroundAssetMap = useMemo(() => {
    return new Map(backgroundAssets.map((asset) => [asset.backgroundId, asset]));
  }, [backgroundAssets]);
  const sceneCards = useMemo(() => {
    if (backgrounds.length) {
      return backgrounds;
    }

    return timeAnchors.map((anchor, index) => ({
      id: `derived-scene-${index + 1}`,
      name: `场景 ${index + 1}`,
      description: anchor.sceneSummary || '暂无场景概览',
      scenePrompt: getScenePrompt(anchor, anchor.sceneSummary || '暂无片段提示词。'),
      representativeFrameTime: getRepresentativeFrameTime(anchor),
      representativeFrameNote: getRepresentativeFrameNote(anchor)
    }));
  }, [backgrounds, timeAnchors]);
  const buildCharacterResource = (character, index) => ({
    resourceType: 'character',
    resourceId: character.id || character.name || `character_${index + 1}`,
    resourceName: character.name || `角色 ${index + 1}`,
    frameTime: getRepresentativeFrameTime(character),
    frameNote: getRepresentativeFrameNote(character, '用于稳定人物形象的典型帧'),
    appearancePrompt: getCharacterAppearancePrompt(character),
    personalityPrompt: getCharacterPersonalityPrompt(character),
    voiceProfile: character?.voiceProfile ?? character?.voice_profile ?? null,
    sourcePrompt: buildCharacterResourcePrompt(character),
    draftPrompt: buildCharacterResourcePrompt(character),
    highlightedPrompt: '',
    stateTimeline: Array.isArray(character?.stateTimeline ?? character?.state_timeline)
      ? (character?.stateTimeline ?? character?.state_timeline).map((stateItem, stateIndex) =>
          createCharacterStateTimelineItem(
            stateItem,
            stateIndex,
            getRepresentativeFrameTime(character) ?? 0,
            video?.duration ?? (getRepresentativeFrameTime(character) ?? 1)
          )
        )
      : []
  });

  const buildSceneResource = (background, index) => ({
    resourceType: 'scene',
    resourceId: background?.id || `background_${index + 1}`,
    resourceName: getBackgroundName(background, index),
    frameTime: getRepresentativeFrameTime(background),
    frameNote: getRepresentativeFrameNote(background, '用于表示场景空间与光线关系的典型帧'),
    description: getBackgroundDescription(background),
    sourcePrompt: getScenePrompt(background, getBackgroundDescription(background)),
    draftPrompt: getScenePrompt(background, getBackgroundDescription(background)),
    highlightedPrompt: ''
  });

  const getResourceKey = (resource) => {
    return `${resource?.resourceType || ''}:${resource?.resourceId || ''}`;
  };

  const getResourceImageAssetsForResource = (resource) => {
    if (!resource?.resourceType || !resource?.resourceId) {
      return [];
    }

    return resourceImageAssets
      .filter((asset) => asset.resourceType === resource.resourceType && asset.resourceId === resource.resourceId)
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  };

  const getFailedVariantIdsForResource = (resource) => {
    return new Set(
      getResourceImageAssetsForResource(resource)
        .filter((asset) => asset.status === 'failed')
        .map((asset) => asset.variantId)
    );
  };

  const getResolvedResourcePrompt = (resource) => {
    if (!resource) {
      return '';
    }

    return resourcePromptOverrides[getResourceKey(resource)]?.prompt || resource.sourcePrompt || '';
  };

  const getResolvedResourceHighlight = (resource) => {
    if (!resource) {
      return '';
    }

    return resourcePromptOverrides[getResourceKey(resource)]?.highlightedPrompt || '';
  };

  const getResourceVariantPrompts = (resource) => {
    const prompt = getResolvedResourcePrompt(resource);
    const styleMode = normalizeStyleMode(analysisOptions?.styleMode ?? analysisOptions?.style_mode ?? DEFAULT_STYLE_MODE);
    const styleTemplates = analysisOptions?.styleTemplates ?? analysisOptions?.style_templates ?? getEditableStyleTemplateDefaults();

    return resource?.resourceType === 'character'
      ? buildStyledCharacterViewPrompts({
          resourceName: resource.resourceName,
          prompt,
          appearancePrompt: resource.appearancePrompt,
          personalityPrompt: resource.personalityPrompt,
          styleMode,
          styleTemplates
        })
      : buildStyledSceneAnglePrompts({
          resourceName: resource.resourceName,
          prompt,
          styleMode,
          styleTemplates
        });
  };

  const selectResourceEditor = (resource) => {
    if (!resource) {
      return;
    }

    const resourceKey = getResourceKey(resource);
    setResourceEditor({
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      resourceName: resource.resourceName,
      frameTime: resource.frameTime ?? null,
      frameNote: resource.frameNote ?? '',
      appearancePrompt: resource.appearancePrompt ?? '',
      personalityPrompt: resource.personalityPrompt ?? '',
      voiceProfile: resource.voiceProfile ?? null,
      description: resource.description ?? '',
      sourcePrompt: resource.sourcePrompt,
      draftPrompt: resourcePromptOverrides[resourceKey]?.prompt || resource.sourcePrompt,
      highlightedPrompt: resourcePromptOverrides[resourceKey]?.highlightedPrompt || '',
      stateTimeline: Array.isArray(resource.stateTimeline)
        ? resource.stateTimeline.map((stateItem, stateIndex) =>
            createCharacterStateTimelineItem(
              stateItem,
              stateIndex,
              resource.frameTime ?? 0,
              video?.duration ?? (resource.frameTime ?? 1)
            )
          )
        : []
    });
    setResourceEditorError('');
    setResourceEditorOpen(true);
  };

  const updateResourceDraft = (nextValue) => {
    setResourceEditor((currentState) => ({
      ...currentState,
      draftPrompt: nextValue
    }));
  };

  const updateResourceEditorField = (fieldName, value) => {
    setResourceEditor((currentState) => ({
      ...currentState,
      [fieldName]: value
    }));
  };

  const updateCharacterStateItem = (stateId, partialState) => {
    setResourceEditor((currentState) => ({
      ...currentState,
      stateTimeline: (currentState.stateTimeline ?? []).map((stateItem) =>
        stateItem.id === stateId
          ? {
              ...stateItem,
              ...partialState
            }
          : stateItem
      )
    }));
    setResourceEditorError('');
  };

  const addCharacterStateItem = () => {
    setResourceEditor((currentState) => {
      const currentTimeline = Array.isArray(currentState.stateTimeline) ? currentState.stateTimeline : [];
      const lastState = currentTimeline[currentTimeline.length - 1] ?? null;
      const fallbackStart = lastState ? Number(lastState.endTime || 0) : 0;
      const fallbackEnd = Math.min(
        Number(video?.duration ?? fallbackStart + 2),
        Math.max(fallbackStart + 0.6, fallbackStart + 2)
      );

      return {
        ...currentState,
        stateTimeline: [
          ...currentTimeline,
          createCharacterStateTimelineItem(
            {
              id: `state_${Date.now()}`,
              stateName: '',
              summary: '',
              continuityPrompt: '',
              representativeFrameTime: Number(((fallbackStart + fallbackEnd) / 2).toFixed(2))
            },
            currentTimeline.length,
            fallbackStart,
            fallbackEnd
          )
        ]
      };
    });
    setResourceEditorError('');
  };

  const removeCharacterStateItem = (stateId) => {
    setResourceEditor((currentState) => ({
      ...currentState,
      stateTimeline: (currentState.stateTimeline ?? []).filter((stateItem) => stateItem.id !== stateId)
    }));
    setResourceEditorError('');
  };

  const saveCharacterTimeline = async () => {
    if (!video?.id || resourceEditor.resourceType !== 'character' || !resourceEditor.resourceId) {
      return null;
    }

    const nextCharacters = characters.map((character, index) => {
      const characterId = character?.id || character?.name || `character_${index + 1}`;
      const baseCharacter =
        typeof character === 'object'
          ? {
              ...character,
              id: characterId,
              name: character?.name || `角色 ${index + 1}`,
              appearancePrompt: character?.appearancePrompt ?? '',
              personalityPrompt: character?.personalityPrompt ?? '',
              representativeFrameTime: character?.representativeFrameTime ?? null,
              representativeFrameNote: character?.representativeFrameNote ?? '',
              stateTimeline: Array.isArray(character?.stateTimeline) ? character.stateTimeline : []
            }
          : {
              id: characterId,
              name: String(character ?? '').trim() || `角色 ${index + 1}`,
              appearancePrompt: '',
              personalityPrompt: '',
              representativeFrameTime: null,
              representativeFrameNote: '',
              stateTimeline: []
            };

      if (characterId !== resourceEditor.resourceId) {
        return baseCharacter;
      }

      return {
        ...baseCharacter,
        name: resourceEditor.resourceName,
        appearancePrompt: resourceEditor.appearancePrompt,
        personalityPrompt: resourceEditor.personalityPrompt,
        representativeFrameTime: resourceEditor.frameTime ?? null,
        representativeFrameNote: resourceEditor.frameNote ?? '',
        stateTimeline: (resourceEditor.stateTimeline ?? []).map((stateItem, stateIndex) => ({
          id: String(stateItem.id ?? `state_${stateIndex + 1}`),
          startTime: Number(stateItem.startTime),
          endTime: Number(stateItem.endTime),
          stateName: String(stateItem.stateName ?? '').trim() || `状态 ${stateIndex + 1}`,
          summary: String(stateItem.summary ?? '').trim(),
          continuityPrompt: String(stateItem.continuityPrompt ?? '').trim(),
          representativeFrameTime: String(stateItem.representativeFrameTime ?? '').trim()
            ? Number(stateItem.representativeFrameTime)
            : null,
          representativeFrameNote: String(stateItem.representativeFrameNote ?? '').trim()
        }))
      };
    });

    setCharacterTimelineSaving(true);
    setResourceEditorError('');

    try {
      const nextAnalysis = await updateAnalysisCharactersRequest(Number(video.id), nextCharacters);
      onAnalysisUpdated(nextAnalysis);
      setResourceEditor((currentState) => ({
        ...currentState,
        stateTimeline: Array.isArray(
          nextAnalysis?.characters?.find((character) => character.id === currentState.resourceId)?.stateTimeline
        )
          ? nextAnalysis.characters
              .find((character) => character.id === currentState.resourceId)
              .stateTimeline.map((stateItem, stateIndex) =>
                createCharacterStateTimelineItem(
                  stateItem,
                  stateIndex,
                  currentState.frameTime ?? 0,
                  video?.duration ?? (currentState.frameTime ?? 1)
                )
              )
          : currentState.stateTimeline
      }));
      return nextAnalysis;
    } catch (requestError) {
      setResourceEditorError(requestError?.message || '角色状态时间线保存失败，请稍后重试。');
      return null;
    } finally {
      setCharacterTimelineSaving(false);
    }
  };

  const optimizeResourcePrompt = async (resource = null, promptOverride = '') => {
    const targetResource = resource || resourceEditor;

    if (!targetResource?.resourceId) {
      return null;
    }

    const resourceKey = getResourceKey(targetResource);
    const basePrompt =
      String(promptOverride ?? '').trim() || targetResource.draftPrompt || targetResource.sourcePrompt || '';

    if (!basePrompt.trim()) {
      setResourceEditorError('请先选择资源或补充原始资源提示词，再执行优化。');
      return null;
    }

    setResourceEditor({
      resourceType: targetResource.resourceType,
      resourceId: targetResource.resourceId,
      resourceName: targetResource.resourceName,
      frameTime: targetResource.frameTime ?? null,
      frameNote: targetResource.frameNote ?? '',
      appearancePrompt: targetResource.appearancePrompt ?? '',
      personalityPrompt: targetResource.personalityPrompt ?? '',
      description: targetResource.description ?? '',
      sourcePrompt: targetResource.sourcePrompt || basePrompt,
      draftPrompt: basePrompt,
      highlightedPrompt: resource && getResourceKey(resourceEditor) !== resourceKey ? '' : resourceEditor.highlightedPrompt,
      stateTimeline: Array.isArray(targetResource.stateTimeline)
        ? targetResource.stateTimeline.map((stateItem, stateIndex) =>
            createCharacterStateTimelineItem(
              stateItem,
              stateIndex,
              targetResource.frameTime ?? 0,
              video?.duration ?? (targetResource.frameTime ?? 1)
            )
          )
        : []
    });
    setResourceEditorError('');
    setResourceOptimizingKey(resourceKey);

    try {
      const requestCharacters =
        targetResource.resourceType === 'character'
          ? [
              {
                id: targetResource.resourceId,
                name: targetResource.resourceName,
                appearancePrompt: targetResource.appearancePrompt || '',
                personalityPrompt: targetResource.personalityPrompt || ''
              }
            ]
          : [];
      const requestBackgrounds =
        targetResource.resourceType === 'scene'
          ? [
              {
                id: targetResource.resourceId,
                name: targetResource.resourceName,
                description: targetResource.description || '',
                scenePrompt: targetResource.sourcePrompt || basePrompt
              }
            ]
          : [];
      const optimizeMode =
        targetResource.resourceType === 'character'
          ? 'character_resource'
          : targetResource.resourceType === 'scene'
            ? 'scene_resource'
            : 'generation';
      const optimizedPayload = await optimizePromptRequest(
        basePrompt,
        requestCharacters,
        requestBackgrounds,
        {
          mode: optimizeMode,
          style_mode: normalizeStyleMode(analysisOptions?.styleMode ?? analysisOptions?.style_mode ?? DEFAULT_STYLE_MODE)
        }
      );

      setResourceEditor((currentState) => {
        if (getResourceKey(currentState) !== resourceKey) {
          return currentState;
        }

        return {
          ...currentState,
          draftPrompt: optimizedPayload.optimized_prompt || basePrompt,
          highlightedPrompt: optimizedPayload.highlighted_prompt || ''
        };
      });
      setResourcePromptOverrides((currentState) => ({
        ...currentState,
        [resourceKey]: {
          prompt: optimizedPayload.optimized_prompt || basePrompt,
          highlightedPrompt: optimizedPayload.highlighted_prompt || ''
        }
      }));

      return optimizedPayload;
    } catch (requestError) {
      setResourceEditorError(requestError?.message || '资源提示词优化失败，请稍后重试。');
      return null;
    } finally {
      setResourceOptimizingKey('');
    }
  };

  const refreshResourceImages = async (videoId = Number(video?.id ?? 0), options = {}) => {
    if (!videoId) {
      setResourceImageAssets([]);
      return [];
    }

    if (!options.silent) {
      setResourceImageAssetsLoading(true);
      setResourceImageAssetsError('');
    }

    try {
      const assetPayload = await getResourceImages(videoId);
      const normalizedAssets = assetPayload.map(normalizeResourceImageAsset);

      setResourceImageAssets(normalizedAssets);
      setResourcePromptOverrides((currentState) => {
        const persistedOverrides = buildPromptOverridesFromAssets(normalizedAssets);
        return Object.keys(currentState).length ? currentState : persistedOverrides;
      });

      return normalizedAssets;
    } catch (requestError) {
      setResourceImageAssetsError(requestError?.message || '资源图片加载失败，请稍后重试。');
      return [];
    } finally {
      if (!options.silent) {
        setResourceImageAssetsLoading(false);
      }
    }
  };

  const generateResourceBundle = async (resource = null, options = {}) => {
    const targetResource = resource || resourceEditor;

    if (!video?.id || !targetResource?.resourceId) {
      return null;
    }

    const resourceKey = getResourceKey(targetResource);
    const basePrompt = String(
      resource ? getResolvedResourcePrompt(targetResource) : resourceEditor.draftPrompt || getResolvedResourcePrompt(targetResource)
    ).trim();

    if (!basePrompt.trim()) {
      setResourceEditorError('请先准备资源提示词，再执行资源生成。');
      return null;
    }

    if (!geminiImageProvider?.ready) {
      const providerMessage = `Gemini 生图未就绪：${geminiImageProvider?.reason || '缺少必要配置。'}`;
      setResourceImageAssetsError(providerMessage);
      setResourceEditorError(providerMessage);
      return null;
    }

    const failedVariantIds = getFailedVariantIdsForResource(targetResource);
    const variantPrompts = getResourceVariantPrompts(targetResource);
    const requestVariants = options.failedOnly
      ? variantPrompts.filter((variant) => failedVariantIds.has(variant.id))
      : variantPrompts;

    if (!requestVariants.length) {
      const noRetryableMessage = options.failedOnly
        ? '当前没有失败资源可重试。'
        : '当前资源没有可生成的调用词。';
      setResourceImageAssetsError(noRetryableMessage);
      setResourceEditorError(noRetryableMessage);
      return null;
    }

    setResourceImageAssetsError('');
    setResourceGeneratingKeys((currentState) => [...new Set([...currentState, resourceKey])]);

    try {
      const payload = await generateResourceImagesRequest({
        video_id: Number(video.id),
        resource_type: targetResource.resourceType,
        resource_id: targetResource.resourceId,
        resource_name: targetResource.resourceName,
        source_prompt: basePrompt,
        representative_frame_time: targetResource.frameTime ?? null,
        variants: requestVariants.map((variant, index) => ({
          id: variant.id,
          label: variant.label,
          prompt: variant.prompt,
          sortOrder: index
        }))
      });
      const normalizedAssets = (payload.assets ?? []).map(normalizeResourceImageAsset);

      setResourceImageAssets((currentState) => mergeResourceImageAssets(currentState, normalizedAssets));
      setResourcePromptOverrides((currentState) => ({
        ...currentState,
        [resourceKey]: {
          prompt: basePrompt,
          highlightedPrompt: currentState[resourceKey]?.highlightedPrompt || ''
        }
      }));
      setResourceEditorError(payload.error_summary || '');

      return payload;
    } catch (requestError) {
      const message = requestError?.message || '资源生成失败，请稍后重试。';
      setResourceImageAssetsError(message);
      setResourceEditorError(message);
      return null;
    } finally {
      setResourceGeneratingKeys((currentState) => currentState.filter((item) => item !== resourceKey));
    }
  };

  useEffect(() => {
    setResourceEditor(createResourceEditorState());
    setResourceEditorOpen(false);
    setResourcePromptOverrides({});
    setResourceOptimizingKey('');
    setResourceEditorError('');
    setResourceImageAssets([]);
    setResourceImageAssetsError('');
    setResourceGeneratingKeys([]);
  }, [resourceRefreshKey, video?.id]);

  useEffect(() => {
    if (!video?.id) {
      setResourceImageAssets([]);
      return;
    }

    void refreshResourceImages(Number(video.id));
  }, [video?.id]);

  useEffect(() => {
    setResourceEditor((currentState) => {
      const currentResourceKey = getResourceKey(currentState);
      const characterResources = characters.map(buildCharacterResource);
      const sceneResources = sceneCards.map(buildSceneResource);
      const nextResource =
        [...characterResources, ...sceneResources].find((item) => getResourceKey(item) === currentResourceKey) ||
        characterResources[0] ||
        sceneResources[0] ||
        null;

      if (!nextResource) {
        return isResourceEditorEmpty(currentState) ? currentState : createResourceEditorState();
      }

      if (!currentState.resourceId || getResourceKey(nextResource) !== currentResourceKey) {
        return {
          ...nextResource,
          draftPrompt: getResolvedResourcePrompt(nextResource),
          highlightedPrompt: getResolvedResourceHighlight(nextResource)
        };
      }

      return currentState;
    });
  }, [characters, resourcePromptOverrides, sceneCards]);

  const analysisFrameSource = video?.file_url || '';
  const currentStyleMode = normalizeStyleMode(analysisOptions?.styleMode ?? analysisOptions?.style_mode ?? DEFAULT_STYLE_MODE);
  const currentStyleLabel = STYLE_MODE_LABELS[currentStyleMode] ?? STYLE_MODE_LABELS[DEFAULT_STYLE_MODE];
  const currentStyleTemplates = analysisOptions?.styleTemplates ?? analysisOptions?.style_templates ?? getEditableStyleTemplateDefaults();
  const videoAnalysisPromptSections = video
    ? buildVideoAnalysisPromptSections({
        video,
        metadata: {
          duration: video?.duration
        },
        analysisOptions
      })
    : null;
  const videoAnalysisPrompt = videoAnalysisPromptSections?.finalPrompt ?? '';
  const videoAnalysisFixedPrompt = videoAnalysisPromptSections?.fixedStructurePrompt ?? '';
  const videoAnalysisStylePrompt = videoAnalysisPromptSections?.stylePrompt ?? '';
  const isAnalysisProcessing = loading || status === 'processing';
  const handleStyleModeChange = (nextStyleMode) => {
    const normalizedStyleMode = normalizeStyleMode(nextStyleMode);
    onAnalysisOptionsChange({
      styleMode: normalizedStyleMode
    });
  };
  const handleVideoAnalysisStylePromptChange = (nextPrompt) => {
    onAnalysisOptionsChange({
      styleTemplates: {
        [currentStyleMode]: {
          ...(currentStyleTemplates?.[currentStyleMode] ?? {}),
          videoAnalysisStylePrompt: String(nextPrompt ?? '')
        }
      }
    });
  };
  const handleRestoreVideoAnalysisStylePrompt = () => {
    onAnalysisOptionsChange({
      styleTemplates: {
        [currentStyleMode]: {
          ...(currentStyleTemplates?.[currentStyleMode] ?? {}),
          videoAnalysisStylePrompt: resolveStyleTemplate({
            styleMode: currentStyleMode,
            styleTemplates: null,
            templateKey: 'videoAnalysisStylePrompt'
          })
        }
      }
    });
  };
  const analysisStatusLabel = error
    ? '整片分析失败'
    : isAnalysisProcessing
      ? '整片分析进行中'
      : analysis?.is_mock
        ? 'Gemini失败已回退'
        : analysis
          ? 'Gemini真实结果'
          : '等待分析';
  const analysisStatusTone = error
    ? 'failed'
    : isAnalysisProcessing
      ? 'processing'
      : analysis?.is_mock
        ? 'fallback'
        : analysis
          ? 'completed'
          : 'idle';
  const keyFrameCount = [...characters, ...sceneCards].filter((item) => {
    return getRepresentativeFrameTime(item) !== null;
  }).length;
  const timeAnchorPromptCount = timeAnchors.filter((anchor) => {
    return Boolean(getScenePrompt(anchor, '').trim());
  }).length;
  const optimizedCharacterCount = characters.filter((character, index) => {
    return Boolean(resourcePromptOverrides[getResourceKey(buildCharacterResource(character, index))]?.prompt);
  }).length;
  const optimizedSceneCount = sceneCards.filter((scene, index) => {
    return Boolean(resourcePromptOverrides[getResourceKey(buildSceneResource(scene, index))]?.prompt);
  }).length;
  const backgroundAssetReadyCount = backgroundAssets.filter((asset) => asset.status === 'completed').length;
  const backgroundAssetFailedCount = backgroundAssets.filter((asset) => asset.status === 'failed').length;
  const backgroundReuseCount = timeAnchors.filter((anchor) => {
    return (anchor.backgroundAction ?? anchor.background_action) === 'reuse_existing';
  }).length;
  const metrics = [
    {
      label: '角色卡片',
      value: characters.length,
      detail: '人物设定与典型帧已汇总'
    },
    {
      label: '场景卡片',
      value: sceneCards.length,
      detail: '场景描述与可复用提示词'
    },
    {
      label: '片段切分',
      value: timeAnchors.length,
      detail: '整片切分预案已生成'
    },
    {
      label: '典型帧',
      value: keyFrameCount,
      detail: '人物与场景代表帧已记录'
    }
  ];
  const tabCounts = {
    overview: metrics.length,
    characters: characters.length,
    scenes: sceneCards.length,
    segments: timeAnchors.length
  };
  const activeTabSummary = {
    overview: [
      `片段提示词 ${timeAnchorPromptCount}`,
      `典型帧 ${keyFrameCount}`,
      analysis?.is_mock ? '当前为回退结果' : 'Gemini 真实分析'
    ],
    characters: [
      `典型帧 ${characters.filter((item) => getRepresentativeFrameTime(item) !== null).length}`,
      `已优化 ${optimizedCharacterCount}`,
      '可进入角色三视图'
    ],
    scenes: [
      `背景资产 ${backgroundAssetReadyCount}/${sceneCards.length}`,
      backgroundAssetFailedCount ? `失败 ${backgroundAssetFailedCount}` : '资产状态正常',
      `已优化 ${optimizedSceneCount}`
    ],
    segments: [
      `复用背景 ${backgroundReuseCount}`,
      `片段提示词 ${timeAnchorPromptCount}`,
      `待切分 ${timeAnchors.length}`
    ]
  };

  const renderPreviewModal = () => {
    if (!lightboxFrame) {
      return null;
    }

    return (
      <ModalSheet
        open={Boolean(lightboxFrame)}
        onClose={() => setLightboxFrame(null)}
        title={lightboxFrame.title}
        description={lightboxFrame.description}
        size="lg"
      >
        {lightboxFrame.imageUrl ? (
          <div className="space-y-3">
            <img
              src={lightboxFrame.imageUrl}
              alt={lightboxFrame.title}
              className="max-h-[70vh] w-full rounded-[20px] border border-white/10 object-contain"
            />
            {lightboxFrame.note ? (
              <p className="text-sm leading-6 text-white/70">{lightboxFrame.note}</p>
            ) : null}
          </div>
        ) : (
          <VideoFramePreview
            videoUrl={lightboxFrame.videoUrl}
            timeSeconds={lightboxFrame.timeSeconds}
            originalTimeSeconds={lightboxFrame.originalTimeSeconds}
            label={lightboxFrame.label}
            note={lightboxFrame.note}
            requestedTimeLabel={lightboxFrame.requestedTimeLabel}
            className="max-w-4xl"
          />
        )}
      </ModalSheet>
    );
  };

  const renderGeneratedResourceStrip = (resource, options = {}) => {
    const variantPrompts = getResourceVariantPrompts(resource);
    const optimized = Boolean(resourcePromptOverrides[getResourceKey(resource)]?.prompt);
    const generatedAssets = getResourceImageAssetsForResource(resource);
    const generatedAssetMap = new Map(generatedAssets.map((asset) => [asset.variantId, asset]));
    const isGenerating = resourceGeneratingKeys.includes(getResourceKey(resource));
    const stackClassName = ['resource-generated-stack', options.className || ''].filter(Boolean).join(' ');

    return (
      <div className={stackClassName}>
        {variantPrompts.map((variant) => (
          <div key={`${getResourceKey(resource)}-${variant.id}`} className="resource-generated-tile">
            <div className="flex items-start justify-between gap-2">
              <span className="resource-generated-badge">{variant.shortLabel}</span>
              <span className="resource-generated-status">
                {generatedAssetMap.get(variant.id)?.status === 'completed'
                  ? '已生成'
                  : generatedAssetMap.get(variant.id)?.status === 'failed'
                    ? '失败'
                    : isGenerating
                      ? '生成中'
                      : optimized
                        ? '可生成'
                        : '待优化'}
              </span>
            </div>
            {generatedAssetMap.get(variant.id)?.assetUrl ? (
              <button
                type="button"
                className="block w-full"
                onClick={() =>
                  setLightboxFrame({
                    title: `${resource.resourceName} · ${variant.label}`,
                    description: generatedAssetMap.get(variant.id)?.prompt || resource.sourcePrompt,
                    imageUrl: generatedAssetMap.get(variant.id).assetUrl,
                    note: generatedAssetMap.get(variant.id)?.prompt || ''
                  })
                }
              >
                <img
                  src={generatedAssetMap.get(variant.id).assetUrl}
                  alt={`${resource.resourceName} ${variant.label}`}
                  className="resource-generated-image"
                />
              </button>
            ) : (
              <>
                <p className="mt-3 text-xs font-semibold text-white">{variant.label}</p>
                <p className="mt-1 text-[11px] leading-5 text-white/55">
                  {shortenText(
                    summarizeResourceAssetError(generatedAssetMap.get(variant.id)?.errorMessage) ||
                      (resource.resourceType === 'character'
                        ? '角色三视图资源位，使用 Gemini Image 调用词生成。'
                        : '场景多角度背景资源位，使用 Gemini Image 调用词生成。'),
                    54
                  )}
                </p>
              </>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderConsoleTabs = () => {
    return (
      <div className="analysis-console-tab-grid" aria-label="整片资源分析视图">
        {TAB_ITEMS.map((tab) => {
          const isActive = activeTab === tab.id;
          const summaryItems = activeTabSummary[tab.id] || [];

          return (
            <button
              key={tab.id}
              type="button"
              aria-label={tab.label}
              aria-pressed={isActive}
              className={`analysis-console-tab ${isActive ? 'analysis-console-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <div className="analysis-console-tab-topline">
                <span className="analysis-console-tab-title">{tab.label}</span>
                <span className="analysis-console-tab-count">{tabCounts[tab.id] ?? 0}</span>
              </div>
              <p className="analysis-console-tab-note">{tab.note}</p>
              <div className="analysis-console-tab-meta">
                {summaryItems.slice(0, 2).map((item) => (
                  <span key={`${tab.id}-${item}`} className="resource-mini-chip resource-mini-chip-muted">
                    {item}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  const renderResourceMatrixHeader = (columns) => {
    return (
      <div className="resource-matrix-header" aria-hidden="true">
        {columns.map((column) => (
          <span key={column} className="resource-matrix-header-cell">
            {column}
          </span>
        ))}
      </div>
    );
  };

  const renderResourcePanelHeader = ({ title, description, chips = [] }) => {
    return (
      <div className="analysis-panel-head">
        <div className="min-w-0">
          <p className="analysis-panel-kicker">Operations Console</p>
          <h4 className="analysis-panel-title">{title}</h4>
          <p className="analysis-panel-copy">{description}</p>
        </div>
        <div className="analysis-panel-chiprail">
          {chips.map((item) => (
            <span key={`${title}-${item}`} className="resource-mini-chip resource-mini-chip-muted">
              {item}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderResourceCard = (resource, options = {}) => {
    const {
      title,
      eyebrow,
      status = 'idle',
      statusLabel = '待处理',
      meta = []
    } = options;
    const resourceKey = getResourceKey(resource);
    const frameTime = resource.frameTime ?? null;
    const frameNote = resource.frameNote ?? '';
    const displayPrompt = getResolvedResourcePrompt(resource);
    const isOptimizing = resourceOptimizingKey === resourceKey;
    const isGenerating = resourceGeneratingKeys.includes(resourceKey);
    const promptStatus = resourcePromptOverrides[resourceKey]?.prompt ? '已优化' : '原始';
    const isCharacterResource = resource.resourceType === 'character';
    const promptPreviewTitle = '当前最终提示词';
    const generatedAssets = getResourceImageAssetsForResource(resource);
    const generationSummary = getResourceGenerationSummary(generatedAssets);
    const canGenerateResource = Boolean(geminiImageProvider?.ready);
    const generateResourceTitle = canGenerateResource
      ? isCharacterResource
        ? '调用 Gemini 生图生成角色三视图。'
        : '调用 Gemini 生图生成三张背景参考图。'
      : `Gemini 生图未就绪：${geminiImageProvider?.reason || '缺少必要配置。'}`;

    const primaryColumn = (
      <div className="resource-row-primary">
        <div className="resource-row-frame">
          <p className="resource-section-label">原始帧预览</p>
          <div className="resource-inline-meta">
            <span className="resource-mini-chip resource-mini-chip-muted">{formatFrameIntel(frameTime)}</span>
          </div>
          <VideoFramePreview
            videoUrl={analysisFrameSource}
            timeSeconds={frameTime}
            originalTimeSeconds={frameTime}
            label={resource.resourceName}
            note={frameNote}
            requestedTimeLabel="整片时间"
          />
        </div>

        <div className="resource-row-prompt">
          <p className="resource-section-label">{promptPreviewTitle}</p>
          <div className="resource-inline-meta">
            <span className="resource-mini-chip">{promptStatus}</span>
            <span className="resource-mini-chip resource-mini-chip-muted">
              {isCharacterResource ? '三视图建模' : '背景图建模'}
            </span>
          </div>
          {generationSummary.errorSummary ? (
            <div className="mt-3 rounded-[16px] border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-100">
              {generationSummary.partialSuccess ? '部分成功：' : '生成提醒：'}
              {generationSummary.errorSummary}
            </div>
          ) : null}

          <div
            className={`resource-prompt-box ${
              isCharacterResource ? 'resource-prompt-box-clamped' : ''
            }`}
          >
            <p
              className={`whitespace-pre-wrap text-xs leading-6 text-white/82 ${
                isCharacterResource ? 'resource-prompt-preview-text' : ''
              }`}
            >
              {displayPrompt || '暂无资源提示词。'}
            </p>
          </div>

          {isCharacterResource && resource.voiceProfile && resource.voiceProfile.summary && (
            <div className="mt-3 rounded-[14px] border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">音色特征</p>
              <p className="mt-2 text-[11px] leading-5 text-white/72">
                {resource.voiceProfile.summary}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {resource.voiceProfile.timbre && (
                  <span className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/70">
                    {resource.voiceProfile.timbre}
                  </span>
                )}
                {resource.voiceProfile.tone && (
                  <span className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/70">
                    {resource.voiceProfile.tone}
                  </span>
                )}
                {resource.voiceProfile.pace && (
                  <span className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-white/70">
                    语速{resource.voiceProfile.pace}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:border-emerald-500/35 hover:bg-emerald-500/15 disabled:opacity-50"
              disabled={isGenerating || !displayPrompt.trim() || !canGenerateResource}
              onClick={() => void generateResourceBundle(resource)}
              title={generateResourceTitle}
            >
              {isGenerating
                ? '生成中...'
                : isCharacterResource
                  ? '生成三视图'
                  : '生成背景图'}
            </button>

            {generationSummary.failedCount ? (
              <button
                type="button"
                className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition hover:border-amber-500/35 hover:bg-amber-500/15 disabled:opacity-50"
                disabled={isGenerating || !canGenerateResource}
                onClick={() => void generateResourceBundle(resource, { failedOnly: true })}
                title={generateResourceTitle}
              >
                重试失败项
              </button>
            ) : null}

            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/78 transition hover:border-white/20 hover:bg-white/[0.08] disabled:opacity-50"
              disabled={frameTime === null}
              onClick={() =>
                setLightboxFrame({
                  title: `${resource.resourceName} · 原始帧`,
                  description: frameNote,
                  videoUrl: analysisFrameSource,
                  timeSeconds: frameTime,
                  originalTimeSeconds: frameTime,
                  requestedTimeLabel: '整片时间',
                  label: resource.resourceName,
                  note: frameNote
                })
              }
            >
              放大原帧
            </button>

            <HoverPopover
              trigger="查看完整提示词"
              triggerClassName="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-black/35"
            >
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                  完整资源提示词
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-white/82">
                  {displayPrompt || '暂无资源提示词。'}
                </p>
              </div>
            </HoverPopover>
          </div>
        </div>
      </div>
    );

    const generatedColumn = (
      <div className="resource-row-generated">
        <p className="resource-section-label">生成的新资源</p>
        {renderGeneratedResourceStrip(resource)}
      </div>
    );

    return (
      <article key={resourceKey} className="resource-row-card">
        <div className="resource-row-header">
          <div className="min-w-0">
            <p className="resource-row-eyebrow">{eyebrow}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h4 className="truncate text-sm font-semibold text-white">{title}</h4>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-white/78 transition hover:border-white/20 hover:bg-white/[0.08]"
                onClick={() => selectResourceEditor(resource)}
              >
                编辑详情
              </button>
              {meta.map((item) => (
                <span key={`${resourceKey}-${item}`} className="resource-mini-chip resource-mini-chip-muted">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={status} label={statusLabel} />
            <button
              type="button"
              className="rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1.5 text-[11px] font-semibold text-brand-100 transition hover:border-brand-500/35 hover:bg-brand-500/15 disabled:opacity-50"
              disabled={isOptimizing}
              onClick={() => void optimizeResourcePrompt(resource, displayPrompt)}
            >
              {isOptimizing ? '优化中...' : '优化提示词'}
            </button>
          </div>
        </div>

        <div className={`resource-row-body ${isCharacterResource ? 'resource-row-body-character' : ''}`}>
          {primaryColumn}
          {generatedColumn}
        </div>
      </article>
    );
  };

  const renderResourceEditModal = () => {
    if (!resourceEditorOpen || !resourceEditor?.resourceId) {
      return null;
    }

    const resourceTypeLabel = resourceEditor.resourceType === 'character' ? '角色' : '场景';
    const variantPrompts = getResourceVariantPrompts(resourceEditor);
    const currentResourceKey = getResourceKey(resourceEditor);
    const isOptimizing = resourceOptimizingKey === currentResourceKey;
    const generatedAssets = getResourceImageAssetsForResource(resourceEditor);
    const generationSummary = getResourceGenerationSummary(generatedAssets);

    return (
      <ModalSheet
        open={resourceEditorOpen}
        onClose={() => setResourceEditorOpen(false)}
        title={`${resourceEditor.resourceName} · 编辑详情`}
        description={
          resourceEditor.resourceType === 'character'
            ? '在这里微调角色资源提示词，并查看 Gemini Image 的角色三视图调用词。'
            : '在这里微调场景资源提示词，并查看 Gemini Image 的三角度背景调用词。'
        }
        size="xl"
      >
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  原始参考帧
                </p>
                <div className="mt-3">
                  <VideoFramePreview
                    videoUrl={analysisFrameSource}
                    timeSeconds={resourceEditor.frameTime}
                    originalTimeSeconds={resourceEditor.frameTime}
                    label={resourceEditor.resourceName}
                    note={resourceEditor.frameNote}
                    requestedTimeLabel="整片时间"
                  />
                </div>
              </div>

              <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    {resourceEditor.resourceType === 'character' ? '三视图预览' : '三角度预览'}
                  </p>
                  <span className="resource-mini-chip resource-mini-chip-muted">
                    已生成 {generationSummary.completedCount}/{variantPrompts.length}
                  </span>
                </div>
                <div className="mt-3">
                  {renderGeneratedResourceStrip(resourceEditor, {
                    className: 'resource-generated-stack-modal'
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {resourceEditor.resourceType === 'character' ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="resource-attribute-card">
                      <p className="resource-attribute-label">外表描述</p>
                      <textarea
                        value={resourceEditor.appearancePrompt}
                        onChange={(event) => updateResourceEditorField('appearancePrompt', event.target.value)}
                        className="mt-2 min-h-[104px] w-full rounded-[14px] border border-white/10 bg-black/20 px-3 py-2 text-[13px] leading-6 text-white outline-none"
                        placeholder="角色外表、服装、发型、体态和材质细节"
                      />
                    </label>
                    <label className="resource-attribute-card">
                      <p className="resource-attribute-label">性格气质</p>
                      <textarea
                        value={resourceEditor.personalityPrompt}
                        onChange={(event) => updateResourceEditorField('personalityPrompt', event.target.value)}
                        className="mt-2 min-h-[104px] w-full rounded-[14px] border border-white/10 bg-black/20 px-3 py-2 text-[13px] leading-6 text-white outline-none"
                        placeholder="角色气质、情绪底色、表演风格和行为习惯"
                      />
                    </label>
                  </div>

                  {resourceEditor.voiceProfile && (
                    <div className="resource-attribute-card">
                      <p className="resource-attribute-label">音色特征</p>
                      <div className="mt-2 rounded-[14px] border border-white/10 bg-black/20 px-3 py-3">
                        {resourceEditor.voiceProfile.summary && (
                          <p className="text-[13px] leading-6 text-white/82">
                            {resourceEditor.voiceProfile.summary}
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {resourceEditor.voiceProfile.timbre && (
                            <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                              {resourceEditor.voiceProfile.timbre}
                            </span>
                          )}
                          {resourceEditor.voiceProfile.tone && (
                            <span className="inline-flex rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-100">
                              {resourceEditor.voiceProfile.tone}
                            </span>
                          )}
                          {resourceEditor.voiceProfile.pace && (
                            <span className="inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-100">
                              语速{resourceEditor.voiceProfile.pace}
                            </span>
                          )}
                          {resourceEditor.voiceProfile.emotion && (
                            <span className="inline-flex rounded-full border border-purple-500/20 bg-purple-500/10 px-2.5 py-1 text-[11px] font-semibold text-purple-100">
                              {resourceEditor.voiceProfile.emotion}
                            </span>
                          )}
                          {resourceEditor.voiceProfile.intensity && (
                            <span className="inline-flex rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-100">
                              {resourceEditor.voiceProfile.intensity}
                            </span>
                          )}
                          {resourceEditor.voiceProfile.articulation && (
                            <span className="inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100">
                              {resourceEditor.voiceProfile.articulation}
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-[11px] leading-5 text-white/50">
                          音色特征由 AI 从视频音频中自动提取，用于视频生成时的参考。
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <label className="resource-attribute-card">
                  <p className="resource-attribute-label">场景描述</p>
                  <textarea
                    value={resourceEditor.description}
                    onChange={(event) => updateResourceEditorField('description', event.target.value)}
                    className="mt-2 min-h-[120px] w-full rounded-[14px] border border-white/10 bg-black/20 px-3 py-2 text-[13px] leading-6 text-white outline-none"
                    placeholder="场景布局、材质、光线和可复用视觉特征"
                  />
                </label>
              )}

              <PromptPreview
                title={`${resourceTypeLabel}原始提示词`}
                description="这是整片理解阶段返回的原始资源提示词。"
                prompt={resourceEditor.sourcePrompt}
                modelLabel="Gemini"
                defaultOpen
              />

              {resourceEditorError ? (
                <div
                  role="alert"
                  className="rounded-[18px] border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-100"
                >
                  {resourceEditorError}
                </div>
              ) : null}

              <PromptEditor
                value={resourceEditor.draftPrompt}
                onChange={updateResourceDraft}
                onOptimize={(draft) => optimizeResourcePrompt(null, draft)}
                isOptimizing={isOptimizing}
                highlightedPrompt={resourceEditor.highlightedPrompt}
                showAnalyze={false}
                title={`${resourceTypeLabel}提示词编辑区`}
                description={
                  resourceEditor.resourceType === 'character'
                    ? '优化后会回写到资源卡片的提示词框，并用于角色三视图调用词。'
                    : '优化后会回写到资源卡片的提示词框，并用于三张场景背景调用词。'
                }
                placeholder={
                  resourceEditor.resourceType === 'character'
                    ? '在这里微调角色资源提示词，后续用于 Gemini 角色三视图。'
                    : '在这里微调场景资源提示词，后续用于 Gemini 多角度背景图。'
                }
                optimizeLabel="优化资源提示词"
                mentionSummaryLabel="资源标签"
              />

              {resourceEditor.resourceType === 'character' ? (
                <section className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                        状态时间线
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-white/60">
                        用整片绝对秒数记录该角色的阶段性状态。镜头会自动继承同时间点上最近有效的角色状态。
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.08]"
                      onClick={addCharacterStateItem}
                    >
                      新增状态节点
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {(resourceEditor.stateTimeline ?? []).length ? (
                      resourceEditor.stateTimeline.map((stateItem, stateIndex) => (
                        <article
                          key={`${resourceEditor.resourceId}-${stateItem.id}`}
                          className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-white">
                              状态 {String(stateIndex + 1).padStart(2, '0')}
                            </p>
                            <button
                              type="button"
                              className="rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold text-rose-100 transition hover:border-rose-500/35 hover:bg-rose-500/15"
                              onClick={() => removeCharacterStateItem(stateItem.id)}
                            >
                              删除
                            </button>
                          </div>

                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            <label className="space-y-1 text-[11px] text-white/55">
                              <span>开始秒数</span>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={stateItem.startTime}
                                onChange={(event) => updateCharacterStateItem(stateItem.id, { startTime: event.target.value })}
                                className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                              />
                            </label>
                            <label className="space-y-1 text-[11px] text-white/55">
                              <span>结束秒数</span>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={stateItem.endTime}
                                onChange={(event) => updateCharacterStateItem(stateItem.id, { endTime: event.target.value })}
                                className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                              />
                            </label>
                            <label className="space-y-1 text-[11px] text-white/55">
                              <span>状态参考帧秒数</span>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={stateItem.representativeFrameTime}
                                onChange={(event) =>
                                  updateCharacterStateItem(stateItem.id, { representativeFrameTime: event.target.value })
                                }
                                className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                              />
                            </label>
                          </div>

                          <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
                            <div className="rounded-[14px] border border-white/10 bg-black/20 p-2">
                              {stateItem.representativeFrameImageUrl ? (
                                <button
                                  type="button"
                                  className="block w-full"
                                  onClick={() =>
                                    setLightboxFrame({
                                      title: `${resourceEditor.resourceName} · ${stateItem.stateName || `状态 ${stateIndex + 1}`}`,
                                      description: stateItem.representativeFrameNote,
                                      imageUrl: stateItem.representativeFrameImageUrl,
                                      note: stateItem.continuityPrompt || stateItem.summary || stateItem.representativeFrameNote
                                    })
                                  }
                                >
                                  <img
                                    src={stateItem.representativeFrameImageUrl}
                                    alt={stateItem.stateName || `状态 ${stateIndex + 1}`}
                                    className="h-[180px] w-full rounded-[12px] object-cover"
                                  />
                                </button>
                              ) : (
                                <VideoFramePreview
                                  videoUrl={analysisFrameSource}
                                  timeSeconds={
                                    String(stateItem.representativeFrameTime ?? '').trim()
                                      ? Number(stateItem.representativeFrameTime)
                                      : null
                                  }
                                  originalTimeSeconds={
                                    String(stateItem.representativeFrameTime ?? '').trim()
                                      ? Number(stateItem.representativeFrameTime)
                                      : null
                                  }
                                  label={stateItem.stateName || `状态 ${stateIndex + 1}`}
                                  note={stateItem.representativeFrameNote || '保存后会生成稳定的状态参考帧。'}
                                  requestedTimeLabel="整片时间"
                                />
                              )}
                            </div>

                            <div className="space-y-3">
                              <label className="block space-y-1 text-[11px] text-white/55">
                                <span>状态名</span>
                                <input
                                  type="text"
                                  value={stateItem.stateName}
                                  onChange={(event) => updateCharacterStateItem(stateItem.id, { stateName: event.target.value })}
                                  className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                                  placeholder="例如：右手受伤、包扎阶段、衣服破损"
                                />
                              </label>
                              <label className="block space-y-1 text-[11px] text-white/55">
                                <span>状态摘要</span>
                                <textarea
                                  value={stateItem.summary}
                                  onChange={(event) => updateCharacterStateItem(stateItem.id, { summary: event.target.value })}
                                  className="min-h-[88px] w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] leading-6 text-white outline-none"
                                  placeholder="描述该阶段的身体、服装、妆造和可见变化"
                                />
                              </label>
                              <label className="block space-y-1 text-[11px] text-white/55">
                                <span>连续性提示词</span>
                                <textarea
                                  value={stateItem.continuityPrompt}
                                  onChange={(event) =>
                                    updateCharacterStateItem(stateItem.id, { continuityPrompt: event.target.value })
                                  }
                                  className="min-h-[88px] w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] leading-6 text-white outline-none"
                                  placeholder="直接服务镜头生成，强调该状态必须持续到后续镜头"
                                />
                              </label>
                              <label className="block space-y-1 text-[11px] text-white/55">
                                <span>参考帧说明</span>
                                <input
                                  type="text"
                                  value={stateItem.representativeFrameNote}
                                  onChange={(event) =>
                                    updateCharacterStateItem(stateItem.id, { representativeFrameNote: event.target.value })
                                  }
                                  className="w-full rounded-[12px] border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white outline-none"
                                  placeholder="说明这个参考帧为何能代表当前状态"
                                />
                              </label>
                            </div>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[16px] border border-dashed border-white/10 bg-black/10 px-4 py-4 text-[12px] text-white/60">
                        当前角色还没有状态时间线。可以先新增一个基础状态，后续再补受伤、包扎或妆造变化阶段。
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2">
                {resourceEditor.resourceType === 'character' ? (
                  <button
                    type="button"
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08] disabled:opacity-50"
                    disabled={characterTimelineSaving}
                    onClick={() => void saveCharacterTimeline()}
                  >
                    {characterTimelineSaving ? '保存状态中...' : '保存角色状态时间线'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-500/35 hover:bg-emerald-500/15 disabled:opacity-50"
                  disabled={
                    resourceGeneratingKeys.includes(currentResourceKey) ||
                    !resourceEditor.draftPrompt.trim() ||
                    !geminiImageProvider?.ready
                  }
                  onClick={() => void generateResourceBundle(resourceEditor)}
                  title={
                    geminiImageProvider?.ready
                      ? '调用 Gemini 生图生成当前资源。'
                      : `Gemini 生图未就绪：${geminiImageProvider?.reason || '缺少必要配置。'}`
                  }
                >
                  {resourceGeneratingKeys.includes(currentResourceKey)
                    ? '资源生成中...'
                    : resourceEditor.resourceType === 'character'
                      ? '生成整组三视图'
                      : '生成整组背景图'}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                  onClick={() =>
                    setResourceEditor((currentState) => ({
                      ...currentState,
                      draftPrompt: currentState.sourcePrompt,
                      highlightedPrompt: ''
                    }))
                  }
                >
                  恢复原始
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:scale-[1.01]"
                  onClick={() => {
                    setResourcePromptOverrides((currentState) => ({
                      ...currentState,
                      [currentResourceKey]: {
                        prompt: resourceEditor.draftPrompt || resourceEditor.sourcePrompt,
                        highlightedPrompt: resourceEditor.highlightedPrompt || ''
                      }
                    }));
                    setResourceEditorOpen(false);
                  }}
                >
                  保存到资源卡片
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {variantPrompts.map((variant) => (
              <PromptPreview
                key={`${currentResourceKey}-${variant.id}`}
                title={`${variant.label} 调用词`}
                description={
                  resourceEditor.resourceType === 'character'
                    ? '用于 Gemini Image 的角色三视图单张调用。'
                    : '用于 Gemini Image 的场景背景角度调用。'
                }
                prompt={variant.prompt}
                modelLabel="Gemini Image"
              />
            ))}
          </div>
        </div>
      </ModalSheet>
    );
  };

  const renderCharacterCards = () => {
    if (!characters.length) {
      return (
        <div className="rounded-[24px] border border-dashed border-white/[0.12] px-4 py-5 text-sm text-white/50">
          暂无角色设定。
        </div>
      );
    }

    return (
      <div className="space-y-2.5">
        {characters.map((character, index) => {
          const resource = buildCharacterResource(character, index);
          const generationSummary = getResourceGenerationSummary(getResourceImageAssetsForResource(resource));
          const generatedCount = generationSummary.completedCount;

          return renderResourceCard(resource, {
            eyebrow: 'Character Resource',
            title: resource.resourceName,
            status:
              generatedCount === 3 ? 'completed' : resourceGeneratingKeys.includes(getResourceKey(resource)) ? 'processing' : resource.frameTime !== null ? 'completed' : 'idle',
            statusLabel:
              generatedCount === 3
                ? '三视图已落库'
                : generationSummary.failedCount && !resourceGeneratingKeys.includes(getResourceKey(resource))
                  ? '三视图待重试'
                : resourceGeneratingKeys.includes(getResourceKey(resource))
                  ? '三视图生成中'
                  : resource.frameTime !== null
                    ? '已记录原始帧'
                    : '待补原始帧',
            meta: [resource.resourceId, `${generatedCount}/3`]
          });
        })}
      </div>
    );
  };

  const renderSceneCards = () => {
    if (!sceneCards.length) {
      return (
        <div className="rounded-[24px] border border-dashed border-white/[0.12] px-4 py-5 text-sm text-white/50">
          暂无场景资料。
        </div>
      );
    }

    return (
      <div className="space-y-2.5">
        {sceneCards.map((background, index) => {
          const resource = buildSceneResource(background, index);
          const backgroundAsset = backgroundAssetMap.get(resource.resourceId) || null;
          const generationSummary = getResourceGenerationSummary(getResourceImageAssetsForResource(resource));
          const generatedCount = generationSummary.completedCount;

          return renderResourceCard(resource, {
            eyebrow: 'Scene Resource',
            title: resource.resourceName,
            status:
              backgroundAsset?.status ||
              (generationSummary.failedCount ? 'failed' : resource.frameTime !== null ? 'completed' : 'idle'),
            statusLabel:
              generationSummary.failedCount && !backgroundAsset
                ? '背景图待重试'
                : getBackgroundAssetStatusLabel(backgroundAsset),
            meta: [
              resource.resourceId,
              backgroundAssetsLoading ? '同步中' : '背景资产',
              `${generatedCount}/3`
            ]
          });
        })}
      </div>
    );
  };

  const renderSegmentBreakdown = () => {
    if (!timeAnchors.length) {
      return (
        <div className="rounded-[24px] border border-dashed border-white/[0.12] px-4 py-5 text-sm text-white/50">
          暂无片段切分预案。
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {timeAnchors.map((anchor, index) => {
          const frameTime = getRepresentativeFrameTime(anchor);
          const frameNote = getRepresentativeFrameNote(anchor, '该片段的代表画面');
          const scenePrompt = getScenePrompt(anchor, '暂无片段提示词。');
          const backgroundAction = anchor.backgroundAction ?? anchor.background_action ?? 'create_new';
          const backgroundName = anchor.backgroundName ?? anchor.background_name ?? `场景 ${index + 1}`;

          return (
            <article
              key={`${anchor.startTime}-${anchor.endTime}-${index}`}
              className="rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-4"
            >
              <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                <VideoFramePreview
                  videoUrl={analysisFrameSource}
                  timeSeconds={frameTime}
                  originalTimeSeconds={frameTime}
                  label={`片段 ${index + 1}`}
                  note={frameNote}
                  requestedTimeLabel="整片时间"
                />

                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">片段 {index + 1}</p>
                      <p className="mt-1 text-xs text-white/40">
                        {formatDuration(Number(anchor.startTime))} - {formatDuration(Number(anchor.endTime))}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <StatusBadge
                        status={getBackgroundActionStatus(backgroundAction)}
                        label={getBackgroundActionLabel(backgroundAction)}
                      />
                      <StatusBadge
                        status="completed"
                        label={`${Math.max(1, Math.round(Number(anchor.endTime) - Number(anchor.startTime)))}s`}
                      />
                      <HoverPopover
                        trigger="片段提示词"
                        triggerClassName="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-black/35"
                      >
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                            场景提示词
                          </p>
                          <p className="text-sm leading-6 text-white/80">{scenePrompt}</p>
                        </div>
                      </HoverPopover>
                      <button
                        type="button"
                        className="rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-100 transition hover:border-brand-500/35 hover:bg-brand-500/15 disabled:opacity-50"
                        disabled={frameTime === null}
                        onClick={() =>
                          setLightboxFrame({
                            title: `片段 ${index + 1} · 典型帧`,
                            description: frameNote,
                            videoUrl: analysisFrameSource,
                            timeSeconds: frameTime,
                            originalTimeSeconds: frameTime,
                            requestedTimeLabel: '整片时间',
                            label: `片段 ${index + 1}`,
                            note: frameNote
                          })
                        }
                      >
                        放大预览
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-white/75">
                    {anchor.sceneSummary || '暂无片段解释。'}
                  </p>
                  <p className="mt-2 text-xs text-white/45">
                    绑定场景：{backgroundName} · {anchor.backgroundId || anchor.background_id || '未绑定'}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <SectionPanel
        eyebrow="Analysis"
        title={compactMode ? '资源库与整片理解' : '整片分析工作台'}
        description={
          compactMode
            ? '左侧集中查看角色资源库、场景资源库和整片切分预案，分析与切分操作也保留在这里。'
            : '这里保留整片理解、角色与场景资料、片段切分预案和主操作按钮，长提示词与细节说明移入弹窗或悬浮卡。'
        }
        compact={compactMode}
        className={className}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06]"
              onClick={() => setPromptModalOpen(true)}
              disabled={!video}
            >
              查看分析提示词
            </button>
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06]"
              onClick={() => setAnalysisOptionsOpen(true)}
              disabled={!video}
            >
              分析选项
            </button>
            <select
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06] focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              value={analysisProvider}
              onChange={(e) => setAnalysisProvider(e.target.value)}
              disabled={!video || loading}
            >
              <option value="gemini">Gemini 2.5 Pro</option>
              <option value="doubao-seed">Doubao-Seed</option>
            </select>
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06]"
              onClick={() => void onAnalyze(analysisProvider)}
              disabled={!video || loading}
            >
              {analysis ? '重新分析' : '开始分析'}
            </button>
            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void onSplit()}
              disabled={!analysis?.time_anchors?.length || splitProgress.status === 'processing'}
            >
              生成片段
            </button>
          </div>
        }
      >
        {!video ? (
          <div className="rounded-[28px] border border-dashed border-white/[0.12] bg-white/[0.04] px-6 py-12 text-center">
            <p className="text-lg font-semibold text-white">先上传一个原视频</p>
            <p className="mt-2 text-sm leading-6 text-white/60">
              上传完成后，这里会显示剧情摘要、角色卡片、场景卡片、典型帧和片段切分预案。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,15,35,0.96),rgba(4,6,14,0.96)),radial-gradient(circle_at_top_right,rgba(225,29,72,0.18),transparent_28%)] px-4 py-4 text-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.28em] text-white/40">Current Asset</p>
                  <h3 className="mt-2 text-lg font-bold">{video.filename}</h3>
                  <p className="mt-2 max-w-3xl text-[12px] leading-6 text-white/68">
                    当前视频会先做整片理解，再输出角色、场景、代表帧和片段级切分预案，供后续重生成使用。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={analysisStatusTone} label={analysisStatusLabel} />
                  <span className="toolbar-pill">
                    字幕解析 {analysisOptions?.extractSubtitles ? '开' : '关'}
                  </span>
                  <span className="toolbar-pill">
                    音频解析 {analysisOptions?.parseAudio ? '开' : '关'}
                  </span>
                  <span className="toolbar-pill">风格 {currentStyleLabel}</span>
                  <span className="toolbar-pill">时长 {video.duration ? formatDuration(video.duration) : '待探测'}</span>
                  <span className="toolbar-pill">典型帧 {keyFrameCount}</span>
                  <span className="toolbar-pill">片段提示词 {timeAnchorPromptCount}</span>
                </div>
              </div>
            </div>

            {isAnalysisProcessing && (
              <div className="rounded-[26px] border border-brand-500/20 bg-brand-500/10 px-5 py-4">
                <ProgressBar value={progress} status={status} label={statusMessage || '正在分析整片视频'} />
              </div>
            )}

            {splitProgress.status !== 'idle' ? (
              <div className="rounded-[26px] border border-white/10 bg-white/[0.04] px-5 py-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">片段切分任务</p>
                  <StatusBadge status={splitProgress.status} />
                </div>
                <ProgressBar
                  value={splitProgress.progress}
                  status={splitProgress.status}
                  label={splitProgress.message || '正在根据时间锚点拆分片段'}
                />
              </div>
            ) : null}

            {analysis?.is_mock ? (
              <div
                role="alert"
                className="rounded-[26px] border border-amber-500/20 bg-amber-500/10 px-5 py-4 text-sm text-amber-100"
              >
                <p className="font-semibold">{getMockFailureSummary(analysis)}</p>
                <p className="mt-2 leading-6 text-amber-50/80">
                  这意味着这次没有拿到 Gemini 的真实整片理解数据，页面当前展示的是后端回退生成的结果。
                </p>
                <div className="mt-3 grid gap-2 text-xs leading-5 text-amber-50/80 md:grid-cols-2">
                  <p>模型：{analysis.model || '未知'}</p>
                  <p>调用模式：{analysis.mode || '未知'}</p>
                  <p>鉴权方式：{analysis.auth_variant || '未知'}</p>
                  <p>回退原因：{analysis.fallback_reason || 'remote_error'}</p>
                </div>
                {analysis.remote_error ? (
                  <p className="mt-3 rounded-[18px] border border-amber-400/10 bg-black/20 px-3 py-2 text-xs leading-5 text-amber-100">
                    远端错误：{analysis.remote_error}
                  </p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="rounded-[26px] border border-accent-500/20 bg-accent-500/10 px-5 py-4 text-sm text-rose-200"
              >
                {error}
              </div>
            ) : null}

            {backgroundAssetsError ? (
              <div
                role="alert"
                className="rounded-[26px] border border-amber-500/20 bg-amber-500/10 px-5 py-4 text-sm text-amber-100"
              >
                {backgroundAssetsError}
              </div>
            ) : null}

            {resourceImageAssetsError ? (
              <div
                role="alert"
                className="rounded-[26px] border border-amber-500/20 bg-amber-500/10 px-5 py-4 text-sm text-amber-100"
              >
                {resourceImageAssetsError}
              </div>
            ) : null}

            {analysis ? (
              <>
                <div className="analysis-intel-grid">
                  <div className="analysis-intel-card">
                    <div className="analysis-panel-head">
                      <div className="min-w-0">
                        <p className="analysis-panel-kicker">Intelligence Summary</p>
                        <h3 className="analysis-intel-title">剧情摘要</h3>
                        <p className="analysis-panel-copy">
                          当前左列保留整片理解的核心情报，角色、场景和片段预案会在下方切换成控制台工位视图。
                        </p>
                      </div>
                      <div className="analysis-panel-chiprail">
                        <StatusBadge status={analysisStatusTone} label={analysisStatusLabel} />
                        <span className="resource-mini-chip resource-mini-chip-muted">
                          {analysis.provider || 'remote-gemini'}
                        </span>
                        {analysis.model ? (
                          <span className="resource-mini-chip resource-mini-chip-muted">{analysis.model}</span>
                        ) : null}
                        {analysis.auth_variant ? (
                          <span className="resource-mini-chip resource-mini-chip-muted">
                            鉴权 {analysis.auth_variant}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <p className="analysis-intel-plot">{analysis.plot || '暂无剧情内容。'}</p>

                    <div className="analysis-intel-stat-grid">
                      {metrics.map((metric) => (
                        <div key={metric.label} className="analysis-intel-stat">
                          <p className="analysis-intel-stat-label">{metric.label}</p>
                          <p className="analysis-intel-stat-value">{metric.value}</p>
                          <p className="analysis-intel-stat-note">{metric.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="analysis-intel-sidebar">
                    <MetricCard
                      label="当前来源"
                      value={analysis?.is_mock ? 'Mock' : 'Gemini'}
                      detail="可结合系统状态弹窗确认真实调用情况"
                    />
                    <MetricCard
                      label="鉴权方式"
                      value={analysis?.auth_variant || '等待调用'}
                      detail="前端展示当前一次整片分析的鉴权模式"
                    />
                    <MetricCard
                      label="代表帧覆盖"
                      value={keyFrameCount}
                      detail="有合法时间点时可直接抽帧预览"
                    />
                    <MetricCard
                      label="片段提示词"
                      value={timeAnchorPromptCount}
                      detail="适合直接进入后续片段生成流程"
                    />
                  </div>
                </div>

                <div className="analysis-console-shell">
                  {renderConsoleTabs()}

                  <div className="analysis-console-stage">
                    {activeTab === 'overview' ? (
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
                        <div className="analysis-console-card">
                          {renderResourcePanelHeader({
                            title: '整片情报总览',
                            description:
                              '本次整片理解已经抽取了角色、场景和待切分片段。进入片段工作台前，优先检查角色设定、场景提示词和片段边界是否适合后续生成。',
                            chips: [
                              `角色 ${characters.length}`,
                              `场景 ${sceneCards.length}`,
                              `片段 ${timeAnchors.length}`,
                              `模型 ${analysis.model || '待分析'}`
                            ]
                          })}

                          <div className="analysis-console-list">
                            <div className="analysis-console-list-item">
                              <span className="analysis-console-list-label">场景资产复用</span>
                              <span className="analysis-console-list-value">
                                已就绪 {backgroundAssetReadyCount} / {sceneCards.length}
                              </span>
                            </div>
                            <div className="analysis-console-list-item">
                              <span className="analysis-console-list-label">角色资源优化</span>
                              <span className="analysis-console-list-value">
                                已优化 {optimizedCharacterCount} / {characters.length}
                              </span>
                            </div>
                            <div className="analysis-console-list-item">
                              <span className="analysis-console-list-label">场景资源优化</span>
                              <span className="analysis-console-list-value">
                                已优化 {optimizedSceneCount} / {sceneCards.length}
                              </span>
                            </div>
                            <div className="analysis-console-list-item">
                              <span className="analysis-console-list-label">片段提示词覆盖</span>
                              <span className="analysis-console-list-value">
                                {timeAnchorPromptCount} / {timeAnchors.length}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="analysis-console-card">
                          {renderResourcePanelHeader({
                            title: '操作提示',
                            description:
                              '建议先优化角色和场景资源提示词，再进入片段工作区，以减少后续逐段修 prompt 的成本。',
                            chips: activeTabSummary.overview
                          })}

                          <div className="analysis-console-brick-grid">
                            <div className="analysis-console-brick">
                              <p className="analysis-console-brick-title">角色资源</p>
                              <p className="analysis-console-brick-copy">
                                保留外表描述与性格气质，优化后可直接进入 Gemini 纯白背景三视图。
                              </p>
                            </div>
                            <div className="analysis-console-brick">
                              <p className="analysis-console-brick-title">场景资源</p>
                              <p className="analysis-console-brick-copy">
                                场景卡片会同步显示背景资产状态，便于判断是否可复用。
                              </p>
                            </div>
                            <div className="analysis-console-brick">
                              <p className="analysis-console-brick-title">片段预案</p>
                              <p className="analysis-console-brick-copy">
                                片段分解里可先核对背景复用与代表帧，再决定是否立即切分。
                              </p>
                            </div>
                            <div className="analysis-console-brick">
                              <p className="analysis-console-brick-title">提示词查看</p>
                              <p className="analysis-console-brick-copy">
                                长提示词放进了弹窗和悬浮卡，常驻区优先展示操作与状态。
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {activeTab === 'characters' ? (
                      <div className="analysis-console-card">
                        {renderResourcePanelHeader({
                          title: '角色资源库',
                          description:
                            '主页只保留原始帧、当前最终提示词和三视图资源，详细属性统一进入编辑详情。',
                          chips: activeTabSummary.characters
                        })}
                        {renderResourceMatrixHeader(['典型帧 + 当前最终提示词', '生成的新资源'])}
                        {renderCharacterCards()}
                      </div>
                    ) : null}

                    {activeTab === 'scenes' ? (
                      <div className="analysis-console-card">
                        {renderResourcePanelHeader({
                          title: '场景资源库',
                          description:
                            '主页只保留原始帧、当前最终提示词和背景资源预览，场景描述与调用词放进编辑详情。',
                          chips: activeTabSummary.scenes
                        })}
                        {renderResourceMatrixHeader(['典型帧 + 当前最终提示词', '生成的新资源'])}
                        {renderSceneCards()}
                      </div>
                    ) : null}

                    {activeTab === 'segments' ? (
                      <div className="analysis-console-card">
                        {renderResourcePanelHeader({
                          title: '片段分解',
                          description:
                            '这里按片段显示切分预案、背景复用决策和片段提示词，用于进入片段工作台前的最终核对。',
                          chips: activeTabSummary.segments
                        })}
                        {renderSegmentBreakdown()}
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : isAnalysisProcessing ? (
              <div className="rounded-[28px] border border-brand-500/20 bg-brand-500/10 px-6 py-12 text-center">
                <p className="text-lg font-semibold text-white">整片分析进行中</p>
                <p className="mt-2 text-sm leading-6 text-white/70">
                  {statusMessage || '正在调用 Gemini 做整片理解，请稍候。'}
                </p>
                <p className="mt-3 text-xs leading-5 text-white/45">
                  当前阶段会持续更新进度和文案，不再显示“尚未开始”。
                </p>
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-white/[0.12] bg-white/[0.04] px-6 py-12 text-center">
                <p className="text-lg font-semibold text-white">整片分析尚未开始</p>
                <p className="mt-2 text-sm leading-6 text-white/60">
                  点击右上角的“开始分析”，就可以生成剧情、角色、场景卡片、典型帧和片段切分预案。
                </p>
              </div>
            )}
          </div>
        )}
      </SectionPanel>

      <ModalSheet
        open={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        title="整片分析提示词"
        description="这里把整片分析提示词拆成固定结构段和可编辑风格段。JSON 结构、字段要求和输出规则保持只读，只允许调整风格段。"
        size="xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-white">当前风格模式</p>
              <p className="mt-1 text-xs leading-5 text-white/55">切换后只影响后续分析、优化和生成，不会自动覆盖已产出的结果。</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="整片分析风格模式"
                className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                value={currentStyleMode}
                onChange={(event) => handleStyleModeChange(event.target.value)}
              >
                {STYLE_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                onClick={handleRestoreVideoAnalysisStylePrompt}
              >
                恢复预设
              </button>
            </div>
          </div>

          <PromptPreview
            title="固定结构段"
            description="这一段会原样发送给 Gemini，约束 JSON 结构、字段定义和切分规则，前端不允许直接编辑。"
            prompt={videoAnalysisFixedPrompt}
            modelLabel="Gemini"
            defaultOpen
          />

          <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">可编辑风格段</p>
                <p className="mt-1 text-xs leading-5 text-white/55">
                  当前是 {currentStyleLabel} 模式。这里只编辑风格约束，不要改 JSON 字段或输出骨架。
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
                Style
              </span>
            </div>

            <textarea
              aria-label="整片分析风格提示编辑器"
              className="mt-4 min-h-[160px] w-full rounded-[18px] border border-white/10 bg-black/[0.35] px-4 py-4 text-sm leading-6 text-white outline-none transition focus:border-brand-500/40 focus:ring-2 focus:ring-brand-500/20"
              value={videoAnalysisStylePrompt}
              onChange={(event) => handleVideoAnalysisStylePromptChange(event.target.value)}
            />
          </div>

          <PromptPreview
            title="最终拼装后的整片分析提示词"
            description="开始分析时，后端会把原视频和这段最终拼装后的提示词一起发送给 Gemini。"
            prompt={videoAnalysisPrompt}
            modelLabel="Gemini"
          />
        </div>
      </ModalSheet>

      <ModalSheet
        open={analysisOptionsOpen}
        onClose={() => setAnalysisOptionsOpen(false)}
        title="分析选项"
        description="这些选项会随当前视频保存，并在下一次整片理解时决定是否抽取字幕、音频和当前风格模式。"
        size="md"
      >
        <div className="space-y-4">
          <label className="flex items-start justify-between gap-4 rounded-[18px] border border-white/10 bg-black/20 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-white">全局风格模式</p>
              <p className="mt-1 text-[12px] leading-5 text-white/60">
                写实会按影视写实重建；漫剧会按国漫影视化风格统一作用到整片理解、片段理解、资源图和视频生成。
              </p>
            </div>
            <select
              aria-label="分析选项风格模式"
              className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={currentStyleMode}
              onChange={(event) => handleStyleModeChange(event.target.value)}
            >
              {STYLE_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-start justify-between gap-4 rounded-[18px] border border-white/10 bg-black/20 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-white">提取字幕</p>
              <p className="mt-1 text-[12px] leading-5 text-white/60">
                整片理解时返回每个小镜头的对白全文和逐句字幕，并在镜头编辑区提供复制与编辑。
              </p>
            </div>
            <input
              type="checkbox"
              checked={Boolean(analysisOptions?.extractSubtitles)}
              onChange={(event) =>
                onAnalysisOptionsChange({
                  extractSubtitles: event.target.checked
                })
              }
              className="mt-1 h-4 w-4 accent-emerald-400"
            />
          </label>

          <label className="flex items-start justify-between gap-4 rounded-[18px] border border-white/10 bg-black/20 px-4 py-4">
            <div>
              <p className="text-sm font-semibold text-white">音频解析</p>
              <p className="mt-1 text-[12px] leading-5 text-white/60">
                分析说话方式、停顿、语速与情绪，后续说话镜头会优先用原镜头音频做口型参考。
              </p>
            </div>
            <input
              type="checkbox"
              checked={Boolean(analysisOptions?.parseAudio)}
              onChange={(event) =>
                onAnalysisOptionsChange({
                  parseAudio: event.target.checked
                })
              }
              className="mt-1 h-4 w-4 accent-emerald-400"
            />
          </label>

          <div className="rounded-[18px] border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[12px] leading-6 text-amber-100">
            重新点击“开始分析 / 重新分析”后，新选项才会对整片理解结果生效。当前镜头字幕和口型真值默认优先使用原镜头音频。
          </div>
        </div>
      </ModalSheet>

      {renderResourceEditModal()}
      {renderPreviewModal()}
    </>
  );
};

AnalysisDisplay.propTypes = {
  video: PropTypes.shape({
    id: PropTypes.number,
    filename: PropTypes.string,
    duration: PropTypes.number,
    file_url: PropTypes.string
  }),
  analysis: PropTypes.shape({
    plot: PropTypes.string,
    characters: PropTypes.arrayOf(PropTypes.object),
    backgrounds: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.object])),
    time_anchors: PropTypes.arrayOf(PropTypes.object),
    provider: PropTypes.string,
    model: PropTypes.string,
    mode: PropTypes.string,
    auth_variant: PropTypes.string,
    is_mock: PropTypes.bool,
    fallback_reason: PropTypes.string,
    remote_error: PropTypes.string
  }),
  resourceRefreshKey: PropTypes.number,
  backgroundAssets: PropTypes.arrayOf(PropTypes.object),
  backgroundAssetsLoading: PropTypes.bool,
  backgroundAssetsError: PropTypes.string,
  className: PropTypes.string,
  compactMode: PropTypes.bool,
  analysisOptions: PropTypes.shape({
    extractSubtitles: PropTypes.bool,
    parseAudio: PropTypes.bool,
    styleMode: PropTypes.string,
    styleTemplates: PropTypes.object
  }),
  loading: PropTypes.bool,
  error: PropTypes.string,
  progress: PropTypes.number,
  status: PropTypes.string,
  statusMessage: PropTypes.string,
  splitProgress: PropTypes.shape({
    status: PropTypes.string,
    progress: PropTypes.number,
    message: PropTypes.string
  }),
  onAnalyze: PropTypes.func.isRequired,
  onAnalysisOptionsChange: PropTypes.func,
  onAnalysisUpdated: PropTypes.func,
  onSplit: PropTypes.func.isRequired
};

export default AnalysisDisplay;
