import { Router } from 'express';

import { fetchTaskStatus } from '../controllers/taskController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { taskIdParamSchema } from '../utils/validationSchemas.js';

const router = Router();

router.get('/:taskId', validateRequest({ params: taskIdParamSchema }), asyncHandler(fetchTaskStatus));

export default router;
