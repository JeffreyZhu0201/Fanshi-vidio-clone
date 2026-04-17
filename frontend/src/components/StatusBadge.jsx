import PropTypes from 'prop-types';

const statusClasses = {
  idle: 'border-white/[0.12] bg-white/[0.04] text-white/70',
  checking: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  online: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  degraded: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  offline: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
  realtime: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  pending: 'border-white/[0.12] bg-white/[0.04] text-white/70',
  uploaded: 'border-brand-500/20 bg-brand-500/10 text-brand-100',
  uploading: 'border-brand-500/20 bg-brand-500/10 text-brand-100',
  analyzing: 'border-brand-500/20 bg-brand-500/10 text-brand-100',
  analyzed: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  processing: 'border-brand-500/20 bg-brand-500/10 text-brand-100',
  completed: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  failed: 'border-accent-500/20 bg-accent-500/10 text-rose-200',
  error: 'border-accent-500/20 bg-accent-500/10 text-rose-200',
  polling: 'border-brand-500/20 bg-brand-500/10 text-brand-100',
  fallback: 'border-amber-500/20 bg-amber-500/10 text-amber-200'
};

const statusDotClasses = {
  idle: 'bg-white/50',
  checking: 'bg-amber-300',
  online: 'bg-emerald-300',
  degraded: 'bg-amber-300',
  offline: 'bg-rose-300',
  realtime: 'bg-emerald-300',
  pending: 'bg-white/50',
  uploaded: 'bg-brand-200',
  uploading: 'bg-brand-200',
  analyzing: 'bg-brand-200',
  analyzed: 'bg-emerald-300',
  processing: 'bg-brand-200',
  completed: 'bg-emerald-300',
  success: 'bg-emerald-300',
  failed: 'bg-rose-300',
  error: 'bg-rose-300',
  polling: 'bg-brand-200',
  fallback: 'bg-amber-300'
};

const statusLabels = {
  idle: '待命',
  checking: '检查中',
  online: '在线',
  degraded: '降级',
  offline: '离线',
  realtime: '实时推送',
  pending: '排队中',
  uploaded: '已上传',
  uploading: '上传中',
  analyzing: '分析中',
  analyzed: '已分析',
  processing: '处理中',
  completed: '已完成',
  success: '成功',
  failed: '失败',
  error: '异常',
  polling: '轮询模式',
  fallback: '降级模式'
};

const StatusBadge = ({ status, label = '' }) => {
  const resolvedStatus = statusClasses[status] ? status : 'idle';

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses[resolvedStatus]}`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${statusDotClasses[resolvedStatus]}`}
      />
      {label || statusLabels[resolvedStatus]}
    </span>
  );
};

StatusBadge.propTypes = {
  status: PropTypes.string.isRequired,
  label: PropTypes.string
};

export default StatusBadge;
