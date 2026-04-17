import { create } from 'zustand';

const BACKEND_STATUSES = new Set(['checking', 'online', 'degraded', 'offline']);

const useAppStore = create((set) => ({
  backendStatus: 'checking',
  errorMessage: '',
  lastCheckedAt: null,
  realtimeStatus: 'idle',
  setBackendStatus: (status, message = '') =>
    set({
      backendStatus: BACKEND_STATUSES.has(status) ? status : 'checking',
      errorMessage: message,
      lastCheckedAt: new Date().toISOString()
    }),
  setBackendError: (message) =>
    set({
      backendStatus: 'offline',
      errorMessage: message,
      lastCheckedAt: new Date().toISOString()
    }),
  setRealtimeStatus: (realtimeStatus) =>
    set({
      realtimeStatus
    })
}));

export { useAppStore };
