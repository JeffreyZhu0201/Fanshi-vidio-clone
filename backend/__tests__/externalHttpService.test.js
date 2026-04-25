import { createServer } from 'node:http';

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
});
