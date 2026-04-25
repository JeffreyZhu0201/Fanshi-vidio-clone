import { create } from 'zustand';

import {
  DEFAULT_STYLE_MODE,
  getEditableStyleTemplateDefaults,
  normalizeStyleMode
} from '../../../shared/styleTemplates.js';

const createInitialAnalysisState = () => ({
  analysis: null,
  analysisOptions: {
    extractSubtitles: true,
    parseAudio: true,
    styleMode: DEFAULT_STYLE_MODE,
    styleTemplates: getEditableStyleTemplateDefaults()
  },
  loading: false,
  error: '',
  progress: 0,
  status: 'idle',
  statusMessage: '等待分析',
  lastUpdatedAt: null
});

const normalizeAnalysisOptionsForStore = (analysisOptions = null) => {
  const nextStyleTemplates = getEditableStyleTemplateDefaults();
  const inputStyleTemplates = analysisOptions?.styleTemplates ?? analysisOptions?.style_templates ?? null;

  Object.keys(nextStyleTemplates).forEach((styleMode) => {
    Object.keys(nextStyleTemplates[styleMode]).forEach((templateKey) => {
      if (inputStyleTemplates?.[styleMode] && Object.prototype.hasOwnProperty.call(inputStyleTemplates[styleMode], templateKey)) {
        nextStyleTemplates[styleMode][templateKey] = String(inputStyleTemplates[styleMode][templateKey] ?? '');
      }
    });
  });

  return {
    extractSubtitles:
      typeof (analysisOptions?.extractSubtitles ?? analysisOptions?.extract_subtitles) === 'boolean'
        ? Boolean(analysisOptions?.extractSubtitles ?? analysisOptions?.extract_subtitles)
        : true,
    parseAudio:
      typeof (analysisOptions?.parseAudio ?? analysisOptions?.parse_audio) === 'boolean'
        ? Boolean(analysisOptions?.parseAudio ?? analysisOptions?.parse_audio)
        : true,
    styleMode: normalizeStyleMode(analysisOptions?.styleMode ?? analysisOptions?.style_mode ?? DEFAULT_STYLE_MODE),
    styleTemplates: nextStyleTemplates
  };
};

const buildResetAnalysisState = () => ({
  ...createInitialAnalysisState()
});

const useAnalysisStore = create((set) => ({
  ...createInitialAnalysisState(),
  setAnalysis: (analysis) =>
    set({
      analysis,
      analysisOptions: normalizeAnalysisOptionsForStore(analysis?.analysis_options ?? analysis?.analysisOptions ?? null),
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
      analysisOptions: normalizeAnalysisOptionsForStore({
        ...state.analysisOptions,
        ...analysisOptions,
        styleTemplates: analysisOptions?.styleTemplates
          ? {
              ...state.analysisOptions.styleTemplates,
              ...analysisOptions.styleTemplates,
              realistic: {
                ...state.analysisOptions.styleTemplates.realistic,
                ...(analysisOptions.styleTemplates.realistic ?? {})
              },
              comic_drama: {
                ...state.analysisOptions.styleTemplates.comic_drama,
                ...(analysisOptions.styleTemplates.comic_drama ?? {})
              }
            }
          : state.analysisOptions.styleTemplates
      }),
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

export { normalizeAnalysisOptionsForStore, useAnalysisStore };
