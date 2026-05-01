# Pipeline

更新时间：2026-05-01

这份文档只写当前仓库里的真实流水线、真实提示词顺序、当前已完成功能和仍待复测部分。

## 1. 当前流水线总览

当前真实流程是：

1. 上传原视频
2. 选择全局比例、全局风格、分析选项
3. 做整片理解
4. 生成角色三视图和场景参考图
5. 拼接所有镜头描述为单一提示词
6. 生成完整视频（单次 Seedance 调用）
7. 下载完整视频（无需拼接）

可选调试流程：

4. 切大片段和小镜头（用于预览和调试）
5. 优化大片段和小镜头提示词

## 2. 功能列表

### 2.1 已完成

- 视频上传、去重、hash 文件名落盘
- 全局视频比例选择
- 全局风格模式选择：`写实` / `漫剧`
- 整片理解固定单次 `Gemini-2.5-pro`
- 整片理解可编辑风格段
- 整片分析结果持久化 `analysis_options.styleMode`
- 整片分析结果持久化 `analysis_options.styleTemplates`
- 大片段切分（用于预览和调试）
- 小镜头切分（用于预览和调试）
- 小镜头源视频切片
- 小镜头典型帧抽取
- 小镜头参考音频切片
- 小镜头字幕与 SRT 生成
- 角色状态时间线
- 小镜头角色状态引用
- 角色三视图生成
- 场景参考图生成
- 资源提示词优化
- 完整视频提示词拼接（`buildFullVideoPrompt()`）
- 完整视频生成（单次 Seedance 调用）
- Seedance 任务进度显示
- 后端重启后恢复在途生成任务
- 完整视频下载

### 2.2 已接通但稳定性受外部影响

- Gemini 生图稳定性
- Seedance 长任务排队时长
- 大批量镜头连续生成成功率

主要原因不是本地代码断，而是：

- 上游 `429`
- 供应商排队
- 外部网络波动
- 外部证书与供应商风控

### 2.3 2026-05-01 完整视频生成实现

- 已实现：`buildFullVideoPrompt()` 拼接所有镜头描述为单一提示词
- 已实现：完整视频生成通过单次 Seedance API 调用
- 已移除：逐镜头生成和 FFmpeg 拼接流程
- 已移除：`shotGenerationService` 的生成相关函数
- 已移除：`/api/generation/shots/*` 路由
- 提示词格式：【风格】【角色】【场景】【分镜头】结构化格式
- 视觉一致性：单次生成保持全片角色外观和场景美术统一

### 2.4 仍待继续完整复测

- 完整视频生成的端到端稳定性
- 长视频（5-10分钟）的完整生成成功率
- 漫剧风格下整套资源图和视频生成的长期稳定性

## 3. 详细流水线

### 3.1 上传原视频

- 前端入口：上传区
- 接口：`POST /api/videos/upload`

后端动作：

1. 校验格式、大小和重复上传
2. 用 `ffprobe` 读取时长和分辨率
3. 以 hash 文件名保存原视频
4. 写入 `videos`

### 3.2 全局设置

上传后，页面当前会先建立三个全局真值：

- 视频比例
- 风格模式
- 分析选项

当前风格模式只有两个：

- `realistic`
- `comic_drama`

前端显示文案分别是：

- `写实`
- `漫剧`

说明：

- 默认风格是 `漫剧`
- `漫剧` 当前固定指“国漫影视化”
- 这部分状态保存在 `analysis_options`

### 3.3 整片理解

- 前端入口：`开始分析 / 重新分析`
- 接口：`POST /api/analysis/analyze`
- 服务：`analysisService.analyzeVideoById`

当前真实规则：

- 只调用一次 `Gemini-2.5-pro`
- 对较大视频会先在本地生成低分辨率、低帧率的整片分析代理视频，再把代理视频发给 Gemini
- 如果 `extractSubtitles` 和 `parseAudio` 都关闭，整片分析代理视频会去掉音轨，减少上传体积
- 不再自动切备用文本模型
- 不再自动掉回 mock 分析
- 提示词现在是“固定结构段 + 风格段”
- 风格段来自当前 `styleMode`
- 对 `429`、`socket hang up`、`ECONNRESET` 这类瞬时上游异常会在同模型、同端点上自动重试
- 如果系统环境里的本地代理不可用，外部请求会自动绕过失效代理直连
- 当前环境里如果检测到本地 `127.0.0.1:7890` 代理配置，后端对外 AI 请求会直接绕过这条代理，改走 Node 原生 `http/https` 直连
- 当前整片分析的 Gemini 文本请求会优先走 `Authorization + key query` 的同发鉴权方式，再视错误情况回退其它兼容变体
- 前端点击“开始分析 / 重新分析”后，会立刻进入一致的 `processing` 展示，不再一边显示进度条一边写“等待分析 / 尚未开始”
- 当后端长时间处理中间没有新 websocket 进度时，前端会用本地心跳持续推进阶段文案和保活进度，避免用户误判为卡死
- 整片分析失败后，前端会把当前视频状态及时改成 `failed`，避免界面一直停在“分析中”
- 整片理解和片段理解的风格提示编辑框会优先保留本地草稿，不会再被被动的 `GET /api/analysis/:videoId` 回填覆盖

返回主结果：

- `plot`
- `characters`
- `time_anchors`
- `time_anchors[*].shots[*].speech`（当 `extractSubtitles` 或 `parseAudio` 开启时）

后端随后本地补齐：

- `backgrounds`
- `characters[*].stateTimeline`
- `time_anchors[*].shots[*].characterStateRefs`

说明：

- 当 `extractSubtitles` 或 `parseAudio` 开启时，小镜头 `speech` 会在整片分析时直接返回
- split 阶段不再逐个小镜头重新调 Gemini 做 speech 解析，只做本地音频切片和 SRT 落盘
- 如果整片分析连续出现 `socket hang up`，最终错误会明确提示这是“远端连接中途断开或网络不稳定”
- 如果整片分析收到上游 `429 / get_channel_failed / 上游负载已饱和`，最终错误会明确提示这是“Gemini 上游渠道繁忙或额度不足”
- 整片分析仍然只发一次 Gemini 请求；新增的本地代理视频只是降低上传体积和等待时间

### 3.4 大片段与小镜头切分（可选，用于预览和调试）

- 前端入口：`生成片段`
- 接口：`POST /api/segments/split`
- 服务：`segmentService.startSplitVideo`

当前真实行为：

1. 读取整片分析结果里的 `time_anchors`
2. 用 FFmpeg 切出大片段
3. 把 `time_anchors[*].shots` 透传到 `segment.analysis.shots`
4. 切出每个小镜头的源视频
5. 抽每个小镜头的典型帧
6. 切每个小镜头的参考音频
7. 把整片分析阶段已经拿到的 `speech` 持久化为 `subtitleLines`、SRT 和本地音频资产

当前重要变化：

- split 过程中不再对每个大片段重新调一次 Gemini
- split 过程中也不再对每个小镜头重新调一次 Gemini 做 speech 解析
- 所以片段卡会在本地切分完成后直接出现
- 此步骤主要用于预览和调试，完整视频生成不依赖此步骤

### 3.5 角色三视图与场景参考图

- 接口：`POST /api/resource-images/generate`
- 服务：`resourceImageService.generateResourceImageBundle`

当前规则：

- 角色三视图提示词会吃当前风格模式
- 场景三角度提示词也会吃当前风格模式
- 资源图提示词不再写死成写实模板

当前三视图 / 场景图风格来源：

- `characterThreeViewStylePrompt`
- `sceneThreeViewStylePrompt`

它们来自共享模板，不开放自由编辑。

### 3.6 片段理解（可选，用于调试）

- 接口：`POST /api/segments/:id/analyze`
- 服务：`segmentService.analyzeSegmentById`

当前规则：

- 片段理解现在只刷新大片段 prompt
- 不再重写 `shots`
- 提示词也分成”固定结构段 + 风格段”
- 风格段可按当前风格或本次 `style_mode` 覆盖
- 此步骤主要用于调试，完整视频生成不依赖此步骤

### 3.7 提示词优化

- 接口：`POST /api/analysis/optimize-prompt`

当前支持模式：

- `generation`
- `shot_generation`
- `character_resource`
- `scene_resource`

所有模式现在都会带入：

- 当前 `style_mode`
- 对应的风格优化约束

### 3.8 完整视频生成

- 接口：`POST /api/generation/generate`
- 服务：`generationService.startGeneration`

当前规则：

- 收集所有角色三视图和场景参考图
- 使用 `buildFullVideoPrompt()` 拼接所有镜头描述
- 一次性调用 Seedance 生成完整视频
- 时长 = 原视频总时长
- 不再需要镜头拼接

提示词格式：

```
【风格】风格约束...
【角色】@角色ID角色名、...
【场景】#场景ID场景名、...
【分镜头】
【开始-结束秒】镜头ID：描述。对白口型指导：...
```

当前参考优先级：

1. 角色三视图（定义角色外观）
2. 场景参考图（定义场景外观）
3. 风格模板（定义视觉美学）
4. 拼接的镜头描述（定义动作、对白和时间）

当前关键规则：

- 单次生成保持全片视觉一致性
- 角色外观和场景美术在所有镜头中统一
- 下载的视频即为完整成片，无需后处理

### 3.9 下载完整视频

- 接口：`GET /api/generation/:taskId/download`

当前规则：

- 下载 Seedance 生成的完整视频
- 无需拼接或后处理
- 视频时长匹配原视频总时长

## 4. 提示词顺序

这里按当前代码真实顺序写。

### 4.1 整片理解提示词顺序

当前顺序：

1. 固定结构段
2. 风格模式标签
3. 风格段

固定结构段里写死：

- JSON 字段骨架
- `timeAnchor` / `shot` 时间规则
- `shot.prompt` 必须带 `@角色` 和 `#场景`
- 细粒度切分约束
- 不要字幕 / 不要文字 / 不要 UI / 不要水印

### 4.2 片段理解提示词顺序

当前顺序：

1. 固定结构段
2. 风格模式标签
3. 风格段

当前风格段来源：

- `segmentAnalysisStylePrompt`

### 4.3 提示词优化顺序

当前优化提示词都会带：

1. 当前模式说明
2. 当前风格模式
3. 风格约束
4. 原始 prompt / 片段 prompt / 小镜头 prompt / 角色 / 场景上下文
5. 输出 JSON 规则

### 4.4 角色三视图 / 场景图提示词顺序

当前资源图提示词都会带：

1. 资源类型说明
2. 视角说明
3. 固定构图约束
4. 当前风格模板块
5. 资源本体描述

### 4.5 完整视频生成提示词顺序

当前真实顺序是：

1. `【风格】全局风格硬约束`
2. `【角色】角色列表（@角色ID角色名）`
3. `【场景】场景列表（#场景ID场景名）`
4. `【分镜头】所有镜头描述`
5. 每个镜头格式：`【开始-结束秒】镜头ID：描述。对白口型指导：...`

提示词来源：

1. 整片剧情目标
2. 全局风格硬约束
3. 角色三视图替换原片人物
4. 场景参考图替换原片空间
5. 逐镜头描述（包含动作、对白、时间）
6. 角色状态连续性约束
7. 对白文本和说话方式
8. 不要字幕 / 不要文字 / 不要 Logo / 不要水印 / 不要 UI

## 5. 当前数据与接口约定

### 5.1 `analysis_options`

当前包含：

- `extractSubtitles`
- `parseAudio`
- `styleMode`
- `styleTemplates`

当前 `styleTemplates` 只存可编辑项：

- `videoAnalysisStylePrompt`
- `segmentAnalysisStylePrompt`

并且按风格模式分开保存：

- `realistic`
- `comic_drama`

### 5.2 可选 `style_mode`

以下调用支持可选 `style_mode` 覆盖：

- `POST /api/segments/:id/analyze`
- `POST /api/analysis/optimize-prompt`
- `POST /api/generation/generate`
- `POST /api/generation/shots/generate`
- `POST /api/generation/shots/generate-batch`

规则：

- 不改接口 URL
- 不改原有必填字段
- 只增加可选 body 字段

### 5.3 风格切换的真实行为

当前切换风格后：

- 会影响后续新的分析、优化、资源图生成和视频生成
- 不会自动重跑已有整片分析
- 不会自动覆盖已生成资源
- 不会自动覆盖旧的片段 / 镜头结果

## 6. 当前限制

### 6.1 外部稳定性

当前最不稳定的仍然是：

- Gemini 生图 `429`
- Seedance 长任务排队
- Gemini 生图超时

### 6.2 供应商账务与证书

如果供应商账号欠费，或者公网资源 URL 证书不被远端接受，任务仍可能失败。  
这类问题不是本地提示词或本地 FFmpeg 逻辑能完全解决的。

2026-04-25 本地实测补充：

- `frp-fox` 公网资源 URL 在本机 Node 里会被判定为 `self-signed certificate`
- Seedance 任务已经能进入远端创建，但仍可能被敏感内容或版权限制拒绝

## 7. 一句话总结

当前主流水线已经进入”完整视频一次性生成”的状态：

- 风格已经贯穿分析、优化、资源图和视频生成
- 分析提示词已经改成固定结构只读、风格段可编辑
- 完整视频通过 `buildFullVideoPrompt()` 拼接所有镜头描述为单一提示词
- 单次 Seedance API 调用生成整个视频，保持全片视觉一致性
- 角色三视图和场景参考图主导视觉外观
- 下载的视频即为完整成片，无需拼接或后处理
