# Fanshi Video Clone - 部署指南

## 目录
- [系统要求](#系统要求)
- [快速开始](#快速开始)
- [部署步骤](#部署步骤)
- [配置说明](#配置说明)
- [运维操作](#运维操作)
- [故障排查](#故障排查)
- [安全建议](#安全建议)

## 系统要求

### 硬件要求
- **CPU**: 4核或以上
- **内存**: 8GB 或以上
- **磁盘**: 100GB 或以上（SSD 推荐）
- **网络**: 稳定的互联网连接

### 软件要求
- **操作系统**: Ubuntu 22.04 LTS 或更高版本
- **Docker**: 20.10 或以上
- **Docker Compose**: v2.0 或以上
- **Git**: 2.x

## 快速开始

### 1. 克隆项目
```bash
git clone https://github.com/your-org/Fanshi_vidio_clone.git
cd Fanshi_vidio_clone
```

### 2. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，配置必要的环境变量
nano .env
```

### 3. 启动服务
```bash
# 使用部署脚本（推荐）
./scripts/deploy.sh

# 或手动启动
docker compose up -d
```

### 4. 验证部署
```bash
./scripts/health-check.sh
```

## 部署步骤

### 步骤 1: 准备服务器

#### 安装 Docker
```bash
# 更新包索引
sudo apt-get update

# 安装依赖
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# 添加 Docker 官方 GPG 密钥
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 设置 Docker 仓库
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 验证安装
docker --version
docker compose version
```

#### 配置 Docker（可选）
```bash
# 将当前用户添加到 docker 组
sudo usermod -aG docker $USER

# 重新登录以使更改生效
newgrp docker

# 配置 Docker 守护进程
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

# 重启 Docker
sudo systemctl restart docker
```

### 步骤 2: 配置环境变量

创建 `.env` 文件并配置以下变量：

```bash
# 数据库配置
MYSQL_ROOT_PASSWORD=your_secure_root_password
MYSQL_DATABASE=fanshi_video
MYSQL_USER=fanshi
MYSQL_PASSWORD=your_secure_password
MYSQL_PORT=3306

# 后端配置
NODE_ENV=production
BACKEND_PORT=5000
JWT_SECRET=your_jwt_secret_key_change_this

# AI 服务配置
GEMINI_API_KEY=your_gemini_api_key
GEMINI_API_BASE_URL=https://yunwu.ai
SEED_DANCE_API_KEY=your_seedance_api_key
SEED_DANCE_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_PUBLIC_BASE_URL=https://your-domain.com

# 前端配置
FRONTEND_PORT=3000

# Nginx 配置
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443
```

### 步骤 3: SSL 证书配置（生产环境）

#### 使用 Let's Encrypt（推荐）
```bash
# 安装 Certbot
sudo apt-get install -y certbot

# 获取证书
sudo certbot certonly --standalone -d your-domain.com

# 复制证书到项目目录
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem nginx/ssl/key.pem
sudo chown $USER:$USER nginx/ssl/*.pem
```

#### 使用自签名证书（开发/测试）
```bash
./scripts/generate-dev-ssl.sh
```

### 步骤 4: 部署应用

#### 使用部署脚本（推荐）
```bash
./scripts/deploy.sh
```

部署脚本会自动执行以下操作：
1. 检查系统要求
2. 备份当前数据
3. 拉取最新代码
4. 构建 Docker 镜像
5. 启动服务
6. 运行数据库迁移
7. 执行健康检查

#### 手动部署
```bash
# 1. 构建镜像
docker compose build

# 2. 启动服务
docker compose up -d

# 3. 查看日志
docker compose logs -f

# 4. 检查服务状态
docker compose ps
```

### 步骤 5: 验证部署

```bash
# 运行健康检查
./scripts/health-check.sh

# 检查后端
curl http://localhost:5000/api/health

# 检查前端
curl http://localhost:3000

# 查看容器状态
docker compose ps

# 查看日志
docker compose logs --tail=50
```

## 配置说明

### Docker Compose 配置

`docker-compose.yml` 定义了以下服务：

- **mysql**: MySQL 8.0 数据库
- **backend**: Node.js 后端服务
- **frontend**: React 前端服务（Nginx）
- **nginx**: 反向代理（可选，用于生产环境）

### Nginx 配置

#### 主配置文件: `nginx/nginx.conf`
- Worker 进程配置
- 日志配置
- Gzip 压缩
- 客户端上传大小限制（500MB）

#### 站点配置: `nginx/conf.d/default.conf`
- HTTP 到 HTTPS 重定向
- SSL/TLS 配置
- 反向代理配置
- 安全头配置
- 静态文件缓存

### 环境变量说明

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `MYSQL_ROOT_PASSWORD` | MySQL root 密码 | rootpassword |
| `MYSQL_DATABASE` | 数据库名称 | fanshi_video |
| `MYSQL_USER` | 数据库用户 | fanshi |
| `MYSQL_PASSWORD` | 数据库密码 | fanshipassword |
| `NODE_ENV` | Node.js 环境 | production |
| `JWT_SECRET` | JWT 密钥 | - |
| `GEMINI_API_KEY` | Gemini API 密钥 | - |
| `SEED_DANCE_API_KEY` | Seedance API 密钥 | - |
| `DOUBAO_PUBLIC_BASE_URL` | Doubao 公共 URL | - |

## 运维操作

### 日常操作

#### 启动服务
```bash
docker compose up -d
```

#### 停止服务
```bash
docker compose down
```

#### 重启服务
```bash
docker compose restart
```

#### 查看日志
```bash
# 查看所有服务日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mysql
```

#### 查看服务状态
```bash
docker compose ps
```

### 备份操作

#### 创建备份
```bash
./scripts/backup.sh
```

备份内容包括：
- 数据库（MySQL dump）
- 上传文件（uploads 目录）
- 配置文件（.env, docker-compose.yml, nginx/）

备份文件保存在 `./backups/` 目录，格式：
- `db_backup_YYYYMMDD_HHMMSS.sql.gz`
- `uploads_backup_YYYYMMDD_HHMMSS.tar.gz`
- `config_backup_YYYYMMDD_HHMMSS.tar.gz`

#### 恢复备份
```bash
./scripts/restore.sh
```

脚本会列出可用的备份，选择要恢复的时间戳即可。

### 回滚操作

如果部署出现问题，可以回滚到之前的版本：

```bash
./scripts/rollback.sh
```

回滚脚本会：
1. 列出可用的备份
2. 备份当前状态
3. 恢复选定的备份
4. 重启服务
5. 验证恢复结果

### 更新操作

#### 更新应用代码
```bash
# 拉取最新代码
git pull origin main

# 重新部署
./scripts/deploy.sh
```

#### 更新 Docker 镜像
```bash
# 重新构建镜像
docker compose build --no-cache

# 重启服务
docker compose up -d
```

### 监控操作

#### 查看资源使用情况
```bash
# 查看容器资源使用
docker stats

# 查看磁盘使用
df -h

# 查看内存使用
free -h
```

#### 健康检查
```bash
./scripts/health-check.sh
```

## 故障排查

### 常见问题

#### 1. 容器无法启动

**症状**: `docker compose up` 失败

**排查步骤**:
```bash
# 查看容器日志
docker compose logs

# 检查端口占用
sudo netstat -tulpn | grep -E ':(3000|5000|3306)'

# 检查磁盘空间
df -h

# 检查 Docker 状态
sudo systemctl status docker
```

**解决方案**:
- 释放被占用的端口
- 清理磁盘空间
- 重启 Docker 服务

#### 2. 数据库连接失败

**症状**: 后端无法连接数据库

**排查步骤**:
```bash
# 检查 MySQL 容器状态
docker compose ps mysql

# 查看 MySQL 日志
docker compose logs mysql

# 测试数据库连接
docker exec fanshi-mysql mysql -u root -p
```

**解决方案**:
- 检查 `.env` 中的数据库配置
- 确保 MySQL 容器正在运行
- 检查数据库用户权限

#### 3. 文件上传失败

**症状**: 上传视频时报错

**排查步骤**:
```bash
# 检查 uploads 目录权限
ls -la backend/uploads

# 检查磁盘空间
df -h

# 查看后端日志
docker compose logs backend | grep -i upload
```

**解决方案**:
- 确保 uploads 目录有写权限
- 清理磁盘空间
- 检查 Nginx 上传大小限制

#### 4. API 调用超时

**症状**: 前端请求超时

**排查步骤**:
```bash
# 检查后端健康状态
curl http://localhost:5000/api/health

# 查看后端日志
docker compose logs backend --tail=100

# 检查网络连接
docker network ls
docker network inspect fanshi-network
```

**解决方案**:
- 增加超时时间配置
- 检查 AI 服务 API 密钥
- 优化数据库查询

#### 5. 前端页面无法加载

**症状**: 浏览器无法访问前端

**排查步骤**:
```bash
# 检查前端容器状态
docker compose ps frontend

# 查看前端日志
docker compose logs frontend

# 测试前端端口
curl http://localhost:3000
```

**解决方案**:
- 重启前端容器
- 检查 Nginx 配置
- 清除浏览器缓存

### 日志分析

#### 后端日志位置
- 容器内: `/app/logs/`
- 主机: `backend/logs/`

#### 查看日志命令
```bash
# 实时查看所有日志
docker compose logs -f

# 查看最近 100 行日志
docker compose logs --tail=100

# 查看特定时间范围的日志
docker compose logs --since 2024-01-01T00:00:00

# 搜索错误日志
docker compose logs | grep -i error
```

## 安全建议

### 1. 密码安全
- 使用强密码（至少 16 位，包含大小写字母、数字和特殊字符）
- 定期更换密码
- 不要在代码中硬编码密码

### 2. API 密钥管理
- 将 API 密钥存储在 `.env` 文件中
- 不要将 `.env` 文件提交到版本控制
- 定期轮换 API 密钥

### 3. 网络安全
- 使用 HTTPS（生产环境必须）
- 配置防火墙规则
- 限制数据库端口访问

### 4. 容器安全
- 使用非 root 用户运行容器
- 定期更新 Docker 镜像
- 扫描镜像漏洞

### 5. 数据安全
- 定期备份数据
- 加密敏感数据
- 实施访问控制

### 防火墙配置示例

```bash
# 允许 SSH
sudo ufw allow 22/tcp

# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 拒绝直接访问数据库（仅允许本地）
sudo ufw deny 3306/tcp

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

## 性能优化

### 1. 数据库优化
```sql
-- 添加索引
CREATE INDEX idx_video_id ON analyses(video_id);
CREATE INDEX idx_created_at ON videos(created_at);

-- 定期优化表
OPTIMIZE TABLE videos;
OPTIMIZE TABLE analyses;
```

### 2. Nginx 缓存配置
```nginx
# 在 nginx/conf.d/default.conf 中添加
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=my_cache:10m max_size=1g inactive=60m;

location /api {
    proxy_cache my_cache;
    proxy_cache_valid 200 10m;
    proxy_cache_use_stale error timeout http_500 http_502 http_503 http_504;
}
```

### 3. Docker 资源限制
```yaml
# 在 docker-compose.yml 中添加
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

## 监控和告警

### 使用 Prometheus + Grafana（可选）

#### 1. 添加 Prometheus 配置
```yaml
# docker-compose.yml
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
```

#### 2. 添加 Grafana
```yaml
  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

## 附录

### 常用命令速查

```bash
# 部署
./scripts/deploy.sh

# 备份
./scripts/backup.sh

# 恢复
./scripts/restore.sh

# 回滚
./scripts/rollback.sh

# 健康检查
./scripts/health-check.sh

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 清理资源
docker system prune -a
```

### 联系支持

如有问题，请联系：
- GitHub Issues: https://github.com/your-org/Fanshi_vidio_clone/issues
- Email: support@example.com
