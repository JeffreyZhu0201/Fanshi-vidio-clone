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

