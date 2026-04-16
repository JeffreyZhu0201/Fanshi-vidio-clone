import { useEffect } from 'react';

import { checkHealth } from '../services/api.js';
import { useAppStore } from '../store/appStore.js';

const useAppHealth = () => {
  const backendStatus = useAppStore((state) => state.backendStatus);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const lastCheckedAt = useAppStore((state) => state.lastCheckedAt);
  const setBackendStatus = useAppStore((state) => state.setBackendStatus);
  const setBackendError = useAppStore((state) => state.setBackendError);

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

    return () => {
      active = false;
    };
  }, [setBackendError, setBackendStatus]);

  return {
    backendStatus,
    errorMessage,
    lastCheckedAt
  };
};

export { useAppHealth };

