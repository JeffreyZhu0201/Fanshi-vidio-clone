import { getEnv } from './env.js';

const monitoringEndpoint = getEnv('VITE_MONITORING_ENDPOINT', '').trim();

const emitMetric = (type, payload) => {
  if (!monitoringEndpoint || typeof navigator === 'undefined') {
    return;
  }

  const body = JSON.stringify({
    type,
    payload,
    url: window.location.href,
    userAgent: navigator.userAgent,
    recordedAt: new Date().toISOString()
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(monitoringEndpoint, body);
    return;
  }

  void fetch(monitoringEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body,
    keepalive: true
  });
};

const observeWebVitals = () => {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return;
  }

  let cumulativeLayoutShift = 0;

  try {
    const paintObserver = new PerformanceObserver((entryList) => {
      entryList.getEntries().forEach((entry) => {
        if (entry.name === 'first-contentful-paint') {
          emitMetric('web-vital', {
            name: 'FCP',
            value: Number(entry.startTime.toFixed(2))
          });
        }
      });
    });

    paintObserver.observe({
      type: 'paint',
      buffered: true
    });
  } catch {}

  try {
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const latestEntry = entries[entries.length - 1];

      if (latestEntry) {
        emitMetric('web-vital', {
          name: 'LCP',
          value: Number(latestEntry.startTime.toFixed(2))
        });
      }
    });

    lcpObserver.observe({
      type: 'largest-contentful-paint',
      buffered: true
    });
  } catch {}

  try {
    const clsObserver = new PerformanceObserver((entryList) => {
      entryList.getEntries().forEach((entry) => {
        if (!entry.hadRecentInput) {
          cumulativeLayoutShift += entry.value;
        }
      });

      emitMetric('web-vital', {
        name: 'CLS',
        value: Number(cumulativeLayoutShift.toFixed(4))
      });
    });

    clsObserver.observe({
      type: 'layout-shift',
      buffered: true
    });
  } catch {}
};

const observeRuntimeErrors = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.addEventListener('error', (event) => {
    emitMetric('frontend-error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    emitMetric('frontend-error', {
      type: 'unhandledrejection',
      reason:
        typeof event.reason === 'string'
          ? event.reason
          : event.reason?.message || 'Unknown promise rejection'
    });
  });
};

const initializePerformanceMonitoring = () => {
  observeWebVitals();
  observeRuntimeErrors();
};

export { initializePerformanceMonitoring };
