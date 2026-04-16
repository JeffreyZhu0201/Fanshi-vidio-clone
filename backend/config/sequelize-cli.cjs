const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({
  path: path.resolve(__dirname, '..', '.env')
});

const commonConfig = {
  username: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'fanshi_video_db',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  dialect: 'mysql',
  logging: process.env.DB_LOGGING === 'true' ? console.log : false,
  migrationStorage: 'sequelize',
  seederStorage: 'sequelize',
  dialectOptions: {
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000)
  }
};

module.exports = {
  development: {
    ...commonConfig
  },
  test: {
    ...commonConfig,
    database: `${commonConfig.database}_test`
  },
  production: {
    ...commonConfig
  }
};
