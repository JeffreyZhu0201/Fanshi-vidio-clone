const runtimeEnv = typeof __APP_ENV__ !== 'undefined' ? __APP_ENV__ : {};

const getEnv = (key, fallbackValue = '') => {
  if (runtimeEnv[key] !== undefined) {
    return runtimeEnv[key];
  }

  if (typeof process !== 'undefined' && process.env?.[key] !== undefined) {
    return process.env[key];
  }

  return fallbackValue;
};

export { getEnv };
