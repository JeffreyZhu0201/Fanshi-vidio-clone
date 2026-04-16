import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(5000),
  APP_ORIGIN: Joi.string().default('http://localhost:5173'),
  DB_HOST: Joi.string().default('127.0.0.1'),
  DB_PORT: Joi.number().port().default(3306),
  DB_USER: Joi.string().default('root'),
  DB_PASSWORD: Joi.string().allow('').default(''),
  DB_NAME: Joi.string().default('fanshi_video_db'),
  DB_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),
  GEMINI_API_KEY: Joi.string().allow('').default(''),
  SEED_DANCE_API_KEY: Joi.string().allow('').default(''),
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

