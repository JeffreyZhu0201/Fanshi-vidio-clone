import { AppError } from '../middleware/errorHandler.js';
import { createVideoFromUpload, deleteVideoById, getVideoById } from '../services/videoService.js';

const uploadVideo = async (request, response) => {
  if (!request.file) {
    throw new AppError('Video file is required.', 400);
  }

  const video = await createVideoFromUpload({
    file: request.file,
    projectId: request.body.project_id,
    projectName: request.body.project_name
  });

  response.status(201).json(video);
};

const fetchVideo = async (request, response) => {
  const video = await getVideoById(request.params.id);
  response.status(200).json(video);
};

const removeVideo = async (request, response) => {
  const result = await deleteVideoById(request.params.id);
  response.status(200).json(result);
};

export { uploadVideo, fetchVideo, removeVideo };
