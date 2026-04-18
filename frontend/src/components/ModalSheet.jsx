import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';

const sizeClassNames = {
  sm: 'max-w-lg',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl'
};

const ModalSheet = ({
  open = false,
  onClose,
  title,
  description = '',
  children,
  footer = null,
  size = 'lg',
  className = '',
  contentClassName = ''
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const lastActiveElementRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }

    lastActiveElementRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);

      if (
        typeof HTMLElement !== 'undefined' &&
        lastActiveElementRef.current instanceof HTMLElement
      ) {
        lastActiveElementRef.current.focus();
      }
    };
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/72 px-4 py-4 backdrop-blur-md md:items-center md:px-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`panel-shell panel-shell-strong flex max-h-[88vh] w-full flex-col overflow-hidden rounded-[32px] ${sizeClassNames[size] || sizeClassNames.lg} ${className}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
          <div className="min-w-0">
            <p className="glass-label">Detail View</p>
            <h2 id={titleId} className="mt-2 text-xl font-black text-white">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-2 max-w-3xl text-sm leading-6 text-white/65">
                {description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-sm font-semibold text-white/70 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
            onClick={onClose}
            aria-label="关闭弹窗"
          >
            ×
          </button>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6 ${contentClassName}`}>
          {children}
        </div>

        {footer ? (
          <div className="border-t border-white/10 px-5 py-4 md:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
};

ModalSheet.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  children: PropTypes.node.isRequired,
  footer: PropTypes.node,
  size: PropTypes.oneOf(['sm', 'md', 'lg', 'xl']),
  className: PropTypes.string,
  contentClassName: PropTypes.string
};

export default ModalSheet;
