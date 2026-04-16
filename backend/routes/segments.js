import { Router } from 'express';

import { fetchSegments, splitVideoByAnchors } from '../controllers/segmentController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { splitVideoBodySchema, videoIdParamSchema } from '../utils/validationSchemas.js';

const router = Router();

router.post('/split', validateRequest({ body: splitVideoBodySchema }), asyncHandler(splitVideoByAnchors));
router.get('/:videoId', validateRequest({ params: videoIdParamSchema }), asyncHandler(fetchSegments));

export default router;
