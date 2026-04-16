import logger from '../utils/logger.js';

class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const errorHandler = (error, request, response, _next) => {
  const statusCode = error.statusCode || 500;
  const isServerError = statusCode >= 500;

  logger.error('Request failed', {
    method: request.method,
    path: request.originalUrl,
    statusCode,
    message: error.message,
    details: error.details,
    stack: error.stack
  });

  response.status(statusCode).json({
    success: false,
    message: isServerError ? 'Internal server error' : error.message,
    details: error.details ?? null
  });
};

export { AppError, errorHandler };

