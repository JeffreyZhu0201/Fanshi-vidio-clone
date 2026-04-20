import { Router } from 'express';

import {
  fetchGenerationTask,
  fetchShotGenerationTask,
  generateSegment,
  generateShot,
  generateShotBatch
} from '../controllers/generationController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  generateSegmentBodySchema,
  generateShotBatchBodySchema,
  generateShotBodySchema,
  generationTaskIdParamSchema,
  shotGenerationTaskIdParamSchema
} from '../utils/validationSchemas.js';

const router = Router();

router.post('/shots/generate', validateRequest({ body: generateShotBodySchema }), asyncHandler(generateShot));
router.post(
  '/shots/generate-batch',
  validateRequest({ body: generateShotBatchBodySchema }),
  asyncHandler(generateShotBatch)
);
router.get(
  '/shots/:taskId',
  validateRequest({ params: shotGenerationTaskIdParamSchema }),
  asyncHandler(fetchShotGenerationTask)
);
router.post('/generate', validateRequest({ body: generateSegmentBodySchema }), asyncHandler(generateSegment));
router.get(
  '/:taskId',
  validateRequest({ params: generationTaskIdParamSchema }),
  asyncHandler(fetchGenerationTask)
);

export default router;
