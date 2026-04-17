import { createApp, shutdownServers, startServers } from './app.js';
import logger from './utils/logger.js';

const app = createApp();
const servers = await startServers(app);

const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);

  try {
    await shutdownServers(servers);
  } catch (error) {
    logger.warn('Failed to shut down cleanly', {
      message: error.message
    });
  } finally {
    process.exit(0);
  }
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
