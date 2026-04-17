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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const httpsEnabled = env.VITE_DEV_HTTPS === 'true';
  const devHost = env.VITE_DEV_HOST || '127.0.0.1';
  const httpsOptions = loadHttpsOptions(
    httpsEnabled,
    env.VITE_SSL_KEY_PATH,
    env.VITE_SSL_CERT_PATH
  );

  return {
    plugins: [react()],
    server: {
      host: devHost,
      port: 5173,
      https: httpsOptions
    },
    preview: {
      host: devHost,
      port: 4173,
      https: httpsOptions
    }
  };
});
