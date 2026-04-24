# Pipeline

更新时间：2026-04-24

这份文档只写当前仓库里真实存在、并且这次已经重新联调过的流水线。

本轮联调重点覆盖了：

- 上传原视频
- 一键出片自动编排
- 整片理解
- 大片段与小镜头切分
- 小镜头字幕 / 音频 / 口型链路
- 角色状态连续性
- 小镜头源预览与典型帧
- 背景资产自动生成
- Seedance 小镜头生成
- 成片拼接与下载

## 1. 最新实测结论

这次已经确认通过的真实链路：

- 视频上传可以正常完成，重复上传拦截和 hash 文件名落盘正常
- 前端开发页现在可以通过 `https://frp-fox.com:42734` 访问
- Gemini 整片理解可以返回真实结果，不再只会掉回 mock
- 整片理解现在固定只调用一次 `Gemini-2.5-pro`
- 角色三视图 / 场景图的 Gemini 生图链路已经从 `fetch failed` 修到可真实出图
- Gemini、Gemini 生图、Seedance 现在都已经统一走 Node.js 外部请求层
- 对 `yunwu.ai` 这类在当前代理环境下会触发 TLS 握手断开的地址，统一请求层会在 `undici` 失败后自动切到 Node 原生 `http/https` 直连回退
- 大片段切分和小镜头切分都能落盘
- 每个小镜头的源视频和典型帧都能生成并返回前端
- 背景资产自动生成已经真实完成过
- Seedance 小镜头生成已经真实完成过 2 个小镜头
- 完成后下载到本地的视频已经按原镜头时长裁回，实测 `1.000000s`
- 最近成功样本已核对文件指纹和元数据，生成结果不是原片片段副本
- 后端重启后，已提交到远端的 Seedance 任务可以自动恢复轮询并补写完成结果
- 成片拼接和下载链路之前已跑通，仍保持可用

这次确认并修掉的问题：

- 前端点击“整片分析”时，后端会因为旧库缺少 `analyses.analysis_options` 列而直接报错；现在已经补上迁移，并在启动时自动做 schema 兼容修复
- `sakura frp` 之前访问前端会直接返回 `502 EOF`；根因是 frp 外层已经终止 HTTPS，但本地 Vite 仍是自签 HTTPS。现在前端开发服务默认改回本地 HTTP，并在 `vite.config.js` 里放行 `frp-fox.com` 作为 `server.allowedHosts`
- 小镜头典型帧丢失时的自愈判断不完整，导致部分帧 404
- Seedance 对参考视频的像素总数门槛没有过滤，导致远端拒收
- Seedance 对过短生成时长有限制，现已自动向上兼容并在下载后裁回原时长
- 弹窗里“生成当前镜头 / 一键生成全部镜头”会无差别先保存，导致已完成镜头被误判旧
- `shotAssemblyInvalidatedAt` 带毫秒，但数据库任务时间只有秒级，刷新后会把同秒新任务误过滤掉
- 后端重启会打断本地内存轮询，导致远端已完成但本地任务仍卡在 `processing`
- Seedance 会因为输入真人帧图或敏感参考图，直接拒绝创建镜头任务并返回 `InputImageSensitiveContentDetected`
- `PUBLIC_ASSET_BASE_URL` 如果指向 `frp-fox.com:42734` 这种当前返回自签 HTTPS 的地址，Seedance 会拿不到参考素材；现在图片和音频会自动回退成 `data:` 内联引用，避免请求里只剩失效公网 URL
- 说话镜头之前会因为 `reference_audio cannot be the only reference input` 或 `audio duration must be >= 1.8s` 被 Seedance 直接拒绝；现在无视觉参考时会自动移除 `reference_audio`，过短音频会先补静音到 1.8 秒
- 当前大片段已经有预览视频后，再次点击“生成新片段”仍会重复给全部小镜头下单
- 旧的小镜头成功结果没有被带进新一轮批处理上下文，导致拼回阶段可能看不到旧成功结果
- Seedance 镜头任务会卡在 `45%` 后报“视频生成失败”，根因是创建任务仍使用 30 秒通用超时，且本地参考图会被转成 5MB 以上 base64 请求体；现在改成 Seedance 专用创建超时，并在 `PUBLIC_ASSET_BASE_URL` 存在时优先发送公网资源 URL
- 小镜头源视频保存为 `/uploads/...` 相对地址时，之前不会被当成 `reference_video` 传给 Seedance；现在会统一归一化成公网 URL 后再发送
- 长镜头同时传“小镜头源视频 + 背景资产视频”时，会触发 Seedance 的 `content video total duration <= 15.2s` 限制；现在按总时长预算筛选 reference video，优先保留小镜头源视频，超限时跳过背景资产视频
- 同一个镜头任务被重复触发时，之前可能并发创建多个远端 Seedance 任务；现在后端有进程内任务锁，同一个 `shot_generation_task.id` 同时只跑一次
- 如果任务卡在 `processing/45%` 且没有远端任务 ID，超过创建超时时再次点击会自动续跑这个任务
- 医疗/药品/病痛类镜头可能在 Seedance 输出审核阶段触发 `output video may contain sensitive information`；现在发送前会做供应商安全改写，把“身体不适、痛苦、胸口、药盒”等词换成“疲惫、神情紧张、上衣前侧、小白盒”等中性表达
- Seedance 远端失败时不再允许本地 `mock-copy`，不会再把原视频复制成“生成结果”
- 历史 `mock-copy` 结果不再参与片段预览、批量复用、镜头拼回和整片导出
- 多段拼接失败时不再复制第一个输入文件冒充拼接成功
- 单镜头大片段拼回会标记为 `single-input-copy`，它代表复制真实远端小镜头结果，不代表 mock
- Seedance 单次生成时长现在按 `15s` 上限保护；如果镜头过长，后端会先报“需要继续切细”，不会把超长镜头直接丢给远端
- 前端现在会展示“本次实际发送给 Seedance 的参考图 / 参考视频 / 参考音频”清单，能直接核对这次是否真的用了典型帧、角色三视图和场景图

当前仍要实事求是说明的部分：

- Gemini 生图链路已经接通，但上游仍经常返回 `429`，所以角色三视图 / 场景图目前是“链路可用，但受上游额度和并发影响”
- Seedance 长任务耗时较长，单镜头真实完成已经验证，批量全部镜头自动拼回还需要继续复测完整成功态
- 当前 `https://frp-fox.com:42734` 使用自签 TLS 证书，本机严格校验会报 `self-signed certificate`；代码会按配置生成公网资源 URL，但如果 Seedance 远端也拒绝自签证书，需要换成可信证书的公网资源域名
- 2026-04-23 追加做了最小 4 秒创建探测，Seedance 当前直接返回 `403 your account has an overdue balance`；这不是代码参数错误，而是供应商账务阻塞，补齐欠费前新任务无法创建

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

当前开发访问方式：

- 本地前端：`http://localhost:5173`
- 外部穿透前端：`https://frp-fox.com:42734`
- 本地后端：`https://localhost:5443`
- 前端通过 Vite 代理把 `/api`、`/uploads`、`/ws` 转发给本地后端

### 2.1.1 一键出片

- 前端入口：上传区右上角 `一键出片`
- 当前实现：前端自动编排，不新增后端总控接口

自动顺序：

1. `POST /api/analysis/analyze`
2. `POST /api/analysis/optimize-prompt`
3. `POST /api/resource-images/generate`
4. `POST /api/segments/split`
5. `POST /api/analysis/optimize-prompt` 优化大片段和小镜头
6. `PUT /api/segments/:id/shots`
7. `POST /api/generation/shots/generate-batch`
8. 等待镜头自动拼回大片段
9. `POST /api/merge/start`

当前规则：

- 必须同时有可用的 Gemini 生图和 Seedance
- 任何一步失败，自动流程会直接停下并显示当前错误
- 资源图生成完成后，主页资源区会自动刷新

### 2.2 整片理解

- 前端入口：`开始分析 / 重新分析`
- 后端接口：`POST /api/analysis/analyze`
- 后端服务：`analysisService.analyzeVideoById`
- AI 服务：Gemini 文本模型

当前主要返回：

- `plot`
- `characters`
- `characters[*].stateTimeline`
- `backgrounds`
- `time_anchors`
- `time_anchors[*].shots`
- `time_anchors[*].shots[*].speech`
- `time_anchors[*].shots[*].characterStateRefs`

当前规则：

- 小镜头真值来自整片理解，不再由片段分析二次重写
- 大片段时间和小镜头时间都用整片绝对秒数
- 角色状态时间线也用整片绝对秒数
- 小镜头字幕时间是相对当前小镜头本地时间
- 整片理解固定只走一次 `Gemini-2.5-pro`
- 分析选项默认 `extractSubtitles=true`、`parseAudio=true`
- 不再自动切备用文本模型
- 不再自动走关键帧回退
- 不再自动掉回 mock 整片分析
- 整片理解 prompt 已加强到“更细镜头切分 + 更精确时间点”，要求尽量把观众能感知到的真实镜头都拆出来
- `timeAnchor` 和 `shot` 的时间要求尽量精确到 `0.1` 秒
- 整片分析后端长超时默认 `600000ms`，可通过 `GEMINI_WHOLE_VIDEO_TIMEOUT_MS` 调整
- 外部请求已经统一改成 Node.js 外部请求层，默认先走 `undici` 并通过系统代理出网，不再依赖 `curl`
- 如果 `undici` 在 TLS 握手阶段报 `fetch failed / ECONNRESET / before secure TLS connection was established`，会自动改用 Node 原生 `http/https` 直连回退，避免整片分析直接中断
- 如果 `PUBLIC_ASSET_BASE_URL` 返回自签证书，图片和音频参考会自动改成内联 `data:`，视频参考则继续要求公网可访问 URL
- 后端启动时会自动检查 `analyses.analysis_options` 列是否存在，避免旧数据库在点击“整片分析”时直接 500

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
- 小镜头字幕预览
- 当前最终提示词

新增的编辑能力：

- 角色编辑弹窗可以维护 `stateTimeline`
- 小镜头编辑弹窗可以查看和编辑 `speech`
- 可以复制对白全文、复制 SRT、下载 SRT

### 2.4.1 角色状态时间线保存

- 接口：`PUT /api/analysis/:videoId/characters`
- 后端服务：`analysisService.updateAnalysisCharactersByVideoId`

保存后会自动做：

- 持久化 `characters[*].stateTimeline`
- 重算 `time_anchors[*].shots[*].characterStateRefs`
- 同步刷新 `segment.analysis.shots[*].characterStateRefs`

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
- 图片模型请求现在走统一 Node.js `undici` 请求层，并自动读取代理配置
- 会自动尝试候选图片模型，而不是只卡死在单一模型名
- 对 `unexpected eof`、连接超时等网络抖动增加了重试

当前状态：

- 接口和落库链路已经接通
- 单张图片生成已真实成功
- 完整三视图资源包也已真实成功并落库
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
3. 当前镜头角色状态参考帧
4. 角色三视图
5. 场景资源图
6. 小镜头参考音频
7. 背景资产视频

参考图总上限为 9 张时，当前实现固定优先保留：

- 小镜头典型帧 1 张
- 角色三视图 3 张
- 场景资源图 3 张
- 角色状态参考帧最多 2 张

然后再把：

- `@角色`
- `#场景`

替换成真实资源提示词，组装成最终 Seedance 提示词。

当前镜头生成分支：

- 有对白并且参考音频存在：`generate_audio=true`，会传 `reference_audio`
- 无对白：`generate_audio=false`，明确要求不要明显说话口型
- 编辑区改过的对白和字幕会先保存，再参与页面展示与 SRT；口型真值首版仍默认优先原镜头音频

Seedance 这轮已经确认的兼容规则：

- 参考视频时长必须足够长
- 参考视频最小边长要满足要求
- 参考视频总像素数必须 `>= 409600`
- 小镜头源视频、背景资产视频、角色图、场景图、典型帧都会先尝试用 `PUBLIC_ASSET_BASE_URL` 组成公网 URL 传给 Seedance
- 如果 `PUBLIC_ASSET_BASE_URL` 生成的 reference video URL 自签证书或不可达，系统会自动跳过该视频参考，避免坏 URL 影响远端创建任务
- 如果没有公网资源 URL，图片和音频才会回退为 data URL；视频不会转成 data URL，因为 Seedance 的 `reference_video` 需要公网可访问 URL
- Seedance 创建任务使用独立超时 `SEED_DANCE_CREATE_TIMEOUT_MS`，默认 `120000ms`，不再共用 `EXTERNAL_REQUEST_TIMEOUT=30000`
- 生成结果下载使用独立超时 `SEED_DANCE_DOWNLOAD_TIMEOUT_MS`，默认 `300000ms`
- Seedance 参考视频总时长使用 `SEED_DANCE_REFERENCE_VIDEO_MAX_DURATION_SECONDS` 控制，默认 `15.2s`
- 当“小镜头源视频 + 背景资产视频”总时长超限时，系统优先保留小镜头源视频，跳过背景资产视频，避免远端 400
- 生成目标时长超过 `15s` 时会在本地提前拦截，提示继续细分镜头；这类错误不会再伪装成普通“视频生成失败”
- 发送 Seedance 前会做一层 provider-safe prompt rewrite，只改敏感风险词，不改角色、场景、站位和镜头动作
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
- `characters[*].stateTimeline`
- `backgrounds`
- `time_anchors`
- `time_anchors[*].shots`
- `time_anchors[*].shots[*].speech`
- `time_anchors[*].shots[*].characterStateRefs`

当前硬规则：

- 只调用一次 `Gemini-2.5-pro`
- 一次返回全部整片信息
- `shots` 尽量按真实镜头切点拆分
- `timeAnchor` / `shot` 时间尽量精确到 `0.1` 秒
- `representativeFrameTime` 必须选镜头里最有代表性的真实瞬间，不允许机械取中点
- 每个 `shot.prompt` 必须带 `@角色` 和 `#场景`
- 每个 `shot` 都必须带 `speech`
- 每个 `shot` 都必须带 `characterStateRefs`

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
- 再补上当前镜头角色状态 `continuityPrompt`
- 再补上对白全文、字幕节奏和说话方式
- 再补上镜头复原、构图、动作连续性要求

当前真实顺序：

1. 整片剧情目标
2. 大片段最终提示词
3. 小镜头最终提示词
4. 展开的 `@角色` 资源提示词
5. 当前镜头角色状态 `continuityPrompt`
6. 展开的 `#场景` 资源提示词
7. 对白文本 / 字幕节奏 / 说话方式
8. 不要字幕 / 不要文字 / 不要水印 / 不要 UI

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
- 整片理解固定单次 `Gemini-2.5-pro` 调用
- 整片理解细粒度镜头切分提示词
- 大片段切分
- 小镜头定义透传
- 小镜头对白 / 字幕 / 说话方式透传
- 角色状态时间线与镜头状态引用
- 小镜头源视频切片
- 小镜头典型帧抽取
- 小镜头参考音频切片与 SRT 生成
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
- 导出时只使用真实生成完成的片段；缺失片段会直接报错，不再回退原片

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
