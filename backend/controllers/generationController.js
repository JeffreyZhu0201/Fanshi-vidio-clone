import { AppError } from '../middleware/errorHandler.js';
import { getGenerationTaskStatus, startGeneration } from '../services/generationService.js';

const generateSegment = async (request, response) => {
  const { segment_id, prompt, ratio, style_mode, use_reference_video, use_reference_frame } = request.body;

  // Validate required fields (belt-and-suspenders with route validation)
  if (!segment_id && !request.body.video_id) {
    throw new AppError('Either segment_id or video_id is required.', 400);
  }

  const result = await startGeneration({
    segmentId: segment_id,
    videoId: request.body.video_id,
    prompt,
    ratio,
    styleMode: style_mode,
    useReferenceVideo: use_reference_video,
    useReferenceFrame: use_reference_frame
  });

  response.status(202).json(result);
};

const fetchGenerationTask = async (request, response) => {
  const { taskId } = request.params;

  if (!taskId) {
    throw new AppError('Task ID is required.', 400);
  }

  const result = await getGenerationTaskStatus(taskId);
  response.status(200).json(result);
};

export { generateSegment, fetchGenerationTask };
