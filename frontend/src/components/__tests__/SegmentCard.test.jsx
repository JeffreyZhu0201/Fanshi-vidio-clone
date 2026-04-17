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
    const onOptimize = jest.fn();
    const onGenerate = jest.fn();

    render(
      <SegmentCard
        segment={segmentFixture}
        onPromptChange={onPromptChange}
        onOptimize={onOptimize}
        onGenerate={onGenerate}
        isOptimizing={false}
        isGenerating={false}
      />
    );

    expect(screen.getByText('主角进入咖啡馆')).toBeInTheDocument();
    expect(screen.getAllByText('@主角').length).toBeGreaterThan(0);

    fireEvent.change(
      screen.getByPlaceholderText('在这里编辑片段提示词，使用 @角色名 来保持人物设定一致。'),
      {
        target: {
          value: '@主角 在室内继续推进剧情'
        }
      }
    );

    expect(onPromptChange).toHaveBeenCalledWith(1, '@主角 在室内继续推进剧情');

    fireEvent.click(screen.getByRole('button', { name: '优化提示词' }));
    fireEvent.click(screen.getByRole('button', { name: '生成片段' }));

    expect(onOptimize).toHaveBeenCalledWith(1);
    expect(onGenerate).toHaveBeenCalledWith(1);
  });
});
