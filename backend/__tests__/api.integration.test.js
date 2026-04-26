import fs from 'node:fs/promises';
import path from 'node:path';

import request from 'supertest';
import { jest } from '@jest/globals';

const databaseMock = {
  sequelize: {},
  checkDatabaseHealth: jest.fn(),
  closeDatabaseConnection: jest.fn(),
  connectDatabase: jest.fn(),
  ensureDatabaseCompatibility: jest.fn()
};

const videoServiceMock = {
  createVideoFromUpload: jest.fn(),
  getVideoById: jest.fn(),
  deleteVideoById: jest.fn()
};

const analysisServiceMock = {
  analyzeVideoById: jest.fn(),
  getAnalysisByVideoId: jest.fn(),
  optimizePrompt: jest.fn(),
  updateAnalysisCharactersByVideoId: jest.fn()
};

const segmentServiceMock = {
  analyzeSegmentById: jest.fn(),
  startSplitVideo: jest.fn(),
  listSegmentsByVideoId: jest.fn(),
  updateSegmentShotsById: jest.fn()
};

const generationServiceMock = {
  startGeneration: jest.fn(),
  getGenerationTaskStatus: jest.fn()
};

const shotGenerationServiceMock = {
  startShotGeneration: jest.fn(),
  startShotBatchGeneration: jest.fn(),
  getShotGenerationTaskStatus: jest.fn()
};

const backgroundAssetServiceMock = {
  listBackgroundAssetsByVideoId: jest.fn()
};

const resourceImageServiceMock = {
  listResourceImageAssetsByVideoId: jest.fn(),
  generateResourceImageBundle: jest.fn()
};

const mergeServiceMock = {
  startMerge: jest.fn(),
  getMergeTaskProgress: jest.fn(),
  getMergeTaskDownload: jest.fn()
};

const segmentExportServiceMock = {
  startSegmentExport: jest.fn(),
  getSegmentExportProgress: jest.fn(),
  getSegmentExportDownload: jest.fn()
};

const taskServiceMock = {
  createTask: jest.fn(),
  updateTask: jest.fn(),
  completeTask: jest.fn(),
  failTask: jest.fn(),
  getTask: jest.fn()
};

const taskRecoveryServiceMock = {
  recoverInFlightTasks: jest.fn()
};

await jest.unstable_mockModule('../config/database.js', () => databaseMock);
await jest.unstable_mockModule('../services/videoService.js', () => videoServiceMock);
await jest.unstable_mockModule('../services/analysisService.js', () => analysisServiceMock);
await jest.unstable_mockModule('../services/segmentService.js', () => segmentServiceMock);
await jest.unstable_mockModule('../services/generationService.js', () => generationServiceMock);
await jest.unstable_mockModule('../services/shotGenerationService.js', () => shotGenerationServiceMock);
await jest.unstable_mockModule('../services/backgroundAssetService.js', () => backgroundAssetServiceMock);
await jest.unstable_mockModule('../services/resourceImageService.js', () => resourceImageServiceMock);
await jest.unstable_mockModule('../services/mergeService.js', () => mergeServiceMock);
await jest.unstable_mockModule('../services/segmentExportService.js', () => segmentExportServiceMock);
await jest.unstable_mockModule('../services/taskService.js', () => taskServiceMock);
await jest.unstable_mockModule('../services/taskRecoveryService.js', () => taskRecoveryServiceMock);

const { createApp } = await import('../app.js');
const { AppError } = await import('../middleware/errorHandler.js');

const app = createApp();
const backendRoot = path.resolve(process.cwd());
const uploadRoot = path.join(backendRoot, '.tmp', 'test-uploads');
const downloadsRoot = path.join(uploadRoot, 'outputs');

const createFakeVideoResponse = () => ({
  id: 101,
  filename: 'demo.mp4',
  duration: 12,
  status: 'uploaded',
  project_id: 1,
  file_path: 'videos/demo.mp4',
  file_url: '/uploads/videos/demo.mp4',
  file_size: 1024
});

beforeEach(() => {
  jest.clearAllMocks();

  databaseMock.checkDatabaseHealth.mockResolvedValue({
    connected: true,
    status: 'connected',
    database: 'fanshi_video_db'
  });

  videoServiceMock.createVideoFromUpload.mockResolvedValue(createFakeVideoResponse());
  videoServiceMock.getVideoById.mockResolvedValue(createFakeVideoResponse());
  videoServiceMock.deleteVideoById.mockResolvedValue({
    success: true
  });

  analysisServiceMock.analyzeVideoById.mockResolvedValue({
    id: 201,
    video_id: 101,
    status: 'completed',
    plot: '测试剧情',
    characters: [
      {
        name: '主角',
        appearancePrompt: '电影感人物设定',
        representativeFrameTime: 1.2
      }
    ],
    backgrounds: [
      {
        name: '测试场景',
        description: '测试背景',
        scenePrompt: '电影化测试场景提示词',
        representativeFrameTime: 2.4
      }
    ],
    time_anchors: [
      {
        startTime: 0,
        endTime: 4,
        sceneSummary: '镜头一',
        scenePrompt: '镜头一场景提示词',
        representativeFrameTime: 1.8
      }
    ],
    provider: 'remote-gemini',
    model: 'gemini-2.5-pro',
    mode: 'google',
    is_mock: false,
    fallback_reason: '',
    remote_error: ''
  });
  analysisServiceMock.getAnalysisByVideoId.mockResolvedValue({
    id: 201,
    video_id: 101,
    status: 'completed',
    plot: '测试剧情',
    characters: [{ name: '主角', representativeFrameTime: 1.2 }],
    backgrounds: [{ name: '测试场景', description: '测试背景', scenePrompt: '电影化测试场景提示词' }],
    time_anchors: [
      {
        startTime: 0,
        endTime: 4,
        sceneSummary: '镜头一',
        scenePrompt: '镜头一场景提示词',
        representativeFrameTime: 1.8
      }
    ],
    provider: 'remote-gemini',
    model: 'gemini-2.5-pro',
    mode: 'google',
    is_mock: false,
    fallback_reason: '',
    remote_error: ''
  });
  analysisServiceMock.optimizePrompt.mockResolvedValue({
    optimized_prompt: '@主角 走进场景。',
    highlighted_prompt: '<span class="mention text-blue-500">@主角</span> 走进场景。'
  });

  segmentServiceMock.startSplitVideo.mockResolvedValue({
    task_id: 'split-task-001',
    status: 'pending',
    progress: 0
  });
  segmentServiceMock.listSegmentsByVideoId.mockResolvedValue([
    {
      id: 301,
      segment_index: 0,
      start_time: 0,
      end_time: 4,
      file_path: 'segments/demo-0.mp4',
      file_url: '/uploads/segments/demo-0.mp4',
      analysis: {
        prompt: '@主角 走进场景。'
      },
      latest_generation_task: null
    }
  ]);
  segmentServiceMock.analyzeSegmentById.mockResolvedValue({
    id: 301,
    segment_index: 0,
    start_time: 0,
    end_time: 4,
    file_path: 'segments/demo-0.mp4',
    file_url: '/uploads/segments/demo-0.mp4',
    analysis: {
      prompt: '@主角 重新分析后的提示词。',
      scene: '重新分析后的场景',
      action: '重新分析后的动作',
      characters: ['主角']
    },
    latest_generation_task: null,
    latest_attempt_task: null
  });
  segmentServiceMock.updateSegmentShotsById.mockResolvedValue({
    id: 301,
    segment_index: 0,
    start_time: 0,
    end_time: 4,
    file_path: 'segments/demo-0.mp4',
    file_url: '/uploads/segments/demo-0.mp4',
    analysis: {
      prompt: '@主角 重新分析后的提示词。',
      shots: [
        {
          id: 'shot_saved_1',
          shotIndex: 0,
          startTime: 0,
          endTime: 2,
          localStartTime: 0,
          localEndTime: 2,
          durationSeconds: 2,
          summary: '保存后的镜头',
          prompt: '@主角 在 #测试场景 中完成保存后的镜头动作',
          sceneNames: ['测试场景'],
          characterNames: ['主角'],
          representativeFrameTime: 1,
          representativeFrameNote: '保存后的典型帧'
        }
      ]
    },
    shot_generation_summary: {
      segment_id: 301,
      status: 'idle',
      progress: 0,
      total_shot_count: 1,
      completed_shot_count: 0,
      failed_shot_count: 0,
      processing_shot_count: 0,
      pending_assembly: false,
      result_url: '',
      error_message: '',
      assembly_generation_task_id: null,
      source: 'shot_assembly'
    },
    latest_generation_task: null,
    latest_attempt_task: null,
    latest_shot_assembly_task: null
  });

  generationServiceMock.startGeneration.mockResolvedValue({
    task_id: 401,
    status: 'pending',
    progress: 0
  });
  backgroundAssetServiceMock.listBackgroundAssetsByVideoId.mockResolvedValue([]);
  resourceImageServiceMock.listResourceImageAssetsByVideoId.mockResolvedValue([
    {
      id: 501,
      video_id: 101,
      resource_type: 'character',
      resource_id: 'char-1',
      name: '主角',
      variant_id: 'front',
      variant_label: '正面',
      sort_order: 0,
      source_prompt: '角色原始资源提示词',
      prompt: '角色三视图正面提示词',
      status: 'completed',
      asset_path: 'resource-images/char-1-front.png',
      asset_url: '/uploads/resource-images/char-1-front.png',
      mime_type: 'image/png',
      representative_frame_time: 1.2,
      error_message: '',
      meta: {}
    }
  ]);
  resourceImageServiceMock.generateResourceImageBundle.mockResolvedValue({
    video_id: 101,
    resource_type: 'character',
    resource_id: 'char-1',
    completed_count: 3,
    failed_count: 0,
    partial_success: false,
    error_summary: '',
    assets: [
      {
        id: 501,
        video_id: 101,
        resource_type: 'character',
        resource_id: 'char-1',
        name: '主角',
        variant_id: 'front',
        variant_label: '正面',
        sort_order: 0,
        source_prompt: '角色原始资源提示词',
        prompt: '角色三视图正面提示词',
        status: 'completed',
        asset_path: 'resource-images/char-1-front.png',
        asset_url: '/uploads/resource-images/char-1-front.png',
        mime_type: 'image/png',
        representative_frame_time: 1.2,
        error_message: '',
        meta: {}
      }
    ]
  });
  generationServiceMock.getGenerationTaskStatus.mockResolvedValue({
    task_id: 401,
    segment_id: 301,
    status: 'completed',
    progress: 100,
    prompt: '@主角 走进场景。',
    optimized_prompt: '电影化提示词',
    result_url: '/uploads/outputs/demo-generated.mp4',
    error_message: null
  });
  shotGenerationServiceMock.startShotGeneration.mockResolvedValue({
    task_id: 501,
    segment_id: 301,
    shot_id: 'shot_1',
    status: 'pending',
    progress: 0
  });
  shotGenerationServiceMock.startShotBatchGeneration.mockResolvedValue({
    segment_id: 301,
    shot_count: 2,
    status: 'processing',
    started_at: '2026-01-01T00:00:00.000Z'
  });
  shotGenerationServiceMock.getShotGenerationTaskStatus.mockResolvedValue({
    task_id: 501,
    segment_id: 301,
    shot_id: 'shot_1',
    status: 'completed',
    progress: 100,
    prompt: '@主角 完成镜头动作。',
    optimized_prompt: '镜头级电影化提示词',
    result_url: '/uploads/outputs/demo-shot-1.mp4',
    error_message: null
  });

  mergeServiceMock.startMerge.mockResolvedValue({
    task_id: 'merge-task-001',
    status: 'pending'
  });
  mergeServiceMock.getMergeTaskProgress.mockResolvedValue({
    progress: 100,
    status: 'completed',
    message: 'Merge completed'
  });
  mergeServiceMock.getMergeTaskDownload.mockImplementation(async () => {
    const filePath = path.join(downloadsRoot, 'merged-demo.mp4');
    await fs.mkdir(downloadsRoot, { recursive: true });
    await fs.writeFile(filePath, 'merged-video');

    return {
      absolutePath: filePath,
      filename: 'merged-demo.mp4'
    };
  });

  taskServiceMock.getTask.mockReturnValue({
    id: 'split-task-001',
    type: 'split',
    status: 'completed',
    progress: 100,
    message: 'Video split completed',
    errorMessage: null,
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
});

afterAll(async () => {
  await fs.rm(uploadRoot, {
    recursive: true,
    force: true
  });
});

describe('Backend API integration', () => {
  test('uploads a video successfully with multer and service orchestration', async () => {
    const response = await request(app)
      .post('/api/videos/upload')
      .field('project_name', '阶段5测试项目')
      .attach('video', Buffer.from('fake-video-content'), {
        filename: 'demo.mp4',
        contentType: 'video/mp4'
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe(101);
    expect(videoServiceMock.createVideoFromUpload).toHaveBeenCalledTimes(1);
    expect(videoServiceMock.createVideoFromUpload.mock.calls[0][0].projectName).toBe('阶段5测试项目');
    expect(videoServiceMock.createVideoFromUpload.mock.calls[0][0].file.path).toContain('.tmp/test-uploads/videos');
  });

  test('rejects unsupported uploads before reaching the service layer', async () => {
    const response = await request(app)
      .post('/api/videos/upload')
      .attach('video', Buffer.from('not-a-video'), {
        filename: 'demo.txt',
        contentType: 'text/plain'
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Unsupported video format');
    expect(videoServiceMock.createVideoFromUpload).not.toHaveBeenCalled();
  });

  test('returns analysis and optimized prompts for the happy path', async () => {
    const analyzeResponse = await request(app).post('/api/analysis/analyze').send({
      video_id: 101
    });
    const fetchAnalysisResponse = await request(app).get('/api/analysis/101');
    const promptResponse = await request(app).post('/api/analysis/optimize-prompt').send({
      prompt: '主角 走进场景。',
      characters: [{ name: '主角', appearancePrompt: '电影感人物设定' }],
      backgrounds: [{ name: '测试场景', scenePrompt: '电影化测试场景提示词' }]
    });

    expect(analyzeResponse.status).toBe(200);
    expect(analyzeResponse.body.status).toBe('completed');
    expect(analyzeResponse.body.provider).toBe('remote-gemini');
    expect(fetchAnalysisResponse.status).toBe(200);
    expect(fetchAnalysisResponse.body.video_id).toBe(101);
    expect(promptResponse.status).toBe(200);
    expect(promptResponse.body.optimized_prompt).toContain('@主角');
    expect(analysisServiceMock.optimizePrompt).toHaveBeenCalledWith({
      prompt: '主角 走进场景。',
      characters: [{ name: '主角', appearancePrompt: '电影感人物设定' }],
      backgrounds: [{ name: '测试场景', scenePrompt: '电影化测试场景提示词' }],
      mode: 'generation',
      segmentPrompt: undefined,
      shotPrompt: undefined,
      sceneNames: [],
      characterNames: []
    });
  });

  test('supports shot-level prompt optimization payloads', async () => {
    const promptResponse = await request(app).post('/api/analysis/optimize-prompt').send({
      prompt: '@主角 在测试场景内转头观察',
      mode: 'shot_generation',
      segment_prompt: '@主角 在 #测试场景 中推进剧情',
      shot_prompt: '@主角 在测试场景内转头观察',
      scene_names: ['测试场景'],
      character_names: ['主角'],
      characters: [{ name: '主角', appearancePrompt: '电影感人物设定' }],
      backgrounds: [{ name: '测试场景', scenePrompt: '电影化测试场景提示词' }]
    });

    expect(promptResponse.status).toBe(200);
    expect(analysisServiceMock.optimizePrompt).toHaveBeenCalledWith({
      prompt: '@主角 在测试场景内转头观察',
      mode: 'shot_generation',
      segmentPrompt: '@主角 在 #测试场景 中推进剧情',
      shotPrompt: '@主角 在测试场景内转头观察',
      sceneNames: ['测试场景'],
      characterNames: ['主角'],
      characters: [{ name: '主角', appearancePrompt: '电影感人物设定' }],
      backgrounds: [{ name: '测试场景', scenePrompt: '电影化测试场景提示词' }]
    });
  });

  test('lists and generates persisted resource image assets', async () => {
    const listResponse = await request(app).get('/api/resource-images/101');
    const generateResponse = await request(app).post('/api/resource-images/generate').send({
      video_id: 101,
      resource_type: 'character',
      resource_id: 'char-1',
      resource_name: '主角',
      source_prompt: '角色原始资源提示词',
      representative_frame_time: 1.2,
      variants: [
        {
          id: 'front',
          label: '正面',
          prompt: '角色三视图正面提示词',
          sortOrder: 0
        }
      ]
    });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].resource_type).toBe('character');
    expect(generateResponse.status).toBe(200);
    expect(generateResponse.body.resource_id).toBe('char-1');
    expect(generateResponse.body.completed_count).toBe(3);
    expect(resourceImageServiceMock.listResourceImageAssetsByVideoId).toHaveBeenCalledWith(101);
    expect(resourceImageServiceMock.generateResourceImageBundle).toHaveBeenCalledWith({
      videoId: 101,
      resourceType: 'character',
      resourceId: 'char-1',
      resourceName: '主角',
      sourcePrompt: '角色原始资源提示词',
      representativeFrameTime: 1.2,
      variants: [
        {
          id: 'front',
          label: '正面',
          prompt: '角色三视图正面提示词',
          sortOrder: 0
        }
      ]
    });
  });

  test('starts split and merge tasks and exposes task progress', async () => {
    const splitResponse = await request(app).post('/api/segments/split').send({
      video_id: 101,
      time_anchors: [
        {
          startTime: 0,
          endTime: 4,
          sceneSummary: '镜头一',
          scenePrompt: '镜头一场景提示词',
          representativeFrameTime: 1.8
        }
      ]
    });
    const taskResponse = await request(app).get('/api/tasks/split-task-001');
    const mergeResponse = await request(app).post('/api/merge/start').send({
      video_id: 101
    });

    expect(splitResponse.status).toBe(202);
    expect(splitResponse.body.task_id).toBe('split-task-001');
    expect(taskResponse.status).toBe(200);
    expect(taskResponse.body.status).toBe('completed');
    expect(mergeResponse.status).toBe(202);
    expect(mergeResponse.body.task_id).toBe('merge-task-001');
  });

  test('returns segments, generation task status, merge progress and downloadable output', async () => {
    const videoResponse = await request(app).get('/api/videos/101');
    const segmentsResponse = await request(app).get('/api/segments/101');
    const segmentAnalyzeResponse = await request(app).post('/api/segments/301/analyze');
    const saveShotsResponse = await request(app).put('/api/segments/301/shots').send({
      shots: [
        {
          id: 'temp-shot-1',
          startTime: 0,
          endTime: 2,
          summary: '保存后的镜头',
          prompt: '@主角 在 #测试场景 中完成保存后的镜头动作',
          sceneNames: ['测试场景'],
          characterNames: ['主角'],
          representativeFrameTime: 1,
          representativeFrameNote: '保存后的典型帧'
        }
      ]
    });
    const generationResponse = await request(app).get('/api/generation/401');
    const shotStartResponse = await request(app).post('/api/generation/shots/generate').send({
      segment_id: 301,
      shot_id: 'shot_1',
      prompt: '@主角 完成镜头动作。',
      ratio: '9:16'
    });
    const shotBatchResponse = await request(app).post('/api/generation/shots/generate-batch').send({
      segment_id: 301,
      ratio: '1:1',
      shots: [
        {
          shot_id: 'shot_1',
          prompt: '@主角 完成镜头动作。'
        }
      ]
    });
    const shotTaskResponse = await request(app).get('/api/generation/shots/501');
    const mergeProgressResponse = await request(app).get('/api/merge/merge-task-001/progress');
    const downloadResponse = await request(app).get('/api/merge/merge-task-001/download');
    const deleteResponse = await request(app).delete('/api/videos/101');

    expect(videoResponse.status).toBe(200);
    expect(videoResponse.body.id).toBe(101);
    expect(segmentsResponse.status).toBe(200);
    expect(segmentsResponse.body).toHaveLength(1);
    expect(segmentAnalyzeResponse.status).toBe(200);
    expect(segmentAnalyzeResponse.body.analysis.prompt).toContain('重新分析后');
    expect(saveShotsResponse.status).toBe(200);
    expect(saveShotsResponse.body.analysis.shots[0].id).toBe('shot_saved_1');
    expect(generationResponse.status).toBe(200);
    expect(generationResponse.body.status).toBe('completed');
    expect(shotStartResponse.status).toBe(202);
    expect(shotStartResponse.body.shot_id).toBe('shot_1');
    expect(shotBatchResponse.status).toBe(202);
    expect(shotBatchResponse.body.shot_count).toBe(2);
    expect(shotTaskResponse.status).toBe(200);
    expect(shotTaskResponse.body.status).toBe('completed');
    expect(mergeProgressResponse.status).toBe(200);
    expect(mergeProgressResponse.body.status).toBe('completed');
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers['content-disposition']).toContain('merged-demo.mp4');
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.success).toBe(true);
    expect(shotGenerationServiceMock.startShotGeneration).toHaveBeenCalledWith({
      segmentId: 301,
      shotId: 'shot_1',
      prompt: '@主角 完成镜头动作。',
      ratio: '9:16'
    });
    expect(shotGenerationServiceMock.startShotBatchGeneration).toHaveBeenCalledWith({
      segmentId: 301,
      shots: [
        {
          shot_id: 'shot_1',
          prompt: '@主角 完成镜头动作。'
        }
      ],
      ratio: '1:1'
    });
    expect(segmentServiceMock.updateSegmentShotsById).toHaveBeenCalledWith(301, [
      {
        id: 'temp-shot-1',
        startTime: 0,
        endTime: 2,
        summary: '保存后的镜头',
        prompt: '@主角 在 #测试场景 中完成保存后的镜头动作',
        sceneNames: ['测试场景'],
        characterNames: ['主角'],
        characterStateRefs: [],
        representativeFrameTime: 1,
        representativeFrameNote: '保存后的典型帧'
      }
    ]);
  });

  test('returns normalized validation and server errors', async () => {
    analysisServiceMock.getAnalysisByVideoId.mockRejectedValueOnce(
      new AppError('Analysis not found.', 404, {
        video_id: 999
      })
    );
    generationServiceMock.startGeneration.mockRejectedValueOnce(
      new AppError('Seedance 未配置完成，无法发起真实片段生成。 缺少 SEED_DANCE_API_KEY', 503, {
        provider: 'seedance'
      })
    );
    taskServiceMock.getTask.mockReturnValueOnce(null);

    const invalidBodyResponse = await request(app).post('/api/analysis/analyze').send({});
    const notFoundResponse = await request(app).get('/api/analysis/999');
    const serverErrorResponse = await request(app).post('/api/generation/generate').send({
      segment_id: 301,
      prompt: '@主角 走进场景。',
      ratio: '16:9'
    });
    const missingTaskResponse = await request(app).get('/api/tasks/missing-task-404');
    const unknownRouteResponse = await request(app).get('/api/unknown-endpoint');

    expect(invalidBodyResponse.status).toBe(400);
    expect(invalidBodyResponse.body.message).toBe('Request validation failed');
    expect(notFoundResponse.status).toBe(404);
    expect(notFoundResponse.body.message).toBe('Analysis not found.');
    expect(serverErrorResponse.status).toBe(503);
    expect(serverErrorResponse.body.message).toContain('Seedance 未配置完成');
    expect(generationServiceMock.startGeneration).toHaveBeenCalledWith({
      segmentId: 301,
      prompt: '@主角 走进场景。',
      ratio: '16:9'
    });
    expect(missingTaskResponse.status).toBe(404);
    expect(missingTaskResponse.body.message).toBe('Task not found.');
    expect(unknownRouteResponse.status).toBe(404);
    expect(unknownRouteResponse.body.message).toContain('Route not found');
  });

  test('exposes health, metrics and security headers for monitoring and hardening', async () => {
    const healthResponse = await request(app).get('/api/health');
    const ingestMonitoringResponse = await request(app).post('/api/monitoring/events').send({
      type: 'web-vital',
      payload: {
        name: 'FCP',
        value: 187.42
      },
      url: 'http://127.0.0.1:5173/',
      userAgent: 'jest-test',
      recordedAt: '2026-01-01T00:00:00.000Z'
    });
    const metricsResponse = await request(app).get('/api/metrics');

    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.success).toBe(true);
    expect(healthResponse.body.providers).toEqual(
      expect.objectContaining({
        seedance: expect.any(Object),
        gemini_image: expect.any(Object)
      })
    );
    expect(ingestMonitoringResponse.status).toBe(202);
    expect(ingestMonitoringResponse.body.accepted).toBe(true);
    expect(metricsResponse.status).toBe(200);
    expect(metricsResponse.text).toContain('fanshi_backend_http_requests_total');
    expect(metricsResponse.text).toContain('fanshi_backend_frontend_monitoring_events_total');
    expect(healthResponse.headers['x-request-id']).toBeTruthy();
    expect(healthResponse.headers['x-content-type-options']).toBe('nosniff');
  });
});
