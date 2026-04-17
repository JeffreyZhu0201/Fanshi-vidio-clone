import {
  decrementActiveHttpRequests,
  incrementActiveHttpRequests,
  observeHttpRequest
} from '../services/metricsService.js';

const requestMetrics = (request, response, next) => {
  const startedAt = performance.now();
  incrementActiveHttpRequests();

  response.on('finish', () => {
    const durationMs = performance.now() - startedAt;

    observeHttpRequest({
      method: request.method,
      route: request.route?.path || request.baseUrl || request.path,
      statusCode: response.statusCode,
      durationMs
    });
    decrementActiveHttpRequests();
  });

  response.on('close', () => {
    if (!response.writableEnded) {
      decrementActiveHttpRequests();
    }
  });

  next();
};

export { requestMetrics };
