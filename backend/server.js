import http from 'node:http';
import https from 'node:https';

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';

import env from './config/env.js';
import swaggerSpec from './config/swagger.js';
import { closeDatabaseConnection, connectDatabase } from './config/database.js';
import { API_PREFIX, APP_NAME, UPLOAD_DIRECTORIES } from './config/constants.js';
import apiRouter from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';
import { ensureUploadDirectories } from './utils/bootstrap.js';
import logger, { morganStream } from './utils/logger.js';
import { loadHttpsCredentials } from './utils/ssl.js';

await ensureUploadDirectories();

const app = express();
const servers = [];

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

app.get('/api-docs.json', (_request, response) => {
  response.status(200).json(swaggerSpec);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/uploads', express.static(UPLOAD_DIRECTORIES.root));
app.use(API_PREFIX, apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

const startServers = async () => {
  await connectDatabase({ force: true });

  if (env.HTTPS_ENABLED) {
    const credentials = loadHttpsCredentials({
      enabled: env.HTTPS_ENABLED,
      keyPath: env.SSL_KEY_PATH,
      certPath: env.SSL_CERT_PATH
    });

    const httpsServer = https.createServer(
      {
        key: credentials.key,
        cert: credentials.cert
      },
      app
    );

    await new Promise((resolve) => {
      httpsServer.listen(env.HTTPS_PORT, () => {
        logger.info(
          `${APP_NAME} backend listening on https://localhost:${env.HTTPS_PORT}`,
          {
            sslKeyPath: credentials.keyPath,
            sslCertPath: credentials.certPath
          }
        );
        resolve();
      });
    });

    servers.push(httpsServer);

    if (env.HTTP_REDIRECT_TO_HTTPS) {
      const redirectApp = express();

      redirectApp.use((request, response) => {
        const host = request.headers.host?.replace(/:\d+$/, '') || 'localhost';
        const targetUrl = `https://${host}:${env.HTTPS_PORT}${request.originalUrl}`;

        response.redirect(308, targetUrl);
      });

      const httpServer = http.createServer(redirectApp);

      await new Promise((resolve) => {
        httpServer.listen(env.PORT, () => {
          logger.info(
            `${APP_NAME} HTTP redirect listening on http://localhost:${env.PORT} -> https://localhost:${env.HTTPS_PORT}`
          );
          resolve();
        });
      });

      servers.push(httpServer);
      return;
    }

    return;
  }

  const httpServer = http.createServer(app);

  await new Promise((resolve) => {
    httpServer.listen(env.PORT, () => {
      logger.info(`${APP_NAME} backend listening on http://localhost:${env.PORT}`);
      resolve();
    });
  });

  servers.push(httpServer);
};

await startServers();

const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);

  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.close(() => {
            resolve();
          });
        })
    )
  );

  try {
    await closeDatabaseConnection();
  } catch (error) {
    logger.warn('Failed to close database connection cleanly', {
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
