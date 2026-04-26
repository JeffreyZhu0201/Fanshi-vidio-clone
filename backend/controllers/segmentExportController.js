import {
  getSegmentExportDownload,
  getSegmentExportProgress,
  startSegmentExport
} from '../services/segmentExportService.js';

const startSegmentExportTask = async (request, response) => {
  const result = await startSegmentExport({
    videoId: request.body.video_id
  });

  response.status(202).json(result);
};

const fetchSegmentExportProgress = async (request, response) => {
  const progress = await getSegmentExportProgress(request.params.taskId);
  response.status(200).json(progress);
};

const downloadSegmentExportArchive = async (request, response) => {
  const downloadPayload = await getSegmentExportDownload(request.params.taskId);
  response.download(downloadPayload.absolutePath, downloadPayload.filename);
};

export { startSegmentExportTask, fetchSegmentExportProgress, downloadSegmentExportArchive };
