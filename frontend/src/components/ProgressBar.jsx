import PropTypes from 'prop-types';

const progressTone = {
  idle: 'from-slate-300 to-slate-400',
  pending: 'from-slate-400 to-slate-500',
  checking: 'from-amber-400 to-orange-400',
  uploading: 'from-brand-500 to-brand-700',
  processing: 'from-brand-500 to-accent-500',
  polling: 'from-brand-500 to-accent-500',
  completed: 'from-emerald-400 to-emerald-600',
  success: 'from-emerald-400 to-emerald-600',
  failed: 'from-accent-500 to-accent-700',
  error: 'from-accent-500 to-accent-700'
};

const clampProgress = (value) => Math.max(0, Math.min(100, Math.round(value)));

const formatRemaining = (progress, startedAt) => {
  if (!startedAt || progress <= 0 || progress >= 100) {
    return '';
  }

  const elapsedSeconds = Math.max(1, (Date.now() - new Date(startedAt).getTime()) / 1000);
  const estimatedTotalSeconds = elapsedSeconds / (progress / 100);
  const remainingSeconds = Math.max(0, estimatedTotalSeconds - elapsedSeconds);

  if (remainingSeconds < 60) {
    return `约 ${Math.ceil(remainingSeconds)} 秒`;
  }

  return `约 ${Math.ceil(remainingSeconds / 60)} 分钟`;
};

const ProgressBar = ({
  value = 0,
  status = 'idle',
  label = '当前进度',
  startedAt = '',
  compact = false,
  className = ''
}) => {
  const progress = clampProgress(value);
  const tone = progressTone[status] ?? progressTone.idle;
  const remaining = formatRemaining(progress, startedAt);

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-4 text-xs font-medium text-ink-500">
        <span>{label}</span>
        <span>{progress}%</span>
      </div>
      <div
        className={`overflow-hidden rounded-full bg-slate-200/80 ${
          compact ? 'h-2.5' : 'h-3.5'
        }`}
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all duration-700 ease-out`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-ink-500">
        <span>{status === 'completed' ? '任务已完成' : '进度实时刷新中'}</span>
        <span>{remaining}</span>
      </div>
    </div>
  );
};

ProgressBar.propTypes = {
  value: PropTypes.number,
  status: PropTypes.string,
  label: PropTypes.string,
  startedAt: PropTypes.string,
  compact: PropTypes.bool,
  className: PropTypes.string
};

export default ProgressBar;
