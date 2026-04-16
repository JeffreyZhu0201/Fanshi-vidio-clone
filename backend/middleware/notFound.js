import { AppError } from './errorHandler.js';

const notFoundHandler = (request, _response, next) => {
  next(new AppError(`Route not found: ${request.method} ${request.originalUrl}`, 404));
};

export { notFoundHandler };

