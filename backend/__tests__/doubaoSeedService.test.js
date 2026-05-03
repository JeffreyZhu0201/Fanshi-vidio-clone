import { jest } from '@jest/globals';

let mockEnv = {
  SEED_DANCE_API_KEY: 'test-ark-api-key',
  PUBLIC_ASSET_BASE_URL: 'https://test.example.com',
  SEED_DANCE_STRICT_REMOTE: false
};

const mockRequestExternalJson = jest.fn();
const mockToAbsolutePublicUploadUrl = jest.fn();

jest.unstable_mockModule('../config/env.js', () => ({
  default: new Proxy({}, {
    get(target, prop) {
      return mockEnv[prop];
    }
  })
}));

jest.unstable_mockModule('../services/externalHttpService.js', () => ({
  requestExternalJson: mockRequestExternalJson
}));

jest.unstable_mockModule('../services/fileService.js', () => ({
  toAbsolutePublicUploadUrl: mockToAbsolutePublicUploadUrl
}));

jest.unstable_mockModule('../middleware/errorHandler.js', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode, details) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
    }
  }
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const {
  getDoubaoSeedProviderStatus,
  assertDoubaoSeedReady,
  analyzeVideoWithDoubaoSeed,
  analyzeVideoComplete
} = await import('../services/doubaoSeedService.js');

describe('doubaoSeedService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv = {
      SEED_DANCE_API_KEY: 'test-ark-api-key',
      PUBLIC_ASSET_BASE_URL: 'https://test.example.com',
      SEED_DANCE_STRICT_REMOTE: false
    };
  });

  describe('getDoubaoSeedProviderStatus', () => {
    it('should return ready status when API key and PUBLIC_ASSET_BASE_URL are configured', () => {
      const status = getDoubaoSeedProviderStatus();

      expect(status.ready).toBe(true);
      expect(status.reason).toBe('');
      expect(status.model).toBe('doubao-seed-2-0-lite-260215');
      expect(status.api_base_url).toBe('https://ark.cn-beijing.volces.com');
    });

    it('should return not ready when PUBLIC_ASSET_BASE_URL is missing', () => {
      mockEnv.PUBLIC_ASSET_BASE_URL = '';

      const status = getDoubaoSeedProviderStatus();

      expect(status.ready).toBe(false);
      expect(status.reason).toContain('PUBLIC_ASSET_BASE_URL');
    });

    it('should return correct mock fallback setting', () => {
      const status = getDoubaoSeedProviderStatus();

      expect(typeof status.allow_mock_fallback).toBe('boolean');
    });
  });

  describe('assertDoubaoSeedReady', () => {
    it('should not throw when provider is ready', () => {
      expect(() => assertDoubaoSeedReady()).not.toThrow();
    });

    it('should throw when PUBLIC_ASSET_BASE_URL is missing', () => {
      mockEnv.PUBLIC_ASSET_BASE_URL = '';

      expect(() => assertDoubaoSeedReady()).toThrow('Doubao-Seed 未配置完成');
    });
  });

  describe('analyzeVideoWithDoubaoSeed', () => {
    it('should analyze video successfully and return result', async () => {
      const mockAnalysisResult = JSON.stringify({
        plot: 'Test plot',
        characters: [],
        backgrounds: []
      });

      mockRequestExternalJson.mockResolvedValue({
        response: { ok: true, status: 200 },
        responsePayload: {
          choices: [
            {
              message: {
                content: mockAnalysisResult
              }
            }
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 200
          }
        }
      });

      const result = await analyzeVideoWithDoubaoSeed(
        'https://test.example.com/uploads/video.mp4',
        'Analyze this video'
      );

      expect(result).toBe(mockAnalysisResult);
      expect(mockRequestExternalJson).toHaveBeenCalledWith(
        'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-ark-api-key',
            'Content-Type': 'application/json'
          }),
          timeoutMs: 600000
        })
      );

      // Verify request body structure
      const callBody = JSON.parse(mockRequestExternalJson.mock.calls[0][1].body);
      expect(callBody.model).toBe('doubao-seed-2-0-lite-260215');
      expect(callBody.messages[0].role).toBe('user');
      expect(callBody.messages[0].content[0].type).toBe('video_url');
      expect(callBody.messages[0].content[0].video_url.url).toBe('https://test.example.com/uploads/video.mp4');
      expect(callBody.messages[0].content[0].video_url.fps).toBe('5');
      expect(callBody.messages[0].content[1].type).toBe('text');
      expect(callBody.messages[0].content[1].text).toBe('Analyze this video');
    });

    it('should use custom options when provided', async () => {
      mockRequestExternalJson.mockResolvedValue({
        response: { ok: true, status: 200 },
        responsePayload: {
          choices: [{ message: { content: 'result' } }]
        }
      });

      await analyzeVideoWithDoubaoSeed(
        'https://test.example.com/uploads/video.mp4',
        'prompt',
        {
          temperature: 0.5,
          maxTokens: 8000,
          fps: 3
        }
      );

      const callBody = JSON.parse(mockRequestExternalJson.mock.calls[0][1].body);
      expect(callBody.temperature).toBe(0.5);
      expect(callBody.max_tokens).toBe(8000);
      expect(callBody.messages[0].content[0].video_url.fps).toBe('3');
    });

    it('should throw error when analysis fails', async () => {
      mockRequestExternalJson.mockResolvedValue({
        response: { ok: false, status: 500 },
        responsePayload: {
          error: { message: 'Internal server error' }
        }
      });

      await expect(
        analyzeVideoWithDoubaoSeed('https://test.example.com/uploads/video.mp4', 'prompt')
      ).rejects.toThrow('Doubao-Seed 视频分析失败');
    });

    it('should throw error when response is missing content', async () => {
      mockRequestExternalJson.mockResolvedValue({
        response: { ok: true, status: 200 },
        responsePayload: {
          choices: [] // Empty choices
        }
      });

      await expect(
        analyzeVideoWithDoubaoSeed('https://test.example.com/uploads/video.mp4', 'prompt')
      ).rejects.toThrow('Doubao-Seed 分析响应缺少内容');
    });
  });

  describe('analyzeVideoComplete', () => {
    it('should complete full workflow successfully', async () => {
      const mockVideoUrl = 'https://test.example.com/uploads/test-video.mp4';
      mockToAbsolutePublicUploadUrl.mockReturnValue(mockVideoUrl);

      const mockAnalysisResult = JSON.stringify({
        plot: 'Test plot',
        characters: [],
        backgrounds: []
      });

      mockRequestExternalJson.mockResolvedValue({
        response: { ok: true, status: 200 },
        responsePayload: {
          choices: [{ message: { content: mockAnalysisResult } }],
          usage: { prompt_tokens: 100, completion_tokens: 200 }
        }
      });

      const result = await analyzeVideoComplete('/path/to/test-video.mp4', 'Analyze this video');

      expect(result.result).toBe(mockAnalysisResult);
      expect(result.metadata.fileName).toBe('test-video.mp4');
      expect(result.metadata.videoUrl).toBe(mockVideoUrl);
      expect(result.metadata.model).toBe('doubao-seed-2-0-lite-260215');
      expect(result.metadata.fps).toBe(5);
      expect(mockToAbsolutePublicUploadUrl).toHaveBeenCalledWith('/path/to/test-video.mp4');
      expect(mockRequestExternalJson).toHaveBeenCalledTimes(1);
    });

    it('should throw error when PUBLIC_ASSET_BASE_URL is not configured', async () => {
      mockToAbsolutePublicUploadUrl.mockReturnValue(null);

      await expect(
        analyzeVideoComplete('/path/to/test-video.mp4', 'prompt')
      ).rejects.toThrow('PUBLIC_ASSET_BASE_URL 未配置');
    });

    it('should propagate analysis errors', async () => {
      mockToAbsolutePublicUploadUrl.mockReturnValue('https://test.example.com/uploads/video.mp4');

      mockRequestExternalJson.mockResolvedValue({
        response: { ok: false, status: 500 },
        responsePayload: { error: { message: 'Analysis failed' } }
      });

      await expect(
        analyzeVideoComplete('/path/to/test-video.mp4', 'prompt')
      ).rejects.toThrow('Doubao-Seed 视频分析失败');
    });
  });
});
