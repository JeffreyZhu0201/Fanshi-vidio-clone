# Fanshi-vidio-clone

一个基于 React、Node.js、MySQL、FFmpeg 和 AI 服务的视频复刻项目骨架。当前仓库已经完成阶段 0 和阶段 1 的基础搭建，后续将按阶段逐步实现视频解析、分段生成与拼接下载能力。

## 当前状态
- 已完成项目初始化骨架
- 已完成前后端目录拆分
- 已完成环境变量模板、Git 工作流文档和基础 CI
- 已完成 Express 与 Vite/Tailwind 的启动入口

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
VITE_API_BASE_URL=https://localhost:5443/api
VITE_DEV_HTTPS=true
VITE_SSL_KEY_PATH=../certs/dev/localhost-key.pem
VITE_SSL_CERT_PATH=../certs/dev/localhost.pem
```

4. 启动后访问：
- 前端：`https://localhost:5173`
- 后端：`https://localhost:5443`

说明：
- 这是本地自签名证书，浏览器第一次访问可能会提示风险，需要手动信任。
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

### 4. 启动前端
```bash
cd frontend
npm run dev
```

前端默认地址：`http://localhost:5173`

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
