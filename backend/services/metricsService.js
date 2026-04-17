import client from 'prom-client';

const register = new client.Registry();

client.collectDefaultMetrics({
  prefix: 'fanshi_backend_',
  register
});

const httpRequestDuration = new client.Histogram({
  name: 'fanshi_backend_http_request_duration_ms',
  help: 'HTTP request duration in milliseconds.',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [25, 50, 100, 250, 500, 1000, 2000, 5000],
  registers: [register]
});

const httpRequestTotal = new client.Counter({
  name: 'fanshi_backend_http_requests_total',
  help: 'Total HTTP requests handled by the backend.',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const activeHttpRequests = new client.Gauge({
  name: 'fanshi_backend_http_requests_active',
  help: 'Current number of active HTTP requests.',
  registers: [register]
});

const frontendMonitoringEventsTotal = new client.Counter({
  name: 'fanshi_backend_frontend_monitoring_events_total',
  help: 'Total frontend monitoring events accepted by the backend.',
  labelNames: ['type'],
  registers: [register]
});

const observeHttpRequest = ({ method, route, statusCode, durationMs }) => {
  const labels = {
    method,
    route,
    status_code: String(statusCode)
  };

  httpRequestDuration.observe(labels, durationMs);
  httpRequestTotal.inc(labels);
};

const incrementActiveHttpRequests = () => {
  activeHttpRequests.inc();
};

const decrementActiveHttpRequests = () => {
  activeHttpRequests.dec();
};

const recordMonitoringEvent = ({ type }) => {
  frontendMonitoringEventsTotal.inc({
    type: type || 'unknown'
  });
};

const getMetricsPayload = async () => {
  return register.metrics();
};

const getMetricsContentType = () => register.contentType;

export {
  decrementActiveHttpRequests,
  getMetricsContentType,
  getMetricsPayload,
  incrementActiveHttpRequests,
  recordMonitoringEvent,
  observeHttpRequest
};
