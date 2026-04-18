import { create } from 'zustand';

const SPLIT_TASK_STORAGE_KEY = 'fanshi.activeSplitTaskId';
const MERGE_TASK_STORAGE_KEY = 'fanshi.activeMergeTaskId';

const getSessionStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

const generationSessionStorage = {
  getSplitTaskId: () => getSessionStorage()?.getItem(SPLIT_TASK_STORAGE_KEY) || '',
  setSplitTaskId: (taskId) => {
    const storage = getSessionStorage();

    if (storage && taskId) {
      storage.setItem(SPLIT_TASK_STORAGE_KEY, taskId);
    }
  },
  clearSplitTaskId: () => {
    getSessionStorage()?.removeItem(SPLIT_TASK_STORAGE_KEY);
  },
  getMergeTaskId: () => getSessionStorage()?.getItem(MERGE_TASK_STORAGE_KEY) || '',
  setMergeTaskId: (taskId) => {
    const storage = getSessionStorage();

    if (storage && taskId) {
      storage.setItem(MERGE_TASK_STORAGE_KEY, taskId);
    }
  },
  clearMergeTaskId: () => {
    getSessionStorage()?.removeItem(MERGE_TASK_STORAGE_KEY);
  }
};

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

const syncSplitTaskStorage = (progressState) => {
  if (progressState.taskId) {
    generationSessionStorage.setSplitTaskId(progressState.taskId);
    return;
  }

  generationSessionStorage.clearSplitTaskId();
};

const syncMergeTaskStorage = (progressState) => {
  if (progressState.taskId) {
    generationSessionStorage.setMergeTaskId(progressState.taskId);
    return;
  }

  generationSessionStorage.clearMergeTaskId();
};

const buildResetGenerationState = () => {
  const nextMergeProgress = createInitialProgressState('等待拼接');
  const nextSplitProgress = createInitialProgressState('等待分割');

  syncMergeTaskStorage(nextMergeProgress);
  syncSplitTaskStorage(nextSplitProgress);

  return {
    segments: [],
    backgroundAssets: [],
    tasks: [],
    mergeProgress: nextMergeProgress,
    splitProgress: nextSplitProgress,
    backgroundAssetsLoading: false,
    backgroundAssetsError: '',
    segmentsLoading: false,
    segmentsError: ''
  };
};

const useGenerationStore = create((set) => ({
  segments: [],
  backgroundAssets: [],
  tasks: [],
  mergeProgress: createInitialProgressState('等待拼接'),
  splitProgress: createInitialProgressState('等待分割'),
  backgroundAssetsLoading: false,
  backgroundAssetsError: '',
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
  setBackgroundAssets: (backgroundAssets) =>
    set({
      backgroundAssets,
      backgroundAssetsLoading: false,
      backgroundAssetsError: ''
    }),
  setBackgroundAssetsLoading: (backgroundAssetsLoading) =>
    set({
      backgroundAssetsLoading
    }),
  setBackgroundAssetsError: (backgroundAssetsError) =>
    set({
      backgroundAssetsError,
      backgroundAssetsLoading: false
    }),
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
    set(() => {
      const nextMergeProgress = {
        ...createInitialProgressState('等待拼接'),
        taskId,
        status,
        progress,
        message,
        updatedAt: new Date().toISOString()
      };

      syncMergeTaskStorage(nextMergeProgress);

      return {
        mergeProgress: nextMergeProgress
      };
    }),
  setMergeProgress: (partialProgress) =>
    set((state) => {
      const nextMergeProgress = shouldIgnoreTaskScopedUpdate(
        state.mergeProgress.taskId,
        getNormalizedTaskId(partialProgress)
      )
        ? state.mergeProgress
        : buildProgressState(state.mergeProgress, partialProgress);

      syncMergeTaskStorage(nextMergeProgress);

      return {
        mergeProgress: nextMergeProgress
      };
    }),
  resetMergeProgress: () =>
    set(() => {
      const nextMergeProgress = createInitialProgressState('等待拼接');
      syncMergeTaskStorage(nextMergeProgress);

      return {
        mergeProgress: nextMergeProgress
      };
    }),
  beginSplitProgress: ({ taskId = '', status = 'pending', progress = 0, message = '分割任务已提交' }) =>
    set(() => {
      const nextSplitProgress = {
        ...createInitialProgressState('等待分割'),
        taskId,
        status,
        progress,
        message,
        updatedAt: new Date().toISOString()
      };

      syncSplitTaskStorage(nextSplitProgress);

      return {
        splitProgress: nextSplitProgress
      };
    }),
  setSplitProgress: (partialProgress) =>
    set((state) => {
      const nextSplitProgress = shouldIgnoreTaskScopedUpdate(
        state.splitProgress.taskId,
        getNormalizedTaskId(partialProgress)
      )
        ? state.splitProgress
        : buildProgressState(state.splitProgress, partialProgress);

      syncSplitTaskStorage(nextSplitProgress);

      return {
        splitProgress: nextSplitProgress
      };
    }),
  resetSplitProgress: () =>
    set(() => {
      const nextSplitProgress = createInitialProgressState('等待分割');
      syncSplitTaskStorage(nextSplitProgress);

      return {
        splitProgress: nextSplitProgress
      };
    }),
  setSegmentsLoading: (segmentsLoading) =>
    set({
      segmentsLoading
    }),
  setSegmentsError: (segmentsError) =>
    set({
      segmentsError,
      segmentsLoading: false
    }),
  resetGenerationContext: () =>
    set(() => {
      return buildResetGenerationState();
    }),
  clearGenerationState: () =>
    set(() => {
      return buildResetGenerationState();
    })
}));

export { useGenerationStore, generationSessionStorage };
