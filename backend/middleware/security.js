import { randomUUID } from 'node:crypto';

import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import env from '../config/env.js';

const isExcludedFromRateLimit = (request) => {
  const pathCandidates = [request.path, request.originalUrl];

  return pathCandidates.some((pathname) =>
    ['/health', '/health/database', '/metrics'].some(
      (targetPath) => pathname === targetPath || pathname === `/api${targetPath}`
    )
  );
};

const requestContext = (request, response, next) => {
  const requestId = request.headers['x-request-id'] || randomUUID();

  request.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
};

const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: {
    policy: 'cross-origin'
  }
});

const responseCompression = compression({
  threshold: 1024
});

const apiRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: isExcludedFromRateLimit,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
    details: null
  }
});

export { apiRateLimiter, requestContext, responseCompression, securityHeaders };
