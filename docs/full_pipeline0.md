# Fanshi 完整链路与流程文档

本文档基于当前仓库真实代码、当前运行状态和最新联调结果整理，目标是把项目从“上传原视频”到“分析、切片、资源生成、片段生成、拼接导出”的整条链路一次讲清楚。

这份文档描述的是“现在项目实际上怎么工作”，不是规划稿。

---

## 1. 一句话总览

当前项目的真实主链路是：

1. 前端上传原视频
2. 后端提取元数据，创建 `project + video`
3. Gemini 做整片理解，返回剧情、角色、场景资源库、片段切分预案
4. 后端按 `time_anchors` 用 FFmpeg 切片，并给每个片段建立基础 `analysis`
5. 后端继续做片段级 Gemini 理解，补齐片段解释、动作、可编辑 prompt
6. 用户可继续优化 prompt，或手动生成角色三视图 / 场景多角度资源图
7. 用户点击生成片段时，后端先校验 Seedance 是否就绪，再自动准备背景资产、展开角色与场景引用、汇总参考图和参考视频，调用 Seedance 异步任务接口
8. 前端通过 WebSocket + 轮询接收任务状态，回写片段卡片
9. 用户触发拼接时，后端优先使用最新成功生成片段，否则回退原片段执行 FFmpeg 合并
10. 前端下载最终成片

---

## 2. 当前系统的核心分层

### 2.1 前端层

前端主要入口是：

- [MainPage.jsx](/home/zhuzy2024/workspace/Fanshi_vidio_clone/frontend/src/pages/MainPage.jsx)

页面当前被组织成：

- 顶部状态栏
- 左列：项目与上传、整片资源分析
- 中列：片段工作台
- 右下角浮动卡片：导出前检查与成片拼接

真正负责状态编排的是这些 hook：

- `useVideoUpload`
  - 上传前校验、上传进度、本地上传状态广播
- `useAnalysis`
  - 整片分析发起、超时后的结果恢复、分析结果 hydrate
- `useSegments`
  - 发起切片、轮询 split 任务、恢复页面刷新后的切片进度
- `useGeneration`
  - 手动片段分析、提示词优化、片段生成、背景资产刷新、拼接与下载
- `useAppHealth`
  - 拉取 `/api/health`，把后端在线状态、数据库状态、Gemini 生图 readiness、Seedance readiness 写入全局 store

前端 API 统一从：

- [api.js](/home/zhuzy2024/workspace/Fanshi_vidio_clone/frontend/src/services/api.js)

实时事件统一从：

- [websocket.js](/home/zhuzy2024/workspace/Fanshi_vidio_clone/frontend/src/services/websocket.js)

### 2.2 后端层

后端采用标准的：

- route
- controller
- service
- model / file / third-party API

当前主路由入口是：

- [routes/index.js](/home/zhuzy2024/workspace/Fanshi_vidio_clone/backend/routes/index.js)

主要服务如下：

- `videoService`
  - 上传、视频记录、元数据、路径处理
- `analysisService`
  - 整片分析、片段分析、提示词优化
- `geminiService`
  - 整片视频理解、片段视频理解、文本 prompt 优化
- `geminiImageService`
  - Gemini 生图调用
- `resourceImageService`
  - 角色三视图 / 场景多角度图的落库和返回
- `segmentService`
  - 时间锚点标准化、FFmpeg 切片、片段初始 analysis hydration
- `ffmpegService`
  - 元数据获取、抽帧、切片、拼接
- `generationService`
  - 单片段视频生成编排
- `seedDanceService`
  - Seedance 请求体组装、建任务、查任务、下载结果
- `backgroundAssetService`
  - 场景背景参考视频资产自动补建与复用
- `taskService`
  - split / merge 这类内存任务的统一管理
- `realtimeService`
  - WebSocket 广播
- `providerHealthService`
  - 统一汇总 Gemini 生图与 Seedance 的 readiness

---

## 3. 当前最重要的数据对象

当前完整链路里最核心的数据和文件对象如下。

### 3.1 数据表

- `projects`
  - 项目容器。上传时如果没指定项目，会自动创建默认项目。
- `videos`
  - 原视频记录，保存文件名、时长、状态、文件路径、URL、大小等。
- `analyses`
  - 整片理解结果。
  - 关键字段包括：
    - `plot`
    - `characters`
    - `backgrounds`
    - `time_anchors`
    - `gemini_response`
- `segments`
  - 切出来的片段记录。
  - 每个片段保存时间区间、文件路径、片段级 `analysis`。
- `generation_tasks`
  - 每次片段生成请求都会创建一条记录。
  - 当前除原 prompt 和结果地址外，还会写入 `meta`：
    - `engine`
    - `isMock`
    - `remoteTaskId`
    - `fallbackReason`
    - `providerError`
- `background_assets`
  - 同一原视频内的场景背景参考视频资产。
  - 唯一性按 `(video_id, background_id)` 控制。
- `resource_image_assets`
  - 角色三视图、场景多角度图等静态资源图。

### 3.2 本地文件目录

当前默认文件都落在：

- `backend/uploads/`

其中主要目录是：

- `videos/`
  - 原视频
- `segments/`
  - FFmpeg 切出来的片段
- `outputs/`
  - Seedance 结果视频和最终合并成片
- `resource-images/`
  - Gemini 生图输出的角色 / 场景资源图

---

## 4. 启动与健康检查链路

### 4.1 环境变量加载

当前后端环境变量由：

- [backend/config/env.js](/home/zhuzy2024/workspace/Fanshi_vidio_clone/backend/config/env.js)

直接按文件相对路径读取 `backend/.env`，已经不再依赖 `process.cwd()`。

这意味着：

- 从仓库根目录启动
- 从 `backend/` 目录启动

都能读到同一份 `backend/.env`。

### 4.2 当前本地启动命令

后端：

```bash
cd backend
npm start
```

前端：

```bash
cd frontend
npm run dev
```

当前本地开发地址：

- 前端：`https://localhost:5173/`
- 后端：`https://localhost:5443/`

### 4.3 健康检查返回什么

当前健康检查接口：

- `GET /api/health`

返回：

- 后端整体状态
- 数据库状态
- `providers.gemini_image`
- `providers.seedance`

当前代码里，provider readiness 由：

- [providerHealthService.js](/home/zhuzy2024/workspace/Fanshi_vidio_clone/backend/services/providerHealthService.js)

统一汇总。

当前健康检查的典型返回语义：

- `gemini_image.ready = true`
  - Gemini 生图可真实调用
- `seedance.ready = false`
  - Seedance 未就绪
- `seedance.reason = 缺少 SEED_DANCE_API_KEY`
  - 真实阻断原因

前端 `useAppHealth` 会把这两组 readiness 写入全局 store，用于：

- 顶部系统状态展示
- 片段生成按钮禁用
- 角色三视图 / 场景图生成按钮禁用
- 错误提醒栏展示

---

## 5. 第一步：上传原视频

### 5.1 前端动作

用户在上传区选择视频后，前端会先在 `useVideoUpload` 里做预校验：

- 扩展名只允许 `mp4 / mov / avi`
- MIME type 必须匹配允许列表
- 文件大小不能超过 `VITE_UPLOAD_LIMIT`
- 如果浏览器能快速读到视频时长，会先做时长上限预检查

通过校验后，前端调用：

- `POST /api/videos/upload`

并通过 Axios `onUploadProgress` 持续更新上传进度。

### 5.2 后端动作

链路：

- `videoController.uploadVideo`
- `videoService.createVideoFromUpload`

后端会做：

1. Multer 把文件写入 `uploads/videos`
2. `ffmpegService.getVideoMetadata()` 提取时长、分辨率、编码信息
3. 校验元数据有效性
4. 校验时长不超过上限
5. 做轻量重复校验
   - 同名且同大小不允许重复上传
6. 文件名按 hash 风格保存，避免重名冲突
7. 自动创建或复用 `project`
8. 创建 `video` 记录，状态为 `uploaded`

### 5.3 结果

上传阶段完成后，系统拿到了：

- 一个已落盘的原视频文件
- 一个可追踪的 `videoId`
- 一个可用于后续分析和切片的元数据对象

---

## 6. 第二步：整片视频理解

### 6.1 前端动作

用户点击整片分析后，`useAnalysis.runAnalysis()` 会：

1. 把当前视频状态改成 `analyzing`
2. 调用 `POST /api/analysis/analyze`
3. 本地先发一条 `analysis:progress`

如果请求超时、网络断开或瞬时失败，但属于可恢复错误，前端不会立刻判死，而是继续调用：

- `GET /api/analysis/:videoId`

去确认后端是否已经把结果落库。

所以即使整片分析前端请求超时，页面也可能在几秒后自动恢复结果。

### 6.2 后端动作

链路：

- `analysisController.analyzeVideo`
- `analysisService.analyzeVideoById`
- `geminiService.analyzeVideo`

执行过程：

1. 读取 `video`
2. 把 `videos.status` 改成 `analyzing`
3. 广播 `analysis:progress`
4. 调用 Gemini 执行整片理解
5. 更新或创建 `analysis`
6. 把 `videos.status` 改成 `analyzed`
7. 再广播一次完成事件

### 6.3 整片分析返回什么

当前整片分析返回的是：

- `plot`
  - 整片剧情概述
- `characters`
  - 角色资源库
  - 每个角色通常包含：
    - `id`
    - `name`
    - `appearancePrompt`
    - `personalityPrompt`
    - `representativeFrameTime`
    - `representativeFrameNote`
- `backgrounds`
  - 场景资源库
  - 每个场景通常包含：
    - `id`
    - `name`
    - `description`
    - `scenePrompt`
    - `representativeFrameTime`
    - `representativeFrameNote`
- `timeAnchors`
  - 后续切片计划
  - 每个时间锚点通常包含：
    - `startTime`
    - `endTime`
    - `sceneSummary`
    - `scenePrompt`
    - `representativeFrameTime`
    - `backgroundId`
    - `backgroundAction`
    - `backgroundName`

### 6.4 重要语义

当前 `timeAnchors` 已经不是单纯“镜头”，而是“适合后续重生成的片段定义”。

语义约束是：

- 场景切换优先作为硬边界
- 同一场景内只有在动作阶段差异明显时才继续细分
- 每段必须绑定一个 `backgroundId`
- 场景首次出现通常是 `create_new`
- 后续再次出现通常是 `reuse_existing`

### 6.5 整片分析失败与回退

整片分析支持回退 mock。

如果 Gemini 没配置，或者真实调用失败且未开启严格模式：

- 后端会返回 mock 分析结果
- 结果里会保留：
  - `is_mock`
  - `fallback_reason`
  - `remote_error`

所以前端能明确显示：

- 真实 Gemini
- Mock 回退

---

## 7. 第三步：按 time anchors 切片

### 7.1 前端动作

用户点击“生成片段”后，`useSegments` 会：

1. 检查当前视频存在
2. 检查 `analysis.time_anchors` 存在
3. 调用 `POST /api/segments/split`
4. 保存返回的 `task_id`
5. 轮询 `GET /api/tasks/:taskId`
6. 同时监听 WebSocket 的 `split:progress`

split 任务 ID 会被写入 `sessionStorage`，因此刷新页面后仍能恢复进度。

### 7.2 后端动作

链路：

- `segmentController.splitVideoByAnchors`
- `segmentService.startSplitVideo`
- `taskService.createTask`
- `segmentService.processSplitTask`

执行过程：

1. 创建一个内存型 split 任务
2. 读取前端显式传入的 `time_anchors`
3. 如果前端没传，则回退到整片分析里的 `timeAnchors`
4. 清空当前视频已有 `segments`
5. 调用 `ffmpegService.splitVideo()` 切片
6. 为每个片段先建立基础 `analysis`
7. 继续做片段级 Gemini 理解
8. 写入 `segments` 表
9. 任务完成后通过 `taskService.completeTask()` 广播完成事件

### 7.3 切片后的基础 analysis

在真正做片段级 AI 理解前，后端会先把这些“整片派生字段”塞入每个片段：

- `sceneSummary`
- `scenePrompt`
- `backgroundId`
- `backgroundAction`
- `backgroundName`
- `backgroundPrompt`
- `representativeFrameTime`
- `representativeFrameNote`
- `scenes`
- `characters`
- `scene`
- `action`
- `prompt`

所以片段不是空白创建，而是“先继承整片分析，再做片段级补齐”。

---

## 8. 第四步：片段级 Gemini 理解

片段理解有两种触发方式：

- 自动触发
  - 切片后在 `processSplitTask()` 里立即执行
- 手动触发
  - 用户在片段卡片点击“快速分析”

### 8.1 前端动作

手动片段分析由 `useGeneration.analyzeSegmentById()` 发起：

- `POST /api/segments/:id/analyze`

成功后，前端会把这些字段写回当前片段卡片：

- `scene`
- `scenes`
- `action`
- `prompt`
- `backgroundId`
- `backgroundAction`
- `backgroundName`
- `backgroundPrompt`
- `representativeFrameTime`
- `representativeFrameNote`

### 8.2 后端动作

链路：

- `segmentController.analyzeSegment`
- `segmentService.analyzeSegmentById`
- `analysisService.analyzeSegmentContent`
- `geminiService.analyzeSegment`

### 8.3 片段分析返回什么

片段分析的目标是返回“可直接编辑、可直接生成”的片段结构：

- `characters`
- `scenes`
- `scene`
- `action`
- `prompt`

其中 prompt 当前约定：

- 人物用 `@角色名`
- 场景用 `#场景名`

这意味着：

- 编辑器里保存的是资源引用形式
- 真正发给视频模型前，后端才会展开成完整设定

---

## 9. 第五步：提示词优化

提示词优化不是自动发生，而是用户主动触发。

### 9.1 前端动作

片段优化由 `useGeneration.optimizeSegmentPrompt()` 发起：

- `POST /api/analysis/optimize-prompt`

资源卡片优化由 `AnalysisDisplay.optimizeResourcePrompt()` 发起，同样走这个接口。

### 9.2 后端动作

链路：

- `analysisController.optimizePromptController`
- `analysisService.optimizePrompt`
- `geminiService.optimizePrompt`

### 9.3 当前支持三种优化模式

- `generation`
  - 优化片段视频生成 prompt
- `character_resource`
  - 优化角色三视图 prompt
- `scene_resource`
  - 优化场景多角度图 prompt

当前行为约束：

- 角色资源优化强调：
  - 外表描述
  - 性格气质
  - 纯白背景
  - 三视图一致性
- 场景资源优化强调：
  - 纯场景
  - 不要人物
  - 空间结构、材质、光线、纵深
- 片段生成优化保留：
  - `@角色名`
  - `#场景名`

---

## 10. 第六步：生成角色三视图 / 场景资源图

这条链路不是主流程自动执行，而是资源库增强链路，通常由用户在资源卡片手动触发。

### 10.1 前端动作

前端调用：

- `POST /api/resource-images/generate`
- `GET /api/resource-images/:videoId`

当前资源区已经支持：

- 显示资源原始帧
- 显示原始 / 优化后的资源 prompt
- 显示单资源的完成数 / 失败数
- 失败时展示错误摘要
- “重试失败项”

### 10.2 后端动作

链路：

- `resourceImageController.generateResourceImages`
- `resourceImageService.generateResourceImageBundle`
- `geminiImageService.generateImageAsset`

### 10.3 生成过程

1. 为每个资源变体建立或复用 `resource_image_assets` 记录
2. 资产状态从 `pending -> processing`
3. 调用 Gemini 生图接口
4. 图片成功后落盘到 `uploads/resource-images`
5. 回写：
  - `asset_path`
  - `asset_url`
  - `mime_type`
  - `provider`
  - `model`
  - `authVariant`
6. 失败时把错误写入：
  - `error_message`
  - `meta.rawError`

### 10.4 当前错误策略

这里不是“整个请求失败即 500”，而是：

- 单个变体失败只会把该变体资产标记为 `failed`
- 整个接口仍返回 `200`
- 返回聚合字段：
  - `completed_count`
  - `failed_count`
  - `partial_success`
  - `error_summary`

错误摘要当前会把一些上游错误翻译成更可读的业务提示：

- `503 + distributor unavailable`
  - `当前 Gemini 生图渠道不可用，请稍后重试或切换可用渠道。`
- `429`
  - `当前 Gemini 生图额度或并发已耗尽，请稍后重试。`
- 图片模型未配置
  - `Gemini 生图服务未配置完成，请先检查后端图片模型密钥和地址。`

### 10.5 它在主流程里的作用

这些静态资源图会被后续片段视频生成优先当作 `reference_image` 输入给 Seedance。

优先级上：

- 角色三视图优先于单张原片代表帧
- 场景资源图优先于只依赖文本场景 prompt

---

## 11. 第七步：生成单个片段

这是当前系统最关键的一段链路。

### 11.1 前端动作

用户点击“生成片段”后，`useGeneration.generateSegmentVideo()` 会：

1. 确认当前视频存在
2. 读取当前片段卡片的最新 prompt
3. 调用 `POST /api/generation/generate`
4. 保存返回的 `task_id`
5. 进入轮询 `GET /api/generation/:taskId`
6. 同时监听 WebSocket `generation:progress`
7. 结束后刷新背景资产状态

前端会持续更新片段卡片的：

- `latestGenerationTask`
- `latestCompletedGenerationTask`
- `generatedUrl`

现在片段卡片还能明确显示：

- `真实 Seedance`
- `Mock 回退`
- `调用失败`

### 11.2 后端动作

链路：

- `generationController.generateSegment`
- `generationService.startGeneration`
- `generationService.processGenerationTask`

### 11.3 生成前的 provider 阻断

这是当前链路和之前最大的一个变化。

在真正创建 `generation_tasks` 之前，后端会先执行：

- `assertSeedDanceReady()`

如果 Seedance 没有配置完成，比如：

- `SEED_DANCE_API_KEY` 为空

则：

- 直接返回 `503`
- 错误文案明确为：
  - `Seedance 未配置完成，无法发起真实片段生成。 缺少 SEED_DANCE_API_KEY`
- 不会创建新的 `generation_tasks`
- 也不会再默认静默回退成 mock

只有当：

- `SEED_DANCE_ALLOW_MOCK_FALLBACK=true`

时，才允许远端失败后转本地 mock-copy。

当前默认值已经改为：

- `false`

### 11.4 后端在生成前会做哪些准备

`processGenerationTask()` 不是拿到 prompt 就直接发 Seedance，而是先做资源整合。

#### 1. 读取上下文

后端会一次性取到：

- 当前 `segment`
- 所属 `video`
- 所属 `analysis`

此时它能同时看到：

- 整片角色资源库
- 整片场景资源库
- 当前片段绑定的 `backgroundId/backgroundAction`
- 当前片段 prompt

#### 2. 确定当前片段绑定的场景

`getBackgroundBindingForSegment()` 会统一解析：

- `backgroundId`
- `backgroundAction`
- `backgroundName`
- `backgroundPrompt`
- `sceneSummary`
- `representativeFrameTime`

这一步确保：

- 片段一定知道自己属于哪个场景
- 片段生成不会脱离整片分析阶段的场景决策

#### 3. 自动准备背景资产

如果当前片段绑定了 `backgroundId`，后端会先调用：

- `backgroundAssetService.ensureBackgroundAsset()`

规则是：

- 如果该 `videoId + backgroundId` 已有 `completed` 资产，直接复用
- 如果没有，就先自动生成一个背景参考视频

这个背景资产本身也是通过 Seedance 生成的，只不过 prompt 是“纯背景参考视频 prompt”，强调：

- 只保留环境、空间结构、布光、景深、氛围
- 不出现主体角色或明显人物正脸
- 用作后续片段生成的场景一致性参考

#### 4. 展开 prompt 中的资源引用

当前片段 prompt 通常是引用形式：

- `@角色名`
- `#场景名`

真正发给视频模型前，后端会调用 `expandPromptMentions()`：

- `@角色名`
  - 展开为角色真实设定
  - 通常包含 `appearancePrompt + personalityPrompt`
- `#场景名`
  - 展开为该场景的真实 `scenePrompt`

也就是说：

- 前端编辑器保存的是“引用形式”
- 发给视频模型的是“展开后的最终 prompt”

#### 5. 收集 `reference_image`

后端会收集参考图：

- 先找当前片段涉及的角色
- 如果这些角色已有 `resource_image_assets` 完成图，优先使用这些图
- 如果没有，回退到原视频代表帧抽帧
- 同时把当前场景对应的完成场景图也补进来

最终角色图 + 场景图合并后最多取 9 张。

#### 6. 收集 `reference_video`

发给 Seedance 的参考视频不止一个来源：

- 原始片段视频
  - 基础参考视频
- 背景资产视频
  - 如果当前场景已有背景资产，则额外追加一个 `reference_video`

这就是当前系统“场景一致性复用”的核心实现方式。

#### 7. 计算输出时长

当前代码会基于：

- `segment.startTime`
- `segment.endTime`

动态计算时长，然后约束为：

- 四舍五入到整数秒
- 最少 4 秒
- 最多 15 秒

这是为了适配当前 Seedance 2.0 的时长约束。

### 11.5 Seedance 请求过程

真正的视频生成由：

- [seedDanceService.js](/home/zhuzy2024/workspace/Fanshi_vidio_clone/backend/services/seedDanceService.js)

执行。

过程是：

1. 组装 `content` 数组
2. 其中可包含：
  - `text`
  - `image_url`
  - `video_url`
  - `audio_url`
3. 请求：
  - `POST /api/v3/contents/generations/tasks`
4. 解析 `task_id`
5. 轮询：
  - `GET /api/v3/contents/generations/tasks/{taskId}`
6. 当状态变成 `succeeded / completed / success`
7. 读取远端返回的 `video_url`
8. 把远端视频下载到本地 `uploads/outputs`

### 11.6 生成完成后写回什么

成功时会更新：

- `generation_tasks.status = completed`
- `generation_tasks.progress = 100`
- `generation_tasks.result_url = /uploads/outputs/...`
- `generation_tasks.meta.engine = seed-dance-remote`
- `generation_tasks.meta.isMock = false`
- `generation_tasks.meta.remoteTaskId = ...`

失败时会更新：

- `generation_tasks.status = failed`
- `generation_tasks.error_message`
- `generation_tasks.meta.providerError`

如果启用了 `SEED_DANCE_ALLOW_MOCK_FALLBACK=true` 且发生远端失败，则：

- `engine = mock-copy`
- `isMock = true`
- `fallbackReason = missing_remote_config` 或 `remote_generation_failed`

### 11.7 当前真实运行状态

截至当前本地验证：

- `gemini_image.ready = true`
- `seedance.ready = false`
- 原因是：
  - `backend/.env` 里的 `SEED_DANCE_API_KEY` 为空

因此现在点击“生成片段”时，真实接口会直接返回：

```json
{
  "success": false,
  "message": "Seedance 未配置完成，无法发起真实片段生成。 缺少 SEED_DANCE_API_KEY"
}
```

这正是当前代码的预期行为。

---

## 12. 第八步：成片拼接与导出

### 12.1 前端动作

用户点击成片拼接后，`useGeneration.startMerge()` 会：

1. 调用 `POST /api/merge/start`
2. 记录 merge `task_id`
3. 同时监听：
  - `merge:progress` WebSocket
  - `GET /api/merge/:taskId/progress` 轮询
4. 完成后再调用：
  - `GET /api/merge/:taskId/download`

merge 任务 ID 同样会写入 `sessionStorage`，因此刷新页面后仍能恢复拼接进度。

### 12.2 后端动作

链路：

- `mergeController.startMergeTask`
- `mergeService.startMerge`
- `mergeService.processMergeTask`

### 12.3 合并规则

后端会先按 `segmentIndex` 排序拿到所有片段，然后：

- 如果某片段存在最近一次成功生成结果，优先使用该结果
- 否则回退原始片段文件

因此 merge 的素材选择规则是：

- 优先最新成功生成
- 没有成功生成再用原片

这个规则与前端片段卡片当前展示的 `generatedUrl` 保持一致。

### 12.4 最终产物

FFmpeg merge 完成后，结果落到：

- `uploads/outputs/video-{videoId}-merged.mp4`

前端随后下载该结果。

---

## 13. 两条重要支线

### 13.1 背景资产自动补建

这条链路不是用户单独点击触发，而是在“片段生成前”自动命中：

1. 当前片段存在 `backgroundId`
2. `generationService` 调用 `ensureBackgroundAsset()`
3. 如果该 `videoId + backgroundId` 没有完成资产，则先生成背景参考视频
4. 生成完成后再继续主片段生成

因此：

- 同一场景首次出现时，系统会自动补建背景资产
- 后续同 `backgroundId` 片段会复用该资产

### 13.2 角色 / 场景静态资源库

角色三视图、场景多角度图通过 `resource_image_assets` 落库，属于“静态资源增强层”。

它们的作用不是替代视频生成，而是提升视频生成的参考质量：

- 角色图增强人物一致性
- 场景图增强空间结构一致性

在片段生成阶段，这些图会优先作为 `reference_image` 输入给 Seedance。

---

## 14. 前端状态同步与恢复机制

### 14.1 WebSocket 负责即时更新

后端会广播这些事件：

- `analysis:progress`
- `split:progress`
- `generation:progress`
- `merge:progress`

前端统一通过 `websocketService.subscribe()` 接收。

### 14.2 轮询负责兜底

即使 WebSocket 不可用，主流程也不会断：

- 整片分析
  - `GET /api/analysis/:videoId`
- split
  - `GET /api/tasks/:taskId`
- generation
  - `GET /api/generation/:taskId`
- merge
  - `GET /api/merge/:taskId/progress`

### 14.3 sessionStorage 负责刷新恢复

当前前端会把这些上下文写入 sessionStorage：

- 当前视频 ID
- split 任务 ID
- merge 任务 ID

所以刷新页面后仍然可以：

- 恢复当前视频
- 拉取既有分析结果
- 恢复 split / merge 进度

### 14.4 视频上下文隔离

所有实时事件和轮询结果都做了“当前视频上下文过滤”：

- 旧视频的事件不会污染当前页面
- 切换视频后，旧分析、旧片段、旧任务会被清空

这也是为什么多视频切换时不会串线。

---

## 15. 当前已经接入的 AI 能力

### 15.1 Gemini 文本 / 多模态

用于：

- 整片分析
- 片段分析
- 文本 prompt 优化

### 15.2 Gemini 生图

用于：

- 角色三视图
- 场景多角度资源图

当前这条链路是“真实调用”。

### 15.3 Seedance

用于：

- 主片段视频生成
- 背景资产参考视频生成

当前代码已经完成真实接入，但由于本地 `.env` 未填 `SEED_DANCE_API_KEY`，当前运行状态是：

- 健康检查明确报告未就绪
- 片段生成直接阻断
- 不再静默 mock

---

## 16. 当前主流程接口总表

### 视频与分析

- `POST /api/videos/upload`
- `GET /api/videos/:id`
- `DELETE /api/videos/:id`
- `POST /api/analysis/analyze`
- `GET /api/analysis/:videoId`
- `POST /api/analysis/optimize-prompt`

### 资源

- `GET /api/background-assets/:videoId`
- `GET /api/resource-images/:videoId`
- `POST /api/resource-images/generate`

### 片段

- `POST /api/segments/split`
- `GET /api/segments/:videoId`
- `POST /api/segments/:id/analyze`
- `GET /api/tasks/:taskId`

### 生成与导出

- `POST /api/generation/generate`
- `GET /api/generation/:taskId`
- `POST /api/merge/start`
- `GET /api/merge/:taskId/progress`
- `GET /api/merge/:taskId/download`

### 系统

- `GET /api/health`
- `GET /api/health/database`
- `GET /api/metrics`
- `POST /api/monitoring/events`

---

## 17. 一条完整 happy path 的顺序

一条典型成功链路是：

1. 用户上传 `demo.mp4`
2. 后端创建 `project`
3. 后端创建 `video`
4. 用户点击整片分析
5. Gemini 返回：
   - 剧情
   - 角色资源
   - 场景资源库
   - 片段切分预案
6. 用户点击生成片段
7. 后端按 `timeAnchors` 切出多个 `segment`
8. 每个 `segment` 自动补齐片段分析 prompt
9. 用户可选：
   - 再做片段分析
   - 优化 prompt
   - 生成角色三视图
   - 生成场景资源图
10. 用户点击某个片段的“生成片段”
11. 后端：
   - 校验 Seedance readiness
   - 自动准备背景资产
   - 展开 `@角色名 / #场景名`
   - 汇总角色图 / 场景图 / 背景视频 / 原片段视频
   - 调用 Seedance
12. Seedance 成功后，结果下载到 `uploads/outputs`
13. 前端卡片显示新片段
14. 用户点击拼接
15. 后端优先用最新成功生成结果，否则用原片段合并
16. FFmpeg 输出最终成片
17. 前端下载最终视频

---

## 18. 当前最关键的实现约定

### 18.1 编辑态 prompt 与生成态 prompt 不同

编辑器里看到的是：

- `@角色名`
- `#场景名`

真正发给视频模型前，后端会展开成完整设定。

### 18.2 `representativeFrameTime` 的真值是整片绝对秒数

整片分析里人物、场景、片段的典型帧时间都是：

- 相对于整条原视频的绝对秒数

片段工作台展示局部典型帧时，需要前端自行换算成片段局部时间。

### 18.3 片段生成不是只依赖文本 prompt

当前 Seedance 生成会尽量吃到：

- 角色三视图
- 场景资源图
- 原片段视频
- 背景资产视频

所以它是“文本 + 多资源参考”的生成链路。

### 18.4 merge 永远优先最近一次成功生成结果

只要某个片段存在成功生成结果，merge 就优先使用它，而不是原片。

### 18.5 Seedance 现在默认是“缺配置即阻断”

当前最关键的业务约定是：

- 不再默认伪成功
- 不再默认静默 mock
- 缺配置时直接清晰报错

---

## 19. 当前已落地的降级与容错

### 整片分析

- Gemini 未配置或远端失败
  - 可回退 mock 分析
- 分析请求超时
  - 前端不会立刻放弃，而是继续查询落库结果

### 资源图生成

- 单个变体失败
  - 不会把整组请求打成 500
- 前端仍可看见成功项
- 失败项可单独重试

### 片段生成

- Seedance 未配置
  - 当前默认直接阻断
- 远端失败
  - 只有显式开启 `SEED_DANCE_ALLOW_MOCK_FALLBACK=true` 时才允许 mock-copy

### WebSocket

- 断开后自动退回轮询

### split / merge

- 使用 `taskService` + 查询接口做兜底恢复

### 页面刷新

- 当前视频与 split / merge 任务可从 sessionStorage 恢复

---

## 20. 当前文档结论

当前项目已经不是“上传视频然后简单调一个模型”，而是一个完整的 AI 视频生产工作台，具备这些能力层：

- 原视频接入层
- 整片理解层
- 片段切分与片段理解层
- 角色 / 场景静态资源层
- 场景背景资产视频层
- 多参考视频生成层
- 拼接导出层
- 健康检查、任务恢复、上下文隔离层

如果要让整条链路进入“真实视频生成”状态，目前唯一缺的不是代码，而是：

- 在 `backend/.env` 中填入可用的 `SEED_DANCE_API_KEY`

填上之后，当前代码就会从“明确阻断”切换到真实 Seedance 任务生成模式。
