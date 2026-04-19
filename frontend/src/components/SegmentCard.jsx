import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import ModalSheet from './ModalSheet.jsx';
import ProgressBar from './ProgressBar.jsx';
import PromptEditor from './PromptEditor.jsx';
import PromptPreview from './PromptPreview.jsx';
import StatusBadge from './StatusBadge.jsx';
import VideoFramePreview from './VideoFramePreview.jsx';
import { useAppStore } from '../store/appStore.js';
import { formatDuration } from '../utils/formatDuration.js';
import { tokenizePrompt } from '../utils/mentionTokens.js';
import {
  buildPromptOptimizationPrompt,
  buildSegmentAnalysisPrompt,
  expandResourceMentions
} from '../utils/promptBlueprints.js';

const getNormalizedFrameTime = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Number(parsedValue.toFixed(2));
};

const clampTime = (value, min, max) => {
  return Math.max(min, Math.min(value, max));
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
    return '背景资产已就绪';
  }

  if (backgroundAsset.status === 'failed') {
    return '背景资产失败';
  }

  if (backgroundAsset.status === 'processing') {
    return '背景资产生成中';
  }

  return '等待生成';
};

const getGenerationEngineBadge = (generationTask) => {
  if (!generationTask) {
    return null;
  }

  if (generationTask.is_mock) {
    return {
      status: 'fallback',
      label: 'Mock 回退'
    };
  }

  if (generationTask.engine === 'seed-dance-remote') {
    return {
      status: 'completed',
      label: '真实 Seedance'
    };
  }

  if (generationTask.status === 'failed' && generationTask.provider_error) {
    return {
      status: 'failed',
      label: '调用失败'
    };
  }

  return null;
};

const renderPromptTokenPreview = (value = '') => {
  return tokenizePrompt(value).map((token, index) => {
    if (token.type === 'character-mention' || token.type === 'scene-mention') {
      return (
        <span
          key={`${token.value}-${index}`}
          className={`mx-0.5 inline-flex rounded-full px-1.5 py-0.5 font-semibold ${
            token.type === 'scene-mention'
              ? 'border border-amber-500/25 bg-amber-500/10 text-amber-100'
              : 'border border-brand-500/20 bg-brand-500/10 text-brand-100'
          }`}
        >
          {token.value}
        </span>
      );
    }

    return <span key={`${token.value}-${index}`}>{token.value}</span>;
  });
};

const SegmentCard = ({
  segment,
  overallAnalysis = null,
  timeAnchor = null,
  backgroundAsset = null,
  expanded = false,
  onToggle,
  onPromptChange,
  onAnalyze,
  onOptimize,
  onGenerate,
  isAnalyzing = false,
  isOptimizing = false,
  isGenerating = false
}) => {
  const [draftPrompt, setDraftPrompt] = useState(segment.prompt ?? '');
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const seedDanceProvider = useAppStore((state) => state.providerStatuses.seedance);
  const generationState = isGenerating
    ? {
        status: 'processing',
        progress: segment.latestGenerationTask?.progress ?? 30
      }
    : segment.latestGenerationTask;
  const characters = overallAnalysis?.characters ?? [];
  const backgrounds = overallAnalysis?.backgrounds ?? [];
  const segmentAnalysisPrompt = buildSegmentAnalysisPrompt({
    segment,
    overallAnalysis
  });
  const promptOptimizationPrompt = buildPromptOptimizationPrompt({
    prompt: draftPrompt,
    characters,
    backgrounds
  });
  const originalSegmentSummary =
    timeAnchor?.sceneSummary || timeAnchor?.scene_summary || segment.sceneSummary || segment.scene || '';
  const originalSegmentPrompt =
    timeAnchor?.scenePrompt ||
    timeAnchor?.scene_prompt ||
    segment.scenePrompt ||
    segment.prompt ||
    '';
  const effectivePrompt = String(draftPrompt || segment.prompt || originalSegmentPrompt).trim();
  const expandedPrompt = expandResourceMentions(effectivePrompt, characters, backgrounds);
  const segmentDuration = Math.max(0.3, Number(segment.endTime) - Number(segment.startTime));
  const anchorFrameTime = getNormalizedFrameTime(
    segment.representativeFrameTime ??
      timeAnchor?.representativeFrameTime ??
      timeAnchor?.representative_frame_time
  );
  const unclampedLocalFrameTime =
    anchorFrameTime !== null ? Number((anchorFrameTime - Number(segment.startTime)).toFixed(2)) : null;
  const segmentFrameTime =
    unclampedLocalFrameTime !== null
      ? Number(clampTime(unclampedLocalFrameTime, 0, segmentDuration).toFixed(2))
      : null;
  const segmentFrameWasClamped =
    unclampedLocalFrameTime !== null && Math.abs(unclampedLocalFrameTime - segmentFrameTime) > 0.01;
  const segmentExplanation = segment.scene || originalSegmentSummary || segment.action || '等待片段分析回写片段解释。';
  const segmentAction = segment.action || '等待片段分析回写动作描述。';
  const segmentPromptSummary = originalSegmentPrompt || '等待整片分析补充片段提示词。';
  const segmentFrameNote =
    segment.representativeFrameNote ||
    timeAnchor?.representativeFrameNote ||
    timeAnchor?.representative_frame_note ||
    '该帧用于表示当前片段最典型的画面。';
  const backgroundName =
    segment.backgroundName || timeAnchor?.backgroundName || timeAnchor?.background_name || '未绑定场景';
  const backgroundAction =
    segment.backgroundAction || timeAnchor?.backgroundAction || timeAnchor?.background_action || 'create_new';
  const backgroundPrompt =
    segment.backgroundPrompt ||
    overallAnalysis?.backgrounds?.find((item) => item.id === segment.backgroundId)?.scenePrompt ||
    '';
  const segmentScenes = Array.isArray(segment.scenes) ? segment.scenes.filter(Boolean) : [];
  const summaryChips = useMemo(() => {
    const chipValues = [];

    if (backgroundName) {
      chipValues.push(backgroundName);
    }

    if (backgroundAction) {
      chipValues.push(getBackgroundActionLabel(backgroundAction));
    }

    if (segment.characters?.length) {
      chipValues.push(...segment.characters.map((item) => `@${item}`));
    }

    if (segmentScenes.length) {
      chipValues.push(...segmentScenes.map((item) => `@${item}`));
    }

    if (timeAnchor?.sceneSummary) {
      chipValues.push('已含片段解释');
    }

    if (anchorFrameTime !== null) {
      chipValues.push('已含典型帧');
    }

    return chipValues.slice(0, 4);
  }, [anchorFrameTime, backgroundAction, backgroundName, segment.characters, segmentScenes, timeAnchor?.sceneSummary]);
  const segmentStats = [
    `角色 ${segment.characters?.length || 0}`,
    `场景 ${segmentScenes.length || 0}`,
    anchorFrameTime !== null ? `典型帧 ${formatDuration(anchorFrameTime)}` : '典型帧 待补'
  ];

  useEffect(() => {
    setDraftPrompt(segment.prompt ?? originalSegmentPrompt ?? '');
  }, [originalSegmentPrompt, segment.id, segment.prompt]);

  const handlePromptChange = (nextValue) => {
    setDraftPrompt(nextValue);
    onPromptChange(segment.id, nextValue);
  };

  const handleAnalyze = () => {
    return onAnalyze(segment.id);
  };

  const handleOptimize = (nextPrompt) => {
    const normalizedPrompt = String(nextPrompt ?? '').trim() || effectivePrompt;

    if (normalizedPrompt !== draftPrompt) {
      handlePromptChange(normalizedPrompt);
    }

    return onOptimize(segment.id, normalizedPrompt);
  };

  const handleGenerate = () => {
    return onGenerate(segment.id, effectivePrompt);
  };

  const generationEngineBadge = getGenerationEngineBadge(generationState);
  const canStartGeneration = Boolean(seedDanceProvider?.ready);
  const generateButtonLabel = isGenerating ? '生成中...' : '生成片段';
  const generateButtonTitle = canStartGeneration
    ? generationState?.is_mock
      ? '当前任务使用 Mock 回退完成。'
      : '调用 Seedance 生成片段。'
    : `Seedance 未就绪：${seedDanceProvider?.reason || '缺少必要配置。'}`;

  return (
    <>
      <article className="panel-shell panel-shell-strong segment-card-shell overflow-hidden px-3 py-3 transition md:px-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-start gap-3">
              <div className="segment-card-index">
                <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/45">Segment</p>
                <p className="mt-1 text-lg font-black text-white">
                  {String(segment.segmentIndex + 1).padStart(2, '0')}
                </p>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-base font-bold text-white">
                    {formatDuration(segment.startTime)} - {formatDuration(segment.endTime)}
                  </p>
                  <span className="segment-card-mini-pill">{formatDuration(segmentDuration)}</span>
                  <span className="segment-card-mini-pill">{backgroundName}</span>
                </div>

                <p className="segment-card-summary">{segmentExplanation}</p>

                <div className="segment-card-stat-row">
                  {segmentStats.map((item) => (
                    <span key={`${segment.id}-${item}`} className="segment-card-stat-pill">
                      {item}
                    </span>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {summaryChips.length ? (
                    summaryChips.map((chip) => (
                      <span key={`${segment.id}-${chip}`} className="segment-card-chip">
                        {chip}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-white/50">当前片段还没有角色标签。</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 xl:max-w-[420px] xl:justify-end">
            <StatusBadge status={generationState?.status || 'idle'} />
            <StatusBadge
              status={getBackgroundActionStatus(backgroundAction)}
              label={getBackgroundActionLabel(backgroundAction)}
            />
            <StatusBadge
              status={backgroundAsset?.status || 'idle'}
              label={getBackgroundAssetStatusLabel(backgroundAsset)}
            />
            {generationEngineBadge ? (
              <StatusBadge
                status={generationEngineBadge.status}
                label={generationEngineBadge.label}
              />
            ) : null}

            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
              onClick={() => void handleAnalyze()}
              disabled={isAnalyzing || isGenerating}
            >
              {isAnalyzing ? '分析中...' : '快速分析'}
            </button>

            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
              onClick={() => setPromptModalOpen(true)}
            >
              编辑提示词
            </button>

            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-3.5 py-1 text-[11px] font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleGenerate()}
              disabled={!effectivePrompt.trim() || isGenerating || !canStartGeneration}
              title={generateButtonTitle}
            >
              {generateButtonLabel}
            </button>
          </div>
        </div>

          {generationState ? (
            <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3 py-3">
            <ProgressBar
              value={generationState.progress ?? 0}
              status={generationState.status ?? 'pending'}
              label={
                generationState.status === 'completed'
                  ? '片段生成完成'
                  : generationState.status === 'failed'
                    ? '片段生成失败'
                    : '片段生成中'
              }
            />
            {generationState?.provider_error ? (
              <p className="mt-2 text-[11px] leading-5 text-white/60">
                {generationState.provider_error}
              </p>
            ) : null}
            </div>
          ) : null}

          <div className="segment-workbench-grid">
            <section className="segment-workbench-pane">
              <div className="segment-workbench-pane-head">
                <span>原片预览</span>
                <span>{formatDuration(segmentDuration)}</span>
              </div>
              <video className="segment-workbench-video" src={segment.sourceUrl} controls preload="metadata" />
              <div className="segment-workbench-pane-meta">
                <span className="segment-card-stat-pill">片段解释</span>
                <p className="segment-workbench-mini-copy">{originalSegmentSummary || '等待整片分析返回片段解释。'}</p>
              </div>
            </section>

            <section className="segment-workbench-pane segment-workbench-pane-center">
              <div className="segment-workbench-pane-head">
                <span>最终提示词</span>
                <div className="flex flex-wrap gap-1.5">
                  <span className="segment-card-stat-pill">{segment.characters?.length || 0} 角色</span>
                  <span className="segment-card-stat-pill">{segmentScenes.length || 0} 场景</span>
                </div>
              </div>

              <div className="segment-prompt-block">
                <p className="segment-prompt-label">整片分析原始内容</p>
                <div className="segment-prompt-raw">
                  {segmentPromptSummary ? renderPromptTokenPreview(segmentPromptSummary) : '等待整片分析返回原始片段提示词。'}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {segment.characters?.map((characterName) => (
                    <span key={`${segment.id}-character-${characterName}`} className="segment-card-chip">
                      @{characterName}
                    </span>
                  ))}
                  {segmentScenes.map((sceneName) => (
                    <span key={`${segment.id}-scene-${sceneName}`} className="segment-scene-chip">
                      #{sceneName}
                    </span>
                  ))}
                </div>
              </div>

              <div className="segment-prompt-block segment-prompt-block-final">
                <p className="segment-prompt-label">发送生成前的最终提示词</p>
                <p className="segment-prompt-final-text">{expandedPrompt || '等待编辑提示词。'}</p>
              </div>

              <div className="segment-card-detail-grid">
                <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">动作重点</p>
                  <p className="mt-1 text-[11px] leading-5 text-white/70">{segmentAction}</p>
                </div>
                <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">场景资源</p>
                    <StatusBadge
                      status={backgroundAsset?.status || 'idle'}
                      label={getBackgroundAssetStatusLabel(backgroundAsset)}
                    />
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-white/70">
                    {backgroundPrompt || '等待场景资源库补充背景提示词。'}
                  </p>
                </div>
              </div>
            </section>

            <section className="segment-workbench-pane">
              <div className="segment-workbench-pane-head">
                <span>新生成片段</span>
                {segment.generatedUrl ? <StatusBadge status="completed" label="已生成" /> : <span>待生成</span>}
              </div>
              {segment.generatedUrl ? (
                <video className="segment-workbench-video" src={segment.generatedUrl} controls preload="metadata" />
              ) : (
                <div className="preview-placeholder segment-workbench-empty">
                  <div className="preview-orb" />
                  <p className="text-sm font-semibold text-white">待生成片段</p>
                  <p className="mt-2 max-w-[220px] text-center text-[11px] leading-5 text-white/60">
                    点击“生成片段”后，这里会展示新的生成结果。
                  </p>
                </div>
              )}
              <div className="segment-workbench-pane-meta">
                <span className="segment-card-stat-pill">典型帧</span>
                <p className="segment-workbench-mini-copy">
                  {anchorFrameTime !== null ? `${formatDuration(anchorFrameTime)} · ${segmentFrameNote}` : '等待整片分析返回典型帧。'}
                </p>
              </div>
            </section>
          </div>
        </div>
      </article>

      <ModalSheet
        open={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        title={`片段 ${String(segment.segmentIndex + 1).padStart(2, '0')} · 编辑提示词`}
        description="卡片常驻区只显示关键信息；这里集中放原始片段内容、提示词编辑、优化调用词和最终生成提示词。"
        size="xl"
      >
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
            <VideoFramePreview
              videoUrl={segment.sourceUrl}
              timeSeconds={segmentFrameTime}
              originalTimeSeconds={anchorFrameTime}
              label="片段典型帧"
              note={segmentFrameNote}
              requestedTimeLabel="片段时间"
              forcedClamped={segmentFrameWasClamped}
            />

            <div className="space-y-3">
              <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  整片分析原始片段内容
                </p>
                <p className="mt-2 text-[13px] leading-6 text-white/70">
                  {originalSegmentSummary || '等待整片分析返回片段解释。'}
                </p>
                <div className="mt-3 rounded-[16px] border border-white/10 bg-black/20 px-3 py-2.5 text-[12px] leading-6 text-white/80">
                  {segmentPromptSummary ? renderPromptTokenPreview(segmentPromptSummary) : '等待整片分析返回原始片段提示词。'}
                </div>
              </div>

              <PromptEditor
                value={effectivePrompt}
                onChange={handlePromptChange}
                onAnalyze={handleAnalyze}
                onOptimize={handleOptimize}
                isAnalyzing={isAnalyzing}
                isOptimizing={isOptimizing}
                disabled={isGenerating}
                highlightedPrompt={segment.highlightedPrompt}
                description="支持片段理解、内联编辑，以及角色与场景资源标签的优化回写。角色使用 @，场景使用 #。"
                placeholder="在这里编辑片段提示词，使用 @角色名 和 #场景名 来保持资源一致。"
                mentionSummaryLabel="资源标签"
              />
            </div>
          </div>

          <PromptPreview
            title="片段理解提示词"
            description="点击“片段分析”时会把这段提示词发送给 Gemini，用于刷新角色、场景、动作和可编辑 Prompt。"
            prompt={segmentAnalysisPrompt}
            modelLabel="Gemini"
            defaultOpen
          />
          <PromptPreview
            title="提示词优化调用词"
            description="点击“优化提示词”时，后端会把当前编辑器内容、角色设定和场景资源库一起发送给优化模型。"
            prompt={promptOptimizationPrompt}
            modelLabel="Gemini"
          />
          <PromptPreview
            title="当前生成提示词"
            description="这是当前编辑器中的可直接修改 Prompt，也是生成任务的原始输入。"
            prompt={effectivePrompt}
            modelLabel="Editor"
          />
          <PromptPreview
            title="角色与场景展开后的最终生成提示词"
            description="真正发给生成模型前，后端会把 @角色名 替换成角色外观设定，把 #场景名 替换成场景资源真实提示词。"
            prompt={segment.latestGenerationTask?.optimizedPrompt || expandedPrompt}
            modelLabel="SeedDance"
          />
        </div>
      </ModalSheet>
    </>
  );
};

SegmentCard.propTypes = {
  segment: PropTypes.shape({
    id: PropTypes.number.isRequired,
    segmentIndex: PropTypes.number.isRequired,
    startTime: PropTypes.number.isRequired,
    endTime: PropTypes.number.isRequired,
    sourceUrl: PropTypes.string.isRequired,
    generatedUrl: PropTypes.string,
    scene: PropTypes.string,
    action: PropTypes.string,
    prompt: PropTypes.string,
    sceneSummary: PropTypes.string,
    scenePrompt: PropTypes.string,
    scenes: PropTypes.arrayOf(PropTypes.string),
    backgroundId: PropTypes.string,
    backgroundAction: PropTypes.string,
    backgroundName: PropTypes.string,
    backgroundPrompt: PropTypes.string,
    representativeFrameTime: PropTypes.number,
    representativeFrameNote: PropTypes.string,
    characters: PropTypes.arrayOf(PropTypes.string),
    highlightedPrompt: PropTypes.string,
      latestGenerationTask: PropTypes.shape({
        status: PropTypes.string,
        progress: PropTypes.number,
        prompt: PropTypes.string,
        optimizedPrompt: PropTypes.string,
        engine: PropTypes.string,
        is_mock: PropTypes.bool,
        remote_task_id: PropTypes.string,
        fallback_reason: PropTypes.string,
        provider_error: PropTypes.string
      })
  }).isRequired,
  overallAnalysis: PropTypes.shape({
    plot: PropTypes.string,
    characters: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.object]))
  }),
  timeAnchor: PropTypes.shape({
    sceneSummary: PropTypes.string,
    scenePrompt: PropTypes.string,
    scenes: PropTypes.arrayOf(PropTypes.string),
    backgroundId: PropTypes.string,
    backgroundAction: PropTypes.string,
    backgroundName: PropTypes.string,
    representativeFrameTime: PropTypes.number,
    representativeFrameNote: PropTypes.string
  }),
  backgroundAsset: PropTypes.shape({
    backgroundId: PropTypes.string,
    status: PropTypes.string,
    assetUrl: PropTypes.string,
    errorMessage: PropTypes.string
  }),
  expanded: PropTypes.bool,
  onToggle: PropTypes.func.isRequired,
  onPromptChange: PropTypes.func.isRequired,
  onAnalyze: PropTypes.func.isRequired,
  onOptimize: PropTypes.func.isRequired,
  onGenerate: PropTypes.func.isRequired,
  isAnalyzing: PropTypes.bool,
  isOptimizing: PropTypes.bool,
  isGenerating: PropTypes.bool
};

export default SegmentCard;
