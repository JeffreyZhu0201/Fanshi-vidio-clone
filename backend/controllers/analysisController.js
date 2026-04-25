import {
  analyzeVideoById,
  getAnalysisByVideoId,
  optimizePrompt,
  updateAnalysisCharactersByVideoId
} from '../services/analysisService.js';

const analyzeVideo = async (request, response) => {
  const analysis = await analyzeVideoById(request.body.video_id, request.body.analysis_options);
  response.status(200).json(analysis);
};

const fetchAnalysis = async (request, response) => {
  const analysis = await getAnalysisByVideoId(request.params.videoId);
  response.status(200).json(analysis);
};

const updateAnalysisCharacters = async (request, response) => {
  const analysis = await updateAnalysisCharactersByVideoId(request.params.videoId, request.body.characters);
  response.status(200).json(analysis);
};

const optimizePromptController = async (request, response) => {
  const optimizePayload = {
    prompt: request.body.prompt,
    characters: request.body.characters,
    backgrounds: request.body.backgrounds,
    styleMode: request.body.style_mode,
    segmentPrompt: request.body.segment_prompt,
    shotPrompt: request.body.shot_prompt,
    sceneNames: request.body.scene_names,
    characterNames: request.body.character_names
  };

  if (request.body.mode) {
    optimizePayload.mode = request.body.mode;
  }

  const result = await optimizePrompt(optimizePayload);

  response.status(200).json(result);
};

export { analyzeVideo, fetchAnalysis, updateAnalysisCharacters, optimizePromptController };
