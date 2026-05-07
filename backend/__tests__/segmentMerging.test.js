import { describe, it, expect } from '@jest/globals';

// These functions will be implemented in analysisService.js
let extractSceneKeywords;
let isSameScene;
let mergeAdjacentSegments;

describe('Segment Merging Logic', () => {
  beforeAll(async () => {
    const module = await import('../services/analysisService.js');
    extractSceneKeywords = module.extractSceneKeywords;
    isSameScene = module.isSameScene;
    mergeAdjacentSegments = module.mergeAdjacentSegments;
  });

  describe('extractSceneKeywords', () => {
    it('should extract common scene keywords from Chinese text', () => {
      const keywords = extractSceneKeywords('学生在教室里上课');
      expect(keywords).toContain('教室');
    });

    it('should extract multiple keywords', () => {
      const keywords = extractSceneKeywords('从礼堂入口走到走廊');
      expect(keywords).toContain('礼堂');
      expect(keywords).toContain('走廊');
    });

    it('should handle text with no keywords', () => {
      const keywords = extractSceneKeywords('一些普通的描述');
      expect(keywords).toEqual([]);
    });

    it('should handle empty string', () => {
      const keywords = extractSceneKeywords('');
      expect(keywords).toEqual([]);
    });

    it('should handle null/undefined', () => {
      expect(extractSceneKeywords(null)).toEqual([]);
      expect(extractSceneKeywords(undefined)).toEqual([]);
    });

    it('should extract indoor/outdoor keywords', () => {
      const keywords1 = extractSceneKeywords('室内场景');
      expect(keywords1).toContain('室内');

      const keywords2 = extractSceneKeywords('室外街道');
      expect(keywords2).toContain('室外');
    });

    it('should be case insensitive', () => {
      const keywords = extractSceneKeywords('在教室里');
      expect(keywords).toContain('教室');
    });
  });

  describe('isSameScene', () => {
    it('should return true for segments with same sceneId', () => {
      const seg1 = { sceneId: 'scene_classroom', sceneSummary: '教室内' };
      const seg2 = { sceneId: 'scene_classroom', sceneSummary: '教室内（延续）' };
      expect(isSameScene(seg1, seg2)).toBe(true);
    });

    it('should return false for segments with different sceneId', () => {
      const seg1 = { sceneId: 'scene_classroom', sceneSummary: '教室内' };
      const seg2 = { sceneId: 'scene_hallway', sceneSummary: '走廊' };
      expect(isSameScene(seg1, seg2)).toBe(false);
    });

    it('should use keyword matching when sceneId is missing', () => {
      const seg1 = { sceneSummary: '学生在教室里上课' };
      const seg2 = { sceneSummary: '老师在教室讲台上' };
      expect(isSameScene(seg1, seg2)).toBe(true);
    });

    it('should return false when no common keywords', () => {
      const seg1 = { sceneSummary: '在教室里' };
      const seg2 = { sceneSummary: '在操场上' };
      expect(isSameScene(seg1, seg2)).toBe(false);
    });

    it('should handle segments without sceneSummary', () => {
      const seg1 = { sceneId: 'scene_1' };
      const seg2 = { sceneId: 'scene_2' };
      expect(isSameScene(seg1, seg2)).toBe(false);
    });

    it('should prioritize sceneId over keyword matching', () => {
      const seg1 = { sceneId: 'scene_classroom', sceneSummary: '教室' };
      const seg2 = { sceneId: 'scene_hallway', sceneSummary: '教室旁边的走廊' };
      // Even though both mention 教室, different sceneIds should return false
      expect(isSameScene(seg1, seg2)).toBe(false);
    });
  });

  describe('mergeAdjacentSegments', () => {
    it('should merge two adjacent segments with same sceneId', () => {
      const timeAnchors = [
        {
          startTime: 0,
          endTime: 10,
          sceneId: 'scene_classroom',
          sceneSummary: '教室内',
          shots: [{ id: 'shot_1' }]
        },
        {
          startTime: 10,
          endTime: 20,
          sceneId: 'scene_classroom',
          sceneSummary: '教室内继续',
          shots: [{ id: 'shot_2' }]
        }
      ];

      const merged = mergeAdjacentSegments(timeAnchors);

      expect(merged).toHaveLength(1);
      expect(merged[0].startTime).toBe(0);
      expect(merged[0].endTime).toBe(20);
      expect(merged[0].shots).toHaveLength(2);
      expect(merged[0].sceneSummary).toContain('延续');
    });

    it('should not merge segments with different sceneId', () => {
      const timeAnchors = [
        {
          startTime: 0,
          endTime: 10,
          sceneId: 'scene_classroom',
          sceneSummary: '教室内',
          shots: [{ id: 'shot_1' }]
        },
        {
          startTime: 10,
          endTime: 20,
          sceneId: 'scene_hallway',
          sceneSummary: '走廊',
          shots: [{ id: 'shot_2' }]
        }
      ];

      const merged = mergeAdjacentSegments(timeAnchors);

      expect(merged).toHaveLength(2);
      expect(merged[0].sceneId).toBe('scene_classroom');
      expect(merged[1].sceneId).toBe('scene_hallway');
    });

    it('should merge multiple consecutive same-scene segments', () => {
      const timeAnchors = [
        {
          startTime: 0,
          endTime: 10,
          sceneId: 'scene_classroom',
          sceneSummary: '教室',
          shots: [{ id: 'shot_1' }]
        },
        {
          startTime: 10,
          endTime: 20,
          sceneId: 'scene_classroom',
          sceneSummary: '教室',
          shots: [{ id: 'shot_2' }]
        },
        {
          startTime: 20,
          endTime: 30,
          sceneId: 'scene_classroom',
          sceneSummary: '教室',
          shots: [{ id: 'shot_3' }]
        }
      ];

      const merged = mergeAdjacentSegments(timeAnchors);

      expect(merged).toHaveLength(1);
      expect(merged[0].startTime).toBe(0);
      expect(merged[0].endTime).toBe(30);
      expect(merged[0].shots).toHaveLength(3);
    });

    it('should handle empty array', () => {
      const merged = mergeAdjacentSegments([]);
      expect(merged).toEqual([]);
    });

    it('should handle single segment', () => {
      const timeAnchors = [
        {
          startTime: 0,
          endTime: 10,
          sceneId: 'scene_classroom',
          sceneSummary: '教室',
          shots: []
        }
      ];

      const merged = mergeAdjacentSegments(timeAnchors);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual(timeAnchors[0]);
    });

    it('should handle null/undefined input', () => {
      expect(mergeAdjacentSegments(null)).toEqual(null);
      expect(mergeAdjacentSegments(undefined)).toEqual(undefined);
    });

    it('should preserve all segment properties', () => {
      const timeAnchors = [
        {
          startTime: 0,
          endTime: 10,
          sceneId: 'scene_classroom',
          sceneSummary: '教室',
          scenePrompt: '明亮的教室',
          backgroundName: '教室',
          representativeFrameTime: 5,
          shots: [{ id: 'shot_1' }]
        },
        {
          startTime: 10,
          endTime: 20,
          sceneId: 'scene_classroom',
          sceneSummary: '教室继续',
          scenePrompt: '教室内',
          backgroundName: '教室',
          representativeFrameTime: 15,
          shots: [{ id: 'shot_2' }]
        }
      ];

      const merged = mergeAdjacentSegments(timeAnchors);

      expect(merged).toHaveLength(1);
      expect(merged[0].scenePrompt).toBeDefined();
      expect(merged[0].backgroundName).toBe('教室');
      expect(merged[0].representativeFrameTime).toBeDefined();
    });
  });
});
