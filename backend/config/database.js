import { Sequelize } from 'sequelize';

import env from './env.js';
import logger from '../utils/logger.js';

const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
  host: env.DB_HOST,
  port: env.DB_PORT,
  dialect: 'mysql',
  logging: env.DB_LOGGING ? (message) => logger.debug(message) : false,
  define: {
    underscored: true,
    freezeTableName: false,
    timestamps: true
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

const connectDatabase = async () => {
  try {
    await sequelize.authenticate();
    logger.info('MySQL connection established successfully');
    return true;
  } catch (error) {
    logger.warn('MySQL connection is not available yet; backend will keep running', {
      message: error.message
    });
    return false;
  }
};

export { sequelize, connectDatabase };

