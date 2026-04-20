import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { jest } from '@jest/globals';

const backendRoot = process.cwd();
const tempDir = path.join(backendRoot, '.tmp', 'gemini-image-service-test');

await jest.unstable_mockModule('../config/env.js', () => ({
  default: Object.freeze({
    GEMINI_API_KEY: '',
    GEMINI_API_BASE_URL: 'https://yunwu.ai',
    GEMINI_IMAGE_API_KEY: 'image-test-key',
    GEMINI_IMAGE_API_BASE_URL:
      'https://yunwu.ai/v1beta/models/gemini-3-pro-image-preview:generateContent',
    GEMINI_IMAGE_MODEL: 'gemini-3-pro-image-preview',
    GEMINI_IMAGE_STRICT_REMOTE: true,
    GEMINI_IMAGE_REQUEST_TIMEOUT: 30000,
    GEMINI_IMAGE_ASPECT_RATIO: '',
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
  createOutputRelativePath: jest.fn((directory, basename, extension = '.png') =>
    `${directory}/${basename}${extension}`
  ),
  ensureParentDirectory: jest.fn(async () => {
    await mkdir(path.join(tempDir, 'resource-images'), { recursive: true });
  }),
  resolveUploadPath: jest.fn((relativePath) => path.join(tempDir, String(relativePath))),
  toPublicUploadUrl: jest.fn((relativePath) => `/uploads/${String(relativePath).replace(/^\/+/, '')}`)
}));

const {
  buildGeminiImagePayload,
  extractGeneratedImages,
  generateImageAsset
} = await import('../services/geminiImageService.js');

describe('geminiImageService', () => {
  afterEach(async () => {
    delete global.fetch;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('builds IMAGE-only generation payload', () => {
    expect(buildGeminiImagePayload('生成角色三视图')).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: '生成角色三视图'
            }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {}
      }
    });
  });

  test('extracts image parts from Gemini image response', () => {
    expect(
      extractGeneratedImages({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: 'ZmFrZS1pbWFnZS1iYXNlNjQ='
                  }
                }
              ]
            }
          }
        ]
      })
    ).toEqual([
      {
        mimeType: 'image/png',
        data: 'ZmFrZS1pbWFnZS1iYXNlNjQ='
      }
    ]);
  });

  test('generates image assets through yunwu-compatible generateContent endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: Buffer.from('fake-image').toString('base64')
                    }
                  }
                ]
              }
            }
          ]
        })
    });

    const result = await generateImageAsset({
      prompt: '生成角色正面三视图',
      basename: 'character-front'
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://yunwu.ai/v1beta/models/gemini-3-pro-image-preview:generateContent?key=image-test-key',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer image-test-key'
        })
      })
    );
    expect(result).toMatchObject({
      filePath: 'resource-images/character-front.png',
      fileUrl: '/uploads/resource-images/character-front.png',
      mimeType: 'image/png',
      provider: 'remote-gemini-image',
      model: 'gemini-3-pro-image-preview',
      authVariant: 'bearer+query-key'
    });
  });
});
