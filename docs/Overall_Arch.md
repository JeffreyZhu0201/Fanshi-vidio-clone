# AI视频复刻项目 - 整体架构设计

## 1. 项目概览

**项目名称**: Fanshi-vidio-clone  
**技术栈**: React + Node.js + MySQL + FFmpeg + Gemini API + Seed Dance API  
**部署环境**: Ubuntu 22.04  
**应用形态**: 单页应用（SPA），所有功能集成在一个页面

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     前端 (React SPA)                         │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │ 视频上传区   │ 视频分析展示 │ 片段编辑卡片 │             │
│  │              │              │              │             │
│  │ - 拖拽上传   │ - 剧情内容   │ - 预览框     │             │
│  │ - 进度条     │ - 角色形象   │ - 生成占位   │             │
│  │ - 文件验证   │ - 镜头背景   │ - 提示词编辑 │             │
│  │              │ - 时间锚点   │ - 角色标签   │             │
│  │              │              │ - 生成按钮   │             │
│  └──────────────┴──────────────┴──────────────┘             │
│  ┌──────────────────────────────────────────────┐           │
│  │ 视频拼接区 - 进度条 + 下载按钮               │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
                            ↕
                    REST API (JSON)
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                   后端 (Node.js)                             │
│  ┌──────────────┬──────────────┬───────────��──┐             │
│  │ 视频处理服务 │ AI分析服务   │ 视频合成服务 │             │
│  │              │              │              │             │
│  │ - 上传验证   │ - Gemini集成 │ - FFmpeg调用 │             │
│  │ - 存储管理   │ - 提示词优化 │ - 视频拼接   │             │
│  │ - FFmpeg分割 │ - 角色提取   │ - 进度跟踪   │             │
│  │              │ - Seed Dance │ - 文件输出   │             │
│  │              │   API调用    │              │             │
│  └──────────────┴──────────────┴──────────────┘             │
│  ┌──────────────────────────────────────────────┐           │
│  │ 数据库层 (MySQL)                             │           │
│  │ - 项目表 - 视频表 - 分析结果表 - 任务表      │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 项目结构

```
Fanshi-vidio-clone/
├── README.md
├── .gitignore
├── docs/
│   ├── Overall_Arch.md          (本文件)
│   ├── 1.项目初始化.md
│   ├── 2.数据库设计.md
│   ├── 3.后端API设计.md
│   ├── 4.前端UI设计.md
│   ├── 5.集成测试.md
│   └── 6.部署指南.md
│
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── server.js
│   ├── config/
│   │   ├── database.js
│   │   ├── env.js
│   │   └── constants.js
│   ├── routes/
│   │   ├── video.js
│   │   ├── analysis.js
│   │   └── generation.js
│   ├── controllers/
│   │   ├── videoController.js
│   │   ├── analysisController.js
│   │   └── generationController.js
│   ├── services/
│   │   ├── geminiService.js
│   │   ├── ffmpegService.js
│   │   ├── seedDanceService.js
│   │   └── videoService.js
│   ├── models/
│   │   ├── Project.js
│   │   ├── Video.js
│   │   ├── Analysis.js
│   │   └── Task.js
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── errorHandler.js
│   │   └── validation.js
│   ├── utils/
│   │   ├── logger.js
│   │   ├── fileHandler.js
│   │   └── helpers.js
│   └── uploads/
│       ├── videos/
│       ├── segments/
│       └── outputs/
│
├── frontend/
│   ├── package.json
│   ├── .env.example
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── index.js
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── UploadArea.jsx
│   │   │   ├── AnalysisDisplay.jsx
│   │   │   ├── SegmentCard.jsx
│   │   │   ├── PromptEditor.jsx
│   │   │   ├── VideoMerge.jsx
│   │   │   └── ProgressBar.jsx
│   │   ├── pages/
│   │   │   └── MainPage.jsx
│   │   ├── services/
│   │   │   ├── api.js
│   │   │   └── websocket.js
│   │   ├── hooks/
│   │   │   ├── useVideoUpload.js
│   │   │   ├── useAnalysis.js
│   │   │   └── useGeneration.js
│   │   ├── store/
│   │   │   ├── videoStore.js
│   │   │   ├── analysisStore.js
│   │   │   └── generationStore.js
│   │   ├── styles/
│   │   │   ├── App.css
│   │   │   ├── components.css
│   │   │   └── theme.css
│   │   └── utils/
│   │       ├── formatters.js
│   │       └── validators.js
│   └── .gitignore
│
└── .git/
```

---

## 4. 核心功能流程

### 4.1 视频上传与分析流程

```
用户上传视频
    ↓
前端验证 (格式、大小)
    ↓
后端接收 + 存储
    ↓
调用 Gemini API 分析视频
    ↓
提取: 剧情、角色、背景、时间锚点
    ↓
存储分析结果到数据库
    ↓
前端展示分析结果
```

### 4.2 视频分割与片段编辑流程

```
获取时间锚点
    ↓
后端调用 FFmpeg 分割视频
    ↓
生成视频片段文件
    ↓
前端展示片段列表 (卡片形式)
    ↓
用户编辑提示词
    ↓
点击"优化提示词" → Gemini 优化
    ↓
角色自动标记 (@符号蓝色)
    ↓
点击"生成" → Seed Dance API 生成
```

### 4.3 视频拼接与下载流程

```
用户点击"拼接视频"
    ↓
后端调用 FFmpeg 合并所有片段
    ↓
前端显示进度条 (WebSocket 实时更新)
    ↓
合并完成
    ↓
前端显示下载按钮
    ↓
用户下载最终视频
```

---

## 5. 数据库设计

### 5.1 核心表结构

**projects 表** - 项目���息
```sql
id, user_id, name, description, created_at, updated_at
```

**videos 表** - 视频文件
```sql
id, project_id, filename, file_path, duration, size, status, created_at
```

**analyses 表** - 视频分析结果
```sql
id, video_id, plot, characters, backgrounds, time_anchors (JSON), created_at
```

**segments 表** - 视频片段
```sql
id, video_id, segment_index, start_time, end_time, file_path, analysis (JSON)
```

**generation_tasks 表** - 生成任务
```sql
id, segment_id, prompt, status, result_url, progress, created_at, updated_at
```

---

## 6. API 端点设计

### 视频管理
- `POST /api/videos/upload` - 上传视频
- `GET /api/videos/:id` - 获取视频信息
- `DELETE /api/videos/:id` - 删除视频

### 分析服务
- `POST /api/analysis/analyze` - 分析视频
- `GET /api/analysis/:videoId` - 获取分析结果
- `POST /api/analysis/optimize-prompt` - 优化提示词

### 视频处理
- `POST /api/segments/split` - 分割视频
- `GET /api/segments/:videoId` - 获取片段列表
- `POST /api/generation/generate` - 生成片段

### 视频合成
- `POST /api/merge/start` - 开始拼接
- `GET /api/merge/:taskId/progress` - 获取进度
- `GET /api/merge/:taskId/download` - 下载视频

---

## 7. 前端 UI 设计

### 单页面布局 (响应式)

```
┌─────────────────────────────────────────────────────┐
│                    顶部导航栏                        │
│  Logo | 项目名称 | 用户菜单                         │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                   主工作区 (3列布局)                 │
│                                                     │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│ │   左侧栏     │ │   中间区     │ │   右侧栏     │ │
│ │              │ │              │ │              │ │
│ │ 上传区       │ │ 分析展示     │ │ 片段卡片列表 │ │
│ │ - 拖拽上传   │ │ - 剧情       │ │ - 预览       │ │
│ │ - 进度条     │ │ - 角色       │ │ - 提示词编辑 │ │
│ │ - 文件列表   │ │ - 背景       │ │ - 生成按钮   │ │
│ │              │ │ - 时间轴     │ │              │ │
│ │ 拼接区       │ │              │ │ 滚动查看更多 │ │
│ │ - 进度条     │ │              │ │              │ │
│ │ - 下载按钮   │ │              │ │              │ │
│ └──────────────┘ └──────────────┘ └──────────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 色彩方案
- 主色: #6366F1 (靛蓝)
- 辅色: #EC4899 (粉红)
- 背景: #F8FAFC (浅灰)
- 文字: #1E293B (深灰)

### 交互设计
- 拖拽上传视频
- 实时进度条反馈
- 卡片式片段展示
- 内联编辑提示词
- 角色标签自动高亮

---

## 8. 开发流程与版本管理

### Git 工作流

```
main (生产分支)
  ↑
  │ (merge with PR)
  │
develop (开发分支)
  ↑
  │ (feature branches)
  │
feature/video-upload
feature/gemini-analysis
feature/ffmpeg-split
feature/segment-edit
feature/seed-dance-gen
feature/video-merge
```

### 开发阶段

| 阶段 | 功能 | 分支 | 文档 |
|------|------|------|------|
| 1 | 项目初始化 + 数据库 | `feature/init` | `1.项目初始化.md` |
| 2 | 后端 API 框架 | `feature/backend-api` | `2.数据库设计.md` |
| 3 | 视频上传 + Gemini 分析 | `feature/video-analysis` | `3.后端API设计.md` |
| 4 | FFmpeg 分割 + 片段管理 | `feature/video-split` | `4.前端UI设计.md` |
| 5 | 前端 UI + 交互 | `feature/frontend-ui` | `5.集成测试.md` |
| 6 | Seed Dance 生成 | `feature/generation` | `6.部署指南.md` |
| 7 | 视频拼接 + 下载 | `feature/video-merge` | - |
| 8 | 集成测试 + 优化 | `feature/testing` | - |

---

## 9. 全栈开发约束与规范

### 代码质量标准

**后端 (Node.js)**
- 使用 Express.js 框架
- 遵循 MVC 架构
- 错误处理: 统一的 try-catch + 错误中间件
- 日志: 使用 winston 或 pino
- 验证: 使用 joi 或 zod
- 数据库: 使用 ORM (Sequelize 或 TypeORM)
- 环境变量: .env 文件管理敏感信息
- API 文档: Swagger/OpenAPI

**前端 (React)**
- 使用函数组件 + Hooks
- 状态管理: Zustand 或 Redux Toolkit
- 样式: Tailwind CSS + CSS Modules
- 组件库: shadcn/ui 或 Material-UI
- 类型检查: PropTypes 或 TypeScript
- 测试: Jest + React Testing Library
- 代码格式: Prettier + ESLint

### 安全性要求
- 后端 API 验证所有输入
- 文件上传大小限制 (500MB)
- 文件类型白名单 (mp4, mov, avi)
- 敏感信息不存储在前端
- CORS 配置严格
- SQL 注入防护 (使用参数化查询)
- XSS 防护 (React 自动转义)

### 性能要求
- 视频上传分块处理
- 后端异步任务队列 (Bull 或 RabbitMQ)
- 前端虚拟滚动 (大量片段)
- 数据库查询优化 (索引)
- CDN 加速静态资源
- WebSocket 实时进度更新

---

## 10. 部署与运维

### 环境配置
- **开发**: localhost:3000 (前端) + localhost:5000 (后端)
- **生产**: Docker 容器化 + Nginx 反向代理

### 依赖服务
- MySQL 8.0+
- FFmpeg 4.4+
- Node.js 18+
- Redis (可选，用于任务队列)

### 监控告警
- 后端日志: ELK Stack
- 性能监控: New Relic 或 DataDog
- 错误追踪: Sentry

---

## 11. 下一步行动

1. **初始化项目** → 生成 `1.项目初始化.md`
2. **设计数据库** → 生成 `2.数据库设计.md`
3. **设计 API** → 生成 `3.后端API设计.md`
4. **设计 UI** → 生成 `4.前端UI设计.md`
5. **编写代码** → 按功能分阶段实现
6. **集成测试** → 生成 `5.集成测试.md`
7. **部署上线** → 生成 `6.部署指南.md`

---

**文档版本**: v1.0  
**最后更新**: 2026-04-16  
**维护者**: 项目架构师
