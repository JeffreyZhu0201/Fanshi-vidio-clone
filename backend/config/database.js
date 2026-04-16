import mysql from 'mysql2/promise';
import { Sequelize } from 'sequelize';

import env from './env.js';
import logger from '../utils/logger.js';

const databaseState = {
  connected: false,
  status: 'idle',
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  dialect: 'mysql',
  lastCheckedAt: null,
  lastConnectedAt: null,
  errorMessage: null
};

const updateDatabaseState = (overrides) => {
  Object.assign(databaseState, overrides, {
    lastCheckedAt: new Date().toISOString()
  });
};

const createDatabaseIfNotExists = async () => {
  if (!env.DB_AUTO_CREATE) {
    return;
  }

  const connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    connectTimeout: env.DB_CONNECT_TIMEOUT
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET ${env.DB_CHARSET} COLLATE ${env.DB_COLLATION}`
    );
  } finally {
    await connection.end();
  }
};

const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
  host: env.DB_HOST,
  port: env.DB_PORT,
  dialect: 'mysql',
  dialectOptions: {
    connectTimeout: env.DB_CONNECT_TIMEOUT
  },
  logging: env.DB_LOGGING ? (message) => logger.debug(message) : false,
  define: {
    underscored: true,
    freezeTableName: false,
    timestamps: true
  },
  pool: {
    max: env.DB_POOL_MAX,
    min: env.DB_POOL_MIN,
    acquire: 30000,
    idle: 10000
  }
});

const connectDatabase = async ({ force = false } = {}) => {
  if (databaseState.connected && !force) {
    return { ...databaseState };
  }

  try {
    updateDatabaseState({
      connected: false,
      status: 'connecting',
      errorMessage: null
    });

    await createDatabaseIfNotExists();
    await sequelize.authenticate();

    updateDatabaseState({
      connected: true,
      status: 'connected',
      lastConnectedAt: new Date().toISOString(),
      errorMessage: null
    });

    logger.info('MySQL connection established successfully', {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME
    });

    return { ...databaseState };
  } catch (error) {
    updateDatabaseState({
      connected: false,
      status: 'failed',
      errorMessage: error.message
    });

    logger.warn('MySQL connection is not available yet; backend will keep running', {
      message: error.message
    });

    return { ...databaseState };
  }
};

const checkDatabaseHealth = async () => {
  return connectDatabase({ force: true });
};

const getDatabaseStatus = () => {
  return { ...databaseState };
};

const closeDatabaseConnection = async () => {
  await sequelize.close();

  updateDatabaseState({
    connected: false,
    status: 'closed'
  });
};

export {
  sequelize,
  connectDatabase,
  checkDatabaseHealth,
  getDatabaseStatus,
  closeDatabaseConnection
};
