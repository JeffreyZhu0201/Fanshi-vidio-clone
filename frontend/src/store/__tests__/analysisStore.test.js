import { useAnalysisStore } from '../analysisStore.js';

const resetAnalysisStore = () => {
  useAnalysisStore.getState().clearAnalysis();
};

describe('analysisStore', () => {
  beforeEach(() => {
    resetAnalysisStore();
  });

  it('preserves locally edited analysis options during passive analysis hydration', () => {
    useAnalysisStore.getState().setAnalysisOptions({
      styleTemplates: {
        realistic: {
          videoAnalysisStylePrompt: '本地未提交的整片风格草稿'
        }
      }
    });

    useAnalysisStore.getState().hydrateAnalysis({
      id: 101,
      analysis_options: {
        extractSubtitles: false,
        parseAudio: false,
        styleMode: 'realistic',
        styleTemplates: {
          realistic: {
            videoAnalysisStylePrompt: '服务端旧值'
          }
        }
      }
    });

    const state = useAnalysisStore.getState();

    expect(state.analysis?.id).toBe(101);
    expect(state.analysisOptions.styleTemplates.realistic.videoAnalysisStylePrompt).toBe(
      '本地未提交的整片风格草稿'
    );
  });

  it('replaces local drafts with authoritative server options after a fresh analysis result arrives', () => {
    useAnalysisStore.getState().setAnalysisOptions({
      styleTemplates: {
        realistic: {
          videoAnalysisStylePrompt: '本地旧草稿'
        }
      }
    });

    useAnalysisStore.getState().setAnalysis({
      id: 202,
      analysis_options: {
        extractSubtitles: true,
        parseAudio: true,
        styleMode: 'realistic',
        styleTemplates: {
          realistic: {
            videoAnalysisStylePrompt: '最新服务端结果'
          }
        }
      }
    });

    const state = useAnalysisStore.getState();

    expect(state.analysis?.id).toBe(202);
    expect(state.analysisOptionsDirty).toBe(false);
    expect(state.analysisOptions.styleTemplates.realistic.videoAnalysisStylePrompt).toBe('最新服务端结果');
  });
});
