import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { jest } from '@jest/globals';

await jest.unstable_mockModule('../config/env.js', () => ({
  default: Object.freeze({
    GEMINI_API_KEY: 'test-token',
    GEMINI_API_BASE_URL: 'https://yunwu.ai',
    GEMINI_MODEL: 'gemini-2.5-pro',
    GEMINI_SEGMENT_MODEL: 'gemini-2.5-flash',
    GEMINI_API_COMPAT_MODE: 'google',
    GEMINI_STRICT_REMOTE: true,
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

const { analyzeVideo } = await import('../services/geminiService.js');

const backendRoot = path.resolve(process.cwd());
const tempDir = path.join(backendRoot, '.tmp', 'gemini-service-test');
const sampleVideoPath = path.join(tempDir, 'sample.mp4');

describe('geminiService', () => {
  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(sampleVideoPath, Buffer.from('fake-mp4-binary'));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      plot: '剧情摘要',
                      characters: [{ id: 'character_1', name: '主角', appearancePrompt: '角色外观' }],
                      backgrounds: [{ id: 'background_1', description: '背景描述' }],
                      timeAnchors: [{ startTime: 0, endTime: 3, sceneSummary: '镜头摘要' }]
                    })
                  }
                ]
              }
            }
          ]
        })
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    delete global.fetch;
  });

  test('sends yunwu generateContent payload with inline_data before text prompt', async () => {
    await analyzeVideo({
      video: {
        filename: 'sample.mp4'
      },
      metadata: {
        duration: 3
      },
      videoAbsolutePath: sampleVideoPath
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe(
      'https://yunwu.ai/v1beta/models/gemini-2.5-pro:generateContent?key=test-token'
    );

    const requestOptions = global.fetch.mock.calls[0][1];
    const requestBody = JSON.parse(requestOptions.body);
    const parts = requestBody.contents[0].parts;

    expect(requestOptions.method).toBe('POST');
    expect(requestOptions.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json'
    });
    expect(parts[0].inline_data.mime_type).toBe('video/mp4');
    expect(parts[0].inline_data.data).toBeTruthy();
    expect(parts[1].text).toContain('整体视频理解');
    expect(parts[1].text).toContain('返回结构必须完全符合');
    expect(requestBody.generationConfig).toMatchObject({
      temperature: 0.2,
      responseMimeType: 'application/json'
    });
  });

  test('falls back to query-key auth when bearer auth gets rejected', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'Unauthorized' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        plot: '剧情摘要',
                        characters: [{ id: 'character_1', name: '主角', appearancePrompt: '角色外观' }],
                        backgrounds: [{ id: 'background_1', description: '背景描述' }],
                        timeAnchors: [{ startTime: 0, endTime: 3, sceneSummary: '镜头摘要' }]
                      })
                    }
                  ]
                }
              }
            ]
          })
      });

    const result = await analyzeVideo({
      video: {
        filename: 'sample.mp4'
      },
      metadata: {
        duration: 3
      },
      videoAbsolutePath: sampleVideoPath
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toBe(
      'https://yunwu.ai/v1beta/models/gemini-2.5-pro:generateContent?key=test-token'
    );
    expect(global.fetch.mock.calls[1][0]).toBe(
      'https://yunwu.ai/v1beta/models/gemini-2.5-pro:generateContent?key=test-token'
    );
    expect(global.fetch.mock.calls[1][1].headers).toEqual({
      'Content-Type': 'application/json'
    });

    const geminiMeta = JSON.parse(result.geminiResponse);

    expect(geminiMeta.authVariant).toBe('query-key');
    expect(geminiMeta.isMock).toBe(false);
  });
});
