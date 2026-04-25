import { jest } from '@jest/globals';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const getVideoRecordById = jest.fn();
const resolveVideoAbsolutePath = jest.fn();
const analyzeSegmentContent = jest.fn();
const getAnalysisRecordByVideoId = jest.fn();
const createTask = jest.fn();
const completeTask = jest.fn();
const failTask = jest.fn();
const updateTask = jest.fn();
const extractVideoFrame = jest.fn();
const extractAudioClip = jest.fn(async (_sourcePath, startTime, endTime, options = {}) => ({
  filePath: `audio/${options.basename || 'shot-audio'}.mp3`,
  fileUrl: `/uploads/audio/${options.basename || 'shot-audio'}.mp3`,
  startTime,
  endTime,
  duration: Number((Number(endTime) - Number(startTime)).toFixed(2)),
  engine: 'ffmpeg-audio-extract'
}));
const padAudioClipToDuration = jest.fn(async (audioPath, targetDuration, options = {}) => ({
  filePath: `audio/${options.basename || 'shot-audio-padded'}.mp3`,
  fileUrl: `/uploads/audio/${options.basename || 'shot-audio-padded'}.mp3`,
  duration: Number(targetDuration),
  sourceAudioPath: audioPath,
  engine: 'ffmpeg-audio-pad'
}));
const sliceVideoClip = jest.fn(async (_sourcePath, startTime, endTime, options = {}) => ({
  filePath: `shots/${options.basename || 'shot'}.mp4`,
  fileUrl: `/uploads/shots/${options.basename || 'shot'}.mp4`,
  startTime,
  endTime,
  duration: Number((Number(endTime) - Number(startTime)).toFixed(2)),
  engine: 'ffmpeg-slice'
}));
const splitVideo = jest.fn();

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
  completeTask,
  createTask,
  failTask,
  updateTask
}));

await jest.unstable_mockModule('../services/ffmpegService.js', () => ({
  extractAudioClip,
  extractVideoFrame,
  getVideoMetadata: jest.fn(),
  mergeVideos: jest.fn(),
  padAudioClipToDuration,
  sliceVideoClip,
  splitVideo
}));

await jest.unstable_mockModule('../services/fileService.js', () => ({
  createOutputRelativePath: jest.fn((directory, basename, extension = '.mp4') =>
    `${directory}/${basename}${extension}`
  ),
  duplicateToUploadPath: jest.fn(async (_sourceAbsolutePath, targetRelativePath) => `/tmp/${targetRelativePath}`),
  ensureParentDirectory: jest.fn(async (absolutePath) => {
    await mkdir(path.dirname(absolutePath), { recursive: true });
  }),
  publicUrlToRelativePath: jest.fn((assetPath) => assetPath),
  removeFileIfExists: jest.fn(),
  resolveUploadPath: jest.fn((assetPath) => `/tmp/${assetPath}`),
  toPublicUploadUrl: jest.fn((assetPath) => `/uploads/${assetPath}`),
  toAbsolutePublicUploadUrl: jest.fn((assetPath) => `/uploads/${assetPath}`)
}));

const { analyzeSegmentById, listSegmentsByVideoId, startSplitVideo, updateSegmentShotsById } = await import('../services/segmentService.js');

describe('segmentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createTask.mockReturnValue({
      id: 'split-task-201',
      type: 'split',
      status: 'pending',
      progress: 0,
      message: 'Split task queued'
    });
    extractVideoFrame.mockImplementation(async (_sourcePath, _timeSeconds, options = {}) => ({
      filePath: `frames/${options.basename || 'generated-shot-frame'}.jpg`,
      fileUrl: `/uploads/frames/${options.basename || 'generated-shot-frame'}.jpg`
    }));
    splitVideo.mockResolvedValue([
      {
        segmentIndex: 0,
        startTime: 0,
        endTime: 4,
        filePath: 'segments/source/demo-0.mp4'
      }
    ]);
    Segment.destroy.mockResolvedValue(0);
    Segment.create.mockImplementation(async (payload) => payload);

    getVideoRecordById.mockResolvedValue({
      id: 101,
      filename: 'demo.mp4'
    });
    resolveVideoAbsolutePath.mockReturnValue('/tmp/uploads/videos/demo.mp4');

    getAnalysisRecordByVideoId.mockResolvedValue({
      id: 501,
      analysisOptions: {
        extractSubtitles: true,
        parseAudio: true
      },
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

  test('uses overall-analysis anchors directly during split instead of re-running segment Gemini analysis', async () => {
    const startResult = await startSplitVideo({
      videoId: 101,
      timeAnchors: [
        {
          startTime: 0,
          endTime: 4,
          sceneSummary: '角色在咖啡馆里落座',
          scenePrompt: '@主角 在 #咖啡馆内景 落座',
          backgroundId: 'background_cafe',
          backgroundName: '咖啡馆内景',
          shots: [
            {
              id: 'shot_anchor_1',
              startTime: 0,
              endTime: 2.4,
              summary: '主角推门进入咖啡馆',
              prompt: '@主角 推门进入 #咖啡馆内景',
              sceneNames: ['咖啡馆内景'],
              characterNames: ['主角'],
              representativeFrameTime: 1.1,
              representativeFrameNote: '主角进门时的代表帧',
              speech: {
                transcript: '我到了。',
                subtitleLines: [
                  {
                    id: 'subtitle_1',
                    startTime: 0,
                    endTime: 1.1,
                    text: '我到了。'
                  }
                ],
                hasDialogue: true,
                extractionStatus: 'completed',
                sourceOfTruth: 'extracted'
              }
            }
          ]
        }
      ]
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (Segment.create.mock.calls.length || failTask.mock.calls.length || completeTask.mock.calls.length) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(startResult).toMatchObject({
      task_id: 'split-task-201',
      status: 'pending'
    });
    expect(analyzeSegmentContent).not.toHaveBeenCalled();
    expect(failTask).not.toHaveBeenCalled();
    expect(Segment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: 101,
        segmentIndex: 0,
        analysis: expect.objectContaining({
          sceneSummary: '角色在咖啡馆里落座',
          scenePrompt: '@主角 在 #咖啡馆内景 落座',
          backgroundId: 'background_cafe',
          backgroundName: '咖啡馆内景',
          shots: [
            expect.objectContaining({
              id: 'shot_anchor_1',
              prompt: '@主角 推门进入 #咖啡馆内景',
              sourceFilePath: expect.stringContaining('shots/segment-0-shot_anchor_1-source'),
              representativeFrameImagePath: expect.stringContaining(
                'frames/segment-0-shot_anchor_1-representative-frame'
              ),
              speech: expect.objectContaining({
                transcript: '我到了。',
                subtitleFilePath: expect.stringContaining('subtitles/segment-0-shot_anchor_1-speech')
              })
            })
          ]
        })
      })
    );
    expect(completeTask).toHaveBeenCalledWith(
      'split-task-201',
      expect.objectContaining({
        video_id: 101,
        segment_count: 1
      }),
      'Video split completed'
    );
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

  test('keeps shot tasks created in the same second as invalidation visible after refresh', async () => {
    const segmentUpdate = jest.fn().mockImplementation(function update(payload) {
      this.analysis = payload.analysis;
      return Promise.resolve(this);
    });

    Segment.findAll.mockResolvedValue([
      {
        id: 201,
        segmentIndex: 0,
        startTime: 0,
        endTime: 4,
        filePath: 'segments/source/demo-0.mp4',
        analysis: {
          shotAssemblyInvalidatedAt: '2026-04-22T01:58:48.317Z',
          shots: [
            {
              id: 'shot_same_second',
              startTime: 0,
              endTime: 1,
              summary: '同秒新镜头任务',
              prompt: '@主角 在门口停顿',
              sceneNames: ['咖啡馆内景'],
              characterNames: ['主角'],
              representativeFrameTime: 0.5,
              representativeFrameNote: '同秒任务',
              sourceFilePath: 'shots/shot_same_second.mp4',
              sourceFileUrl: '/uploads/shots/shot_same_second.mp4',
              representativeFrameImagePath: 'frames/shot_same_second.jpg',
              representativeFrameImageUrl: '/uploads/frames/shot_same_second.jpg',
              representativeFrameActualTime: 0.5
            }
          ]
        },
        update: segmentUpdate
      }
    ]);

    GenerationTask.findAll.mockResolvedValue([]);
    ShotGenerationTask.findAll.mockResolvedValue([
      {
        id: 401,
        segmentId: 201,
        shotId: 'shot_same_second',
        shotIndex: 0,
        prompt: '@主角 在门口停顿',
        optimizedPrompt: '@主角 在门口停顿',
        startTime: 0,
        endTime: 1,
        durationSeconds: 1,
        status: 'processing',
        progress: 68,
        resultUrl: '',
        errorMessage: null,
        meta: {
          remoteStatus: 'running',
          remoteStatusLabel: '远端生成中'
        },
        createdAt: '2026-04-22T01:58:48.000Z',
        updatedAt: '2026-04-22T01:59:04.000Z'
      }
    ]);

    const segments = await listSegmentsByVideoId(101);

    expect(segments).toHaveLength(1);
    expect(segments[0].analysis.shots[0].latestGenerationTask).toMatchObject({
      task_id: 401,
      status: 'processing',
      remote_status: 'running'
    });
    expect(segments[0].shot_generation_summary).toMatchObject({
      status: 'processing',
      processing_shot_count: 1
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

  test('does not rebuild shot assets or invalidate results when shot definitions are unchanged', async () => {
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
        analysisOptions: {
          extractSubtitles: false,
          parseAudio: false
        },
        shots: [
          {
            id: 'shot_saved_1',
            startTime: 0,
            endTime: 2,
            durationSeconds: 2,
            summary: '主角推门进入咖啡馆',
            prompt: '@主角 推门进入 #咖啡馆内景',
            sceneNames: ['咖啡馆内景'],
            characterNames: ['主角'],
            representativeFrameTime: 1.1,
            representativeFrameNote: '主角进门时的代表帧',
            sourceFilePath: 'shots/segment-201-shot_saved_1-source.mp4',
            sourceFileUrl: '/uploads/shots/segment-201-shot_saved_1-source.mp4',
            sourceLocalStartTime: 0,
            sourceLocalEndTime: 2,
            sourceAudioFilePath: '',
            sourceAudioFileUrl: '',
            representativeFrameImagePath: 'frames/segment-201-shot_saved_1-representative-frame.jpg',
            representativeFrameImageUrl: '/uploads/frames/segment-201-shot_saved_1-representative-frame.jpg',
            representativeFrameActualTime: 1.1,
            speech: {
              transcript: '',
              subtitleLines: [],
              speechStyle: '',
              hasDialogue: false,
              extractionStatus: 'completed',
              extractionError: '',
              subtitleFilePath: '',
              subtitleFileUrl: '',
              sourceOfTruth: 'extracted'
            }
          }
        ],
        shotAssembly: null,
        shotAssemblyInvalidatedAt: ''
      },
      update: segmentUpdate
    });
    GenerationTask.findAll.mockResolvedValue([]);
    ShotGenerationTask.findAll.mockResolvedValue([]);

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

    expect(segmentUpdate).not.toHaveBeenCalled();
    expect(sliceVideoClip).not.toHaveBeenCalled();
    expect(extractVideoFrame).not.toHaveBeenCalled();
    expect(segment.analysis.shots[0]).toMatchObject({
      id: 'shot_saved_1',
      sourceFilePath: 'shots/segment-201-shot_saved_1-source.mp4',
      representativeFrameImagePath: 'frames/segment-201-shot_saved_1-representative-frame.jpg'
    });
  });
});
