import { Router } from 'express';

import {
  analyzeVideo,
  fetchAnalysis,
  optimizePromptController
} from '../controllers/analysisController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  analyzeVideoBodySchema,
  optimizePromptBodySchema,
  videoIdParamSchema
} from '../utils/validationSchemas.js';

const router = Router();

router.post('/analyze', validateRequest({ body: analyzeVideoBodySchema }), asyncHandler(analyzeVideo));
router.get('/:videoId', validateRequest({ params: videoIdParamSchema }), asyncHandler(fetchAnalysis));
router.post(
  '/optimize-prompt',
  validateRequest({ body: optimizePromptBodySchema }),
  asyncHandler(optimizePromptController)
);

export default router;
