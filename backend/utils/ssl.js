import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const resolveSslPath = (targetPath) => {
  if (!targetPath) {
    return null;
  }

  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(process.cwd(), targetPath);
};

const loadHttpsCredentials = ({ enabled, keyPath, certPath }) => {
  if (!enabled) {
    return null;
  }

  const resolvedKeyPath = resolveSslPath(keyPath);
  const resolvedCertPath = resolveSslPath(certPath);

  if (!resolvedKeyPath || !resolvedCertPath) {
    throw new Error('HTTPS is enabled but SSL_KEY_PATH or SSL_CERT_PATH is missing.');
  }

  if (!existsSync(resolvedKeyPath)) {
    throw new Error(`SSL key file not found: ${resolvedKeyPath}`);
  }

  if (!existsSync(resolvedCertPath)) {
    throw new Error(`SSL certificate file not found: ${resolvedCertPath}`);
  }

  return {
    key: readFileSync(resolvedKeyPath),
    cert: readFileSync(resolvedCertPath),
    keyPath: resolvedKeyPath,
    certPath: resolvedCertPath
  };
};

export { loadHttpsCredentials, resolveSslPath };
