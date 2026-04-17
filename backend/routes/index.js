import { Router } from 'express';

import {
  databaseHealthCheck,
  healthCheck,
  ingestMonitoringEvent,
  metrics
} from '../controllers/systemController.js';
import { validateRequest } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { monitoringEventBodySchema } from '../utils/validationSchemas.js';
import analysisRouter from './analysis.js';
import generationRouter from './generation.js';
import mergeRouter from './merge.js';
import segmentsRouter from './segments.js';
import tasksRouter from './tasks.js';
import videoRouter from './video.js';

const router = Router();

router.get('/health', healthCheck);
router.get('/health/database', databaseHealthCheck);
router.get('/metrics', metrics);
router.post(
  '/monitoring/events',
  validateRequest({ body: monitoringEventBodySchema }),
  asyncHandler(ingestMonitoringEvent)
);
router.use('/videos', videoRouter);
router.use('/analysis', analysisRouter);
router.use('/segments', segmentsRouter);
router.use('/generation', generationRouter);
router.use('/merge', mergeRouter);
router.use('/tasks', tasksRouter);

export default router;
