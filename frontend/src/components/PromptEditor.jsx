import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import { countPromptCharacters, extractMentionNames, tokenizePrompt } from '../utils/mentionTokens.js';

const PromptEditor = ({
  value = '',
  onChange,
  onOptimize,
  isOptimizing = false,
  disabled = false,
  highlightedPrompt = ''
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
          <p className="text-sm font-semibold text-ink-900">片段提示词编辑器</p>
          <p className="text-xs text-ink-500">支持内联编辑、角色标签预览和优化回写</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-ink-600 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => moveHistory(-1)}
            disabled={historyState.index === 0 || disabled}
          >
            撤销
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-ink-600 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => moveHistory(1)}
            disabled={historyState.index >= historyState.stack.length - 1 || disabled}
          >
            重做
          </button>
          <button
            type="button"
            className="rounded-full bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void onOptimize()}
            disabled={disabled || isOptimizing}
          >
            {isOptimizing ? '优化中...' : '优化提示词'}
          </button>
        </div>
      </div>

      <textarea
        value={draft}
        rows={5}
        disabled={disabled}
        className="min-h-[132px] w-full rounded-[24px] border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-ink-800 shadow-sm transition focus:border-brand-300 focus:ring-0 disabled:cursor-not-allowed disabled:bg-slate-50"
        placeholder="在这里编辑片段提示词，使用 @角色名 来保持人物设定一致。"
        onChange={(event) => pushDraft(event.target.value)}
      />

      <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-ink-500">标签高亮预览</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <span>{characterCount} 字</span>
            <span>{mentionNames.length} 个角色标签</span>
          </div>
        </div>
        <div className="min-h-[56px] text-sm leading-7 text-ink-700">
          {tokenizePrompt(draft).map((token, index) =>
            token.type === 'mention' ? (
              <span
                key={`${token.value}-${index}`}
                className="mx-0.5 inline-flex rounded-full bg-brand-100 px-2 py-0.5 font-semibold text-brand-700"
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
        <div className="rounded-[24px] border border-brand-100 bg-brand-50/70 px-4 py-3 text-xs leading-6 text-brand-700">
          已同步后端高亮结果，编辑器下方的蓝色标签预览会保持和当前文本一致。
        </div>
      ) : null}
    </div>
  );
};

PromptEditor.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onOptimize: PropTypes.func.isRequired,
  isOptimizing: PropTypes.bool,
  disabled: PropTypes.bool,
  highlightedPrompt: PropTypes.string
};

export default PromptEditor;
