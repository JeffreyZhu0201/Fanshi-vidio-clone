import { create } from 'zustand';

const BACKEND_STATUSES = new Set(['checking', 'online', 'degraded', 'offline']);
const defaultProviderStatuses = Object.freeze({
  seedance: {
    ready: false,
    reason: '',
    allowMockFallback: false,
    model: ''
  },
  geminiImage: {
    ready: false,
    reason: '',
    model: ''
  }
});

const useAppStore = create((set) => ({
  backendStatus: 'checking',
  errorMessage: '',
  lastCheckedAt: null,
  realtimeStatus: 'idle',
  providerStatuses: defaultProviderStatuses,
  setBackendStatus: (status, message = '', providerStatuses = defaultProviderStatuses) =>
    set({
      backendStatus: BACKEND_STATUSES.has(status) ? status : 'checking',
      errorMessage: message,
      providerStatuses,
      lastCheckedAt: new Date().toISOString()
    }),
  setBackendError: (message) =>
    set({
      backendStatus: 'offline',
      errorMessage: message,
      lastCheckedAt: new Date().toISOString()
    }),
  setProviderStatuses: (providerStatuses) =>
    set({
      providerStatuses: providerStatuses || defaultProviderStatuses
    }),
  setRealtimeStatus: (realtimeStatus) =>
    set({
      realtimeStatus
    })
}));

export { useAppStore };
