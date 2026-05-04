import { Op } from 'sequelize';

import { ResourceImageAsset } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { removeFileIfExists, toPublicUploadUrl, toAbsolutePublicUploadUrl } from './fileService.js';
import { generateImageAsset as generateGeminiImageAsset } from './geminiImageService.js';
import { generateCharacterTurnaround, generateImageAsset as generateSeedreamImageAsset } from './doubaoSeedreamService.js';

const inflightResourceImageBuilds = new Map();

const normalizeRepresentativeFrameTime = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? Number(parsedValue.toFixed(2)) : null;
};

const serializeResourceImageAsset = (asset) => {
  if (!asset) {
    return null;
  }

  return {
    id: asset.id,
    video_id: asset.videoId,
    resource_type: asset.resourceType,
    resource_id: asset.resourceId,
    name: asset.name,
    variant_id: asset.variantId,
    variant_label: asset.variantLabel,
    sort_order: asset.sortOrder,
    source_prompt: asset.sourcePrompt ?? '',
    prompt: asset.prompt ?? '',
    status: asset.status,
    asset_path: asset.assetPath ?? '',
    asset_url: asset.assetUrl ?? '',
    mime_type: asset.mimeType ?? '',
    representative_frame_time: normalizeRepresentativeFrameTime(asset.representativeFrameTime),
    error_message: asset.errorMessage ?? '',
    meta: asset.meta ?? {},
    created_at: asset.createdAt,
    updated_at: asset.updatedAt
  };
};

const listResourceImageAssetsByVideoId = async (videoId) => {
  const resourceImageAssets = await ResourceImageAsset.findAll({
    where: {
      videoId
    },
    order: [
      ['resourceType', 'ASC'],
      ['resourceId', 'ASC'],
      ['sortOrder', 'ASC'],
      ['createdAt', 'ASC']
    ]
  });

  return resourceImageAssets.map(serializeResourceImageAsset);
};

const listCompletedResourceImageAssetsByResourceKeys = async ({
  videoId,
  resourceType,
  resourceKeys = []
}) => {
  const normalizedKeys = Array.from(
    new Set(resourceKeys.map((item) => String(item ?? '').trim()).filter(Boolean))
  );

  if (!normalizedKeys.length) {
    return [];
  }

  const resourceImageAssets = await ResourceImageAsset.findAll({
    where: {
      videoId,
      resourceType,
      status: 'completed',
      resourceId: {
        [Op.in]: normalizedKeys
      }
    },
    order: [
      ['resourceId', 'ASC'],
      ['sortOrder', 'ASC'],
      ['createdAt', 'ASC']
    ]
  });

  return resourceImageAssets.map(serializeResourceImageAsset);
};

const upsertResourceImageAssetRecord = async ({
  videoId,
  resourceType,
  resourceId,
  resourceName,
  variantId,
  variantLabel,
  sortOrder,
  sourcePrompt,
  prompt,
  representativeFrameTime
}) => {
  const [asset] = await ResourceImageAsset.findOrCreate({
    where: {
      videoId,
      resourceType,
      resourceId,
      variantId
    },
    defaults: {
      videoId,
      resourceType,
      resourceId,
      name: resourceName,
      variantId,
      variantLabel,
      sortOrder,
      sourcePrompt,
      prompt,
      status: 'pending',
      representativeFrameTime,
      meta: {}
    }
  });

  return asset;
};

const sanitizeBasenamePart = (value = '') => {
  return String(value ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
};

const summarizeResourceImageError = (message = '') => {
  const normalizedMessage = String(message ?? '').trim();

  if (!normalizedMessage) {
    return '';
  }

  if (/status 503/iu.test(normalizedMessage) && /distributor|无可用渠道/iu.test(normalizedMessage)) {
    return '当前生图渠道不可用，请稍后重试或切换可用渠道。';
  }

  if (/status 429|quota|resource has been exhausted|并发/iu.test(normalizedMessage)) {
    return '当前生图额度或并发已耗尽，请稍后重试。';
  }

  if (/未配置远端密钥或地址/iu.test(normalizedMessage)) {
    return '生图服务未配置完成，请先检查后端图片模型密钥和地址。';
  }

  if (/fetch failed|request failed|unexpected eof|connect timeout|timed out/iu.test(normalizedMessage)) {
    return '当前到生图服务的连接不稳定，请稍后重试。';
  }

  return normalizedMessage;
};

const buildResourceImageSummary = (assets = []) => {
  const completedCount = assets.filter((asset) => asset.status === 'completed').length;
  const failedAssets = assets.filter((asset) => asset.status === 'failed');
  const failedCount = failedAssets.length;
  const summaryMessages = Array.from(
    new Set(
      failedAssets
        .map((asset) => summarizeResourceImageError(asset.errorMessage))
        .filter(Boolean)
    )
  );

  return {
    completedCount,
    failedCount,
    partialSuccess: completedCount > 0 && failedCount > 0,
    errorSummary: summaryMessages.join('；')
  };
};

const generateResourceImageBundle = async ({
  videoId,
  resourceType,
  resourceId,
  resourceName,
  sourcePrompt = '',
  variants = [],
  representativeFrameTime = null,
  representativeFrameImagePath = null
}) => {
  if (!videoId) {
    throw new AppError('videoId 缺失，无法生成资源图片。', 400);
  }

  if (!resourceType || !['character', 'scene'].includes(resourceType)) {
    throw new AppError('resourceType 必须为 character 或 scene。', 400);
  }

  if (!resourceId || !resourceName) {
    throw new AppError('resourceId 与 resourceName 为必填项。', 400);
  }

  if (!Array.isArray(variants) || !variants.length) {
    throw new AppError('variants 不能为空。', 400);
  }

  const assetKey = `${videoId}:${resourceType}:${resourceId}`;
  const existingInflightBuild = inflightResourceImageBuilds.get(assetKey);

  if (existingInflightBuild) {
    return existingInflightBuild;
  }

  const buildPromise = (async () => {
    const results = [];

    // Get reference image URL if representativeFrameImagePath is provided
    let referenceImageUrl = null;
    if (representativeFrameImagePath) {
      try {
        referenceImageUrl = toAbsolutePublicUploadUrl(representativeFrameImagePath);
      } catch (error) {
        // If we can't get the reference image URL, continue without it
        referenceImageUrl = null;
      }
    }

    for (const [index, variant] of variants.entries()) {
      const variantId = String(variant.id ?? '').trim();
      const variantLabel = String(variant.label ?? '').trim();
      const variantPrompt = String(variant.prompt ?? '').trim();

      if (!variantId || !variantLabel || !variantPrompt) {
        continue;
      }

      const asset = await upsertResourceImageAssetRecord({
        videoId,
        resourceType,
        resourceId,
        resourceName,
        variantId,
        variantLabel,
        sortOrder: Number(variant.sortOrder ?? index) || index,
        sourcePrompt,
        prompt: variantPrompt,
        representativeFrameTime
      });
      const previousAssetPath = asset.assetPath || '';

      await asset.update({
        name: resourceName,
        variantLabel,
        sortOrder: Number(variant.sortOrder ?? index) || index,
        sourcePrompt,
        prompt: variantPrompt,
        status: 'processing',
        representativeFrameTime,
        errorMessage: null
      });

      try {
        let imageResult;

        // Use Doubao-Seedream for character turnaround generation
        if (resourceType === 'character' && variantId === 'turnaround') {
          imageResult = await generateCharacterTurnaround({
            characterPrompt: variantPrompt,
            referenceImageUrl,
            basename: `${sanitizeBasenamePart(resourceType)}-${sanitizeBasenamePart(resourceId)}-${sanitizeBasenamePart(
              variantId
            )}`
          });
        } else {
          // Fallback to Gemini for other types
          imageResult = await generateGeminiImageAsset({
            prompt: variantPrompt,
            basename: `${sanitizeBasenamePart(resourceType)}-${sanitizeBasenamePart(resourceId)}-${sanitizeBasenamePart(
              variantId
            )}`
          });
        }

        if (previousAssetPath && previousAssetPath !== imageResult.filePath) {
          await removeFileIfExists(previousAssetPath);
        }

        await asset.update({
          status: 'completed',
          assetPath: imageResult.filePath,
          assetUrl: imageResult.fileUrl || toPublicUploadUrl(imageResult.filePath),
          mimeType: imageResult.mimeType,
          errorMessage: null,
          meta: {
            ...(asset.meta ?? {}),
            provider: imageResult.provider || '',
            model: imageResult.model || '',
            authVariant: imageResult.authVariant || '',
            generatedAt: new Date().toISOString(),
            hasReferenceImage: Boolean(referenceImageUrl)
          }
        });
      } catch (error) {
        await asset.update({
          status: 'failed',
          errorMessage: error.message,
          meta: {
            ...(asset.meta ?? {}),
            rawError: error.message,
            failedAt: new Date().toISOString()
          }
        });
      }

      results.push(asset);
    }

    const refreshedAssets = await ResourceImageAsset.findAll({
      where: {
        videoId,
        resourceType,
        resourceId
      },
      order: [
        ['sortOrder', 'ASC'],
        ['createdAt', 'ASC']
      ]
    });

    const resourceSummary = buildResourceImageSummary(refreshedAssets);

    return {
      video_id: videoId,
      resource_type: resourceType,
      resource_id: resourceId,
      completed_count: resourceSummary.completedCount,
      failed_count: resourceSummary.failedCount,
      partial_success: resourceSummary.partialSuccess,
      error_summary: resourceSummary.errorSummary,
      assets: refreshedAssets.map(serializeResourceImageAsset)
    };
  })();

  inflightResourceImageBuilds.set(assetKey, buildPromise);

  try {
    return await buildPromise;
  } finally {
    inflightResourceImageBuilds.delete(assetKey);
  }
};

export {
  serializeResourceImageAsset,
  listResourceImageAssetsByVideoId,
  listCompletedResourceImageAssetsByResourceKeys,
  generateResourceImageBundle,
  summarizeResourceImageError,
  buildResourceImageSummary
};
