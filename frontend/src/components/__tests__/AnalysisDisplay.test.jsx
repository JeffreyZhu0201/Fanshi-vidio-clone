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
  ]
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

    fireEvent.click(screen.getByRole('button', { name: '重新分析' }));
    fireEvent.click(screen.getByRole('button', { name: '生成片段' }));

    expect(onAnalyze).toHaveBeenCalled();
    expect(onSplit).toHaveBeenCalled();
  });
});
