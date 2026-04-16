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
  const result = await optimizePrompt({
    prompt: request.body.prompt,
    characters: request.body.characters
  });

  response.status(200).json(result);
};

export { analyzeVideo, fetchAnalysis, optimizePromptController };
