# 视频上传后流程与 AI 提示词

本文档基于当前仓库实际代码整理，覆盖：

- 视频从上传到最终拼接下载会经历哪些步骤
- 每一步是否调用 AI
- 当前代码里真正调用到的所有 AI 提示词
- 这些提示词现在在前端的展示位置

---

## 1. 总流程

视频上传后，当前项目的实际链路如下：

1. 上传原视频
2. 提取元数据并入库
3. 调用 Gemini 做整片分析
4. 基于时间锚点切分片段
5. 对每个片段调用 Gemini 做片段理解
6. 前端展示片段，并允许用户编辑 prompt
7. 用户点击“片段分析”可重新理解单个片段
8. 用户点击“优化提示词”可调用 Gemini 润色当前片段 prompt
9. 用户点击“生成片段”后，后端把 `@角色名` 展开成角色外观设定，再调用 SeedDance 生成新片段
10. 后端按“优先已生成片段，否则回退原片段”的规则执行 merge
11. 用户下载最终成片

其中真正调用 AI 的步骤只有 3、5、7、8、9。

---

## 2. 各步骤明细

### 步骤 1：上传原视频

- 前端：`UploadArea`
- 后端接口：`POST /api/videos/upload`
- 后端服务：`videoService.createVideoFromUpload`
- 是否调用 AI：否

这一阶段会做：

- 文件类型、大小、时长、重复文件校验
- `ffprobe` 元数据读取
- 数据库写入 `videos`
- 原视频文件落盘到 `backend/uploads/videos`

### 步骤 2：整片分析

- 前端入口：分析区“开始分析 / 重新分析”
- 后端接口：`POST /api/analysis/analyze`
- 后端服务：`analysisService.analyzeVideoById`
- AI 模型：`GEMINI_MODEL`
- 默认值：`gemini-2.5-pro`

这一阶段会产出：

- `plot`
- `characters`
- `backgrounds`
- `timeAnchors`
- `geminiResponse`

### 步骤 3：按时间锚点切分片段

- 前端入口：分析区“生成片段”
- 后端接口：`POST /api/segments/split`
- 后端服务：`segmentService.startSplitVideo`
- 是否调用 AI：切分本身不调用 AI，但切完后会立即进入片段分析

这一阶段会做：

- 基于 `time_anchors` 调用 `ffmpegService.splitVideo`
- 为每个切出来的片段调用 `analyzeSegmentContent`
- 写入 `segments`

### 步骤 4：片段理解

- 自动触发时机：步骤 3 每个片段切好后立即触发
- 手动触发时机：前端片段卡片“片段分析”按钮
- 后端接口：`POST /api/segments/:id/analyze`
- 后端服务：`segmentService.analyzeSegmentById`
- AI 模型：`GEMINI_SEGMENT_MODEL`
- 默认值：`gemini-2.5-flash`

这一阶段会刷新：

- `segments.analysis.characters`
- `segments.analysis.scene`
- `segments.analysis.action`
- `segments.analysis.prompt`

### 步骤 5：提示词优化

- 前端入口：片段卡片“优化提示词”
- 后端接口：`POST /api/analysis/optimize-prompt`
- 后端服务：`analysisService.optimizePrompt`
- AI 模型：`GEMINI_MODEL`
- 默认值：`gemini-2.5-pro`

这一阶段会：

- 对当前编辑器中的 prompt 做润色
- 把角色名统一标准化成 `@角色名`
- 返回 `optimized_prompt`
- 返回 `highlighted_prompt`

补充说明：

- 现在前端优化按钮已经改成直接读取编辑器当前草稿，而不是读可能滞后的 store 旧值

### 步骤 6：片段生成

- 前端入口：片段卡片“生成片段”
- 后端接口：`POST /api/generation/generate`
- 后端服务：`generationService.startGeneration`
- AI 模型：`SEED_DANCE_MODEL`

这一阶段会：

- 把当前 prompt 原样存入 `generation_tasks.prompt`
- 在后端把 `@角色名` 展开成整片分析里的角色外观设定
- 把展开后的结果写入 `generation_tasks.optimized_prompt`
- 调用 SeedDance 生成视频

### 步骤 7：拼接输出

- 前端入口：左侧“开始拼接”
- 后端接口：`POST /api/merge/start`
- 后端服务：`mergeService.startMerge`
- 是否调用 AI：否

这一阶段会：

- 查询所有片段
- 优先使用最近一次成功生成的片段
- 没有生成结果时回退到原始片段
- 调用 FFmpeg 合并
- 生成下载文件

---

## 3. 当前代码里的所有 AI 提示词

下面这些就是当前仓库真实使用的 AI 提示词模板。

### 3.1 整片分析提示词

来源：

- 后端：`backend/services/geminiService.js`
- 方法：`buildVideoAnalysisPrompt`

当前模板：

```text
你是一名资深影视分镜分析师。
请阅读输入视频并严格返回 JSON，不要输出 Markdown、解释或额外文本。
返回结构必须完全符合：
{
  "plot": "string",
  "characters": [
    {
      "id": "character_1",
      "name": "角色名",
      "appearancePrompt": "角色完整形象设定"
    }
  ],
  "backgrounds": [
    {
      "id": "background_1",
      "description": "镜头或场景背景描述"
    }
  ],
  "timeAnchors": [
    {
      "startTime": 0,
      "endTime": 3.2,
      "sceneSummary": "镜头摘要"
    }
  ]
}
视频文件名：{{video.filename}}
视频时长（秒）：{{video.duration}}
要求：
1. plot 用中文概括完整剧情。
2. characters 至少提取主要角色，appearancePrompt 用于后续视频生成，必须稳定、具体。
3. backgrounds 按镜头或场景概括环境、氛围、光线和关键布景。
4. timeAnchors 必须覆盖完整视频，startTime 和 endTime 为数字秒，按时间升序。
5. 如果角色较少，也至少保证 characters 返回 1 个对象。
```

前端展示位置：

- 整片分析区 `AnalysisDisplay`
- 标题为“整片分析提示词”

### 3.2 片段理解提示词

来源：

- 后端：`backend/services/geminiService.js`
- 方法：`buildSegmentAnalysisPrompt`

当前模板：

```text
你是一名资深短视频镜头拆解助手。
请分析输入的视频片段，并严格返回 JSON，不要输出 Markdown、解释或额外文本。
返回结构必须完全符合：
{
  "characters": [
    "角色名"
  ],
  "scene": "片段场景描述",
  "action": "片段主要动作描述",
  "prompt": "@角色名 + 场景 + 动作 + 镜头语言 的可编辑中文提示词"
}
片段序号：{{segment.segmentIndex + 1}}
片段时间：{{segment.startTime}} - {{segment.endTime}} 秒
整片剧情摘要：{{analysis.plot}}
整片角色设定：{{JSON.stringify(analysis.characters)}}
要求：
1. characters 返回当前片段真正出现或应重点关注的角色名称列表。
2. prompt 必须为后续视频生成可直接编辑的中文提示词。
3. prompt 中涉及角色时，用 @角色名 标记，而不是展开成长描述。
4. 输出必须是有效 JSON。
```

前端展示位置：

- 每个 `SegmentCard`
- 标题为“片段理解提示词”

### 3.3 提示词优化提示词

来源：

- 后端：`backend/services/geminiService.js`
- 方法：`buildPromptOptimizationPrompt`

当前模板：

```text
你是一名视频生成提示词优化助手。
请优化下面的提示词，并严格返回 JSON，不要输出 Markdown 或额外解释。
返回结构必须完全符合：
{
  "optimizedPrompt": "@角色名 出现在更清晰的镜头描述中"
}
原始提示词：{{segment.prompt}}
角色列表：{{JSON.stringify(characters)}}
要求：
1. 保持中文输出。
2. 所有角色名称统一替换成 @角色名。
3. 提示词要更适合视频生成，补足镜头、场景、动作、氛围，但不要改变核心语义。
4. 只返回 JSON。
```

前端展示位置：

- 每个 `SegmentCard`
- 标题为“提示词优化调用词”

### 3.4 当前生成提示词

来源：

- 前端编辑器当前内容
- 也是后端 `POST /api/generation/generate` 的 `prompt`

格式：

```text
@角色名 + 场景 + 动作 + 镜头语言
```

前端展示位置：

- 每个 `SegmentCard`
- 标题为“当前生成提示词”

### 3.5 角色展开后的最终生成提示词

来源：

- 后端：`generationService.expandCharacterMentions`
- 用途：真正发给 SeedDance 的 prompt

展开规则：

```text
@主角
```

会被替换为整片分析中的角色外观设定，例如：

```text
一位年轻主角，面部轮廓清晰，表情自然，服装简洁，镜头感强
```

也就是说，如果编辑器里是：

```text
@主角 在雨夜街头奔跑，镜头稳定推进。
```

真正发给 SeedDance 的会变成类似：

```text
一位年轻主角，面部轮廓清晰，表情自然，服装简洁，镜头感强 在雨夜街头奔跑，镜头稳定推进。
```

前端展示位置：

- 每个 `SegmentCard`
- 标题为“角色展开后的最终生成提示词”

补充：

- 若该片段已经生成过，则这里优先展示最近一次实际生成任务保存下来的 `optimized_prompt`
- 若还没生成，则展示当前 prompt 的实时展开预览

---

## 4. 哪些流程不调用 AI

下面这些步骤不调用 AI：

- 上传文件
- 读取元数据
- FFmpeg 切片
- 拼接 merge
- 下载最终视频

这些流程只做：

- 文件处理
- 数据库存取
- 任务状态跟踪
- 本地或远程生成结果的拼接

---

## 5. 当前前端提示词展示位置

当前已经补到前端的展示位置如下：

- `AnalysisDisplay`
  - 整片分析提示词
- `SegmentCard`
  - 片段理解提示词
  - 提示词优化调用词
  - 当前生成提示词
  - 角色展开后的最终生成提示词

同时，片段卡片还新增了：

- “片段分析”按钮
  - 调用 `POST /api/segments/:id/analyze`
  - 默认使用 `gemini-2.5-flash`
  - 回写 `scene / action / characters / prompt`

---

## 6. 代码落点

本次相关代码主要在这些文件：

- `backend/services/geminiService.js`
- `backend/services/segmentService.js`
- `backend/routes/segments.js`
- `frontend/src/components/AnalysisDisplay.jsx`
- `frontend/src/components/SegmentCard.jsx`
- `frontend/src/components/PromptEditor.jsx`
- `frontend/src/utils/promptBlueprints.js`
