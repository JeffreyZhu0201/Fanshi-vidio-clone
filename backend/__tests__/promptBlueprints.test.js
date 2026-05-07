import { describe, it, expect } from '@jest/globals';
import {
  buildVideoAnalysisPromptSections,
  buildVideoAnalysisPrompt
} from '../../shared/promptBlueprints.js';

describe('Prompt Blueprints', () => {
  describe('buildVideoAnalysisPromptSections', () => {
    const mockVideo = {
      filename: 'test-video.mp4',
      duration: 30
    };

    const mockMetadata = {
      duration: 30
    };

    describe('voiceProfile schema', () => {
      it('should include voiceProfile in character schema when parseAudio is true', () => {
        const result = buildVideoAnalysisPromptSections({
          video: mockVideo,
          metadata: mockMetadata,
          analysisOptions: {
            parseAudio: true,
            extractSubtitles: false,
            styleMode: 'realistic'
          }
        });

        expect(result.finalPrompt).toContain('voiceProfile');
        expect(result.finalPrompt).toContain('timbre');
        expect(result.finalPrompt).toContain('tone');
        expect(result.finalPrompt).toContain('pace');
        expect(result.finalPrompt).toContain('emotion');
        expect(result.finalPrompt).toContain('intensity');
        expect(result.finalPrompt).toContain('articulation');
        expect(result.finalPrompt).toContain('summary');
      });

      it('should include voiceProfile when extractSubtitles is true', () => {
        const result = buildVideoAnalysisPromptSections({
          video: mockVideo,
          metadata: mockMetadata,
          analysisOptions: {
            parseAudio: false,
            extractSubtitles: true,
            styleMode: 'realistic'
          }
        });

        expect(result.finalPrompt).toContain('voiceProfile');
      });

      it('should not include voiceProfile when both parseAudio and extractSubtitles are false', () => {
        const result = buildVideoAnalysisPromptSections({
          video: mockVideo,
          metadata: mockMetadata,
          analysisOptions: {
            parseAudio: false,
            extractSubtitles: false,
            styleMode: 'realistic'
          }
        });

        expect(result.finalPrompt).not.toContain('voiceProfile');
      });

      it('should include voice extraction instructions when audio parsing enabled', () => {
        const result = buildVideoAnalysisPromptSections({
          video: mockVideo,
          metadata: mockMetadata,
          analysisOptions: {
            parseAudio: true,
            styleMode: 'realistic'
          }
        });

        expect(result.finalPrompt).toContain('音色');
        expect(result.finalPrompt).toContain('语气');
        expect(result.finalPrompt).toContain('语速');
      });

      it('should handle default analysisOptions (parseAudio defaults to true)', () => {
        const result = buildVideoAnalysisPromptSections({
          video: mockVideo,
          metadata: mockMetadata,
          analysisOptions: null
        });

        // Default is true, so voiceProfile should be included
        expect(result.finalPrompt).toContain('voiceProfile');
      });
    });

    describe('sceneId in timeAnchors', () => {
      it('should include sceneId field in timeAnchors schema', () => {
        const result = buildVideoAnalysisPromptSections({
          video: mockVideo,
          metadata: mockMetadata,
          analysisOptions: {
            styleMode: 'realistic'
          }
        });

        expect(result.finalPrompt).toContain('sceneId');
      });

      it('should include segment划分 guidance', () => {
        const result = buildVideoAnalysisPromptSections({
          video: mockVideo,
          metadata: mockMetadata,
          analysisOptions: {
            styleMode: 'realistic'
          }
        });

        expect(result.finalPrompt).toContain('场景');
        expect(result.finalPrompt).toContain('片段');
      });
    });

    describe('JSON schema structure', () => {
      it('should include complete character schema with voiceProfile', () => {
        const result = buildVideoAnalysisPromptSections({
          video: mockVideo,
          metadata: mockMetadata,
          analysisOptions: {
            parseAudio: true,
            styleMode: 'realistic'
          }
        });

        // Parse the JSON schema from the prompt
        const jsonMatch = result.finalPrompt.match(/\{[\s\S]*?"characters"[\s\S]*?\}/);
        expect(jsonMatch).toBeTruthy();

        const promptText = result.finalPrompt;
        expect(promptText).toContain('"id": "character_1"');
        expect(promptText).toContain('"name": "角色名"');
        expect(promptText).toContain('"appearancePrompt"');
        expect(promptText).toContain('"personalityPrompt"');
        expect(promptText).toContain('"voiceProfile"');
      });

      it('should include complete timeAnchor schema with sceneId', () => {
        const result = buildVideoAnalysisPromptSections({
          video: mockVideo,
          metadata: mockMetadata,
          analysisOptions: {
            styleMode: 'realistic'
          }
        });

        const promptText = result.finalPrompt;
        expect(promptText).toContain('"timeAnchors"');
        expect(promptText).toContain('"sceneId"');
        expect(promptText).toContain('"sceneSummary"');
        expect(promptText).toContain('"shots"');
      });
    });
  });

  describe('buildVideoAnalysisPrompt', () => {
    it('should return finalPrompt string', () => {
      const result = buildVideoAnalysisPrompt({
        video: { filename: 'test.mp4', duration: 30 },
        metadata: { duration: 30 },
        analysisOptions: {
          parseAudio: true,
          styleMode: 'realistic'
        }
      });

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('voiceProfile');
    });
  });
});
