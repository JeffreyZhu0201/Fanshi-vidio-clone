import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
  backgroundName: '咖啡馆内景',
  backgroundAction: 'create_new',
  representativeFrameTime: 1.2,
  highlightedPrompt: '',
  shots: [
    {
      id: 'shot-1',
      shotIndex: 0,
      startTime: 0,
      endTime: 2,
      localStartTime: 0,
      localEndTime: 2,
      durationSeconds: 2,
      summary: '主角推门进入咖啡馆',
      prompt: '@主角 推门走进 #咖啡馆内景',
      sceneNames: ['咖啡馆内景'],
      characterNames: ['主角'],
      representativeFrameTime: 1,
      representativeFrameNote: '主角进门时的典型画面',
      sourceFilePath: 'shots/shot-1.mp4',
      sourceFileUrl: 'https://example.com/source-shot-1.mp4',
      sourceLocalStartTime: 0,
      sourceLocalEndTime: 2,
      representativeFrameImagePath: 'frames/shot-1.jpg',
      representativeFrameImageUrl: 'https://example.com/shot-1-frame.jpg',
      representativeFrameActualTime: 1,
      generatedUrl: 'https://example.com/shot-1.mp4',
      latestGenerationTask: {
        status: 'completed',
        sent_reference_images: [
          {
            label: '小镜头典型帧',
            source_kind: 'shot_representative_frame'
          },
          {
            label: '@主角 三视图',
            source_kind: 'character_asset'
          }
        ],
        sent_reference_videos: [
          {
            label: '小镜头源视频',
            source_kind: 'source_video'
          }
        ]
      },
      latestCompletedGenerationTask: {
        task_id: 'shot-task-1',
        status: 'completed'
      }
    }
  ],
  shotGenerationSummary: {
    status: 'completed',
    progress: 100,
    total_shot_count: 1,
    completed_shot_count: 1,
    result_url: 'https://example.com/assembled.mp4'
  },
  latestGenerationTask: {
    status: 'completed',
    progress: 100,
    sent_reference_images: [
      {
        label: '@主角 三视图',
        source_kind: 'character_asset'
      },
      {
        label: '#咖啡馆内景 场景图',
        source_kind: 'scene_asset'
      }
    ]
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
    const onShotPromptChange = jest.fn();
    const onOptimizeShot = jest.fn().mockResolvedValue({
      optimized_prompt: '@主角 在 #咖啡馆内景 中警觉地环视四周'
    });
    const onGenerateShot = jest.fn();
    const onGenerateAllShots = jest.fn();
    const onSaveShots = jest.fn().mockImplementation(async (segmentId, shots) => ({
      analysis: {
        shots: shots.map((shot, index) => ({
          ...shot,
          id: String(shot.id).startsWith('temp-shot-') ? `saved-shot-${index + 1}` : shot.id,
          shotIndex: index,
          localStartTime: Number(shot.startTime) - segmentFixture.startTime,
          localEndTime: Number(shot.endTime) - segmentFixture.startTime,
          durationSeconds: Number((Number(shot.endTime) - Number(shot.startTime)).toFixed(2)),
          sourceFilePath: `shots/saved-shot-${index + 1}.mp4`,
          sourceFileUrl: `https://example.com/saved-shot-${index + 1}.mp4`,
          sourceLocalStartTime: Number(shot.startTime) - segmentFixture.startTime,
          sourceLocalEndTime: Number(shot.endTime) - segmentFixture.startTime,
          representativeFrameImagePath: `frames/saved-shot-${index + 1}.jpg`,
          representativeFrameImageUrl: `https://example.com/saved-shot-${index + 1}.jpg`,
          representativeFrameActualTime: Number(
            ((Number(shot.representativeFrameTime ?? shot.startTime) || Number(shot.startTime)) - Number(shot.startTime)).toFixed(2)
          )
        }))
      }
    }));

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
        onShotPromptChange={onShotPromptChange}
        onAnalyze={onAnalyze}
        onOptimize={onOptimize}
        onOptimizeShot={onOptimizeShot}
        onGenerate={onGenerate}
        onGenerateShot={onGenerateShot}
        onGenerateAllShots={onGenerateAllShots}
        onSaveShots={onSaveShots}
        isAnalyzing={false}
        isOptimizing={false}
        isGenerating={false}
      />
    );

    expect(screen.getByText('大片段最终提示词')).toBeInTheDocument();
    expect(screen.getByText('小镜头卡列')).toBeInTheDocument();
    expect(screen.getAllByText('@主角').length).toBeGreaterThan(0);
    expect(screen.getByText('新片段预览')).toBeInTheDocument();
    expect(screen.getByText('新小镜头预览')).toBeInTheDocument();
    expect(screen.getByText('源镜头预览')).toBeInTheDocument();
    expect(screen.getByAltText('镜头 01 典型帧')).toBeInTheDocument();
    expect(screen.getAllByText('小镜头典型帧').length).toBeGreaterThan(0);
    expect(screen.getAllByText('@主角 三视图').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '生成新片段' }));
    expect(onGenerateAllShots).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByText('整片分析原始大片段内容')).toBeInTheDocument();
    expect(screen.getByText('片段理解提示词')).toBeInTheDocument();
    expect(screen.getByText('新增镜头')).toBeInTheDocument();
    expect(screen.getByText('保存镜头')).toBeInTheDocument();
    expect(screen.getByText(/片段局部 0\.00 - 2\.00 秒/)).toBeInTheDocument();

    const segmentEditor = screen.getByLabelText('片段提示词编辑器');
    fireEvent.change(segmentEditor, {
      target: {
        value: '@主角 在 #咖啡馆内景 中继续推进剧情'
      }
    });

    expect(onPromptChange).toHaveBeenCalledWith(1, '@主角 在 #咖啡馆内景 中继续推进剧情');

    fireEvent.click(screen.getByRole('button', { name: '片段分析' }));
    fireEvent.click(screen.getAllByRole('button', { name: '优化大片段提示词' })[0]);
    fireEvent.click(screen.getByText('角色与场景展开后的最终生成提示词'));
    expect(screen.getAllByText(/暖黄色咖啡馆内景，木质桌椅，玻璃窗反光/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '直接生成整段' }));

    expect(onAnalyze).toHaveBeenCalledWith(1);
    expect(onOptimize).toHaveBeenCalledWith(1, '@主角 在 #咖啡馆内景 中继续推进剧情');
    expect(onGenerate).toHaveBeenCalledWith(1, '@主角 在 #咖啡馆内景 中继续推进剧情');

    fireEvent.click(screen.getByRole('button', { name: '优化镜头提示词' }));
    expect(onOptimizeShot).toHaveBeenCalledWith({
      segmentId: 1,
      shotId: 'shot-1',
      promptOverride: '@主角 推门走进 #咖啡馆内景',
      segmentPromptOverride: '@主角 在 #咖啡馆内景 中继续推进剧情',
      sceneNames: ['咖啡馆内景'],
      characterNames: ['主角']
    });

    fireEvent.click(screen.getByRole('button', { name: '生成当前镜头' }));
    return waitFor(() => {
      expect(onGenerateShot).toHaveBeenCalledWith(1, 'shot-1', '@主角 推门走进 #咖啡馆内景');
    }).then(async () => {
      expect(onSaveShots).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: '新增镜头' }));
      const shotCards = screen.getAllByText(/镜头 \d+/);
      expect(shotCards.length).toBeGreaterThan(1);

      const summaryInputs = screen.getAllByPlaceholderText('描述当前小镜头发生了什么');
      const promptEditors = screen.getAllByPlaceholderText('编辑当前镜头最终提示词，支持 @角色名 和 #场景名');
      fireEvent.change(summaryInputs[1], { target: { value: '新增镜头摘要' } });
      fireEvent.change(promptEditors[1], { target: { value: '@主角 在 #咖啡馆内景 中落座' } });

      fireEvent.click(screen.getAllByRole('button', { name: '生成当前镜头' })[1]);

      await waitFor(() => {
        expect(onSaveShots).toHaveBeenCalledTimes(1);
        expect(onGenerateShot).toHaveBeenCalledWith(1, 'saved-shot-2', '@主角 在 #咖啡馆内景 中落座');
      });

      const secondSavePayload = onSaveShots.mock.calls[0][1];
      expect(secondSavePayload).toHaveLength(2);
      expect(secondSavePayload[1].summary).toBe('新增镜头摘要');
      expect(secondSavePayload[1].prompt).toBe('@主角 在 #咖啡馆内景 中落座');

      fireEvent.click(screen.getByRole('button', { name: '一键生成全部镜头' }));

      await waitFor(() => {
        expect(onGenerateAllShots).toHaveBeenCalledWith(
          1,
          expect.arrayContaining([
            expect.objectContaining({
              id: 'shot-1'
            }),
            expect.objectContaining({
              id: 'saved-shot-2',
              prompt: '@主角 在 #咖啡馆内景 中落座'
            })
          ])
        );
      });

      expect(onSaveShots).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: '保存镜头' }));

      await waitFor(() => {
        expect(onSaveShots).toHaveBeenCalledTimes(1);
      });
    });
  });
});
