import { describe, it, expect } from '@jest/globals';
import { Analysis } from '../../models/index.js';

describe('Analysis Model', () => {

  describe('voiceProfile field', () => {
    it('should accept characters with voiceProfile', async () => {
      const characterWithVoice = {
        id: 'character_1',
        name: '张老师',
        appearancePrompt: '中年男性，戴眼镜',
        personalityPrompt: '严肃认真',
        voiceProfile: {
          timbre: '低沉',
          tone: '严厉',
          pace: '正常',
          emotion: '平静',
          intensity: '有力',
          articulation: '清晰',
          summary: '声音低沉有力，语气严厉，吐字清晰'
        },
        representativeFrameTime: 1.2,
        representativeFrameNote: '正面特写',
        stateTimeline: []
      };

      const analysis = Analysis.build({
        videoId: 1,
        plot: 'Test plot',
        characters: [characterWithVoice],
        backgrounds: [],
        timeAnchors: []
      });

      expect(analysis.characters).toHaveLength(1);
      expect(analysis.characters[0].voiceProfile).toBeDefined();
      expect(analysis.characters[0].voiceProfile.timbre).toBe('低沉');
      expect(analysis.characters[0].voiceProfile.tone).toBe('严厉');
      expect(analysis.characters[0].voiceProfile.pace).toBe('正常');
      expect(analysis.characters[0].voiceProfile.emotion).toBe('平静');
      expect(analysis.characters[0].voiceProfile.intensity).toBe('有力');
      expect(analysis.characters[0].voiceProfile.articulation).toBe('清晰');
      expect(analysis.characters[0].voiceProfile.summary).toBe('声音低沉有力，语气严厉，吐字清晰');
    });

    it('should accept characters without voiceProfile (backward compatibility)', async () => {
      const characterWithoutVoice = {
        id: 'character_2',
        name: '李同学',
        appearancePrompt: '年轻女性',
        personalityPrompt: '活泼开朗',
        representativeFrameTime: 2.5,
        representativeFrameNote: '侧面中景',
        stateTimeline: []
      };

      const analysis = Analysis.build({
        videoId: 2,
        plot: 'Test plot',
        characters: [characterWithoutVoice],
        backgrounds: [],
        timeAnchors: []
      });

      expect(analysis.characters).toHaveLength(1);
      expect(analysis.characters[0].voiceProfile).toBeUndefined();
      expect(analysis.characters[0].name).toBe('李同学');
    });

    it('should accept characters with partial voiceProfile', async () => {
      const characterWithPartialVoice = {
        id: 'character_3',
        name: '王校长',
        appearancePrompt: '老年男性',
        personalityPrompt: '和蔼可亲',
        voiceProfile: {
          timbre: '沙哑',
          summary: '声音沙哑但温和'
        },
        representativeFrameTime: 3.0,
        stateTimeline: []
      };

      const analysis = Analysis.build({
        videoId: 3,
        plot: 'Test plot',
        characters: [characterWithPartialVoice],
        backgrounds: [],
        timeAnchors: []
      });

      expect(analysis.characters[0].voiceProfile).toBeDefined();
      expect(analysis.characters[0].voiceProfile.timbre).toBe('沙哑');
      expect(analysis.characters[0].voiceProfile.summary).toBe('声音沙哑但温和');
      expect(analysis.characters[0].voiceProfile.tone).toBeUndefined();
    });

    it('should accept empty voiceProfile fields for non-speaking characters', async () => {
      const nonSpeakingCharacter = {
        id: 'character_4',
        name: '路人甲',
        appearancePrompt: '背景人物',
        voiceProfile: {
          timbre: '',
          tone: '',
          pace: '',
          emotion: '',
          intensity: '',
          articulation: '',
          summary: ''
        },
        representativeFrameTime: 4.0,
        stateTimeline: []
      };

      const analysis = Analysis.build({
        videoId: 4,
        plot: 'Test plot',
        characters: [nonSpeakingCharacter],
        backgrounds: [],
        timeAnchors: []
      });

      expect(analysis.characters[0].voiceProfile).toBeDefined();
      expect(analysis.characters[0].voiceProfile.summary).toBe('');
    });
  });

  describe('sceneId field in timeAnchors', () => {
    it('should accept timeAnchors with sceneId', async () => {
      const timeAnchorWithSceneId = {
        startTime: 0,
        endTime: 10,
        sceneId: 'scene_classroom',
        sceneSummary: '教室内',
        shots: []
      };

      const analysis = Analysis.build({
        videoId: 5,
        plot: 'Test plot',
        characters: [],
        backgrounds: [],
        timeAnchors: [timeAnchorWithSceneId]
      });

      expect(analysis.timeAnchors).toHaveLength(1);
      expect(analysis.timeAnchors[0].sceneId).toBe('scene_classroom');
      expect(analysis.timeAnchors[0].sceneSummary).toBe('教室内');
    });

    it('should accept timeAnchors without sceneId (backward compatibility)', async () => {
      const timeAnchorWithoutSceneId = {
        startTime: 0,
        endTime: 10,
        sceneSummary: '走廊',
        shots: []
      };

      const analysis = Analysis.build({
        videoId: 6,
        plot: 'Test plot',
        characters: [],
        backgrounds: [],
        timeAnchors: [timeAnchorWithoutSceneId]
      });

      expect(analysis.timeAnchors).toHaveLength(1);
      expect(analysis.timeAnchors[0].sceneId).toBeUndefined();
      expect(analysis.timeAnchors[0].sceneSummary).toBe('走廊');
    });

    it('should accept multiple timeAnchors with different sceneIds', async () => {
      const timeAnchors = [
        {
          startTime: 0,
          endTime: 10,
          sceneId: 'scene_classroom',
          sceneSummary: '教室内',
          shots: []
        },
        {
          startTime: 10,
          endTime: 20,
          sceneId: 'scene_hallway',
          sceneSummary: '走廊',
          shots: []
        },
        {
          startTime: 20,
          endTime: 30,
          sceneId: 'scene_classroom',
          sceneSummary: '教室内（延续）',
          shots: []
        }
      ];

      const analysis = Analysis.build({
        videoId: 7,
        plot: 'Test plot',
        characters: [],
        backgrounds: [],
        timeAnchors
      });

      expect(analysis.timeAnchors).toHaveLength(3);
      expect(analysis.timeAnchors[0].sceneId).toBe('scene_classroom');
      expect(analysis.timeAnchors[1].sceneId).toBe('scene_hallway');
      expect(analysis.timeAnchors[2].sceneId).toBe('scene_classroom');
    });
  });
});
