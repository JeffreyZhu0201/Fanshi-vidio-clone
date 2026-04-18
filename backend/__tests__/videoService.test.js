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

  test('rejects uploads with unreadable video metadata', async () => {
    getVideoMetadata.mockResolvedValue({
      duration: null,
      durationSecondsExact: null,
      width: null,
      height: null,
      codec: null,
      engine: 'ffprobe'
    });

    await expect(
      createVideoFromUpload({
        file: baseFile
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: '无法解析视频元数据，请确认文件未损坏且为有效的视频文件。'
    });

    expect(removeFileIfExists).toHaveBeenCalledWith(baseFile.path);
    expect(Video.findOne).not.toHaveBeenCalled();
    expect(Project.create).not.toHaveBeenCalled();
    expect(Video.create).not.toHaveBeenCalled();
  });

  test('allows re-uploading the same original filename and file size', async () => {
    getVideoMetadata.mockResolvedValue({
      duration: 12,
      durationSecondsExact: 12,
      width: 1920,
      height: 1080,
      codec: 'h264',
      engine: 'ffprobe'
    });

    const result = await createVideoFromUpload({
      file: baseFile
    });

    expect(result).toMatchObject({
      id: 301,
      filename: 'demo.mp4',
      file_url: '/uploads/videos/uploaded-demo.mp4',
      file_size: 1024
    });
    expect(Project.create).toHaveBeenCalledTimes(1);
    expect(Video.create).toHaveBeenCalledTimes(1);
    expect(removeFileIfExists).not.toHaveBeenCalled();
  });
});
