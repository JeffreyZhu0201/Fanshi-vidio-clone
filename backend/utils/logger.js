import winston from 'winston';

import env from '../config/env.js';

const consoleFormat = winston.format.printf(
  ({ level, message, timestamp, stack, ...metadata }) => {
    const serializedMetadata =
      Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : '';

    return `[${timestamp}] ${level}: ${stack || message}${serializedMetadata}`;
  }
);

const logger = winston.createLogger({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    consoleFormat
  ),
  transports: [new winston.transports.Console()]
});

export const morganStream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

export default logger;

