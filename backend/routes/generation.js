import { Router } from 'express';

import {
  fetchGenerationTask,
  generateSegment
} from '../controllers/generationController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  generateSegmentBodySchema,
  generationTaskIdParamSchema
} from '../utils/validationSchemas.js';

const router = Router();

router.post('/generate', validateRequest({ body: generateSegmentBodySchema }), asyncHandler(generateSegment));
router.get(
  '/:taskId',
  validateRequest({ params: generationTaskIdParamSchema }),
  asyncHandler(fetchGenerationTask)
);

export default router;
