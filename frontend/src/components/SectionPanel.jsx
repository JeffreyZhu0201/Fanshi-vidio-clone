import PropTypes from 'prop-types';

const SectionPanel = ({ eyebrow, title, description, children }) => {
  return (
    <section className="glass-panel p-6 md:p-7">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand-700">
          {eyebrow}
        </p>
        <h2 className="mt-3 text-2xl font-extrabold text-ink-900">{title}</h2>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-700">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
};

SectionPanel.propTypes = {
  eyebrow: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  children: PropTypes.node.isRequired
};

SectionPanel.defaultProps = {
  description: ''
};

export default SectionPanel;

