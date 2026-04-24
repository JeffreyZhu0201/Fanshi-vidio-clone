import { Router } from 'express';

import {
  analyzeVideo,
  fetchAnalysis,
  optimizePromptController,
  updateAnalysisCharacters
} from '../controllers/analysisController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  analyzeVideoBodySchema,
  optimizePromptBodySchema,
  updateAnalysisCharactersBodySchema,
  videoIdParamSchema
} from '../utils/validationSchemas.js';

const router = Router();

router.post('/analyze', validateRequest({ body: analyzeVideoBodySchema }), asyncHandler(analyzeVideo));
router.get('/:videoId', validateRequest({ params: videoIdParamSchema }), asyncHandler(fetchAnalysis));
router.put(
  '/:videoId/characters',
  validateRequest({ params: videoIdParamSchema, body: updateAnalysisCharactersBodySchema }),
  asyncHandler(updateAnalysisCharacters)
);
router.post(
  '/optimize-prompt',
  validateRequest({ body: optimizePromptBodySchema }),
  asyncHandler(optimizePromptController)
);

export default router;
