import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import env from '../config/env.js';
import { analyzeVideo, optimizePrompt } from '../services/geminiService.js';
import { generateSegment } from '../services/seedDanceService.js';
import { resolveUploadPath } from '../services/fileService.js';

const execFileAsync = promisify(execFile);
const scriptRoot = path.resolve(process.cwd());
const tempVideoPath = path.join(scriptRoot, '.tmp', 'live-ai-smoke.mp4');

const ensureSampleVideo = async () => {
  await mkdir(path.dirname(tempVideoPath), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=320x240:d=1',
    '-pix_fmt',
    'yuv420p',
    tempVideoPath
  ]);

  return tempVideoPath;
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const main = async () => {
  const sampleVideoPath = await ensureSampleVideo();
  const report = {
    timestamp: new Date().toISOString(),
    gemini: {
      configured: Boolean(env.GEMINI_API_KEY && env.GEMINI_API_BASE_URL),
      strictRemote: env.GEMINI_STRICT_REMOTE
    },
    seedDance: {
      configured: Boolean(env.SEED_DANCE_API_KEY && env.SEED_DANCE_API_BASE_URL),
      strictRemote: env.SEED_DANCE_STRICT_REMOTE
    }
  };

  try {
    const analysisResult = await analyzeVideo({
      video: {
        filename: 'live-ai-smoke.mp4'
      },
      metadata: {
        duration: 1
      },
      videoAbsolutePath: sampleVideoPath
    });
    const rawGeminiResponse = safeJsonParse(analysisResult.geminiResponse);

    report.gemini.analyze = {
      ok: true,
      plotLength: analysisResult.plot.length,
      characterCount: analysisResult.characters.length,
      anchorCount: analysisResult.timeAnchors.length,
      provider: rawGeminiResponse?.provider ?? 'remote',
      isMock: Boolean(rawGeminiResponse?.isMock),
      remoteError: rawGeminiResponse?.remoteError ?? ''
    };
  } catch (error) {
    report.gemini.analyze = {
      ok: false,
      error: error.message
    };
  }

  try {
    const optimizeResult = await optimizePrompt({
      prompt: '主角 走进场景，镜头缓慢推进。',
      characters: [
        {
          name: '主角',
          appearancePrompt: '年轻主角，电影感光线，服装利落'
        }
      ]
    });

    report.gemini.optimize = {
      ok: true,
      optimizedPrompt: optimizeResult.optimizedPrompt,
      usedHighlightHtml: optimizeResult.highlightedPrompt.includes('mention')
    };
  } catch (error) {
    report.gemini.optimize = {
      ok: false,
      error: error.message
    };
  }

  if (report.seedDance.configured) {
    try {
      const generationResult = await generateSegment({
        sourceAbsolutePath: sampleVideoPath,
        prompt: '@主角 在黑色背景中平稳出现，镜头慢慢推进。',
        basename: 'live-ai-smoke'
      });

      report.seedDance.generate = {
        ok: true,
        engine: generationResult.engine,
        fileUrl: generationResult.fileUrl
      };

      if (generationResult.filePath) {
        await rm(resolveUploadPath(generationResult.filePath), {
          force: true
        }).catch(() => {});
      }
    } catch (error) {
      report.seedDance.generate = {
        ok: false,
        error: error.message
      };
    }
  } else {
    report.seedDance.generate = {
      ok: false,
      skipped: true,
      reason: 'SEED_DANCE_API_KEY 或 SEED_DANCE_API_BASE_URL 未配置。'
    };
  }

  console.log(JSON.stringify(report, null, 2));
};

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await rm(tempVideoPath, {
      force: true
    }).catch(() => {});
  });
