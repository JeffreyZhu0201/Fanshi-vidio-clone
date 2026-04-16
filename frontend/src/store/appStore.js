import { create } from 'zustand';

const useAppStore = create((set) => ({
  backendStatus: 'checking',
  errorMessage: '',
  lastCheckedAt: null,
  setBackendStatus: (status) =>
    set({
      backendStatus: status,
      errorMessage: '',
      lastCheckedAt: new Date().toISOString()
    }),
  setBackendError: (message) =>
    set({
      backendStatus: 'offline',
      errorMessage: message,
      lastCheckedAt: new Date().toISOString()
    })
}));

export { useAppStore };

