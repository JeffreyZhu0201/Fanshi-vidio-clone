import { create } from 'zustand';

const createInitialAnalysisState = () => ({
  analysis: null,
  loading: false,
  error: '',
  progress: 0,
  status: 'idle',
  statusMessage: '等待分析',
  lastUpdatedAt: null
});

const useAnalysisStore = create((set) => ({
  ...createInitialAnalysisState(),
  setAnalysis: (analysis) =>
    set({
      analysis,
      loading: false,
      error: '',
      progress: 100,
      status: 'completed',
      statusMessage: '整片分析完成',
      lastUpdatedAt: new Date().toISOString()
    }),
  setLoading: (loading) =>
    set((state) => ({
      loading,
      status: loading ? 'processing' : state.status
    })),
  setError: (error) =>
    set({
      error,
      loading: false,
      status: 'failed',
      statusMessage: error || '分析失败',
      lastUpdatedAt: new Date().toISOString()
    }),
  setProgressState: (payload) =>
    set((state) => ({
      progress:
        payload.progress !== undefined ? Math.max(0, Math.min(100, Math.round(payload.progress))) : state.progress,
      status: payload.status ?? state.status,
      statusMessage: payload.message ?? state.statusMessage,
      loading: payload.status ? !['completed', 'failed'].includes(payload.status) : state.loading,
      error: payload.status && payload.status !== 'failed' ? '' : state.error,
      lastUpdatedAt: new Date().toISOString()
    })),
  clearAnalysis: () =>
    set({
      ...createInitialAnalysisState()
    })
}));

export { useAnalysisStore };
