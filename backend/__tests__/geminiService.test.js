import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { jest } from '@jest/globals';

const requestExternalJsonMock = jest.fn();

await jest.unstable_mockModule('../config/env.js', () => ({
  default: Object.freeze({
    GEMINI_API_KEY: 'test-token',
    GEMINI_API_BASE_URL: 'https://yunwu.ai',
    GEMINI_MODEL: 'gemini-2.5-pro',
    GEMINI_SEGMENT_MODEL: 'gemini-2.5-flash',
    GEMINI_WHOLE_VIDEO_TIMEOUT_MS: 600000,
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

await jest.unstable_mockModule('../services/externalHttpService.js', () => ({
  requestExternalJson: requestExternalJsonMock
}));

const { analyzeSegment, analyzeVideo, optimizePrompt } = await import('../services/geminiService.js');

const backendRoot = path.resolve(process.cwd());
const tempDir = path.join(backendRoot, '.tmp', 'gemini-service-test');
const sampleVideoPath = path.join(tempDir, 'sample.mp4');

describe('geminiService', () => {
  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(sampleVideoPath, Buffer.from('fake-mp4-binary'));

    requestExternalJsonMock.mockReset();
    requestExternalJsonMock.mockResolvedValue({
      response: {
        status: 200
      },
      responseText: JSON.stringify({
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
      }),
      responsePayload: {
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
      }
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
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

    expect(requestExternalJsonMock).toHaveBeenCalledTimes(1);
    expect(requestExternalJsonMock.mock.calls[0][0]).toBe(
      'https://yunwu.ai/v1beta/models/gemini-2.5-pro:generateContent?key=test-token'
    );

    const requestOptions = requestExternalJsonMock.mock.calls[0][1];
    const requestBody = JSON.parse(requestOptions.body);
    const parts = requestBody.contents[0].parts;

    expect(requestOptions.method).toBe('POST');
    expect(requestOptions.timeoutMs).toBe(600000);
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
    expect(parts[1].text).toContain('后续可独立生成的大剧情片段');
    expect(parts[1].text).toContain('backgroundId');
    expect(parts[1].text).toContain('backgroundAction');
    expect(parts[1].text).toContain('真实剪辑边界');
    expect(parts[1].text).toContain('shots 是后续小镜头切片与生成的唯一真值来源');
    expect(parts[1].text).toContain('人物在画面中的左/中/右位置');
    expect(parts[1].text).toContain('前景/中景/后景');
    expect(parts[1].text).toContain('视线反打');
    expect(parts[1].text).toContain('进出画方式');
    expect(parts[1].text).toContain('一次性包含整片剧情、角色、场景资源、大片段和每个大片段下的全部小镜头信息');
    expect(parts[1].text).toContain('观众能明显感知到的真实镜头都拆出来');
    expect(parts[1].text).toContain('时间请尽量精确到 0.1 秒');
    expect(parts[1].text).toContain('representativeFrameNote 需要说明这个时间点对应的关键画面');
    expect(requestBody.generationConfig).toMatchObject({
      temperature: 0.2,
      responseMimeType: 'application/json'
    });
  });

  test('does not fall back to another auth variant during whole-video analysis', async () => {
    requestExternalJsonMock.mockReset();
    requestExternalJsonMock.mockResolvedValueOnce({
      response: {
        status: 401
      },
      responseText: JSON.stringify({ error: { message: 'Unauthorized' } }),
      responsePayload: {
        error: {
          message: 'Unauthorized'
        }
      }
      });

    await expect(
      analyzeVideo({
        video: {
          filename: 'sample.mp4'
        },
        metadata: {
          duration: 3
        },
        videoAbsolutePath: sampleVideoPath
      })
    ).rejects.toThrow('Gemini-2.5-pro 整片分析失败');

    expect(requestExternalJsonMock).toHaveBeenCalledTimes(1);
    expect(requestExternalJsonMock.mock.calls[0][0]).toBe(
      'https://yunwu.ai/v1beta/models/gemini-2.5-pro:generateContent?key=test-token'
    );
  });

  test('does not fall back to another model during whole-video analysis', async () => {
    requestExternalJsonMock.mockReset();
    requestExternalJsonMock.mockResolvedValueOnce({
      response: {
        status: 429
      },
      responseText: JSON.stringify({
        error: {
          message: '当前分组上游负载已饱和，请稍后再试',
          code: 'model_not_found'
        }
      }),
      responsePayload: {
        error: {
          message: '当前分组上游负载已饱和，请稍后再试',
          code: 'model_not_found'
        }
      }
      });

    await expect(
      analyzeVideo({
        video: {
          filename: 'sample.mp4'
        },
        metadata: {
          duration: 3
        },
        videoAbsolutePath: sampleVideoPath
      })
    ).rejects.toThrow('Gemini-2.5-pro 整片分析失败');

    expect(requestExternalJsonMock).toHaveBeenCalledTimes(1);
    expect(requestExternalJsonMock.mock.calls[0][0]).toBe(
      'https://yunwu.ai/v1beta/models/gemini-2.5-pro:generateContent?key=test-token'
    );
  });

  test('surfaces a clear timeout error for whole-video analysis', async () => {
    requestExternalJsonMock.mockReset();
    requestExternalJsonMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));

    await expect(
      analyzeVideo({
        video: {
          filename: 'sample.mp4'
        },
        metadata: {
          duration: 3
        },
        videoAbsolutePath: sampleVideoPath
      })
    ).rejects.toThrow(
      'Gemini-2.5-pro 整片分析超时：整段视频上传与理解超过 600 秒，请稍后重试，或调大后端 GEMINI_WHOLE_VIDEO_TIMEOUT_MS。'
    );
  });

  test('backfills background bindings and reuse action when Gemini omits explicit linkage', async () => {
    requestExternalJsonMock.mockReset();
    requestExternalJsonMock.mockResolvedValue({
      response: {
        status: 200
      },
      responseText: JSON.stringify({
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
      }),
      responsePayload: {
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
      }
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
    requestExternalJsonMock.mockReset();
    requestExternalJsonMock.mockResolvedValue({
      response: {
        status: 200
      },
      responseText: JSON.stringify({
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
                    prompt: '@主角 从 #咖啡馆内景 走到 #街道夜景，镜头跟拍转场。'
                  })
                }
              ]
            }
          }
        ]
      }),
      responsePayload: {
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
                    prompt: '@主角 从 #咖啡馆内景 走到 #街道夜景，镜头跟拍转场。'
                  })
                }
              ]
            }
          }
        ]
      }
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

    const requestBody = JSON.parse(requestExternalJsonMock.mock.calls[0][1].body);
    const promptText = requestBody.contents[0].parts[1].text;

    expect(promptText).toContain('"scenes"');
    expect(promptText).toContain('#场景名');
    expect(promptText).toContain('如果片段中出现多个场景');
    expect(result.scenes).toEqual(['咖啡馆内景', '街道夜景']);
    expect(result.prompt).toContain('#街道夜景');
  });

  test('includes scene resources when optimizing prompts', async () => {
    requestExternalJsonMock.mockReset();
    requestExternalJsonMock.mockResolvedValue({
      response: {
        status: 200
      },
      responseText: JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    optimizedPrompt: '@主角 在 #咖啡馆内景 中完成更稳定的表演调度。'
                  })
                }
              ]
            }
          }
        ]
      }),
      responsePayload: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    optimizedPrompt: '@主角 在 #咖啡馆内景 中完成更稳定的表演调度。'
                  })
                }
              ]
            }
          }
        ]
      }
    });

    const result = await optimizePrompt({
      prompt: '主角 在 咖啡馆内景 中完成更稳定的表演调度。',
      characters: [{ name: '主角', appearancePrompt: '角色外观' }],
      backgrounds: [{ name: '咖啡馆内景', scenePrompt: '暖黄咖啡馆内景' }]
    });

    const requestBody = JSON.parse(requestExternalJsonMock.mock.calls[0][1].body);
    const promptText = requestBody.contents[0].parts[0].text;

    expect(promptText).toContain('场景资源库');
    expect(promptText).toContain('#场景名');
    expect(result.optimizedPrompt).toContain('#咖啡馆内景');
  });

  test('optimizes character resources without scene mentions and with white background constraints', async () => {
    requestExternalJsonMock.mockReset();
    requestExternalJsonMock.mockResolvedValue({
      response: {
        status: 200
      },
      responseText: JSON.stringify({
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
      }),
      responsePayload: {
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
      }
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

    const requestBody = JSON.parse(requestExternalJsonMock.mock.calls[0][1].body);
    const promptText = requestBody.contents[0].parts[0].text;

    expect(promptText).toContain('角色资源提示词优化助手');
    expect(promptText).toContain('纯白无缝背景');
    expect(promptText).not.toContain('场景资源库');
    expect(result.optimizedPrompt).toContain('纯白无缝背景');
    expect(result.optimizedPrompt).not.toContain('#咖啡馆内景');
  });

  test('optimizes shot generation prompts with blocking and camera detail requirements', async () => {
    requestExternalJsonMock.mockReset();
    requestExternalJsonMock.mockResolvedValue({
      response: {
        status: 200
      },
      responseText: JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    optimizedPrompt:
                      '@主角 位于画面左侧前景，在 #咖啡馆内景 中朝右前方快步推进，保持中近景、侧前方机位、稳定跟拍和明确视线关系。'
                  })
                }
              ]
            }
          }
        ]
      }),
      responsePayload: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    optimizedPrompt:
                      '@主角 位于画面左侧前景，在 #咖啡馆内景 中朝右前方快步推进，保持中近景、侧前方机位、稳定跟拍和明确视线关系。'
                  })
                }
              ]
            }
          }
        ]
      }
    });

    const result = await optimizePrompt({
      prompt: '@主角 走向 #咖啡馆内景 门口。',
      mode: 'shot_generation',
      segmentPrompt: '@主角 在 #咖啡馆内景 中与店员短暂对视后转身离开。',
      shotPrompt: '@主角 走向 #咖啡馆内景 门口。',
      characters: [{ name: '主角', appearancePrompt: '黑色短发，米色风衣' }],
      backgrounds: [{ name: '咖啡馆内景', scenePrompt: '暖黄灯光咖啡馆，木质桌椅' }],
      sceneNames: ['咖啡馆内景'],
      characterNames: ['主角']
    });

    const requestBody = JSON.parse(requestExternalJsonMock.mock.calls[0][1].body);
    const promptText = requestBody.contents[0].parts[0].text;

    expect(promptText).toContain('镜头级视频生成提示词优化助手');
    expect(promptText).toContain('人物在画面中的左/中/右位置');
    expect(promptText).toContain('进出画方式');
    expect(promptText).toContain('尽量还原原片镜头语言');
    expect(result.optimizedPrompt).toContain('@主角');
    expect(result.optimizedPrompt).toContain('#咖啡馆内景');
  });
});
