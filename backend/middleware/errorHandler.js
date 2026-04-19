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
  const normalizedError = normalizeError(error);
  const statusCode = normalizedError.statusCode || 500;
  const isServerError = statusCode >= 500;
  const shouldExposeMessage = normalizedError instanceof AppError || !isServerError;

  logger.error('Request failed', {
    method: request.method,
    path: request.originalUrl,
    statusCode,
    message: normalizedError.message,
    details: normalizedError.details,
    stack: normalizedError.stack
  });

  response.status(statusCode).json({
    success: false,
    message: shouldExposeMessage ? normalizedError.message : 'Internal server error',
    details: normalizedError.details ?? null
  });
};

const normalizeError = (error) => {
  if (error instanceof AppError) {
    return error;
  }

  if (error.name === 'MulterError') {
    return new AppError(error.message, 400, {
      field: error.field,
      code: error.code
    });
  }

  if (error.name === 'SequelizeValidationError' || error.name === 'SequelizeUniqueConstraintError') {
    return new AppError('Database validation failed', 400, {
      errors: error.errors?.map((item) => item.message) ?? []
    });
  }

  return error;
};

export { AppError, errorHandler };
