import {
  analyzeVideoById,
  getAnalysisByVideoId,
  optimizePrompt
} from '../services/analysisService.js';

const analyzeVideo = async (request, response) => {
  const analysis = await analyzeVideoById(request.body.video_id);
  response.status(200).json(analysis);
};

const fetchAnalysis = async (request, response) => {
  const analysis = await getAnalysisByVideoId(request.params.videoId);
  response.status(200).json(analysis);
};

const optimizePromptController = async (request, response) => {
  const optimizePayload = {
    prompt: request.body.prompt,
    characters: request.body.characters,
    backgrounds: request.body.backgrounds
  };

  if (request.body.mode) {
    optimizePayload.mode = request.body.mode;
  }

  const result = await optimizePrompt(optimizePayload);

  response.status(200).json(result);
};

export { analyzeVideo, fetchAnalysis, optimizePromptController };
