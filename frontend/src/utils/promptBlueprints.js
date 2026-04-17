const safeStringify = (value) => {
  try {
    return JSON.stringify(value ?? [], null, 2);
  } catch (error) {
    return '[]';
  }
};

const buildVideoAnalysisPrompt = ({ video }) => {
  return [
    '你是一名资深视频理解与影视拆解助手。',
    '请对输入的整条视频做整体视频理解，并严格返回 JSON。',
    '不要输出 Markdown，不要输出解释，不要输出额外文本。',
    '返回结构必须完全符合：',
    JSON.stringify(
      {
        plot: 'string',
        characters: [{ id: 'character_1', name: '角色名', appearancePrompt: '角色完整形象设定' }],
        backgrounds: [{ id: 'background_1', description: '镜头或场景背景描述' }],
        timeAnchors: [{ startTime: 0, endTime: 3.2, sceneSummary: '镜头摘要' }]
      },
      null,
      2
    ),
    `视频文件名：${video?.filename ?? 'unknown'}`,
    `视频时长（秒）：${video?.duration ?? 'unknown'}`,
    '要求：',
    '1. plot 用中文概括整条视频的主要剧情、事件推进和结局走向，适合后续片段生成使用。',
    '2. characters 至少提取主要角色，name 要稳定，appearancePrompt 必须是可直接用于视频生成的人物外观设定。',
    '3. backgrounds 需要概括主要场景、环境氛围、光线、天气、布景和空间信息。',
    '4. timeAnchors 必须覆盖完整视频，startTime 和 endTime 为数字秒，严格按时间升序，不要重叠，不要遗漏关键镜头。',
    '5. 每个 timeAnchor 都要给出 sceneSummary，概括该时间段发生的核心画面和动作。',
    '6. 如果角色较少，也至少保证 characters 返回 1 个对象。',
    '7. 输出必须是合法 JSON，字段名保持与示例完全一致。'
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
    `片段序号：${Number(segment?.segmentIndex ?? 0) + 1}`,
    `片段时间：${segment?.startTime ?? 0} - ${segment?.endTime ?? 0} 秒`,
    `整片剧情摘要：${overallAnalysis?.plot ?? '暂无'}`,
    `整片角色设定：${safeStringify(overallAnalysis?.characters ?? [])}`,
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
    `原始提示词：${prompt ?? ''}`,
    `角色列表：${safeStringify(characters ?? [])}`,
    '要求：',
    '1. 保持中文输出。',
    '2. 所有角色名称统一替换成 @角色名。',
    '3. 提示词要更适合视频生成，补足镜头、场景、动作、氛围，但不要改变核心语义。',
    '4. 只返回 JSON。'
  ].join('\n');
};

const expandCharacterMentions = (prompt = '', characters = []) => {
  const normalizedCharacters = (characters ?? [])
    .map((item) =>
      typeof item === 'string'
        ? {
            name: item,
            appearancePrompt: item
          }
        : {
            name: item?.name ?? '',
            appearancePrompt: item?.appearancePrompt ?? item?.appearance_prompt ?? item?.name ?? ''
          }
    )
    .filter((item) => item.name);

  return String(prompt ?? '').replace(/@([\p{L}\p{N}_-]+)/gu, (match, characterName) => {
    const matchedCharacter = normalizedCharacters.find((item) => item.name === characterName);

    if (!matchedCharacter) {
      return match;
    }

    return matchedCharacter.appearancePrompt || match;
  });
};

export {
  buildPromptOptimizationPrompt,
  buildSegmentAnalysisPrompt,
  buildVideoAnalysisPrompt,
  expandCharacterMentions
};
