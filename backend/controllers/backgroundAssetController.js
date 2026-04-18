import { listBackgroundAssetsByVideoId } from '../services/backgroundAssetService.js';

const fetchBackgroundAssets = async (request, response) => {
  const backgroundAssets = await listBackgroundAssetsByVideoId(Number(request.params.videoId));
  response.status(200).json(backgroundAssets);
};

export { fetchBackgroundAssets };
