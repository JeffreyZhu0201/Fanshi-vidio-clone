import { create } from 'zustand';

const CURRENT_VIDEO_STORAGE_KEY = 'fanshi.currentVideoId';

const getSessionStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
};

const videoSessionStorage = {
  getCurrentVideoId: () => {
    const storage = getSessionStorage();
    const value = storage?.getItem(CURRENT_VIDEO_STORAGE_KEY);
    const parsedValue = Number(value);

    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      return null;
    }

    return parsedValue;
  },
  setCurrentVideoId: (videoId) => {
    const storage = getSessionStorage();

    if (storage && videoId) {
      storage.setItem(CURRENT_VIDEO_STORAGE_KEY, String(videoId));
    }
  },
  clearCurrentVideoId: () => {
    const storage = getSessionStorage();
    storage?.removeItem(CURRENT_VIDEO_STORAGE_KEY);
  }
};

const syncCurrentVideoStorage = (video) => {
  if (video?.id) {
    videoSessionStorage.setCurrentVideoId(video.id);
    return;
  }

  videoSessionStorage.clearCurrentVideoId();
};

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
    set(() => {
      syncCurrentVideoStorage(video);

      return {
        currentVideo: video
      };
    }),
  updateCurrentVideo: (partialVideo) =>
    set((state) => ({
      currentVideo: (() => {
        const nextCurrentVideo = state.currentVideo
          ? {
              ...state.currentVideo,
              ...partialVideo
            }
          : state.currentVideo;

        syncCurrentVideoStorage(nextCurrentVideo);
        return nextCurrentVideo;
      })()
    })),
  addVideo: (video) =>
    set((state) => {
      syncCurrentVideoStorage(video);

      return {
        currentVideo: video,
        videos: [video, ...state.videos.filter((item) => item.id !== video.id)]
      };
    }),
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
    set(() => {
      videoSessionStorage.clearCurrentVideoId();

      return {
        currentVideo: null,
        videos: [],
        ...createInitialUploadState()
      };
    })
}));

export { useVideoStore, videoSessionStorage };
