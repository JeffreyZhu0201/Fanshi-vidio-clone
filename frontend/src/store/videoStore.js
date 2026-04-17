import { create } from 'zustand';

const createInitialUploadState = () => ({
  uploadProgress: 0,
  uploadStatus: 'idle',
  uploadError: '',
  validationMessage: '',
  uploadStartedAt: null,
  uploadCompletedAt: null
});

const useVideoStore = create((set) => ({
  currentVideo: null,
  videos: [],
  ...createInitialUploadState(),
  setCurrentVideo: (video) =>
    set({
      currentVideo: video
    }),
  updateCurrentVideo: (partialVideo) =>
    set((state) => ({
      currentVideo: state.currentVideo
        ? {
            ...state.currentVideo,
            ...partialVideo
          }
        : state.currentVideo
    })),
  addVideo: (video) =>
    set((state) => ({
      currentVideo: video,
      videos: [video, ...state.videos.filter((item) => item.id !== video.id)]
    })),
  updateProgress: (progress) =>
    set({
      uploadProgress: Math.max(0, Math.min(100, Math.round(progress)))
    }),
  setUploadState: (uploadState) =>
    set((state) => ({
      ...state,
      ...uploadState
    })),
  setValidationMessage: (message) =>
    set({
      validationMessage: message
    }),
  clearVideos: () =>
    set({
      currentVideo: null,
      videos: [],
      ...createInitialUploadState()
    })
}));

export { useVideoStore };
