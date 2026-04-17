import { useEffect } from 'react';

import { checkHealth } from '../services/api.js';
import { useAppStore } from '../store/appStore.js';
import { websocketService } from '../services/websocket.js';

const resolveBackendHealthState = (payload = {}) => {
  if (payload?.status === 'degraded' || payload?.database?.connected === false) {
    return {
      status: 'degraded',
      message: payload?.database?.errorMessage || '数据库连接不可用，后端当前处于降级状态。'
    };
  }

  if (payload?.status === 'ok' || payload?.success) {
    return {
      status: 'online',
      message: ''
    };
  }

  return {
    status: 'checking',
    message: ''
  };
};

const useAppHealth = () => {
  const backendStatus = useAppStore((state) => state.backendStatus);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const lastCheckedAt = useAppStore((state) => state.lastCheckedAt);
  const realtimeStatus = useAppStore((state) => state.realtimeStatus);
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
          setBackendStatus(nextHealthState.status, nextHealthState.message);
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
    realtimeStatus
  };
};

export { useAppHealth };
