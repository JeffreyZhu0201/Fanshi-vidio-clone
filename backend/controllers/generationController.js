import { getGenerationTaskStatus, startGeneration } from '../services/generationService.js';
import {
  getShotGenerationTaskStatus,
  startShotBatchGeneration,
  startShotGeneration
} from '../services/shotGenerationService.js';

const generateSegment = async (request, response) => {
  const result = await startGeneration({
    segmentId: request.body.segment_id,
    prompt: request.body.prompt,
    ratio: request.body.ratio,
    styleMode: request.body.style_mode
  });

  response.status(202).json(result);
};

const fetchGenerationTask = async (request, response) => {
  const result = await getGenerationTaskStatus(request.params.taskId);
  response.status(200).json(result);
};

const generateShot = async (request, response) => {
  const result = await startShotGeneration({
    segmentId: request.body.segment_id,
    shotId: request.body.shot_id,
    prompt: request.body.prompt,
    ratio: request.body.ratio,
    styleMode: request.body.style_mode
  });

  response.status(202).json(result);
};

const generateShotBatch = async (request, response) => {
  const result = await startShotBatchGeneration({
    segmentId: request.body.segment_id,
    shots: request.body.shots ?? [],
    ratio: request.body.ratio,
    styleMode: request.body.style_mode
  });

  response.status(202).json(result);
};

const fetchShotGenerationTask = async (request, response) => {
  const result = await getShotGenerationTaskStatus(request.params.taskId);
  response.status(200).json(result);
};

export { generateSegment, fetchGenerationTask, generateShot, generateShotBatch, fetchShotGenerationTask };
