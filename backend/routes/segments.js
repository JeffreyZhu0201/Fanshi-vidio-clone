import { Router } from 'express';

import { analyzeSegment, fetchSegments, splitVideoByAnchors } from '../controllers/segmentController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { idParamSchema, splitVideoBodySchema, videoIdParamSchema } from '../utils/validationSchemas.js';

const router = Router();

router.post('/split', validateRequest({ body: splitVideoBodySchema }), asyncHandler(splitVideoByAnchors));
router.post('/:id/analyze', validateRequest({ params: idParamSchema }), asyncHandler(analyzeSegment));
router.get('/:videoId', validateRequest({ params: videoIdParamSchema }), asyncHandler(fetchSegments));

export default router;
