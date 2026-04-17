import { checkDatabaseHealth } from '../config/database.js';
import { getMetricsContentType, getMetricsPayload } from '../services/metricsService.js';
import { recordFrontendMonitoringEvent } from '../services/monitoringService.js';

export const healthCheck = async (_request, response) => {
  const database = await checkDatabaseHealth();

  response.status(200).json({
    success: true,
    service: 'backend',
    status: database.connected ? 'ok' : 'degraded',
    database,
    timestamp: new Date().toISOString()
  });
};

export const databaseHealthCheck = async (_request, response) => {
  const database = await checkDatabaseHealth();

  response.status(database.connected ? 200 : 503).json({
    success: database.connected,
    database,
    timestamp: new Date().toISOString()
  });
};

export const metrics = async (_request, response) => {
  response.setHeader('Content-Type', getMetricsContentType());
  response.status(200).send(await getMetricsPayload());
};

export const ingestMonitoringEvent = async (request, response) => {
  const result = await recordFrontendMonitoringEvent(request.body);

  response.status(202).json({
    success: true,
    ...result
  });
};
