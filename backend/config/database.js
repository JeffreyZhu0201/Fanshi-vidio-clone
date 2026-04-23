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

const syncDatabaseSchema = async ({ force = false, alter = false } = {}) => {
  const database = await connectDatabase();

  if (!database.connected) {
    throw new Error(database.errorMessage || 'Database connection is not available.');
  }

  const { initializeModels } = await import('../models/index.js');

  initializeModels();
  await sequelize.sync({ force, alter });

  logger.info('Database schema synchronized successfully', {
    force,
    alter
  });

  return true;
};

const getDatabaseStatus = () => {
  return { ...databaseState };
};

const normalizeTableName = (value) => {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    return String(Object.values(value)[0] ?? '');
  }

  return '';
};

const ensureDatabaseCompatibility = async () => {
  const database = await connectDatabase();

  if (!database.connected) {
    return false;
  }

  const queryInterface = sequelize.getQueryInterface();
  const existingTables = new Set(
    (await queryInterface.showAllTables())
      .map((tableName) => normalizeTableName(tableName).trim().toLowerCase())
      .filter(Boolean)
  );

  if (!existingTables.has('analyses')) {
    return false;
  }

  const analysisTable = await queryInterface.describeTable('analyses');

  if (!analysisTable.analysis_options) {
    await queryInterface.addColumn('analyses', 'analysis_options', {
      type: Sequelize.JSON,
      allowNull: true
    });

    logger.info('Applied compatibility schema fix for analyses.analysis_options');
  }

  return true;
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
  syncDatabaseSchema,
  ensureDatabaseCompatibility,
  getDatabaseStatus,
  closeDatabaseConnection
};
