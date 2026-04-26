import { Router } from 'express';

import {
  downloadSegmentExportArchive,
  fetchSegmentExportProgress,
  startSegmentExportTask
} from '../controllers/segmentExportController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { mergeStartBodySchema, taskIdParamSchema } from '../utils/validationSchemas.js';

const router = Router();

router.post('/segments/start', validateRequest({ body: mergeStartBodySchema }), asyncHandler(startSegmentExportTask));
router.get(
  '/segments/:taskId/progress',
  validateRequest({ params: taskIdParamSchema }),
  asyncHandler(fetchSegmentExportProgress)
);
router.get(
  '/segments/:taskId/download',
  validateRequest({ params: taskIdParamSchema }),
  asyncHandler(downloadSegmentExportArchive)
);

export default router;
