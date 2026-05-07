/**
 * 构建片段级视频生成提示词（使用 @ID 引用，不展开）
 * 格式：【风格】【角色】【场景】【分镜头】
 */

/**
 * 构建片段提示词
 * @param {object} params
 * @param {object} params.segment - 片段数据
 * @param {object} params.analysis - 整片分析数据
 * @param {string} params.styleMode - 风格模式
 * @returns {string} 提示词
 */
export const buildSegmentPromptWithReferences = ({ segment, analysis, styleMode = 'realistic' }) => {
  const shots = segment.analysis?.shots || [];

  // 1. 【风格】部分 - 使用默认模板
  const stylePart = buildStyleSection(styleMode);

  // 2. 【角色】部分 - 使用 @ID 引用
  const characterPart = buildCharacterSectionWithReferences(shots, analysis);

  // 3. 【场景】部分 - 使用 @ID 或 #ID 引用
  const scenePart = buildSceneSectionWithReferences(shots, analysis);

  // 4. 【分镜头】部分 - 拼接所有镜头
  const shotsPart = buildShotsSection(shots);

  return `${stylePart}\n\n${characterPart}\n\n${scenePart}\n\n${shotsPart}`;
};

/**
 * 构建风格部分
 */
const buildStyleSection = (styleMode) => {
  // 默认风格模板
  const styleTemplates = {
    realistic: '真人写实电影风格，真实演员质感，真实场景实景，真实皮肤质感，真实服装材质，真实镜头语言，空间清晰，亮度自然，高清，细节丰富，不要字幕，不要背景音乐。',
    comic_drama: '国漫影视化风格，二次元转真人质感，动漫角色真人化，场景写实但保留动漫美学，色彩饱和，轮廓清晰，高清，细节丰富，不要字幕，不要背景音乐。'
  };

  const styleText = styleTemplates[styleMode] || styleTemplates.realistic;
  return `【风格】 ${styleText}`;
};

/**
 * 构建角色部分（使用 @ID 引用）
 */
const buildCharacterSectionWithReferences = (shots, analysis) => {
  const characterIds = new Set();
  const characterNames = [];

  // 从所有镜头中提取角色引用
  shots.forEach(shot => {
    // 从 prompt 中提取 @角色ID
    const matches = (shot.prompt || '').match(/@([a-f0-9-]+)/g) || [];
    matches.forEach(match => {
      const charId = match.substring(1);
      if (!characterIds.has(charId)) {
        characterIds.add(charId);
        // 查找角色名称
        const char = (analysis.characters || []).find(c => c.id === charId);
        if (char) {
          characterNames.push(`@${charId}${char.name}`);
        } else {
          characterNames.push(match);
        }
      }
    });

    // 从 characterNames 中提取
    if (Array.isArray(shot.characterNames)) {
      shot.characterNames.forEach(name => {
        if (!characterNames.includes(name)) {
          characterNames.push(name);
        }
      });
    }
  });

  if (characterNames.length === 0) {
    return '【角色】 无';
  }

  return `【角色】 ${characterNames.join('、')}`;
};

/**
 * 构建场景部分（使用 @ID 或 #ID 引用）
 */
const buildSceneSectionWithReferences = (shots, analysis) => {
  const sceneIds = new Set();
  const sceneNames = [];

  // 从所有镜头中提取场景引用
  shots.forEach(shot => {
    // 从 prompt 中提取 #场景ID 或 @场景ID
    const hashMatches = (shot.prompt || '').match(/#([a-f0-9-]+)/g) || [];
    const atMatches = (shot.prompt || '').match(/@([a-f0-9-]+)/g) || [];

    [...hashMatches, ...atMatches].forEach(match => {
      const sceneId = match.substring(1);
      if (!sceneIds.has(sceneId)) {
        sceneIds.add(sceneId);
        // 查找场景名称
        const scene = (analysis.backgrounds || []).find(bg => bg.id === sceneId);
        if (scene) {
          sceneNames.push(`@${sceneId}${scene.name}`);
        }
      }
    });

    // 从 sceneNames 中提取
    if (Array.isArray(shot.sceneNames)) {
      shot.sceneNames.forEach(name => {
        if (!sceneNames.includes(name)) {
          sceneNames.push(name);
        }
      });
    }
  });

  if (sceneNames.length === 0) {
    return '【场景】 无';
  }

  return `【场景】 ${sceneNames.join('、')}`;
};

/**
 * 构建分镜头部分
 */
const buildShotsSection = (shots) => {
  if (shots.length === 0) {
    return '【分镜头】 无';
  }

  const shotDescriptions = shots.map((shot, index) => {
    const startTime = Math.floor(shot.startTime || 0);
    const endTime = Math.ceil(shot.endTime || 0);
    const timeRange = `【${startTime}-${endTime}秒】`;
    const shotLabel = `镜头${index + 1}`;
    const shotType = shot.shotType || '中景';
    const cameraMove = shot.cameraMovement || '固定镜头';

    // 画面描述（保留 @ID 引用）
    const promptText = shot.prompt || '';

    // 动作部分
    const actionPart = shot.action ? `动作：${shot.action}` : '';

    // 对白部分
    let dialoguePart = '对白口型指导：无对白';
    if (shot.speech && shot.speech.transcript) {
      dialoguePart = `对白口型指导："${shot.speech.transcript}"`;
    }

    // 组装
    const parts = [
      `${timeRange}${shotLabel}：${shotType}，${cameraMove}。`,
      `画面：${promptText}`
    ];

    if (actionPart) parts.push(actionPart);
    parts.push(dialoguePart);

    return parts.join(' ');
  }).join('\n\n');

  return `【分镜头】 ${shotDescriptions}`;
};
