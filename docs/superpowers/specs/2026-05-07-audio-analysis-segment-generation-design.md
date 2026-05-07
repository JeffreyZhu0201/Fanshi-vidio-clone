# 视频+音频联合分析与片段级视频生成设计

**日期**: 2026-05-07  
**状态**: 已批准  
**方案**: 渐进式改造

## 1. 概述

### 1.1 目标

实现以下功能增强：

1. **视频+音频联合分析**：使用 Doubao-Seed Responses API 同时分析视频和音频，提取角色对白、情感、音色特点、语气、语速
2. **角色音色特征**：在角色卡片中添加音色特征字段（`voiceProfile`），包含音色、语气、语速、情感等信息
3. **片段分割优化**：同一背景/场景作为一个片段，不同机位作为镜头，避免过度细分
4. **片段级视频生成**：每个片段生成一个视频卡片，拼接该片段所有镜头的提示词，移除单独镜头生成功能
5. **资源引用展开**：在生成提示词中，将 `@角色ID` 和 `#场景ID` 展开为完整的资源描述（包含外观、性格、音色特征）

### 1.2 设计原则

- **渐进式改造**：在现有架构上逐步增强，保持向后兼容
- **最小破坏**：不破坏现有的 117 个测试用例
- **分阶段实施**：每个功能点独立开发和测试
- **保持稳定性**：项目已接近完成，避免大规模重构

### 1.3 实施路径

1. 第一步：增强整片分析提示词，添加音色特征提取
2. 第二步：实现片段智能合并逻辑
3. 第三步：增强资源展开逻辑，包含音色特征
4. 第四步：调整前端，移除镜头级生成按钮

## 2. 数据模型变更

### 2.1 角色音色特征（voiceProfile）

在 `Analysis.characters` 中添加新字段：

```javascript
{
  id: 'character_1',
  name: '角色名',
  appearancePrompt: '角色完整形象设定',
  personalityPrompt: '角色的性格气质设定',
  voiceProfile: {  // 新增字段
    timbre: '音色描述（如：清亮、低沉、沙哑）',
    tone: '语气特点（如：温和、严厉、俏皮）',
    pace: '语速（如：正常、偏快、缓慢）',
    emotion: '情感倾向（如：平静、激动、忧郁）',
    intensity: '说话力度（如：轻柔、有力、急促）',
    articulation: '口型明显程度（如：清晰、含糊）',
    summary: '综合音色特征描述'
  },
  representativeFrameTime: 1.2,
  representativeFrameNote: '该角色的典型帧说明',
  stateTimeline: [...]
}
```

**字段说明**：

- `timbre`: 音色的基本特质（清亮/低沉/沙哑/磁性等）
- `tone`: 说话的语气风格（温和/严厉/俏皮/冷漠等）
- `pace`: 说话速度（正常/偏快/缓慢/急促等）
- `emotion`: 整体情感倾向（平静/激动/忧郁/欢快等）
- `intensity`: 说话的力度和能量（轻柔/有力/急促/平稳等）
- `articulation`: 口型和发音的清晰程度（清晰/含糊/夸张等）
- `summary`: 综合描述，用于生成视频时的参考提示词

**提取策略**：

- **初步提取**：在整片分析时，AI 根据视频中的音频内容为每个角色生成初步的 `voiceProfile`
- **后续优化**：后续可以基于实际对白数据进一步优化（预留接口，本次不实现）

### 2.2 片段场景标识

在 `timeAnchors` 中添加场景标识字段：

```javascript
{
  startTime: 0,
  endTime: 15,
  sceneId: 'scene_礼堂入口',  // 新增：用于识别同场景片段
  sceneSummary: '片段解释',
  shots: [...]
}
```

**用途**：

- 用于后端智能合并相邻的同场景片段
- 场景标识由 AI 在整片分析时生成，格式为 `scene_<场景名称>`

### 2.3 数据库迁移

由于 `characters`、`backgrounds`、`timeAnchors` 都存储在 `analyses` 表的 JSON 字段中，无需创建新的数据库迁移。

**兼容性**：

- 旧数据中没有 `voiceProfile` 字段的角色，前端和后端都应该能正常处理（视为 `null` 或空对象）
- 旧数据中没有 `sceneId` 字段的片段，合并逻辑会跳过

## 3. 整片分析增强

### 3.1 Doubao-Seed API 调用增强

在 `backend/services/doubaoSeedService.js` 的 `analyzeVideoComplete()` 函数中，调整 Responses API 的调用参数：

```javascript
const analyzeVideoComplete = async ({ videoPath, analysisOptions }) => {
  // 1. 上传视频到 Doubao-Seed 云存储
  const fileId = await uploadVideoToDoubaoSeed(videoPath);
  
  // 2. 构建增强的分析提示词
  const analysisPrompt = buildVideoAnalysisPrompt({
    video: { /* video metadata */ },
    metadata: { /* video metadata */ },
    analysisOptions
  });
  
  // 3. 调用 Responses API
  const response = await requestExternalJson({
    url: `${DOUBAO_SEED_API_BASE_URL}/api/v3/responses`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SEED_DANCE_API_KEY}`
    },
    body: {
      model: 'doubao-seed-2-0-lite-260428',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_video',
              video_url: fileId,  // 或公网 URL
              fps: 0.3  // 帧率
            },
            {
              type: 'input_text',
              text: analysisPrompt  // 增强后的提示词
            }
          ]
        }
      ]
    }
  });
  
  return response;
};
```

**关键变更**：

- 使用 `input_video` + `input_text` 的组合，同时传递视频和分析提示词
- `fps: 0.3` 保持不变，用于视频帧提取
- 提示词中明确要求返回角色的音色特征

### 3.2 提示词增强

在 `shared/promptBlueprints.js` 的 `buildVideoAnalysisPromptSections()` 函数中增强 JSON schema：

**增强角色 schema**：

```javascript
const fixedStructurePrompt = [
  '你是一名资深视频理解与影视拆解助手。',
  '请对输入的整条视频做一次完整的整体视频理解，并严格返回 JSON。',
  '不要输出 Markdown，不要输出解释，不要输出额外文本。',
  '这次整片分析需要同时分析视频画面和音频内容，提取角色的对白、音色特征、情感倾向。',
  '返回结构必须完全符合：',
  JSON.stringify({
    plot: 'string',
    characters: [
      {
        id: 'character_1',
        name: '角色名',
        appearancePrompt: '角色完整形象设定',
        personalityPrompt: '角色的性格气质设定',
        voiceProfile: {  // 新增
          timbre: '音色（清亮/低沉/沙哑等）',
          tone: '语气（温和/严厉/俏皮等）',
          pace: '语速（正常/偏快/缓慢）',
          emotion: '情感倾向（平静/激动/忧郁等）',
          intensity: '说话力度（轻柔/有力/急促）',
          articulation: '口型明显程度（清晰/含糊）',
          summary: '综合音色特征的完整描述'
        },
        representativeFrameTime: 1.2,
        representativeFrameNote: '该角色的典型帧说明',
        stateTimeline: [...]
      }
    ],
    timeAnchors: [
      {
        startTime: 0,
        endTime: 7,
        sceneId: 'scene_礼堂入口',  // 新增
        sceneSummary: '片段解释',
        shots: [...]
      }
    ]
  }, null, 2),
  '',
  '音色特征提取要求：',
  '1. 仔细分析视频中每个角色的说话音频，识别其音色、语气、语速、情感倾向',
  '2. timbre 描述音色的基本特质（如：清亮、低沉、沙哑、磁性）',
  '3. tone 描述说话的语气风格（如：温和、严厉、俏皮、冷漠）',
  '4. pace 描述说话速度（如：正常、偏快、缓慢、急促）',
  '5. emotion 描述整体情感倾向（如：平静、激动、忧郁、欢快）',
  '6. intensity 描述说话的力度和能量（如：轻柔、有力、急促、平稳）',
  '7. articulation 描述口型和发音的清晰程度（如：清晰、含糊、夸张）',
  '8. summary 提供综合的音色特征描述，用于后续视频生成时的参考',
  '9. 如果角色在视频中没有说话，voiceProfile 各字段返回空字符串',
  '',
  '片段划分要求：',
  '1. 按场景/背景划分大片段（timeAnchors），同一场景内的不同机位作为小镜头（shots）',
  '2. 场景切换时才创建新的 timeAnchor，避免在同一背景下过度切分',
  '3. 每个 timeAnchor 必须包含 sceneId 字段，格式为 scene_<场景名称>（如：scene_礼堂入口）',
  '4. sceneId 应该基于场景的物理位置命名，相同位置的片段使用相同的 sceneId',
  '5. 同一场景内的镜头变化（推拉摇移、特写中景全景）都属于同一个 timeAnchor',
  '6. 只有当角色移动到新的物理空间时，才创建新的 timeAnchor',
  ''
].join('\n');
```

**增强片段划分指导**：

提示词中明确要求 AI 按场景划分片段，避免过度细分。关键规则：

1. **场景切换才分片段**：只有当角色移动到新的物理空间（如从礼堂外到礼堂内）时，才创建新的 `timeAnchor`
2. **机位变化不分片段**：同一场景内的推拉摇移、特写中景全景等镜头变化，都属于同一个 `timeAnchor` 的不同 `shots`
3. **场景标识规范**：`sceneId` 格式为 `scene_<场景名称>`，如 `scene_礼堂入口`、`scene_教室内`
4. **场景名称一致性**：相同物理位置的片段必须使用相同的 `sceneId`

### 3.3 Gemini 提供商兼容

对于使用 Gemini 进行整片分析的情况，也需要在 `backend/services/geminiService.js` 中应用相同的提示词增强。

由于 Gemini 不支持 `input_video` + `input_text` 的组合格式，保持现有的视频上传方式不变，只增强提示词内容。

## 4. 片段智能合并

### 4.1 合并逻辑实现

在 `backend/services/analysisService.js` 中添加新函数：

```javascript
/**
 * 合并相邻的同场景片段
 * @param {Array} timeAnchors - 原始时间锚点数组
 * @returns {Array} 合并后的时间锚点数组
 */
const mergeAdjacentSegments = (timeAnchors) => {
  if (!Array.isArray(timeAnchors) || timeAnchors.length <= 1) {
    return timeAnchors;
  }

  const merged = [];
  let current = { ...timeAnchors[0], shots: [...(timeAnchors[0].shots || [])] };

  for (let i = 1; i < timeAnchors.length; i++) {
    const next = timeAnchors[i];
    
    // 判断是否同场景
    if (isSameScene(current, next)) {
      // 合并：扩展时间范围，合并 shots
      current.endTime = next.endTime;
      current.shots = [...current.shots, ...(next.shots || [])];
      
      // 更新场景描述，标记为延续
      if (!current.sceneSummary.includes('（延续）')) {
        current.sceneSummary = `${current.sceneSummary}（延续）`;
      }
    } else {
      // 不同场景：保存当前，开始新片段
      merged.push(current);
      current = { ...next, shots: [...(next.shots || [])] };
    }
  }
  
  merged.push(current);
  
  logger.info('Segment merging completed', {
    originalCount: timeAnchors.length,
    mergedCount: merged.length,
    reduction: timeAnchors.length - merged.length
  });
  
  return merged;
};

/**
 * 判断两个片段是否属于同一场景
 * @param {object} segment1 - 第一个片段
 * @param {object} segment2 - 第二个片段
 * @returns {boolean} 是否同场景
 */
const isSameScene = (segment1, segment2) => {
  // 策略1：如果有 sceneId，直接比较
  if (segment1.sceneId && segment2.sceneId) {
    return segment1.sceneId === segment2.sceneId;
  }
  
  // 策略2：提取场景关键词进行模糊匹配
  const keywords1 = extractSceneKeywords(segment1.sceneSummary || '');
  const keywords2 = extractSceneKeywords(segment2.sceneSummary || '');
  
  // 有共同关键词则认为是同场景
  return keywords1.some(k => keywords2.includes(k));
};

/**
 * 从场景描述中提取关键词
 * @param {string} sceneSummary - 场景描述
 * @returns {Array<string>} 关键词数组
 */
const extractSceneKeywords = (sceneSummary) => {
  const text = String(sceneSummary || '').toLowerCase();
  
  // 常见场景关键词列表
  const sceneKeywords = [
    '礼堂', '教室', '走廊', '操场', '图书馆', '食堂', '宿舍',
    '办公室', '会议室', '实验室', '体育馆', '停车场',
    '入口', '出口', '大厅', '楼梯', '电梯',
    '室内', '室外', '户外', '街道', '公园'
  ];
  
  // 提取匹配的关键词
  return sceneKeywords.filter(keyword => text.includes(keyword));
};
```

### 4.2 调用时机

在 `analyzeVideo()` 函数中，AI 返回结果后、保存到数据库前执行合并：

```javascript
const analyzeVideo = async ({ video, metadata, videoAbsolutePath, analysisOptions, provider }) => {
  // 1. 调用 AI 提供商进行分析
  const rawAnalysis = await analyzeVideoWithProvider({
    video,
    metadata,
    videoAbsolutePath,
    analysisOptions,
    provider
  });
  
  // 2. 智能合并同场景片段
  if (rawAnalysis.timeAnchors && rawAnalysis.timeAnchors.length > 0) {
    rawAnalysis.timeAnchors = mergeAdjacentSegments(rawAnalysis.timeAnchors);
  }
  
  // 3. 后端补充 backgrounds（场景资源库）
  rawAnalysis.backgrounds = deriveBackgroundsFromTimeAnchors(rawAnalysis.timeAnchors);
  
  // 4. 补充角色状态时间线
  rawAnalysis.characters = enrichCharacterStateTimeline(rawAnalysis.characters, rawAnalysis.timeAnchors);
  
  // 5. 保存到数据库
  const analysis = await Analysis.create({
    videoId: video.id,
    plot: rawAnalysis.plot,
    characters: rawAnalysis.characters,
    backgrounds: rawAnalysis.backgrounds,
    timeAnchors: rawAnalysis.timeAnchors,
    analysisOptions: rawAnalysis.analysisOptions,
    geminiResponse: rawAnalysis.geminiResponse
  });
  
  return analysis;
};
```

### 4.3 合并策略

**优先级**：

1. **sceneId 精确匹配**：如果两个片段有相同的 `sceneId`，直接合并
2. **关键词模糊匹配**：如果没有 `sceneId`，提取场景关键词进行匹配
3. **保守策略**：如果无法判断，不合并（避免错误合并）

**边界情况**：

- 如果 AI 返回的片段已经按场景划分得很好，合并逻辑不会产生任何变化
- 如果 AI 过度细分，合并逻辑会自动修正
- 合并后的片段时间范围会自动扩展，`shots` 数组会按时间顺序拼接

## 5. 片段级视频生成

### 5.1 提示词构建增强

在 `shared/promptBlueprints.js` 中添加新函数 `buildSegmentVideoPrompt()`：

```javascript
/**
 * 构建片段级视频生成提示词
 * @param {object} params - 参数对象
 * @param {object} params.segment - 片段数据
 * @param {object} params.analysis - 整片分析数据
 * @param {string} params.styleMode - 风格模式
 * @param {object} params.styleTemplates - 风格模板
 * @returns {string} 完整提示词
 */
const buildSegmentVideoPrompt = ({ segment, analysis, styleMode, styleTemplates }) => {
  const styleTemplate = resolveStyleTemplate({
    styleMode,
    styleTemplates,
    templateKey: 'videoGenerationStylePrompt'
  });

  // 1. 风格部分
  const stylePart = `【风格】\n${styleTemplate}`;

  // 2. 角色部分（展开完整描述 + 音色特征）
  const characterPart = buildCharacterSection(segment, analysis);

  // 3. 场景部分（展开完整描述）
  const scenePart = buildSceneSection(segment, analysis);

  // 4. 分镜头部分（拼接该片段所有镜头）
  const shotsPart = buildShotsSection(segment, analysis);

  return `${stylePart}\n\n${characterPart}\n\n${scenePart}\n\n${shotsPart}`;
};

/**
 * 构建角色部分，展开完整描述
 */
const buildCharacterSection = (segment, analysis) => {
  const characterIds = extractCharacterIds(segment);
  const characters = (analysis.characters || []).filter(c => characterIds.includes(c.id));
  
  if (characters.length === 0) {
    return '【角色】\n无';
  }
  
  const characterDescriptions = characters.map(char => {
    let desc = `${char.name}：${char.appearancePrompt || ''}`;
    
    if (char.personalityPrompt) {
      desc += `\n性格：${char.personalityPrompt}`;
    }
    
    if (char.voiceProfile && char.voiceProfile.summary) {
      desc += `\n音色特征：${char.voiceProfile.summary}`;
      
      // 添加详细音色参数
      const voiceDetails = [];
      if (char.voiceProfile.timbre) voiceDetails.push(char.voiceProfile.timbre);
      if (char.voiceProfile.tone) voiceDetails.push(char.voiceProfile.tone);
      if (char.voiceProfile.pace) voiceDetails.push(`语速${char.voiceProfile.pace}`);
      
      if (voiceDetails.length > 0) {
        desc += `（${voiceDetails.join('、')}）`;
      }
    }
    
    return desc;
  }).join('\n\n');

  return `【角色】\n${characterDescriptions}`;
};

/**
 * 构建场景部分，展开完整描述
 */
const buildSceneSection = (segment, analysis) => {
  const sceneIds = extractSceneIds(segment);
  const scenes = (analysis.backgrounds || []).filter(bg => sceneIds.includes(bg.id));
  
  if (scenes.length === 0) {
    return '【场景】\n无';
  }
  
  const sceneDescriptions = scenes.map(scene => 
    `${scene.name}：${scene.prompt || ''}`
  ).join('\n\n');

  return `【场景】\n${sceneDescriptions}`;
};

/**
 * 构建分镜头部分
 */
const buildShotsSection = (segment, analysis) => {
  const shots = segment.analysis?.shots || [];
  
  if (shots.length === 0) {
    return '【分镜头】\n无';
  }
  
  const shotDescriptions = shots.map((shot, index) => {
    const timeRange = `【${shot.startTime}-${shot.endTime}秒】`;
    const shotLabel = `镜头${index + 1}`;
    const shotType = shot.shotType || '中景';
    const cameraMove = shot.cameraMovement || '固定镜头';
    
    // 展开 @角色 和 #场景
    const expandedPrompt = expandResourceReferences(shot.prompt || '', analysis);
    
    // 对白部分
    let dialoguePart = '\n对白口型指导：无对白';
    if (shot.speech && shot.speech.transcript) {
      const speechStyle = shot.speech.speechStyle || '';
      dialoguePart = `\n对白口型指导："${shot.speech.transcript}"`;
      if (speechStyle) {
        dialoguePart += `（${speechStyle}）`;
      }
    }
    
    // 动作部分
    const actionPart = shot.action ? `\n动作：${shot.action}` : '';
    
    return `${timeRange}${shotLabel}：${shotType}，${cameraMove}。\n画面：${expandedPrompt}${actionPart}${dialoguePart}`;
  }).join('\n\n');

  return `【分镜头】\n${shotDescriptions}`;
};

/**
 * 从片段中提取角色 ID
 */
const extractCharacterIds = (segment) => {
  const ids = new Set();
  const shots = segment.analysis?.shots || [];
  
  shots.forEach(shot => {
    // 从 prompt 中提取 @角色ID
    const matches = (shot.prompt || '').match(/@([a-f0-9-]+)/g) || [];
    matches.forEach(match => ids.add(match.substring(1)));
    
    // 从 characterStateRefs 中提取
    if (Array.isArray(shot.characterStateRefs)) {
      shot.characterStateRefs.forEach(ref => {
        if (ref.characterId) ids.add(ref.characterId);
      });
    }
  });
  
  return Array.from(ids);
};

/**
 * 从片段中提取场景 ID
 */
const extractSceneIds = (segment) => {
  const ids = new Set();
  const shots = segment.analysis?.shots || [];
  
  shots.forEach(shot => {
    // 从 prompt 中提取 #场景ID
    const matches = (shot.prompt || '').match(/#([a-f0-9-]+)/g) || [];
    matches.forEach(match => ids.add(match.substring(1)));
  });
  
  // 从片段级别提取
  if (segment.analysis?.backgroundId) {
    ids.add(segment.analysis.backgroundId);
  }
  
  return Array.from(ids);
};

/**
 * 展开提示词中的 @角色ID 和 #场景ID
 */
const expandResourceReferences = (prompt, analysis) => {
  let expanded = prompt;
  
  // 展开 @角色ID
  const characterMatches = prompt.match(/@([a-f0-9-]+)/g) || [];
  characterMatches.forEach(match => {
    const charId = match.substring(1);
    const char = (analysis.characters || []).find(c => c.id === charId);
    if (char) {
      const fullDesc = `${char.name}（${char.appearancePrompt || ''}）`;
      expanded = expanded.replace(match, fullDesc);
    }
  });
  
  // 展开 #场景ID
  const sceneMatches = prompt.match(/#([a-f0-9-]+)/g) || [];
  sceneMatches.forEach(match => {
    const sceneId = match.substring(1);
    const scene = (analysis.backgrounds || []).find(bg => bg.id === sceneId);
    if (scene) {
      expanded = expanded.replace(match, `${scene.name}（${scene.prompt || ''}）`);
    }
  });
  
  return expanded;
};

export {
  buildSegmentVideoPrompt,
  expandResourceReferences
};
```


### 5.2 生成服务调整

在 `backend/services/generationService.js` 中，调整片段生成逻辑：

```javascript
/**
 * 生成片段视频
 * @param {object} params - 参数对象
 * @returns {object} 生成任务
 */
const generateSegmentVideo = async ({ segmentId, styleMode, ratio, useReferenceVideo, useReferenceFrame }) => {
  // 1. 加载片段和分析数据
  const segment = await Segment.findByPk(segmentId, {
    include: [{ model: Video, as: 'video' }]
  });
  
  const analysis = await Analysis.findOne({
    where: { videoId: segment.videoId }
  });
  
  // 2. 构建片段级提示词
  const prompt = buildSegmentVideoPrompt({
    segment,
    analysis,
    styleMode: styleMode || analysis.analysisOptions?.styleMode,
    styleTemplates: analysis.analysisOptions?.styleTemplates
  });
  
  // 3. 收集参考素材
  const referenceAssets = await collectSegmentReferenceAssets({
    segment,
    analysis,
    useReferenceVideo,
    useReferenceFrame
  });
  
  // 4. 调用 Seedance 生成
  const task = await generateWithSeedDance({
    prompt,
    ratio,
    referenceImages: referenceAssets.images,
    referenceVideos: referenceAssets.videos,
    referenceAudios: referenceAssets.audios,
    duration: segment.endTime - segment.startTime
  });
  
  // 5. 保存任务记录
  const generationTask = await GenerationTask.create({
    segmentId,
    prompt,
    status: TASK_STATUS.pending,
    meta: {
      engine: 'seedance',
      styleMode,
      ratio,
      useReferenceVideo,
      useReferenceFrame,
      remoteTaskId: task.taskId
    }
  });
  
  return generationTask;
};

/**
 * 收集片段级参考素材
 */
const collectSegmentReferenceAssets = async ({ segment, analysis, useReferenceVideo, useReferenceFrame }) => {
  const assets = {
    images: [],
    videos: [],
    audios: []
  };
  
  // 1. 角色三视图
  const characterIds = extractCharacterIds(segment);
  const characterImages = await listCompletedResourceImageAssetsByResourceKeys(
    characterIds.map(id => `character-${id}-turnaround`)
  );
  assets.images.push(...characterImages.map(img => toAbsolutePublicUploadUrl(img.assetPath)));
  
  // 2. 场景参考图
  const sceneIds = extractSceneIds(segment);
  const sceneImages = await listCompletedResourceImageAssetsByResourceKeys(
    sceneIds.map(id => `scene-${id}-wide`)
  );
  assets.images.push(...sceneImages.map(img => toAbsolutePublicUploadUrl(img.assetPath)));
  
  // 3. 片段源视频（可选）
  if (useReferenceVideo && segment.videoPath) {
    assets.videos.push(toAbsolutePublicUploadUrl(segment.videoPath));
  }
  
  // 4. 片段典型帧（可选）
  if (useReferenceFrame && segment.keyframePath) {
    assets.images.push(toAbsolutePublicUploadUrl(segment.keyframePath));
  }
  
  // 5. 镜头参考音频（如果有对白）
  const shots = segment.analysis?.shots || [];
  for (const shot of shots) {
    if (shot.speech && shot.speech.audioPath) {
      assets.audios.push(toAbsolutePublicUploadUrl(shot.speech.audioPath));
    }
  }
  
  return assets;
};
```

### 5.3 API 端点保持不变

现有的 API 端点保持不变，只调整内部实现：

```
POST /api/generation/generate
{
  "segment_id": 123,
  "style_mode": "realistic",
  "ratio": "9:16",
  "use_reference_video": false,
  "use_reference_frame": false
}
```

**响应**：

```json
{
  "task_id": 456,
  "segment_id": 123,
  "status": "pending",
  "prompt": "【风格】...\n【角色】...\n【场景】...\n【分镜头】...",
  "meta": {
    "engine": "seedance",
    "style_mode": "realistic",
    "ratio": "9:16"
  }
}
```

## 6. 前端调整

### 6.1 移除镜头级生成按钮

在 `frontend/src/components/SegmentCard.jsx` 中：

**之前的结构**：

```jsx
<div className="segment-card">
  <div className="segment-header">
    <h3>片段 {segment.segmentIndex + 1}</h3>
    <button onClick={() => generateSegment(segment.id)}>生成片段</button>
  </div>
  
  <div className="shots-list">
    {segment.analysis?.shots?.map((shot, index) => (
      <div key={index} className="shot-item">
        <span>镜头 {index + 1}</span>
        <button onClick={() => generateShot(shot.id)}>生成镜头</button> {/* 移除 */}
      </div>
    ))}
  </div>
</div>
```

**修改后的结构**：

```jsx
<div className="segment-card">
  <div className="segment-header">
    <h3>片段 {segment.segmentIndex + 1}</h3>
    <button onClick={() => generateSegmentVideo(segment.id)}>
      生成片段视频
    </button>
  </div>
  
  {/* 镜头列表：只显示，不提供单独生成功能 */}
  <div className="shots-list">
    {segment.analysis?.shots?.map((shot, index) => (
      <div key={index} className="shot-item">
        <span>镜头 {index + 1}</span>
        <span className="shot-time">{shot.startTime}s - {shot.endTime}s</span>
        <span className="shot-type">{shot.shotType || '中景'}</span>
        {/* 移除：<button>生成镜头</button> */}
      </div>
    ))}
  </div>
  
  {/* 提示词预览 */}
  <div className="prompt-preview">
    <button onClick={() => togglePromptPreview(segment.id)}>
      预览生成提示词
    </button>
    {showPromptPreview && (
      <pre className="prompt-content">
        {buildSegmentPromptPreview(segment)}
      </pre>
    )}
  </div>
</div>
```

### 6.2 提示词预览功能

在 `frontend/src/utils/promptPreview.js` 中添加：

```javascript
/**
 * 构建片段提示词预览（前端展示用）
 * @param {object} segment - 片段数据
 * @param {object} analysis - 整片分析数据
 * @returns {string} 提示词预览
 */
export const buildSegmentPromptPreview = (segment, analysis) => {
  const shots = segment.analysis?.shots || [];
  
  // 提取角色和场景
  const characterIds = extractCharacterIdsFromSegment(segment);
  const sceneIds = extractSceneIdsFromSegment(segment);
  
  const characters = (analysis?.characters || [])
    .filter(c => characterIds.includes(c.id))
    .map(c => {
      let desc = `${c.name}：${c.appearancePrompt || ''}`;
      if (c.voiceProfile?.summary) {
        desc += `\n音色：${c.voiceProfile.summary}`;
      }
      return desc;
    })
    .join('\n\n');
  
  const scenes = (analysis?.backgrounds || [])
    .filter(bg => sceneIds.includes(bg.id))
    .map(bg => `${bg.name}：${bg.prompt || ''}`)
    .join('\n\n');
  
  const shotsList = shots.map((shot, index) => {
    const dialogue = shot.speech?.transcript 
      ? `\n对白："${shot.speech.transcript}"`
      : '\n对白：无';
    
    return `【${shot.startTime}-${shot.endTime}秒】镜头${index + 1}：${shot.shotType || '中景'}
画面：${shot.prompt || ''}${dialogue}`;
  }).join('\n\n');
  
  return `【风格】真人写实电影风格...

【角色】
${characters || '无'}

【场景】
${scenes || '无'}

【分镜头】
${shotsList}`;
};
```

### 6.3 角色卡片显示音色特征

在 `frontend/src/components/CharacterCard.jsx` 中：

```jsx
const CharacterCard = ({ character }) => {
  return (
    <div className="character-card">
      <h4>{character.name}</h4>
      
      <div className="character-appearance">
        <strong>外观：</strong>
        <p>{character.appearancePrompt}</p>
      </div>
      
      <div className="character-personality">
        <strong>性格：</strong>
        <p>{character.personalityPrompt}</p>
      </div>
      
      {/* 新增：音色特征 */}
      {character.voiceProfile && character.voiceProfile.summary && (
        <div className="character-voice">
          <strong>音色特征：</strong>
          <p>{character.voiceProfile.summary}</p>
          <div className="voice-details">
            {character.voiceProfile.timbre && (
              <span className="voice-tag">{character.voiceProfile.timbre}</span>
            )}
            {character.voiceProfile.tone && (
              <span className="voice-tag">{character.voiceProfile.tone}</span>
            )}
            {character.voiceProfile.pace && (
              <span className="voice-tag">语速{character.voiceProfile.pace}</span>
            )}
          </div>
        </div>
      )}
      
      <div className="character-actions">
        <button onClick={() => generateCharacterImages(character.id)}>
          生成角色图像
        </button>
      </div>
    </div>
  );
};
```

### 6.4 移除相关 Hooks 和 Services

需要清理的文件：

1. `frontend/src/hooks/useGeneration.js` - 移除 `generateShotVideo` 相关逻辑
2. `frontend/src/services/generationService.js` - 移除单镜头生成 API 调用
3. `backend/services/shotGenerationService.js` - 标记为 deprecated（保留用于数据查询）
4. `backend/routes/generation.js` - 移除单镜头生成路由（或标记为 deprecated）

**注意**：不要立即删除这些文件，而是标记为 deprecated，以便后续逐步迁移。

## 7. 测试策略

### 7.1 单元测试

需要添加的测试：

1. **音色特征提取测试**：
   - 测试 `buildVideoAnalysisPromptSections()` 是否包含 `voiceProfile` schema
   - 测试 AI 返回的 `voiceProfile` 数据是否正确解析

2. **片段合并测试**：
   - 测试 `mergeAdjacentSegments()` 正确合并同场景片段
   - 测试 `isSameScene()` 场景判断逻辑
   - 测试边界情况（空数组、单个片段、无 sceneId）

3. **资源展开测试**：
   - 测试 `expandResourceReferences()` 正确展开 `@角色ID` 和 `#场景ID`
   - 测试音色特征是否包含在展开结果中

4. **提示词构建测试**：
   - 测试 `buildSegmentVideoPrompt()` 生成正确格式的提示词
   - 测试各部分（风格、角色、场景、分镜头）是否完整

### 7.2 集成测试

需要测试的流程：

1. **完整分析流程**：
   - 上传视频 → 整片分析 → 验证 `voiceProfile` 和 `sceneId` 是否存在
   - 验证片段是否正确合并

2. **片段生成流程**：
   - 生成片段视频 → 验证提示词格式 → 验证参考素材收集
   - 验证生成任务状态更新

3. **前端交互流程**：
   - 角色卡片显示音色特征
   - 片段卡片只显示片段级生成按钮
   - 提示词预览功能正常工作

### 7.3 回归测试

确保现有功能不受影响：

1. 运行现有的 117 个测试用例，确保全部通过
2. 测试旧数据兼容性（没有 `voiceProfile` 的角色）
3. 测试 Gemini 提供商的兼容性

## 8. 实施计划

### 阶段 1：数据模型和提示词增强（2-3 天）

**任务**：

1. 修改 `buildVideoAnalysisPromptSections()` 添加 `voiceProfile` 和 `sceneId` schema
2. 修改 `doubaoSeedService.js` 支持音频分析
3. 修改 `geminiService.js` 应用相同的提示词增强
4. 编写单元测试验证提示词格式

**验收标准**：

- 提示词包含完整的 `voiceProfile` 和 `sceneId` 要求
- AI 返回的数据包含这些字段
- 单元测试通过

### 阶段 2：片段智能合并（1-2 天）

**任务**：

1. 实现 `mergeAdjacentSegments()` 函数
2. 实现 `isSameScene()` 和 `extractSceneKeywords()` 辅助函数
3. 在 `analyzeVideo()` 中集成合并逻辑
4. 编写单元测试和集成测试

**验收标准**：

- 同场景片段正确合并
- 不同场景片段保持独立
- 合并日志清晰可追踪
- 测试覆盖边界情况

### 阶段 3：资源展开和提示词构建（2-3 天）

**任务**：

1. 实现 `buildSegmentVideoPrompt()` 函数
2. 实现 `expandResourceReferences()` 函数
3. 实现 `buildCharacterSection()`、`buildSceneSection()`、`buildShotsSection()`
4. 修改 `generationService.js` 使用新的提示词构建逻辑
5. 编写单元测试

**验收标准**：

- 提示词格式符合用户提供的模板
- `@角色ID` 和 `#场景ID` 正确展开
- 音色特征包含在角色描述中
- 测试验证提示词完整性

### 阶段 4：前端调整（1-2 天）

**任务**：

1. 修改 `SegmentCard.jsx` 移除镜头级生成按钮
2. 添加提示词预览功能
3. 修改 `CharacterCard.jsx` 显示音色特征
4. 清理相关 hooks 和 services
5. 更新前端测试

**验收标准**：

- 前端只显示片段级生成按钮
- 提示词预览功能正常
- 角色卡片显示音色特征
- 前端测试通过

### 阶段 5：集成测试和文档（1 天）

**任务**：

1. 运行完整的集成测试
2. 验证旧数据兼容性
3. 更新 API 文档
4. 更新 CLAUDE.md
5. 编写用户使用指南

**验收标准**：

- 所有测试通过（包括现有的 117 个测试）
- 文档完整准确
- 用户指南清晰易懂

## 9. 风险和缓解措施

### 9.1 AI 返回数据不符合预期

**风险**：AI 可能不返回 `voiceProfile` 或 `sceneId` 字段

**缓解措施**：

- 在后端添加数据验证和默认值填充
- 如果 `voiceProfile` 缺失，使用空对象
- 如果 `sceneId` 缺失，使用 `scene_未命名_<index>` 作为默认值
- 记录警告日志，便于后续优化提示词

### 9.2 片段合并过度或不足

**风险**：合并逻辑可能错误合并不同场景，或未能合并同场景

**缓解措施**：

- 使用保守策略，优先 `sceneId` 精确匹配
- 提供手动调整接口（后续版本）
- 记录合并决策日志，便于调试
- 添加合并前后对比的可视化工具

### 9.3 现有测试失败

**风险**：修改可能导致现有的 117 个测试失败

**缓解措施**：

- 每个阶段完成后立即运行测试
- 保持向后兼容，旧数据应该能正常处理
- 使用特性开关（feature flag）控制新功能启用
- 准备回滚方案

### 9.4 性能影响

**风险**：资源展开和提示词构建可能影响性能

**缓解措施**：

- 缓存展开结果，避免重复计算
- 使用异步处理，不阻塞主流程
- 监控生成时间，设置性能基准
- 如果性能问题严重，考虑预计算和缓存策略

## 10. 成功标准

### 10.1 功能完整性

- ✅ 整片分析返回角色 `voiceProfile` 和片段 `sceneId`
- ✅ 片段智能合并正确工作
- ✅ 片段级视频生成使用正确的提示词格式
- ✅ 资源引用正确展开，包含音色特征
- ✅ 前端只显示片段级生成按钮
- ✅ 角色卡片显示音色特征

### 10.2 质量标准

- ✅ 所有新增代码有单元测试覆盖
- ✅ 集成测试验证完整流程
- ✅ 现有的 117 个测试全部通过
- ✅ 代码符合项目规范（ESLint、Prettier）
- ✅ 文档完整准确

### 10.3 性能标准

- ✅ 整片分析时间增加不超过 10%
- ✅ 片段生成时间增加不超过 5%
- ✅ 前端渲染流畅，无明显卡顿

### 10.4 用户体验

- ✅ 角色音色特征清晰易懂
- ✅ 片段划分合理，不过度细分
- ✅ 提示词预览功能直观
- ✅ 生成流程简化，操作步骤减少

## 11. 后续优化方向

### 11.1 音色特征优化

- 支持基于实际对白数据进一步优化音色特征
- 添加音色特征编辑功能
- 支持音色特征的 A/B 测试

### 11.2 片段合并优化

- 添加手动调整片段边界的功能
- 支持自定义合并规则
- 提供合并前后对比的可视化工具

### 11.3 提示词优化

- 支持用户自定义提示词模板
- 添加提示词版本管理
- 提供提示词效果评估工具

### 11.4 性能优化

- 预计算和缓存资源展开结果
- 使用 Worker 线程处理提示词构建
- 优化数据库查询，减少 N+1 问题

---

**文档版本**: 1.0  
**最后更新**: 2026-05-07  
**作者**: Claude Opus 4.6
