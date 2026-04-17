const runtimeEnv =
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

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
