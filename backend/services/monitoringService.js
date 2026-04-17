import logger from '../utils/logger.js';
import { recordMonitoringEvent } from './metricsService.js';

const summarizePayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const summary = {};

  ['name', 'value', 'message', 'type', 'reason'].forEach((key) => {
    if (payload[key] !== undefined) {
      summary[key] = payload[key];
    }
  });

  return Object.keys(summary).length > 0 ? summary : null;
};

const recordFrontendMonitoringEvent = async ({
  type,
  payload = {},
  url = '',
  userAgent = '',
  recordedAt
}) => {
  const normalizedType = type.trim();
  const receivedAt = new Date().toISOString();

  recordMonitoringEvent({
    type: normalizedType
  });

  logger.info('Frontend monitoring event received', {
    monitoringType: normalizedType,
    recordedAt,
    receivedAt,
    url,
    userAgent: userAgent ? userAgent.slice(0, 160) : '',
    payload: summarizePayload(payload)
  });

  return {
    accepted: true,
    type: normalizedType,
    received_at: receivedAt
  };
};

export { recordFrontendMonitoringEvent };
