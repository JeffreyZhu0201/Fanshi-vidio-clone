import { listSegmentsByVideoId, startSplitVideo } from '../services/segmentService.js';

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

export { splitVideoByAnchors, fetchSegments };
