import { jest } from '@jest/globals';

// Mock dependencies
await jest.unstable_mockModule('../../shared/styleTemplates.js', () => ({
  DEFAULT_STYLE_MODE: 'comic_drama',
  normalizeStyleMode: jest.fn((value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    return ['realistic', 'comic_drama'].includes(normalized) ? normalized : 'comic_drama';
  }),
  resolveStyleTemplate: jest.fn(({ styleMode, templateKey }) => {
    if (templateKey === 'videoGenerationStylePrompt') {
      if (styleMode === 'realistic') {
        return '整体视觉风格保持写实影视质感';
      }
      return '整体视觉风格保持国漫影视化';
    }
    return '';
  })
}));

const { buildFullVideoPrompt } = await import('../services/generationService.js');

describe('buildFullVideoPrompt', () => {
  const mockAnalysis = {
    characters: [
      { id: 'char1', name: '露西' },
      { id: 'char2', name: '杰森' }
    ],
    backgrounds: [
      { id: 'bg1', name: '礼堂入口' },
      { id: 'bg2', name: '礼堂外' }
    ],
    timeAnchors: [
      {
        shots: [
          {
            id: 'shot1',
            startTime: 0,
            endTime: 4,
            prompt: '大全景，缓慢推进。@露西 站在 #礼堂入口',
            speech: null
          },
          {
            id: 'shot2',
            startTime: 4,
            endTime: 7,
            prompt: '中景，固定镜头。@杰森 在 #礼堂外',
            speech: {
              hasDialogue: true,
              transcript: 'Hello',
              speechStyle: '平静'
            }
          }
        ]
      }
    ]
  };

  const mockVideo = {
    id: 1,
    filename: 'test.mp4',
    duration: 10
  };

  describe('Basic prompt construction', () => {
    test('should build prompt with all sections', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {},
        useReferenceVideo: true,
        useReferenceFrame: true
      });

      expect(result).toContain('【风格】');
      expect(result).toContain('【角色】');
      expect(result).toContain('【场景】');
      expect(result).toContain('【分镜头】');
    });

    test('should include style prompt in correct section', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【风格】整体视觉风格保持写实影视质感');
    });

    test('should use comic_drama style when specified', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'comic_drama',
        styleTemplates: {}
      });

      expect(result).toContain('【风格】整体视觉风格保持国漫影视化');
    });
  });

  describe('Character reference formatting', () => {
    test('should format character list correctly', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('@char1露西');
      expect(result).toContain('@char2杰森');
      expect(result).toContain('、');
    });

    test('should handle single character', () => {
      const singleCharAnalysis = {
        ...mockAnalysis,
        characters: [{ id: 'char1', name: '露西' }]
      };

      const result = buildFullVideoPrompt({
        analysis: singleCharAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【角色】@char1露西');
      // Check that character section doesn't have separator (but scene section might)
      const characterSection = result.match(/【角色】[^\n【]+/)?.[0] || '';
      expect(characterSection).toBe('【角色】@char1露西');
    });

    test('should handle empty characters array', () => {
      const emptyAnalysis = {
        ...mockAnalysis,
        characters: []
      };

      const result = buildFullVideoPrompt({
        analysis: emptyAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【角色】无');
    });

    test('should handle missing characters field', () => {
      const noCharAnalysis = {
        ...mockAnalysis,
        characters: undefined
      };

      const result = buildFullVideoPrompt({
        analysis: noCharAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【角色】无');
    });

    test('should handle characters with missing id or name', () => {
      const partialCharAnalysis = {
        ...mockAnalysis,
        characters: [
          { id: 'char1', name: '' },
          { id: '', name: '杰森' },
          { id: 'char3', name: '玛丽' }
        ]
      };

      const result = buildFullVideoPrompt({
        analysis: partialCharAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('@char1');
      expect(result).toContain('@杰森');
      expect(result).toContain('@char3玛丽');
    });
  });

  describe('Scene reference formatting', () => {
    test('should format scene list correctly', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('@bg1礼堂入口');
      expect(result).toContain('@bg2礼堂外');
    });

    test('should handle single scene', () => {
      const singleSceneAnalysis = {
        ...mockAnalysis,
        backgrounds: [{ id: 'bg1', name: '礼堂入口' }]
      };

      const result = buildFullVideoPrompt({
        analysis: singleSceneAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【场景】@bg1礼堂入口');
      // Check that scene section doesn't have separator (but character section might)
      const sceneSection = result.match(/【场景】[^\n【]+/)?.[0] || '';
      expect(sceneSection).toBe('【场景】@bg1礼堂入口');
    });

    test('should handle empty backgrounds array', () => {
      const emptyAnalysis = {
        ...mockAnalysis,
        backgrounds: []
      };

      const result = buildFullVideoPrompt({
        analysis: emptyAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【场景】无');
    });

    test('should handle missing backgrounds field', () => {
      const noSceneAnalysis = {
        ...mockAnalysis,
        backgrounds: undefined
      };

      const result = buildFullVideoPrompt({
        analysis: noSceneAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【场景】无');
    });
  });

  describe('Shot timing formatting', () => {
    test('should format shot with time range', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【0.0-4.0秒】');
      expect(result).toContain('【4.0-7.0秒】');
    });

    test('should handle fractional time values', () => {
      const fractionalAnalysis = {
        ...mockAnalysis,
        timeAnchors: [
          {
            shots: [
              {
                id: 'shot1',
                startTime: 0.5,
                endTime: 3.75,
                prompt: '测试镜头',
                speech: null
              }
            ]
          }
        ]
      };

      const result = buildFullVideoPrompt({
        analysis: fractionalAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【0.5-3.8秒】');
    });

    test('should include shot id in description', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('镜头shot1：');
      expect(result).toContain('镜头shot2：');
    });

    test('should include shot prompt', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('大全景，缓慢推进。@露西 站在 #礼堂入口');
      expect(result).toContain('中景，固定镜头。@杰森 在 #礼堂外');
    });
  });

  describe('Dialogue formatting', () => {
    test('should include dialogue when present', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('对白口型指导："Hello"');
      expect(result).toContain('说话方式：平静');
    });

    test('should show no dialogue when speech is null', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('对白口型指导：无对白');
    });

    test('should handle dialogue without speechStyle', () => {
      const noStyleAnalysis = {
        ...mockAnalysis,
        timeAnchors: [
          {
            shots: [
              {
                id: 'shot1',
                startTime: 0,
                endTime: 4,
                prompt: '测试镜头',
                speech: {
                  hasDialogue: true,
                  transcript: 'Hello'
                }
              }
            ]
          }
        ]
      };

      const result = buildFullVideoPrompt({
        analysis: noStyleAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('对白口型指导："Hello"');
      expect(result).not.toContain('说话方式：');
    });

    test('should handle hasDialogue false', () => {
      const noDialogueAnalysis = {
        ...mockAnalysis,
        timeAnchors: [
          {
            shots: [
              {
                id: 'shot1',
                startTime: 0,
                endTime: 4,
                prompt: '测试镜头',
                speech: {
                  hasDialogue: false,
                  transcript: ''
                }
              }
            ]
          }
        ]
      };

      const result = buildFullVideoPrompt({
        analysis: noDialogueAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('对白口型指导：无对白');
    });

    test('should handle empty transcript', () => {
      const emptyTranscriptAnalysis = {
        ...mockAnalysis,
        timeAnchors: [
          {
            shots: [
              {
                id: 'shot1',
                startTime: 0,
                endTime: 4,
                prompt: '测试镜头',
                speech: {
                  hasDialogue: true,
                  transcript: ''
                }
              }
            ]
          }
        ]
      };

      const result = buildFullVideoPrompt({
        analysis: emptyTranscriptAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('对白口型指导：无对白');
    });
  });

  describe('Edge cases', () => {
    test('should handle empty shots array', () => {
      const emptyAnalysis = {
        ...mockAnalysis,
        timeAnchors: [{ shots: [] }]
      };

      const result = buildFullVideoPrompt({
        analysis: emptyAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【分镜头】');
      expect(result).not.toContain('【0.0-');
    });

    test('should handle empty timeAnchors array', () => {
      const emptyAnalysis = {
        ...mockAnalysis,
        timeAnchors: []
      };

      const result = buildFullVideoPrompt({
        analysis: emptyAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【分镜头】');
    });

    test('should handle missing timeAnchors field', () => {
      const noAnchorsAnalysis = {
        ...mockAnalysis,
        timeAnchors: undefined
      };

      const result = buildFullVideoPrompt({
        analysis: noAnchorsAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【分镜头】');
    });

    test('should handle multiple timeAnchors with multiple shots', () => {
      const multiAnalysis = {
        ...mockAnalysis,
        timeAnchors: [
          {
            shots: [
              {
                id: 'shot1',
                startTime: 0,
                endTime: 2,
                prompt: '第一个镜头',
                speech: null
              }
            ]
          },
          {
            shots: [
              {
                id: 'shot2',
                startTime: 2,
                endTime: 4,
                prompt: '第二个镜头',
                speech: null
              },
              {
                id: 'shot3',
                startTime: 4,
                endTime: 6,
                prompt: '第三个镜头',
                speech: null
              }
            ]
          }
        ]
      };

      const result = buildFullVideoPrompt({
        analysis: multiAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【0.0-2.0秒】');
      expect(result).toContain('【2.0-4.0秒】');
      expect(result).toContain('【4.0-6.0秒】');
      expect(result).toContain('第一个镜头');
      expect(result).toContain('第二个镜头');
      expect(result).toContain('第三个镜头');
    });

    test('should handle no characters and no scenes', () => {
      const minimalAnalysis = {
        characters: [],
        backgrounds: [],
        timeAnchors: [
          {
            shots: [
              {
                id: 'shot1',
                startTime: 0,
                endTime: 4,
                prompt: '空镜头',
                speech: null
              }
            ]
          }
        ]
      };

      const result = buildFullVideoPrompt({
        analysis: minimalAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toContain('【角色】无');
      expect(result).toContain('【场景】无');
      expect(result).toContain('空镜头');
    });
  });

  describe('Input validation', () => {
    test('should throw error for invalid analysis object', () => {
      expect(() => {
        buildFullVideoPrompt({
          analysis: null,
          video: mockVideo,
          styleMode: 'realistic',
          styleTemplates: {}
        });
      }).toThrow('Invalid analysis object');
    });

    test('should throw error for non-object analysis', () => {
      expect(() => {
        buildFullVideoPrompt({
          analysis: 'not an object',
          video: mockVideo,
          styleMode: 'realistic',
          styleTemplates: {}
        });
      }).toThrow('Invalid analysis object');
    });

    test('should throw error for invalid video object', () => {
      expect(() => {
        buildFullVideoPrompt({
          analysis: mockAnalysis,
          video: null,
          styleMode: 'realistic',
          styleTemplates: {}
        });
      }).toThrow('Invalid video object');
    });

    test('should throw error for invalid styleMode', () => {
      expect(() => {
        buildFullVideoPrompt({
          analysis: mockAnalysis,
          video: mockVideo,
          styleMode: null,
          styleTemplates: {}
        });
      }).toThrow('Invalid styleMode');
    });

    test('should throw error for invalid styleTemplates', () => {
      expect(() => {
        buildFullVideoPrompt({
          analysis: mockAnalysis,
          video: mockVideo,
          styleMode: 'realistic',
          styleTemplates: 'not an object'
        });
      }).toThrow('Invalid styleTemplates');
    });
  });

  describe('Prompt structure', () => {
    test('should separate sections with double newlines', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      const sections = result.split('\n\n');
      expect(sections.length).toBeGreaterThanOrEqual(5); // Style, Characters, Scenes, Shot header, at least one shot
    });

    test('should maintain correct section order', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      const styleIndex = result.indexOf('【风格】');
      const charIndex = result.indexOf('【角色】');
      const sceneIndex = result.indexOf('【场景】');
      const shotIndex = result.indexOf('【分镜头】');

      expect(styleIndex).toBeLessThan(charIndex);
      expect(charIndex).toBeLessThan(sceneIndex);
      expect(sceneIndex).toBeLessThan(shotIndex);
    });

    test('should return non-empty string', () => {
      const result = buildFullVideoPrompt({
        analysis: mockAnalysis,
        video: mockVideo,
        styleMode: 'realistic',
        styleTemplates: {}
      });

      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
