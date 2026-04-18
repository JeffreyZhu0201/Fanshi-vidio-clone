import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import HoverPopover from './HoverPopover.jsx';
import { toAbsoluteAssetUrl } from '../services/api.js';
import { formatDuration } from '../utils/formatDuration.js';

const FRAME_LOAD_TIMEOUT_MS = 6000;
const MIN_FRAME_OFFSET_SECONDS = 0.05;
const FRAME_READY_STATE = 2;
const frameDataCache = new Map();
const framePromiseCache = new Map();

const isJestDomEnvironment = () => {
  return typeof navigator !== 'undefined' && /jsdom/iu.test(navigator.userAgent || '');
};

const normalizeOptionalSeconds = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Number(parsedValue.toFixed(2));
};

const resolveBrowserAssetUrl = (assetPath = '') => {
  if (!assetPath) {
    return '';
  }

  return toAbsoluteAssetUrl(assetPath);
};

const getFramePlaceholderState = (status) => {
  if (status === 'loading') {
    return {
      title: '抽取中',
      description: '正在从当前视频定位对应时间点画面'
    };
  }

  if (status === 'failed') {
    return {
      title: '抽帧失败',
      description: '当前时间点无法成功取帧，已显示占位状态'
    };
  }

  return {
    title: '暂无典型帧',
    description: '等待有效时间点，或等待模型返回代表帧信息'
  };
};

const waitForVideoLifecycle = ({
  videoElement,
  eventNames,
  ready,
  timeoutMs = FRAME_LOAD_TIMEOUT_MS
}) => {
  return new Promise((resolve, reject) => {
    if (ready()) {
      resolve();
      return;
    }

    let settled = false;
    let timeoutId = 0;

    const cleanup = () => {
      eventNames.forEach((eventName) => {
        videoElement.removeEventListener(eventName, handleSuccess);
      });
      videoElement.removeEventListener('error', handleError);
      window.clearTimeout(timeoutId);
    };

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const handleSuccess = () => {
      if (ready()) {
        finish(resolve);
      }
    };

    const handleError = () => {
      finish(() => reject(new Error(`Failed while waiting for ${eventNames.join(', ')}.`)));
    };

    timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error(`Timed out while waiting for ${eventNames.join(', ')}.`)));
    }, timeoutMs);

    eventNames.forEach((eventName) => {
      videoElement.addEventListener(eventName, handleSuccess);
    });
    videoElement.addEventListener('error', handleError, { once: true });

    handleSuccess();
  });
};

const cleanupVideoElement = (videoElement) => {
  try {
    videoElement.pause();
    videoElement.removeAttribute('src');
    videoElement.load();
  } catch (error) {
    // Ignore cleanup failures for detached preview elements.
  }
};

const captureVideoFrame = async (videoUrl, timeSeconds) => {
  if (
    !videoUrl ||
    !Number.isFinite(Number(timeSeconds)) ||
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    isJestDomEnvironment()
  ) {
    return null;
  }

  const resolvedVideoUrl = resolveBrowserAssetUrl(videoUrl);
  const safeTimeSeconds = Math.max(0, Number(timeSeconds));
  const cacheKey = `${resolvedVideoUrl}::${safeTimeSeconds.toFixed(2)}`;

  if (frameDataCache.has(cacheKey)) {
    return frameDataCache.get(cacheKey);
  }

  if (framePromiseCache.has(cacheKey)) {
    return framePromiseCache.get(cacheKey);
  }

  const framePromise = (async () => {
    const canvasElement = document.createElement('canvas');
    const canvasContext = canvasElement.getContext?.('2d');

    if (!canvasContext) {
      throw new Error('Canvas context is unavailable.');
    }

    const videoElement = document.createElement('video');
    videoElement.preload = 'auto';
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.crossOrigin = 'anonymous';

    try {
      const metadataReady = waitForVideoLifecycle({
        videoElement,
        eventNames: ['loadedmetadata', 'durationchange'],
        ready: () => Number.isFinite(videoElement.duration) && videoElement.duration > 0
      });
      videoElement.src = resolvedVideoUrl;
      videoElement.load();
      await metadataReady;

      const duration =
        Number.isFinite(videoElement.duration) && videoElement.duration > 0 ? videoElement.duration : null;
      const maxSeekTime =
        duration !== null ? Math.max(0, duration - MIN_FRAME_OFFSET_SECONDS) : safeTimeSeconds;
      const targetTime = Math.max(0, Math.min(safeTimeSeconds, maxSeekTime));

      if (targetTime <= MIN_FRAME_OFFSET_SECONDS) {
        await waitForVideoLifecycle({
          videoElement,
          eventNames: ['loadeddata', 'canplay', 'seeked'],
          ready: () =>
            videoElement.readyState >= FRAME_READY_STATE &&
            videoElement.videoWidth > 0 &&
            videoElement.videoHeight > 0
        });
      } else {
        const seekPromise = waitForVideoLifecycle({
          videoElement,
          eventNames: ['seeked', 'loadeddata', 'canplay'],
          ready: () =>
            videoElement.readyState >= FRAME_READY_STATE &&
            videoElement.videoWidth > 0 &&
            videoElement.videoHeight > 0 &&
            Math.abs(videoElement.currentTime - targetTime) <= 0.12
        });

        videoElement.currentTime = targetTime;
        await seekPromise;
      }

      canvasElement.width = videoElement.videoWidth || 1280;
      canvasElement.height = videoElement.videoHeight || 720;
      canvasContext.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

      const framePayload = {
        src: canvasElement.toDataURL('image/jpeg', 0.86),
        requestedTime: Number(safeTimeSeconds.toFixed(2)),
        actualTime: Number(videoElement.currentTime.toFixed(2)),
        duration,
        clamped: Math.abs(targetTime - safeTimeSeconds) > 0.01
      };

      frameDataCache.set(cacheKey, framePayload);
      return framePayload;
    } finally {
      cleanupVideoElement(videoElement);
      framePromiseCache.delete(cacheKey);
    }
  })();

  framePromiseCache.set(cacheKey, framePromise);
  return framePromise;
};

const buildInspectorRows = ({
  requestedTime = null,
  originalTime = null,
  actualTime = null,
  duration = null,
  clamped = false,
  requestedTimeLabel = '当前视频时间',
  originalTimeLabel = '原始整片时间'
}) => {
  const rows = [];

  if (requestedTime !== null) {
    rows.push({
      label: requestedTimeLabel,
      value: formatDuration(requestedTime)
    });
  }

  if (originalTime !== null && originalTime !== requestedTime) {
    rows.push({
      label: originalTimeLabel,
      value: formatDuration(originalTime)
    });
  }

  if (actualTime !== null) {
    rows.push({
      label: '实际截帧时间',
      value: formatDuration(actualTime)
    });
  }

  if (duration !== null) {
    rows.push({
      label: '当前视频时长',
      value: formatDuration(duration)
    });
  }

  rows.push({
    label: '时间校正',
    value: clamped ? '已发生 clamp' : '未校正'
  });

  return rows;
};

const VideoFramePreview = ({
  videoUrl = '',
  timeSeconds = null,
  originalTimeSeconds = null,
  label = '代表帧',
  note = '',
  className = '',
  requestedTimeLabel = '当前视频时间',
  forcedClamped = false
}) => {
  const framePreviewSupported = !isJestDomEnvironment();
  const normalizedTimeSeconds = normalizeOptionalSeconds(timeSeconds);
  const normalizedOriginalTimeSeconds =
    normalizeOptionalSeconds(originalTimeSeconds) ?? normalizedTimeSeconds;
  const [frameState, setFrameState] = useState({
    src: '',
    actualTime: null,
    duration: null,
    clamped: false
  });
  const [status, setStatus] = useState(() => {
    if (!framePreviewSupported) {
      return 'empty';
    }

    return videoUrl && normalizedTimeSeconds !== null ? 'loading' : 'empty';
  });
  const displayTime = useMemo(() => {
    return normalizedTimeSeconds === null ? '无时间点' : formatDuration(normalizedTimeSeconds);
  }, [normalizedTimeSeconds]);
  const inspectorRows = useMemo(() => {
    return buildInspectorRows({
      requestedTime: normalizedTimeSeconds,
      originalTime: normalizedOriginalTimeSeconds,
      actualTime: frameState.actualTime,
      duration: frameState.duration,
      clamped: frameState.clamped || forcedClamped,
      requestedTimeLabel
    });
  }, [
    frameState.actualTime,
    frameState.clamped,
    frameState.duration,
    forcedClamped,
    normalizedOriginalTimeSeconds,
    normalizedTimeSeconds,
    requestedTimeLabel
  ]);
  const placeholderState = getFramePlaceholderState(status);

  useEffect(() => {
    let active = true;

    if (!framePreviewSupported) {
      return () => {
        active = false;
      };
    }

    if (!videoUrl || normalizedTimeSeconds === null) {
      setFrameState({
        src: '',
        actualTime: null,
        duration: null,
        clamped: false
      });
      setStatus('empty');
      return () => {
        active = false;
      };
    }

    setStatus('loading');

    void captureVideoFrame(videoUrl, normalizedTimeSeconds)
      .then((framePayload) => {
        if (!active) {
          return;
        }

        if (framePayload?.src) {
          setFrameState(framePayload);
          setStatus('ready');
          return;
        }

        setFrameState({
          src: '',
          actualTime: null,
          duration: null,
          clamped: false
        });
        setStatus('failed');
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setFrameState({
          src: '',
          actualTime: null,
          duration: null,
          clamped: false
        });
        setStatus('failed');
      });

    return () => {
      active = false;
    };
  }, [framePreviewSupported, normalizedTimeSeconds, videoUrl]);

  return (
    <div
      className={`relative overflow-hidden rounded-[22px] border border-white/10 bg-black/30 ${className}`}
    >
      {status === 'ready' && frameState.src ? (
        <img
          src={frameState.src}
          alt={`${label} ${displayTime}`}
          className="aspect-video h-full w-full object-cover"
        />
      ) : (
        <div className="flex aspect-video items-center justify-center bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.24),transparent_45%),linear-gradient(180deg,rgba(15,15,35,0.92),rgba(0,0,0,0.96))] px-4 py-5 text-center">
          <div>
            <p
              className={`text-xs font-semibold uppercase tracking-[0.26em] text-white/45 ${
                status === 'loading' ? 'animate-pulse' : ''
              }`}
            >
              {placeholderState.title}
            </p>
            <p className="mt-3 text-sm font-medium text-white/80">
              {placeholderState.description}
            </p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-3 py-3">
        <span className="rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/75">
          {label}
        </span>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white/75">
            {displayTime}
          </span>

          <HoverPopover
            trigger={<span className="text-xs font-semibold text-white/80">时间详情</span>}
            triggerClassName="rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] transition hover:border-white/20 hover:bg-black/60"
            panelClassName="space-y-2"
            disabled={normalizedTimeSeconds === null}
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
                截帧信息
              </p>
              {inspectorRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-white/55">{row.label}</span>
                  <span className="font-semibold text-white">{row.value}</span>
                </div>
              ))}
            </div>
          </HoverPopover>
        </div>
      </div>

      {note ? (
        <div className="absolute inset-x-0 bottom-0 px-3 py-3">
          <p className="line-clamp-2 text-xs leading-5 text-white/80">{note}</p>
        </div>
      ) : null}

      {status === 'failed' ? (
        <div className="absolute bottom-3 right-3 rounded-full border border-amber-500/20 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-100">
          占位图
        </div>
      ) : null}
    </div>
  );
};

VideoFramePreview.propTypes = {
  videoUrl: PropTypes.string,
  timeSeconds: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  originalTimeSeconds: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  label: PropTypes.string,
  note: PropTypes.string,
  className: PropTypes.string,
  requestedTimeLabel: PropTypes.string,
  forcedClamped: PropTypes.bool
};

export { buildInspectorRows, normalizeOptionalSeconds };
export default VideoFramePreview;
