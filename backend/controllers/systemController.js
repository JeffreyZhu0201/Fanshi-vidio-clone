import { checkDatabaseHealth } from '../config/database.js';

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
