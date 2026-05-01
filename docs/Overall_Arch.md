# Overall Architecture

更新时间：2026-05-01

这份文档只写当前真实架构和当前真实职责。

## 1. 总体结构

项目现在可以分成 5 层：

1. 前端工作台
2. 前后端共享提示词 / 风格模板层
3. 后端 API 与任务编排
4. 本地媒体处理层
5. 外部 AI 服务层

整体关系：

```text
React / Vite
  -> shared/styleTemplates + shared/promptBlueprints
    -> Express API
      -> MySQL / Sequelize
      -> FFmpeg / FFprobe
      -> Gemini 文本
      -> Gemini 生图
      -> Seedance 视频生成
```

## 2. 仓库结构

### 2.1 前端

目录：`frontend/src`

主要分层：

- `pages`
  - 页面入口
- `components`
  - 上传区
  - 整片分析区
  - 角色 / 场景资源卡
  - 片段卡
  - Prompt 编辑器
  - 进度条
  - 弹窗和悬浮面板
- `hooks`
  - 上传
  - 分析
  - 片段
  - 生成
  - 导出
- `services`
  - API 请求封装
- `store`
  - Zustand 状态仓库
- `utils`
  - 自动出片编排
  - 时间格式化
  - 前端提示词辅助

### 2.2 后端

目录：`backend`

主要分层：

- `routes`
  - HTTP 路由
- `controllers`
  - 请求和响应层
- `services`
  - 业务主逻辑
- `models`
  - Sequelize 模型
- `migrations`
  - 数据库迁移
- `middleware`
  - 校验和错误处理
- `config`
  - 环境变量和服务配置
- `utils`
  - 日志、校验、初始化
- `uploads`
  - 本地媒体落盘目录

### 2.3 共享层

目录：`shared`

当前新增的真实职责：

- 风格模式定义
- 风格模板真值
- 前后端共用提示词蓝图

关键文件：

- `shared/styleTemplates.js`
- `shared/promptBlueprints.js`

## 3. 前端架构

### 3.1 页面布局

当前首页是一个控制台布局：

- 顶部：系统状态、全局比例、全局风格
- 左列：
  - 上传区
  - 整片理解
  - 角色资源库
  - 场景资源库
- 右列：
  - 片段工作台
- 右下角：
  - 导出面板

### 3.2 前端关键状态

前端当前主要维护：

- 当前视频
- 整片分析结果
- `analysisOptions`
- 片段列表
- 背景资产
- 资源图资产
- 大片段任务
- 小镜头任务
- merge 任务
- provider 健康状态

其中 `analysisOptions` 现在至少包含：

- `extractSubtitles`
- `parseAudio`
- `styleMode`
- `styleTemplates`

### 3.3 前端关键组件

#### `MainPage`

负责：

- 全局比例选择
- 全局风格选择
- 一键出片编排
- 整页数据装配

#### `AnalysisDisplay`

负责：

- 整片理解入口
- 分析选项面板
- 整片理解提示词预览
- 角色 / 场景资源卡展示
- 整片理解风格段编辑

当前关键规则：

- 固定结构只读
- 风格段可编辑

#### `SegmentCard`

负责：

- 大片段卡
- 小镜头卡
- 小镜头编辑弹窗
- 片段理解风格段编辑
- 单镜头生成
- 批量镜头生成

#### `useAnalysisStore`

负责：

- `analysisOptions` 默认值
- 从后端恢复 `styleMode`
- 从后端恢复 `styleTemplates`

#### `useGeneration`

负责：

- 片段分析
- 提示词优化
- 单镜头生成
- 批量镜头生成
- merge

当前已接入：

- 请求里的可选 `style_mode`

## 4. 后端架构

### 4.1 主要路由

当前核心 API：

- `/api/videos`
  - 上传、查询、删除视频
- `/api/analysis`
  - 整片分析
  - 获取整片分析
  - 提示词优化
  - 保存角色状态
- `/api/segments`
  - 切分片段（用于预览和调试）
  - 获取片段
  - 片段分析（用于调试）
  - 保存镜头定义
- `/api/resource-images`
  - 角色 / 场景资源图生成与查询
- `/api/background-assets`
  - 背景资产查询
- `/api/generation`
  - 完整视频生成（`POST /api/generation/generate`）
  - 任务查询（`GET /api/generation/:taskId`）
  - 下载生成结果（`GET /api/generation/:taskId/download`）

### 4.2 核心服务职责

#### `analysisService`

负责：

- 整片分析入口
- 整片分析结果入库
- `analysis_options` 入库与序列化
- 角色状态时间线保存

当前重要行为：

- 整片分析后会补角色状态时间线
- 整片分析后会补 `characterStateRefs`

#### `geminiService`

负责：

- 整片理解 prompt 组装
- 片段理解 prompt 组装
- 提示词优化 prompt 组装
- Gemini 文本请求
- JSON normalize

当前新增职责：

- 使用共享模板拼装“固定结构段 + 风格段”
- 让优化 prompt 带入当前风格模式
- 让资源图 prompt 带入当前风格模板
- 当 `analysis_options.extractSubtitles / parseAudio` 开启时，在整片理解里一次性返回 shot 级 `speech`
- 对较大视频先本地转整片分析代理视频，再把代理视频发给 Gemini，减少整段上传体积
- 当前环境里如果检测到本地 `127.0.0.1:7890` 代理配置，Gemini 文本请求会直接绕过这条代理，改走 Node 原生 `http/https` 直连

#### `shotSpeechService`

负责：

- `analysisOptions` normalize
- 小镜头音频切片
- 字幕 normalize
- SRT 生成
- speech 数据整理

当前新增职责：

- 统一处理 `styleMode`
- 统一处理 `styleTemplates`
- 只把整片理解里已有的 `speech` 落成本地 SRT 和音频资产，不再逐个小镜头重新调 Gemini

#### `segmentService`

负责：

- 大片段切分
- 小镜头切分
- 小镜头定义保存
- 镜头数据校验
- 片段列表序列化

当前关键规则：

- `POST /segments/split` 不再对每个大片段再次调 Gemini
- 直接用整片分析里的 `time_anchors[*].shots` 作为小镜头真值

#### `resourceImageService`

负责：

- 角色三视图生成
- 场景参考图生成
- 结果落库

当前关键规则：

- 资源图 prompt 不再写死写实模板
- 资源图 prompt 从共享风格模板读取

#### `generationService`

负责：

- 完整视频生成
- `buildFullVideoPrompt()` 拼接所有镜头描述
- `@角色` / `#场景` 展开
- 参考素材准备
- Seedance 最终 prompt 组装

`buildFullVideoPrompt()` 函数：

- 输入：整片分析结果（包含所有镜头描述）
- 处理：
  1. 读取 `analysis.time_anchors[*].shots` 所有镜头
  2. 展开每个镜头中的 `@角色` 和 `#场景` 引用
  3. 插入全局风格硬约束（`videoGenerationStylePrompt`）
  4. 拼接角色列表、场景列表和分镜头描述
  5. 添加角色状态连续性约束
  6. 添加对白文本和说话方式
- 输出：结构化提示词（【风格】【角色】【场景】【分镜头】格式）

当前新增职责：

- 插入 `videoGenerationStylePrompt`
- 单次 API 调用生成完整视频

#### `shotGenerationService`

负责：

- 镜头数据管理（已移除生成功能）

当前状态：

- 已移除单镜头生成
- 已移除批量镜头生成
- 已移除镜头任务复用
- 已移除镜头拼回大片段
- 保留镜头数据结构用于预览和调试

#### `ffmpegService`

负责：

- 视频切片
- 小镜头切片
- 抽帧
- 元数据读取

当前状态：

- 已移除合并功能（不再需要拼接镜头）
- 已移除语音压缩功能（完整视频生成不需要音频适配）
- 保留切片和抽帧功能用于预览和调试

#### `seedDanceService`

负责：

- Seedance 请求体组装
- 创建远端任务
- 轮询远端任务
- 下载结果
- 本地裁时长

### 4.3 长任务恢复

当前通过 `taskRecoveryService` 做服务启动恢复。

恢复范围：

- 完整视频生成任务

## 5. 数据结构

### 5.1 关键表

当前核心表：

- `videos`
- `analyses`
- `segments`
- `generation_tasks`
- `shot_generation_tasks`
- `background_assets`
- `resource_image_assets`

### 5.2 关键字段

#### `analyses`

保存整片分析真值。

关键字段：

- `plot`
- `characters`
- `backgrounds`
- `timeAnchors`
- `analysisOptions`

其中 `analysisOptions` 现在保存：

- `extractSubtitles`
- `parseAudio`
- `styleMode`
- `styleTemplates`

#### `segments.analysis`

保存大片段工作态。

当前重要字段：

- `scenePrompt`
- `sceneSummary`
- `backgroundId`
- `backgroundName`
- `shots`
- `shotAssembly`
- `shotAssemblyInvalidatedAt`
- `analysisOptions`

#### `segment.analysis.shots[*]`

当前每个小镜头会尽量保存：

- 时间定义
- 最终提示词
- 源视频
- 典型帧
- 参考音频
- `speech`
- `characterStateRefs`

#### `shot_generation_tasks`

只负责保存小镜头生成任务。

当前任务 `meta` 里会带：

- `styleMode`
- `speechSignature`
- `characterStateSignature`
- 已发送参考素材清单

## 6. 当前真实数据流

### 6.1 上传到整片理解

```text
上传视频
-> videos
-> 整片分析请求
-> Gemini-2.5-pro
-> analyses
-> analysisOptions / characters / timeAnchors / backgrounds
```

### 6.2 整片理解到切分（可选，用于预览）

```text
analysis.time_anchors
-> 切大片段
-> 写 segments
-> 透传 shots
-> 切小镜头源视频
-> 抽小镜头典型帧
-> 切小镜头音频
-> 使用整片理解已返回的 speech 落盘 subtitleLines / SRT
```

### 6.3 风格模板数据流

```text
MainPage 风格选择
-> analysisStore.analysisOptions.styleMode
-> shared/styleTemplates.js
-> shared/promptBlueprints.js
-> 分析 prompt / 优化 prompt / 资源图 prompt / Seedance prompt
```

### 6.4 完整视频生成数据流

```text
analysis.time_anchors[*].shots
-> buildFullVideoPrompt() 拼接所有镜头描述
-> 展开 @角色 / #场景
-> 读取整片理解里的 stateTimeline / continuityPrompt
-> 插入全局风格硬约束
-> 准备角色三视图 / 场景图
-> Seedance 单次 API 调用
-> generation_tasks
-> 下载完整视频
```

补充约定：

- 角色三视图优先定义人物外观
- 场景图优先定义空间和布景外观
- 单次生成保持全片视觉一致性
- 生成结果即为完整成片，无需拼接

## 7. 当前最重要的架构约定

### 7.1 小镜头真值来源

当前真值来源仍然是：

- `analysis.time_anchors[*].shots`

### 7.2 风格模板只有一份真值

当前唯一风格真值在：

- `shared/styleTemplates.js`

前端和后端都从这里取默认模板和模式定义。

### 7.3 分析提示词只能编辑风格段

当前约定：

- JSON 结构段只读
- 风格段可编辑

### 7.4 完整视频生成使用单一提示词

当前约定：

- `buildFullVideoPrompt()` 拼接所有镜头描述
- 格式：【风格】【角色】【场景】【分镜头】
- 单次 Seedance API 调用生成完整视频
- 保持全片视觉一致性

### 7.5 不再进行镜头级生成和拼接

当前约定：

- 不再逐镜头生成
- 不再使用 FFmpeg 拼接镜头
- 下载的视频即为完整成片

## 8. 当前现实限制

### 8.1 外部供应商仍决定稳定性上限

最不稳定的仍然是：

- Gemini 生图
- Seedance 长任务

### 8.2 完整视频生成需要继续复测

单次生成整个视频的稳定性和质量仍需要继续验证。
