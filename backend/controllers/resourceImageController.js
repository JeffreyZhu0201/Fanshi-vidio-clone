import {
  generateResourceImageBundle,
  listResourceImageAssetsByVideoId
} from '../services/resourceImageService.js';

const fetchResourceImageAssets = async (request, response) => {
  const resourceImageAssets = await listResourceImageAssetsByVideoId(Number(request.params.videoId));
  response.status(200).json(resourceImageAssets);
};

const generateResourceImages = async (request, response) => {
  const result = await generateResourceImageBundle({
    videoId: Number(request.body.video_id),
    resourceType: request.body.resource_type,
    resourceId: request.body.resource_id,
    resourceName: request.body.resource_name,
    sourcePrompt: request.body.source_prompt,
    variants: request.body.variants,
    representativeFrameTime: request.body.representative_frame_time,
    representativeFrameImagePath: request.body.representative_frame_image_path
  });

  response.status(200).json(result);
};

export { fetchResourceImageAssets, generateResourceImages };
