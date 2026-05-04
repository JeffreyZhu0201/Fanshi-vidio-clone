# Fanshi Video Clone

一个基于 AI 的全栈视频分析与生成平台，可将上传的视频转换为完整的生产就绪脚本，包含角色设计、场景参考和自动化视频生成。

## ✨ 核心功能

### 主要能力
- **视频分析**：上传视频并使用 Doubao-Seed API 提取全面分析
- **AI 脚本生成**：自动生成详细脚本，包含逐镜头分解
- **角色设计**：使用 Gemini API 生成角色转身图和参考图像
- **场景管理**：创建和管理场景参考图像用于制作
- **视频生成**：使用 Seedance API 自动化视频生成
- **资源管理**：组织和跟踪所有制作资产

### 技术特性
- RESTful API 与全面验证
- 支持分块的文件上传
- 异步任务处理
- 数据库迁移和种子数据
- 全面的测试覆盖（117 个测试）
- Docker 容器化
- 生产就绪的部署配置

## 🏗️ 架构

### 技术栈
- **前端**：React 18 + Vite + TailwindCSS
- **后端**：Node.js 18 + Express
- **数据库**：MySQL 8.0
- **AI 服务**：
  - Doubao-Seed API（视频分析）
  - Gemini API（图像生成）
  - Seedance API（视频生成）
- **基础设施**：Docker + Nginx

### 项目结构
```
├── backend/              # Node.js 后端
│   ├── controllers/      # 请求处理器
│   ├── services/         # 业务逻辑
│   ├── models/           # 数据库模型
│   ├── routes/           # API 路由
│   ├── utils/            # 工具函数
│   └── __tests__/        # 测试套件
├── frontend/             # React 前端
│   ├── src/
│   │   ├── components/   # React 组件
│   │   ├── hooks/        # 自定义 Hooks
│   │   ├── services/     # API 客户端
│   │   └── pages/        # 页面组件
├── docs/                 # 文档
├── scripts/              # 部署脚本
└── uploads/              # 文件存储
```

## 🚀 快速开始

### 前置要求

- Node.js 18+
- MySQL 8.0+
- Docker & Docker Compose（用于容器化部署）
- API 密钥：
  - Doubao-Seed API key
  - Google Gemini API key
  - Seedance API credentials

### 本地开发

1. **克隆仓库**
   ```bash
   git clone https://github.com/JeffreyZhu0201/Fanshi-vidio-clone.git
   cd Fanshi-vidio-clone
   ```

2. **安装依赖**
   ```bash
   # 后端
   cd backend
   npm install
   
   # 前端
   cd ../frontend
   npm install
   ```

3. **配置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env 填入你的配置
   ```

4. **设置数据库**
   ```bash
   cd backend
   npm run db:migrate
   npm run db:seed
   ```

5. **启动开发服务器**
   ```bash
   # 后端（端口 5000）
   cd backend
   npm run dev
   
   # 前端（端口 5173）
   cd frontend
   npm run dev
   ```

6. **访问应用**
   - 前端：http://localhost:5173
   - 后端 API：http://localhost:5000

### Docker 部署

使用 Docker 进行生产部署：

```bash
# 构建并启动所有服务
docker-compose up -d

# 检查服务健康状态
./scripts/health-check.sh

# 查看日志
docker-compose logs -f
```

详细部署说明请参阅 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 📚 文档

- [部署指南](docs/DEPLOYMENT.md) - 完整的部署说明
- [运维手册](docs/OPERATIONS.md) - 日常运维和维护
- [API 文档](docs/API.md) - API 端点和使用方法
- [开发工作流](docs/DEVELOPMENT.md) - 开发指南和最佳实践

## 🧪 测试

```bash
# 运行所有测试
cd backend
npm test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 运行特定测试套件
npm test -- doubaoSeedService.test.js
```

当前测试覆盖：12 个测试套件中的 117 个测试，全部通过。

## 🔧 可用脚本

### 后端
- `npm run dev` - 启动开发服务器（热重载）
- `npm start` - 启动生产服务器
- `npm test` - 运行测试套件
- `npm run db:migrate` - 运行数据库迁移
- `npm run db:seed` - 填充示例数据

### 前端
- `npm run dev` - 启动开发服务器
- `npm run build` - 构建生产版本
- `npm run preview` - 预览生产构建
- `npm run lint` - 运行 ESLint

### 部署
- `./scripts/deploy.sh` - 部署到生产环境
- `./scripts/rollback.sh` - 回滚到上一版本
- `./scripts/backup.sh` - 备份数据库和文件
- `./scripts/restore.sh` - 从备份恢复
- `./scripts/health-check.sh` - 检查应用健康状态

## 🔐 环境变量

关键环境变量（完整列表见 `.env.example`）：

```env
# 服务器
NODE_ENV=development
PORT=5000

# 数据库
DB_HOST=localhost
DB_PORT=3306
DB_NAME=fanshi_video
DB_USER=root
DB_PASSWORD=your_password

# AI 服务
DOUBAO_API_KEY=your_doubao_key
GEMINI_API_KEY=your_gemini_key
SEEDANCE_API_KEY=your_seedance_key
SEEDANCE_API_SECRET=your_seedance_secret

# 文件存储
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=500000000
```

## 🛠️ 开发工作流

1. 从 `develop` 创建功能分支
2. 实现变更并编写测试
3. 运行测试套件：`npm test`
4. 构建前端：`cd frontend && npm run build`
5. 使用约定式提交格式提交
6. 推送并创建 PR 到 `develop`

## 📊 项目状态

**当前版本**：1.0.0（生产就绪）

**已完成功能**：
- ✅ 视频上传和分析
- ✅ AI 脚本生成
- ✅ 角色和场景管理
- ✅ 资源图像生成
- ✅ 视频生成集成
- ✅ 数据库迁移
- ✅ 全面的测试覆盖
- ✅ Docker 容器化
- ✅ 生产部署配置
- ✅ 完整文档

## 🎯 核心工作流程

### 1. 视频上传与分析
- 上传视频文件（支持分块上传）
- 使用 Doubao-Seed Files API 上传到云端
- 调用 Responses API 进行视频分析
- 提取镜头、角色、场景等元数据

### 2. 脚本生成
- 基于视频分析结果生成详细脚本
- 逐镜头分解，包含对话、动作、场景描述
- 支持手动编辑和调整

### 3. 资源生成
- **角色设计**：使用 Gemini API 生成角色转身图
- **场景参考**：生成场景参考图像
- 所有资源可预览、下载和管理

### 4. 视频生成
- 使用 Seedance API 生成视频
- 支持完整视频一次性生成（保持视觉一致性）
- 异步任务处理，实时进度更新

## 🔄 API 迁移说明

### Doubao-Seed API 迁移
项目已从 Chat Completions API 迁移到 Files API + Responses API 工作流：

**旧方式（已废弃）**：
```javascript
// 直接传递视频 URL
POST /chat/completions
{
  "messages": [{ "role": "user", "content": [...] }]
}
```

**新方式（当前）**：
```javascript
// 1. 上传文件
POST /files
FormData: { file: videoFile }
Response: { id: "file_id" }

// 2. 创建分析任务
POST /responses
{
  "input": [
    { "type": "input_video", "input_video": { "file_id": "file_id" } },
    { "type": "input_text", "input_text": { "text": "prompt" } }
  ]
}
```

### 图像生成统一到 Gemini
所有图像生成功能（角色转身图、场景参考图）已统一使用 Gemini API，不再使用 Doubao-Seedream。

## 🤝 贡献

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交变更（`git commit -m 'feat: add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 创建 Pull Request

## 📝 许可证

MIT License - 详见 LICENSE 文件

## 🙏 致谢

- Doubao-Seed API 提供视频分析能力
- Google Gemini API 提供图像生成能力
- Seedance API 提供视频生成能力

## 📧 联系方式

项目链接：https://github.com/JeffreyZhu0201/Fanshi-vidio-clone

---

**注意**：本项目需要 Doubao-Seed、Gemini 和 Seedance 服务的有效 API 密钥。请联系相应服务提供商获取访问权限。
