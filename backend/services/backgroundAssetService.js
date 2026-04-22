import { BackgroundAsset } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { toPublicUploadUrl } from './fileService.js';
import { generateSegment as generateReferenceVideo } from './seedDanceService.js';

const BACKGROUND_ASSET_TYPE = 'reference_video';
const inflightBackgroundAssetBuilds = new Map();

const normalizeRepresentativeFrameTime = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? Number(parsedValue.toFixed(2)) : null;
};

const serializeBackgroundAsset = (asset) => {
  if (!asset) {
    return null;
  }

  return {
    id: asset.id,
    video_id: asset.videoId,
    background_id: asset.backgroundId,
    asset_type: asset.assetType,
    status: asset.status,
    name: asset.name,
    description: asset.description ?? '',
    scene_prompt: asset.scenePrompt ?? '',
    asset_path: asset.assetPath ?? '',
    asset_url: asset.assetUrl ?? '',
    source_segment_id: asset.sourceSegmentId ?? null,
    representative_frame_time: normalizeRepresentativeFrameTime(asset.representativeFrameTime),
    error_message: asset.errorMessage ?? '',
    meta: asset.meta ?? {},
    created_at: asset.createdAt,
    updated_at: asset.updatedAt
  };
};

const getBackgroundAssetRecord = async ({ videoId, backgroundId }) => {
  return BackgroundAsset.findOne({
    where: {
      videoId,
      backgroundId
    }
  });
};

const listBackgroundAssetsByVideoId = async (videoId) => {
  const backgroundAssets = await BackgroundAsset.findAll({
    where: {
      videoId
    },
    order: [
      ['backgroundId', 'ASC'],
      ['createdAt', 'ASC']
    ]
  });

  return backgroundAssets.map(serializeBackgroundAsset);
};

const buildBackgroundReferencePrompt = ({
  backgroundName,
  scenePrompt,
  description,
  segmentSceneSummary
}) => {
  return [
    `你要生成一个场景背景参考视频，场景名称：${backgroundName || '未命名场景'}。`,
    `场景资源库提示词：${scenePrompt || description || segmentSceneSummary || '无'}`,
    `当前片段解释：${segmentSceneSummary || description || '无'}`,
    '要求：',
    '1. 只保留环境、空间结构、光线、天气、布景和镜头氛围，不要出现人物正脸或主体角色。',
    '2. 这个视频将作为后续片段生成的背景一致性参考，需要尽量稳定、清晰、可复用。',
    '3. 保持电影感、空间层次、景深和环境运动，但避免强烈剧情动作。',
    '4. 输出一条适合作为 reference video 的背景参考视频。'
  ].join('\n');
};

const upsertBackgroundAssetRecord = async ({
  videoId,
  backgroundId,
  name,
  description,
  scenePrompt,
  sourceSegmentId,
  representativeFrameTime
}) => {
  const [asset] = await BackgroundAsset.findOrCreate({
    where: {
      videoId,
      backgroundId
    },
    defaults: {
      videoId,
      backgroundId,
      assetType: BACKGROUND_ASSET_TYPE,
      status: 'pending',
      name,
      description,
      scenePrompt,
      sourceSegmentId,
      representativeFrameTime,
      meta: {}
    }
  });

  return asset;
};

const ensureBackgroundAsset = async ({
  video,
  segment,
  backgroundId,
  backgroundName,
  backgroundDescription,
  backgroundPrompt,
  representativeFrameTime = null,
  segmentSceneSummary = '',
  sourcePublicUrl = '',
  sourceAbsolutePath
}) => {
  if (!backgroundId) {
    throw new AppError('当前片段缺少 backgroundId，无法准备背景资产。', 400, {
      segment_id: segment?.id,
      video_id: video?.id
    });
  }

  const assetKey = `${video.id}:${backgroundId}`;
  const existingInflightBuild = inflightBackgroundAssetBuilds.get(assetKey);

  if (existingInflightBuild) {
    return existingInflightBuild;
  }

  const buildPromise = (async () => {
    let backgroundAsset = await upsertBackgroundAssetRecord({
      videoId: video.id,
      backgroundId,
      name: backgroundName,
      description: backgroundDescription,
      scenePrompt: backgroundPrompt,
      sourceSegmentId: segment.id,
      representativeFrameTime
    });

    if (backgroundAsset.status === 'completed' && backgroundAsset.assetPath && backgroundAsset.assetUrl) {
      return backgroundAsset;
    }

    await backgroundAsset.update({
      assetType: BACKGROUND_ASSET_TYPE,
      status: 'processing',
      name: backgroundName || backgroundAsset.name,
      description: backgroundDescription || backgroundAsset.description,
      scenePrompt: backgroundPrompt || backgroundAsset.scenePrompt,
      sourceSegmentId: segment.id,
      representativeFrameTime,
      errorMessage: null
    });

    try {
      const generationResult = await generateReferenceVideo({
        sourceAbsolutePath,
        sourcePublicUrl,
        prompt: buildBackgroundReferencePrompt({
          backgroundName,
          scenePrompt: backgroundPrompt,
          description: backgroundDescription,
          segmentSceneSummary
        }),
        basename: `background-assets/video-${video.id}-background-${backgroundId.replace(
          /[^\p{L}\p{N}_-]+/gu,
          '-'
        )}`
      });

      await backgroundAsset.update({
        status: 'completed',
        assetPath: generationResult.filePath,
        assetUrl: generationResult.fileUrl || toPublicUploadUrl(generationResult.filePath),
        errorMessage: null,
        meta: {
          ...(backgroundAsset.meta ?? {}),
          engine: generationResult.engine || '',
          remoteTaskId: generationResult.remoteTaskId || '',
          remoteUrl: generationResult.remoteUrl || ''
        }
      });

      return backgroundAsset;
    } catch (error) {
      await backgroundAsset.update({
        status: 'failed',
        errorMessage: error.message,
        assetPath: null,
        assetUrl: null,
        meta: {
          ...(backgroundAsset.meta ?? {}),
          failedAt: new Date().toISOString()
        }
      });

      throw new Error(`背景资产生成失败：${error.message}`);
    }
  })();

  inflightBackgroundAssetBuilds.set(assetKey, buildPromise);

  try {
    return await buildPromise;
  } finally {
    inflightBackgroundAssetBuilds.delete(assetKey);
  }
};

export {
  BACKGROUND_ASSET_TYPE,
  ensureBackgroundAsset,
  getBackgroundAssetRecord,
  listBackgroundAssetsByVideoId,
  serializeBackgroundAsset
};
