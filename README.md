# Fanshi-vidio-clone

一个基于 React、Node.js、MySQL、FFmpeg 和 AI 服务的视频复刻项目骨架。当前仓库已经完成阶段 0、阶段 1、阶段 2，并已落地阶段 3 的后端 API 主流程。

## 当前状态
- 已完成项目初始化骨架
- 已完成前后端目录拆分
- 已完成环境变量模板、Git 工作流文档和基础 CI
- 已完成 Express 与 Vite/Tailwind 的启动入口
- 已完成 MySQL Schema、Sequelize 模型、迁移与种子数据
- 已完成上传、整片分析、视频分割、完整视频生成、视频下载 API
- 已完成阶段 5 的后端集成测试、前端组件测试、性能监控与安全加固骨架
- 已补齐前端实时事件上下文过滤，避免多视频或旧任务进度串线污染当前工作台
- 已补齐整片分析超时后的结果恢复，避免后端已落库但前端因 30 秒超时直接判死
- 已补齐页面刷新恢复能力，刷新后可恢复当前视频以及分割/拼接任务进度
- 已统一片段卡片预览来源与 merge 实际素材来源，失败重试时仍可保留上次成功结果预览
- 已补齐 split / optimize / generate / merge 的异常处理与轮询取消，切换视频或组件卸载后不会把 UI 卡死在处理中
- 已补齐新视频切换时的上下文重置，上传或切换到新视频时会先清空旧分析、旧片段和旧任务进度，再加载新数据
- 已补齐上传阶段的时长上限与重复上传检查，前端会预检查，后端会基于元数据做最终校验
- 已对齐健康检查状态映射，当前前端可以区分后端在线、数据库降级和服务离线三种状态
- 已对齐 split 错误字段消费，分割失败时会同时兼容实时事件的 `error_message` 和任务查询返回的 `message`
- 已接入 `yunwu.ai` 的 Gemini 真实调用链，支持通过 `generateContent` 对整片视频和片段视频做真实分析
- 已接入火山方舟 SeedDance 异步任务接口，支持创建任务、轮询结果并把远程生成视频落回本地 `uploads/outputs`
- 已实现完整视频一次性生成，通过拼接所有镜头描述为单一提示词，保持全片视觉一致性

## 技术栈

### 前端
- React
- Vite
- Tailwind CSS
- Zustand
- Axios

### 后端
- Node.js
- Express
- Sequelize
- MySQL
- Winston

## 目录结构
```text
Fanshi-vidio-clone/
├── backend/                 # Node.js / Express 后端
├── frontend/                # React / Vite 前端
├── docs/                    # 项目文档和阶段任务
├── prompts/                 # 提示词与上下文
├── .github/workflows/       # CI 配置
├── CONTRIBUTING.md          # Git 工作流与协作规范
└── README.md
```

## 本地启动

### 1. 安装依赖
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. 配置环境变量
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### 3. 启动后端
```bash
cd backend
npm run dev
```

后端默认地址：`http://localhost:5000`

### 本地 HTTPS 访问
项目现在已经支持前后端本地 HTTPS 开发。推荐按下面的顺序启用：

1. 生成本地开发证书：
```bash
chmod +x scripts/generate-dev-ssl.sh
./scripts/generate-dev-ssl.sh
```

2. 配置后端 `backend/.env`：
```env
APP_ORIGIN=https://localhost:5173
HTTPS_ENABLED=true
HTTPS_PORT=5443
SSL_KEY_PATH=../certs/dev/localhost-key.pem
SSL_CERT_PATH=../certs/dev/localhost.pem
HTTP_REDIRECT_TO_HTTPS=false
```

3. 配置前端 `frontend/.env`：
```env
VITE_API_BASE_URL=/api
VITE_API_PROXY_TARGET=https://localhost:5443
VITE_DEV_HOST=localhost
VITE_DEV_HTTPS=true
VITE_SSL_KEY_PATH=../certs/dev/localhost-key.pem
VITE_SSL_CERT_PATH=../certs/dev/localhost.pem
```

4. 启动后访问：
- 前端：`https://localhost:5173`
- 后端：`https://localhost:5443`

说明：
- 开发环境推荐始终通过 `https://localhost:5173` 访问前端，前端会把 `/api`、`/uploads`、`/ws` 同源代理到后端，避免浏览器直接校验后端自签名证书导致健康检查和上传失败。
- 这是本地自签名证书，浏览器第一次访问前端 `https://localhost:5173` 可能会提示风险，需要手动信任。
- 如果只想让后端支持 HTTPS，可以只开启后端的 `HTTPS_ENABLED=true`。
- 如果希望 `http://localhost:5000` 自动跳到 HTTPS，可以把 `HTTP_REDIRECT_TO_HTTPS=true`。

### MySQL 连接配置
后端使用 Sequelize 连接 MySQL，并支持在数据库服务可访问时自动创建 `DB_NAME` 指定的数据库。

1. 复制环境变量模板：
```bash
cp backend/.env.example backend/.env
```

2. 按你的 MySQL 实例修改这些字段：
```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=fanshi_video_db
DB_AUTO_CREATE=true
```

3. 单独检查数据库连接：
```bash
cd backend
npm run db:check
```

4. 初始化或迁移数据库结构：
```bash
cd backend
npm run db:init
npm run db:migrate
npm run db:seed
```

5. 健康检查接口：
- `GET /api/health`：返回后端状态和数据库状态
- `GET /api/health/database`：只检查数据库，可用于运维探活

前端工作台当前会按下面的口径展示后端状态：
- `online`：后端和数据库都可用
- `degraded`：后端在线，但数据库检查失败
- `offline`：健康检查请求失败，前端无法连到后端

### 真实 AI 配置
当前后端支持两套真实 AI 配置：

- Gemini 视频理解：`yunwu.ai` 的 `gemini-2.5-pro`
- 视频生成：火山方舟 `doubao-seedance-*`

建议在 `backend/.env` 中补齐这些字段：

```env
PUBLIC_ASSET_BASE_URL=
GEMINI_API_KEY=
GEMINI_API_BASE_URL=https://yunwu.ai
GEMINI_MODEL=gemini-2.5-pro
GEMINI_SEGMENT_MODEL=gemini-2.5-flash
GEMINI_API_COMPAT_MODE=google
GEMINI_STRICT_REMOTE=false
SEED_DANCE_API_KEY=
SEED_DANCE_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
SEED_DANCE_MODEL=doubao-seedance-2-0-260128
SEED_DANCE_STRICT_REMOTE=false
SEED_DANCE_POLL_INTERVAL_MS=10000
SEED_DANCE_MAX_WAIT_MS=900000
SEED_DANCE_RATIO=16:9
SEED_DANCE_DURATION_SECONDS=5
SEED_DANCE_RESOLUTION=720p
SEED_DANCE_GENERATE_AUDIO=false
SEED_DANCE_WATERMARK=false
```

补充说明：
- `PUBLIC_ASSET_BASE_URL`：部署后如果有公网可访问的静态资源域名，可以配置这个值，让 SeedDance 额外携带 `reference_video`。
- `GEMINI_STRICT_REMOTE=true`：开启后，如果真实 Gemini 调用失败，将不再自动回退 mock，适合联调和验收。
- `SEED_DANCE_STRICT_REMOTE=true`：开启后，如果真实 SeedDance 调用失败，将不再自动回退本地复制生成。

### 上传校验补充
当前上传链路已经具备以下校验：

- 前端：格式、MIME、文件大小、同名同大小重复文件、可读取时的时长上限预检查
- 后端：格式、MIME、文件大小、`ffprobe` 元数据时长上限、`filename + file_size` 轻量重复校验

默认视频时长上限为 `10` 分钟。前端预检查用于尽早提示，后端校验仍然是最终准入标准。

### 主流程 API

当前主流程：

1. **上传原视频** → `POST /api/videos/upload`
2. **整片分析** → `POST /api/analysis/analyze` (Gemini 分析剧情、角色、场景、镜头时间和对白)
3. **生成资源图** → `POST /api/resource-images/generate` (角色三视图和场景参考图)
4. **生成完整视频** → `POST /api/generation/generate` (后端自动使用 `buildFullVideoPrompt()` 拼接所有镜头描述，单次 Seedance 调用生成全片)
5. **下载结果** → `GET /api/generation/:taskId/download` (完整视频，无需拼接)

其他接口：

- `GET /api/videos/:id`：查询视频详情
- `DELETE /api/videos/:id`：删除视频及相关文件
- `GET /api/analysis/:videoId`：查询整片分析结果
- `POST /api/analysis/optimize-prompt`：优化提示词并高亮 `@角色`
- `POST /api/segments/split`：按时间锚点发起分割任务（用于预览和调试）
- `GET /api/segments/:videoId`：查询片段列表
- `GET /api/generation/:taskId`：查询生成任务状态
- `GET /api/tasks/:taskId`：查询分割任务状态
- `GET /api/metrics`：导出 Prometheus 指标
- `POST /api/monitoring/events`：接收前端 Web Vitals / 运行时错误事件

接口文档地址：
- Swagger UI：`/api-docs`
- OpenAPI JSON：`/api-docs.json`

### 4. 启动前端
```bash
cd frontend
npm run dev
```

前端默认地址：`http://localhost:5173`，若 `VITE_DEV_HTTPS=true` 则使用 `https://localhost:5173`

## 阶段 5 验证

### 自动化验证命令
```bash
cd backend && npm run test:coverage
cd ../frontend && npm test
cd ../frontend && npm run test:coverage
cd ../frontend && npm run build
```

### 真实 AI 联调命令
```bash
cd backend
npm run ai:smoke
npm run pipeline:smoke
```

- `ai:smoke`：验证 Gemini / SeedDance 服务本身是否可连通。
- `pipeline:smoke`：验证上传、分析、分割、优化、生成、拼接、下载的主链路。

截至 `2026-04-17` 的一次本机验证结果：
- `Gemini analyzeVideo` 已成功走通真实 `yunwu.ai`。
- `Gemini optimizePrompt` 已使用 `gemini-2.5-pro` 成功返回真实优化结果。
- `GEMINI_SEGMENT_MODEL=gemini-2.5-flash` 的最小联通验证已返回 `200`。
- `SeedDance` 真实视频生成代码已接入，但由于尚未配置 `SEED_DANCE_API_KEY`，当前完整链路中的“生成片段”仍会走本地 `mock-copy`。

### 性能基准
先启动后端，再执行：
```bash
cd backend
npm run perf:benchmark
```

可选环境变量：
- `BENCHMARK_BASE_URL`：默认 `http://127.0.0.1:5000`
- `BENCHMARK_REQUESTS`：默认 `20`
- `BENCHMARK_CONCURRENCY`：默认 `5`
- `BENCHMARK_THRESHOLD_MS`：默认 `500`

### 部署前检查
```bash
./scripts/preflight-check.sh
```

可选开关：
- `RUN_E2E=true ./scripts/preflight-check.sh`
- `RUN_PERF_BENCHMARK=true ./scripts/preflight-check.sh`

### 当前已知限制
- Cypress 端到端脚本已经在 `frontend/cypress/` 中完成，但在当前这台 Ubuntu 22.04 开发机上执行 `npm run test:e2e` 仍需要系统安装 `Xvfb`。
- `frontend` 当前 `npm audit` 仍有 2 个 `moderate` 级开发期漏洞，来源于 Vite 开发服务器依赖；截至 `2026-04-17` 没有 `high` 或 `critical` 漏洞。

## Git 工作流
- 稳定分支：`main`
- 集成分支：`develop`
- 功能分支：`feature/*`
- 缺陷分支：`bugfix/*`
- 紧急修复：`hotfix/*`

阶段开发流程：
1. 从 `develop` 拉出功能分支
2. 在功能分支完成开发和自测
3. 合并回 `develop`
4. 阶段验收后再从 `develop` 合并到 `main`

## 项目文档
- [阶段 0 基线文档](/home/zhuzy2024/workspace/Fanshi_vidio_clone/docs/task/0.项目理解与开发约束.md)
- [阶段任务索引](/home/zhuzy2024/workspace/Fanshi_vidio_clone/docs/task/README.md)
- [整体架构设计](/home/zhuzy2024/workspace/Fanshi_vidio_clone/docs/Overall_Arch.md)

## 后续阶段
- 阶段 2：数据库设计与迁移
- 阶段 3：上传、分析、分割、生成、拼接 API
- 阶段 4：前端工作台与交互
- 阶段 5：测试、性能和安全
- 阶段 6：部署、备份与运维
