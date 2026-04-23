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
    EXTERNAL_REQUEST_TIMEOUT: 30000,
    SEED_DANCE_CREATE_TIMEOUT_MS: 120000,
    SEED_DANCE_DOWNLOAD_TIMEOUT_MS: 300000,
    SEED_DANCE_REFERENCE_VIDEO_MAX_DURATION_SECONDS: 15.2,
    PUBLIC_ASSET_BASE_URL: ''
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
  toAbsolutePublicUploadUrl: jest.fn(() => ''),
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

    if (normalizedPath.includes('near-limit-reference')) {
      return {
        duration: 13.7,
        durationSecondsExact: 13.7,
        width: 1280,
        height: 720
      };
    }

    if (normalizedPath.includes('background-five-seconds')) {
      return {
        duration: 5.04,
        durationSecondsExact: 5.04,
        width: 1280,
        height: 720
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

await jest.unstable_mockModule('../services/externalHttpService.js', () => ({
  requestExternalJson: jest.fn(async (url, init = {}) => {
    const response = await globalThis.fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body
    });
    const responseText = await response.text();

    return {
      response,
      responseText,
      responsePayload: responseText ? JSON.parse(responseText) : {}
    };
  }),
  downloadExternalBinary: jest.fn(async (url, init = {}) => {
    const response = await globalThis.fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body
    });
    const fileBuffer = Buffer.from(await response.arrayBuffer());

    return {
      response,
      fileBuffer
    };
  }),
  requestExternalText: jest.fn(async (url, init = {}) => {
    const response = await globalThis.fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body
    });
    const responseText = await response.text();

    return {
      response,
      responseText
    };
  }),
  getExternalDispatcher: jest.fn(() => undefined)
}));

const {
  buildSeedDanceContentItems,
  buildSeedDanceRequestBody,
  generateSegment,
  getSeedDanceProviderStatus,
  estimateSeedDanceTaskProgress,
  getSeedDanceRemoteStatusLabel,
  resolveSeedDanceProviderDuration,
  resumeRemoteGenerationTask
} = await import(
  '../services/seedDanceService.js'
);
const { duplicateToUploadPath } = await import('../services/fileService.js');

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

  test('returns the actual sent reference summaries for the final Seedance request', async () => {
    await mkdir(path.join(tempDir, 'outputs'), { recursive: true });

    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'remote-task-with-debug',
            status: 'queued'
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'remote-task-with-debug',
            status: 'succeeded',
            content: {
              video_url: 'https://example.com/generated-debug.mp4'
            }
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

    const result = await generateSegment({
      sourceAbsolutePath: sampleVideoPath,
      sourcePublicUrl: 'https://example.com/source-segment.mp4',
      sourceReferenceDisplayLabel: '小镜头源视频',
      prompt: '使用参考图调试清单',
      basename: 'request-debug',
      duration: 4,
      referenceImages: [
        {
          url: 'https://example.com/shot-frame.jpg',
          sourceKind: 'shot_representative_frame',
          displayLabel: '小镜头典型帧'
        },
        {
          url: 'https://example.com/character-front.png',
          sourceKind: 'character_asset',
          displayLabel: '@主角 三视图'
        }
      ],
      referenceVideos: [
        {
          url: 'https://example.com/background-reference.mp4',
          absolutePath: sampleVideoPath,
          sourceKind: 'background_asset_video',
          displayLabel: '#咖啡馆内景 背景资产视频'
        }
      ],
      referenceAudios: [
        {
          absolutePath: sampleAudioPath,
          sourceKind: 'shot_reference_audio',
          displayLabel: '小镜头参考音频'
        }
      ]
    });

    expect(result.sentReferenceImages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_kind: 'shot_representative_frame',
          label: '小镜头典型帧'
        }),
        expect.objectContaining({
          source_kind: 'character_asset',
          label: '@主角 三视图'
        })
      ])
    );
    expect(result.sentReferenceVideos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_kind: 'source_video',
          label: '小镜头源视频'
        }),
        expect.objectContaining({
          source_kind: 'background_asset_video',
          label: '#咖啡馆内景 背景资产视频'
        })
      ])
    );
    expect(result.sentReferenceAudios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_kind: 'shot_reference_audio',
          label: '小镜头参考音频'
        })
      ])
    );
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

  test('rejects overlong generation durations before creating a remote task', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(
      generateSegment({
        sourceAbsolutePath: sampleVideoPath,
        sourcePublicUrl: 'https://example.com/source-segment.mp4',
        prompt: '过长镜头需要先重新切分',
        basename: 'overlong-shot',
        duration: 59.5
      })
    ).rejects.toThrow(/最长只支持 15 秒生成/u);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(duplicateToUploadPath).not.toHaveBeenCalled();
  });

  test('rewrites provider-sensitive medical wording before creating a Seedance task', async () => {
    await mkdir(path.join(tempDir, 'outputs'), { recursive: true });

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'remote-safe-prompt-task',
            status: 'queued'
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'remote-safe-prompt-task',
            status: 'succeeded',
            content: {
              video_url: 'https://example.com/generated-safe-prompt.mp4'
            }
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

    const result = await generateSegment({
      sourceAbsolutePath: sampleVideoPath,
      sourcePublicUrl: 'https://example.com/source-segment.mp4',
      prompt: '人物身体不适，神情痛苦，手捂住胸口，桌上出现药盒。',
      basename: 'provider-safe-prompt',
      duration: 4
    });
    const firstCreateRequestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body ?? '{}'));
    const textPrompt = firstCreateRequestBody.content[0].text;

    expect(textPrompt).toContain('身体有些疲惫');
    expect(textPrompt).toContain('神情紧张');
    expect(textPrompt).toContain('上衣前侧');
    expect(textPrompt).toContain('小白盒');
    expect(textPrompt).not.toContain('身体不适');
    expect(textPrompt).not.toContain('药盒');
    expect(result.fallbackReason).toContain('seedance_provider_safe_prompt_rewrite');
  });

  test('never falls back to copying the source video when remote Seedance generation fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: 'provider exploded'
          }
        }),
        { status: 500 }
      )
    );

    await expect(
      generateSegment({
        sourceAbsolutePath: sampleVideoPath,
        sourcePublicUrl: 'https://example.com/source-segment.mp4',
        prompt: '必须真实调用 Seedance',
        basename: 'no-mock-fallback',
        duration: 4
      })
    ).rejects.toThrow(/Seed Dance request failed with status 500|provider exploded/u);

    expect(duplicateToUploadPath).not.toHaveBeenCalled();
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

  test('retries without frame-derived reference images when Seedance rejects a sensitive input image', async () => {
    await mkdir(path.join(tempDir, 'outputs'), { recursive: true });
    await mkdir(path.join(tempDir, 'frames'), { recursive: true });
    await mkdir(path.join(tempDir, 'resource-images'), { recursive: true });
    await writeFile(path.join(tempDir, 'frames', 'segment-shot-reference.jpg'), Buffer.from('fake-frame-binary'));
    await writeFile(path.join(tempDir, 'resource-images', 'character-front.png'), Buffer.from('fake-resource-binary'));

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'InputImageSensitiveContentDetected.PrivacyInformation',
              message: 'the input image may contain real person'
            }
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'remote-task-2',
            status: 'queued'
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'remote-task-2',
            status: 'succeeded',
            content: {
              video_url: 'https://example.com/generated-remote-2.mp4'
            }
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

    const result = await generateSegment({
      sourceAbsolutePath: sampleVideoPath,
      sourcePublicUrl: 'https://example.com/source-segment.mp4',
      prompt: '请严格还原当前镜头',
      basename: 'retry-sensitive-shot',
      duration: 1,
      referenceImages: [
        {
          relativePath: 'frames/segment-shot-reference.jpg',
          role: 'reference_image'
        },
        {
          relativePath: 'resource-images/character-front.png',
          role: 'reference_image'
        }
      ]
    });

    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const firstCreateRequestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body ?? '{}'));
    const secondCreateRequestBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body ?? '{}'));

    expect(firstCreateRequestBody.content.filter((item) => item.type === 'image_url')).toHaveLength(2);
    expect(secondCreateRequestBody.content.filter((item) => item.type === 'image_url')).toHaveLength(1);
    expect(result).toMatchObject({
      remoteTaskId: 'remote-task-2',
      fallbackReason: 'seedance_retried_without_frame_reference_images',
      filePath: 'outputs/retry-sensitive-shot-trimmed.mp4',
      fileUrl: '/uploads/outputs/retry-sensitive-shot-trimmed.mp4'
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

  test('keeps source reference video first and skips extra videos when total duration exceeds provider limit', async () => {
    const content = await buildSeedDanceContentItems({
      prompt: '长镜头优先保留小镜头源视频',
      sourceAbsolutePath: path.join(tempDir, 'near-limit-reference.mp4'),
      sourcePublicUrl: 'https://example.com/near-limit-reference.mp4',
      referenceVideos: [
        {
          url: 'https://example.com/background-five-seconds.mp4',
          absolutePath: path.join(tempDir, 'background-five-seconds.mp4')
        }
      ]
    });

    const videoUrls = content
      .filter((item) => item.type === 'video_url')
      .map((item) => item.video_url.url);

    expect(videoUrls).toEqual(['https://example.com/near-limit-reference.mp4']);
  });
});
