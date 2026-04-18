import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import HoverPopover from './HoverPopover.jsx';
import ModalSheet from './ModalSheet.jsx';
import ProgressBar from './ProgressBar.jsx';
import PromptEditor from './PromptEditor.jsx';
import PromptPreview from './PromptPreview.jsx';
import StatusBadge from './StatusBadge.jsx';
import VideoFramePreview from './VideoFramePreview.jsx';
import { formatDuration } from '../utils/formatDuration.js';
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
  const expandedPrompt = expandResourceMentions(draftPrompt, characters, backgrounds);
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
  const segmentExplanation =
    segment.scene ||
    segment.sceneSummary ||
    timeAnchor?.sceneSummary ||
    segment.action ||
    '等待片段分析回写片段解释。';
  const segmentAction = segment.action || '等待片段分析回写动作描述。';
  const segmentPromptSummary =
    segment.scenePrompt ||
    timeAnchor?.scenePrompt ||
    timeAnchor?.scene_prompt ||
    '等待整片分析补充片段提示词。';
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

  useEffect(() => {
    setDraftPrompt(segment.prompt ?? '');
  }, [segment.id, segment.prompt]);

  const handlePromptChange = (nextValue) => {
    setDraftPrompt(nextValue);
    onPromptChange(segment.id, nextValue);
  };

  const handleAnalyze = () => {
    return onAnalyze(segment.id);
  };

  const handleOptimize = (nextPrompt) => {
    if (nextPrompt !== draftPrompt) {
      handlePromptChange(nextPrompt);
    }

    return onOptimize(segment.id, nextPrompt);
  };

  return (
    <>
      <article
        className={`panel-shell panel-shell-strong overflow-hidden px-4 py-4 transition md:px-5 ${
          expanded ? 'border-white/15 shadow-[0_24px_80px_rgba(2,6,23,0.52)]' : ''
        }`}
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => onToggle(segment.id)}
            aria-expanded={expanded}
          >
            <div className="flex flex-wrap items-start gap-4">
              <div className="rounded-[20px] border border-white/10 bg-black/20 px-3 py-2 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/45">
                  Segment
                </p>
                <p className="mt-2 text-xl font-black text-white">
                  {String(segment.segmentIndex + 1).padStart(2, '0')}
                </p>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-bold text-white">
                    {formatDuration(segment.startTime)} - {formatDuration(segment.endTime)}
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/65">
                    {formatDuration(segmentDuration)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/65">
                    {backgroundName}
                  </span>
                </div>

                <p className="mt-3 text-sm leading-6 text-white/75">{segmentExplanation}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {summaryChips.length ? (
                    summaryChips.map((chip) => (
                      <span
                        key={`${segment.id}-${chip}`}
                        className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white/70"
                      >
                        {chip}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-white/50">当前片段还没有角色标签。</span>
                  )}
                </div>
              </div>
            </div>
          </button>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <StatusBadge status={generationState?.status || 'idle'} />
            <StatusBadge
              status={getBackgroundActionStatus(backgroundAction)}
              label={getBackgroundActionLabel(backgroundAction)}
            />
            <StatusBadge
              status={backgroundAsset?.status || 'idle'}
              label={getBackgroundAssetStatusLabel(backgroundAsset)}
            />

            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
              onClick={() => void handleAnalyze()}
              disabled={isAnalyzing || isGenerating}
            >
              {isAnalyzing ? '分析中...' : '快速分析'}
            </button>

            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
              onClick={() => setPromptModalOpen(true)}
            >
              Prompt 明细
            </button>

            <button
              type="button"
              className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void onGenerate(segment.id, draftPrompt)}
              disabled={!draftPrompt.trim() || isGenerating}
            >
              {isGenerating ? '生成中...' : '生成片段'}
            </button>

            <button
              type="button"
              className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-black/35"
              onClick={() => onToggle(segment.id)}
              aria-expanded={expanded}
            >
              {expanded ? '收起工位' : '展开工位'}
            </button>
          </div>
        </div>

        {generationState ? (
          <div className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4">
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
          </div>
        ) : null}

        {expanded ? (
          <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.22em] text-white/60">
                  <span>原片预览</span>
                  <span>{formatDuration(segmentDuration)}</span>
                </div>
                <video
                  className="aspect-video w-full bg-black object-cover"
                  src={segment.sourceUrl}
                  controls
                  preload="metadata"
                />
              </div>

              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04]">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.22em] text-white/50">
                  <span>待生成 / 最新输出</span>
                  {segment.generatedUrl ? <StatusBadge status="completed" label="已生成" /> : null}
                </div>
                {segment.generatedUrl ? (
                  <video
                    className="aspect-video w-full bg-slate-950 object-cover"
                    src={segment.generatedUrl}
                    controls
                    preload="metadata"
                  />
                ) : (
                  <div className="preview-placeholder">
                    <div className="preview-orb" />
                    <p className="text-lg font-semibold text-white">待生成片段</p>
                    <p className="mt-2 max-w-xs text-center text-sm leading-6 text-white/60">
                      点击“生成片段”后，这里会展示根据角色设定与片段解释生成的新视频。
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <VideoFramePreview
                  videoUrl={segment.sourceUrl}
                  timeSeconds={segmentFrameTime}
                  originalTimeSeconds={anchorFrameTime}
                  label="片段典型帧"
                  note={segmentFrameNote}
                  requestedTimeLabel="片段时间"
                  forcedClamped={segmentFrameWasClamped}
                />

                <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    片段提示词
                  </p>
                  <p className="mt-3 text-sm leading-6 text-white/75">{segmentPromptSummary}</p>
                  {segmentScenes.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {segmentScenes.map((sceneName) => (
                        <span
                          key={`${segment.id}-scene-${sceneName}`}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/70"
                        >
                          @{sceneName}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <HoverPopover
                      trigger="完整片段提示词"
                      triggerClassName="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                    >
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                          片段级场景提示词
                        </p>
                        <p className="text-sm leading-6 text-white/80">{segmentPromptSummary}</p>
                      </div>
                    </HoverPopover>

                    {segmentFrameWasClamped ? (
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100">
                        时间已校正到片段范围
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
                        背景资产
                      </p>
                      <p className="mt-2 text-sm font-semibold text-white">{backgroundName}</p>
                    </div>
                    <StatusBadge
                      status={backgroundAsset?.status || 'idle'}
                      label={getBackgroundAssetStatusLabel(backgroundAsset)}
                    />
                  </div>

                  {backgroundAsset?.assetUrl ? (
                    <video
                      className="mt-3 aspect-video w-full rounded-[18px] border border-white/10 bg-slate-950 object-cover"
                      src={backgroundAsset.assetUrl}
                      controls
                      preload="metadata"
                    />
                  ) : (
                    <div className="mt-3 rounded-[18px] border border-dashed border-white/10 px-4 py-4 text-sm leading-6 text-white/55">
                      {backgroundAsset?.errorMessage
                        ? `背景资产生成失败：${backgroundAsset.errorMessage}`
                        : '当前场景的背景参考视频会在首次命中时自动生成，生成成功后会显示在这里。'}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/70">
                      {segment.backgroundId || timeAnchor?.backgroundId || timeAnchor?.background_id || '未绑定 ID'}
                    </span>
                    <HoverPopover
                      trigger="背景提示词"
                      triggerClassName="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/[0.08]"
                    >
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                          背景资产提示词
                        </p>
                        <p className="text-sm leading-6 text-white/80">
                          {backgroundPrompt || '等待场景资源库补充背景提示词。'}
                        </p>
                      </div>
                    </HoverPopover>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/40">片段解释</p>
                <p className="mt-2 text-sm leading-6 text-white/70">{segmentExplanation}</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/40">动作重点</p>
                <p className="mt-2 text-sm leading-6 text-white/70">{segmentAction}</p>
              </div>
            </div>

            <PromptEditor
              value={draftPrompt}
              onChange={handlePromptChange}
              onAnalyze={handleAnalyze}
              onOptimize={handleOptimize}
              isAnalyzing={isAnalyzing}
              isOptimizing={isOptimizing}
              disabled={isGenerating}
              highlightedPrompt={segment.highlightedPrompt}
              description="支持片段理解、内联编辑，以及角色与场景资源标签的优化回写"
              placeholder="在这里编辑片段提示词，使用 @角色名 和 @场景名 来保持资源一致。"
              mentionSummaryLabel="资源标签"
            />
          </div>
        ) : null}
      </article>

      <ModalSheet
        open={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        title={`片段 ${String(segment.segmentIndex + 1).padStart(2, '0')} · Prompt 明细`}
        description="片段理解提示词、优化调用词、当前编辑器内容和角色展开后的最终生成提示词都集中放在这里，默认不常驻页面。"
        size="xl"
      >
        <div className="space-y-3">
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
            prompt={draftPrompt}
            modelLabel="Editor"
          />
          <PromptPreview
            title="角色与场景展开后的最终生成提示词"
            description="真正发给生成模型前，后端会把 @角色名 替换成角色外观设定，把 @场景名 替换成场景资源真实提示词。"
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
      optimizedPrompt: PropTypes.string
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
