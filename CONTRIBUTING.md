# Contributing Guide

## 分支命名规范
- `feature/<feature-name>`: 新功能开发
- `bugfix/<issue-name>`: 非紧急缺陷修复
- `hotfix/<issue-name>`: 紧急线上修复

## Commit 消息规范
- `feat:` 新功能
- `fix:` 缺陷修复
- `docs:` 文档变更
- `style:` 格式调整，不涉及逻辑变化
- `refactor:` 重构
- `test:` 测试相关
- `chore:` 构建、依赖、脚手架等杂项工作

示例：
```text
feat: initialize backend express skeleton
fix: normalize upload path validation
docs: add setup instructions for local mysql
```

## PR 流程
1. 从 `develop` 创建功能分支。
2. 完成开发后，先在本地执行必要验证。
3. 提交 Pull Request 到 `develop`。
4. 通过代码审查和基础检查后再合并。
5. 阶段验收完成后，再由 `develop` 合并到 `main`。

## 代码审查要求
- 说明本次改动的目标和影响范围。
- 说明已验证内容和未验证内容。
- 涉及接口或数据结构变化时，补充文档说明。
- 不提交明文密钥、测试垃圾文件和无关格式化改动。

## 开发约束
- 遵循 `docs/task/0.项目理解与开发约束.md` 中的分层、状态和安全约束。
- 长耗时任务必须保留异步化空间。
- 外部服务集成逻辑不得直接写入路由层。

## 本地开发流程
1. 切换到 `develop` 并同步最新代码。
2. 从 `develop` 创建功能分支，例如 `feature/stage-2-database`。
3. 安装依赖：
```bash
cd backend && npm install
cd ../frontend && npm install
```
4. 复制环境变量模板：
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```
5. 启动开发环境并完成自测。
6. 提交代码前记录已验证内容和未验证内容。
7. 推送功能分支并发起 PR 合并到 `develop`。
