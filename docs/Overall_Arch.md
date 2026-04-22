# Overall Architecture

更新时间：2026-04-22

这份文档写项目当前真实结构，不写理想结构。

## 1. 总体结构

项目现在分成 4 层：

1. 前端工作台
2. 后端 API 与任务编排
3. 本地媒体处理
4. 外部 AI 服务

整体关系：

```text
React / Vite
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
  - 弹窗、悬浮卡、进度条
- `hooks`
  - 上传
  - 分析
  - 片段
  - 生成
  - 导出
  - 恢复与重置
- `services`
  - 所有 API 请求封装
- `store`
  - Zustand 状态仓库
- `utils`
  - 时间格式化
  - 提示词蓝图
  - URL 与 mention 工具

### 2.2 后端

目录：`backend`

主要分层：

- `routes`
  - HTTP 路由
- `controllers`
  - 请求和响应层
- `services`
  - 核心业务逻辑
- `models`
  - Sequelize 模型
- `migrations`
  - 数据库迁移
- `middleware`
  - 错误处理、校验、安全
- `config`
  - 环境变量、数据库、Swagger
- `utils`
  - 初始化、日志、通用工具
- `scripts`
  - smoke、检查、性能脚本
- `uploads`
  - 所有本地落盘媒体

## 3. 前端架构

### 3.1 页面布局

当前首页是一个紧凑控制台：

- 顶部：状态栏 + 全局比例
- 左列：
  - 项目与上传
  - 原视频上传区
  - 资源库与整片理解
- 右列：
  - 片段工作台
- 右下角：
  - 导出前检查
  - 成片拼接

### 3.2 前端关键状态

前端主要维护：

- 当前视频
- 整片分析结果
- 片段列表
- 资源图列表
- 背景资产列表
- 大片段生成任务
- 小镜头生成任务
- 合并任务
- provider 健康状态

### 3.3 前端关键组件

当前最影响主链路的组件：

- `AnalysisDisplay`
  - 展示整片理解、角色资源、场景资源、片段分解
- `SegmentCard`
  - 展示大片段卡和小镜头编辑弹窗
- `VideoFramePreview`
  - 展示持久化典型帧或动态抽帧回退
- `PromptEditor`
  - 大片段和资源提示词编辑
- `ProgressBar`
  - 长任务进度展示

### 3.4 前端当前实现约定

- 主页尽量只保留结果，不常驻长解释
- 镜头编辑在弹窗里完成
- 小镜头结构没有变化时，生成不再强制先保存
- 只改提示词时，会直接按当前编辑器里的 prompt 生成

这一条是 2026-04-22 新补的关键规则，用来避免：

- 已完成镜头被误判旧
- 无意义重建小镜头资产

## 4. 后端架构

### 4.1 路由层

当前主要 API：

- `/api/videos`
  - 上传、查询、删除视频
- `/api/analysis`
  - 整片分析
  - 获取整片分析
  - 提示词优化
- `/api/segments`
  - 切分片段
  - 获取片段
  - 片段分析
  - 保存镜头定义
- `/api/resource-images`
  - 角色 / 场景资源图生成与查询
- `/api/background-assets`
  - 背景资产查询
- `/api/generation`
  - 大片段生成
  - 小镜头生成
  - 小镜头批量生成
  - 生成任务查询
- `/api/merge`
  - 发起拼接
  - 查拼接进度
  - 下载成片
- `/api/tasks`
  - 通用任务进度
- `/api/health`
  - 健康检查

### 4.2 核心服务

#### `videoService`

负责：

- 接收上传视频
- 校验重复上传
- 读取视频元数据
- hash 文件名落盘
- 初始化 `videos`

#### `geminiService`

负责：

- 整片理解 prompt
- 片段理解 prompt
- 提示词优化 prompt
- Gemini 文本请求
- JSON 解析和 normalize

当前真实特点：

- 主模型失败后会尝试备用模型
- 只有备用模型也失败时才回退 mock

#### `geminiImageService`

负责：

- Gemini 生图接口调用
- 图片响应解析
- 图片保存

当前真实状态：

- 链路已接通
- 上游 `429` 仍然常见

#### `resourceImageService`

负责：

- 角色三视图生成
- 场景三角度图生成
- 资源图落库
- 部分成功 / 失败汇总

#### `segmentService`

负责：

- 大片段切分
- 小镜头定义保存
- 小镜头结构校验
- 片段列表序列化
- 小镜头任务与大片段结果的拼装输出

2026-04-22 新补的真实兼容：

- 保存完全相同的小镜头定义时直接 no-op
- `shotAssemblyInvalidatedAt` 的比较改成秒级边界，避免把同秒新任务误过滤

#### `shotAssetService`

负责：

- 小镜头源视频切片
- 小镜头典型帧抽取
- 小镜头资产自愈重建

当前真实兼容：

- 不再只认精确 `ffmpeg-slice`，会兼容 `ffmpeg-slice-openh264` 等变体

#### `shotGenerationService`

负责：

- 小镜头单任务生成
- 批量小镜头生成
- 任务状态序列化
- 全部完成后的大片段自动拼回

2026-04-22 新补的真实兼容：

- 如果小镜头任务已经拿到远端 `remoteTaskId`，服务重启后会继续追原来的 Seedance 任务
- 远端任务成功后会继续下载、裁时长、回写数据库，并尝试自动拼回大片段

#### `generationService`

负责：

- 大片段主生成
- `@角色` 和 `#场景` 展开
- 背景资产准备
- 把最终 prompt 和参考素材送给 Seedance

2026-04-22 新补的真实兼容：

- 如果大片段任务已经拿到远端 `remoteTaskId`，服务重启后会继续追原来的 Seedance 任务
- 不会因为本地轮询中断就重复创建第二个远端视频任务

#### `seedDanceService`

负责：

- Seedance 请求体组装
- 创建远端视频生成任务
- 轮询远端状态
- 下载远端视频
- 按目标时长本地裁剪
- 基于已有 `remoteTaskId` 恢复远端任务

当前真实兼容：

- 能识别 Seedance 最小时长限制
- 能在后端重启后继续恢复已有远端任务

#### `taskRecoveryService`

负责：

- 服务启动时扫描在途大片段生成任务
- 服务启动时扫描在途小镜头生成任务
- 服务启动时扫描待拼回的大片段
- 重新挂起这些任务的本地后续处理

当前触发方式：

- `backend/app.js` 在数据库连通后，通过 `queueMicrotask` 异步启动恢复扫描

#### `backgroundAssetService`

负责：

- 背景资产生成和复用
- 保证同视频内同 `background_id` 只保留一份参考视频

#### `mergeService`

负责：

- 选择每个大片段最终使用的素材
- FFmpeg 合并
- 下载输出

#### `ffmpegService`

负责：

- 视频切分
- 小镜头切片
- 典型帧抽帧
- 合并
- 元数据读取

当前真实兼容：

- `libx264` 不可用时会自动回退其他可用编码方式

#### `seedDanceService`

负责：

- Seedance 请求体构造
- 参考图 / 参考视频 / 参考音频组装
- 远端任务创建与轮询
- 输出下载
- 过短视频裁回原时长

当前真实兼容：

- 过滤过短参考视频
- 过滤边长太小的参考视频
- 过滤像素总数小于 `409600` 的参考视频
- 生成时长自动适配 provider 最小值

## 5. 数据结构

### 5.1 核心表

当前最重要的表：

- `projects`
- `videos`
- `analyses`
- `segments`
- `generation_tasks`
- `shot_generation_tasks`
- `background_assets`
- `resource_image_assets`

### 5.2 关键字段语义

#### `analyses`

保存整片理解结果。

关键字段：

- `plot`
- `characters`
- `backgrounds`
- `timeAnchors`
- `geminiResponse`

#### `segments`

保存大片段。

其中 `analysis` JSON 里会继续保存：

- 片段 prompt
- 角色列表
- 场景列表
- 背景绑定
- `shots`
- `shotAssembly`
- `shotAssemblyInvalidatedAt`

#### `shot_generation_tasks`

专门保存小镜头生成任务。

它和 `generation_tasks` 分开的原因很直接：

- `generation_tasks` 主要服务大片段主结果
- `shot_generation_tasks` 主要服务镜头级独立结果

#### `background_assets`

保存场景背景参考视频。

唯一约束是：

- 同一视频
- 同一 `background_id`
- 只保留一份

#### `resource_image_assets`

保存角色三视图和场景资源图。

一个资源会拆成多条变体：

- 角色：`front / side / back`
- 场景：`establishing / three-quarter / elevated`

## 6. 本地文件结构

当前落盘目录：

- `backend/uploads/videos`
  - 原视频
- `backend/uploads/segments`
  - 大片段视频
- `backend/uploads/shots`
  - 小镜头源视频
- `backend/uploads/frames`
  - 典型帧图片
- `backend/uploads/resource-images`
  - 角色三视图和场景资源图
- `backend/uploads/outputs`
  - Seedance 输出
  - 拼接输出

## 7. 真实数据流

### 7.1 上传到整片理解

```text
上传视频
-> ffprobe 读元数据
-> videos 入库
-> Gemini 整片理解
-> analyses 入库
```

### 7.2 整片理解到切分

```text
analysis.time_anchors
-> 切大片段
-> 写 segments
-> analysis.time_anchors[*].shots
-> 切小镜头源视频
-> 抽小镜头典型帧
-> 写入 segment.analysis.shots
```

### 7.3 资源图

```text
角色 / 场景资源提示词
-> Gemini 生图
-> resource_image_assets
-> uploads/resource-images
```

### 7.4 小镜头生成

```text
shot.prompt
-> 展开 @角色 / #场景
-> 准备小镜头源视频 + 典型帧 + 资源图 + 背景资产
-> Seedance
-> shot_generation_tasks
-> 小镜头结果
-> 全部成功后拼回大片段
```

### 7.5 导出

```text
按大片段挑最终素材
-> 有新结果就优先用新结果
-> 没有就回退原始大片段
-> merge
-> 下载成片
```

## 8. 当前最重要的架构约定

### 8.1 小镜头真值来自整片理解

真值来源：

- `analysis.time_anchors[*].shots`

### 8.2 时间统一用整片绝对秒数

以下字段都默认是整片绝对秒数：

- `timeAnchor.startTime/endTime`
- `shot.startTime/endTime`
- `representativeFrameTime`

### 8.3 典型帧优先使用已落盘资源

优先级：

1. `representativeFrameImageUrl`
2. 动态抽帧回退

### 8.4 生成前一定展开资源标签

生成前一定会：

- 把 `@角色` 替换成角色资源真实提示词
- 把 `#场景` 替换成场景资源真实提示词

### 8.5 导出不断链

当前规则一直保持：

- 优先使用新生成结果
- 缺失时自动回退原片段
- 不让导出链路整体中断

## 9. 当前架构的现实限制

### 9.1 外部模型稳定性仍然影响成功率

当前最不稳定的还是：

- Gemini 生图
- Seedance 长任务

### 9.2 小镜头批量拼回还要继续长链路复测

单镜头已经真实成功过。

但还需要继续验证：

- 全部镜头成功
- 自动拼回大片段
- 再进入整片 merge

### 9.3 浏览器端当前视频上下文仍依赖当前 origin

当前工作流主要假设同一前端 origin 持续使用。

如果浏览器切到另一个 origin，例如：

- `127.0.0.1`
- `localhost`

两边的本地存储上下文不是同一份，当前视频选择态不会自动共享。
