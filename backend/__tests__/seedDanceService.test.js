import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { jest } from '@jest/globals';

const backendRoot = process.cwd();
const tempDir = path.join(backendRoot, '.tmp', 'seed-dance-service-test');

await jest.unstable_mockModule('../config/env.js', () => ({
  default: Object.freeze({
    SEED_DANCE_API_KEY: 'seedance-test-key',
    SEED_DANCE_API_BASE_URL: 'https://ark.cn-beijing.volces.com',
    SEED_DANCE_MODEL: 'doubao-seedance-2-0-260128',
    SEED_DANCE_RATIO: '16:9',
    SEED_DANCE_DURATION_SECONDS: 11,
    SEED_DANCE_RESOLUTION: '720p',
    SEED_DANCE_GENERATE_AUDIO: true,
    SEED_DANCE_WATERMARK: false,
    SEED_DANCE_POLL_INTERVAL_MS: 1000,
    SEED_DANCE_MAX_WAIT_MS: 30000,
    SEED_DANCE_STRICT_REMOTE: true,
    SEED_DANCE_ALLOW_MOCK_FALLBACK: false,
    EXTERNAL_REQUEST_TIMEOUT: 30000
  })
}));

await jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

await jest.unstable_mockModule('../services/fileService.js', () => ({
  createOutputRelativePath: jest.fn((directory, basename, extension = '.mp4') =>
    `${directory}/${basename}${extension}`
  ),
  duplicateToUploadPath: jest.fn(),
  ensureParentDirectory: jest.fn(),
  publicUrlToRelativePath: jest.fn((publicUrl) => String(publicUrl).replace(/^\/?uploads\//u, '')),
  removeFileIfExists: jest.fn(),
  resolveUploadPath: jest.fn((relativePath) => path.join(tempDir, String(relativePath))),
  toPublicUploadUrl: jest.fn((relativePath) => `/uploads/${String(relativePath).replace(/^\/+/, '')}`)
}));

await jest.unstable_mockModule('../services/ffmpegService.js', () => ({
  getVideoMetadata: jest.fn(async (absolutePath) => {
    const normalizedPath = String(absolutePath ?? '');

    if (normalizedPath.includes('short-reference')) {
      return {
        duration: 1,
        durationSecondsExact: 1.2,
        width: 640,
        height: 360
      };
    }

    if (normalizedPath.includes('low-res-reference')) {
      return {
        duration: 3,
        durationSecondsExact: 3,
        width: 320,
        height: 240
      };
    }

    if (normalizedPath.includes('low-pixel-reference')) {
      return {
        duration: 3,
        durationSecondsExact: 3,
        width: 640,
        height: 360
      };
    }

    return {
      duration: 3,
      durationSecondsExact: 3,
      width: 1280,
      height: 720
    };
  }),
  sliceVideoClip: jest.fn(async (_absolutePath, startTimeSeconds, endTimeSeconds, options = {}) => ({
    startTime: startTimeSeconds,
    endTime: endTimeSeconds,
    duration: Number((Number(endTimeSeconds) - Number(startTimeSeconds)).toFixed(3)),
    filePath: `${options.directory || 'shots'}/${options.basename || 'trimmed'}.mp4`,
    fileUrl: `/uploads/${options.directory || 'shots'}/${options.basename || 'trimmed'}.mp4`,
    engine: 'ffmpeg-slice-openh264'
  }))
}));

const {
  buildSeedDanceContentItems,
  buildSeedDanceRequestBody,
  getSeedDanceProviderStatus,
  estimateSeedDanceTaskProgress,
  getSeedDanceRemoteStatusLabel,
  resolveSeedDanceProviderDuration,
  resumeRemoteGenerationTask
} = await import(
  '../services/seedDanceService.js'
);

describe('seedDanceService', () => {
  const sampleVideoPath = path.join(tempDir, 'segment.mp4');
  const sampleImagePath = path.join(tempDir, 'character-front.png');
  const sampleAudioPath = path.join(tempDir, 'bgm.mp3');

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(sampleVideoPath, Buffer.from('fake-video-binary'));
    await writeFile(sampleImagePath, Buffer.from('fake-image-binary'));
    await writeFile(sampleAudioPath, Buffer.from('fake-audio-binary'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  test('builds Seedance content with text, reference images, remote reference videos and reference audios', async () => {
    const requestBody = await buildSeedDanceRequestBody({
      prompt: '请使用角色三视图与背景参考生成片段',
      sourceAbsolutePath: sampleVideoPath,
      sourcePublicUrl: 'https://example.com/source-segment.mp4',
      referenceImages: [{ url: '/uploads/character-front.png' }],
      referenceVideos: [{ url: 'https://example.com/background-reference.mp4' }],
      referenceAudios: [{ absolutePath: sampleAudioPath }]
    });

    expect(requestBody).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      ratio: '16:9',
      duration: 11,
      resolution: '720p',
      generate_audio: true,
      watermark: false
    });

    expect(requestBody.content[0]).toEqual({
      type: 'text',
      text: '请使用角色三视图与背景参考生成片段'
    });

    const imageItem = requestBody.content.find((item) => item.type === 'image_url');
    const videoItems = requestBody.content.filter((item) => item.type === 'video_url');
    const audioItem = requestBody.content.find((item) => item.type === 'audio_url');

    expect(imageItem).toMatchObject({
      role: 'reference_image',
      image_url: {
        url: expect.stringMatching(/^data:image\/png;base64,/u)
      }
    });
    expect(videoItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'reference_video',
          video_url: {
            url: 'https://example.com/source-segment.mp4'
          }
        }),
        expect.objectContaining({
          role: 'reference_video',
          video_url: {
            url: 'https://example.com/background-reference.mp4'
          }
        })
      ])
    );
    expect(audioItem).toMatchObject({
      role: 'reference_audio',
      audio_url: {
        url: expect.stringMatching(/^data:audio\/mpeg;base64,/u)
      }
    });
  });

  test('preserves remote urls, data urls and asset ids for reference images', async () => {
    const content = await buildSeedDanceContentItems({
      prompt: '参考图混合输入',
      referenceImages: [
        { url: 'https://example.com/character-front.png' },
        { url: 'data:image/png;base64,ZmFrZQ==' },
        { url: 'material:character-side-view' }
      ]
    });

    const imageUrls = content
      .filter((item) => item.type === 'image_url')
      .map((item) => item.image_url.url);

    expect(imageUrls).toEqual([
      'https://example.com/character-front.png',
      'data:image/png;base64,ZmFrZQ==',
      'material:character-side-view'
    ]);
  });

  test('allows per-segment duration overrides for Seedance task creation', async () => {
    const requestBody = await buildSeedDanceRequestBody({
      prompt: '按片段实际时长生成',
      duration: 9
    });

    expect(requestBody).toMatchObject({
      duration: 9
    });
  });

  test('normalizes too-short generation durations to the provider minimum', async () => {
    const requestBody = await buildSeedDanceRequestBody({
      prompt: '短镜头也需要满足 provider 最小时长',
      duration: 1
    });

    expect(resolveSeedDanceProviderDuration(1)).toBe(4);
    expect(requestBody).toMatchObject({
      duration: 4
    });
  });

  test('reports Seedance provider readiness for health checks', () => {
    expect(getSeedDanceProviderStatus()).toEqual(
      expect.objectContaining({
        ready: true,
        reason: '',
        model: 'doubao-seedance-2-0-260128',
        allow_mock_fallback: false,
        warning: expect.any(String)
      })
    );
  });

  test('maps remote task states to ui-friendly progress and labels', () => {
    expect(getSeedDanceRemoteStatusLabel('queued')).toBe('远端排队中');
    expect(getSeedDanceRemoteStatusLabel('running')).toBe('远端生成中');
    expect(estimateSeedDanceTaskProgress({ status: 'queued', pollCount: 1, currentProgress: 45 })).toBe(55);
    expect(estimateSeedDanceTaskProgress({ status: 'running', pollCount: 2, currentProgress: 55 })).toBe(78);
    expect(estimateSeedDanceTaskProgress({ status: 'succeeded', pollCount: 3, currentProgress: 78 })).toBe(97);
  });

  test('can resume an existing remote Seedance task and trim it back to the target duration', async () => {
    await mkdir(path.join(tempDir, 'outputs'), { recursive: true });

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'remote-task-1',
            status: 'succeeded',
            content: {
              video_url: 'https://example.com/generated-remote.mp4'
            },
            created_at: 1776823143,
            updated_at: 1776823886
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from('fake-remote-video-binary'), {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4'
          }
        })
      );
    const progressEvents = [];

    const resumedResult = await resumeRemoteGenerationTask({
      remoteTaskId: 'remote-task-1',
      basename: 'resumed-shot',
      duration: 1,
      onProgress: async (progressPayload) => {
        progressEvents.push(progressPayload);
      }
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(progressEvents.at(-1)).toMatchObject({
      taskId: 'remote-task-1',
      status: 'succeeded',
      progress: 97
    });
    expect(resumedResult).toMatchObject({
      remoteTaskId: 'remote-task-1',
      engine: 'seed-dance-remote',
      requestedDurationSeconds: 1,
      providerDurationSeconds: 4,
      filePath: 'outputs/resumed-shot-trimmed.mp4',
      fileUrl: '/uploads/outputs/resumed-shot-trimmed.mp4'
    });
  });

  test('skips local reference videos because Seedance requires web urls', async () => {
    const content = await buildSeedDanceContentItems({
      prompt: '只保留公网 reference_video',
      sourceAbsolutePath: sampleVideoPath,
      referenceVideos: [
        { absolutePath: sampleVideoPath },
        { url: '/uploads/local-segment.mp4' },
        { url: 'https://example.com/reference-video.mp4' }
      ]
    });

    const videoUrls = content
      .filter((item) => item.type === 'video_url')
      .map((item) => item.video_url.url);

    expect(videoUrls).toEqual(['https://example.com/reference-video.mp4']);
  });

  test('skips local upload reference videos shorter than the provider minimum duration', async () => {
    const content = await buildSeedDanceContentItems({
      prompt: '过滤过短 reference_video',
      sourceAbsolutePath: path.join(tempDir, 'short-reference.mp4'),
      sourcePublicUrl: 'https://example.com/short-reference.mp4',
      referenceVideos: [
        {
          url: 'https://example.com/long-reference.mp4',
          absolutePath: sampleVideoPath
        }
      ]
    });

    const videoUrls = content
      .filter((item) => item.type === 'video_url')
      .map((item) => item.video_url.url);

    expect(videoUrls).toEqual(['https://example.com/long-reference.mp4']);
  });

  test('skips local upload reference videos smaller than the provider minimum dimensions', async () => {
    const content = await buildSeedDanceContentItems({
      prompt: '过滤低分辨率 reference_video',
      sourceAbsolutePath: path.join(tempDir, 'low-res-reference.mp4'),
      sourcePublicUrl: 'https://example.com/low-res-reference.mp4',
      referenceVideos: [
        {
          url: 'https://example.com/long-reference.mp4',
          absolutePath: sampleVideoPath
        }
      ]
    });

    const videoUrls = content
      .filter((item) => item.type === 'video_url')
      .map((item) => item.video_url.url);

    expect(videoUrls).toEqual(['https://example.com/long-reference.mp4']);
  });

  test('skips local upload reference videos below the provider minimum pixel count', async () => {
    const content = await buildSeedDanceContentItems({
      prompt: '过滤低像素 reference_video',
      sourceAbsolutePath: path.join(tempDir, 'low-pixel-reference.mp4'),
      sourcePublicUrl: 'https://example.com/low-pixel-reference.mp4',
      referenceVideos: [
        {
          url: 'https://example.com/long-reference.mp4',
          absolutePath: sampleVideoPath
        }
      ]
    });

    const videoUrls = content
      .filter((item) => item.type === 'video_url')
      .map((item) => item.video_url.url);

    expect(videoUrls).toEqual(['https://example.com/long-reference.mp4']);
  });
});
