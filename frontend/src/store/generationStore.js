import { create } from 'zustand';

const createInitialProgressState = (message) => ({
  taskId: '',
  status: 'idle',
  progress: 0,
  message,
  errorMessage: '',
  updatedAt: null
});

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
  setMergeProgress: (partialProgress) =>
    set((state) => ({
      mergeProgress: {
        ...state.mergeProgress,
        ...partialProgress,
        updatedAt: new Date().toISOString()
      }
    })),
  setSplitProgress: (partialProgress) =>
    set((state) => ({
      splitProgress: {
        ...state.splitProgress,
        ...partialProgress,
        updatedAt: new Date().toISOString()
      }
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
