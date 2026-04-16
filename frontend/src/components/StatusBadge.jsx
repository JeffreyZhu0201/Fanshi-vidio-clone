import PropTypes from 'prop-types';

const statusClasses = {
  checking: 'bg-amber-100 text-amber-700',
  online: 'bg-emerald-100 text-emerald-700',
  offline: 'bg-rose-100 text-rose-700'
};

const statusLabels = {
  checking: '检查中',
  online: '在线',
  offline: '离线'
};

const StatusBadge = ({ status }) => {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
};

StatusBadge.propTypes = {
  status: PropTypes.oneOf(['checking', 'online', 'offline']).isRequired
};

export default StatusBadge;

