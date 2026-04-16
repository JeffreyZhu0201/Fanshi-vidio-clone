import { AppError } from '../middleware/errorHandler.js';
import { getTask } from '../services/taskService.js';

const fetchTaskStatus = async (request, response) => {
  const task = getTask(request.params.taskId);

  if (!task) {
    throw new AppError('Task not found.', 404, {
      task_id: request.params.taskId
    });
  }

  response.status(200).json({
    task_id: task.id,
    type: task.type,
    status: task.status,
    progress: task.progress,
    message: task.errorMessage || task.message,
    meta: task.meta,
    result: task.result,
    created_at: task.createdAt,
    updated_at: task.updatedAt
  });
};

export { fetchTaskStatus };
