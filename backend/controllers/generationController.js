import { getGenerationTaskStatus, startGeneration } from '../services/generationService.js';

const generateSegment = async (request, response) => {
  const result = await startGeneration({
    segmentId: request.body.segment_id,
    prompt: request.body.prompt
  });

  response.status(202).json(result);
};

const fetchGenerationTask = async (request, response) => {
  const result = await getGenerationTaskStatus(request.params.taskId);
  response.status(200).json(result);
};

export { generateSegment, fetchGenerationTask };
