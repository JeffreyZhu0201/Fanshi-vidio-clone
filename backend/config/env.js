import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(5000),
  APP_ORIGIN: Joi.string().default('http://localhost:5173'),
  HTTPS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  HTTPS_PORT: Joi.number().port().default(5443),
  SSL_KEY_PATH: Joi.string().allow('').default(''),
  SSL_CERT_PATH: Joi.string().allow('').default(''),
  HTTP_REDIRECT_TO_HTTPS: Joi.boolean().truthy('true').falsy('false').default(false),
  DB_HOST: Joi.string().default('127.0.0.1'),
  DB_PORT: Joi.number().port().default(3306),
  DB_USER: Joi.string().default('root'),
  DB_PASSWORD: Joi.string().allow('').default(''),
  DB_NAME: Joi.string().pattern(/^[A-Za-z0-9_]+$/).default('fanshi_video_db'),
  DB_CHARSET: Joi.string().pattern(/^[A-Za-z0-9_]+$/).default('utf8mb4'),
  DB_COLLATION: Joi.string().pattern(/^[A-Za-z0-9_]+$/).default('utf8mb4_unicode_ci'),
  DB_CONNECT_TIMEOUT: Joi.number().integer().positive().default(10000),
  DB_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),
  DB_POOL_MAX: Joi.number().integer().positive().default(10),
  DB_POOL_MIN: Joi.number().integer().min(0).default(0),
  DB_AUTO_CREATE: Joi.boolean().truthy('true').falsy('false').default(true),
  GEMINI_API_KEY: Joi.string().allow('').default(''),
  GEMINI_API_BASE_URL: Joi.string().uri().allow('').default(''),
  GEMINI_MODEL: Joi.string().default('gemini-1.5-flash'),
  SEED_DANCE_API_KEY: Joi.string().allow('').default(''),
  SEED_DANCE_API_BASE_URL: Joi.string().uri().allow('').default(''),
  SEED_DANCE_MODEL: Joi.string().default('seed-dance-v1'),
  EXTERNAL_REQUEST_TIMEOUT: Joi.number().integer().positive().default(30000),
  JWT_SECRET: Joi.string().min(16).default('development-secret-change-me'),
  FILE_UPLOAD_LIMIT: Joi.number().integer().positive().default(524288000)
}).unknown();

const { error, value } = schema.validate(process.env, {
  abortEarly: false,
  convert: true
});

if (error) {
  throw new Error(
    `Environment validation error:\n${error.details
      .map((detail) => `- ${detail.message}`)
      .join('\n')}`
  );
}

const env = Object.freeze(value);

export default env;
