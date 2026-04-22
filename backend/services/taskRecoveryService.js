import { Op } from 'sequelize';

import { GenerationTask, Segment, ShotGenerationTask } from '../models/index.js';
import { TASK_STATUS } from '../config/constants.js';
import logger from '../utils/logger.js';
import { processGenerationTask } from './generationService.js';
import { attemptPendingShotAssembly, processShotGenerationTask } from './shotGenerationService.js';

const ACTIVE_TASK_STATUSES = [TASK_STATUS.pending, TASK_STATUS.processing];

const recoverSegmentGenerationTasks = async () => {
  const tasks = await GenerationTask.findAll({
    where: {
      status: {
        [Op.in]: ACTIVE_TASK_STATUSES
      }
    },
    order: [['createdAt', 'ASC']]
  });

  tasks.forEach((task) => {
    queueMicrotask(() => {
      void processGenerationTask(task.id).catch((error) => {
        logger.warn('Failed to recover segment generation task.', {
          taskId: task.id,
          message: error.message
        });
      });
    });
  });

  return tasks.length;
};

const recoverShotGenerationTasks = async () => {
  const tasks = await ShotGenerationTask.findAll({
    where: {
      status: {
        [Op.in]: ACTIVE_TASK_STATUSES
      }
    },
    order: [['createdAt', 'ASC']]
  });

  tasks.forEach((task) => {
    queueMicrotask(() => {
      void processShotGenerationTask(task.id, {
        attemptAssembly: true
      }).catch((error) => {
        logger.warn('Failed to recover shot generation task.', {
          taskId: task.id,
          shotId: task.shotId,
          message: error.message
        });
      });
    });
  });

  return tasks.length;
};

const recoverPendingShotAssemblies = async () => {
  const segments = await Segment.findAll();
  const pendingSegments = segments.filter((segment) => Boolean(segment?.analysis?.shotAssembly?.pendingAssembly));

  pendingSegments.forEach((segment) => {
    queueMicrotask(() => {
      void attemptPendingShotAssembly(segment.id).catch((error) => {
        logger.warn('Failed to recover pending shot assembly.', {
          segmentId: segment.id,
          message: error.message
        });
      });
    });
  });

  return pendingSegments.length;
};

const recoverInFlightTasks = async () => {
  try {
    const [segmentTaskCount, shotTaskCount, pendingAssemblyCount] = await Promise.all([
      recoverSegmentGenerationTasks(),
      recoverShotGenerationTasks(),
      recoverPendingShotAssemblies()
    ]);

    if (segmentTaskCount || shotTaskCount || pendingAssemblyCount) {
      logger.info('Recovered in-flight generation tasks after service start.', {
        segmentTaskCount,
        shotTaskCount,
        pendingAssemblyCount
      });
    }
  } catch (error) {
    logger.warn('Failed to scan in-flight tasks during startup recovery.', {
      message: error.message
    });
  }
};

export { recoverInFlightTasks };
