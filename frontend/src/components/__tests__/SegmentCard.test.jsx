import { fireEvent, render, screen } from '@testing-library/react';

import SegmentCard from '../SegmentCard.jsx';

const segmentFixture = {
  id: 1,
  segmentIndex: 0,
  startTime: 0,
  endTime: 4,
  sourceUrl: 'https://example.com/source.mp4',
  generatedUrl: '',
  scene: '主角进入咖啡馆',
  action: '向室内走去',
  prompt: '@主角 走进咖啡馆并观察周围',
  characters: ['主角'],
  highlightedPrompt: '',
  latestGenerationTask: {
    status: 'completed',
    progress: 100
  }
};

describe('SegmentCard', () => {
  it('renders segment data and exposes actions', () => {
    const onPromptChange = jest.fn();
    const onAnalyze = jest.fn();
    const onOptimize = jest.fn();
    const onGenerate = jest.fn();

    render(
      <SegmentCard
        segment={segmentFixture}
        overallAnalysis={{
          plot: '主角在咖啡馆推进剧情',
          characters: [{ name: '主角', appearancePrompt: '黑色短发，米色风衣，镜头感强' }]
        }}
        onPromptChange={onPromptChange}
        onAnalyze={onAnalyze}
        onOptimize={onOptimize}
        onGenerate={onGenerate}
        isAnalyzing={false}
        isOptimizing={false}
        isGenerating={false}
      />
    );

    expect(screen.getAllByText('主角进入咖啡馆').length).toBeGreaterThan(0);
    expect(screen.getAllByText('@主角').length).toBeGreaterThan(0);
    expect(screen.getByText('片段理解提示词')).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText('在这里编辑片段提示词，使用 @角色名 来保持人物设定一致。'),
      {
        target: {
          value: '@主角 在室内继续推进剧情'
        }
      }
    );

    expect(onPromptChange).toHaveBeenCalledWith(1, '@主角 在室内继续推进剧情');

    fireEvent.click(screen.getByRole('button', { name: '片段分析' }));
    fireEvent.click(screen.getByRole('button', { name: '优化提示词' }));
    fireEvent.click(screen.getByRole('button', { name: '生成片段' }));

    expect(onAnalyze).toHaveBeenCalledWith(1);
    expect(onOptimize).toHaveBeenCalledWith(1, '@主角 在室内继续推进剧情');
    expect(onGenerate).toHaveBeenCalledWith(1, '@主角 在室内继续推进剧情');
  });
});
