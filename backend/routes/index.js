import { Router } from 'express';

import { databaseHealthCheck, healthCheck } from '../controllers/systemController.js';

const router = Router();

router.get('/health', healthCheck);
router.get('/health/database', databaseHealthCheck);

export default router;
