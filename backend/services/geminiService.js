import env from '../config/env.js';
import logger from '../utils/logger.js';

const buildMockTimeAnchors = (durationSeconds = 12) => {
  const safeDuration = Math.max(6, durationSeconds || 12);
  const segmentCount = Math.min(4, Math.max(2, Math.ceil(safeDuration / 4)));
  const segmentLength = Number((safeDuration / segmentCount).toFixed(2));

  return Array.from({ length: segmentCount }, (_, index) => {
    const startTime = Number((index * segmentLength).toFixed(2));
    const endTime = Number(
      (index === segmentCount - 1 ? safeDuration : (index + 1) * segmentLength).toFixed(2)
    );

    return {
      startTime,
      endTime,
      sceneSummary: `第 ${index + 1} 段镜头，围绕主角推进剧情。`
    };
  });
};

const createMockVideoAnalysis = ({ video, metadata }) => {
  const anchors = buildMockTimeAnchors(metadata.duration || 12);
  const baseName = video.filename.replace(/\.[^.]+$/, '');

  return {
    plot: `${baseName} 的剧情围绕主角完成一个简短目标展开，整体节奏清晰，适合继续做片段级生成。`,
    characters: [
      {
        id: 'character_main',
        name: '主角',
        appearancePrompt: '一位年轻主角，面部轮廓清晰，表情自然，服装简洁，镜头感强'
      }
    ],
    backgrounds: anchors.map((anchor, index) => ({
      id: `background_${index + 1}`,
      description: `${anchor.sceneSummary}，场景氛围偏电影化，光线柔和，环境细节完整。`
    })),
    timeAnchors: anchors,
    geminiResponse: JSON.stringify({
      provider: 'mock-gemini',
      filename: video.filename,
      generatedAt: new Date().toISOString()
    })
  };
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

    const namePattern = new RegExp(character.name, 'g');
    optimizedPrompt = optimizedPrompt.replace(namePattern, `@${character.name}`);
  });

  const highlightedPrompt = optimizedPrompt.replace(
    /@([\p{L}\p{N}_-]+)/gu,
    '<span class="mention text-blue-500">$&</span>'
  );

  return {
    optimizedPrompt,
    highlightedPrompt
  };
};

const canUseRemoteGemini = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_BASE_URL);

const callRemoteGemini = async (payload) => {
  const response = await fetch(env.GEMINI_API_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.GEMINI_API_KEY}`
    },
    body: JSON.stringify({
      model: env.GEMINI_MODEL,
      ...payload
    }),
    signal: AbortSignal.timeout(env.EXTERNAL_REQUEST_TIMEOUT)
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}`);
  }

  return response.json();
};

const analyzeVideo = async ({ video, metadata }) => {
  if (!canUseRemoteGemini) {
    return createMockVideoAnalysis({ video, metadata });
  }

  try {
    const remoteResponse = await callRemoteGemini({
      task: 'analyze_video',
      input: {
        filename: video.filename,
        filePath: video.filePath,
        metadata
      }
    });

    return {
      plot: remoteResponse.plot ?? '',
      characters: remoteResponse.characters ?? [],
      backgrounds: remoteResponse.backgrounds ?? [],
      timeAnchors: remoteResponse.timeAnchors ?? remoteResponse.time_anchors ?? [],
      geminiResponse: JSON.stringify(remoteResponse)
    };
  } catch (error) {
    logger.warn('Remote Gemini analyzeVideo failed, using mock analysis instead.', {
      message: error.message
    });
    return createMockVideoAnalysis({ video, metadata });
  }
};

const analyzeSegment = async ({ segment, overallAnalysis }) => {
  if (!canUseRemoteGemini) {
    return createMockSegmentAnalysis({ segment, overallAnalysis });
  }

  try {
    const remoteResponse = await callRemoteGemini({
      task: 'analyze_segment',
      input: {
        segment,
        overallAnalysis
      }
    });

    return {
      characters: remoteResponse.characters ?? [],
      scene: remoteResponse.scene ?? '',
      action: remoteResponse.action ?? '',
      prompt: remoteResponse.prompt ?? ''
    };
  } catch (error) {
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
    const remoteResponse = await callRemoteGemini({
      task: 'optimize_prompt',
      input: {
        prompt,
        characters
      }
    });

    return {
      optimizedPrompt: remoteResponse.optimizedPrompt ?? remoteResponse.optimized_prompt ?? prompt,
      highlightedPrompt:
        remoteResponse.highlightedPrompt ??
        remoteResponse.highlighted_prompt ??
        remoteResponse.optimizedPrompt ??
        prompt
    };
  } catch (error) {
    logger.warn('Remote Gemini optimizePrompt failed, using mock prompt optimization instead.', {
      message: error.message
    });
    return createMockOptimizedPrompt({ prompt, characters });
  }
};

export { analyzeVideo, analyzeSegment, optimizePrompt };
