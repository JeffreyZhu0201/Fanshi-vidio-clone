import PropTypes from 'prop-types';

const statusClasses = {
  idle: 'bg-slate-100 text-slate-600 ring-slate-200',
  checking: 'bg-amber-100 text-amber-700 ring-amber-200',
  online: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  degraded: 'bg-amber-100 text-amber-700 ring-amber-200',
  offline: 'bg-rose-100 text-rose-700 ring-rose-200',
  realtime: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  pending: 'bg-slate-100 text-slate-700 ring-slate-200',
  uploaded: 'bg-brand-100 text-brand-700 ring-brand-200',
  uploading: 'bg-brand-100 text-brand-700 ring-brand-200',
  analyzing: 'bg-brand-100 text-brand-700 ring-brand-200',
  analyzed: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  processing: 'bg-brand-100 text-brand-700 ring-brand-200',
  completed: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  success: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  failed: 'bg-accent-100 text-accent-700 ring-accent-200',
  error: 'bg-accent-100 text-accent-700 ring-accent-200',
  polling: 'bg-brand-100 text-brand-700 ring-brand-200',
  fallback: 'bg-amber-100 text-amber-700 ring-amber-200'
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
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusClasses[resolvedStatus]}`}
    >
      {label || statusLabels[resolvedStatus]}
    </span>
  );
};

StatusBadge.propTypes = {
  status: PropTypes.string.isRequired,
  label: PropTypes.string
};

export default StatusBadge;
