import { Router } from 'express';

import {
  fetchResourceImageAssets,
  generateResourceImages
} from '../controllers/resourceImageController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  generateResourceImagesBodySchema,
  videoIdParamSchema
} from '../utils/validationSchemas.js';

const router = Router();

router.get(
  '/:videoId',
  validateRequest({ params: videoIdParamSchema }),
  asyncHandler(fetchResourceImageAssets)
);
router.post(
  '/generate',
  validateRequest({ body: generateResourceImagesBodySchema }),
  asyncHandler(generateResourceImages)
);

export default router;
