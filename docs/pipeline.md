# Pipeline

更新时间：2026-04-22

这份文档只写当前仓库里真实存在、并且这次已经重新联调过的流水线。

本轮联调重点覆盖了：

- 上传原视频
- 整片理解
- 大片段与小镜头切分
- 小镜头源预览与典型帧
- 背景资产自动生成
- Seedance 小镜头生成
- 成片拼接与下载

## 1. 最新实测结论

这次已经确认通过的真实链路：

- 视频上传可以正常完成，重复上传拦截和 hash 文件名落盘正常
- Gemini 整片理解可以返回真实结果，不再只会掉回 mock
- 大片段切分和小镜头切分都能落盘
- 每个小镜头的源视频和典型帧都能生成并返回前端
- 背景资产自动生成已经真实完成过
- Seedance 小镜头生成已经真实完成过 2 个小镜头
- 完成后下载到本地的视频已经按原镜头时长裁回，实测 `1.000000s`
- 后端重启后，已提交到远端的 Seedance 任务可以自动恢复轮询并补写完成结果
- 成片拼接和下载链路之前已跑通，仍保持可用

这次确认并修掉的问题：

- 小镜头典型帧丢失时的自愈判断不完整，导致部分帧 404
- Seedance 对参考视频的像素总数门槛没有过滤，导致远端拒收
- Seedance 对过短生成时长有限制，现已自动向上兼容并在下载后裁回原时长
- 弹窗里“生成当前镜头 / 一键生成全部镜头”会无差别先保存，导致已完成镜头被误判旧
- `shotAssemblyInvalidatedAt` 带毫秒，但数据库任务时间只有秒级，刷新后会把同秒新任务误过滤掉
- 后端重启会打断本地内存轮询，导致远端已完成但本地任务仍卡在 `processing`
- Seedance 会因为输入真人帧图或敏感参考图，直接拒绝创建镜头任务并返回 `InputImageSensitiveContentDetected`
- 当前大片段已经有预览视频后，再次点击“生成新片段”仍会重复给全部小镜头下单
- 旧的小镜头成功结果没有被带进新一轮批处理上下文，导致拼回阶段可能看不到旧成功结果

当前仍要实事求是说明的部分：

- Gemini 生图链路已经接通，但上游仍经常返回 `429`，所以角色三视图 / 场景图目前是“链路可用，但受上游额度和并发影响”
- Seedance 长任务耗时较长，单镜头真实完成已经验证，批量全部镜头自动拼回还需要继续复测完整成功态

## 2. 实际流水线

### 2.1 上传原视频

- 前端入口：`原视频上传区`
- 后端接口：`POST /api/videos/upload`
- 后端服务：`videoService.createVideoFromUpload`

关键动作：

- 校验格式、体积和重复上传
- 用 `ffprobe` 读取时长和分辨率
- 以 hash 文件名保存到 `backend/uploads/videos`
- 写入 `videos`

### 2.2 整片理解

- 前端入口：`开始分析 / 重新分析`
- 后端接口：`POST /api/analysis/analyze`
- 后端服务：`analysisService.analyzeVideoById`
- AI 服务：Gemini 文本模型

当前主要返回：

- `plot`
- `characters`
- `backgrounds`
- `time_anchors`
- `time_anchors[*].shots`

当前规则：

- 小镜头真值来自整片理解，不再由片段分析二次重写
- 大片段时间和小镜头时间都用整片绝对秒数
- Gemini 主模型失败时会继续尝试备用文本模型，不会立刻掉回 mock

### 2.3 大片段切分

- 前端入口：`生成片段`
- 后端接口：`POST /api/segments/split`
- 后端服务：`segmentService.startSplitVideo`

关键动作：

- 按 `time_anchors` 切出大片段
- 把 `time_anchors[*].shots` 写进 `segment.analysis.shots`
- 给每个小镜头切出独立源视频
- 给每个小镜头抽独立典型帧

落盘目录：

- 大片段：`backend/uploads/segments`
- 小镜头源视频：`backend/uploads/shots`
- 小镜头典型帧：`backend/uploads/frames`

### 2.4 资源库与片段工位初始化

- 片段接口：`GET /api/segments/:videoId`
- 背景资产接口：`GET /api/background-assets/:videoId`
- 资源图接口：`GET /api/resource-images/:videoId`

前端会展示：

- 角色资源卡
- 场景资源卡
- 大片段卡
- 小镜头源预览
- 小镜头典型帧
- 当前最终提示词

### 2.5 角色三视图 / 场景资源图

- 前端接口：`POST /api/resource-images/generate`
- 后端服务：
  - `resourceImageService.generateResourceImageBundle`
  - `geminiImageService.generateImageAsset`

当前实现：

- 角色生成 `正面 / 侧面 / 背面`
- 场景生成 `正视广角 / 45 度斜侧 / 高位俯视`
- 结果写入 `resource_image_assets`
- 图片落盘到 `backend/uploads/resource-images`

当前状态：

- 接口和落库链路已经接通
- 真实调用时仍可能被上游 `429` 限流

### 2.6 背景资产自动生成

- 手动接口：`GET /api/background-assets/:videoId`
- 自动服务：`backgroundAssetService.ensureBackgroundAsset`

当前规则：

- 同一个视频里的同一个 `background_id` 只保留一份背景参考视频
- 小镜头生成前如果命中了场景但还没有背景资产，会先补建
- 背景资产会被当作 Seedance 的额外 `reference_video`

### 2.7 小镜头生成

- 单镜头接口：`POST /api/generation/shots/generate`
- 批量接口：`POST /api/generation/shots/generate-batch`
- 状态接口：`GET /api/generation/shots/:taskId`

生成时会优先准备：

1. 小镜头源视频
2. 小镜头典型帧
3. 角色三视图
4. 场景资源图
5. 背景资产视频

然后再把：

- `@角色`
- `#场景`

替换成真实资源提示词，组装成最终 Seedance 提示词。

Seedance 这轮已经确认的兼容规则：

- 参考视频时长必须足够长
- 参考视频最小边长要满足要求
- 参考视频总像素数必须 `>= 409600`
- 如果原镜头比 Seedance 最小可生成为时长更短，会先按 provider 最小时长生成，再本地裁回原时长
- 如果 `reference_image` 被 Seedance 判定为真人或敏感输入，后端会自动做两级降级：
- 第一级：先去掉从原视频抽出来的帧图，再重试创建远端任务
- 第二级：如果还被拒绝，再去掉全部 `reference_image`，只保留 prompt 和 `reference_video`
- 这条降级已经真实验证过：之前会直接失败的人像镜头，现在能继续创建远端任务并进入 `running`
- 真正发给 Seedance 的最终重建提示词里，已经统一补上“不要任何字幕、文字、水印、Logo、UI 浮层”

### 2.8 长任务恢复与续跑

- 启动入口：`backend/app.js`
- 恢复服务：`taskRecoveryService.recoverInFlightTasks`

现在服务启动后会自动扫描：

- 仍处于 `pending / processing` 的大片段生成任务
- 仍处于 `pending / processing` 的小镜头生成任务
- 仍处于 `pendingAssembly` 的大片段镜头拼回状态

恢复规则：

- 如果任务 `meta.remoteTaskId` 已存在，不会重复创建新的 Seedance 远端任务
- 系统会继续轮询原来的远端任务，成功后下载结果、按目标镜头时长裁剪，并回写数据库
- 如果已经满足小镜头全部完成条件，会继续尝试自动拼回大片段

这一步已经真实验证过：

- 一个卡在 `processing 94%` 的小镜头任务，在后端重启后已自动恢复并转成 `completed`

### 2.9 片段复用与防重复生成

当前规则：

- 单独生成小镜头时，如果这个镜头已经有同提示词、同比例、同时长的成功结果，会直接复用旧任务，不再新建任务
- 批量“生成新片段”时，如果当前大片段已经有最新拼回预览，而且当前镜头提示词与比例都没变，会直接返回已有大片段结果
- 如果当前只有旧的小镜头成功结果，但还没有新的大片段预览，系统会先把这些旧镜头结果复制进本轮批处理上下文，再立即执行拼回

这轮真实复测已经确认：

- 对一个已经有成品预览的大片段再次点“生成新片段”，数据库里的 `shot_generation_tasks` 数量不再增加
- 对一个只有旧小镜头结果、但拼回状态还挂着的大片段再次点“生成新片段”，系统会复用旧镜头结果并成功产出新的大片段预览

### 2.10 大片段拼回

- 服务：`shotGenerationService.attemptPendingShotAssembly`

规则：

- 全部小镜头成功后，按顺序拼回一个新的大片段视频
- 拼回结果会补写成大片段主结果
- 后续整片 merge 直接复用这个大片段主结果

### 2.11 成片拼接与下载

- 前端入口：右下角 `Export Dock`
- 后端接口：
  - `POST /api/merge/start`
  - `GET /api/merge/:taskId/progress`
  - `GET /api/merge/:taskId/download`

当前导出规则：

- 有新生成大片段就优先用新结果
- 没有新结果时回退原始大片段
- 不让某一个片段未生成就把整条导出链路卡死

## 3. 提示词顺序

这里按当前真实执行顺序写，不写理想顺序。

### 3.1 整片理解提示词

来源：

- `backend/services/geminiService.js`
- `buildVideoAnalysisPrompt`

作用：

- 识别整片剧情
- 提取角色和场景资源
- 产出大剧情片段
- 产出每个大片段下面的小镜头

输出重点：

- `characters`
- `backgrounds`
- `time_anchors`
- `time_anchors[*].shots`

### 3.2 片段理解提示词

来源：

- `buildSegmentAnalysisPrompt`

作用：

- 补充单个大片段的场景解释、动作摘要和片段级 prompt

说明：

- 这一步不会重写 `shots`
- 小镜头真值仍然来自整片理解

### 3.3 大片段提示词优化

来源：

- `POST /api/analysis/optimize-prompt`
- `mode = generation`

作用：

- 优化大片段最终提示词

### 3.4 小镜头提示词优化

来源：

- `POST /api/analysis/optimize-prompt`
- `mode = shot_generation`

作用：

- 结合大片段 prompt、当前小镜头 prompt、角色资源、场景资源，优化单镜头提示词

### 3.5 角色资源 / 场景资源提示词优化

来源：

- `mode = character_resource`
- `mode = scene_resource`

作用：

- 优化资源级提示词，给 Gemini 生图使用

### 3.6 生成前提示词展开

来源：

- `expandPromptMentions`
- `buildSeedDanceReconstructionPrompt`

作用：

- 把 `@角色` 替换成角色真实资源提示词
- 把 `#场景` 替换成场景真实资源提示词
- 再补上镜头复原、构图、动作连续性要求

### 3.7 Gemini 生图提示词

来源：

- `buildCharacterViewPrompts`
- `buildSceneAnglePrompts`

作用：

- 角色：生成纯白背景三视图
- 场景：生成三张不同角度的背景图

## 4. 功能列表

### 4.1 已完成

- 视频上传、去重、hash 文件名落盘
- 整片理解真实 Gemini 调用
- Gemini 文本模型降级回退链
- 大片段切分
- 小镜头定义透传
- 小镜头源视频切片
- 小镜头典型帧抽取
- 小镜头缺失资产自愈重建
- 背景资产自动生成与查询
- 小镜头单任务创建、轮询、进度显示
- 后端启动恢复在途 Seedance 任务
- 已有远端任务 ID 时续跑而不是重复下单
- Seedance 输入图片敏感审核失败后的自动降级重试
- 已有镜头结果和大片段预览时的防重复生成
- Seedance 短时长生成后本地裁回原时长
- 片段工作台、镜头编辑弹窗、导出面板
- 角色/场景资源卡与资源编辑弹窗
- 成片拼接与下载

### 4.2 已接通但不稳定

- 角色三视图生成
- 场景资源图生成
- Seedance 长时任务耗时和排队

原因主要不是本地代码崩溃，而是：

- 上游 Gemini 生图 `429`
- 上游 Seedance 长任务等待时间较长

### 4.3 仍待继续复测

- 一键生成全部小镜头后全部成功并自动拼回大片段
- 基于多个已生成大片段再次执行整片 merge 的长链路稳定性
- 场景资源图在连续重试下的稳定成功率

## 5. 当前实现约定

### 5.1 小镜头真值

- 真值来源：`analysis.time_anchors[*].shots`
- 不是片段分析再切一次

### 5.2 时间语义

以下都默认是整片绝对秒数：

- `timeAnchor.startTime/endTime`
- `shot.startTime/endTime`
- `representativeFrameTime`

### 5.3 什么时候必须保存镜头

当前规则已经调整成更稳妥的版本：

- 新增镜头、改起止时间、改典型帧时间，这些属于“镜头结构改动”，生成前会先保存并重建小镜头资产
- 只改提示词时，不再强制先重建小镜头资产，避免把已完成镜头误判旧
- 如果只是继续生成当前编辑器里的 prompt，会直接按当前 prompt 发起任务

### 5.4 同秒任务过滤规则

数据库任务时间是秒级，失效时间原来带毫秒，会误伤同一秒内新建任务。

现在规则是：

- 失效比较统一按秒级边界处理
- 刷新页面时，同秒新建的小镜头任务不会再被误过滤

### 5.5 服务重启后的恢复规则

现在规则是：

- 生成任务如果已经拿到 `remoteTaskId`，服务重启后继续追原任务
- 不会因为本地重启就重复创建第二个远端视频任务
- 已进入待拼回状态的大片段，服务启动后会继续检查是否可以自动拼回

### 5.6 当前防重复生成规则

现在规则是：

- 同提示词、同比例、同时长的小镜头成功结果可以直接复用
- 已经有最新大片段预览时，再点“生成新片段”不会重复新建镜头任务
- 旧小镜头成功结果会被复制进新一轮批处理上下文，保证拼回阶段能看见它们

## 6. 一句话总结

项目现在已经进入“主流程可真实联调”的阶段：

- 上传、分析、切分、预览、背景资产、单镜头真实生成、导出都已经能走通
- 资源生图和批量镜头拼回仍受外部模型稳定性影响，还需要继续压测和复测
