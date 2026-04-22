import http from 'node:http';
import https from 'node:https';

import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';

import env from './config/env.js';
import swaggerSpec from './config/swagger.js';
import { closeDatabaseConnection, connectDatabase } from './config/database.js';
import { API_PREFIX, APP_NAME, UPLOAD_DIRECTORIES } from './config/constants.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestMetrics } from './middleware/requestMetrics.js';
import { notFoundHandler } from './middleware/notFound.js';
import {
  apiRateLimiter,
  requestContext,
  responseCompression,
  securityHeaders
} from './middleware/security.js';
import apiRouter from './routes/index.js';
import { attachRealtimeServer, closeRealtimeServers } from './services/realtimeService.js';
import { recoverInFlightTasks } from './services/taskRecoveryService.js';
import { ensureUploadDirectories } from './utils/bootstrap.js';
import logger, { morganStream } from './utils/logger.js';
import { loadHttpsCredentials } from './utils/ssl.js';

const expandLocalOriginVariants = (origin) => {
  const normalizedOrigin = origin.trim();

  if (!normalizedOrigin) {
    return [];
  }

  try {
    const url = new URL(normalizedOrigin);

    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      return [normalizedOrigin];
    }

    return ['localhost', '127.0.0.1'].map(
      (hostname) => `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ''}`
    );
  } catch {
    return [normalizedOrigin];
  }
};

const createAllowedOrigins = () =>
  new Set(
    env.APP_ORIGIN.split(',')
      .flatMap((origin) => expandLocalOriginVariants(origin))
      .filter(Boolean)
  );

const createApp = () => {
  const app = express();
  const allowedOrigins = createAllowedOrigins();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestContext);
  app.use(requestMetrics);
  app.use(responseCompression);
  app.use(securityHeaders);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
      stream: morganStream,
      skip: (request) =>
        request.path.startsWith('/api/health') || request.path === '/api/metrics'
    })
  );
  app.use(API_PREFIX, apiRateLimiter);

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

  return app;
};

const startServers = async (app) => {
  const servers = [];

  await ensureUploadDirectories();
  await connectDatabase({ force: true });
  queueMicrotask(() => {
    void recoverInFlightTasks();
  });

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
        logger.info(`${APP_NAME} backend listening on https://localhost:${env.HTTPS_PORT}`, {
          sslKeyPath: credentials.keyPath,
          sslCertPath: credentials.certPath
        });
        resolve();
      });
    });

    servers.push(httpsServer);
    attachRealtimeServer(httpsServer);

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
    }

    return servers;
  }

  const httpServer = http.createServer(app);

  await new Promise((resolve) => {
    httpServer.listen(env.PORT, () => {
      logger.info(`${APP_NAME} backend listening on http://localhost:${env.PORT}`);
      resolve();
    });
  });

  servers.push(httpServer);
  attachRealtimeServer(httpServer);

  return servers;
};

const shutdownServers = async (servers = []) => {
  await closeRealtimeServers();

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

  await closeDatabaseConnection();
};

export { createApp, startServers, shutdownServers };
