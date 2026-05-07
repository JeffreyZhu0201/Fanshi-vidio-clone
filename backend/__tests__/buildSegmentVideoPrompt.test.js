import { describe, it, expect } from '@jest/globals';
import {
  buildSegmentVideoPrompt,
  expandResourceReferences,
  extractCharacterIds,
  extractSceneIds,
  buildCharacterSection,
  buildSceneSection,
  buildShotsSection
} from '../../shared/promptBlueprints.js';

describe('buildSegmentVideoPrompt', () => {
  const mockAnalysis = {
    characters: [
      {
        id: 'char_1',
        name: '张老师',
        appearancePrompt: '中年男性，戴眼镜，穿西装',
        personalityPrompt: '严肃认真',
        voiceProfile: {
          timbre: '低沉',
          tone: '严厉',
          pace: '正常',
          emotion: '平静',
          intensity: '有力',
          articulation: '清晰',
          summary: '声音低沉有力，语气严厉，吐字清晰'
        }
      },
      {
        id: 'char_2',
        name: '李同学',
        appearancePrompt: '年轻女性，长发，校服',
        personalityPrompt: '活泼开朗'
        // No voiceProfile (non-speaking character)
      }
    ],
    backgrounds: [
      {
        id: 'bg_1',
        name: '教室',
        prompt: '明亮的教室，白色墙壁，黑板，课桌椅'
      },
      {
        id: 'bg_2',
        name: '走廊',
        prompt: '学校走廊，窗户，储物柜'
      }
    ]
  };

  const mockSegment = {
    id: 1,
    startTime: 0,
    endTime: 10,
    sceneId: 'scene_classroom',
    analysis: {
      shots: [
        {
          id: 'shot_1',
          startTime: 0,
          endTime: 5,
          prompt: '@char_1 站在 #bg_1 讲台上讲课',
          shotType: '中景',
          cameraMovement: '固定镜头',
          speech: {
            transcript: '同学们，今天我们学习新课',
            speechStyle: '语速正常，语气严肃'
          },
          characterStateRefs: [{ characterId: 'char_1' }]
        },
        {
          id: 'shot_2',
          startTime: 5,
          endTime: 10,
          prompt: '@char_2 坐在 #bg_1 座位上听讲',
          shotType: '近景',
          cameraMovement: '固定镜头',
          speech: null
        }
      ]
    }
  };

  const mockStyleTemplates = {
    videoGenerationStylePrompt: '真人写实电影风格'
  };

  describe('extractCharacterIds', () => {
    it('should extract character IDs from shot prompts', () => {
      const ids = extractCharacterIds(mockSegment);
      expect(ids).toContain('char_1');
      expect(ids).toContain('char_2');
    });

    it('should extract character IDs from characterStateRefs', () => {
      const segment = {
        analysis: {
          shots: [
            {
              prompt: 'some prompt',
              characterStateRefs: [{ characterId: 'char_3' }]
            }
          ]
        }
      };
      const ids = extractCharacterIds(segment);
      expect(ids).toContain('char_3');
    });

    it('should return empty array for segment without shots', () => {
      const ids = extractCharacterIds({ analysis: { shots: [] } });
      expect(ids).toEqual([]);
    });
  });

  describe('extractSceneIds', () => {
    it('should extract scene IDs from shot prompts', () => {
      const ids = extractSceneIds(mockSegment);
      expect(ids).toContain('bg_1');
    });

    it('should extract scene ID from segment backgroundId', () => {
      const segment = {
        backgroundId: 'bg_2',
        analysis: { shots: [] }
      };
      const ids = extractSceneIds(segment);
      expect(ids).toContain('bg_2');
    });

    it('should return empty array for segment without scenes', () => {
      const ids = extractSceneIds({ analysis: { shots: [] } });
      expect(ids).toEqual([]);
    });
  });

  describe('expandResourceReferences', () => {
    it('should expand @characterID to full character description', () => {
      const text = '@char_1 在教室里';
      const expanded = expandResourceReferences(text, mockAnalysis);
      expect(expanded).toContain('张老师');
      expect(expanded).toContain('中年男性，戴眼镜，穿西装');
    });

    it('should expand #sceneID to full scene description', () => {
      const text = '在 #bg_1 中';
      const expanded = expandResourceReferences(text, mockAnalysis);
      expect(expanded).toContain('教室');
      expect(expanded).toContain('明亮的教室，白色墙壁，黑板，课桌椅');
    });

    it('should expand both character and scene references', () => {
      const text = '@char_1 站在 #bg_1 讲台上';
      const expanded = expandResourceReferences(text, mockAnalysis);
      expect(expanded).toContain('张老师');
      expect(expanded).toContain('教室');
    });

    it('should handle text without references', () => {
      const text = '普通文本';
      const expanded = expandResourceReferences(text, mockAnalysis);
      expect(expanded).toBe('普通文本');
    });

    it('should handle empty text', () => {
      const expanded = expandResourceReferences('', mockAnalysis);
      expect(expanded).toBe('');
    });
  });

  describe('buildCharacterSection', () => {
    it('should build character section with voiceProfile', () => {
      const section = buildCharacterSection(mockSegment, mockAnalysis);
      expect(section).toContain('【角色】');
      expect(section).toContain('张老师');
      expect(section).toContain('音色特征');
      expect(section).toContain('声音低沉有力，语气严厉，吐字清晰');
    });

    it('should build character section without voiceProfile', () => {
      const segment = {
        analysis: {
          shots: [{ prompt: '@char_2 在教室' }]
        }
      };
      const section = buildCharacterSection(segment, mockAnalysis);
      expect(section).toContain('李同学');
      expect(section).not.toContain('音色特征');
    });

    it('should return "无" when no characters', () => {
      const segment = { analysis: { shots: [] } };
      const section = buildCharacterSection(segment, mockAnalysis);
      expect(section).toContain('【角色】');
      expect(section).toContain('无');
    });
  });

  describe('buildSceneSection', () => {
    it('should build scene section', () => {
      const section = buildSceneSection(mockSegment, mockAnalysis);
      expect(section).toContain('【场景】');
      expect(section).toContain('教室');
      expect(section).toContain('明亮的教室，白色墙壁，黑板，课桌椅');
    });

    it('should return "无" when no scenes', () => {
      const segment = { analysis: { shots: [] } };
      const section = buildSceneSection(segment, mockAnalysis);
      expect(section).toContain('【场景】');
      expect(section).toContain('无');
    });
  });

  describe('buildShotsSection', () => {
    it('should build shots section with expanded references', () => {
      const section = buildShotsSection(mockSegment, mockAnalysis);
      expect(section).toContain('【分镜头】');
      expect(section).toContain('【0-5秒】镜头1');
      expect(section).toContain('张老师');
      expect(section).toContain('教室');
      expect(section).toContain('对白口型指导："同学们，今天我们学习新课"');
    });

    it('should handle shots without dialogue', () => {
      const section = buildShotsSection(mockSegment, mockAnalysis);
      expect(section).toContain('【5-10秒】镜头2');
      expect(section).toContain('对白口型指导：无对白');
    });

    it('should return "无" when no shots', () => {
      const segment = { analysis: { shots: [] } };
      const section = buildShotsSection(segment, mockAnalysis);
      expect(section).toContain('【分镜头】');
      expect(section).toContain('无');
    });
  });

  describe('buildSegmentVideoPrompt', () => {
    it('should build complete segment video prompt', () => {
      const prompt = buildSegmentVideoPrompt({
        segment: mockSegment,
        analysis: mockAnalysis,
        styleMode: 'realistic',
        styleTemplates: mockStyleTemplates
      });

      expect(prompt).toContain('【风格】');
      expect(prompt).toContain('【角色】');
      expect(prompt).toContain('【场景】');
      expect(prompt).toContain('【分镜头】');
      expect(prompt).toContain('张老师');
      expect(prompt).toContain('音色特征');
      expect(prompt).toContain('教室');
    });

    it('should expand resource references in prompt', () => {
      const prompt = buildSegmentVideoPrompt({
        segment: mockSegment,
        analysis: mockAnalysis,
        styleMode: 'realistic',
        styleTemplates: mockStyleTemplates
      });

      // Should not contain raw references
      expect(prompt).not.toContain('@char_1');
      expect(prompt).not.toContain('#bg_1');

      // Should contain expanded descriptions
      expect(prompt).toContain('张老师（中年男性，戴眼镜，穿西装）');
      expect(prompt).toContain('教室（明亮的教室，白色墙壁，黑板，课桌椅）');
    });
  });
});
