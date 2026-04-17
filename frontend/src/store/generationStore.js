import { create } from 'zustand';

const createInitialProgressState = (message) => ({
  taskId: '',
  status: 'idle',
  progress: 0,
  message,
  errorMessage: '',
  updatedAt: null
});

const getNormalizedTaskId = (progressPayload = {}) => {
  return progressPayload.taskId ?? progressPayload.task_id ?? '';
};

const shouldIgnoreTaskScopedUpdate = (currentTaskId, incomingTaskId) => {
  if (!incomingTaskId) {
    return false;
  }

  if (!currentTaskId) {
    return true;
  }

  return currentTaskId !== incomingTaskId;
};

const buildProgressState = (currentState, partialProgress) => {
  const { taskId, task_id, ...restProgress } = partialProgress;
  const normalizedTaskId = taskId ?? task_id ?? '';

  return {
    ...currentState,
    ...restProgress,
    ...(normalizedTaskId ? { taskId: normalizedTaskId } : {}),
    updatedAt: new Date().toISOString()
  };
};

const useGenerationStore = create((set) => ({
  segments: [],
  tasks: [],
  mergeProgress: createInitialProgressState('等待拼接'),
  splitProgress: createInitialProgressState('等待分割'),
  segmentsLoading: false,
  segmentsError: '',
  setSegments: (segments) =>
    set({
      segments,
      segmentsLoading: false,
      segmentsError: ''
    }),
  updateSegment: (segmentId, partialSegment) =>
    set((state) => ({
      segments: state.segments.map((segment) =>
        segment.id === segmentId
          ? {
              ...segment,
              ...partialSegment
            }
          : segment
      )
    })),
  addTask: (task) =>
    set((state) => ({
      tasks: [task, ...state.tasks.filter((item) => item.task_id !== task.task_id)]
    })),
  updateTask: (taskId, partialTask) =>
    set((state) => {
      const existingTask = state.tasks.find((task) => task.task_id === taskId);

      if (!existingTask) {
        return {
          tasks: [
            {
              task_id: taskId,
              ...partialTask
            },
            ...state.tasks
          ]
        };
      }

      return {
        tasks: state.tasks.map((task) =>
          task.task_id === taskId
            ? {
                ...task,
                ...partialTask
              }
            : task
        )
      };
    }),
  beginMergeProgress: ({ taskId = '', status = 'pending', progress = 0, message = '拼接任务已提交' }) =>
    set({
      mergeProgress: {
        ...createInitialProgressState('等待拼接'),
        taskId,
        status,
        progress,
        message,
        updatedAt: new Date().toISOString()
      }
    }),
  setMergeProgress: (partialProgress) =>
    set((state) => ({
      mergeProgress: shouldIgnoreTaskScopedUpdate(state.mergeProgress.taskId, getNormalizedTaskId(partialProgress))
        ? state.mergeProgress
        : buildProgressState(state.mergeProgress, partialProgress)
    })),
  beginSplitProgress: ({ taskId = '', status = 'pending', progress = 0, message = '分割任务已提交' }) =>
    set({
      splitProgress: {
        ...createInitialProgressState('等待分割'),
        taskId,
        status,
        progress,
        message,
        updatedAt: new Date().toISOString()
      }
    }),
  setSplitProgress: (partialProgress) =>
    set((state) => ({
      splitProgress: shouldIgnoreTaskScopedUpdate(state.splitProgress.taskId, getNormalizedTaskId(partialProgress))
        ? state.splitProgress
        : buildProgressState(state.splitProgress, partialProgress)
    })),
  setSegmentsLoading: (segmentsLoading) =>
    set({
      segmentsLoading
    }),
  setSegmentsError: (segmentsError) =>
    set({
      segmentsError,
      segmentsLoading: false
    }),
  clearGenerationState: () =>
    set({
      segments: [],
      tasks: [],
      mergeProgress: createInitialProgressState('等待拼接'),
      splitProgress: createInitialProgressState('等待分割'),
      segmentsLoading: false,
      segmentsError: ''
    })
}));

export { useGenerationStore };
