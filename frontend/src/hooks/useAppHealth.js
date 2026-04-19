import { useEffect } from 'react';

import { checkHealth } from '../services/api.js';
import { useAppStore } from '../store/appStore.js';
import { websocketService } from '../services/websocket.js';

const normalizeProviderStatuses = (payload = {}) => {
  const providers = payload?.providers ?? {};

  return {
    seedance: {
      ready: Boolean(providers?.seedance?.ready),
      reason: String(providers?.seedance?.reason ?? '').trim(),
      allowMockFallback: Boolean(providers?.seedance?.allow_mock_fallback),
      model: String(providers?.seedance?.model ?? '').trim()
    },
    geminiImage: {
      ready: Boolean(providers?.gemini_image?.ready),
      reason: String(providers?.gemini_image?.reason ?? '').trim(),
      model: String(providers?.gemini_image?.model ?? '').trim()
    }
  };
};

const resolveBackendHealthState = (payload = {}) => {
  const providerStatuses = normalizeProviderStatuses(payload);

  if (payload?.status === 'degraded' || payload?.database?.connected === false) {
    return {
      status: 'degraded',
      message: payload?.database?.errorMessage || '数据库连接不可用，后端当前处于降级状态。',
      providerStatuses
    };
  }

  if (payload?.status === 'ok' || payload?.success) {
    return {
      status: 'online',
      message: '',
      providerStatuses
    };
  }

  return {
    status: 'checking',
    message: '',
    providerStatuses
  };
};

const useAppHealth = () => {
  const backendStatus = useAppStore((state) => state.backendStatus);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const lastCheckedAt = useAppStore((state) => state.lastCheckedAt);
  const realtimeStatus = useAppStore((state) => state.realtimeStatus);
  const providerStatuses = useAppStore((state) => state.providerStatuses);
  const setBackendStatus = useAppStore((state) => state.setBackendStatus);
  const setBackendError = useAppStore((state) => state.setBackendError);
  const setRealtimeStatus = useAppStore((state) => state.setRealtimeStatus);

  useEffect(() => {
    let active = true;

    const runHealthCheck = async () => {
      try {
        const healthPayload = await checkHealth();
        const nextHealthState = resolveBackendHealthState(healthPayload);

        if (active) {
          setBackendStatus(
            nextHealthState.status,
            nextHealthState.message,
            nextHealthState.providerStatuses
          );
        }
      } catch (error) {
        if (active) {
          setBackendError(error.message);
        }
      }
    };

    void runHealthCheck();
    const timer = window.setInterval(() => {
      void runHealthCheck();
    }, 30000);

    const unsubscribeRealtimeStatus = websocketService.subscribe('ws:status', (payload) => {
      if (active && payload?.status) {
        setRealtimeStatus(payload.status);
      }
    });

    const unsubscribeRealtimeError = websocketService.subscribe('ws:error', () => {
      if (active) {
        setRealtimeStatus('fallback');
      }
    });

    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribeRealtimeStatus();
      unsubscribeRealtimeError();
    };
  }, [setBackendError, setBackendStatus, setRealtimeStatus]);

  useEffect(() => {
    setRealtimeStatus('checking');
  }, [setRealtimeStatus]);

  return {
    backendStatus,
    errorMessage,
    lastCheckedAt,
    realtimeStatus,
    providerStatuses
  };
};

export { useAppHealth };
