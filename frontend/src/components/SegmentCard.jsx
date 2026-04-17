import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import ProgressBar from './ProgressBar.jsx';
import PromptEditor from './PromptEditor.jsx';
import PromptPreview from './PromptPreview.jsx';
import StatusBadge from './StatusBadge.jsx';
import { formatDuration } from '../utils/formatDuration.js';
import {
  buildPromptOptimizationPrompt,
  buildSegmentAnalysisPrompt,
  expandCharacterMentions
} from '../utils/promptBlueprints.js';

const SegmentCard = ({
  segment,
  overallAnalysis = null,
  onPromptChange,
  onAnalyze,
  onOptimize,
  onGenerate,
  isAnalyzing = false,
  isOptimizing = false,
  isGenerating = false
}) => {
  const [draftPrompt, setDraftPrompt] = useState(segment.prompt ?? '');
  const generationState = isGenerating
    ? {
        status: 'processing',
        progress: segment.latestGenerationTask?.progress ?? 30
      }
    : segment.latestGenerationTask;
  const characters = overallAnalysis?.characters ?? [];
  const segmentAnalysisPrompt = buildSegmentAnalysisPrompt({
    segment,
    overallAnalysis
  });
  const promptOptimizationPrompt = buildPromptOptimizationPrompt({
    prompt: draftPrompt,
    characters
  });
  const expandedPrompt = expandCharacterMentions(draftPrompt, characters);

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
    <article className="panel-shell panel-shell-strong p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/40">
            Segment {String(segment.segmentIndex + 1).padStart(2, '0')}
          </p>
          <h3 className="mt-2 text-xl font-bold text-white">
            {formatDuration(segment.startTime)} - {formatDuration(segment.endTime)}
          </h3>
          <p className="mt-2 text-sm leading-6 text-white/60">{segment.scene || segment.action}</p>
        </div>
        <StatusBadge status={generationState?.status || 'idle'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.22em] text-white/60">
            <span>原片预览</span>
            <span>{formatDuration(segment.endTime - segment.startTime)}</span>
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
              <p className="text-lg font-semibold text-white">待生成镜头</p>
              <p className="mt-2 max-w-xs text-center text-sm leading-6 text-white/60">
                点击“生成片段”后，这里会展示根据角色设定与剧情提示生成的新视频。
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {segment.characters?.length ? (
          segment.characters.map((character) => (
            <span
              key={`${segment.id}-${character}`}
              className="inline-flex rounded-full border border-brand-500/20 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-100"
            >
              @{character}
            </span>
          ))
        ) : (
          <span className="text-xs text-white/50">当前片段还没有角色标签。</span>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/40">Scene</p>
          <p className="mt-2 text-sm leading-6 text-white/70">{segment.scene || '等待片段分析回写场景描述。'}</p>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/40">Action</p>
          <p className="mt-2 text-sm leading-6 text-white/70">{segment.action || '等待片段分析回写动作描述。'}</p>
        </div>
      </div>

      <div className="mt-4">
        <PromptEditor
          value={draftPrompt}
          onChange={handlePromptChange}
          onAnalyze={handleAnalyze}
          onOptimize={handleOptimize}
          isAnalyzing={isAnalyzing}
          isOptimizing={isOptimizing}
          disabled={isGenerating}
          highlightedPrompt={segment.highlightedPrompt}
        />
      </div>

      <div className="mt-4 space-y-3">
        <PromptPreview
          title="片段理解提示词"
          description="点击“片段分析”时会把这段提示词发送给 Gemini-3.1-pro，用于刷新角色、场景、动作和可编辑 prompt。"
          prompt={segmentAnalysisPrompt}
          modelLabel="Gemini-3.1-pro"
        />
        <PromptPreview
          title="提示词优化调用词"
          description="点击“优化提示词”时，后端会把当前编辑器内容和角色设定一起发送给优化模型。"
          prompt={promptOptimizationPrompt}
          modelLabel="Gemini"
        />
        <PromptPreview
          title="当前生成提示词"
          description="这是当前编辑器中的可直接修改 prompt，也是生成任务的原始输入。"
          prompt={draftPrompt}
          modelLabel="Editor"
        />
        <PromptPreview
          title="角色展开后的最终生成提示词"
          description="真正发给 SeedDance 前，后端会把 @角色名 替换成整片分析里的角色外观设定。"
          prompt={segment.latestGenerationTask?.optimizedPrompt || expandedPrompt}
          modelLabel="SeedDance"
          defaultOpen
        />
      </div>

      {generationState ? (
        <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
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

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void onGenerate(segment.id, draftPrompt)}
          disabled={!draftPrompt.trim() || isGenerating}
        >
          {isGenerating ? '生成中...' : '生成片段'}
        </button>
      </div>
    </article>
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
  onPromptChange: PropTypes.func.isRequired,
  onAnalyze: PropTypes.func.isRequired,
  onOptimize: PropTypes.func.isRequired,
  onGenerate: PropTypes.func.isRequired,
  isAnalyzing: PropTypes.bool,
  isOptimizing: PropTypes.bool,
  isGenerating: PropTypes.bool
};

export default SegmentCard;
