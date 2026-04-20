import { jest } from '@jest/globals';

const getVideoRecordById = jest.fn();
const resolveVideoAbsolutePath = jest.fn();
const analyzeSegmentContent = jest.fn();
const getAnalysisRecordByVideoId = jest.fn();
const extractVideoFrame = jest.fn();
const sliceVideoClip = jest.fn(async (_sourcePath, startTime, endTime, options = {}) => ({
  filePath: `shots/${options.basename || 'shot'}.mp4`,
  fileUrl: `/uploads/shots/${options.basename || 'shot'}.mp4`,
  startTime,
  endTime,
  duration: Number((Number(endTime) - Number(startTime)).toFixed(2)),
  engine: 'ffmpeg-slice'
}));

const Segment = {
  findByPk: jest.fn(),
  findAll: jest.fn(),
  destroy: jest.fn(),
  create: jest.fn()
};

const GenerationTask = {
  findAll: jest.fn()
};

const Analysis = {
  findOne: jest.fn()
};

const BackgroundAsset = {
  findOne: jest.fn(),
  create: jest.fn()
};

const Project = {
  findByPk: jest.fn()
};

const ResourceImageAsset = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn()
};

const ShotGenerationTask = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn()
};

await jest.unstable_mockModule('../models/index.js', () => ({
  Analysis,
  BackgroundAsset,
  GenerationTask,
  Project,
  ResourceImageAsset,
  Segment,
  ShotGenerationTask,
  Video: {}
}));

await jest.unstable_mockModule('../services/videoService.js', () => ({
  getVideoRecordById,
  resolveVideoAbsolutePath
}));

await jest.unstable_mockModule('../services/analysisService.js', () => ({
  analyzeSegmentContent,
  getAnalysisRecordByVideoId
}));

await jest.unstable_mockModule('../services/taskService.js', () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  failTask: jest.fn(),
  updateTask: jest.fn()
}));

await jest.unstable_mockModule('../services/ffmpegService.js', () => ({
  extractVideoFrame,
  getVideoMetadata: jest.fn(),
  mergeVideos: jest.fn(),
  sliceVideoClip,
  splitVideo: jest.fn()
}));

await jest.unstable_mockModule('../services/fileService.js', () => ({
  createOutputRelativePath: jest.fn((directory, basename, extension = '.mp4') =>
    `${directory}/${basename}${extension}`
  ),
  duplicateToUploadPath: jest.fn(async (_sourceAbsolutePath, targetRelativePath) => `/tmp/${targetRelativePath}`),
  ensureParentDirectory: jest.fn(),
  publicUrlToRelativePath: jest.fn((assetPath) => assetPath),
  removeFileIfExists: jest.fn(),
  resolveUploadPath: jest.fn((assetPath) => `/tmp/${assetPath}`),
  toPublicUploadUrl: jest.fn((assetPath) => `/uploads/${assetPath}`),
  toAbsolutePublicUploadUrl: jest.fn((assetPath) => `/uploads/${assetPath}`)
}));

const { analyzeSegmentById, listSegmentsByVideoId, updateSegmentShotsById } = await import('../services/segmentService.js');

describe('segmentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    extractVideoFrame.mockImplementation(async (_sourcePath, _timeSeconds, options = {}) => ({
      filePath: `frames/${options.basename || 'generated-shot-frame'}.jpg`,
      fileUrl: `/uploads/frames/${options.basename || 'generated-shot-frame'}.jpg`
    }));

    getVideoRecordById.mockResolvedValue({
      id: 101
    });

    getAnalysisRecordByVideoId.mockResolvedValue({
      id: 501,
      backgrounds: [
        {
          id: 'background_cafe',
          name: '咖啡馆内景',
          scenePrompt: '暖色咖啡馆场景提示词',
          representativeFrameNote: '背景代表帧'
        }
      ],
      timeAnchors: [
        {
          startTime: 0,
          endTime: 4,
          sceneSummary: '角色在咖啡馆里落座',
          scenePrompt: '咖啡馆靠窗座位，暖色灯光',
          backgroundId: 'background_cafe',
          backgroundAction: 'create_new',
          backgroundName: '咖啡馆内景',
          representativeFrameTime: 1.6,
          representativeFrameNote: '角色落座瞬间'
        }
      ]
    });
  });

  test('aligns latest_generation_task with merge input source while preserving latest attempt state', async () => {
    Segment.findAll.mockResolvedValue([
      {
        id: 201,
        segmentIndex: 0,
        startTime: 0,
        endTime: 4,
        filePath: 'segments/source/demo-0.mp4',
        analysis: {
          prompt: '@主角 进入场景'
        }
      }
    ]);

    GenerationTask.findAll.mockResolvedValue([
      {
        id: 302,
        segmentId: 201,
        status: 'failed',
        progress: 100,
        prompt: '@主角 第二次尝试',
        optimizedPrompt: '展开后的第二次尝试',
        resultUrl: null,
        errorMessage: 'Latest generation failed',
        createdAt: '2026-04-17T02:00:00.000Z',
        updatedAt: '2026-04-17T02:01:00.000Z'
      },
      {
        id: 301,
        segmentId: 201,
        status: 'completed',
        progress: 100,
        prompt: '@主角 第一次尝试',
        optimizedPrompt: '展开后的第一次尝试',
        resultUrl: '/uploads/outputs/demo-0-success.mp4',
        errorMessage: null,
        createdAt: '2026-04-17T01:00:00.000Z',
        updatedAt: '2026-04-17T01:01:00.000Z'
      }
    ]);

    const segments = await listSegmentsByVideoId(101);

    expect(getVideoRecordById).toHaveBeenCalledWith(101);
    expect(segments).toHaveLength(1);
    expect(segments[0].latest_generation_task).toMatchObject({
      id: 301,
      status: 'completed',
      prompt: '@主角 第一次尝试',
      optimized_prompt: '展开后的第一次尝试',
      result_url: '/uploads/outputs/demo-0-success.mp4'
    });
    expect(segments[0].latest_attempt_task).toMatchObject({
      id: 302,
      status: 'failed',
      prompt: '@主角 第二次尝试',
      error_message: 'Latest generation failed'
    });
  });

  test('preserves scene binding metadata when re-analyzing a segment', async () => {
    Segment.findByPk.mockResolvedValue({
      id: 201,
      videoId: 101,
      segmentIndex: 0,
      startTime: 0,
      endTime: 4,
      filePath: 'segments/source/demo-0.mp4',
      analysis: {
        backgroundId: 'background_cafe',
        backgroundAction: 'create_new',
        backgroundName: '咖啡馆内景',
        backgroundPrompt: '暖色咖啡馆场景提示词',
        sceneSummary: '角色在咖啡馆里落座',
        scenePrompt: '咖啡馆靠窗座位，暖色灯光',
        prompt: '@主角 在咖啡馆落座'
      },
      update: jest.fn().mockImplementation(function update(payload) {
        this.analysis = payload.analysis;
        return Promise.resolve(this);
      })
    });
    analyzeSegmentContent.mockResolvedValue({
      characters: ['主角'],
      scene: '咖啡馆里人物情绪平稳',
      action: '主角坐下并观察四周',
      prompt: '@主角 坐在暖色咖啡馆靠窗座位，观察四周'
    });
    GenerationTask.findAll.mockResolvedValue([]);

    const segment = await analyzeSegmentById(201);

    expect(analyzeSegmentContent).toHaveBeenCalled();
    expect(segment.analysis).toMatchObject({
      backgroundId: 'background_cafe',
      backgroundAction: 'create_new',
      backgroundName: '咖啡馆内景',
      backgroundPrompt: '暖色咖啡馆场景提示词',
      sceneSummary: '角色在咖啡馆里落座',
      scenePrompt: '咖啡馆靠窗座位，暖色灯光',
      scene: '咖啡馆里人物情绪平稳',
      action: '主角坐下并观察四周'
    });
  });

  test('rebuilds shot source clip and representative frame when saving shot definitions', async () => {
    const segmentUpdate = jest.fn().mockImplementation(function update(payload) {
      this.analysis = payload.analysis;
      return Promise.resolve(this);
    });

    Segment.findByPk.mockResolvedValue({
      id: 201,
      videoId: 101,
      segmentIndex: 0,
      startTime: 0,
      endTime: 4,
      filePath: 'segments/source/demo-0.mp4',
      analysis: {
        shots: [
          {
            id: 'shot_existing_1',
            startTime: 0,
            endTime: 1.5,
            representativeFrameTime: 0.8,
            sourceFilePath: 'shots/old-shot.mp4',
            representativeFrameImagePath: 'frames/old-shot.jpg'
          }
        ]
      },
      update: segmentUpdate
    });
    GenerationTask.findAll.mockResolvedValue([]);

    const segment = await updateSegmentShotsById(201, [
      {
        id: 'shot_saved_1',
        startTime: 0,
        endTime: 2,
        summary: '主角推门进入咖啡馆',
        prompt: '@主角 推门进入 #咖啡馆内景',
        sceneNames: ['咖啡馆内景'],
        characterNames: ['主角'],
        representativeFrameTime: 1.1,
        representativeFrameNote: '主角进门时的代表帧'
      }
    ]);

    expect(segmentUpdate).toHaveBeenCalled();
    expect(segment.analysis.shots[0]).toMatchObject({
      id: 'shot_saved_1',
      sourceFilePath: expect.stringContaining('shots/segment-201-shot_saved_1-source'),
      sourceFileUrl: expect.stringContaining('/uploads/shots/segment-201-shot_saved_1-source'),
      sourceLocalStartTime: 0,
      sourceLocalEndTime: 2,
      representativeFrameImagePath: expect.stringContaining('frames/segment-201-shot_saved_1-representative-frame'),
      representativeFrameImageUrl: expect.stringContaining('/uploads/frames/segment-201-shot_saved_1-representative-frame'),
      representativeFrameActualTime: 1.1
    });
  });
});
