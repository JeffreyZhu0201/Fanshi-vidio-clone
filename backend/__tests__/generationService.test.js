import { jest } from '@jest/globals';

const listCompletedResourceImageAssetsByResourceKeysMock = jest.fn();

await jest.unstable_mockModule('../models/index.js', () => ({
  Analysis: class Analysis {},
  GenerationTask: class GenerationTask {},
  Segment: class Segment {},
  Video: class Video {}
}));

await jest.unstable_mockModule('../middleware/errorHandler.js', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode = 500, details = {}) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
    }
  }
}));

await jest.unstable_mockModule('../config/constants.js', () => ({
  TASK_STATUS: {
    pending: 'pending',
    processing: 'processing',
    completed: 'completed',
    failed: 'failed'
  }
}));

await jest.unstable_mockModule('../services/backgroundAssetService.js', () => ({
  ensureBackgroundAsset: jest.fn()
}));

await jest.unstable_mockModule('../services/resourceImageService.js', () => ({
  listCompletedResourceImageAssetsByResourceKeys: listCompletedResourceImageAssetsByResourceKeysMock
}));

await jest.unstable_mockModule('../services/seedDanceService.js', () => ({
  assertSeedDanceReady: jest.fn(),
  generateSegment: jest.fn(),
  resumeRemoteGenerationTask: jest.fn()
}));

await jest.unstable_mockModule('../services/fileService.js', () => ({
  resolveUploadPath: jest.fn((value) => value),
  toAbsolutePublicUploadUrl: jest.fn((value) => value)
}));

await jest.unstable_mockModule('../services/ffmpegService.js', () => ({
  extractVideoFrame: jest.fn()
}));

await jest.unstable_mockModule('../services/realtimeService.js', () => ({
  broadcastRealtimeEvent: jest.fn()
}));

const {
  buildSeedDanceReconstructionPrompt,
  collectSceneReferenceImages,
  composeSeedDanceReferenceImages,
  resolveRelevantCharacters,
  resolveRelevantScenes
} = await import('../services/generationService.js');

describe('generationService helpers', () => {
  beforeEach(() => {
    listCompletedResourceImageAssetsByResourceKeysMock.mockReset();
  });

  test('prefers explicit @角色 mentions over segment default character list', () => {
    const segment = {
      analysis: {
        characters: ['配角']
      }
    };
    const overallAnalysis = {
      characters: [
        { id: 'character_1', name: '主角' },
        { id: 'character_2', name: '配角' }
      ]
    };

    const result = resolveRelevantCharacters(segment, overallAnalysis, '@主角 在画面中向前移动');

    expect(result.map((item) => item.name)).toEqual(['主角']);
  });

  test('prefers explicit #场景 mentions over bound background scene', () => {
    const overallAnalysis = {
      backgrounds: [
        { id: 'background_1', name: '咖啡馆内景' },
        { id: 'background_2', name: '街道夜景' }
      ]
    };

    const result = resolveRelevantScenes({
      segment: {
        analysis: {
          scenes: ['咖啡馆内景']
        }
      },
      overallAnalysis,
      prompt: '@主角 从 #街道夜景 快速跑过',
      sceneNames: ['咖啡馆内景'],
      backgroundBinding: {
        backgroundId: 'background_1',
        backgroundName: '咖啡馆内景'
      }
    });

    expect(result.map((item) => item.name)).toEqual(['街道夜景']);
  });

  test('collects scene reference images by prompt-mentioned scene assets', async () => {
    listCompletedResourceImageAssetsByResourceKeysMock.mockResolvedValue([
      {
        resource_id: 'background_2',
        asset_path: 'resource-images/street-angle-1.png',
        asset_url: '/uploads/resource-images/street-angle-1.png'
      }
    ]);

    const result = await collectSceneReferenceImages({
      videoId: 101,
      segment: {
        analysis: {
          scenes: ['咖啡馆内景']
        }
      },
      overallAnalysis: {
        backgrounds: [
          { id: 'background_1', name: '咖啡馆内景' },
          { id: 'background_2', name: '街道夜景' }
        ]
      },
      prompt: '@主角 从 #街道夜景 快速跑过',
      sceneNames: ['咖啡馆内景'],
      backgroundBinding: {
        backgroundId: 'background_1',
        backgroundName: '咖啡馆内景'
      }
    });

    expect(listCompletedResourceImageAssetsByResourceKeysMock).toHaveBeenCalledWith({
      videoId: 101,
      resourceType: 'scene',
      resourceKeys: ['background_2', '街道夜景']
    });
    expect(result).toEqual([
      {
        relativePath: 'resource-images/street-angle-1.png',
        url: '/uploads/resource-images/street-angle-1.png',
        role: 'reference_image',
        sourceKind: 'scene_asset',
        displayLabel: '#background_2 场景图'
      }
    ]);
  });

  test('keeps both character triptych and scene images when composing final Seedance references', () => {
    const result = composeSeedDanceReferenceImages({
      primaryImages: [
        {
          url: '/uploads/frames/shot-frame.jpg',
          role: 'reference_image',
          sourceKind: 'shot_representative_frame'
        }
      ],
      characterStateImages: [
        {
          url: '/uploads/frames/state-1.jpg',
          role: 'reference_image',
          sourceKind: 'character_state_asset'
        },
        {
          url: '/uploads/frames/state-2.jpg',
          role: 'reference_image',
          sourceKind: 'character_state_asset'
        }
      ],
      characterImages: [
        {
          url: '/uploads/resource-images/character-front.jpg',
          role: 'reference_image',
          sourceKind: 'character_asset'
        },
        {
          url: '/uploads/resource-images/character-side.jpg',
          role: 'reference_image',
          sourceKind: 'character_asset'
        },
        {
          url: '/uploads/resource-images/character-back.jpg',
          role: 'reference_image',
          sourceKind: 'character_asset'
        }
      ],
      sceneImages: [
        {
          url: '/uploads/resource-images/scene-angle-1.jpg',
          role: 'reference_image',
          sourceKind: 'scene_asset'
        },
        {
          url: '/uploads/resource-images/scene-angle-2.jpg',
          role: 'reference_image',
          sourceKind: 'scene_asset'
        },
        {
          url: '/uploads/resource-images/scene-angle-3.jpg',
          role: 'reference_image',
          sourceKind: 'scene_asset'
        }
      ]
    });

    expect(result.map((item) => item.sourceKind)).toEqual([
      'shot_representative_frame',
      'character_asset',
      'character_asset',
      'character_asset',
      'scene_asset',
      'scene_asset',
      'scene_asset',
      'character_state_asset',
      'character_state_asset'
    ]);
  });

  test('can place shot representative frame after character and scene assets for shot generation', () => {
    const result = composeSeedDanceReferenceImages({
      primaryImages: [
        {
          url: '/uploads/frames/shot-frame.jpg',
          role: 'reference_image',
          sourceKind: 'shot_representative_frame'
        }
      ],
      characterImages: [
        {
          url: '/uploads/resource-images/character-front.jpg',
          role: 'reference_image',
          sourceKind: 'character_asset'
        }
      ],
      sceneImages: [
        {
          url: '/uploads/resource-images/scene-angle-1.jpg',
          role: 'reference_image',
          sourceKind: 'scene_asset'
        }
      ],
      primaryImagePlacement: 'after_assets'
    });

    expect(result.map((item) => item.sourceKind)).toEqual([
      'character_asset',
      'scene_asset',
      'shot_representative_frame'
    ]);
  });

  test('builds reconstruction instructions that mention character and scene references', () => {
    const prompt = buildSeedDanceReconstructionPrompt({
      prompt: '角色向前推进。',
      characterNames: ['主角'],
      sceneNames: ['街道夜景'],
      characterStateRefs: [
        {
          characterName: '主角',
          stateName: '右手受伤',
          continuityPrompt: '右手受伤状态持续，不要恢复完好'
        }
      ],
      speech: {
        hasDialogue: true,
        transcript: '现在立刻离开这里。',
        subtitleLines: [
          {
            id: 'subtitle_1',
            startTime: 0,
            endTime: 1.2,
            text: '现在立刻离开这里。'
          }
        ],
        speechStyle: '语速偏快，语气坚决'
      },
      isShot: true
    });

    expect(prompt).toContain('第一视觉真值');
    expect(prompt).toContain('小镜头典型帧只用于提取当前镜头的人物左中右站位');
    expect(prompt).toContain('@主角');
    expect(prompt).toContain('#街道夜景');
    expect(prompt).toContain('人物左右位置');
    expect(prompt).toContain('角色三视图替换进原片对应人物');
    expect(prompt).toContain('以角色三视图和角色提示词为准');
    expect(prompt).toContain('以场景参考图和场景提示词为准');
    expect(prompt).toContain('状态时间线');
    expect(prompt).toContain('重拍版本或平行版本');
    expect(prompt).toContain('主要由角色三视图、场景图和提示词重建');
    expect(prompt).toContain('不要把原片表面纹理');
    expect(prompt).toContain('不要让生成结果和关键帧过于相似');
    expect(prompt).toContain('不要任何字幕');
    expect(prompt).toContain('输出结果必须是带完整音轨的视频文件');
    expect(prompt).toContain('生成音频与口型都必须尽量对齐参考音频');
  });
});
