import { jest } from '@jest/globals';

const getVideoRecordById = jest.fn();
const resolveVideoAbsolutePath = jest.fn();

const Segment = {
  findAll: jest.fn(),
  destroy: jest.fn(),
  create: jest.fn()
};

const GenerationTask = {
  findAll: jest.fn()
};

await jest.unstable_mockModule('../models/index.js', () => ({
  GenerationTask,
  Segment,
  Video: {}
}));

await jest.unstable_mockModule('../services/videoService.js', () => ({
  getVideoRecordById,
  resolveVideoAbsolutePath
}));

await jest.unstable_mockModule('../services/analysisService.js', () => ({
  analyzeSegmentContent: jest.fn(),
  getAnalysisRecordByVideoId: jest.fn()
}));

await jest.unstable_mockModule('../services/taskService.js', () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  failTask: jest.fn(),
  updateTask: jest.fn()
}));

await jest.unstable_mockModule('../services/ffmpegService.js', () => ({
  splitVideo: jest.fn()
}));

await jest.unstable_mockModule('../services/fileService.js', () => ({
  resolveUploadPath: jest.fn((assetPath) => `/tmp/${assetPath}`),
  toPublicUploadUrl: jest.fn((assetPath) => `/uploads/${assetPath}`)
}));

const { listSegmentsByVideoId } = await import('../services/segmentService.js');

describe('segmentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    getVideoRecordById.mockResolvedValue({
      id: 101
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
});
