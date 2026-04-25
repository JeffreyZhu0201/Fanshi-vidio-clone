import http from 'node:http';
import https from 'node:https';

import { fetch as undiciFetch, EnvHttpProxyAgent } from 'undici';

import env from '../config/env.js';
import logger from '../utils/logger.js';

const configuredProxyValues = [
  process.env.HTTPS_PROXY,
  process.env.HTTP_PROXY,
  process.env.ALL_PROXY,
  process.env.https_proxy,
  process.env.http_proxy,
  process.env.all_proxy
]
  .map((value) => String(value ?? '').trim())
  .filter(Boolean);
const hasConfiguredProxy = configuredProxyValues.length > 0;
const shouldBypassConfiguredProxy = configuredProxyValues.some((value) => {
  return /(?:127\.0\.0\.1|localhost|\[::1\]|::1):7890/iu.test(value);
});
const MAX_NATIVE_REDIRECTS = 5;
const UNDICI_TLS_FALLBACK_ERROR_PATTERN =
  /before secure tls connection was established|client network socket disconnected|socket disconnected|socket hang up|tls connection|econnreset|econnrefused|connection refused|http\/2: stream half-closed|stream half-closed|unexpected eof|h2 stream|nghttp2_enhance_your_calm/iu;
const nativeFallbackOrigins = new Set();

if (shouldBypassConfiguredProxy) {
  logger.warn('External requests are bypassing the configured local :7890 proxy and using direct connections.', {
    proxies: configuredProxyValues
  });
}

const sharedDispatcher = hasConfiguredProxy && !shouldBypassConfiguredProxy ? new EnvHttpProxyAgent() : null;

const getExternalDispatcher = () => {
  return sharedDispatcher || undefined;
};

const mergeAbortSignals = (signals = []) => {
  const activeSignals = signals.filter(Boolean);

  if (!activeSignals.length) {
    return undefined;
  }

  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();

  activeSignals.forEach((signal) => {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return;
    }

    signal.addEventListener(
      'abort',
      () => {
        controller.abort(signal.reason);
      },
      { once: true }
    );
  });

  return controller.signal;
};

const buildExternalRequestSignal = ({ timeoutMs = env.EXTERNAL_REQUEST_TIMEOUT, signal } = {}) => {
  const timeoutSignal =
    Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? AbortSignal.timeout(Number(timeoutMs)) : undefined;

  return mergeAbortSignals([timeoutSignal, signal]);
};

const summarizeExternalUrlForLogs = (url) => {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    return String(url ?? '').split('?')[0];
  }
};

const resolveExternalOrigin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

const describeExternalTransportError = (error) => {
  return [
    error?.message,
    error?.cause?.message,
    error?.code,
    error?.cause?.code
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' | ');
};

const shouldFallbackToNativeHttp = (error) => {
  return UNDICI_TLS_FALLBACK_ERROR_PATTERN.test(describeExternalTransportError(error));
};

const normalizeExternalRequestHeaders = (headers = {}) => {
  const normalizedHeaders = {};
  const requestHeaders = new Headers(headers);
  let hasAcceptEncoding = false;
  let hasContentLength = false;

  requestHeaders.forEach((value, key) => {
    normalizedHeaders[key] = value;

    if (key.toLowerCase() === 'accept-encoding') {
      hasAcceptEncoding = true;
    }

    if (key.toLowerCase() === 'content-length') {
      hasContentLength = true;
    }
  });

  if (!hasAcceptEncoding) {
    normalizedHeaders['accept-encoding'] = 'identity';
  }

  normalizedHeaders.__hasContentLength = hasContentLength;

  return normalizedHeaders;
};

const normalizeExternalResponseHeaders = (headers = {}) => {
  const normalizedHeaders = {};

  Object.entries(headers).forEach(([key, value]) => {
    if (typeof value === 'undefined') {
      return;
    }

    normalizedHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
  });

  return normalizedHeaders;
};

const normalizeExternalRequestBody = (body) => {
  if (typeof body === 'undefined' || body === null) {
    return undefined;
  }

  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  throw new TypeError('Native external HTTP fallback does not support streaming request bodies.');
};

const isRedirectStatus = (statusCode) => {
  return [301, 302, 303, 307, 308].includes(Number(statusCode));
};

const shouldRedirectWithGet = (statusCode, method = 'GET') => {
  const normalizedMethod = String(method ?? 'GET')
    .trim()
    .toUpperCase();

  if (statusCode === 303 && normalizedMethod !== 'HEAD') {
    return true;
  }

  return (statusCode === 301 || statusCode === 302) && normalizedMethod === 'POST';
};

const buildNativeResponse = ({ statusCode = 502, statusMessage = '', headers = {}, bodyBuffer = Buffer.alloc(0) }) => {
  const safeStatusCode =
    Number.isInteger(Number(statusCode)) && Number(statusCode) >= 200 && Number(statusCode) <= 599
      ? Number(statusCode)
      : 502;

  return new Response(bodyBuffer, {
    status: safeStatusCode,
    statusText: String(statusMessage ?? '').trim(),
    headers: normalizeExternalResponseHeaders(headers)
  });
};

const requestExternalBufferViaNativeHttp = async (
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = env.EXTERNAL_REQUEST_TIMEOUT,
    signal,
    requestSignal,
    redirect = 'follow'
  } = {},
  redirectCount = 0
) => {
  const requestUrl = new URL(url);
  const requestMethod = String(method ?? 'GET')
    .trim()
    .toUpperCase();
  const requestHeaders = normalizeExternalRequestHeaders(headers);
  const requestBody = normalizeExternalRequestBody(body);
  const hasContentLengthHeader = Boolean(requestHeaders.__hasContentLength);
  delete requestHeaders.__hasContentLength;

  if (typeof requestBody !== 'undefined' && !hasContentLengthHeader) {
    requestHeaders['content-length'] = Buffer.byteLength(requestBody);
  }

  const activeRequestSignal = requestSignal ?? buildExternalRequestSignal({ timeoutMs, signal });
  const requestClient = requestUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = requestClient.request(
      requestUrl,
      {
        method: requestMethod,
        headers: requestHeaders,
        signal: activeRequestSignal
      },
      (responseMessage) => {
        const chunks = [];

        responseMessage.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        responseMessage.on('error', reject);

        responseMessage.on('end', () => {
          const statusCode = Number(responseMessage.statusCode) || 502;
          const location = String(responseMessage.headers.location ?? '').trim();

          if (redirect === 'error' && isRedirectStatus(statusCode)) {
            reject(new Error(`External request failed because redirect handling is disabled (${statusCode}).`));
            return;
          }

          if (redirect === 'follow' && isRedirectStatus(statusCode) && location) {
            if (redirectCount >= MAX_NATIVE_REDIRECTS) {
              reject(new Error(`External request exceeded ${MAX_NATIVE_REDIRECTS} redirects.`));
              return;
            }

            const redirectedUrl = new URL(location, requestUrl).toString();
            const nextMethod = shouldRedirectWithGet(statusCode, requestMethod) ? 'GET' : requestMethod;
            const nextHeaders = { ...requestHeaders };
            const nextBody = nextMethod === requestMethod ? requestBody : undefined;

            if (!nextBody) {
              delete nextHeaders['content-length'];
              delete nextHeaders['Content-Length'];
              delete nextHeaders['content-type'];
              delete nextHeaders['Content-Type'];
            }

            resolve(
              requestExternalBufferViaNativeHttp(
                redirectedUrl,
                {
                  method: nextMethod,
                  headers: nextHeaders,
                  body: nextBody,
                  timeoutMs,
                  signal,
                  requestSignal: activeRequestSignal,
                  redirect
                },
                redirectCount + 1
              )
            );
            return;
          }

          const responseBuffer = Buffer.concat(chunks);

          resolve({
            response: buildNativeResponse({
              statusCode,
              statusMessage: responseMessage.statusMessage,
              headers: responseMessage.headers,
              bodyBuffer: responseBuffer
            }),
            responseBuffer
          });
        });
      }
    );

    request.on('error', reject);

    if (typeof requestBody !== 'undefined') {
      request.write(requestBody);
    }

    request.end();
  });
};

const requestExternalBuffer = async (
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = env.EXTERNAL_REQUEST_TIMEOUT,
    signal,
    redirect = 'follow'
  } = {}
) => {
  const requestOrigin = resolveExternalOrigin(url);

  if (shouldBypassConfiguredProxy || (requestOrigin && nativeFallbackOrigins.has(requestOrigin))) {
    return requestExternalBufferViaNativeHttp(url, {
      method,
      headers,
      body,
      timeoutMs,
      signal,
      redirect
    });
  }

  const requestOptions = {
    method,
    headers,
    body,
    redirect,
    dispatcher: getExternalDispatcher(),
    signal: buildExternalRequestSignal({ timeoutMs, signal })
  };

  try {
    const response = await undiciFetch(url, requestOptions);
    const responseBuffer = Buffer.from(await response.arrayBuffer());

    return {
      response,
      responseBuffer
    };
  } catch (error) {
    if (!shouldFallbackToNativeHttp(error)) {
      throw error;
    }

    logger.warn('External request switched from undici to native http/https fallback.', {
      url: summarizeExternalUrlForLogs(url),
      method: String(method ?? 'GET')
        .trim()
        .toUpperCase(),
      proxied: hasConfiguredProxy,
      error: describeExternalTransportError(error)
    });

    if (requestOrigin) {
      nativeFallbackOrigins.add(requestOrigin);
    }

    const fallbackResult = await requestExternalBufferViaNativeHttp(url, {
      method,
      headers,
      body,
      timeoutMs,
      signal,
      redirect
    });

    return fallbackResult;
  }
};

const requestExternalText = async (
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = env.EXTERNAL_REQUEST_TIMEOUT,
    signal,
    redirect = 'follow'
  } = {}
) => {
  const { response, responseBuffer } = await requestExternalBuffer(url, {
    method,
    headers,
    body,
    timeoutMs,
    signal,
    redirect
  });
  const responseText = responseBuffer.toString('utf8');

  return {
    response,
    responseText
  };
};

const requestExternalJson = async (
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = env.EXTERNAL_REQUEST_TIMEOUT,
    signal,
    redirect = 'follow'
  } = {}
) => {
  const { response, responseText } = await requestExternalText(url, {
    method,
    headers,
    body,
    timeoutMs,
    signal,
    redirect
  });

  return {
    response,
    responseText,
    responsePayload: (() => {
      if (!responseText) {
        return {};
      }

      try {
        return JSON.parse(responseText);
      } catch (error) {
        const contentType = String(response.headers.get('content-type') ?? '').trim() || 'unknown';
        const responsePreview = responseText
          .replace(/\s+/gu, ' ')
          .trim()
          .slice(0, 240);
        const parseError = new Error(
          `External request expected JSON but received non-JSON response (status ${response.status}, content-type ${contentType}): ${responsePreview || '[empty body]'}`
        );

        parseError.statusCode = response.status;
        parseError.contentType = contentType;
        parseError.responsePreview = responsePreview;
        parseError.cause = error;

        throw parseError;
      }
    })()
  };
};

const downloadExternalBinary = async (
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = env.EXTERNAL_REQUEST_TIMEOUT,
    signal,
    redirect = 'follow'
  } = {}
) => {
  const { response, responseBuffer: fileBuffer } = await requestExternalBuffer(url, {
    method,
    headers,
    body,
    timeoutMs,
    signal,
    redirect
  });

  return {
    response,
    fileBuffer
  };
};

export { requestExternalText, requestExternalJson, downloadExternalBinary, getExternalDispatcher };
