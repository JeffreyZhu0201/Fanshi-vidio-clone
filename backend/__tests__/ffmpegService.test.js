import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { jest } from '@jest/globals';

const backendRoot = process.cwd();
const tempUploadDir = path.join(backendRoot, '.tmp', 'ffmpeg-service-test');

await jest.unstable_mockModule('../config/env.js', () => ({
  default: Object.freeze({
    UPLOAD_BASE_DIR: '.tmp/ffmpeg-service-test'
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

const { mergeVideos } = await import('../services/ffmpegService.js');
const { resolveUploadPath } = await import('../services/fileService.js');

describe('ffmpegService mergeVideos', () => {
  beforeEach(async () => {
    await rm(tempUploadDir, { recursive: true, force: true });
    await mkdir(tempUploadDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempUploadDir, { recursive: true, force: true });
  });

  test('marks one-input assembly as single-input-copy instead of mock-copy', async () => {
    const sourcePath = path.join(tempUploadDir, 'real-seedance-shot.mp4');
    await writeFile(sourcePath, Buffer.from('real remote seedance result'));

    const result = await mergeVideos([sourcePath], {
      basename: 'one-real-shot'
    });

    expect(result.engine).toBe('single-input-copy');
    await expect(readFile(resolveUploadPath(result.filePath), 'utf8')).resolves.toBe('real remote seedance result');
  });

  test('does not fake a multi-input merge by copying the first input when merge fails', async () => {
    await expect(
      mergeVideos([
        path.join(tempUploadDir, 'missing-input-1.mp4'),
        path.join(tempUploadDir, 'missing-input-2.mp4')
      ], {
        basename: 'broken-merge'
      })
    ).rejects.toThrow(/FFmpeg merge failed|FFmpeg is required/u);
  });
});
