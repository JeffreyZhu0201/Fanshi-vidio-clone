import { fetch as undiciFetch, EnvHttpProxyAgent } from 'undici';

import env from '../config/env.js';

const hasConfiguredProxy = Boolean(
  String(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || '').trim()
);

const sharedDispatcher = hasConfiguredProxy ? new EnvHttpProxyAgent() : null;

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
  const response = await undiciFetch(url, {
    method,
    headers,
    body,
    redirect,
    dispatcher: getExternalDispatcher(),
    signal: buildExternalRequestSignal({ timeoutMs, signal })
  });
  const responseText = await response.text();

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
    responsePayload: responseText ? JSON.parse(responseText) : {}
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
  const response = await undiciFetch(url, {
    method,
    headers,
    body,
    redirect,
    dispatcher: getExternalDispatcher(),
    signal: buildExternalRequestSignal({ timeoutMs, signal })
  });
  const fileBuffer = Buffer.from(await response.arrayBuffer());

  return {
    response,
    fileBuffer
  };
};

export { requestExternalText, requestExternalJson, downloadExternalBinary, getExternalDispatcher };
