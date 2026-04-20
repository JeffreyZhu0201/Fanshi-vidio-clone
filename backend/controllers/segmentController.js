import {
  analyzeSegmentById,
  listSegmentsByVideoId,
  startSplitVideo,
  updateSegmentShotsById
} from '../services/segmentService.js';

const splitVideoByAnchors = async (request, response) => {
  const result = await startSplitVideo({
    videoId: request.body.video_id,
    timeAnchors: request.body.time_anchors
  });

  response.status(202).json(result);
};

const fetchSegments = async (request, response) => {
  const segments = await listSegmentsByVideoId(request.params.videoId);
  response.status(200).json(segments);
};

const analyzeSegment = async (request, response) => {
  const segment = await analyzeSegmentById(request.params.id);
  response.status(200).json(segment);
};

const updateSegmentShots = async (request, response) => {
  const segment = await updateSegmentShotsById(request.params.id, request.body.shots);
  response.status(200).json(segment);
};

export { splitVideoByAnchors, fetchSegments, analyzeSegment, updateSegmentShots };
