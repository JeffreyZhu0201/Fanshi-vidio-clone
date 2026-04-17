import PropTypes from 'prop-types';

const PromptPreview = ({
  title,
  description = '',
  prompt = '',
  modelLabel = '',
  defaultOpen = false
}) => {
  if (!prompt) {
    return null;
  }

  return (
    <details open={defaultOpen} className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          {description ? <p className="mt-1 text-xs leading-5 text-white/50">{description}</p> : null}
        </div>
        {modelLabel ? (
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            {modelLabel}
          </span>
        ) : null}
      </summary>

      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words rounded-[20px] border border-white/[0.06] bg-black/[0.35] px-4 py-4 font-mono text-xs leading-6 text-slate-100">
        {prompt}
      </pre>
    </details>
  );
};

PromptPreview.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  prompt: PropTypes.string,
  modelLabel: PropTypes.string,
  defaultOpen: PropTypes.bool
};

export default PromptPreview;
