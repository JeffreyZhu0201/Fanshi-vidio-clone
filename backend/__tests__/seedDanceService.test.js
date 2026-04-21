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
  resolveUploadPath: jest.fn((relativePath) => path.join(tempDir, String(relativePath))),
  toPublicUploadUrl: jest.fn((relativePath) => `/uploads/${String(relativePath).replace(/^\/+/, '')}`)
}));

const {
  buildSeedDanceContentItems,
  buildSeedDanceRequestBody,
  getSeedDanceProviderStatus,
  estimateSeedDanceTaskProgress,
  getSeedDanceRemoteStatusLabel
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
});
