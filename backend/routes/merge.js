import { Router } from 'express';

import {
  downloadMergedVideo,
  fetchMergeProgress,
  startMergeTask
} from '../controllers/mergeController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { mergeStartBodySchema, taskIdParamSchema } from '../utils/validationSchemas.js';

const router = Router();

router.post('/start', validateRequest({ body: mergeStartBodySchema }), asyncHandler(startMergeTask));
router.get('/:taskId/progress', validateRequest({ params: taskIdParamSchema }), asyncHandler(fetchMergeProgress));
router.get('/:taskId/download', validateRequest({ params: taskIdParamSchema }), asyncHandler(downloadMergedVideo));

export default router;
