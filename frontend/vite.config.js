import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const resolveSslPath = (targetPath) => {
  if (!targetPath) {
    return null;
  }

  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(process.cwd(), targetPath);
};

const loadHttpsOptions = (enabled, keyPath, certPath) => {
  if (!enabled) {
    return false;
  }

  const resolvedKeyPath = resolveSslPath(keyPath);
  const resolvedCertPath = resolveSslPath(certPath);

  if (!resolvedKeyPath || !resolvedCertPath) {
    throw new Error('VITE_DEV_HTTPS is enabled but SSL certificate paths are missing.');
  }

  if (!existsSync(resolvedKeyPath) || !existsSync(resolvedCertPath)) {
    throw new Error(
      `HTTPS certificate file is missing. Expected key=${resolvedKeyPath}, cert=${resolvedCertPath}`
    );
  }

  return {
    key: readFileSync(resolvedKeyPath),
    cert: readFileSync(resolvedCertPath)
  };
};

const getDevOrigin = ({ host, httpsEnabled, port }) => {
  const protocol = httpsEnabled ? 'https' : 'http';
  return `${protocol}://${host}:${port}`;
};

const resolveProxyTarget = (env, devOrigin) => {
  const configuredProxyTarget = env.VITE_API_PROXY_TARGET?.trim();

  if (configuredProxyTarget) {
    return configuredProxyTarget;
  }

  const configuredApiBaseUrl = env.VITE_API_BASE_URL?.trim();

  if (!configuredApiBaseUrl) {
    return '';
  }

  try {
    return new URL(configuredApiBaseUrl, devOrigin).origin;
  } catch {
    return '';
  }
};

const createDevProxy = (target) => {
  if (!target) {
    return undefined;
  }

  return {
    '/api': {
      target,
      changeOrigin: true,
      secure: false
    },
    '/uploads': {
      target,
      changeOrigin: true,
      secure: false
    },
    '/ws': {
      target,
      changeOrigin: true,
      secure: false,
      ws: true
    }
  };
};

const parseAllowedHosts = (value) => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const httpsEnabled = env.VITE_DEV_HTTPS === 'true';
  const devHost = env.VITE_DEV_HOST || 'localhost';
  const httpsOptions = loadHttpsOptions(
    httpsEnabled,
    env.VITE_SSL_KEY_PATH,
    env.VITE_SSL_CERT_PATH
  );
  const devOrigin = getDevOrigin({
    host: devHost,
    httpsEnabled,
    port: 5173
  });
  const devProxy = createDevProxy(resolveProxyTarget(env, devOrigin));
  const allowedHosts = parseAllowedHosts(env.VITE_ALLOWED_HOSTS);

  return {
    plugins: [react()],
    define: {
      __APP_ENV__: JSON.stringify(
        Object.fromEntries(
          Object.entries(env).filter(([key]) => key.startsWith('VITE_'))
        )
      )
    },
    server: {
      host: devHost,
      port: 5173,
      https: httpsOptions,
      allowedHosts,
      proxy: devProxy
    },
    preview: {
      host: devHost,
      port: 4173,
      https: httpsOptions
    }
  };
});
