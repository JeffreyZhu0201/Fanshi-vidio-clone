import { fireEvent, render, screen } from '@testing-library/react';

import AnalysisDisplay from '../AnalysisDisplay.jsx';

const analysisFixture = {
  plot: '主角走进咖啡馆，观察周围环境后坐下。',
  characters: [
    {
      id: 'char-1',
      name: '主角',
      appearance_prompt: '黑色短发，穿米色风衣，镜头感强'
    }
  ],
  backgrounds: ['暖黄色灯光的咖啡馆内部，木质桌椅与玻璃窗。'],
  time_anchors: [
    {
      startTime: 0,
      endTime: 3.5,
      sceneSummary: '主角走入咖啡馆'
    }
  ],
  provider: 'remote-gemini',
  model: 'gemini-3.1-pro-preview',
  auth_variant: 'bearer',
  is_mock: false,
  fallback_reason: '',
  remote_error: ''
};

describe('AnalysisDisplay', () => {
  it('renders analysis data and triggers actions', () => {
    const onAnalyze = jest.fn();
    const onSplit = jest.fn();

    render(
      <AnalysisDisplay
        video={{ id: 1, filename: 'demo.mp4', duration: 15 }}
        analysis={analysisFixture}
        loading={false}
        error=""
        progress={100}
        status="completed"
        statusMessage="整片分析完成"
        splitProgress={{ status: 'idle', progress: 0, message: '' }}
        onAnalyze={onAnalyze}
        onSplit={onSplit}
      />
    );

    expect(screen.getByText('剧情摘要')).toBeInTheDocument();
    expect(screen.getByText('主角走进咖啡馆，观察周围环境后坐下。')).toBeInTheDocument();
    expect(screen.getByText('主角')).toBeInTheDocument();
    expect(screen.getByText('暖黄色灯光的咖啡馆内部，木质桌椅与玻璃窗。')).toBeInTheDocument();
    expect(screen.getByText('整片分析提示词')).toBeInTheDocument();
    expect(screen.getByText('Gemini真实结果')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重新分析' }));
    fireEvent.click(screen.getByRole('button', { name: '生成片段' }));

    expect(onAnalyze).toHaveBeenCalled();
    expect(onSplit).toHaveBeenCalled();
  });

  it('shows fallback warning when backend returns mock analysis', () => {
    render(
      <AnalysisDisplay
        video={{ id: 1, filename: 'demo.mp4', duration: 15 }}
        analysis={{
          ...analysisFixture,
          is_mock: true,
          provider: 'mock-gemini',
          fallback_reason: 'remote_error',
          remote_error: 'Gemini request failed with status 429: quota exhausted'
        }}
        loading={false}
        error=""
        progress={100}
        status="completed"
        statusMessage="整片分析完成"
        splitProgress={{ status: 'idle', progress: 0, message: '' }}
        onAnalyze={jest.fn()}
        onSplit={jest.fn()}
      />
    );

    expect(screen.getByText('Gemini失败已回退')).toBeInTheDocument();
    expect(screen.getByText(/Gemini 真实分析失败/)).toBeInTheDocument();
    expect(screen.getByText(/鉴权方式：bearer/)).toBeInTheDocument();
    expect(screen.getAllByText(/429/)).toHaveLength(2);
  });
});
