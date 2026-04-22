import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import request from 'supertest';

import { createApp } from '../app.js';
import { closeDatabaseConnection, connectDatabase } from '../config/database.js';
import env from '../config/env.js';
import { Analysis } from '../models/index.js';
import { ensureUploadDirectories } from '../utils/bootstrap.js';

const execFileAsync = promisify(execFile);
const scriptRoot = path.resolve(process.cwd());
const tempVideoPath = path.join(scriptRoot, '.tmp', 'live-pipeline-smoke.mp4');

const ensureSampleVideo = async () => {
  await mkdir(path.dirname(tempVideoPath), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=320x240:d=3',
    '-pix_fmt',
    'yuv420p',
    tempVideoPath
  ]);

  return tempVideoPath;
};

const sleep = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const pollJson = async (executor, { timeoutMs = 180000, intervalMs = 2000, label = 'task' } = {}) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const payload = await executor();
    const status = String(payload.status ?? '').toLowerCase();

    if (['completed', 'succeeded'].includes(status)) {
      return payload;
    }

    if (['failed', 'expired', 'cancelled'].includes(status)) {
      throw new Error(`${label} failed: ${payload.message ?? payload.error_message ?? status}`);
    }

    await sleep(intervalMs);
  }

  throw new Error(`${label} polling timed out.`);
};

const main = async () => {
  const app = createApp();
  const report = {
    timestamp: new Date().toISOString(),
    geminiConfigured: Boolean(env.GEMINI_API_KEY && env.GEMINI_API_BASE_URL),
    seedDanceConfigured: Boolean(env.SEED_DANCE_API_KEY && env.SEED_DANCE_API_BASE_URL),
    steps: {}
  };
  let uploadedVideoId = 0;

  await ensureUploadDirectories();
  await connectDatabase({ force: true });
  const sampleVideoPath = await ensureSampleVideo();

  try {
    const uploadResponse = await request(app)
      .post('/api/videos/upload')
      .field('project_name', 'Live Pipeline Smoke')
      .attach('video', sampleVideoPath);

    if (uploadResponse.status !== 201) {
      throw new Error(`upload failed: ${uploadResponse.status} ${uploadResponse.text}`);
    }

    uploadedVideoId = uploadResponse.body.id;
    report.steps.upload = {
      ok: true,
      videoId: uploadedVideoId,
      filename: uploadResponse.body.filename
    };

    const analyzeResponse = await request(app).post('/api/analysis/analyze').send({
      video_id: uploadedVideoId
    });

    if (analyzeResponse.status !== 200) {
      throw new Error(`analyze failed: ${analyzeResponse.status} ${analyzeResponse.text}`);
    }

    const storedAnalysis = await Analysis.findOne({
      where: {
        videoId: uploadedVideoId
      }
    });
    const rawGeminiPayload = safeJsonParse(storedAnalysis?.geminiResponse ?? '');

    report.steps.analyze = {
      ok: true,
      status: analyzeResponse.body.status,
      plotLength: analyzeResponse.body.plot?.length ?? 0,
      provider: rawGeminiPayload?.provider ?? 'remote',
      isMock: Boolean(rawGeminiPayload?.isMock),
      remoteError: rawGeminiPayload?.remoteError ?? ''
    };

    const fetchAnalysisResponse = await request(app).get(`/api/analysis/${uploadedVideoId}`);

    if (fetchAnalysisResponse.status !== 200) {
      throw new Error(`get analysis failed: ${fetchAnalysisResponse.status} ${fetchAnalysisResponse.text}`);
    }

    report.steps.fetchAnalysis = {
      ok: true,
      anchors: fetchAnalysisResponse.body.time_anchors?.length ?? 0
    };

    const splitResponse = await request(app).post('/api/segments/split').send({
      video_id: uploadedVideoId,
      time_anchors: fetchAnalysisResponse.body.time_anchors
    });

    if (splitResponse.status !== 202) {
      throw new Error(`split failed: ${splitResponse.status} ${splitResponse.text}`);
    }

    const splitTask = await pollJson(
      async () => {
        const response = await request(app).get(`/api/tasks/${splitResponse.body.task_id}`);

        if (response.status !== 200) {
          throw new Error(`poll split task failed: ${response.status} ${response.text}`);
        }

        return response.body;
      },
      { label: 'split task' }
    );

    report.steps.split = {
      ok: true,
      status: splitTask.status,
      progress: splitTask.progress
    };

    const segmentsResponse = await request(app).get(`/api/segments/${uploadedVideoId}`);

    if (segmentsResponse.status !== 200) {
      throw new Error(`get segments failed: ${segmentsResponse.status} ${segmentsResponse.text}`);
    }

    if (!segmentsResponse.body.length) {
      throw new Error('segments list is empty after split.');
    }

    report.steps.segments = {
      ok: true,
      count: segmentsResponse.body.length
    };

    const firstSegment = segmentsResponse.body[0];
    const optimizeResponse = await request(app).post('/api/analysis/optimize-prompt').send({
      prompt: firstSegment.analysis?.prompt ?? '',
      characters: fetchAnalysisResponse.body.characters ?? []
    });

    if (optimizeResponse.status !== 200) {
      throw new Error(`optimize prompt failed: ${optimizeResponse.status} ${optimizeResponse.text}`);
    }

    report.steps.optimizePrompt = {
      ok: true,
      optimizedLength: optimizeResponse.body.optimized_prompt?.length ?? 0
    };

    const generationResponse = await request(app).post('/api/generation/generate').send({
      segment_id: firstSegment.id,
      prompt: optimizeResponse.body.optimized_prompt
    });

    if (generationResponse.status !== 202) {
      throw new Error(`generate segment failed: ${generationResponse.status} ${generationResponse.text}`);
    }

    const generationTask = await pollJson(
      async () => {
        const response = await request(app).get(`/api/generation/${generationResponse.body.task_id}`);

        if (response.status !== 200) {
          throw new Error(`poll generation task failed: ${response.status} ${response.text}`);
        }

        return response.body;
      },
      {
        label: 'generation task',
        timeoutMs: Math.max(env.SEED_DANCE_MAX_WAIT_MS, 180000),
        intervalMs: Math.min(env.SEED_DANCE_POLL_INTERVAL_MS, 5000)
      }
    );

    report.steps.generate = {
      ok: true,
      status: generationTask.status,
      resultUrl: generationTask.result_url,
      remoteEnabled: report.seedDanceConfigured
    };

    const mergeResponse = await request(app).post('/api/merge/start').send({
      video_id: uploadedVideoId
    });

    if (mergeResponse.status !== 202) {
      throw new Error(`merge start failed: ${mergeResponse.status} ${mergeResponse.text}`);
    }

    const mergeTask = await pollJson(
      async () => {
        const response = await request(app).get(`/api/merge/${mergeResponse.body.task_id}/progress`);

        if (response.status !== 200) {
          throw new Error(`poll merge task failed: ${response.status} ${response.text}`);
        }

        return response.body;
      },
      { label: 'merge task' }
    );

    report.steps.merge = {
      ok: true,
      status: mergeTask.status,
      progress: mergeTask.progress
    };

    const downloadResponse = await request(app).get(`/api/merge/${mergeResponse.body.task_id}/download`);

    if (downloadResponse.status !== 200) {
      throw new Error(`download failed: ${downloadResponse.status} ${downloadResponse.text}`);
    }

    report.steps.download = {
      ok: true,
      contentType: downloadResponse.headers['content-type'] || '',
      contentDisposition: downloadResponse.headers['content-disposition'] || ''
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (uploadedVideoId) {
      await request(app).delete(`/api/videos/${uploadedVideoId}`).catch(() => {});
    }

    await closeDatabaseConnection().catch(() => {});
  }
};

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error.message
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await rm(tempVideoPath, {
      force: true
    }).catch(() => {});
  });
