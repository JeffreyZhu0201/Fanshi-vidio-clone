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
    <section className={`panel-shell panel-shell-strong p-5 md:p-6 ${className}`}>
      <div className="mb-5 flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="glass-label">{eyebrow}</p>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-white">{title}</h2>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">{description}</p>
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
  children: PropTypes.node.isRequired
};

export default SectionPanel;
