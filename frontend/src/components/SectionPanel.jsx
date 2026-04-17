import PropTypes from 'prop-types';

const SectionPanel = ({
  eyebrow,
  title,
  description = '',
  actions = null,
  className = '',
  contentClassName = '',
  children
}) => {
  return (
    <section className={`panel-shell p-5 md:p-6 ${className}`}>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-brand-700">
          {eyebrow}
          </p>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-ink-900">{title}</h2>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-700">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
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
  children: PropTypes.node.isRequired
};

export default SectionPanel;
