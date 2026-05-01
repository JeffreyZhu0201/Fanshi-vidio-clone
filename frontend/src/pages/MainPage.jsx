import { useState } from 'react';

import AnalysisDisplay from '../components/AnalysisDisplay.jsx';
import ModalSheet from '../components/ModalSheet.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import SegmentCard from '../components/SegmentCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import UploadArea from '../components/UploadArea.jsx';
import VideoMerge from '../components/VideoMerge.jsx';
import { useAnalysis, useAppHealth, useGeneration, useSegments, useVideoUpload } from '../hooks/index.js';
import {
  generateResourceImages as generateResourceImagesRequest,
  optimizePrompt as optimizePromptRequest
} from '../services/api.js';
import { useGenerationStore } from '../store/generationStore.js';
import { sleep } from '../utils/sleep.js';
import {
  buildAutoCharacterResources,
  buildAutoSceneResources,
  buildCharacterViewPrompts,
  buildSceneAnglePrompts
} from '../utils/autoProduction.js';
import { formatDateTime } from '../utils/formatDateTime.js';
import { DEFAULT_STYLE_MODE, STYLE_MODE_OPTIONS, normalizeStyleMode } from '../../../shared/styleTemplates.js';

const resolveStepCardClassName = (status) => {
  if (['completed', 'success', 'analyzed', 'uploaded'].includes(status)) {
    return 'border-emerald-500/20 bg-emerald-500/[0.08]';
  }

  if (['processing', 'uploading', 'checking', 'analyzing', 'polling'].includes(status)) {
    return 'border-brand-500/20 bg-brand-500/[0.08]';
  }

  if (['fallback', 'degraded'].includes(status)) {
    return 'border-amber-500/20 bg-amber-500/[0.08]';
  }

  if (['failed', 'error', 'offline'].includes(status)) {
    return 'border-accent-500/20 bg-accent-500/[0.08]';
  }

  if (status === 'pending') {
    return 'border-white/[0.12] bg-white/[0.05]';
  }

  return 'border-white/10 bg-black/20';
};

const CompactStat = ({ label, value, note }) => {
  return (
    <div className="compact-stat-card">
      <p className="compact-stat-label">{label}</p>
      <p className="compact-stat-value">{value}</p>
      <p className="compact-stat-note">{note}</p>
    </div>
  );
};

const VIDEO_RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const AUTO_PRODUCE_STEP_TIMEOUT_MS = 25 * 60 * 1000;
const AUTO_PRODUCE_POLL_INTERVAL_MS = 3000;
const createInitialAutoProduceState = () => ({
  status: 'idle',
  progress: 0,
  message: '上传完成后，可一键自动执行整片理解、资源出图、镜头生成和成片拼接。',
  error: '',
  startedAt: '',
  completedAt: ''
});

const MainPage = () => {
  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const [exportDockOpen, setExportDockOpen] = useState(false);
  const [resourceRefreshKey, setResourceRefreshKey] = useState(0);
  const [autoProduceState, setAutoProduceState] = useState(createInitialAutoProduceState);
  const [fullVideoPrompt, setFullVideoPrompt] = useState('');
  const [isGeneratingFullVideo, setIsGeneratingFullVideo] = useState(false);
  const [fullVideoResult, setFullVideoResult] = useState(null);
  const [fullVideoError, setFullVideoError] = useState('');
  const { backendStatus, errorMessage, lastCheckedAt, realtimeStatus, providerStatuses } = useAppHealth();
  const {
    currentVideo,
    videos,
    uploadProgress,
    uploadStatus,
    uploadError,
    validationMessage,
    uploadStartedAt,
    uploadLimit,
    uploadSelectedFile
  } = useVideoUpload();
  const {
    analysis,
    analysisOptions,
    loading,
    error,
    progress,
    status,
    statusMessage,
    runAnalysis,
    setAnalysisOptions,
    applyAnalysisPayload
  } = useAnalysis();
  const { segments, splitProgress, segmentsLoading, segmentsError, splitFromAnalysis, refreshSegments } = useSegments();
  const {
    backgroundAssets,
    backgroundAssetsLoading,
    backgroundAssetsError,
    mergeProgress,
    segmentExportProgress,
    videoRatio,
    analyzingSegmentId,
    optimizingSegmentId,
    generatingSegmentIds,
    generatingShotKeys,
    batchGeneratingSegmentIds,
    optimizingShotKeys,
    savingShotSegmentIds,
    setSegmentPrompt,
    setShotPrompt,
    analyzeSegmentById,
    optimizeSegmentPrompt,
    optimizeShotPrompt,
    saveSegmentShotDefinitions,
    setVideoRatio,
    generateSegmentVideo,
    generateShotVideo,
    generateAllShotsForSegment,
    generateFullVideo,
    startMerge,
    downloadMergedVideo,
    startSegmentExportArchive,
    downloadSegmentArchive
  } = useGeneration();

  const generatedSegments = segments.filter((segment) => segment.generatedUrl).length;
  const promptsReady = segments.filter((segment) => segment.prompt?.trim()).length;
  const activeGenerationCount = generatingSegmentIds.length;
  const readyBackgroundAssets = backgroundAssets.filter((asset) => asset.status === 'completed').length;
  const uploadStageStatus = currentVideo
    ? 'uploaded'
    : uploadStatus === 'uploading'
      ? 'uploading'
      : uploadError
        ? 'error'
        : 'idle';
  const analysisStageStatus = error
    ? 'failed'
    : loading || status === 'processing'
      ? 'processing'
      : analysis?.is_mock
        ? 'fallback'
        : analysis
          ? 'completed'
          : currentVideo
            ? 'pending'
            : 'idle';
  const splitStageStatus = segmentsError
    ? 'failed'
    : splitProgress.status === 'processing' || segmentsLoading
      ? 'processing'
      : segments.length
        ? 'completed'
        : analysis
          ? 'pending'
          : 'idle';
  const generateStageStatus = activeGenerationCount
    ? 'processing'
    : generatedSegments
      ? 'completed'
      : segments.length
        ? 'pending'
        : 'idle';
  const currentStyleMode = normalizeStyleMode(analysisOptions?.styleMode ?? analysisOptions?.style_mode ?? DEFAULT_STYLE_MODE);
  const mergeStageStatus =
    mergeProgress.status === 'completed'
      ? 'completed'
      : mergeProgress.status === 'processing' || mergeProgress.status === 'pending'
        ? 'processing'
        : mergeProgress.errorMessage
          ? 'failed'
          : currentVideo && segments.length
            ? 'pending'
            : 'idle';
  const backendStatusLabel =
    backendStatus === 'online'
      ? '在线'
      : backendStatus === 'degraded'
        ? '降级'
        : backendStatus === 'offline'
          ? '离线'
          : '检查中';
  const analysisSourceLabel = error
    ? '分析失败'
    : loading || status === 'processing'
      ? '分析中'
      : analysis?.is_mock
        ? 'Mock 回退'
        : analysis
          ? '真实 Gemini'
          : '等待分析';

  const topMetrics = [
    {
      label: '视频',
      value: videos.length,
      note: currentVideo?.filename || '未选择'
    },
    {
      label: '角色',
      value: analysis?.characters?.length ?? 0,
      note: analysis ? analysisSourceLabel : '待提取'
    },
    {
      label: '片段',
      value: segments.length,
      note: segments.length ? '已入工位' : '待切分'
    },
    {
      label: '背景',
      value: readyBackgroundAssets,
      note: backgroundAssets.length ? `${backgroundAssets.length} 个场景` : '待命中'
    },
    {
      label: '导出',
      value: generatedSegments,
      note: activeGenerationCount ? `${activeGenerationCount} 个运行中` : '待生成'
    }
  ];

  const workflowSteps = [
    {
      id: 'upload',
      label: '上传素材',
      description: currentVideo ? '已进入当前项目上下文。' : '选择原始视频作为整片分析输入。',
      status: uploadStageStatus,
      meta:
        uploadStatus === 'uploading'
          ? `上传进度 ${uploadProgress}%`
          : currentVideo
            ? currentVideo.filename
            : '支持 MP4 / MOV / AVI'
    },
    {
      id: 'analysis',
      label: '整片分析',
      description:
        loading || status === 'processing'
          ? 'Gemini 正在处理整片剧情、角色、场景和镜头边界。'
          : analysis
            ? '剧情、角色、场景和切分预案已完成。'
            : '发送整片视频做场景和角色理解。',
      status: analysisStageStatus,
      meta: analysis ? analysisSourceLabel : statusMessage || '等待开始分析'
    },
    {
      id: 'split',
      label: '片段工位',
      description: segments.length ? '切分完成，可逐段处理。' : '等待整片分析输出切分结果。',
      status: splitStageStatus,
      meta: segments.length ? `${segments.length} 个片段` : splitProgress.message || '等待切分'
    },
    {
      id: 'generate',
      label: '片段生成',
      description: segments.length ? '每段都可分析、优化、生成。' : '切分完成后可逐段处理。',
      status: generateStageStatus,
      meta: generatedSegments ? `${generatedSegments} 条已生成` : '等待生成任务'
    },
    {
      id: 'merge',
      label: '导出成片',
      description: '只使用真实生成片段，缺失部分直接提示。',
      status: mergeStageStatus,
      meta:
        mergeProgress.status === 'completed'
          ? '成片可下载'
          : mergeProgress.message || '等待拼接'
    }
  ];

  const operatorChecklist = [
    { label: '项目上下文', done: Boolean(currentVideo), note: currentVideo?.filename || '未选择素材' },
    { label: '整片理解', done: Boolean(analysis), note: analysis ? analysisSourceLabel : '待分析' },
    { label: '片段就绪', done: segments.length > 0, note: segments.length ? `${segments.length} 个片段` : '待切分' },
    { label: '成片下载', done: mergeProgress.status === 'completed', note: mergeProgress.status === 'completed' ? '可直接下载' : '待拼接' }
  ];

  const issueMessages = [
    uploadError,
    errorMessage,
    error,
    segmentsError,
    backgroundAssetsError,
    mergeProgress.errorMessage,
    backendStatus === 'offline' || providerStatuses.seedance.ready
      ? ''
      : `Seedance 未就绪：${providerStatuses.seedance.reason || '缺少必要配置。'}`,
    backendStatus === 'offline' || providerStatuses.geminiImage.ready
      ? ''
      : `Gemini 生图未就绪：${providerStatuses.geminiImage.reason || '缺少必要配置。'}`,
    analysis?.is_mock ? '当前整片分析回退到了 mock 结果，请关注系统状态中的调用说明。' : ''
  ].filter(Boolean);
  const isAutoProducing = autoProduceState.status === 'processing';
  const autoProduceBlockedReason = !currentVideo?.id
    ? '请先上传视频。'
    : uploadStatus === 'uploading'
      ? '视频上传中，请等待上传完成。'
      : backendStatus === 'offline'
        ? '后端当前离线，无法开始一键出片。'
        : !providerStatuses.geminiImage.ready
          ? `Gemini 生图未就绪：${providerStatuses.geminiImage.reason || '缺少必要配置。'}`
          : !providerStatuses.seedance.ready
            ? `Seedance 未就绪：${providerStatuses.seedance.reason || '缺少必要配置。'}`
            : '';
  const canStartAutoProduce = !isAutoProducing && !autoProduceBlockedReason;

  const updateAutoProduceState = (partialState) => {
    setAutoProduceState((currentState) => ({
      ...currentState,
      ...partialState
    }));
  };

  const waitForSegmentAssembly = async (segmentId) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < AUTO_PRODUCE_STEP_TIMEOUT_MS) {
      await refreshSegments();
      const latestSegment = useGenerationStore.getState().segments.find((segment) => segment.id === segmentId) ?? null;
      const assemblySummary = latestSegment?.latestShotAssemblyTask ?? latestSegment?.shotGenerationSummary ?? null;

      if (assemblySummary?.status === 'completed' && (assemblySummary.result_url || latestSegment?.generatedUrl)) {
        return latestSegment;
      }

      if (assemblySummary?.status === 'failed') {
        throw new Error(assemblySummary.error_message || `片段 ${segmentId} 的小镜头批量生成失败。`);
      }

      await sleep(AUTO_PRODUCE_POLL_INTERVAL_MS);
    }

    throw new Error(`片段 ${segmentId} 的镜头拼回超时，请稍后查看当前片段状态。`);
  };

  const optimizeAndGenerateResources = async (analysisPayload) => {
    const styleTemplates = analysisOptions?.styleTemplates ?? analysisOptions?.style_templates ?? null;
    const characterResources = buildAutoCharacterResources(analysisPayload, {
      styleMode: currentStyleMode,
      styleTemplates
    });
    const sceneResources = buildAutoSceneResources(analysisPayload, {
      styleMode: currentStyleMode,
      styleTemplates
    });
    const allResources = [...characterResources, ...sceneResources];

    if (!allResources.length) {
      return;
    }

    for (let resourceIndex = 0; resourceIndex < allResources.length; resourceIndex += 1) {
      const resource = allResources[resourceIndex];
      const phaseProgress = 20 + Math.round(((resourceIndex + 1) / allResources.length) * 18);

      updateAutoProduceState({
        progress: phaseProgress,
        message: `正在优化并生成${resource.resourceType === 'character' ? '角色' : '场景'}资源：${resource.resourceName}`
      });

      const optimizeMode = resource.resourceType === 'character' ? 'character_resource' : 'scene_resource';
      const optimizedPayload = await optimizePromptRequest(
        resource.sourcePrompt,
        resource.resourceType === 'character'
          ? [
              {
                id: resource.resourceId,
                name: resource.resourceName,
                appearancePrompt: resource.appearancePrompt || '',
                personalityPrompt: resource.personalityPrompt || ''
              }
            ]
          : [],
        resource.resourceType === 'scene'
          ? [
              {
                id: resource.resourceId,
                name: resource.resourceName,
                description: resource.description || '',
                scenePrompt: resource.sourcePrompt
              }
            ]
          : [],
        {
          mode: optimizeMode,
          style_mode: currentStyleMode
        }
      );

      const optimizedPrompt = String(optimizedPayload?.optimized_prompt ?? '').trim() || resource.sourcePrompt;
      const variantPrompts =
        resource.resourceType === 'character'
          ? buildCharacterViewPrompts({
              resourceName: resource.resourceName,
              prompt: optimizedPrompt,
              appearancePrompt: resource.appearancePrompt || '',
              personalityPrompt: resource.personalityPrompt || '',
              styleMode: currentStyleMode,
              styleTemplates
            })
          : buildSceneAnglePrompts({
              resourceName: resource.resourceName,
              prompt: optimizedPrompt,
              styleMode: currentStyleMode,
              styleTemplates
            });

      const generationPayload = await generateResourceImagesRequest({
        video_id: Number(currentVideo.id),
        resource_type: resource.resourceType,
        resource_id: resource.resourceId,
        resource_name: resource.resourceName,
        source_prompt: optimizedPrompt,
        representative_frame_time: resource.frameTime ?? null,
        variants: variantPrompts.map((variant, index) => ({
          id: variant.id,
          label: variant.label,
          prompt: variant.prompt,
          sortOrder: index
        }))
      });

      if (generationPayload?.error_summary) {
        throw new Error(generationPayload.error_summary);
      }
    }

    setResourceRefreshKey((currentValue) => currentValue + 1);
  };

  const generateSegmentsFromCurrentPrompts = async () => {
    let latestSegments = useGenerationStore.getState().segments ?? [];

    if (!latestSegments.length) {
      await refreshSegments();
      latestSegments = useGenerationStore.getState().segments ?? [];
    }

    if (!latestSegments.length) {
      throw new Error('切分完成后没有拿到任何片段，无法继续一键出片。');
    }

    for (let segmentIndex = 0; segmentIndex < latestSegments.length; segmentIndex += 1) {
      const currentSegment =
        useGenerationStore.getState().segments.find((segment) => segment.id === latestSegments[segmentIndex].id) ??
        latestSegments[segmentIndex];
      const segmentLabel = `片段 ${String((currentSegment.segmentIndex ?? segmentIndex) + 1).padStart(2, '0')}`;

      updateAutoProduceState({
        progress: 42 + Math.round(((segmentIndex + 1) / latestSegments.length) * 40),
        message: `正在按当前提示词生成 ${segmentLabel}`
      });

      const latestSegment =
        useGenerationStore.getState().segments.find((segment) => segment.id === currentSegment.id) ?? currentSegment;
      const shotsForGeneration = Array.isArray(latestSegment.shots) ? latestSegment.shots : [];

      if (!shotsForGeneration.length) {
        throw new Error(`${segmentLabel} 还没有可生成的小镜头。`);
      }

      const batchPayload = await generateAllShotsForSegment(latestSegment.id, shotsForGeneration, {
        useReferenceVideo: false,
        useRepresentativeFrame: false
      });

      if (!batchPayload) {
        throw new Error(`${segmentLabel} 的小镜头批量生成启动失败。`);
      }

      await waitForSegmentAssembly(latestSegment.id);
    }
  };

  const runAutoProduce = async () => {
    if (autoProduceBlockedReason) {
      updateAutoProduceState({
        status: 'failed',
        progress: 0,
        message: '一键出片未启动',
        error: autoProduceBlockedReason,
        startedAt: '',
        completedAt: ''
      });
      return null;
    }

    updateAutoProduceState({
      status: 'processing',
      progress: 4,
      message: '正在启动一键出片流程',
      error: '',
      startedAt: new Date().toISOString(),
      completedAt: ''
    });

    try {
      updateAutoProduceState({
        progress: 8,
        message: '步骤 1/5：整片理解中'
      });
      const analysisPayload = await runAnalysis();

      if (!analysisPayload) {
        throw new Error('整片分析没有返回结果，请稍后重试。');
      }

      updateAutoProduceState({
        progress: 18,
        message: '步骤 2/5：优化角色/场景提示词并生成资源图'
      });
      await optimizeAndGenerateResources(analysisPayload);

      updateAutoProduceState({
        progress: 38,
        message: '步骤 3/5：根据整片理解自动切分大片段与小镜头'
      });
      const splitPayload = await splitFromAnalysis();

      if (!splitPayload || splitPayload.status === 'failed') {
        throw new Error(splitPayload?.error_message || '视频切分失败，请检查整片分析结果。');
      }

      updateAutoProduceState({
        progress: 44,
        message: '步骤 4/5：按当前片段与镜头提示词批量生成新镜头'
      });
      await generateSegmentsFromCurrentPrompts();

      updateAutoProduceState({
        progress: 92,
        message: '步骤 5/5：自动拼接成片'
      });
      const mergePayload = await startMerge();

      if (!mergePayload || mergePayload.status === 'failed') {
        throw new Error(mergePayload?.error_message || mergePayload?.message || '成片拼接失败。');
      }

      setExportDockOpen(true);
      updateAutoProduceState({
        status: 'completed',
        progress: 100,
        message: '一键出片完成，成片已进入导出区。',
        error: '',
        completedAt: new Date().toISOString()
      });

      return mergePayload;
    } catch (productionError) {
      updateAutoProduceState({
        status: 'failed',
        message: '一键出片失败',
        error: productionError?.message || '自动流程执行失败，请查看当前步骤状态。',
        completedAt: new Date().toISOString()
      });
      setExportDockOpen(true);
      return null;
    }
  };

  const handleGenerateFullVideo = async () => {
    if (!currentVideo?.id || !analysis) {
      setFullVideoError('请先上传视频并完成整片分析。');
      return;
    }

    if (!fullVideoPrompt?.trim()) {
      setFullVideoError('请输入完整视频提示词。');
      return;
    }

    setIsGeneratingFullVideo(true);
    setFullVideoError('');
    setFullVideoResult(null);

    try {
      const result = await generateFullVideo(currentVideo.id, fullVideoPrompt, {
        useReferenceVideo: true,
        useRepresentativeFrame: true
      });

      if (result?.status === 'completed') {
        setFullVideoResult(result);
      } else if (result?.status === 'failed') {
        setFullVideoError(result.error_message || '完整视频生成失败。');
      }
    } catch (error) {
      setFullVideoError(error?.message || '完整视频生成失败，请稍后重试。');
    } finally {
      setIsGeneratingFullVideo(false);
    }
  };

  const autoProduceFooterContent =
    isAutoProducing || autoProduceState.error || autoProduceState.status === 'completed' ? (
      <div className="rounded-[22px] border border-white/10 bg-black/25 px-4 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">Auto Pipeline</p>
            <h3 className="mt-2 text-sm font-semibold">一键出片进度</h3>
            <p className="mt-1 text-xs leading-5 text-white/60">
              {autoProduceState.message}
            </p>
          </div>
          <StatusBadge status={autoProduceState.status} label={autoProduceState.status === 'completed' ? '已完成' : autoProduceState.status === 'failed' ? '失败' : '执行中'} />
        </div>

        <div className="mt-3">
          <ProgressBar
            value={autoProduceState.progress}
            status={autoProduceState.status === 'failed' ? 'failed' : autoProduceState.status === 'completed' ? 'completed' : 'processing'}
            label={autoProduceState.message}
            startedAt={autoProduceState.startedAt}
          />
        </div>

        {autoProduceState.error ? (
          <div className="mt-3 rounded-[18px] border border-accent-500/20 bg-accent-500/10 px-3 py-2 text-xs leading-5 text-rose-200">
            {autoProduceState.error}
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      <a href="#studio-main" className="studio-skip-link">
        跳到主要工作台
      </a>

      <main className="dashboard-shell compact-console">
        <div className="dashboard-orb dashboard-orb-left" />
        <div className="dashboard-orb dashboard-orb-right" />

        <header className="panel-shell panel-shell-strong compact-topbar">
          <div className="compact-topbar-brand">
            <div className="compact-topbar-logo">FV</div>
            <div className="min-w-0">
              <p className="compact-topbar-eyebrow">Fanshi Vidio Clone</p>
              <h1 className="compact-topbar-title">AI 片段控制台</h1>
              <p className="compact-topbar-subtitle">
                顶部状态栏 + 双列工作台。左列聚合项目、上传与整片资源，右列专注片段工位，导出固定在右下角。
              </p>
            </div>
          </div>

          <div className="compact-topbar-metrics">
            {topMetrics.map((item) => (
              <CompactStat key={item.label} label={item.label} value={item.value} note={item.note} />
            ))}
          </div>

          <div className="compact-topbar-actions">
            <label className="compact-ratio-chip" htmlFor="global-style-mode">
              <span className="compact-ratio-copy">
                <span className="compact-ratio-label">全局风格</span>
                <span className="compact-ratio-note">分析、资源图与视频统一沿用</span>
              </span>
              <select
                id="global-style-mode"
                className="compact-ratio-select"
                value={currentStyleMode}
                onChange={(event) =>
                  setAnalysisOptions({
                    styleMode: event.target.value
                  })
                }
              >
                {STYLE_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="compact-ratio-chip" htmlFor="global-video-ratio">
              <span className="compact-ratio-copy">
                <span className="compact-ratio-label">生成比例</span>
                <span className="compact-ratio-note">子镜头与片段统一沿用</span>
              </span>
              <select
                id="global-video-ratio"
                className="compact-ratio-select"
                value={videoRatio}
                onChange={(event) => setVideoRatio(event.target.value)}
              >
                {VIDEO_RATIO_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <StatusBadge status={backendStatus} label={`后端 ${backendStatusLabel}`} />
            <StatusBadge
              status={realtimeStatus}
              label={realtimeStatus === 'realtime' ? '实时通道已连接' : '实时通道监控中'}
            />
            <StatusBadge status={analysisStageStatus} label={`分析态 ${analysisSourceLabel}`} />
            <button
              type="button"
              className="console-chip transition hover:border-white/20 hover:bg-white/[0.08]"
              onClick={() => setSystemModalOpen(true)}
            >
              <span>系统状态</span>
              <span className="font-bold text-white">{issueMessages.length || 0}</span>
            </button>
          </div>
        </header>

        <div id="studio-main" className="compact-studio-grid">
          <div className="compact-studio-cell">
            <div className="compact-cell-stack">
              <section className="panel-shell panel-shell-strong compact-brief-panel">
                <div className="compact-brief-header">
                  <div>
                    <p className="compact-card-eyebrow">Project</p>
                    <h2 className="compact-card-title">项目与上传</h2>
                  </div>
                  <StatusBadge
                    status={issueMessages.length ? 'fallback' : 'online'}
                    label={issueMessages.length ? `${issueMessages.length} 个提醒` : '运行稳定'}
                  />
                </div>

                <div className="compact-brief-grid">
                  <div className="compact-info-tile">
                    <p className="compact-info-label">当前素材</p>
                    <p className="compact-info-value">{currentVideo?.filename || '未选择'}</p>
                  </div>
                  <div className="compact-info-tile">
                    <p className="compact-info-label">上传限制</p>
                    <p className="compact-info-value">{Math.round(uploadLimit / 1024 / 1024)} MB</p>
                  </div>
                  <div className="compact-info-tile">
                    <p className="compact-info-label">最近上传</p>
                    <p className="compact-info-value">
                      {uploadStartedAt ? formatDateTime(uploadStartedAt) : '暂无记录'}
                    </p>
                  </div>
                  <div className="compact-info-tile">
                    <p className="compact-info-label">最近检查</p>
                    <p className="compact-info-value">
                      {lastCheckedAt ? formatDateTime(lastCheckedAt) : '等待首次检查'}
                    </p>
                  </div>
                </div>

                <div className="compact-checklist-grid">
                  {operatorChecklist.map((item) => (
                    <div key={item.label} className="compact-checklist-item">
                      <div>
                        <p className="compact-checklist-label">{item.label}</p>
                        <p className="compact-checklist-note">{item.note}</p>
                      </div>
                      <StatusBadge status={item.done ? 'completed' : 'idle'} />
                    </div>
                  ))}
                </div>
              </section>

              <UploadArea
                currentVideo={currentVideo}
                videos={videos}
                uploadProgress={uploadProgress}
                uploadStatus={uploadStatus}
                uploadError={uploadError}
                validationMessage={validationMessage}
                uploadStartedAt={uploadStartedAt}
                uploadLimit={uploadLimit}
                onUpload={uploadSelectedFile}
                compactMode
                className="compact-surface"
                extraActions={
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/12 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition hover:border-emerald-500/40 hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void runAutoProduce()}
                    disabled={!canStartAutoProduce}
                    title={
                      autoProduceBlockedReason ||
                      '自动执行整片理解、资源出图，并在三视图就绪后直接按当前提示词生成小镜头与拼接成片。'
                    }
                  >
                    {isAutoProducing ? '一键出片进行中...' : '一键出片'}
                  </button>
                }
                footerContent={autoProduceFooterContent}
              />

              <AnalysisDisplay
                video={currentVideo}
                analysis={analysis}
                resourceRefreshKey={resourceRefreshKey}
                analysisOptions={analysisOptions}
                backgroundAssets={backgroundAssets}
                backgroundAssetsLoading={backgroundAssetsLoading}
                backgroundAssetsError={backgroundAssetsError}
                loading={loading}
                error={error}
                progress={progress}
                status={status}
                statusMessage={statusMessage}
                splitProgress={splitProgress}
                onAnalyze={runAnalysis}
                onAnalysisOptionsChange={setAnalysisOptions}
                onAnalysisUpdated={applyAnalysisPayload}
                onSplit={splitFromAnalysis}
                compactMode
                className="compact-surface compact-analysis-panel"
              />

              {analysis && !isAutoProducing && (
                <section className="panel-shell panel-shell-strong compact-surface">
                  <div className="compact-panel-header">
                    <div>
                      <p className="compact-card-eyebrow">Full Video Generation</p>
                      <h2 className="compact-card-title">生成完整视频</h2>
                      <p className="compact-card-note">
                        使用整片分析结果，一次性生成完整视频（所有镜头拼接为一个提示词）
                      </p>
                    </div>
                    <StatusBadge
                      status={isGeneratingFullVideo ? 'processing' : fullVideoResult ? 'completed' : 'pending'}
                      label={isGeneratingFullVideo ? '生成中' : fullVideoResult ? '已完成' : '待生成'}
                    />
                  </div>

                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="full-video-prompt" className="block text-sm font-medium text-white/80 mb-2">
                        完整视频提示词
                      </label>
                      <textarea
                        id="full-video-prompt"
                        className="w-full rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-white/40 focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        rows={6}
                        placeholder="输入完整视频的提示词，描述整体风格、场景、角色和动作..."
                        value={fullVideoPrompt}
                        onChange={(e) => setFullVideoPrompt(e.target.value)}
                        disabled={isGeneratingFullVideo}
                      />
                    </div>

                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-full border border-brand-500/25 bg-brand-500/12 px-6 py-3 text-sm font-semibold text-brand-100 transition hover:border-brand-500/40 hover:bg-brand-500/18 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={handleGenerateFullVideo}
                      disabled={!currentVideo?.id || !analysis || !fullVideoPrompt?.trim() || isGeneratingFullVideo}
                    >
                      {isGeneratingFullVideo ? '生成中...' : '生成完整视频'}
                    </button>

                    {isGeneratingFullVideo && (
                      <div className="rounded-[18px] border border-brand-500/20 bg-brand-500/5 px-4 py-3">
                        <p className="text-sm text-white/80">正在生成完整视频，请稍候...</p>
                      </div>
                    )}

                    {fullVideoResult && !isGeneratingFullVideo && (
                      <div className="rounded-[18px] border border-emerald-500/20 bg-emerald-500/5 px-4 py-4">
                        <h3 className="text-sm font-semibold text-emerald-100 mb-3">生成完成</h3>
                        {fullVideoResult.result_url && (
                          <div className="space-y-3">
                            <video
                              src={toAbsoluteAssetUrl(fullVideoResult.result_url)}
                              controls
                              className="w-full rounded-[14px] bg-black"
                            />
                            <a
                              href={toAbsoluteAssetUrl(fullVideoResult.result_url)}
                              download
                              className="inline-flex items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/12 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-500/40 hover:bg-emerald-500/18"
                            >
                              下载视频
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {fullVideoError && (
                      <div className="rounded-[18px] border border-accent-500/20 bg-accent-500/10 px-4 py-3">
                        <h3 className="text-sm font-semibold text-rose-200 mb-1">生成失败</h3>
                        <p className="text-xs text-rose-200/80">{fullVideoError}</p>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>

          <div className="compact-studio-cell">
            <section className="panel-shell panel-shell-strong compact-surface compact-workbench-panel">
              <div className="compact-panel-header">
                <div>
                  <p className="compact-card-eyebrow">Workbench</p>
                  <h2 className="compact-card-title">片段工作台</h2>
                  <p className="compact-card-note">
                    右上固定为片段工位。每个片段都保持单卡常驻，只展示预览、最终提示词、生成结果和关键操作。
                  </p>
                </div>
                <StatusBadge
                  status={splitStageStatus}
                  label={segments.length ? `${segments.length} 个片段` : '等待切分'}
                />
              </div>

              <div className="stage-toolbar compact-toolbar">
                <span className="toolbar-pill">全局风格 {STYLE_MODE_OPTIONS.find((option) => option.value === currentStyleMode)?.label || '写实'}</span>
                <span className="toolbar-pill">全局比例 {videoRatio}</span>
                <span className="toolbar-pill">Prompt 就绪 {promptsReady}</span>
                <span className="toolbar-pill">运行中 {activeGenerationCount}</span>
                <span className="toolbar-pill">已生成 {generatedSegments}</span>
                <span className="toolbar-pill">背景资产 {readyBackgroundAssets}</span>
              </div>

              {segmentsError ? (
                <div
                  role="alert"
                  className="mt-3 rounded-[18px] border border-accent-500/20 bg-accent-500/10 px-3 py-3 text-xs text-rose-200"
                >
                  {segmentsError}
                </div>
              ) : null}

              <div className="compact-segment-scroll">
                {segments.length ? (
                  segments.map((segment) => (
                    <SegmentCard
                      key={segment.id}
                      segment={segment}
                      overallAnalysis={analysis}
                      analysisOptions={analysisOptions}
                      timeAnchor={analysis?.time_anchors?.[segment.segmentIndex] || null}
                      backgroundAsset={
                        backgroundAssets.find((asset) => asset.backgroundId === segment.backgroundId) || null
                      }
                      expanded={false}
                      onToggle={() => {}}
                      onAnalysisOptionsChange={setAnalysisOptions}
                      onPromptChange={setSegmentPrompt}
                      onShotPromptChange={setShotPrompt}
                      onAnalyze={analyzeSegmentById}
                      onOptimize={optimizeSegmentPrompt}
                      onOptimizeShot={optimizeShotPrompt}
                      onGenerate={generateSegmentVideo}
                      onGenerateShot={generateShotVideo}
                      onGenerateAllShots={generateAllShotsForSegment}
                      onSaveShots={saveSegmentShotDefinitions}
                      isAnalyzing={analyzingSegmentId === segment.id}
                      isOptimizing={optimizingSegmentId === segment.id}
                      isGenerating={generatingSegmentIds.includes(segment.id)}
                      generatingShotKeys={generatingShotKeys}
                      isBatchGenerating={batchGeneratingSegmentIds.includes(segment.id)}
                      optimizingShotKeys={optimizingShotKeys}
                      isSavingShots={savingShotSegmentIds.includes(segment.id)}
                    />
                  ))
                ) : (
                  <div className="preview-placeholder min-h-[220px]">
                    <div className="preview-orb" />
                    <p className="text-base font-semibold text-white">还没有片段卡片</p>
                    <p className="mt-2 max-w-sm text-center text-xs leading-5 text-white/60">
                      先完成整片分析并点击“生成片段”，这里就会出现可编辑、可生成、可回看上下文的片段工位。
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>

        </div>

        <div className="floating-export-dock">
          {exportDockOpen ? (
            <div id="floating-export-panel" className="floating-export-panel">
              <section className="floating-export-checklist">
                <div className="floating-export-header">
                  <div>
                    <p className="floating-export-eyebrow">Export Checklist</p>
                    <h2 className="floating-export-title">导出前检查</h2>
                  </div>
                  <button
                    type="button"
                    className="floating-export-panel-close"
                    onClick={() => setExportDockOpen(false)}
                    aria-label="关闭导出面板"
                  >
                    关闭
                  </button>
                </div>

                <div className="floating-export-grid">
                  <div className="floating-export-metric">
                    <span className="floating-export-label">片段覆盖率</span>
                    <span className="floating-export-value">
                      {generatedSegments} / {segments.length || 0}
                    </span>
                  </div>
                  <div className="floating-export-metric">
                    <span className="floating-export-label">背景资产</span>
                    <span className="floating-export-value">
                      {readyBackgroundAssets} / {backgroundAssets.length || 0}
                    </span>
                  </div>
                </div>

                <div className="compact-issue-list">
                  {issueMessages.length ? (
                    issueMessages.slice(0, 2).map((message, index) => (
                      <div key={`${message}-${index}`} className="compact-issue-item">
                        {message}
                      </div>
                    ))
                  ) : (
                    <div className="compact-issue-item compact-issue-item-success">
                      当前没有异常提醒，可以继续片段生成或直接导出。
                    </div>
                  )}
                </div>
              </section>

              <VideoMerge
                video={currentVideo}
                segments={segments}
                mergeProgress={mergeProgress}
                segmentExportProgress={segmentExportProgress}
                onMerge={startMerge}
                onDownload={downloadMergedVideo}
                onExportSegments={startSegmentExportArchive}
                onDownloadSegments={downloadSegmentArchive}
                compactMode
                dockMode
              />
            </div>
          ) : null}

          <button
            type="button"
            className={`floating-export-launcher ${exportDockOpen ? 'floating-export-launcher-open' : ''}`}
            onClick={() => setExportDockOpen((currentState) => !currentState)}
            aria-expanded={exportDockOpen}
            aria-controls="floating-export-panel"
          >
            <div className="floating-export-launcher-copy">
              <p className="floating-export-eyebrow">Export Dock</p>
              <h2 className="floating-export-launcher-title">导出与检查</h2>
              <p className="floating-export-launcher-note">
                {mergeProgress.status === 'completed'
                  ? '成片已就绪，可直接下载'
                  : mergeProgress.status === 'processing' || mergeProgress.status === 'pending'
                    ? mergeProgress.message || '拼接进行中'
                    : issueMessages[0] || '点击展开导出前检查与成片拼接'}
              </p>
            </div>
            <div className="floating-export-launcher-side">
              <StatusBadge
                status={mergeStageStatus}
                label={mergeProgress.status === 'completed' ? '可下载' : '待导出'}
              />
              <span className="floating-export-launcher-caret" aria-hidden="true">
                {exportDockOpen ? '收起' : '展开'}
              </span>
            </div>
          </button>
        </div>

        <ModalSheet
          open={systemModalOpen}
          onClose={() => setSystemModalOpen(false)}
          title="系统状态与工作流"
          description="这里集中显示后端联调状态、工作流进度、操作建议和异常提醒。"
          size="xl"
        >
          <div className="space-y-5">
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">联调状态</p>
                  <StatusBadge status={backendStatus} label={`后端 ${backendStatusLabel}`} />
                </div>
                <p className="mt-3 text-xs leading-6 text-white/55">
                  {errorMessage || '健康检查通过，前端可继续调用真实服务。'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge
                    status={realtimeStatus}
                    label={realtimeStatus === 'realtime' ? '实时推送' : '监控中'}
                  />
                  <StatusBadge
                    status={providerStatuses.seedance.ready ? 'completed' : 'fallback'}
                    label={
                      providerStatuses.seedance.ready
                        ? 'Seedance 已就绪'
                        : 'Seedance 未就绪'
                    }
                  />
                  <StatusBadge
                    status={providerStatuses.geminiImage.ready ? 'completed' : 'fallback'}
                    label={
                      providerStatuses.geminiImage.ready
                        ? 'Gemini 生图已就绪'
                        : 'Gemini 生图未就绪'
                    }
                  />
                  <span className="toolbar-pill">
                    最近检查 {lastCheckedAt ? formatDateTime(lastCheckedAt) : '暂无'}
                  </span>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                <p className="text-sm font-semibold text-white">需要处理的提醒</p>
                {issueMessages.length ? (
                  <ul className="mt-3 space-y-2 text-xs leading-5 text-white/70">
                    {issueMessages.map((message, index) => (
                      <li key={`${message}-${index}`} className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3">
                        {message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs leading-6 text-white/55">
                    当前没有异常提醒，可以继续处理片段 Prompt、生成和成片输出。
                  </p>
                )}
              </div>
            </section>

            <section>
              <p className="glass-label">Workflow</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {workflowSteps.map((step, index) => (
                  <article key={step.id} className={`workflow-step ${resolveStepCardClassName(step.status)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/40">
                          Step {String(index + 1).padStart(2, '0')}
                        </p>
                        <h3 className="mt-2 text-base font-semibold text-white">{step.label}</h3>
                      </div>
                      <StatusBadge status={step.status} />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/70">{step.description}</p>
                    <p className="mt-4 text-xs leading-5 text-white/40">{step.meta}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </ModalSheet>
      </main>
    </>
  );
};

export default MainPage;
