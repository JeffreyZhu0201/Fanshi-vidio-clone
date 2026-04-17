import PropTypes from 'prop-types';

import ProgressBar from './ProgressBar.jsx';
import PromptEditor from './PromptEditor.jsx';
import StatusBadge from './StatusBadge.jsx';
import { formatDuration } from '../utils/formatDuration.js';

const SegmentCard = ({
  segment,
  onPromptChange,
  onOptimize,
  onGenerate,
  isOptimizing = false,
  isGenerating = false
}) => {
  const generationState = isGenerating
    ? {
        status: 'processing',
        progress: segment.latestGenerationTask?.progress ?? 30
      }
    : segment.latestGenerationTask;

  return (
    <article className="panel-shell p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand-700">
            Segment {String(segment.segmentIndex + 1).padStart(2, '0')}
          </p>
          <h3 className="mt-2 text-xl font-bold text-ink-900">
            {formatDuration(segment.startTime)} - {formatDuration(segment.endTime)}
          </h3>
          <p className="mt-2 text-sm leading-6 text-ink-600">{segment.scene || segment.action}</p>
        </div>
        <StatusBadge status={generationState?.status || 'idle'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-950">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs uppercase tracking-[0.22em] text-white/55">
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

        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-xs uppercase tracking-[0.22em] text-ink-500">
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
              <p className="text-lg font-semibold text-ink-900">待生成镜头</p>
              <p className="mt-2 max-w-xs text-center text-sm leading-6 text-ink-500">
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
              className="inline-flex rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700"
            >
              @{character}
            </span>
          ))
        ) : (
          <span className="text-xs text-ink-500">当前片段还没有角色标签。</span>
        )}
      </div>

      <div className="mt-4">
        <PromptEditor
          value={segment.prompt}
          onChange={(nextValue) => onPromptChange(segment.id, nextValue)}
          onOptimize={() => onOptimize(segment.id)}
          isOptimizing={isOptimizing}
          disabled={isGenerating}
          highlightedPrompt={segment.highlightedPrompt}
        />
      </div>

      {generationState ? (
        <div className="mt-4 rounded-[24px] bg-slate-50/90 px-4 py-4">
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
          className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-200/60 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void onGenerate(segment.id)}
          disabled={!segment.prompt || isGenerating}
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
      progress: PropTypes.number
    })
  }).isRequired,
  onPromptChange: PropTypes.func.isRequired,
  onOptimize: PropTypes.func.isRequired,
  onGenerate: PropTypes.func.isRequired,
  isOptimizing: PropTypes.bool,
  isGenerating: PropTypes.bool
};

export default SegmentCard;
