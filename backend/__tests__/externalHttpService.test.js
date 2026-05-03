import { createServer } from 'node:http';

import { jest } from '@jest/globals';

const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address());
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

describe('externalHttpService', () => {
  test('wraps non-json upstream responses with a descriptive parse error', async () => {
    const server = createServer((request, response) => {
      response.writeHead(502, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      response.end('<html><h1>502 Bad Gateway</h1><p>upstream html error page</p></html>');
    });
    const { port } = await listen(server);
    const { requestExternalJson } = await import('../services/externalHttpService.js');

    try {
      await requestExternalJson(`http://127.0.0.1:${port}/html-error`);
      throw new Error('Expected requestExternalJson to throw for a HTML response.');
    } catch (error) {
      expect(error.statusCode).toBe(502);
      expect(error.contentType).toBe('text/html; charset=utf-8');
      expect(error.message).toContain('External request expected JSON but received non-JSON response');
      expect(error.message).toContain('content-type text/html; charset=utf-8');
      expect(error.message).not.toContain("Unexpected token '<'");
    } finally {
      await closeServer(server);
    }
  });

  test('falls back to direct native requests when the configured local proxy is refused', async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/json'
      });
      response.end(JSON.stringify({ ok: true, path: request.url }));
    });
    const { port } = await listen(server);
    const mockedUndiciFetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('fetch failed'), {
        cause: new Error('connect ECONNREFUSED 127.0.0.1:7890')
      })
    );

    jest.resetModules();
    await jest.unstable_mockModule('undici', () => ({
      fetch: mockedUndiciFetch,
      EnvHttpProxyAgent: class EnvHttpProxyAgent {}
    }));
    await jest.unstable_mockModule('../utils/logger.js', () => ({
      default: {
        warn: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      }
    }));

    try {
      const { requestExternalJson } = await import('../services/externalHttpService.js');
      const result = await requestExternalJson(`http://127.0.0.1:${port}/proxy-refused`);

      expect(result.responsePayload).toEqual({
        ok: true,
        path: '/proxy-refused'
      });
      // When :7890 proxy is detected in environment variables, the service bypasses undici
      // entirely and uses native HTTP directly, so undici fetch is never called
      expect(mockedUndiciFetch).toHaveBeenCalledTimes(0);
    } finally {
      await closeServer(server);
      jest.resetModules();
    }
  });
});
