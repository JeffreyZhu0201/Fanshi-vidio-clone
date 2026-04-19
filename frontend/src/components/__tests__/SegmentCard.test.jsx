import { fireEvent, render, screen } from '@testing-library/react';

import SegmentCard from '../SegmentCard.jsx';
import { useAppStore } from '../../store/appStore.js';

const segmentFixture = {
  id: 1,
  segmentIndex: 0,
  startTime: 0,
  endTime: 4,
  sourceUrl: 'https://example.com/source.mp4',
  generatedUrl: '',
  scene: '主角进入咖啡馆',
  action: '向室内走去',
  prompt: '@主角 在 #咖啡馆内景 中观察周围',
  characters: ['主角'],
  scenes: ['咖啡馆内景'],
  highlightedPrompt: '',
  latestGenerationTask: {
    status: 'completed',
    progress: 100
  }
};

describe('SegmentCard', () => {
  beforeEach(() => {
    useAppStore.setState({
      providerStatuses: {
        seedance: {
          ready: true,
          reason: '',
          allowMockFallback: false,
          model: 'doubao-seedance-2-0-260128'
        },
        geminiImage: {
          ready: true,
          reason: '',
          model: 'gemini-3-pro-image-preview'
        }
      }
    });
  });

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
          characters: [{ name: '主角', appearancePrompt: '黑色短发，米色风衣，镜头感强' }],
          backgrounds: [
            {
              id: 'scene-1',
              name: '咖啡馆内景',
              scenePrompt: '暖黄色咖啡馆内景，木质桌椅，玻璃窗反光，景深柔和。'
            }
          ]
        }}
        timeAnchor={{
          sceneSummary: '主角进入咖啡馆',
          scenePrompt: '暖黄色咖啡馆内景，主角推门进入，镜头缓慢推进。',
          scenes: ['咖啡馆内景'],
          representativeFrameTime: 1.8
        }}
        expanded
        onToggle={jest.fn()}
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
    expect(screen.getByText('最终提示词')).toBeInTheDocument();
    expect(screen.getByText('整片分析原始内容')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '编辑提示词' }));
    expect(screen.getByText('片段理解提示词')).toBeInTheDocument();
    expect(screen.getByText('片段典型帧')).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText('在这里编辑片段提示词，使用 @角色名 和 #场景名 来保持资源一致。'),
      {
        target: {
          value: '@主角 在 #咖啡馆内景 中继续推进剧情'
        }
      }
    );

    expect(onPromptChange).toHaveBeenCalledWith(1, '@主角 在 #咖啡馆内景 中继续推进剧情');

    fireEvent.click(screen.getByRole('button', { name: '片段分析' }));
    fireEvent.click(screen.getByRole('button', { name: '优化提示词' }));
    fireEvent.click(screen.getByText('角色与场景展开后的最终生成提示词'));
    expect(screen.getAllByText(/暖黄色咖啡馆内景，木质桌椅，玻璃窗反光/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '生成片段' }));

    expect(onAnalyze).toHaveBeenCalledWith(1);
    expect(onOptimize).toHaveBeenCalledWith(1, '@主角 在 #咖啡馆内景 中继续推进剧情');
    expect(onGenerate).toHaveBeenCalledWith(1, '@主角 在 #咖啡馆内景 中继续推进剧情');
  });
});
