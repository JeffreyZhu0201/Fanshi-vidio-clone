import PropTypes from 'prop-types';

const SectionPanel = ({
  eyebrow,
  title,
  description = '',
  actions = null,
  className = '',
  contentClassName = '',
  compact = false,
  children
}) => {
  return (
    <section
      className={`panel-shell panel-shell-strong ${compact ? 'p-4 md:p-4' : 'p-5 md:p-6'} ${className}`}
    >
      <div
        className={`${compact ? 'mb-4 gap-3 pb-4' : 'mb-5 gap-4 pb-5'} flex flex-col border-b border-white/10 md:flex-row md:items-start md:justify-between`}
      >
        <div className="min-w-0">
          <p className={compact ? 'text-[10px] font-semibold uppercase tracking-[0.28em] text-white/40' : 'glass-label'}>
            {eyebrow}
          </p>
          <h2
            className={`${compact ? 'mt-2 text-lg font-bold' : 'mt-3 text-2xl font-black'} tracking-tight text-white`}
          >
            {title}
          </h2>
          {description ? (
            <p
              className={`${compact ? 'mt-1 max-w-3xl text-xs leading-5 text-white/60' : 'mt-2 max-w-2xl text-sm leading-6 text-white/70'}`}
            >
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0 md:pl-4">{actions}</div> : null}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  );
};

SectionPanel.propTypes = {
  eyebrow: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  actions: PropTypes.node,
  className: PropTypes.string,
  contentClassName: PropTypes.string,
  compact: PropTypes.bool,
  children: PropTypes.node.isRequired
};

export default SectionPanel;
