import { getGenerationTaskStatus, startGeneration } from '../services/generationService.js';

const generateSegment = async (request, response) => {
  const result = await startGeneration({
    segmentId: request.body.segment_id,
    prompt: request.body.prompt,
    ratio: request.body.ratio,
    styleMode: request.body.style_mode,
    useReferenceVideo: request.body.use_reference_video,
    useReferenceFrame: request.body.use_reference_frame
  });

  response.status(202).json(result);
};

const fetchGenerationTask = async (request, response) => {
  const result = await getGenerationTaskStatus(request.params.taskId);
  response.status(200).json(result);
};

export { generateSegment, fetchGenerationTask };
