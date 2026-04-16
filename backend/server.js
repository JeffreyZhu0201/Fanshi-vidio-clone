import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import env from './config/env.js';
import { connectDatabase, sequelize } from './config/database.js';
import { API_PREFIX, APP_NAME, UPLOAD_DIRECTORIES } from './config/constants.js';
import apiRouter from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';
import { ensureUploadDirectories } from './utils/bootstrap.js';
import logger, { morganStream } from './utils/logger.js';

await ensureUploadDirectories();

const app = express();

app.disable('x-powered-by');

app.use(
  cors({
    origin: env.APP_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: morganStream
  })
);

app.get('/', (_request, response) => {
  response.status(200).json({
    name: APP_NAME,
    status: 'running',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

app.use('/uploads', express.static(UPLOAD_DIRECTORIES.root));
app.use(API_PREFIX, apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, async () => {
  logger.info(`${APP_NAME} backend listening on http://localhost:${env.PORT}`);
  await connectDatabase();
});

const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);

  server.close(async () => {
    try {
      await sequelize.close();
    } catch (error) {
      logger.warn('Failed to close database connection cleanly', {
        message: error.message
      });
    } finally {
      process.exit(0);
    }
  });
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});

