import { randomUUID } from 'node:crypto';

import { TASK_STATUS } from '../config/constants.js';
import { broadcastRealtimeEvent } from './realtimeService.js';

const tasks = new Map();
const taskEventTypeMap = Object.freeze({
  split: 'split:progress',
  merge: 'merge:progress'
});

const broadcastTaskUpdate = (task) => {
  const eventType = taskEventTypeMap[task.type];

  if (!eventType) {
    return;
  }

  broadcastRealtimeEvent(eventType, {
    task_id: task.id,
    type: task.type,
    status: task.status,
    progress: task.progress,
    message: task.errorMessage || task.message,
    error_message: task.errorMessage,
    result: task.result,
    updated_at: task.updatedAt,
    ...task.meta
  });
};

const createTask = ({ type, meta = {}, message = 'Queued' }) => {
  const task = {
    id: randomUUID(),
    type,
    status: TASK_STATUS.pending,
    progress: 0,
    message,
    meta,
    result: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  tasks.set(task.id, task);
  broadcastTaskUpdate(task);
  return { ...task };
};

const updateTask = (taskId, updates) => {
  const currentTask = tasks.get(taskId);

  if (!currentTask) {
    return null;
  }

  const nextTask = {
    ...currentTask,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  tasks.set(taskId, nextTask);
  broadcastTaskUpdate(nextTask);
  return { ...nextTask };
};

const completeTask = (taskId, result, message = 'Completed') => {
  return updateTask(taskId, {
    status: TASK_STATUS.completed,
    progress: 100,
    message,
    result,
    errorMessage: null
  });
};

const failTask = (taskId, errorMessage) => {
  return updateTask(taskId, {
    status: TASK_STATUS.failed,
    message: 'Failed',
    errorMessage
  });
};

const getTask = (taskId) => {
  const task = tasks.get(taskId);
  return task ? { ...task } : null;
};

export { createTask, updateTask, completeTask, failTask, getTask };
