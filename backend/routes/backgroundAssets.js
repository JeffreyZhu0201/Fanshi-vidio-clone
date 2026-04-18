import { Router } from 'express';

import { fetchBackgroundAssets } from '../controllers/backgroundAssetController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { videoIdParamSchema } from '../utils/validationSchemas.js';

const router = Router();

router.get(
  '/:videoId',
  validateRequest({ params: videoIdParamSchema }),
  asyncHandler(fetchBackgroundAssets)
);

export default router;
