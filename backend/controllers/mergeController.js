import { getMergeTaskDownload, getMergeTaskProgress, startMerge } from '../services/mergeService.js';

const startMergeTask = async (request, response) => {
  const result = await startMerge({
    videoId: request.body.video_id
  });

  response.status(202).json(result);
};

const fetchMergeProgress = async (request, response) => {
  const progress = await getMergeTaskProgress(request.params.taskId);
  response.status(200).json(progress);
};

const downloadMergedVideo = async (request, response) => {
  const downloadPayload = await getMergeTaskDownload(request.params.taskId);
  response.download(downloadPayload.absolutePath, downloadPayload.filename);
};

export { startMergeTask, fetchMergeProgress, downloadMergedVideo };
