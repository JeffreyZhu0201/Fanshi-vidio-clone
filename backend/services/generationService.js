import { Analysis, GenerationTask, Segment, Video } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { TASK_STATUS } from '../config/constants.js';
import { generateSegment as generateWithSeedDance } from './seedDanceService.js';
import { resolveUploadPath } from './fileService.js';

const serializeGenerationTask = (task) => ({
  task_id: task.id,
  segment_id: task.segmentId,
  status: task.status,
  progress: task.progress,
  prompt: task.prompt,
  optimized_prompt: task.optimizedPrompt,
  result_url: task.resultUrl,
  error_message: task.errorMessage,
  created_at: task.createdAt,
  updated_at: task.updatedAt
});

const expandCharacterMentions = (prompt, characters) => {
  return prompt.replace(/@([\p{L}\p{N}_-]+)/gu, (match, characterName) => {
    const matchedCharacter = characters.find((item) => item.name === characterName);
    return matchedCharacter?.appearancePrompt || matchedCharacter?.appearance_prompt || characterName;
  });
};

const processGenerationTask = async (taskId) => {
  const task = await GenerationTask.findByPk(taskId, {
    include: [
      {
        model: Segment,
        as: 'segment',
        include: [
          {
            model: Video,
            as: 'video',
            include: [
              {
                model: Analysis,
                as: 'analysis'
              }
            ]
          }
        ]
      }
    ]
  });

  if (!task) {
    return;
  }

  try {
    await task.update({
      status: TASK_STATUS.processing,
      progress: 10
    });

    const characters = task.segment?.video?.analysis?.characters ?? [];
    const optimizedPrompt = expandCharacterMentions(task.prompt, characters);

    await task.update({
      optimizedPrompt,
      progress: 45
    });

    const result = await generateWithSeedDance({
      sourceAbsolutePath: resolveUploadPath(task.segment.filePath),
      prompt: optimizedPrompt,
      basename: `segment-${task.segmentId}-task-${task.id}`
    });

    await task.update({
      status: TASK_STATUS.completed,
      progress: 100,
      resultUrl: result.fileUrl,
      errorMessage: null
    });
  } catch (error) {
    await task.update({
      status: TASK_STATUS.failed,
      errorMessage: error.message
    });
  }
};

const startGeneration = async ({ segmentId, prompt }) => {
  const segment = await Segment.findByPk(segmentId);

  if (!segment) {
    throw new AppError('Segment not found.', 404, {
      segment_id: segmentId
    });
  }

  const task = await GenerationTask.create({
    segmentId,
    prompt,
    status: TASK_STATUS.pending,
    progress: 0
  });

  queueMicrotask(() => {
    void processGenerationTask(task.id);
  });

  return {
    task_id: task.id,
    status: task.status,
    progress: task.progress
  };
};

const getGenerationTaskStatus = async (taskId) => {
  const task = await GenerationTask.findByPk(taskId);

  if (!task) {
    throw new AppError('Generation task not found.', 404, {
      task_id: taskId
    });
  }

  return serializeGenerationTask(task);
};

export { startGeneration, getGenerationTaskStatus, serializeGenerationTask };
