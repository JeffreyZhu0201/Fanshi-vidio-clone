import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import env from '../config/env.js';
import logger from '../utils/logger.js';
import { requestExternalJson } from './externalHttpService.js';
import { removeFileIfExists, resolveUploadPath } from './fileService.js';
import { extractVideoFrame } from './ffmpegService.js';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const VIDEO_MIME_TYPES = Object.freeze({
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo'
});

const IMAGE_MIME_TYPES = Object.freeze({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
});

const stripMarkdownCodeFence = (value = '') => {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
};

const WHOLE_VIDEO_ANALYSIS_MIN_FRAME_COUNT = 4;
const WHOLE_VIDEO_ANALYSIS_MAX_FRAME_COUNT = 6;
const WHOLE_VIDEO_ANALYSIS_MODEL = 'gemini-2.5-pro';
const WHOLE_VIDEO_PRIMARY_UPLOAD_TIMEOUT_MS = Math.max(
  Number(env.GEMINI_WHOLE_VIDEO_TIMEOUT_MS) || 0,
  10 * 60 * 1000
);
const WHOLE_VIDEO_FRAME_FALLBACK_TIMEOUT_MS = 60 * 1000;

const extractJsonObject = (value = '') => {
  const cleanedValue = stripMarkdownCodeFence(value);
  const objectStart = cleanedValue.indexOf('{');
  const objectEnd = cleanedValue.lastIndexOf('}');

  if (objectStart === -1 || objectEnd === -1 || objectEnd < objectStart) {
    return cleanedValue;
  }

  return cleanedValue.slice(objectStart, objectEnd + 1);
};

const parseJsonPayload = (value, fallbackLabel) => {
  const jsonText = extractJsonObject(value);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`${fallbackLabel} 返回了无法解析的 JSON。`);
  }
};

const describeGeminiTransportError = (error) => {
  const primaryMessage = String(error?.message ?? '').trim();
  const causeMessage = String(error?.cause?.message ?? '').trim();

  if (primaryMessage && causeMessage && !primaryMessage.includes(causeMessage)) {
    return `${primaryMessage} (${causeMessage})`;
  }

  return primaryMessage || causeMessage || 'Unknown Gemini transport error';
};

const isNetworkLikeGeminiError = (error) => {
  const statusCode = Number(error?.statusCode ?? 0);
  const normalizedMessage = describeGeminiTransportError(error);

  if (statusCode > 0) {
    return false;
  }

  return /fetch failed|connect timeout|tls connection|socket disconnected|econnreset|enotfound|eai_again|timed out|timeout|aborted|unexpected eof/iu.test(
    normalizedMessage
  );
};

const isGeminiTimeoutError = (error) => {
  return /timed out|timeout|aborted/iu.test(describeGeminiTransportError(error));
};

const renderHighlightedPrompt = (prompt = '') => {
  return prompt
    .replace(
      /@([\p{L}\p{N}_-]+)/gu,
      '<span class="mention text-blue-500">$&</span>'
    )
    .replace(
      /#([\p{L}\p{N}_-]+)/gu,
      '<span class="mention text-amber-400">$&</span>'
    );
};

const normalizeOptionalNumber = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Number(parsedValue.toFixed(2));
};

const normalizeOptionalString = (value, fallback = '') => {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue || fallback;
};

const normalizeBackgroundAction = (value) => {
  const normalizedValue = String(value ?? '')
    .trim()
    .toLowerCase();

  if (normalizedValue === 'create_new') {
    return 'create_new';
  }

  if (normalizedValue === 'reuse_existing') {
    return 'reuse_existing';
  }

  return '';
};

const normalizeSceneKey = (value) => {
  return String(value ?? '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
};

const normalizeNameList = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
};

const getRepresentativeFrameTime = (startTime, endTime) => {
  const safeStartTime = Math.max(0, Number(startTime) || 0);
  const safeEndTime = Math.max(safeStartTime + 0.3, Number(endTime) || safeStartTime + 0.3);

  return Number((safeStartTime + (safeEndTime - safeStartTime) / 2).toFixed(2));
};

const normalizeShot = (item, index, anchor = null) => {
  const anchorStartTime = Number(anchor?.startTime ?? anchor?.start_time ?? 0);
  const anchorEndTime = Number(anchor?.endTime ?? anchor?.end_time ?? anchorStartTime + 1);
  const fallbackStartTime = Number.isFinite(anchorStartTime) ? anchorStartTime : 0;
  const fallbackEndTime =
    Number.isFinite(anchorEndTime) && anchorEndTime > fallbackStartTime ? anchorEndTime : fallbackStartTime + 1;
  const rawStartTime = Number(item?.startTime ?? item?.start_time ?? fallbackStartTime);
  const safeStartTime = Number.isFinite(rawStartTime) ? Math.max(fallbackStartTime, rawStartTime) : fallbackStartTime;
  const rawEndTime = Number(item?.endTime ?? item?.end_time ?? fallbackEndTime);
  const boundedEndTime = Number.isFinite(rawEndTime) ? Math.min(fallbackEndTime, rawEndTime) : fallbackEndTime;
  const safeEndTime = boundedEndTime > safeStartTime ? boundedEndTime : Math.min(fallbackEndTime, safeStartTime + 0.3);
  const representativeFrameTime =
    normalizeOptionalNumber(item?.representativeFrameTime ?? item?.representative_frame_time) ??
    getRepresentativeFrameTime(safeStartTime, safeEndTime);

  return {
    id: String(item?.id ?? `shot_${index + 1}`),
    startTime: Number(safeStartTime.toFixed(2)),
    endTime: Number(safeEndTime.toFixed(2)),
    summary: normalizeOptionalString(
      item?.summary ?? item?.sceneSummary ?? item?.scene_summary,
      `镜头 ${index + 1}`
    ),
    prompt: normalizeOptionalString(
      item?.prompt ?? item?.scenePrompt ?? item?.scene_prompt,
      normalizeOptionalString(item?.summary ?? item?.sceneSummary ?? item?.scene_summary, `镜头 ${index + 1}`)
    ),
    sceneNames: normalizeNameList(item?.sceneNames ?? item?.scene_names ?? item?.scenes),
    characterNames: normalizeNameList(item?.characterNames ?? item?.character_names ?? item?.characters),
    representativeFrameTime,
    representativeFrameNote: normalizeOptionalString(
      item?.representativeFrameNote ??
        item?.representative_frame_note ??
        item?.representativeFrameReason ??
        item?.representative_frame_reason
    )
  };
};

const buildFallbackShotList = (anchor, anchorIndex) => {
  const anchorStartTime = Number(anchor.startTime);
  const anchorEndTime = Number(anchor.endTime);
  const durationSeconds = Math.max(0.6, Number((anchorEndTime - anchorStartTime).toFixed(2)));
  const shotCount = durationSeconds >= 6 ? 3 : durationSeconds >= 3 ? 2 : 1;
  const shotDuration = durationSeconds / shotCount;

  return Array.from({ length: shotCount }, (_, shotIndex) => {
    const shotStartTime = Number((anchorStartTime + shotDuration * shotIndex).toFixed(2));
    const shotEndTime = Number(
      (shotIndex === shotCount - 1 ? anchorEndTime : anchorStartTime + shotDuration * (shotIndex + 1)).toFixed(2)
    );

    return normalizeShot(
      {
        id: `shot_${shotIndex + 1}`,
        startTime: shotStartTime,
        endTime: shotEndTime,
        summary: `片段 ${anchorIndex + 1} 的第 ${shotIndex + 1} 个镜头，延续当前动作与场景节奏，并体现稳定的构图与人物调度。`,
        prompt: `@主角 位于画面${['左侧前景', '中央中景', '右侧前景'][shotIndex % 3]}，在 #${anchor.backgroundName || '主场景'} 中完成第 ${shotIndex + 1} 个镜头的单一动作 beat，写清景别、机位方向、视线、前后景层次与运动轨迹，保持画面连续、人物一致和镜头衔接。`,
        sceneNames: anchor.backgroundName ? [anchor.backgroundName] : [],
        characterNames: ['主角'],
        representativeFrameTime: getRepresentativeFrameTime(shotStartTime, shotEndTime),
        representativeFrameNote: '该帧用于表示当前镜头最典型的动作与构图。'
      },
      shotIndex,
      anchor
    );
  });
};

const getMockScenePattern = (anchorCount) => {
  if (anchorCount >= 4) {
    return ['background_1', 'background_1', 'background_2', 'background_1'];
  }

  if (anchorCount === 3) {
    return ['background_1', 'background_2', 'background_1'];
  }

  return Array.from({ length: anchorCount }, (_, index) => `background_${index + 1}`);
};

const buildMockTimeAnchors = (durationSeconds = 12) => {
  const safeDuration = Math.max(6, durationSeconds || 12);
  const segmentCount = Math.min(4, Math.max(2, Math.ceil(safeDuration / 4)));
  const segmentLength = Number((safeDuration / segmentCount).toFixed(2));
  const mockScenePattern = getMockScenePattern(segmentCount);
  const seenBackgroundIds = new Set();

  return Array.from({ length: segmentCount }, (_, index) => {
    const startTime = Number((index * segmentLength).toFixed(2));
    const endTime = Number(
      (index === segmentCount - 1 ? safeDuration : (index + 1) * segmentLength).toFixed(2)
    );
    const representativeFrameTime = getRepresentativeFrameTime(startTime, endTime);
    const backgroundId = mockScenePattern[index] || `background_${index + 1}`;
    const backgroundName = backgroundId === 'background_1' ? '主场景' : '切换场景';
    const backgroundAction = seenBackgroundIds.has(backgroundId) ? 'reuse_existing' : 'create_new';
    seenBackgroundIds.add(backgroundId);

    const anchor = {
      startTime,
      endTime,
      sceneSummary: `第 ${index + 1} 个片段，围绕主角推进一段完整动作与场景变化。`,
      scenePrompt: `电影化片段场景，主角位于第 ${index + 1} 个片段的核心空间中，突出环境层次、主体关系、光线氛围与可直接复用的生成细节。`,
      representativeFrameTime,
      backgroundId,
      backgroundAction,
      backgroundName
    };

    return {
      ...anchor,
      shots: buildFallbackShotList(anchor, index)
    };
  });
};

const createMockVideoAnalysis = ({ video, metadata }) => {
  const anchors = buildMockTimeAnchors(metadata.duration || 12);
  const baseName = video.filename.replace(/\.[^.]+$/, '');
  const primaryFrameTime = anchors[0]?.representativeFrameTime ?? 1.2;
  const backgrounds = Array.from(
    anchors.reduce((accumulator, anchor) => {
      if (accumulator.has(anchor.backgroundId)) {
        return accumulator;
      }

      accumulator.set(anchor.backgroundId, {
        id: anchor.backgroundId,
        name: anchor.backgroundName,
        description: `${anchor.sceneSummary}，场景氛围偏电影化，光线柔和，环境细节完整。`,
        scenePrompt: `电影化 ${anchor.sceneSummary}，突出空间纵深、环境光线、布景层次、主体关系与适合直接复用的片段生成信息。`,
        representativeFrameTime: anchor.representativeFrameTime,
        representativeFrameNote: '该帧能够代表当前片段场景的空间结构、光线和布景细节。'
      });

      return accumulator;
    }, new Map()).values()
  );

  return {
    plot: `${baseName} 的剧情围绕主角完成一个简短目标展开，整体节奏清晰，便于后续按片段继续重生成。`,
    characters: [
      {
        id: 'character_main',
        name: '主角',
        appearancePrompt: '一位年轻主角，面部轮廓清晰，表情自然，服装简洁，镜头感强',
        personalityPrompt: '冷静克制，观察力强，带一点疏离感但行动果断',
        representativeFrameTime: primaryFrameTime,
        representativeFrameNote: '该帧能稳定体现主角的整体造型、服装和面部特征。'
      }
    ],
    backgrounds,
    timeAnchors: anchors,
    geminiResponse: JSON.stringify({
      provider: 'mock-gemini',
      filename: video.filename,
      generatedAt: new Date().toISOString()
    })
  };
};

const buildGeminiResponseEnvelope = ({
  provider = 'mock-gemini',
  model = env.GEMINI_MODEL,
  mode = env.GEMINI_API_COMPAT_MODE,
  authVariant = '',
  isMock = false,
  fallbackReason = '',
  remoteError = '',
  rawResponse = null
} = {}) => {
  return JSON.stringify({
    provider,
    model,
    mode,
    authVariant,
    isMock,
    fallbackReason,
    remoteError,
    rawResponse,
    recordedAt: new Date().toISOString()
  });
};

const createMockSegmentAnalysis = ({ segment, overallAnalysis }) => {
  const characters = overallAnalysis?.characters ?? [];
  const backgrounds = overallAnalysis?.backgrounds ?? [];
  const primaryCharacter = characters[0]?.name || '主角';
  const fallbackSceneName =
    segment?.analysis?.backgroundName ||
    backgrounds.find((item) => String(item?.id ?? '').trim() === String(segment?.analysis?.backgroundId ?? '').trim())
      ?.name ||
    '主场景';

  return {
    characters: characters.map((item) => item.name || item),
    scenes: [fallbackSceneName],
    scene: `片段 ${segment.segmentIndex + 1} 的场景延续整体剧情，强调环境氛围和镜头层次。`,
    action: `${primaryCharacter} 在当前片段中推进主要动作，镜头聚焦人物状态变化。`,
    prompt: `@${primaryCharacter} 在 #${fallbackSceneName} 中推进剧情，保持人物一致性、镜头连贯和环境细节。`
  };
};

const createMockShotSpeechAnalysis = ({ shot }) => {
  const transcript = '';

  return {
    transcript,
    subtitleLines: [],
    speechStyle: '',
    hasDialogue: false,
    extractionStatus: 'completed',
    extractionError: '',
    sourceOfTruth: 'extracted'
  };
};

const normalizePromptOptimizationMode = (mode = '') => {
  const normalizedMode = String(mode ?? '').trim();

  if (['character_resource', 'scene_resource', 'generation', 'shot_generation'].includes(normalizedMode)) {
    return normalizedMode;
  }

  return 'generation';
};

const createMockOptimizedPrompt = ({
  prompt,
  characters,
  backgrounds,
  mode = 'generation',
  segmentPrompt = '',
  shotPrompt = '',
  sceneNames = [],
  characterNames = []
}) => {
  const normalizedMode = normalizePromptOptimizationMode(mode);
  const normalizedCharacters = (characters ?? [])
    .map((item) =>
      typeof item === 'string'
        ? {
            name: item,
            appearancePrompt: item,
            personalityPrompt: ''
          }
        : {
            name: item?.name,
            appearancePrompt: item?.appearancePrompt ?? item?.appearance_prompt ?? item?.name ?? '',
            personalityPrompt:
              item?.personalityPrompt ??
              item?.personality_prompt ??
              item?.temperament ??
              item?.personality ??
              item?.traits ??
              ''
          }
    )
    .filter((item) => item?.name);
  const normalizedBackgrounds = (backgrounds ?? [])
    .map((item, index) =>
      typeof item === 'string'
        ? {
            name: `场景 ${index + 1}`
          }
        : {
            name: item?.name || item?.title || item?.sceneName || item?.scene_name
          }
    )
    .filter((item) => item?.name);

  let optimizedPrompt = prompt.trim();

  if (normalizedMode === 'character_resource') {
    const primaryCharacter = normalizedCharacters[0] ?? null;

    optimizedPrompt = [
      primaryCharacter?.appearancePrompt ? `外表描述：${primaryCharacter.appearancePrompt}` : '',
      primaryCharacter?.personalityPrompt ? `性格气质：${primaryCharacter.personalityPrompt}` : '',
      '单人角色三视图设定，纯白无缝背景，全身完整入镜，中性站姿，写实电影角色美术风格，服装结构与面部特征稳定清晰。'
    ]
      .filter(Boolean)
      .join('，');

    return {
      optimizedPrompt,
      highlightedPrompt: renderHighlightedPrompt(optimizedPrompt)
    };
  }

  if (normalizedMode === 'scene_resource') {
    const primaryBackground = normalizedBackgrounds[0] ?? null;

    optimizedPrompt = [
      prompt.trim(),
      primaryBackground?.name ? `场景名称：${primaryBackground.name}` : '',
      '纯场景背景参考图，不要人物，不要文字，突出空间结构、光线、材质与纵深关系。'
    ]
      .filter(Boolean)
      .join('，');

    return {
      optimizedPrompt,
      highlightedPrompt: renderHighlightedPrompt(optimizedPrompt)
    };
  }

  if (normalizedMode === 'shot_generation') {
    const sourceShotPrompt = String(shotPrompt ?? '').trim() || String(prompt ?? '').trim();
    const sourceSegmentPrompt = String(segmentPrompt ?? '').trim();

    optimizedPrompt = sourceShotPrompt || sourceSegmentPrompt || optimizedPrompt;

    normalizedCharacters
      .sort((left, right) => String(right.name).length - String(left.name).length)
      .forEach((resource) => {
        if (!resource.name) {
          return;
        }

        const namePattern = new RegExp(`(?<![@#])${escapeRegExp(resource.name)}`, 'gu');
        optimizedPrompt = optimizedPrompt.replace(namePattern, `@${resource.name}`);
      });

    normalizedBackgrounds
      .sort((left, right) => String(right.name).length - String(left.name).length)
      .forEach((resource) => {
        if (!resource.name) {
          return;
        }

        const namePattern = new RegExp(`(?<![@#])${escapeRegExp(resource.name)}`, 'gu');
        optimizedPrompt = optimizedPrompt.replace(namePattern, `#${resource.name}`);
      });

    optimizedPrompt = [
      optimizedPrompt,
      sceneNames.length ? `涉及场景：${normalizeSceneNameList(sceneNames).map((item) => `#${item}`).join('、')}` : '',
      characterNames.length
        ? `涉及角色：${normalizeSceneNameList(characterNames).map((item) => `@${item}`).join('、')}`
        : '',
      sourceSegmentPrompt ? `与大片段衔接：${sourceSegmentPrompt}` : '',
      '强化单镜头动作、节奏和镜头语言，写清人物站位、前后景关系、景别、机位、视线和运动方向，保持与大片段叙事一致。'
    ]
      .filter(Boolean)
      .join('，');

    return {
      optimizedPrompt,
      highlightedPrompt: renderHighlightedPrompt(optimizedPrompt)
    };
  }

  normalizedCharacters
    .sort((left, right) => String(right.name).length - String(left.name).length)
    .forEach((resource) => {
      if (!resource.name) {
        return;
      }

      const namePattern = new RegExp(`(?<![@#])${escapeRegExp(resource.name)}`, 'gu');
      optimizedPrompt = optimizedPrompt.replace(namePattern, `@${resource.name}`);
    });

  normalizedBackgrounds
    .sort((left, right) => String(right.name).length - String(left.name).length)
    .forEach((resource) => {
      if (!resource.name) {
        return;
      }

      const namePattern = new RegExp(`(?<![@#])${escapeRegExp(resource.name)}`, 'gu');
      optimizedPrompt = optimizedPrompt.replace(namePattern, `#${resource.name}`);
    });

  return {
    optimizedPrompt,
    highlightedPrompt: renderHighlightedPrompt(optimizedPrompt)
  };
};

const normalizeSceneNameList = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
};

const ensureSceneList = (sceneNames = [], fallbackSceneName = '') => {
  const normalizedSceneNames = normalizeSceneNameList(sceneNames);

  if (normalizedSceneNames.length) {
    return normalizedSceneNames;
  }

  const fallback = String(fallbackSceneName ?? '').trim();

  return fallback ? [fallback] : [];
};

const normalizeSegmentAnalysisPayload = (payload = {}, fallbackSceneName = '') => {
  return {
    characters: (payload.characters ?? []).map((item) => String(item).trim()).filter(Boolean),
    scenes: ensureSceneList(payload.scenes, fallbackSceneName),
    scene: String(payload.scene ?? '').trim(),
    action: String(payload.action ?? '').trim(),
    prompt: String(payload.prompt ?? '').trim()
  };
};

const canUseRemoteGemini = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_BASE_URL);
const VIDEO_GEMINI_REQUEST_MIN_TIMEOUT_MS = 10 * 60 * 1000;

const shouldUseStrictRemoteGemini = () => {
  return canUseRemoteGemini && env.GEMINI_STRICT_REMOTE;
};

const getGeminiRetryDelayMs = (attempt) => {
  return attempt * 1200;
};

const getGeminiRequestTimeoutMs = ({ videoAbsolutePath = '' } = {}) => {
  if (!videoAbsolutePath) {
    return env.EXTERNAL_REQUEST_TIMEOUT;
  }

  return Math.max(env.EXTERNAL_REQUEST_TIMEOUT, VIDEO_GEMINI_REQUEST_MIN_TIMEOUT_MS);
};

const isRetryableGeminiStatus = (statusCode) => {
  return [408, 429, 500, 502, 503, 504].includes(Number(statusCode));
};

const isAuthLikeGeminiStatus = (statusCode) => {
  return [400, 401, 403, 404].includes(Number(statusCode));
};

const isGeminiModelUnavailableError = (error) => {
  const message = String(error?.message ?? '').trim();
  const statusCode = Number(error?.statusCode ?? 0);

  if ([400, 404].includes(statusCode)) {
    return true;
  }

  return /model_not_found|无可用渠道|distributor|上游负载已饱和|模型不可用/iu.test(message);
};

const getGeminiModelCandidates = (requestedModel, { allowModelFallback = true } = {}) => {
  if (!allowModelFallback) {
    return [String(requestedModel ?? '').trim()].filter(Boolean);
  }

  const fallbackModels = [requestedModel, env.GEMINI_SEGMENT_MODEL, env.GEMINI_MODEL, 'gemini-2.5-flash'];
  const seenModels = new Set();

  return fallbackModels
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .filter((item) => {
      if (seenModels.has(item)) {
        return false;
      }

      seenModels.add(item);
      return true;
    });
};

const resolveAssetMimeType = (absolutePath) => {
  const extension = path.extname(absolutePath).toLowerCase();

  return VIDEO_MIME_TYPES[extension] || IMAGE_MIME_TYPES[extension] || 'application/octet-stream';
};

const readAssetAsBase64 = async (absolutePath) => {
  const buffer = await readFile(absolutePath);
  return buffer.toString('base64');
};

const readAssetAsDataUrl = async (absolutePath) => {
  const mimeType = resolveAssetMimeType(absolutePath);
  const base64Data = await readAssetAsBase64(absolutePath);

  return {
    mimeType,
    base64Data,
    dataUrl: `data:${mimeType};base64,${base64Data}`
  };
};

const normalizeCharacter = (item, index) => {
  if (!item) {
    return null;
  }

  if (typeof item === 'string') {
    return {
      id: `character_${index + 1}`,
      name: item,
      appearancePrompt: item,
      representativeFrameTime: null,
      representativeFrameNote: ''
    };
  }

  const name = String(item.name ?? item.label ?? '').trim();

  if (!name) {
    return null;
  }

  return {
    id: String(item.id ?? `character_${index + 1}`),
    name,
    appearancePrompt: String(item.appearancePrompt ?? item.appearance_prompt ?? name).trim(),
    personalityPrompt: normalizeOptionalString(
      item.personalityPrompt ??
        item.personality_prompt ??
        item.temperament ??
        item.personality ??
        item.traits
    ),
    representativeFrameTime: normalizeOptionalNumber(
      item.representativeFrameTime ?? item.representative_frame_time
    ),
    representativeFrameNote: normalizeOptionalString(
      item.representativeFrameNote ??
        item.representative_frame_note ??
        item.representativeFrameReason ??
        item.representative_frame_reason
    )
  };
};

const normalizeBackground = (item, index) => {
  if (!item) {
    return null;
  }

  if (typeof item === 'string') {
    return {
      id: `background_${index + 1}`,
      name: `场景 ${index + 1}`,
      description: item,
      scenePrompt: item,
      representativeFrameTime: null,
      representativeFrameNote: ''
    };
  }

  const description = String(item.description ?? item.summary ?? '').trim();
  const name = normalizeOptionalString(
    item.name ?? item.title ?? item.sceneName ?? item.scene_name,
    `场景 ${index + 1}`
  );

  if (!description) {
    return null;
  }

  return {
    id: String(item.id ?? `background_${index + 1}`),
    name,
    description,
    scenePrompt: normalizeOptionalString(item.scenePrompt ?? item.scene_prompt, description),
    representativeFrameTime: normalizeOptionalNumber(
      item.representativeFrameTime ?? item.representative_frame_time
    ),
    representativeFrameNote: normalizeOptionalString(
      item.representativeFrameNote ??
        item.representative_frame_note ??
        item.representativeFrameReason ??
        item.representative_frame_reason
    )
  };
};

const normalizeTimeAnchor = (item, index, fallbackDuration = 0) => {
  if (!item) {
    return null;
  }

  const startTime = Number(item.startTime ?? item.start_time ?? index * 3);
  const rawEndTime = Number(item.endTime ?? item.end_time ?? startTime + 3);
  const endTime = rawEndTime > startTime ? rawEndTime : startTime + 0.5;
  const sceneSummary = String(item.sceneSummary ?? item.scene_summary ?? `片段 ${index + 1}`).trim();
  const normalizedEndTime = Number(
    Math.min(Math.max(endTime, startTime + 0.5), fallbackDuration || endTime).toFixed(2)
  );
  const representativeFrameTime =
    normalizeOptionalNumber(item.representativeFrameTime ?? item.representative_frame_time) ??
    getRepresentativeFrameTime(startTime, normalizedEndTime);
  const anchor = {
    startTime: Number(Math.max(0, startTime).toFixed(2)),
    endTime: normalizedEndTime,
    backgroundName: normalizeOptionalString(item.backgroundName ?? item.background_name)
  };
  const normalizedShots = Array.isArray(item.shots)
    ? item.shots.map((shotItem, shotIndex) => normalizeShot(shotItem, shotIndex, anchor)).filter(Boolean)
    : [];

  return {
    startTime: anchor.startTime,
    endTime: anchor.endTime,
    sceneSummary,
    scenePrompt: normalizeOptionalString(item.scenePrompt ?? item.scene_prompt, sceneSummary),
    representativeFrameTime,
    representativeFrameNote: normalizeOptionalString(
      item.representativeFrameNote ??
        item.representative_frame_note ??
        item.representativeFrameReason ??
        item.representative_frame_reason
    ),
    backgroundId: normalizeOptionalString(item.backgroundId ?? item.background_id),
    backgroundAction: normalizeBackgroundAction(item.backgroundAction ?? item.background_action),
    backgroundName: anchor.backgroundName,
    shots: normalizedShots.length
      ? normalizedShots
      : buildFallbackShotList(
          {
            startTime: anchor.startTime,
            endTime: anchor.endTime,
            backgroundName: anchor.backgroundName
          },
          index
        )
  };
};

const buildDerivedBackgroundFromAnchor = (anchor, index) => {
  return normalizeBackground(
    {
      id: anchor.backgroundId || `background_${index + 1}`,
      name: anchor.backgroundName || `场景 ${index + 1}`,
      description: anchor.sceneSummary,
      scenePrompt: anchor.scenePrompt,
      representativeFrameTime: anchor.representativeFrameTime,
      representativeFrameNote: anchor.representativeFrameNote
    },
    index
  );
};

const hydrateSceneRelationships = ({ timeAnchors = [], backgrounds = [] }) => {
  const backgroundList = backgrounds
    .map((item, index) => normalizeBackground(item, index))
    .filter(Boolean);
  const backgroundById = new Map();
  const backgroundKeyToId = new Map();
  let nextBackgroundIndex = backgroundList.length;

  backgroundList.forEach((background, index) => {
    backgroundById.set(background.id, background);
    [background.id, background.name, background.scenePrompt, background.description].forEach((value) => {
      const normalizedKey = normalizeSceneKey(value);

      if (normalizedKey && !backgroundKeyToId.has(normalizedKey)) {
        backgroundKeyToId.set(normalizedKey, background.id);
      }
    });

    nextBackgroundIndex = Math.max(nextBackgroundIndex, index + 1);
  });

  const getOrCreateBackground = (anchor, index) => {
    const lookupKeys = [
      anchor.backgroundId,
      anchor.backgroundName,
      anchor.scenePrompt,
      anchor.sceneSummary
    ]
      .map(normalizeSceneKey)
      .filter(Boolean);
    const explicitBackgroundId =
      anchor.backgroundId && backgroundById.has(anchor.backgroundId) ? anchor.backgroundId : '';

    if (explicitBackgroundId) {
      return backgroundById.get(explicitBackgroundId);
    }

    const matchedBackgroundId = lookupKeys.find((key) => backgroundKeyToId.has(key))
      ? backgroundKeyToId.get(lookupKeys.find((key) => backgroundKeyToId.has(key)))
      : '';

    if (matchedBackgroundId && backgroundById.has(matchedBackgroundId)) {
      return backgroundById.get(matchedBackgroundId);
    }

    if (!anchor.backgroundId && !anchor.backgroundName && backgroundList.length === 1) {
      return backgroundList[0];
    }

    let candidateId = anchor.backgroundId || `background_${nextBackgroundIndex + 1}`;

    while (backgroundById.has(candidateId)) {
      nextBackgroundIndex += 1;
      candidateId = `background_${nextBackgroundIndex + 1}`;
    }

    nextBackgroundIndex += 1;

    const derivedBackground = buildDerivedBackgroundFromAnchor(
      {
        ...anchor,
        backgroundId: candidateId
      },
      index
    );

    backgroundList.push(derivedBackground);
    backgroundById.set(derivedBackground.id, derivedBackground);

    [derivedBackground.id, derivedBackground.name, derivedBackground.scenePrompt, derivedBackground.description]
      .map(normalizeSceneKey)
      .filter(Boolean)
      .forEach((key) => {
        if (!backgroundKeyToId.has(key)) {
          backgroundKeyToId.set(key, derivedBackground.id);
        }
      });

    return derivedBackground;
  };

  const firstBackgroundUsage = new Set();
  const hydratedTimeAnchors = timeAnchors.map((anchor, index) => {
    const background = getOrCreateBackground(anchor, index);
    const backgroundId = background?.id || anchor.backgroundId || `background_${index + 1}`;
    const backgroundName = anchor.backgroundName || background?.name || `场景 ${index + 1}`;
    const normalizedAction = firstBackgroundUsage.has(backgroundId)
      ? 'reuse_existing'
      : 'create_new';

    firstBackgroundUsage.add(backgroundId);

    return {
      ...anchor,
      backgroundId,
      backgroundName,
      backgroundAction: normalizedAction
    };
  });

  return {
    backgrounds: backgroundList,
    timeAnchors: hydratedTimeAnchors
  };
};

const resolveGeminiEndpoint = (mode = env.GEMINI_API_COMPAT_MODE, model = env.GEMINI_MODEL) => {
  const trimmedBaseUrl = env.GEMINI_API_BASE_URL.replace(/\/+$/u, '');

  if (trimmedBaseUrl.endsWith(':generateContent') || trimmedBaseUrl.endsWith('/chat/completions')) {
    return trimmedBaseUrl;
  }

  if (mode === 'openai') {
    return `${trimmedBaseUrl}/v1/chat/completions`;
  }

  return `${trimmedBaseUrl}/v1beta/models/${model}:generateContent`;
};

const appendKeyQuery = (endpoint, token) => {
  const url = new URL(endpoint);
  url.searchParams.set('key', token);
  return url.toString();
};

const buildGooglePromptPayload = async ({ prompt, videoAbsolutePath = '', imageAbsolutePaths = [] }) => {
  const parts = [];

  if (videoAbsolutePath) {
    const assetData = await readAssetAsBase64(videoAbsolutePath);

    parts.push({
      inline_data: {
        mime_type: resolveAssetMimeType(videoAbsolutePath),
        data: assetData
      }
    });
  }

  for (const imageAbsolutePath of imageAbsolutePaths) {
    const assetData = await readAssetAsBase64(imageAbsolutePath);

    parts.push({
      inline_data: {
        mime_type: resolveAssetMimeType(imageAbsolutePath),
        data: assetData
      }
    });
  }

  parts.push({
    text: prompt
  });

  return {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };
};

const buildOpenAiPromptPayload = async ({ prompt, videoAbsolutePath = '', model = env.GEMINI_MODEL }) => {
  const userContent = [{ type: 'text', text: prompt }];

  if (videoAbsolutePath) {
    const assetData = await readAssetAsDataUrl(videoAbsolutePath);

    userContent.push({
      type: 'video_url',
      video_url: {
        url: assetData.dataUrl
      }
    });
  }

  return {
    model,
    temperature: 0.2,
    response_format: {
      type: 'json_object'
    },
    messages: [
      {
        role: 'user',
        content: userContent
      }
    ]
  };
};

const getWholeVideoFrameSampleTimes = (durationSeconds = 0) => {
  const safeDurationSeconds = Number(durationSeconds);

  if (!Number.isFinite(safeDurationSeconds) || safeDurationSeconds <= 0.3) {
    return [0, 0.8, 1.6, 2.4];
  }

  const clampedMaxTime = Math.max(0, safeDurationSeconds - 0.05);
  const sampleCount = Math.min(
    WHOLE_VIDEO_ANALYSIS_MAX_FRAME_COUNT,
    Math.max(
      WHOLE_VIDEO_ANALYSIS_MIN_FRAME_COUNT,
      safeDurationSeconds >= 40 ? 6 : safeDurationSeconds >= 15 ? 5 : 4
    )
  );
  const edgePaddingSeconds = Math.min(0.8, Math.max(0.08, safeDurationSeconds * 0.06));
  const startTime = Math.min(edgePaddingSeconds, clampedMaxTime);
  const endTime = Math.max(startTime, safeDurationSeconds - edgePaddingSeconds);

  if (sampleCount === 1 || endTime - startTime <= 0.1) {
    return [Number(Math.max(0, Math.min(clampedMaxTime, safeDurationSeconds / 2)).toFixed(2))];
  }

  const timeSet = new Set();
  const sampledTimes = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const sampledTime = Number((startTime + (endTime - startTime) * ratio).toFixed(2));
    const boundedTime = Number(Math.max(0, Math.min(clampedMaxTime, sampledTime)).toFixed(2));
    const dedupeKey = boundedTime.toFixed(2);

    if (timeSet.has(dedupeKey)) {
      continue;
    }

    timeSet.add(dedupeKey);
    sampledTimes.push(boundedTime);
  }

  if (!sampledTimes.length) {
    return [Number(Math.max(0, Math.min(clampedMaxTime, safeDurationSeconds / 2)).toFixed(2))];
  }

  return sampledTimes;
};

const extractWholeVideoFrameSamples = async ({ videoAbsolutePath, durationSeconds, video }) => {
  const sampleTimes = getWholeVideoFrameSampleTimes(durationSeconds);
  const basename = String(video?.filename ?? 'analysis-video')
    .replace(/\.[^.]+$/u, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'analysis-video';
  const frameSamples = [];

  for (let index = 0; index < sampleTimes.length; index += 1) {
    const frameAsset = await extractVideoFrame(videoAbsolutePath, sampleTimes[index], {
      basename: `${basename}-analysis-frame-${index + 1}`
    });

    if (!frameAsset?.filePath) {
      continue;
    }

    frameSamples.push({
      index,
      label: `图片${index + 1}`,
      timeSeconds: sampleTimes[index],
      filePath: frameAsset.filePath,
      fileUrl: frameAsset.fileUrl,
      absolutePath: resolveUploadPath(frameAsset.filePath)
    });
  }

  return frameSamples;
};

const cleanupWholeVideoFrameSamples = async (frameSamples = []) => {
  await Promise.allSettled(
    frameSamples
      .map((sample) => String(sample?.filePath ?? '').trim())
      .filter(Boolean)
      .map((filePath) => removeFileIfExists(filePath))
  );
};

const buildFrameFallbackVideoAnalysisPrompt = ({ video, metadata, frameSamples = [] }) => {
  const frameTimeline = frameSamples
    .map((sample) => `${sample.label}=${Number(sample.timeSeconds).toFixed(2)}秒`)
    .join('；');

  return [
    '补充说明：当前不是直接上传整段视频文件，而是按时间顺序提供整片关键帧采样图片。',
    `关键帧数量：${frameSamples.length}`,
    `关键帧时间线：${frameTimeline || '未提供时间线'}`,
    '这些图片严格按照整片时间顺序排列，代表同一条视频从头到尾的关键画面采样，不是独立素材图。',
    '你需要把这些关键帧当作整片视频的时间采样来理解剧情推进、人物连续性、场景复现关系、镜头边界和动作节奏。',
    '时间锚点与小镜头时间仍然必须填写整片绝对秒数，不能只写图片序号区间。',
    '如果两张关键帧之间存在明显动作跳变、机位变化、场景变化或说话节奏变化，要据此尽量还原中间真实发生的切换，并合理细分片段和小镜头。',
    buildVideoAnalysisPrompt({ video, metadata })
  ].join('\n');
};

const normalizeVideoAnalysisPayload = ({ parsedPayload, metadata, analysisOptions, geminiResponse }) => {
  const normalizedTimeAnchors =
    (parsedPayload.timeAnchors ?? parsedPayload.time_anchors ?? [])
      .map((item, index) => normalizeTimeAnchor(item, index, Number(metadata.duration) || 0))
      .filter(Boolean) || [];
  const normalizedBackgrounds = (parsedPayload.backgrounds ?? []).filter(Boolean);
  const hydratedScenePayload = hydrateSceneRelationships({
    timeAnchors: normalizedTimeAnchors,
    backgrounds: normalizedBackgrounds
  });
  const derivedTimeAnchors = hydratedScenePayload.timeAnchors.length
    ? hydratedScenePayload.timeAnchors
    : buildMockTimeAnchors(metadata.duration || 12);
  const derivedBackgrounds = hydratedScenePayload.backgrounds.length
    ? hydratedScenePayload.backgrounds
    : derivedTimeAnchors.map(buildDerivedBackgroundFromAnchor).filter(Boolean);

  return {
    plot: String(parsedPayload.plot ?? '').trim(),
    characters: (parsedPayload.characters ?? []).map(normalizeCharacter).filter(Boolean),
    backgrounds: derivedBackgrounds.filter(Boolean),
    timeAnchors: derivedTimeAnchors,
    analysisOptions,
    geminiResponse
  };
};

const analyzeVideoWithFrameFallback = async ({
  video,
  metadata,
  videoAbsolutePath,
  analysisOptions = null,
  primaryError = null
}) => {
  const frameSamples = await extractWholeVideoFrameSamples({
    videoAbsolutePath,
    durationSeconds: metadata?.duration,
    video
  });

  if (!frameSamples.length) {
    throw new Error('关键帧回退失败：无法从原视频中提取可用的整片关键帧。');
  }

  try {
    const { authVariant, model: resolvedModel, responsePayload, responseText } = await callRemoteGemini({
      prompt: buildFrameFallbackVideoAnalysisPrompt({ video, metadata, frameSamples }),
      imageAbsolutePaths: frameSamples.map((sample) => sample.absolutePath),
      requestTimeoutOverrideMs: WHOLE_VIDEO_FRAME_FALLBACK_TIMEOUT_MS,
      preferCurlTransport: true,
      model: env.GEMINI_SEGMENT_MODEL || env.GEMINI_MODEL
    });
    const parsedPayload = parseJsonPayload(responseText, '整片分析模型（关键帧回退）');

    return normalizeVideoAnalysisPayload({
      parsedPayload,
      metadata,
      analysisOptions,
      geminiResponse: buildGeminiResponseEnvelope({
        provider: 'remote-gemini',
        model: resolvedModel || env.GEMINI_MODEL,
        mode: 'google',
        authVariant,
        isMock: false,
        fallbackReason: 'frame_sampling',
        remoteError: primaryError ? describeGeminiTransportError(primaryError) : '',
        rawResponse: {
          transport: 'frame_sampling',
          frameSamples: frameSamples.map((sample) => ({
            label: sample.label,
            timeSeconds: sample.timeSeconds,
            fileUrl: sample.fileUrl
          })),
          response: responsePayload
        }
      })
    });
  } finally {
    await cleanupWholeVideoFrameSamples(frameSamples);
  }
};

const callRemoteGeminiOverHttp = async ({
  url,
  headers = {},
  requestBody,
  timeoutMs = env.EXTERNAL_REQUEST_TIMEOUT,
  mode = env.GEMINI_API_COMPAT_MODE,
  authVariant = '',
  model = env.GEMINI_MODEL
}) => {
  const { response, responseText, responsePayload } = await requestExternalJson(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    timeoutMs
  });
  const statusCode = response.status;

  if (statusCode < 200 || statusCode >= 300) {
    const error = new Error(
      `Gemini request failed with status ${statusCode}: ${responseText.slice(0, 240)}`
    );
    error.statusCode = statusCode;
    error.authVariant = authVariant;
    error.model = model;
    throw error;
  }

  return {
    authVariant,
    model,
    responsePayload,
    responseText:
      mode === 'openai'
        ? extractOpenAiResponseText(responsePayload)
        : extractGoogleResponseText(responsePayload)
  };
};

const extractGoogleResponseText = (responsePayload) => {
  const candidate = responsePayload?.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('\n').trim();

  if (!text) {
    throw new Error('Gemini 未返回可解析的文本结果。');
  }

  return text;
};

const extractOpenAiResponseText = (responsePayload) => {
  const text = responsePayload?.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error('Gemini OpenAI 兼容接口未返回可解析的文本结果。');
  }

  return text;
};

const callRemoteGemini = async ({
  prompt,
  videoAbsolutePath = '',
  imageAbsolutePaths = [],
  requestTimeoutOverrideMs = null,
  preferCurlTransport = false,
  mode = env.GEMINI_API_COMPAT_MODE,
  model = env.GEMINI_MODEL,
  allowModelFallback = true,
  allowAuthVariantFallback = true,
  maxAttempts = 3
}) => {
  const hasMediaInput = Boolean(videoAbsolutePath || imageAbsolutePaths.length);
  const resolvedMode = hasMediaInput && mode !== 'google' ? 'google' : mode;
  const requestTimeoutMs =
    Number.isFinite(Number(requestTimeoutOverrideMs)) && Number(requestTimeoutOverrideMs) > 0
      ? Number(requestTimeoutOverrideMs)
      : getGeminiRequestTimeoutMs({ videoAbsolutePath });
  let lastError = null;

  for (const modelCandidate of getGeminiModelCandidates(model, { allowModelFallback })) {
    const endpoint = resolveGeminiEndpoint(resolvedMode, modelCandidate);
    const requestBody =
      resolvedMode === 'openai'
        ? await buildOpenAiPromptPayload({ prompt, videoAbsolutePath, model: modelCandidate })
        : await buildGooglePromptPayload({ prompt, videoAbsolutePath, imageAbsolutePaths });
    const requestVariants =
      resolvedMode === 'google'
        ? [
            {
              name: 'bearer+query-key',
              url: appendKeyQuery(endpoint, env.GEMINI_API_KEY),
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.GEMINI_API_KEY}`
              }
            },
            {
              name: 'query-key',
              url: appendKeyQuery(endpoint, env.GEMINI_API_KEY),
              headers: {
                'Content-Type': 'application/json'
              }
            },
            {
              name: 'bearer',
              url: endpoint,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.GEMINI_API_KEY}`
              }
            }
          ]
        : [
            {
              name: 'bearer',
              url: endpoint,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${env.GEMINI_API_KEY}`
              }
            }
          ];
    const activeRequestVariants = allowAuthVariantFallback ? requestVariants : requestVariants.slice(0, 1);

    for (let variantIndex = 0; variantIndex < activeRequestVariants.length; variantIndex += 1) {
      const requestVariant = activeRequestVariants[variantIndex];

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (preferCurlTransport || hasMediaInput) {
          try {
            return await callRemoteGeminiOverHttp({
              url: requestVariant.url,
              headers: requestVariant.headers,
              requestBody,
              timeoutMs: requestTimeoutMs,
              mode: resolvedMode,
              authVariant: `${requestVariant.name}+node`,
              model: modelCandidate
            });
          } catch (nodeTransportError) {
            lastError = nodeTransportError;

            if (
              allowAuthVariantFallback &&
              isAuthLikeGeminiStatus(nodeTransportError.statusCode) &&
              variantIndex < activeRequestVariants.length - 1
            ) {
              break;
            }

            if (
              attempt >= maxAttempts ||
              (!isRetryableGeminiStatus(nodeTransportError.statusCode) && !isNetworkLikeGeminiError(nodeTransportError))
            ) {
              break;
            }

            await sleep(getGeminiRetryDelayMs(attempt));
            continue;
          }
        }

        try {
          return await callRemoteGeminiOverHttp({
            url: requestVariant.url,
            headers: requestVariant.headers,
            requestBody,
            timeoutMs: requestTimeoutMs,
            mode: resolvedMode,
            authVariant: requestVariant.name,
            model: modelCandidate
          });
        } catch (error) {
          lastError = error;

          if (
            allowAuthVariantFallback &&
            isAuthLikeGeminiStatus(error.statusCode) &&
            variantIndex < activeRequestVariants.length - 1
          ) {
            break;
          }

          if (attempt >= maxAttempts || (!isRetryableGeminiStatus(error.statusCode) && !isNetworkLikeGeminiError(error))) {
            break;
          }

          await sleep(getGeminiRetryDelayMs(attempt));
        }
      }

      if (lastError && !isAuthLikeGeminiStatus(lastError.statusCode)) {
        break;
      }
    }

    if (!lastError || !isGeminiModelUnavailableError(lastError)) {
      break;
    }

    logger.warn('Gemini primary model unavailable, retrying with fallback model.', {
      requestedModel: model,
      fallbackModel: modelCandidate,
      message: lastError.message
    });
  }

  throw lastError ?? new Error('Gemini request failed.');
};

const buildVideoAnalysisPrompt = ({ video, metadata }) => {
  return [
    '你是一名资深视频理解与影视拆解助手。',
    '请对输入的整条视频做一次完整的整体视频理解，并严格返回 JSON。',
    '不要输出 Markdown，不要输出解释，不要输出额外文本。',
    '这次返回必须一次性包含整片剧情、角色、场景资源、大片段和每个大片段下的全部小镜头信息。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        plot: 'string',
        characters: [
          {
            id: 'character_1',
            name: '角色名',
            appearancePrompt: '角色完整形象设定',
            personalityPrompt: '角色的性格气质设定',
            representativeFrameTime: 1.2,
            representativeFrameNote: '该角色的典型帧说明'
          }
        ],
        backgrounds: [
          {
            id: 'background_1',
            name: '场景名称',
            description: '片段或场景背景描述',
            scenePrompt: '可直接用于生成该场景的中文提示词',
            representativeFrameTime: 2.8,
            representativeFrameNote: '该场景的典型帧说明'
          }
        ],
        timeAnchors: [
          {
            startTime: 0,
            endTime: 7,
            sceneSummary: '片段解释',
            scenePrompt: '该片段可直接复用的场景提示词',
            representativeFrameTime: 1.6,
            backgroundId: 'background_1',
            backgroundAction: 'create_new',
            backgroundName: '场景名称',
            shots: [
              {
                id: 'shot_1',
                startTime: 0,
                endTime: 2,
                summary: '镜头解释',
                prompt: '@角色名 位于画面中的明确位置，在 #场景名称 中完成该镜头动作，包含景别、机位、运动方向、视线和遮挡关系的可编辑中文提示词',
                sceneNames: ['场景名称'],
                characterNames: ['角色名'],
                representativeFrameTime: 1.1,
                representativeFrameNote: '该镜头的典型帧说明'
              }
            ]
          }
        ]
      },
      null,
      2
    ),
    `视频文件名：${video.filename}`,
    `视频时长（秒）：${metadata.duration ?? 'unknown'}`,
    '要求：',
    '1. plot 用中文概括整条视频的主要剧情、事件推进和结局走向，适合后续片段生成使用。',
    '2. characters 至少提取主要角色，name 要稳定，appearancePrompt 必须是可直接用于视频生成的人物外观设定。',
    '3. 每个 character 还必须返回 personalityPrompt，用中文概括角色的性格气质、情绪底色、行为风格或表演状态，方便后续角色资源与生成提示词复用。',
    '4. 每个 character 都要返回 representativeFrameTime，表示最能代表该角色外观的时间点（单位秒）；representativeFrameNote 简要说明为什么选择该帧。',
    '5. backgrounds 需要尽量多提取对后续重生成有价值的可复用场景资源，不只提大场景；同一大场景中的稳定子空间、机位常驻区域、布景核心角落、走廊、门口、窗边、吧台、沙发区等，只要能独立复用，都可以沉淀成单独场景资源。',
    '6. 每个 background 都要返回 scenePrompt，内容是可直接用于生成该场景的中文场景提示词，同时返回 representativeFrameTime 和 representativeFrameNote。',
    '7. 先识别整片有哪些可复用场景，并把它们沉淀到 backgrounds 这个场景资源库里；如果同一大场景内部有多个视觉差异稳定且值得复用的子空间，也要拆开沉淀。',
    '8. timeAnchors 必须覆盖完整视频，startTime 和 endTime 为数字秒，严格按时间升序，不要重叠，不要遗漏关键内容。',
    '9. 片段切分必须以场景切换为硬边界；只有在同一场景内动作阶段明显不同且确实需要独立生成时，才继续细分。',
    '10. 每个 timeAnchor 代表一个后续可独立生成的大剧情片段，而不是纯观感镜头；片段边界要尽量保证动作完整、人物连续、场景切换清晰、前后文衔接稳定。',
    '11. 避免输出明显过短且没有独立生成价值的片段；如果视频较短，也要保证切分结果仍然覆盖全片。',
    '12. 每个 timeAnchor 都要给出 sceneSummary 和 scenePrompt；sceneSummary 用中文解释该片段发生了什么，scenePrompt 必须是可直接复用的片段场景提示词，包含场景、光线、主体关系、空间结构和镜头氛围，不要只写事件摘要。',
    '13. 每个 timeAnchor 都必须绑定 backgroundId、backgroundAction、backgroundName。',
    '14. 同一 backgroundId 首次出现的片段标记为 create_new，后续再次出现的同场景片段标记为 reuse_existing。',
    '15. 每个 timeAnchor 都要返回 representativeFrameTime，且该时间点必须落在 startTime 到 endTime 之间；优先选择最适合做预览、最能代表人物或场景的画面，而不是机械取中点。',
    '16. 如果同一场景在多个片段重复出现，允许每个片段返回更贴合该片段语境的 scenePrompt，但 backgroundId 必须保持一致。',
    '17. 每个 timeAnchor 内都必须返回 shots 数组，用于描述该大片段下的小镜头；shots 是后续小镜头切片与生成的唯一真值来源。',
    '18. shots 必须尽量按真实镜头切点拆分，优先对齐真实剪辑边界、机位变化、镜头运动变化、景别变化、构图重心变化、主体关系变化、场景切换、视线反打、人物进出画、明显动作 beat、焦点转移、对白换气节点和说话节奏断点，不要机械均分时间。',
    '19. 如果同一连续动作里出现了明显的左/中/右站位变化、前后景关系变化、镜头角度变化、横移推拉变化、遮挡关系变化、表演节奏断点、口型状态切换或说话人主次变化，也应该继续拆成新的 shot。',
    '20. 对 60 秒以内的视频，要尽量把观众能明显感知到的真实镜头都拆出来；不要把多个连续 cut、多个表演 beat 或多个构图中心合并成一个 shot。',
    '21. 如果没有硬切，也要按动作阶段、视线关系、说话段落、镜头运动阶段和构图稳定区间细分 shot；除非画面长时间稳定且动作单一，否则单个 shot 尽量不要超过 4 秒。',
    '22. shots 必须按整片绝对时间返回 startTime 和 endTime，严格落在所属 timeAnchor 范围内，按时间升序、无重叠，并尽量覆盖该大片段；timeAnchor 和 shot 的时间请尽量精确到 0.1 秒，不要只给粗略整秒。',
    '23. 每个 shot 都要返回 id、summary、prompt、sceneNames、characterNames、representativeFrameTime、representativeFrameNote；sceneNames 和 characterNames 都不能为空。',
    '24. shot.summary 不能只写发生了什么，还要简要点出镜头核心动作、主体关系、构图变化或切分依据，让人能看出为什么这里单独成镜头。',
    '25. representativeFrameTime 必须选择该镜头最有代表性的画面，不允许机械取中点；优先选择最适合作为预览图和生成参考图、最能体现该镜头构图、动作状态和人物表情的画面。',
    '26. representativeFrameNote 需要说明这个时间点对应的关键画面，例如哪个动作定格、哪个表情瞬间、哪个构图最稳定。',
    '27. shot.prompt 必须直接服务镜头级视频生成，必须写清：角色数量、谁在前景/中景/后景、人物在画面中的左/中/右位置、远近层次、朝向与视线方向、肢体姿态、运动轨迹、进出画方式、遮挡关系、镜头景别、拍摄角度、镜头运动、光线氛围、说话状态或口型是否明显，以及与前后镜头的连续关系。',
    '28. shot.prompt 必须同时使用至少一个 @角色名 和至少一个 #场景名 引用，不要把资源正文直接展开，也不要只重复大片段摘要。',
    '29. 如果一个 shot 涉及多个场景，需要在 sceneNames 中全部列出，并在 prompt 中按顺序引用对应的 #场景名。',
    '30. 如果一个 shot 涉及多个角色，需要明确每个角色各自的位置、主次关系、视线关系和表演状态，而不是只列名字；如果角色是不完整出镜、背影、手部或 POV，也必须绑定稳定的人物名。',
    '31. 如果角色较少，也至少保证 characters 返回 1 个对象。',
    '32. 输出必须是合法 JSON，字段名保持与示例完全一致。'
  ].join('\n');
};

const buildSegmentAnalysisPrompt = ({ segment, overallAnalysis }) => {
  const currentBackgroundBinding = {
    backgroundId: segment?.analysis?.backgroundId ?? '',
    backgroundAction: segment?.analysis?.backgroundAction ?? '',
    backgroundName: segment?.analysis?.backgroundName ?? '',
    backgroundPrompt: segment?.analysis?.backgroundPrompt ?? '',
    scenePrompt: segment?.analysis?.scenePrompt ?? '',
    sceneSummary: segment?.analysis?.sceneSummary ?? ''
  };

  return [
    '你是一名资深短视频片段拆解助手。',
    '请分析输入的视频片段，并严格返回 JSON，不要输出 Markdown、解释或额外文本。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        characters: ['角色名'],
        scenes: ['场景名称'],
        scene: '片段场景描述',
        action: '片段主要动作描述',
        prompt: '@角色名 + #场景名 + 动作 + 镜头语言 的可编辑中文提示词'
      },
      null,
      2
    ),
    `片段序号：${Number(segment.segmentIndex) + 1}`,
    `片段时间：${segment.startTime} - ${segment.endTime} 秒`,
    `整片剧情摘要：${overallAnalysis?.plot ?? '暂无'}`,
    `整片角色设定：${JSON.stringify(overallAnalysis?.characters ?? [])}`,
    `整片场景资源库：${JSON.stringify(overallAnalysis?.backgrounds ?? [])}`,
    `当前片段绑定场景：${JSON.stringify(currentBackgroundBinding)}`,
    '要求：',
    '1. characters 返回当前片段真正出现或应重点关注的角色名称列表。',
    '2. scenes 返回当前片段涉及到的场景资源名称，必须优先复用整片场景资源库里的原始名称，并按叙事出现顺序返回。',
    '3. prompt 必须为后续视频生成可直接编辑的中文提示词，只刷新大片段理解，不要重新拆分 shots。',
    '4. prompt 中涉及角色时，用 @角色名 标记，而不是展开成长描述。',
    '5. prompt 中涉及场景时，用 #场景名 标记，而不是直接展开真实场景资源提示词。',
    '6. 如果片段中出现多个场景，请在 scenes 中列全，并在 prompt 里按顺序引用对应的 #场景名。',
    '7. 当前片段必须服从已绑定的 backgroundId/backgroundAction/backgroundName，不要重新发明新的场景决策。',
    '8. 如果当前片段标记为 reuse_existing，需要在 scene 和 prompt 中强调延续同一场景资源，只变化动作、表演或镜头阶段。',
    '9. 输出必须是有效 JSON。'
  ].join('\n');
};

const buildShotSpeechAnalysisPrompt = ({ segment, shot, analysisOptions }) => {
  const durationSeconds = Number(shot?.durationSeconds ?? Math.max(0.3, Number(shot?.endTime) - Number(shot?.startTime)));
  const segmentPrompt = String(segment?.analysis?.prompt ?? segment?.analysis?.scenePrompt ?? '').trim();
  const shotPrompt = String(shot?.prompt ?? '').trim();

  return [
    '你是一名镜头级字幕与对白解析助手。',
    '请分析输入的小镜头视频，并严格返回 JSON，不要输出 Markdown、解释或额外文本。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        transcript: '镜头对白全文，没有对白时返回空字符串',
        subtitleLines: [
          {
            id: 'subtitle_1',
            startTime: 0,
            endTime: 0.8,
            text: '第一句字幕'
          }
        ],
        speechStyle: '语速、停顿、情绪、语气、说话力度、口型明显程度等中文说明',
        hasDialogue: true
      },
      null,
      2
    ),
    `大片段提示词：${segmentPrompt || '暂无'}`,
    `当前小镜头提示词：${shotPrompt || '暂无'}`,
    `镜头摘要：${String(shot?.summary ?? '').trim() || '暂无'}`,
    `镜头时长（秒）：${durationSeconds.toFixed(2)}`,
    `镜头角色：${JSON.stringify(shot?.characterNames ?? [])}`,
    `镜头场景：${JSON.stringify(shot?.sceneNames ?? [])}`,
    `解析选项：${JSON.stringify({
      extractSubtitles: Boolean(analysisOptions?.extractSubtitles),
      parseAudio: Boolean(analysisOptions?.parseAudio)
    })}`,
    '要求：',
    '1. 只根据当前小镜头真实可见可听内容提取，不要虚构未说出的台词。',
    '2. 如果当前镜头没有清晰对白、旁白或可辨识语言内容，hasDialogue 返回 false，transcript 返回空字符串，subtitleLines 返回空数组。',
    '3. subtitleLines 的 startTime 和 endTime 必须是相对当前小镜头本地时间，不是整片绝对时间。',
    '4. subtitleLines 必须按时间升序返回，不重叠，尽量贴近真实说话节奏和停顿点。',
    '5. 每条字幕 text 只保留真实说出的内容，不要加入场景解释。',
    '6. speechStyle 用中文概括语速、停顿、情绪、语气、说话力度、说话人状态和口型明显程度，方便后续口型与音频生成。',
    '7. 如果 parseAudio 为 false，也仍然返回基础 speechStyle，但可以更简洁。',
    '8. 输出必须是合法 JSON。'
  ].join('\n');
};

const buildPromptOptimizationPrompt = ({
  prompt,
  characters,
  backgrounds,
  mode = 'generation',
  segmentPrompt = '',
  shotPrompt = '',
  sceneNames = [],
  characterNames = []
}) => {
  const normalizedMode = normalizePromptOptimizationMode(mode);

  if (normalizedMode === 'character_resource') {
    return [
      '你是一名角色资源提示词优化助手。',
      '请把下面的角色描述整理为适合 Gemini 生图模型生成角色三视图的中文提示词，并严格返回 JSON。',
      '不要输出 Markdown，不要输出解释，不要输出额外文本。',
      '返回结构必须完全符合：',
      JSON.stringify(
        {
          optimizedPrompt: '外表描述 + 性格气质 + 纯白背景角色三视图要求'
        },
        null,
        2
      ),
      `原始提示词：${prompt}`,
      `角色列表：${JSON.stringify(characters ?? [])}`,
      '要求：',
      '1. 只围绕角色本身优化，不要引入任何场景、环境、道具或镜头叙事。',
      '2. 必须综合角色的外貌描述和性格气质，整理为单人角色三视图资源提示词。',
      '3. 明确纯白无缝背景、全身完整入镜、中性站姿、正面/侧面/背面都可复用。',
      '4. 不要使用 #场景名，也不要引入任何场景资源。',
      '5. 不必使用 @角色名，直接输出纯角色资源提示词正文。',
      '6. 只返回 JSON。'
    ].join('\n');
  }

  if (normalizedMode === 'scene_resource') {
    return [
      '你是一名场景资源提示词优化助手。',
      '请把下面的场景描述整理为适合 Gemini 生图模型生成背景参考图的中文提示词，并严格返回 JSON。',
      '不要输出 Markdown，不要输出解释，不要输出额外文本。',
      '返回结构必须完全符合：',
      JSON.stringify(
        {
          optimizedPrompt: '纯场景背景参考图提示词'
        },
        null,
        2
      ),
      `原始提示词：${prompt}`,
      `场景资源库：${JSON.stringify(backgrounds ?? [])}`,
      '要求：',
      '1. 只优化场景本身，不要引入人物或角色动作。',
      '2. 强调空间结构、材质、光线、景深和镜头角度兼容性。',
      '3. 输出适合作为多角度背景参考图的纯场景提示词。',
      '4. 不要使用 @角色名 或 #场景名。',
      '5. 只返回 JSON。'
    ].join('\n');
  }

  if (normalizedMode === 'shot_generation') {
    return [
      '你是一名镜头级视频生成提示词优化助手。',
      '请在不改变当前镜头核心语义的前提下，结合大片段叙事目标优化当前小镜头提示词，并严格返回 JSON。',
      '不要输出 Markdown，不要输出解释，不要输出额外文本。',
      '返回结构必须完全符合：',
      JSON.stringify(
        {
          optimizedPrompt: '@角色名 在 #场景名 中完成更清晰的单镜头描述'
        },
        null,
        2
      ),
      `大片段最终提示词：${segmentPrompt}`,
      `当前小镜头提示词：${shotPrompt || prompt}`,
      `角色列表：${JSON.stringify(characters ?? [])}`,
      `场景资源库：${JSON.stringify(backgrounds ?? [])}`,
      `镜头涉及场景：${JSON.stringify(sceneNames ?? [])}`,
      `镜头涉及角色：${JSON.stringify(characterNames ?? [])}`,
      '要求：',
      '1. 输出必须服务于单镜头生成，而不是复述大片段摘要。',
      '2. 必须保留并优先使用 @角色名 和 #场景名，不要把资源正文直接展开。',
      '3. 必须补足单镜头级别的动作、表演节奏、镜头语言、构图和氛围，但不要偏离当前镜头原意。',
      '4. 必须写清人物数量、主次关系、人物在画面中的左/中/右位置、前景/中景/后景关系、朝向、视线、肢体姿态、运动路径、进出画方式、遮挡关系、景别、机位角度和镜头运动。',
      '5. 需要与大片段最终提示词保持叙事和视觉连续性，尽量还原原片镜头语言。',
      '6. 如果给了镜头涉及场景和角色，优先围绕这些对象优化。',
      '7. 只返回 JSON。'
    ].join('\n');
  }

  return [
    '你是一名视频生成提示词优化助手。',
    '请优化下面的提示词，并严格返回 JSON，不要输出 Markdown 或额外解释。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        optimizedPrompt: '@角色名 在 #场景名 中完成更清晰的镜头描述'
      },
      null,
      2
    ),
    `原始提示词：${prompt}`,
    `角色列表：${JSON.stringify(characters ?? [])}`,
    `场景资源库：${JSON.stringify(backgrounds ?? [])}`,
    '要求：',
    '1. 保持中文输出。',
    '2. 所有角色名称统一替换成 @角色名。',
    '3. 如果提示词中出现了场景资源库中的场景名称，也统一替换成 #场景名。',
    '4. 如果原始提示词已经包含 @角色名 或 #场景名，继续保留这种引用形式，不要把资源提示词正文直接展开。',
    '5. 提示词要更适合视频生成或资源设计，补足镜头、场景、动作、氛围，以及主体站位、景别、机位、视线和运动方向，但不要改变核心语义。',
    '6. 只返回 JSON。'
  ].join('\n');
};

const analyzeVideo = async ({ video, metadata, videoAbsolutePath, analysisOptions = null }) => {
  if (!canUseRemoteGemini) {
    const error = new Error('Gemini-2.5-pro 整片分析不可用：GEMINI_API_KEY 或 GEMINI_API_BASE_URL 未配置。');
    error.statusCode = 422;
    throw error;
  }

  try {
    const { authVariant, model: resolvedModel, responsePayload, responseText } = await callRemoteGemini({
      prompt: buildVideoAnalysisPrompt({ video, metadata }),
      videoAbsolutePath,
      requestTimeoutOverrideMs: WHOLE_VIDEO_PRIMARY_UPLOAD_TIMEOUT_MS,
      preferCurlTransport: true,
      model: WHOLE_VIDEO_ANALYSIS_MODEL,
      allowModelFallback: false,
      allowAuthVariantFallback: false,
      maxAttempts: 1
    });
    const parsedPayload = parseJsonPayload(responseText, '整片分析模型');
    return normalizeVideoAnalysisPayload({
      parsedPayload,
      metadata,
      analysisOptions,
      geminiResponse: buildGeminiResponseEnvelope({
        provider: 'remote-gemini',
        model: resolvedModel || WHOLE_VIDEO_ANALYSIS_MODEL,
        mode: env.GEMINI_API_COMPAT_MODE,
        authVariant,
        isMock: false,
        fallbackReason: '',
        remoteError: '',
        rawResponse: responsePayload
      })
    });
  } catch (error) {
    logger.warn('Gemini whole-video analysis failed without fallback.', {
      model: WHOLE_VIDEO_ANALYSIS_MODEL,
      message: describeGeminiTransportError(error)
    });

    const exposedError = isGeminiTimeoutError(error)
      ? new Error(
          `Gemini-2.5-pro 整片分析超时：整段视频上传与理解超过 ${Math.round(
            WHOLE_VIDEO_PRIMARY_UPLOAD_TIMEOUT_MS / 1000
          )} 秒，请稍后重试，或调大后端 GEMINI_WHOLE_VIDEO_TIMEOUT_MS。`
        )
      : new Error(`Gemini-2.5-pro 整片分析失败：${describeGeminiTransportError(error)}`);
    exposedError.statusCode =
      Number(error?.statusCode ?? 0) >= 400 && Number(error?.statusCode ?? 0) < 500
        ? Number(error.statusCode)
        : 424;
    throw exposedError;
  }
};

const analyzeShotSpeech = async ({
  segment,
  shot,
  shotVideoAbsolutePath = '',
  analysisOptions = null
}) => {
  if (!canUseRemoteGemini) {
    return createMockShotSpeechAnalysis({ shot });
  }

  try {
    const { responseText } = await callRemoteGemini({
      prompt: buildShotSpeechAnalysisPrompt({
        segment,
        shot,
        analysisOptions
      }),
      videoAbsolutePath: shotVideoAbsolutePath,
      model: env.GEMINI_SEGMENT_MODEL || env.GEMINI_MODEL
    });
    const parsedPayload = parseJsonPayload(responseText, '镜头字幕解析模型');

    return {
      transcript: String(parsedPayload.transcript ?? '').trim(),
      subtitleLines: Array.isArray(parsedPayload.subtitleLines ?? parsedPayload.subtitle_lines)
        ? parsedPayload.subtitleLines ?? parsedPayload.subtitle_lines
        : [],
      speechStyle: String(parsedPayload.speechStyle ?? parsedPayload.speech_style ?? '').trim(),
      hasDialogue: Boolean(parsedPayload.hasDialogue ?? parsedPayload.has_dialogue),
      extractionStatus: 'completed',
      extractionError: '',
      sourceOfTruth: 'extracted'
    };
  } catch (error) {
    if (shouldUseStrictRemoteGemini()) {
      throw error;
    }

    logger.warn('Remote Gemini analyzeShotSpeech failed, using mock speech extraction instead.', {
      message: describeGeminiTransportError(error)
    });

    return {
      ...createMockShotSpeechAnalysis({ shot }),
      extractionStatus: 'failed',
      extractionError: describeGeminiTransportError(error)
    };
  }
};

const analyzeSegment = async ({ segment, overallAnalysis, segmentAbsolutePath = '' }) => {
  if (!canUseRemoteGemini) {
    return createMockSegmentAnalysis({ segment, overallAnalysis });
  }

  try {
    const { responseText } = await callRemoteGemini({
      prompt: buildSegmentAnalysisPrompt({ segment, overallAnalysis }),
      videoAbsolutePath: segmentAbsolutePath,
      model: env.GEMINI_SEGMENT_MODEL || env.GEMINI_MODEL
    });
    const parsedPayload = parseJsonPayload(responseText, '片段分析模型');
    const fallbackSceneName = String(segment?.analysis?.backgroundName ?? '').trim();

    return normalizeSegmentAnalysisPayload(parsedPayload, fallbackSceneName);
  } catch (error) {
    if (shouldUseStrictRemoteGemini()) {
      throw error;
    }

    logger.warn('Remote Gemini analyzeSegment failed, using mock segment analysis instead.', {
      message: describeGeminiTransportError(error)
    });
    return createMockSegmentAnalysis({ segment, overallAnalysis });
  }
};

const optimizePrompt = async ({
  prompt,
  characters,
  backgrounds,
  mode = 'generation',
  segmentPrompt = '',
  shotPrompt = '',
  sceneNames = [],
  characterNames = []
}) => {
  if (!canUseRemoteGemini) {
    return createMockOptimizedPrompt({
      prompt,
      characters,
      backgrounds,
      mode,
      segmentPrompt,
      shotPrompt,
      sceneNames,
      characterNames
    });
  }

  try {
    const { model: resolvedModel, responseText } = await callRemoteGemini({
      prompt: buildPromptOptimizationPrompt({
        prompt,
        characters,
        backgrounds,
        mode,
        segmentPrompt,
        shotPrompt,
        sceneNames,
        characterNames
      })
    });
    const parsedPayload = parseJsonPayload(responseText, '提示词优化模型');
    const optimizedPrompt = String(parsedPayload.optimizedPrompt ?? prompt).trim() || prompt;

    return {
      optimizedPrompt,
      highlightedPrompt: renderHighlightedPrompt(optimizedPrompt),
      model: resolvedModel || env.GEMINI_MODEL
    };
  } catch (error) {
    if (shouldUseStrictRemoteGemini()) {
      throw error;
    }

    logger.warn('Remote Gemini optimizePrompt failed, using mock prompt optimization instead.', {
      message: describeGeminiTransportError(error)
    });
    return createMockOptimizedPrompt({
      prompt,
      characters,
      backgrounds,
      mode,
      segmentPrompt,
      shotPrompt,
      sceneNames,
      characterNames
    });
  }
};

export { analyzeVideo, analyzeSegment, analyzeShotSpeech, optimizePrompt };
