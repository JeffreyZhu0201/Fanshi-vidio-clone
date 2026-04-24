import { create } from 'zustand';

const createInitialAnalysisState = () => ({
  analysis: null,
  analysisOptions: {
    extractSubtitles: true,
    parseAudio: true
  },
  loading: false,
  error: '',
  progress: 0,
  status: 'idle',
  statusMessage: '等待分析',
  lastUpdatedAt: null
});

const buildResetAnalysisState = () => ({
  ...createInitialAnalysisState()
});

const useAnalysisStore = create((set) => ({
  ...createInitialAnalysisState(),
  setAnalysis: (analysis) =>
    set({
      analysis,
      analysisOptions: {
        extractSubtitles:
          typeof (analysis?.analysis_options?.extractSubtitles ?? analysis?.analysis_options?.extract_subtitles) === 'boolean'
            ? Boolean(analysis?.analysis_options?.extractSubtitles ?? analysis?.analysis_options?.extract_subtitles)
            : true,
        parseAudio:
          typeof (analysis?.analysis_options?.parseAudio ?? analysis?.analysis_options?.parse_audio) === 'boolean'
            ? Boolean(analysis?.analysis_options?.parseAudio ?? analysis?.analysis_options?.parse_audio)
            : true
      },
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
  setAnalysisOptions: (analysisOptions) =>
    set((state) => ({
      analysisOptions: {
        ...state.analysisOptions,
        extractSubtitles:
          typeof analysisOptions?.extractSubtitles === 'boolean'
            ? analysisOptions.extractSubtitles
            : state.analysisOptions.extractSubtitles,
        parseAudio:
          typeof analysisOptions?.parseAudio === 'boolean'
            ? analysisOptions.parseAudio
            : state.analysisOptions.parseAudio
      },
      lastUpdatedAt: new Date().toISOString()
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
  resetAnalysisState: () =>
    set({
      ...buildResetAnalysisState()
    }),
  clearAnalysis: () =>
    set({
      ...buildResetAnalysisState()
    })
}));

export { useAnalysisStore };
