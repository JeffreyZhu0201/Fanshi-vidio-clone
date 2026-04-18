import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import { countPromptCharacters, extractMentionNames, tokenizePrompt } from '../utils/mentionTokens.js';

const PromptEditor = ({
  value = '',
  onChange,
  onAnalyze = () => {},
  onOptimize,
  isAnalyzing = false,
  isOptimizing = false,
  disabled = false,
  highlightedPrompt = '',
  title = '片段提示词编辑器',
  description = '支持片段理解、内联编辑、角色标签预览和优化回写',
  placeholder = '在这里编辑片段提示词，使用 @角色名 来保持人物设定一致。',
  analyzeLabel = '片段分析',
  optimizeLabel = '优化提示词',
  previewLabel = '标签高亮预览',
  mentionSummaryLabel = '资源标签',
  showAnalyze = true
}) => {
  const [historyState, setHistoryState] = useState({
    stack: [value],
    index: 0
  });

  const draft = historyState.stack[historyState.index] ?? '';
  const characterCount = countPromptCharacters(draft);
  const mentionNames = extractMentionNames(draft);

  useEffect(() => {
    const currentDraft = historyState.stack[historyState.index] ?? '';

    if (value !== currentDraft) {
      setHistoryState({
        stack: [value],
        index: 0
      });
    }
  }, [historyState.index, historyState.stack, value]);

  const pushDraft = (nextValue) => {
    setHistoryState((state) => {
      const nextStack = [...state.stack.slice(0, state.index + 1), nextValue];

      return {
        stack: nextStack,
        index: nextStack.length - 1
      };
    });

    onChange(nextValue);
  };

  const moveHistory = (direction) => {
    const nextIndex = Math.max(0, Math.min(historyState.stack.length - 1, historyState.index + direction));
    const nextValue = historyState.stack[nextIndex] ?? '';

    setHistoryState((state) => ({
      ...state,
      index: nextIndex
    }));
    onChange(nextValue);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-xs text-white/50">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => moveHistory(-1)}
            disabled={historyState.index === 0 || disabled}
          >
            撤销
          </button>
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-white/20 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => moveHistory(1)}
            disabled={historyState.index >= historyState.stack.length - 1 || disabled}
          >
            重做
          </button>
          {showAnalyze ? (
            <button
              type="button"
              className="rounded-full border border-brand-500/20 bg-brand-500/10 px-3.5 py-1.5 text-xs font-semibold text-brand-100 transition hover:border-brand-500/30 hover:bg-brand-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void onAnalyze(draft)}
              disabled={disabled || isAnalyzing}
            >
              {isAnalyzing ? '分析中...' : analyzeLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void onOptimize(draft)}
            disabled={disabled || isOptimizing || !draft.trim()}
          >
            {isOptimizing ? '优化中...' : optimizeLabel}
          </button>
        </div>
      </div>

      <textarea
        aria-label="片段提示词编辑器"
        value={draft}
        rows={5}
        disabled={disabled}
        className="min-h-[132px] w-full rounded-[24px] border border-white/10 bg-black/25 px-4 py-3 text-sm leading-7 text-slate-100 shadow-sm transition focus:border-accent-500/40 focus:ring-0 disabled:cursor-not-allowed disabled:bg-black/20"
        placeholder={placeholder}
        onChange={(event) => pushDraft(event.target.value)}
      />

      <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-white/50">{previewLabel}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
            <span>{characterCount} 字</span>
            <span>{mentionNames.length} 个{mentionSummaryLabel}</span>
          </div>
        </div>
        <div className="min-h-[56px] text-sm leading-7 text-white/80">
          {tokenizePrompt(draft).map((token, index) =>
            token.type === 'mention' ? (
              <span
                key={`${token.value}-${index}`}
                className="mx-0.5 inline-flex rounded-full border border-brand-500/20 bg-brand-500/10 px-2 py-0.5 font-semibold text-brand-100"
              >
                {token.value}
              </span>
            ) : (
              <span key={`${token.value}-${index}`}>{token.value}</span>
            )
          )}
        </div>
      </div>

      {highlightedPrompt ? (
        <div className="rounded-[24px] border border-brand-500/20 bg-brand-500/10 px-4 py-3 text-xs leading-6 text-brand-100">
          已同步后端高亮结果，编辑器下方的蓝色标签预览会保持和当前文本一致。
        </div>
      ) : null}
    </div>
  );
};

PromptEditor.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onAnalyze: PropTypes.func,
  onOptimize: PropTypes.func.isRequired,
  isAnalyzing: PropTypes.bool,
  isOptimizing: PropTypes.bool,
  disabled: PropTypes.bool,
  highlightedPrompt: PropTypes.string,
  title: PropTypes.string,
  description: PropTypes.string,
  placeholder: PropTypes.string,
  analyzeLabel: PropTypes.string,
  optimizeLabel: PropTypes.string,
  previewLabel: PropTypes.string,
  mentionSummaryLabel: PropTypes.string,
  showAnalyze: PropTypes.bool
};

export default PromptEditor;
