# 贡献指南

本文档说明如何为 Fanshi-vidio-clone 项目做出贡献。

## Git 工作流

### 分支命名规范

- **feature/** - 新功能分支
  ```bash
  git checkout -b feature/video-upload
  git checkout -b feature/gemini-analysis
  ```

- **bugfix/** - 缺陷修复分支
  ```bash
  git checkout -b bugfix/upload-timeout
  ```

- **hotfix/** - 紧急修复分支 (仅从 main 拉出)
  ```bash
  git checkout -b hotfix/critical-bug
  ```

### 分支策略

```
main (生产分支)
  ↑
  │ (merge with PR)
  │
develop (集成分支)
  ↑
  │ (feature branches)
  │
feature/*, bugfix/*, hotfix/*
```

## Commit 消息规范

使用 Conventional Commits 格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

- **feat** - 新功能
  ```bash
  git commit -m "feat(video): add video upload endpoint"
  ```

- **fix** - 缺陷修复
  ```bash
  git commit -m "fix(upload): handle file size validation"
  ```

- **docs** - 文档更新
  ```bash
  git commit -m "docs: update README with HTTPS setup"
  ```

- **style** - 代码风格 (不影响功能)
  ```bash
  git commit -m "style: format code with prettier"
  ```

- **refactor** - 代码重构
  ```bash
  git commit -m "refactor(api): simplify error handling"
  ```

- **test** - 测试相关
  ```bash
  git commit -m "test: add unit tests for video service"
  ```

- **chore** - 构建、依赖等
  ```bash
  git commit -m "chore: update dependencies"
  ```

### Scope 范围

- backend
- frontend
- database
- docs
- ci
- config

### Subject 主题

- 使用祈使句 ("add" 而不是 "added")
- 不要大写首字母
- 不要在末尾加句号
- 限制在 50 个字符以内

### Body 正文

- 说明 **为什么** 做这个改变，而不是 **怎么做**
- 每行 72 个字符换行
- 可选，但建议对复杂改动添加

### Footer 页脚

- 关闭相关 Issue: `Closes #123`
- Breaking changes: `BREAKING CHANGE: description`

### 完整示例

```bash
git commit -m "feat(backend): implement video analysis with Gemini API

- Add geminiService.js for API integration
- Create /api/analysis/analyze endpoint
- Extract plot, characters, backgrounds, time anchors
- Store results in database

Closes #42"
```

## 开���流程

### 1. 创建功能分支

```bash
# 从 develop 拉出新分支
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name
```

### 2. 本地开发

```bash
# 后端开发
cd backend
npm run dev

# 前端开发 (新终端)
cd frontend
npm run dev
```

### 3. 提交代码

```bash
# 查看改动
git status
git diff

# 分阶段提交 (推荐)
git add backend/
git commit -m "feat(backend): implement video upload"

git add frontend/
git commit -m "feat(frontend): add upload component"

# 或一次性提交
git add .
git commit -m "feat: implement video upload feature"
```

### 4. 推送到远程

```bash
git push origin feature/your-feature-name
```

### 5. 创建 Pull Request

- 在 GitHub 上创建 PR
- 标题: 遵循 Commit 消息规范
- 描述: 说明改动内容、测试方法、相关 Issue
- 请求审查

### 6. 代码审查

- 至少 1 人审查通过
- 解决审查意见
- 更新代码后重新请求审查

### 7. 合并到 develop

```bash
# 审查通过后，在 GitHub 上合并 PR
# 或本地合并
git checkout develop
git pull origin develop
git merge feature/your-feature-name
git push origin develop
```

### 8. 删除功能分支

```bash
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

## 阶段验收与发布

### 阶段完成流程

1. 所有功能分支合并到 develop
2. 执行阶段验收检查清单
3. 从 develop 合并到 main

```bash
git checkout main
git pull origin main
git merge develop
git push origin main

# 创建版本标签 (可选)
git tag -a v0.2.0 -m "Release version 0.2.0"
git push origin v0.2.0
```

4. 返回 develop 继续开发

```bash
git checkout develop
```

## 代码审查要求

### 审查清单

- [ ] 代码遵循项目规范
- [ ] 功能完整且正确
- [ ] 没有明显的 bug
- [ ] 性能合理
- [ ] 安全性考虑周全
- [ ] 有适当的注释和文档
- [ ] 测试覆盖充分
- [ ] 没有硬编码的敏感信息

### 审查意见

- 使用建议性语言 ("Consider..." 而不是 "You must...")
- 解释 **为什么** 而不仅仅是 **什么**
- 提供改进建议或示例代码
- 对好的代码给予肯定

## 本地开发环境

### 前置要求

- Node.js >= 22.0.0
- MySQL >= 8.0
- Git

### 初始化

```bash
# 克隆仓库
git clone https://github.com/JeffreyZhu0201/Fanshi-vidio-clone.git
cd Fanshi-vidio-clone

# 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 配置环境变量
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 修改 backend/.env 中的数据库配置
# DB_HOST, DB_USER, DB_PASSWORD 等
```

### 启动开发服务器

```bash
# 终端 1: 后端
cd backend
npm run dev

# 终端 2: 前端
cd frontend
npm run dev
```

### 访问应用

- 前端: http://localhost:5173
- 后端: http://localhost:5000
- API 文档: http://localhost:5000/api-docs (待实现)

## 常见问题

### Q: 如何同步最新的 develop 分支?

```bash
git fetch origin
git rebase origin/develop
# 或
git merge origin/develop
```

### Q: 如何撤销本地提交?

```bash
# 撤销最后一次提交，保留改动
git reset --soft HEAD~1

# 撤销最后一次提交，丢弃改动
git reset --hard HEAD~1
```

### Q: 如何修改最后一次提交?

```bash
# 修改提交消息
git commit --amend -m "new message"

# 添加遗漏的文件
git add forgotten_file
git commit --amend --no-edit
```

### Q: 如何处理合并冲突?

```bash
# 查看冲突
git status

# 手动编辑冲突文件，然后
git add .
git commit -m "resolve merge conflicts"
```

## 相关资源

- [项目架构文档](docs/Overall_Arch.md)
- [阶段任务文档](docs/task/README.md)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Git 官方文档](https://git-scm.com/doc)

---

**最后更新**: 2026-04-16
