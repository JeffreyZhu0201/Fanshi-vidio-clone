import { jest } from '@jest/globals';

let mockEnv = {
  SEED_DANCE_API_KEY: 'test-ark-api-key',
  SEED_DANCE_STRICT_REMOTE: false
};

const mockRequestExternalJson = jest.fn();
const mockAxiosPost = jest.fn();
const mockReadFile = jest.fn();

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

jest.unstable_mockModule('axios', () => ({
  default: {
    post: mockAxiosPost
  }
}));

jest.unstable_mockModule('node:fs/promises', () => ({
  readFile: mockReadFile
}));

jest.unstable_mockModule('form-data', () => ({
  default: class FormData {
    constructor() {
      this.fields = {};
    }
    append(key, value, options) {
      this.fields[key] = { value, options };
    }
    getHeaders() {
      return { 'content-type': 'multipart/form-data' };
    }
  }
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
  uploadVideoToDoubaoSeed,
  analyzeVideoWithDoubaoSeed,
  analyzeVideoComplete
} = await import('../services/doubaoSeedService.js');

describe('doubaoSeedService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv = {
      SEED_DANCE_API_KEY: 'test-ark-api-key',
      SEED_DANCE_STRICT_REMOTE: false
    };
  });

  describe('getDoubaoSeedProviderStatus', () => {
    it('should return ready status when API key is configured', () => {
      const status = getDoubaoSeedProviderStatus();

      expect(status.ready).toBe(true);
      expect(status.reason).toBe('');
      expect(status.model).toBe('doubao-seed-2-0-lite-260215');
      expect(status.api_base_url).toBe('https://ark.cn-beijing.volces.com');
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
  });

  describe('uploadVideoToDoubaoSeed', () => {
    it('should upload video successfully and return file ID', async () => {
      const mockFileBuffer = Buffer.from('mock video data');
      mockReadFile.mockResolvedValue(mockFileBuffer);

      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: {
          id: 'file-123456',
          object: 'file',
          bytes: 1024,
          created_at: 1234567890,
          filename: 'test-video.mp4',
          purpose: 'file-extract'
        }
      });

      const fileId = await uploadVideoToDoubaoSeed('/path/to/test-video.mp4');

      expect(fileId).toBe('file-123456');
      expect(mockReadFile).toHaveBeenCalledWith('/path/to/test-video.mp4');
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://ark.cn-beijing.volces.com/api/v3/files',
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-ark-api-key'
          }),
          timeout: 300000
        })
      );
    });

    it('should throw error when upload fails', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('data'));
      mockAxiosPost.mockRejectedValue(new Error('Network error'));

      await expect(
        uploadVideoToDoubaoSeed('/path/to/video.mp4')
      ).rejects.toThrow();
    });
  });

  describe('analyzeVideoWithDoubaoSeed', () => {
    it('should analyze video successfully using file ID', async () => {
      const mockAnalysisResult = JSON.stringify({
        plot: 'Test plot',
        characters: [],
        backgrounds: []
      });

      mockRequestExternalJson.mockResolvedValue({
        response: { ok: true, status: 200 },
        responsePayload: {
          output: [
            {
              type: 'message',
              content: [
                {
                  text: mockAnalysisResult
                }
              ]
            }
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 200
          }
        }
      });

      const result = await analyzeVideoWithDoubaoSeed(
        'file-123456',
        'Analyze this video'
      );

      expect(result.result).toBe(mockAnalysisResult);
      expect(result.metadata.fileId).toBe('file-123456');
      expect(result.metadata.model).toBe('doubao-seed-2-0-lite-260215');
      expect(result.metadata.fps).toBe(0.3);

      expect(mockRequestExternalJson).toHaveBeenCalledWith(
        'https://ark.cn-beijing.volces.com/api/v3/responses',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-ark-api-key',
            'Content-Type': 'application/json'
          }),
          timeoutMs: 600000
        })
      );

      // Verify request body structure for Responses API
      const callBody = JSON.parse(mockRequestExternalJson.mock.calls[0][1].body);
      expect(callBody.model).toBe('doubao-seed-2-0-lite-260215');
      expect(callBody.input[0].role).toBe('user');
      expect(callBody.input[0].content[0].type).toBe('input_video');
      expect(callBody.input[0].content[0].file_id).toBe('file-123456');
      expect(callBody.input[0].content[0].fps).toBe(0.3);
      expect(callBody.input[0].content[1].type).toBe('input_text');
      expect(callBody.input[0].content[1].text).toBe('Analyze this video');
      expect(callBody.input[0].content[1].text).toBe('Analyze this video');
    });

    it('should use custom options when provided', async () => {
      mockRequestExternalJson.mockResolvedValue({
        response: { ok: true, status: 200 },
        responsePayload: {
          output: [
            {
              type: 'message',
              content: [{ text: 'result' }]
            }
          ]
        }
      });

      await analyzeVideoWithDoubaoSeed(
        'file-123456',
        'prompt',
        {
          temperature: 0.5,
          maxTokens: 8000,
          fps: 1.0
        }
      );

      const callBody = JSON.parse(mockRequestExternalJson.mock.calls[0][1].body);
      expect(callBody.input[0].content[0].fps).toBe(1.0);
    });

    it('should throw error when analysis fails', async () => {
      mockRequestExternalJson.mockResolvedValue({
        response: { ok: false, status: 500 },
        responsePayload: {
          error: { message: 'Internal server error' }
        }
      });

      await expect(
        analyzeVideoWithDoubaoSeed('file-123456', 'prompt')
      ).rejects.toThrow('Doubao-Seed 视频分析失败');
    });

    it('should throw error when response is missing content', async () => {
      mockRequestExternalJson.mockResolvedValue({
        response: { ok: true, status: 200 },
        responsePayload: {
          choices: []
        }
      });

      await expect(
        analyzeVideoWithDoubaoSeed('file-123456', 'prompt')
      ).rejects.toThrow('Doubao-Seed 分析响应缺少内容');
    });
  });

  describe('analyzeVideoComplete', () => {
    it('should complete full workflow successfully', async () => {
      const mockFileBuffer = Buffer.from('mock video data');
      mockReadFile.mockResolvedValue(mockFileBuffer);

      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: { id: 'file-123456' }
      });

      const mockAnalysisResult = JSON.stringify({
        plot: 'Test plot',
        characters: [],
        backgrounds: []
      });

      mockRequestExternalJson.mockResolvedValue({
        response: { ok: true, status: 200 },
        responsePayload: {
          output: [
            {
              type: 'message',
              content: [{ text: mockAnalysisResult }]
            }
          ],
          usage: { prompt_tokens: 100, completion_tokens: 200 }
        }
      });

      const result = await analyzeVideoComplete('/path/to/test-video.mp4', 'Analyze this video');

      expect(result.result).toBe(mockAnalysisResult);
      expect(result.metadata.fileId).toBe('file-123456');
      expect(result.metadata.model).toBe('doubao-seed-2-0-lite-260215');
      expect(result.metadata.fps).toBe(0.3);
      expect(mockReadFile).toHaveBeenCalledWith('/path/to/test-video.mp4');
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
      expect(mockRequestExternalJson).toHaveBeenCalledTimes(1);
    });

    it('should propagate upload errors', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('data'));
      mockAxiosPost.mockRejectedValue(new Error('Upload failed'));

      await expect(
        analyzeVideoComplete('/path/to/test-video.mp4', 'prompt')
      ).rejects.toThrow();
    });

    it('should propagate analysis errors', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('data'));
      mockAxiosPost.mockResolvedValue({
        status: 200,
        data: { id: 'file-123456' }
      });

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
