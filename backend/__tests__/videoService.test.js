import { jest } from '@jest/globals';

const Project = {
  findByPk: jest.fn(),
  create: jest.fn()
};

const Video = {
  create: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn()
};

await jest.unstable_mockModule('../models/index.js', () => ({
  Project,
  Segment: {},
  Video,
  GenerationTask: {}
}));

const getVideoMetadata = jest.fn();
await jest.unstable_mockModule('../services/ffmpegService.js', () => ({
  getVideoMetadata
}));

const removeFileIfExists = jest.fn();
await jest.unstable_mockModule('../services/fileService.js', () => ({
  removeFileIfExists,
  resolveUploadPath: jest.fn((value) => value),
  toPublicUploadUrl: jest.fn((value) => `/uploads/${value}`),
  toRelativeUploadPath: jest.fn((value) => value.replace(/^\/tmp\//, 'videos/'))
}));

const { createVideoFromUpload } = await import('../services/videoService.js');

const baseFile = {
  originalname: 'demo.mp4',
  path: '/tmp/uploaded-demo.mp4',
  size: 1024
};

describe('videoService upload validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Project.findByPk.mockResolvedValue(null);
    Project.create.mockResolvedValue({
      id: 901
    });
    Video.findOne.mockResolvedValue(null);
    Video.create.mockResolvedValue({
      id: 301,
      projectId: 901,
      filename: 'demo.mp4',
      filePath: 'videos/uploaded-demo.mp4',
      duration: 12,
      fileSize: 1024,
      status: 'uploaded'
    });
  });

  test('rejects duplicate uploads based on filename and file size', async () => {
    getVideoMetadata.mockResolvedValue({
      duration: 12,
      durationSecondsExact: 12,
      width: 1920,
      height: 1080,
      codec: 'h264',
      engine: 'ffprobe'
    });
    Video.findOne.mockResolvedValue({
      id: 999,
      filename: baseFile.originalname,
      fileSize: baseFile.size
    });

    await expect(
      createVideoFromUpload({
        file: baseFile
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: '已存在同名且大小一致的视频，请勿重复上传。'
    });

    expect(removeFileIfExists).toHaveBeenCalledWith(baseFile.path);
    expect(Project.create).not.toHaveBeenCalled();
    expect(Video.create).not.toHaveBeenCalled();
  });

  test('rejects uploads that exceed the duration limit', async () => {
    getVideoMetadata.mockResolvedValue({
      duration: 601,
      durationSecondsExact: 600.2,
      width: 1920,
      height: 1080,
      codec: 'h264',
      engine: 'ffprobe'
    });

    await expect(
      createVideoFromUpload({
        file: baseFile
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: '视频时长不能超过 10 分钟。'
    });

    expect(removeFileIfExists).toHaveBeenCalledWith(baseFile.path);
    expect(Video.findOne).not.toHaveBeenCalled();
    expect(Project.create).not.toHaveBeenCalled();
    expect(Video.create).not.toHaveBeenCalled();
  });
});
