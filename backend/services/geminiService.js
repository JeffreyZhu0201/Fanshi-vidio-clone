import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import env from '../config/env.js';
import logger from '../utils/logger.js';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const VIDEO_MIME_TYPES = Object.freeze({
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo'
});

const stripMarkdownCodeFence = (value = '') => {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
};

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

const renderHighlightedPrompt = (prompt = '') => {
  return prompt.replace(
    /@([\p{L}\p{N}_-]+)/gu,
    '<span class="mention text-blue-500">$&</span>'
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

const getRepresentativeFrameTime = (startTime, endTime) => {
  const safeStartTime = Math.max(0, Number(startTime) || 0);
  const safeEndTime = Math.max(safeStartTime + 0.3, Number(endTime) || safeStartTime + 0.3);

  return Number((safeStartTime + (safeEndTime - safeStartTime) / 2).toFixed(2));
};

const buildMockTimeAnchors = (durationSeconds = 12) => {
  const safeDuration = Math.max(6, durationSeconds || 12);
  const segmentCount = Math.min(4, Math.max(2, Math.ceil(safeDuration / 4)));
  const segmentLength = Number((safeDuration / segmentCount).toFixed(2));

  return Array.from({ length: segmentCount }, (_, index) => {
    const startTime = Number((index * segmentLength).toFixed(2));
    const endTime = Number(
      (index === segmentCount - 1 ? safeDuration : (index + 1) * segmentLength).toFixed(2)
    );
    const representativeFrameTime = getRepresentativeFrameTime(startTime, endTime);

    return {
      startTime,
      endTime,
      sceneSummary: `第 ${index + 1} 段镜头，围绕主角推进剧情。`,
      scenePrompt: `电影感镜头，主角位于第 ${index + 1} 段场景中，环境细节完整，光线层次清晰，镜头语言连贯。`,
      representativeFrameTime
    };
  });
};

const createMockVideoAnalysis = ({ video, metadata }) => {
  const anchors = buildMockTimeAnchors(metadata.duration || 12);
  const baseName = video.filename.replace(/\.[^.]+$/, '');
  const primaryFrameTime = anchors[0]?.representativeFrameTime ?? 1.2;

  return {
    plot: `${baseName} 的剧情围绕主角完成一个简短目标展开，整体节奏清晰，适合继续做片段级生成。`,
    characters: [
      {
        id: 'character_main',
        name: '主角',
        appearancePrompt: '一位年轻主角，面部轮廓清晰，表情自然，服装简洁，镜头感强',
        representativeFrameTime: primaryFrameTime,
        representativeFrameNote: '该帧能稳定体现主角的整体造型、服装和面部特征。'
      }
    ],
    backgrounds: anchors.map((anchor, index) => ({
      id: `background_${index + 1}`,
      name: `场景 ${index + 1}`,
      description: `${anchor.sceneSummary}，场景氛围偏电影化，光线柔和，环境细节完整。`,
      scenePrompt: `电影化 ${anchor.sceneSummary}，突出空间纵深、环境光线、布景层次和主体运动关系。`,
      representativeFrameTime: anchor.representativeFrameTime,
      representativeFrameNote: '该帧能够代表当前镜头段的空间结构、光线和布景细节。'
    })),
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
  const primaryCharacter = characters[0]?.name || '主角';

  return {
    characters: characters.map((item) => item.name || item),
    scene: `片段 ${segment.segmentIndex + 1} 的场景延续整体剧情，强调环境氛围和镜头层次。`,
    action: `${primaryCharacter} 在当前片段中推进主要动作，镜头聚焦人物状态变化。`,
    prompt: `@${primaryCharacter} 在 cinematic 风格场景中推进剧情，保持人物一致性、镜头连贯和环境细节。`
  };
};

const createMockOptimizedPrompt = ({ prompt, characters }) => {
  const normalizedCharacters = characters.map((item) =>
    typeof item === 'string'
      ? {
          name: item,
          appearancePrompt: item
        }
      : {
          name: item.name,
          appearancePrompt: item.appearancePrompt || item.appearance_prompt || item.name
        }
  );

  let optimizedPrompt = prompt.trim();

  normalizedCharacters.forEach((character) => {
    if (!character.name) {
      return;
    }

    const namePattern = new RegExp(`(?<!@)${escapeRegExp(character.name)}`, 'gu');
    optimizedPrompt = optimizedPrompt.replace(namePattern, `@${character.name}`);
  });

  return {
    optimizedPrompt,
    highlightedPrompt: renderHighlightedPrompt(optimizedPrompt)
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

const resolveVideoMimeType = (absolutePath) => {
  return VIDEO_MIME_TYPES[path.extname(absolutePath).toLowerCase()] || 'video/mp4';
};

const readAssetAsBase64 = async (absolutePath) => {
  const buffer = await readFile(absolutePath);
  return buffer.toString('base64');
};

const readAssetAsDataUrl = async (absolutePath) => {
  const mimeType = resolveVideoMimeType(absolutePath);
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
  const sceneSummary = String(item.sceneSummary ?? item.scene_summary ?? `镜头 ${index + 1}`).trim();
  const normalizedEndTime = Number(
    Math.min(Math.max(endTime, startTime + 0.5), fallbackDuration || endTime).toFixed(2)
  );
  const representativeFrameTime =
    normalizeOptionalNumber(item.representativeFrameTime ?? item.representative_frame_time) ??
    getRepresentativeFrameTime(startTime, normalizedEndTime);

  return {
    startTime: Number(Math.max(0, startTime).toFixed(2)),
    endTime: normalizedEndTime,
    sceneSummary,
    scenePrompt: normalizeOptionalString(item.scenePrompt ?? item.scene_prompt, sceneSummary),
    representativeFrameTime,
    representativeFrameNote: normalizeOptionalString(
      item.representativeFrameNote ??
        item.representative_frame_note ??
        item.representativeFrameReason ??
        item.representative_frame_reason
    )
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

const buildGooglePromptPayload = async ({ prompt, videoAbsolutePath = '' }) => {
  const parts = [];

  if (videoAbsolutePath) {
    const assetData = await readAssetAsBase64(videoAbsolutePath);

    parts.push({
      inline_data: {
        mime_type: resolveVideoMimeType(videoAbsolutePath),
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
  mode = env.GEMINI_API_COMPAT_MODE,
  model = env.GEMINI_MODEL
}) => {
  const resolvedMode = videoAbsolutePath && mode !== 'google' ? 'google' : mode;
  const endpoint = resolveGeminiEndpoint(resolvedMode, model);
  const requestBody =
    resolvedMode === 'openai'
      ? await buildOpenAiPromptPayload({ prompt, videoAbsolutePath, model })
      : await buildGooglePromptPayload({ prompt, videoAbsolutePath });
  const requestTimeoutMs = getGeminiRequestTimeoutMs({ videoAbsolutePath });
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

  let lastError = null;

  for (let variantIndex = 0; variantIndex < requestVariants.length; variantIndex += 1) {
    const requestVariant = requestVariants[variantIndex];

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(requestVariant.url, {
          method: 'POST',
          headers: requestVariant.headers,
          body: JSON.stringify(requestBody),
          redirect: 'follow',
          signal: AbortSignal.timeout(requestTimeoutMs)
        });

        const responseText = await response.text();

        if (!response.ok) {
          const error = new Error(
            `Gemini request failed with status ${response.status}: ${responseText.slice(0, 240)}`
          );
          error.statusCode = response.status;
          error.authVariant = requestVariant.name;
          throw error;
        }

        const responsePayload = responseText ? JSON.parse(responseText) : {};

        return {
          authVariant: requestVariant.name,
          responsePayload,
          responseText:
            resolvedMode === 'openai'
              ? extractOpenAiResponseText(responsePayload)
              : extractGoogleResponseText(responsePayload)
        };
      } catch (error) {
        lastError = error;

        if (
          isAuthLikeGeminiStatus(error.statusCode) &&
          variantIndex < requestVariants.length - 1
        ) {
          break;
        }

        if (attempt >= 3 || !isRetryableGeminiStatus(error.statusCode)) {
          break;
        }

        await sleep(getGeminiRetryDelayMs(attempt));
      }
    }

    if (lastError && !isAuthLikeGeminiStatus(lastError.statusCode)) {
      break;
    }
  }

  throw lastError ?? new Error('Gemini request failed.');
};

const buildVideoAnalysisPrompt = ({ video, metadata }) => {
  return [
    '你是一名资深视频理解与影视拆解助手。',
    '请对输入的整条视频做整体视频理解，并严格返回 JSON。',
    '不要输出 Markdown，不要输出解释，不要输出额外文本。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        plot: 'string',
        characters: [
          {
            id: 'character_1',
            name: '角色名',
            appearancePrompt: '角色完整形象设定',
            representativeFrameTime: 1.2,
            representativeFrameNote: '该角色的典型帧说明'
          }
        ],
        backgrounds: [
          {
            id: 'background_1',
            name: '场景名称',
            description: '镜头或场景背景描述',
            scenePrompt: '可直接用于生成该场景的中文提示词',
            representativeFrameTime: 2.8,
            representativeFrameNote: '该场景的典型帧说明'
          }
        ],
        timeAnchors: [
          {
            startTime: 0,
            endTime: 3.2,
            sceneSummary: '镜头摘要',
            scenePrompt: '该镜头的场景提示词',
            representativeFrameTime: 1.6
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
    '3. 每个 character 都要返回 representativeFrameTime，表示最能代表该角色外观的时间点（单位秒）；representativeFrameNote 简要说明为什么选择该帧。',
    '4. backgrounds 需要概括主要场景、环境氛围、光线、天气、布景和空间信息，name 为方便前端展示的场景名称。',
    '5. 每个 background 都要返回 scenePrompt，内容是可直接用于生成该场景的中文场景提示词，同时返回 representativeFrameTime 和 representativeFrameNote。',
    '6. timeAnchors 必须覆盖完整视频，startTime 和 endTime 为数字秒，严格按时间升序，不要重叠，不要遗漏关键镜头。',
    '7. 每个 timeAnchor 都要给出 sceneSummary 和 scenePrompt；scenePrompt 要体现该镜头段的场景、氛围、布景、光线和镜头语义。',
    '8. 每个 timeAnchor 都要返回 representativeFrameTime，且该时间点必须落在 startTime 到 endTime 之间。',
    '9. 如果角色较少，也至少保证 characters 返回 1 个对象。',
    '10. 输出必须是合法 JSON，字段名保持与示例完全一致。'
  ].join('\n');
};

const buildSegmentAnalysisPrompt = ({ segment, overallAnalysis }) => {
  return [
    '你是一名资深短视频镜头拆解助手。',
    '请分析输入的视频片段，并严格返回 JSON，不要输出 Markdown、解释或额外文本。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        characters: ['角色名'],
        scene: '片段场景描述',
        action: '片段主要动作描述',
        prompt: '@角色名 + 场景 + 动作 + 镜头语言 的可编辑中文提示词'
      },
      null,
      2
    ),
    `片段序号：${Number(segment.segmentIndex) + 1}`,
    `片段时间：${segment.startTime} - ${segment.endTime} 秒`,
    `整片剧情摘要：${overallAnalysis?.plot ?? '暂无'}`,
    `整片角色设定：${JSON.stringify(overallAnalysis?.characters ?? [])}`,
    '要求：',
    '1. characters 返回当前片段真正出现或应重点关注的角色名称列表。',
    '2. prompt 必须为后续视频生成可直接编辑的中文提示词。',
    '3. prompt 中涉及角色时，用 @角色名 标记，而不是展开成长描述。',
    '4. 输出必须是有效 JSON。'
  ].join('\n');
};

const buildPromptOptimizationPrompt = ({ prompt, characters }) => {
  return [
    '你是一名视频生成提示词优化助手。',
    '请优化下面的提示词，并严格返回 JSON，不要输出 Markdown 或额外解释。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        optimizedPrompt: '@角色名 出现在更清晰的镜头描述中'
      },
      null,
      2
    ),
    `原始提示词：${prompt}`,
    `角色列表：${JSON.stringify(characters ?? [])}`,
    '要求：',
    '1. 保持中文输出。',
    '2. 所有角色名称统一替换成 @角色名。',
    '3. 提示词要更适合视频生成，补足镜头、场景、动作、氛围，但不要改变核心语义。',
    '4. 只返回 JSON。'
  ].join('\n');
};

const analyzeVideo = async ({ video, metadata, videoAbsolutePath }) => {
  if (!canUseRemoteGemini) {
    return {
      ...createMockVideoAnalysis({ video, metadata }),
      geminiResponse: buildGeminiResponseEnvelope({
        provider: 'mock-gemini',
        isMock: true,
        fallbackReason: 'missing_remote_config',
        remoteError: 'GEMINI_API_KEY 或 GEMINI_API_BASE_URL 未配置。',
        rawResponse: null
      })
    };
  }

  try {
    const { authVariant, responsePayload, responseText } = await callRemoteGemini({
      prompt: buildVideoAnalysisPrompt({ video, metadata }),
      videoAbsolutePath
    });
    const parsedPayload = parseJsonPayload(responseText, '整片分析模型');
    const normalizedTimeAnchors =
      (parsedPayload.timeAnchors ?? parsedPayload.time_anchors ?? [])
        .map((item, index) => normalizeTimeAnchor(item, index, Number(metadata.duration) || 0))
        .filter(Boolean) || [];
    const normalizedBackgrounds = (parsedPayload.backgrounds ?? [])
      .map(normalizeBackground)
      .filter(Boolean);
    const derivedBackgrounds =
      normalizedBackgrounds.length > 0
        ? normalizedBackgrounds
        : normalizedTimeAnchors.map((anchor, index) =>
            normalizeBackground(
              {
                id: `background_${index + 1}`,
                name: `场景 ${index + 1}`,
                description: anchor.sceneSummary,
                scenePrompt: anchor.scenePrompt,
                representativeFrameTime: anchor.representativeFrameTime,
                representativeFrameNote: anchor.representativeFrameNote
              },
              index
            )
          );

    return {
      plot: String(parsedPayload.plot ?? '').trim(),
      characters: (parsedPayload.characters ?? []).map(normalizeCharacter).filter(Boolean),
      backgrounds: derivedBackgrounds.filter(Boolean),
      timeAnchors: normalizedTimeAnchors.length
        ? normalizedTimeAnchors
        : buildMockTimeAnchors(metadata.duration || 12),
      geminiResponse: buildGeminiResponseEnvelope({
        provider: 'remote-gemini',
        model: env.GEMINI_MODEL,
        mode: env.GEMINI_API_COMPAT_MODE,
        authVariant,
        isMock: false,
        fallbackReason: '',
        remoteError: '',
        rawResponse: responsePayload
      })
    };
  } catch (error) {
    if (shouldUseStrictRemoteGemini()) {
      throw error;
    }

    logger.warn('Remote Gemini analyzeVideo failed, using mock analysis instead.', {
      message: error.message
    });
    return {
      ...createMockVideoAnalysis({ video, metadata }),
      geminiResponse: buildGeminiResponseEnvelope({
        provider: 'mock-gemini',
        model: env.GEMINI_MODEL,
        mode: env.GEMINI_API_COMPAT_MODE,
        authVariant: error.authVariant || '',
        isMock: true,
        fallbackReason: 'remote_error',
        remoteError: error.message,
        rawResponse: null
      })
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

    return {
      characters: (parsedPayload.characters ?? []).map((item) => String(item).trim()).filter(Boolean),
      scene: String(parsedPayload.scene ?? '').trim(),
      action: String(parsedPayload.action ?? '').trim(),
      prompt: String(parsedPayload.prompt ?? '').trim()
    };
  } catch (error) {
    if (shouldUseStrictRemoteGemini()) {
      throw error;
    }

    logger.warn('Remote Gemini analyzeSegment failed, using mock segment analysis instead.', {
      message: error.message
    });
    return createMockSegmentAnalysis({ segment, overallAnalysis });
  }
};

const optimizePrompt = async ({ prompt, characters }) => {
  if (!canUseRemoteGemini) {
    return createMockOptimizedPrompt({ prompt, characters });
  }

  try {
    const { responseText } = await callRemoteGemini({
      prompt: buildPromptOptimizationPrompt({ prompt, characters })
    });
    const parsedPayload = parseJsonPayload(responseText, '提示词优化模型');
    const optimizedPrompt = String(parsedPayload.optimizedPrompt ?? prompt).trim() || prompt;

    return {
      optimizedPrompt,
      highlightedPrompt: renderHighlightedPrompt(optimizedPrompt)
    };
  } catch (error) {
    if (shouldUseStrictRemoteGemini()) {
      throw error;
    }

    logger.warn('Remote Gemini optimizePrompt failed, using mock prompt optimization instead.', {
      message: error.message
    });
    return createMockOptimizedPrompt({ prompt, characters });
  }
};

export { analyzeVideo, analyzeSegment, optimizePrompt };
