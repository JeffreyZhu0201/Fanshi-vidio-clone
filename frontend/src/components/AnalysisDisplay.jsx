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
import { optimizePrompt as optimizePromptRequest } from '../services/api.js';
import { formatDuration } from '../utils/formatDuration.js';
import { buildVideoAnalysisPrompt } from '../utils/promptBlueprints.js';

const TAB_ITEMS = [
  { id: 'overview', label: '总览' },
  { id: 'characters', label: '角色' },
  { id: 'scenes', label: '场景' },
  { id: 'segments', label: '片段分解' }
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
  description: '',
  sourcePrompt: '',
  draftPrompt: '',
  highlightedPrompt: ''
});

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
      shortLabel: 'F',
      prompt: [
        `请使用 Gemini 生图模型生成角色 ${resourceName || '未命名角色'} 的三视图之一：正面视图。`,
        '要求：单人、全身、居中站立、正对镜头、中性站姿、完整保留头部到脚部。',
        '要求：纯白无缝背景，背景不能带任何场景、环境、道具、阴影文字、拼贴版式或其他人物。',
        '要求：写实电影美术设定风格，服装结构、面部特征、发型、配饰需要稳定且清晰。',
        appearanceLine ? `角色外表描述：${appearanceLine}` : '',
        personalityLine ? `角色性格气质：${personalityLine}` : '',
        `角色资源提示词：${basePrompt || '无'}`
      ].join('\n')
    },
    {
      id: 'side',
      label: '侧面',
      shortLabel: 'S',
      prompt: [
        `请使用 Gemini 生图模型生成角色 ${resourceName || '未命名角色'} 的三视图之一：左侧面视图。`,
        '要求：单人、全身、严格侧身站立、镜头平视、完整保留头部到脚部。',
        '要求：背景必须保持纯白无缝，与正面视图保持相同布光和材质表达，不要额外角色和道具。',
        '要求：强调发型轮廓、服装侧面结构、肩线与腰线层次，保持人物身份一致。',
        appearanceLine ? `角色外表描述：${appearanceLine}` : '',
        personalityLine ? `角色性格气质：${personalityLine}` : '',
        `角色资源提示词：${basePrompt || '无'}`
      ].join('\n')
    },
    {
      id: 'back',
      label: '背面',
      shortLabel: 'B',
      prompt: [
        `请使用 Gemini 生图模型生成角色 ${resourceName || '未命名角色'} 的三视图之一：背面视图。`,
        '要求：单人、全身、背对镜头、中性站姿、完整保留头部到脚部。',
        '要求：背景必须保持纯白无缝，不要文字、不要道具、不要额外人物，强调服装背部结构和发型后部轮廓。',
        '要求：与正面和侧面保持同一角色身份、服装材质和电影美术风格。',
        appearanceLine ? `角色外表描述：${appearanceLine}` : '',
        personalityLine ? `角色性格气质：${personalityLine}` : '',
        `角色资源提示词：${basePrompt || '无'}`
      ].join('\n')
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
  backgroundAssets = [],
  backgroundAssetsLoading = false,
  backgroundAssetsError = '',
  className = '',
  compactMode = false,
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
  onSplit
}) => {
  const [activeTab, setActiveTab] = useState(compactMode ? 'characters' : 'overview');
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [lightboxFrame, setLightboxFrame] = useState(null);
  const [resourceEditorOpen, setResourceEditorOpen] = useState(false);
  const [resourceEditor, setResourceEditor] = useState(createResourceEditorState);
  const [resourcePromptOverrides, setResourcePromptOverrides] = useState({});
  const [resourceOptimizingKey, setResourceOptimizingKey] = useState('');
  const [resourceEditorError, setResourceEditorError] = useState('');

  const characters = analysis?.characters ?? [];
  const backgrounds = analysis?.backgrounds ?? [];
  const timeAnchors = analysis?.time_anchors ?? [];
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
    sourcePrompt: buildCharacterResourcePrompt(character),
    draftPrompt: buildCharacterResourcePrompt(character),
    highlightedPrompt: ''
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

    return resource?.resourceType === 'character'
      ? buildCharacterViewPrompts({
          resourceName: resource.resourceName,
          prompt,
          appearancePrompt: resource.appearancePrompt,
          personalityPrompt: resource.personalityPrompt
        })
      : buildSceneAnglePrompts({
          resourceName: resource.resourceName,
          prompt
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
      description: resource.description ?? '',
      sourcePrompt: resource.sourcePrompt,
      draftPrompt: resourcePromptOverrides[resourceKey]?.prompt || resource.sourcePrompt,
      highlightedPrompt: resourcePromptOverrides[resourceKey]?.highlightedPrompt || ''
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
      highlightedPrompt: resource && getResourceKey(resourceEditor) !== resourceKey ? '' : resourceEditor.highlightedPrompt
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
        { mode: optimizeMode }
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

  useEffect(() => {
    setResourceEditor(createResourceEditorState());
    setResourceEditorOpen(false);
    setResourcePromptOverrides({});
    setResourceOptimizingKey('');
    setResourceEditorError('');
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
        return createResourceEditorState();
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
  const videoAnalysisPrompt = video ? buildVideoAnalysisPrompt({ video }) : '';
  const analysisStatusLabel = analysis?.is_mock ? 'Gemini失败已回退' : 'Gemini真实结果';
  const analysisStatusTone = analysis?.is_mock ? 'fallback' : 'completed';
  const keyFrameCount = [...characters, ...sceneCards].filter((item) => {
    return getRepresentativeFrameTime(item) !== null;
  }).length;
  const timeAnchorPromptCount = timeAnchors.filter((anchor) => {
    return Boolean(getScenePrompt(anchor, '').trim());
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
        <VideoFramePreview
          videoUrl={lightboxFrame.videoUrl}
          timeSeconds={lightboxFrame.timeSeconds}
          originalTimeSeconds={lightboxFrame.originalTimeSeconds}
          label={lightboxFrame.label}
          note={lightboxFrame.note}
          requestedTimeLabel={lightboxFrame.requestedTimeLabel}
          className="max-w-4xl"
        />
      </ModalSheet>
    );
  };

  const renderGeneratedResourceStrip = (resource) => {
    const variantPrompts = getResourceVariantPrompts(resource);
    const optimized = Boolean(resourcePromptOverrides[getResourceKey(resource)]?.prompt);
    const stackClassName =
      resource.resourceType === 'character'
        ? 'resource-generated-stack resource-generated-stack-horizontal'
        : 'resource-generated-stack';

    return (
      <div className={stackClassName}>
        {variantPrompts.map((variant) => (
          <div key={`${getResourceKey(resource)}-${variant.id}`} className="resource-generated-tile">
            <div className="flex items-start justify-between gap-2">
              <span className="resource-generated-badge">{variant.shortLabel}</span>
              <span className="resource-generated-status">{optimized ? '可生成' : '待优化'}</span>
            </div>
            <p className="mt-3 text-xs font-semibold text-white">{variant.label}</p>
            <p className="mt-1 text-[11px] leading-5 text-white/55">
              {shortenText(
                resource.resourceType === 'character'
                  ? '角色三视图资源位，使用 Gemini Image 调用词生成。'
                  : '场景多角度背景资源位，使用 Gemini Image 调用词生成。',
                54
              )}
            </p>
          </div>
        ))}
      </div>
    );
  };

  const renderResourceCard = (resource, options = {}) => {
    const {
      title,
      eyebrow,
      description = '',
      status = 'idle',
      statusLabel = '待处理',
      meta = []
    } = options;
    const resourceKey = getResourceKey(resource);
    const frameTime = resource.frameTime ?? null;
    const frameNote = resource.frameNote ?? '';
    const displayPrompt = getResolvedResourcePrompt(resource);
    const isOptimizing = resourceOptimizingKey === resourceKey;
    const promptStatus = resourcePromptOverrides[resourceKey]?.prompt ? '已优化' : '原始';
    const isCharacterResource = resource.resourceType === 'character';
    const promptPreviewTitle = isCharacterResource ? '角色提示词摘要' : '资源提示词';

    const frameColumn = (
      <div className="resource-row-frame">
        <p className="resource-section-label">原始帧预览</p>
        <VideoFramePreview
          videoUrl={analysisFrameSource}
          timeSeconds={frameTime}
          originalTimeSeconds={frameTime}
          label={resource.resourceName}
          note={frameNote}
          requestedTimeLabel="整片时间"
        />
      </div>
    );

    const promptColumn = (
      <div className="resource-row-prompt">
        <p className="resource-section-label">{promptPreviewTitle}</p>
        {isCharacterResource ? (
          <div className="resource-attribute-grid">
            <div className="resource-attribute-card">
              <p className="resource-attribute-label">外表描述</p>
              <p className="resource-attribute-value">{resource.appearancePrompt || '待补充'}</p>
            </div>
            <div className="resource-attribute-card">
              <p className="resource-attribute-label">性格气质</p>
              <p className="resource-attribute-value">{resource.personalityPrompt || '待补充'}</p>
            </div>
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

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1.5 text-[11px] font-semibold text-brand-100 transition hover:border-brand-500/35 hover:bg-brand-500/15 disabled:opacity-50"
            disabled={isOptimizing}
            onClick={() => void optimizeResourcePrompt(resource, displayPrompt)}
          >
            {isOptimizing ? '优化中...' : '优化提示词'}
          </button>

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
              <span className="resource-mini-chip">{promptStatus}</span>
              {meta.map((item) => (
                <span key={`${resourceKey}-${item}`} className="resource-mini-chip resource-mini-chip-muted">
                  {item}
                </span>
              ))}
            </div>
            {description ? <p className="mt-2 text-[11px] leading-5 text-white/55">{description}</p> : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <StatusBadge status={status} label={statusLabel} />
          </div>
        </div>

        <div className={`resource-row-body ${isCharacterResource ? 'resource-row-body-character' : ''}`}>
          {isCharacterResource ? (
            <>
              {frameColumn}
              {promptColumn}
              {generatedColumn}
            </>
          ) : (
            <>
              {generatedColumn}
              {frameColumn}
              {promptColumn}
            </>
          )}
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

            <div className="space-y-3">
              {resourceEditor.resourceType === 'character' ? (
                <div className="resource-attribute-grid">
                  <div className="resource-attribute-card">
                    <p className="resource-attribute-label">外表描述</p>
                    <p className="resource-attribute-value">
                      {resourceEditor.appearancePrompt || '待补充'}
                    </p>
                  </div>
                  <div className="resource-attribute-card">
                    <p className="resource-attribute-label">性格气质</p>
                    <p className="resource-attribute-value">
                      {resourceEditor.personalityPrompt || '待补充'}
                    </p>
                  </div>
                </div>
              ) : null}

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

              <div className="flex flex-wrap items-center justify-end gap-2">
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
      <div className="space-y-3">
        {characters.map((character, index) => {
          const resource = buildCharacterResource(character, index);

          return renderResourceCard(resource, {
            eyebrow: 'Character Resource',
            title: resource.resourceName,
            description: '人物资源同时记录外表描述、性格气质和三视图调用词，用于角色一致性与后续 Gemini 白底三视图生成。',
            status: resource.frameTime !== null ? 'completed' : 'idle',
            statusLabel: resource.frameTime !== null ? '已记录原始帧' : '待补原始帧',
            meta: [resource.resourceId]
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
      <div className="space-y-3">
        {sceneCards.map((background, index) => {
          const resource = buildSceneResource(background, index);
          const backgroundAsset = backgroundAssetMap.get(resource.resourceId) || null;

          return renderResourceCard(resource, {
            eyebrow: 'Scene Resource',
            title: resource.resourceName,
            description: getBackgroundDescription(background),
            status: backgroundAsset?.status || (resource.frameTime !== null ? 'completed' : 'idle'),
            statusLabel: getBackgroundAssetStatusLabel(backgroundAsset),
            meta: [resource.resourceId, backgroundAssetsLoading ? '同步中' : '背景资产']
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
              onClick={() => void onAnalyze()}
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
            <div className="rounded-[26px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,15,35,0.96),rgba(4,6,14,0.96)),radial-gradient(circle_at_top_right,rgba(225,29,72,0.18),transparent_28%)] px-5 py-5 text-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Current Asset</p>
                  <h3 className="mt-3 text-2xl font-bold">{video.filename}</h3>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-white/70">
                    当前视频会先做整片理解，再给出片段级切分预案、角色信息、场景提示词和代表帧，供后续片段重生成使用。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge
                    status={analysis ? analysisStatusTone : 'idle'}
                    label={analysis ? analysisStatusLabel : '等待分析'}
                  />
                  <span className="toolbar-pill">时长 {video.duration ? formatDuration(video.duration) : '待探测'}</span>
                  <span className="toolbar-pill">典型帧 {keyFrameCount}</span>
                  <span className="toolbar-pill">片段提示词 {timeAnchorPromptCount}</span>
                </div>
              </div>
            </div>

            {(loading || status === 'processing') && (
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

            {analysis ? (
              <>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_320px]">
                  <div className="rounded-[26px] border border-white/10 bg-white/[0.04] px-5 py-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.26em] text-white/50">Plot</p>
                        <h3 className="mt-2 text-xl font-bold text-white">剧情摘要</h3>
                      </div>
                      <StatusBadge status={analysisStatusTone} label={analysisStatusLabel} />
                    </div>
                    {(analysis?.provider || analysis?.model || analysis?.auth_variant) ? (
                      <p className="mt-3 text-xs uppercase tracking-[0.18em] text-white/40">
                        {analysis.provider || 'remote-gemini'}
                        {analysis.model ? ` · ${analysis.model}` : ''}
                        {analysis.auth_variant ? ` · ${analysis.auth_variant}` : ''}
                      </p>
                    ) : null}
                    <p className="mt-4 text-sm leading-7 text-white/80">{analysis.plot || '暂无剧情内容。'}</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    {metrics.map((metric) => (
                      <MetricCard
                        key={metric.label}
                        label={metric.label}
                        value={metric.value}
                        detail={metric.detail}
                      />
                    ))}
                  </div>
                </div>

                <div className="rounded-[26px] border border-white/10 bg-white/[0.04] px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    {TAB_ITEMS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                          activeTab === tab.id
                            ? 'bg-white text-slate-950'
                            : 'border border-white/10 bg-black/20 text-white/70 hover:border-white/20 hover:bg-black/30'
                        }`}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4">
                    {activeTab === 'overview' ? (
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
                        <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                            结果总览
                          </p>
                          <p className="mt-3 text-sm leading-7 text-white/75">
                            本次整片理解已经抽取了 {characters.length} 个角色、{sceneCards.length} 个场景和{' '}
                            {timeAnchors.length} 个待切分片段。
                            如果你准备进入片段工作台，优先检查角色设定、场景提示词和片段边界是否满足后续生成需求。
                          </p>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <span className="toolbar-pill">角色 {characters.length}</span>
                            <span className="toolbar-pill">场景 {sceneCards.length}</span>
                            <span className="toolbar-pill">片段 {timeAnchors.length}</span>
                            <span className="toolbar-pill">模型 {analysis.model || '等待分析'}</span>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
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
                    ) : null}

                    {activeTab === 'characters' ? renderCharacterCards() : null}
                    {activeTab === 'scenes' ? renderSceneCards() : null}
                    {activeTab === 'segments' ? renderSegmentBreakdown() : null}
                  </div>
                </div>
              </>
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
        description="开始分析时，后端会把原视频和这段提示词一起发送给 Gemini，产出剧情、角色、场景、典型帧和片段切分预案。"
        size="xl"
      >
        <PromptPreview
          title="整片分析提示词"
          description="这里展示的是当前前端工作台里的整片分析提示词模板。"
          prompt={videoAnalysisPrompt}
          modelLabel="Gemini"
          defaultOpen
        />
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
  backgroundAssets: PropTypes.arrayOf(PropTypes.object),
  backgroundAssetsLoading: PropTypes.bool,
  backgroundAssetsError: PropTypes.string,
  className: PropTypes.string,
  compactMode: PropTypes.bool,
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
  onSplit: PropTypes.func.isRequired
};

export default AnalysisDisplay;
