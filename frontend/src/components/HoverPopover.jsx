import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

const alignClassNames = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0'
};

const HoverPopover = ({
  trigger,
  children,
  align = 'end',
  triggerClassName = '',
  panelClassName = '',
  disabled = false
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={triggerClassName}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => {
          if (!disabled) {
            setOpen((currentOpen) => !currentOpen);
          }
        }}
        onMouseEnter={() => {
          if (!disabled) {
            setOpen(true);
          }
        }}
        onFocus={() => {
          if (!disabled) {
            setOpen(true);
          }
        }}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget)) {
            setOpen(false);
          }
        }}
      >
        {trigger}
      </button>

      {open && !disabled ? (
        <div
          className={`absolute top-[calc(100%+0.65rem)] z-20 w-[min(28rem,calc(100vw-2rem))] rounded-[22px] border border-white/12 bg-slate-950/98 p-3 text-left shadow-[0_25px_70px_rgba(2,6,23,0.5)] backdrop-blur-2xl ${alignClassNames[align] || alignClassNames.end} ${panelClassName}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};

HoverPopover.propTypes = {
  trigger: PropTypes.node.isRequired,
  children: PropTypes.node.isRequired,
  align: PropTypes.oneOf(['start', 'center', 'end']),
  triggerClassName: PropTypes.string,
  panelClassName: PropTypes.string,
  disabled: PropTypes.bool
};

export default HoverPopover;
