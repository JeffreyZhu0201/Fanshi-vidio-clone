import { Router } from 'express';

import { databaseHealthCheck, healthCheck } from '../controllers/systemController.js';
import analysisRouter from './analysis.js';
import generationRouter from './generation.js';
import mergeRouter from './merge.js';
import segmentsRouter from './segments.js';
import tasksRouter from './tasks.js';
import videoRouter from './video.js';

const router = Router();

router.get('/health', healthCheck);
router.get('/health/database', databaseHealthCheck);
router.use('/videos', videoRouter);
router.use('/analysis', analysisRouter);
router.use('/segments', segmentsRouter);
router.use('/generation', generationRouter);
router.use('/merge', mergeRouter);
router.use('/tasks', tasksRouter);

export default router;
