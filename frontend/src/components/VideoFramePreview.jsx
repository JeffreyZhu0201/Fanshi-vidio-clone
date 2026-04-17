import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import { formatDuration } from '../utils/formatDuration.js';

const FRAME_LOAD_TIMEOUT_MS = 6000;
const frameDataCache = new Map();
const framePromiseCache = new Map();

const isJestDomEnvironment = () => {
  return typeof navigator !== 'undefined' && /jsdom/iu.test(navigator.userAgent || '');
};

const resolveBrowserAssetUrl = (assetPath = '') => {
  if (!assetPath) {
    return '';
  }

  if (/^(blob:|data:|https?:\/\/)/iu.test(assetPath)) {
    return assetPath;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(assetPath.startsWith('/') ? assetPath : `/${assetPath}`, window.location.origin).toString();
  }

  return assetPath;
};

const waitForVideoEvent = (videoElement, eventName, timeoutMs = FRAME_LOAD_TIMEOUT_MS) => {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = 0;

    const cleanup = () => {
      videoElement.removeEventListener(eventName, handleSuccess);
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
      finish(resolve);
    };

    const handleError = () => {
      finish(() => reject(new Error(`Failed while waiting for ${eventName}.`)));
    };

    timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error(`Timed out while waiting for ${eventName}.`)));
    }, timeoutMs);

    videoElement.addEventListener(eventName, handleSuccess, { once: true });
    videoElement.addEventListener('error', handleError, { once: true });
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
    return '';
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
      return '';
    }

    const videoElement = document.createElement('video');
    videoElement.preload = 'auto';
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.src = resolvedVideoUrl;

    try {
      await waitForVideoEvent(videoElement, 'loadedmetadata');

      const maxSeekTime =
        Number.isFinite(videoElement.duration) && videoElement.duration > 0
          ? Math.max(0, videoElement.duration - 0.05)
          : safeTimeSeconds;
      const targetTime = Math.max(0, Math.min(safeTimeSeconds, maxSeekTime));

      if (targetTime <= 0.05) {
        if (videoElement.readyState < 2) {
          await waitForVideoEvent(videoElement, 'loadeddata');
        }
      } else {
        videoElement.currentTime = targetTime;
        await waitForVideoEvent(videoElement, 'seeked');
      }

      canvasElement.width = videoElement.videoWidth || 1280;
      canvasElement.height = videoElement.videoHeight || 720;
      canvasContext.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

      const previewDataUrl = canvasElement.toDataURL('image/jpeg', 0.86);
      frameDataCache.set(cacheKey, previewDataUrl);
      return previewDataUrl;
    } catch (error) {
      return '';
    } finally {
      cleanupVideoElement(videoElement);
      framePromiseCache.delete(cacheKey);
    }
  })();

  framePromiseCache.set(cacheKey, framePromise);
  return framePromise;
};

const VideoFramePreview = ({
  videoUrl = '',
  timeSeconds = null,
  label = '代表帧',
  note = '',
  className = ''
}) => {
  const framePreviewSupported = !isJestDomEnvironment();
  const [frameSrc, setFrameSrc] = useState('');
  const [status, setStatus] = useState(() => {
    if (!framePreviewSupported) {
      return 'empty';
    }

    return videoUrl && Number.isFinite(Number(timeSeconds)) ? 'loading' : 'empty';
  });
  const normalizedTimeSeconds = Number.isFinite(Number(timeSeconds)) ? Number(timeSeconds) : null;
  const displayTime = useMemo(() => {
    return normalizedTimeSeconds === null ? '无时间点' : formatDuration(normalizedTimeSeconds);
  }, [normalizedTimeSeconds]);

  useEffect(() => {
    let active = true;

    if (!framePreviewSupported) {
      return () => {
        active = false;
      };
    }

    if (!videoUrl || normalizedTimeSeconds === null) {
      setFrameSrc('');
      setStatus('empty');
      return () => {
        active = false;
      };
    }

    setStatus('loading');

    void captureVideoFrame(videoUrl, normalizedTimeSeconds).then((nextFrameSrc) => {
      if (!active) {
        return;
      }

      if (nextFrameSrc) {
        setFrameSrc(nextFrameSrc);
        setStatus('ready');
        return;
      }

      setFrameSrc('');
      setStatus('empty');
    });

    return () => {
      active = false;
    };
  }, [framePreviewSupported, normalizedTimeSeconds, videoUrl]);

  return (
    <div className={`relative overflow-hidden rounded-[22px] border border-white/10 bg-black/30 ${className}`}>
      {status === 'ready' && frameSrc ? (
        <img
          src={frameSrc}
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
              {status === 'loading' ? '抽取中' : '暂无典型帧'}
            </p>
            <p className="mt-3 text-sm font-medium text-white/80">
              {status === 'loading' ? '正在从原视频定位该时间点画面' : '等待可用的视频帧或时间戳'}
            </p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-3 py-3">
        <span className="rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/75">
          {label}
        </span>
        <span className="rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white/75">
          {displayTime}
        </span>
      </div>

      {note ? (
        <div className="absolute inset-x-0 bottom-0 px-3 py-3">
          <p className="line-clamp-2 text-xs leading-5 text-white/80">{note}</p>
        </div>
      ) : null}
    </div>
  );
};

VideoFramePreview.propTypes = {
  videoUrl: PropTypes.string,
  timeSeconds: PropTypes.oneOfType([PropTypes.number, PropTypes.oneOf([null])]),
  label: PropTypes.string,
  note: PropTypes.string,
  className: PropTypes.string
};

export default VideoFramePreview;
