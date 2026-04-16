import { Router } from 'express';

import { fetchVideo, removeVideo, uploadVideo } from '../controllers/videoController.js';
import { uploadVideo as uploadVideoMiddleware } from '../middleware/upload.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { idParamSchema, uploadVideoBodySchema } from '../utils/validationSchemas.js';

const router = Router();

router.post(
  '/upload',
  uploadVideoMiddleware.single('video'),
  validateRequest({ body: uploadVideoBodySchema }),
  asyncHandler(uploadVideo)
);
router.get('/:id', validateRequest({ params: idParamSchema }), asyncHandler(fetchVideo));
router.delete('/:id', validateRequest({ params: idParamSchema }), asyncHandler(removeVideo));

export default router;
