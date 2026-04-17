import { useEffect } from 'react';

import { checkHealth } from '../services/api.js';
import { useAppStore } from '../store/appStore.js';
import { websocketService } from '../services/websocket.js';

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
        await checkHealth();

        if (active) {
          setBackendStatus('online');
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
