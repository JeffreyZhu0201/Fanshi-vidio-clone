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

const { analyzeSegment, analyzeVideo, optimizePrompt } = await import('../services/geminiService.js');

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
                      characters: [
                        {
                          id: 'character_1',
                          name: '主角',
                          appearancePrompt: '角色外观',
                          personalityPrompt: '冷静克制，观察力强',
                          representativeFrameTime: 1.2,
                          representativeFrameNote: '人物正面稳定镜头'
                        }
                      ],
                      backgrounds: [
                        {
                          id: 'background_1',
                          name: '咖啡馆内景',
                          description: '背景描述',
                          scenePrompt: '电影感咖啡馆内景提示词',
                          representativeFrameTime: 2.1
                        }
                      ],
                      timeAnchors: [
                        {
                          startTime: 0,
                          endTime: 3,
                          sceneSummary: '镜头摘要',
                          scenePrompt: '镜头场景提示词',
                          representativeFrameTime: 1.5,
                          backgroundId: 'background_1',
                          backgroundAction: 'create_new',
                          backgroundName: '咖啡馆内景'
                        }
                      ]
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
    expect(parts[1].text).toContain('representativeFrameTime');
    expect(parts[1].text).toContain('personalityPrompt');
    expect(parts[1].text).toContain('scenePrompt');
    expect(parts[1].text).toContain('可独立生成的片段');
    expect(parts[1].text).toContain('backgroundId');
    expect(parts[1].text).toContain('backgroundAction');
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
                        characters: [
                          {
                            id: 'character_1',
                            name: '主角',
                            appearancePrompt: '角色外观',
                            personalityPrompt: '冷静克制，观察力强',
                            representativeFrameTime: 1.2
                          }
                        ],
                        backgrounds: [
                          {
                            id: 'background_1',
                            description: '背景描述',
                            scenePrompt: '电影感背景提示词'
                          }
                        ],
                        timeAnchors: [
                          {
                            startTime: 0,
                            endTime: 3,
                            sceneSummary: '镜头摘要',
                            scenePrompt: '镜头场景提示词',
                            representativeFrameTime: 1.5,
                            backgroundId: 'background_1',
                            backgroundAction: 'create_new',
                            backgroundName: '咖啡馆内景'
                          }
                        ]
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

  test('backfills background bindings and reuse action when Gemini omits explicit linkage', async () => {
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
                        characters: [
                          {
                            id: 'character_1',
                            name: '主角',
                            appearancePrompt: '角色外观',
                            personalityPrompt: '冷静克制，观察力强',
                            representativeFrameTime: 1.2
                          }
                        ],
                      backgrounds: [
                        {
                          id: 'background_cafe',
                          name: '咖啡馆内景',
                          description: '暖色灯光的咖啡馆',
                          scenePrompt: '电影感咖啡馆内景提示词',
                          representativeFrameTime: 2.1
                        }
                      ],
                      timeAnchors: [
                        {
                          startTime: 0,
                          endTime: 3,
                          sceneSummary: '第一段咖啡馆动作',
                          scenePrompt: '咖啡馆靠窗座位，暖色灯光'
                        },
                        {
                          startTime: 3,
                          endTime: 6,
                          sceneSummary: '第二段咖啡馆动作',
                          scenePrompt: '咖啡馆靠窗座位，暖色灯光'
                        }
                      ]
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
        duration: 6
      },
      videoAbsolutePath: sampleVideoPath
    });

    expect(result.backgrounds).toHaveLength(1);
    expect(result.timeAnchors).toHaveLength(2);
    expect(result.timeAnchors[0]).toMatchObject({
      backgroundId: 'background_cafe',
      backgroundAction: 'create_new',
      backgroundName: '咖啡馆内景'
    });
    expect(result.timeAnchors[1]).toMatchObject({
      backgroundId: 'background_cafe',
      backgroundAction: 'reuse_existing',
      backgroundName: '咖啡馆内景'
    });
  });

  test('requests and parses segment scene mentions', async () => {
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
                      characters: ['主角'],
                      scenes: ['咖啡馆内景', '街道夜景'],
                      scene: '角色从咖啡馆转到街道',
                      action: '推门离开并走向街道',
                      prompt: '@主角 从 @咖啡馆内景 走到 @街道夜景，镜头跟拍转场。'
                    })
                  }
                ]
              }
            }
          ]
        })
    });

    const result = await analyzeSegment({
      segment: {
        segmentIndex: 0,
        startTime: 0,
        endTime: 4,
        analysis: {
          backgroundId: 'background_1',
          backgroundName: '咖啡馆内景',
          backgroundAction: 'create_new'
        }
      },
      overallAnalysis: {
        plot: '主角从咖啡馆离开走向街道。',
        characters: [{ name: '主角', appearancePrompt: '角色外观' }],
        backgrounds: [
          { id: 'background_1', name: '咖啡馆内景', scenePrompt: '暖黄咖啡馆内景' },
          { id: 'background_2', name: '街道夜景', scenePrompt: '霓虹街道夜景' }
        ]
      },
      segmentAbsolutePath: sampleVideoPath
    });

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const promptText = requestBody.contents[0].parts[1].text;

    expect(promptText).toContain('"scenes"');
    expect(promptText).toContain('@场景名');
    expect(promptText).toContain('如果片段中出现多个场景');
    expect(result.scenes).toEqual(['咖啡馆内景', '街道夜景']);
    expect(result.prompt).toContain('@街道夜景');
  });

  test('includes scene resources when optimizing prompts', async () => {
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
                      optimizedPrompt: '@主角 在 @咖啡馆内景 中完成更稳定的表演调度。'
                    })
                  }
                ]
              }
            }
          ]
        })
    });

    const result = await optimizePrompt({
      prompt: '主角 在 咖啡馆内景 中完成更稳定的表演调度。',
      characters: [{ name: '主角', appearancePrompt: '角色外观' }],
      backgrounds: [{ name: '咖啡馆内景', scenePrompt: '暖黄咖啡馆内景' }]
    });

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const promptText = requestBody.contents[0].parts[0].text;

    expect(promptText).toContain('场景资源库');
    expect(promptText).toContain('@场景名');
    expect(result.optimizedPrompt).toContain('@咖啡馆内景');
  });

  test('optimizes character resources without scene mentions and with white background constraints', async () => {
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
                      optimizedPrompt:
                        '外表描述：黑色短发，米色风衣；性格气质：冷静克制，观察力强；纯白无缝背景，单人全身角色三视图设定。'
                    })
                  }
                ]
              }
            }
          ]
        })
    });

    const result = await optimizePrompt({
      prompt: '外表描述：黑色短发，米色风衣\n性格气质：冷静克制，观察力强',
      characters: [
        {
          name: '主角',
          appearancePrompt: '黑色短发，米色风衣',
          personalityPrompt: '冷静克制，观察力强'
        }
      ],
      backgrounds: [{ name: '咖啡馆内景', scenePrompt: '暖黄咖啡馆内景' }],
      mode: 'character_resource'
    });

    const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const promptText = requestBody.contents[0].parts[0].text;

    expect(promptText).toContain('角色资源提示词优化助手');
    expect(promptText).toContain('纯白无缝背景');
    expect(promptText).not.toContain('场景资源库');
    expect(result.optimizedPrompt).toContain('纯白无缝背景');
    expect(result.optimizedPrompt).not.toContain('@咖啡馆内景');
  });
});
