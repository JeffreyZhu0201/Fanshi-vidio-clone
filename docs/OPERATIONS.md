# Fanshi Video Clone - 运维手册

## 目录
- [日常运维](#日常运维)
- [定期维护](#定期维护)
- [容量规划](#容量规划)
- [灾难恢复](#灾难恢复)
- [升级流程](#升级流程)
- [监控告警](#监控告警)
- [应急响应](#应急响应)

## 日常运维

### 服务管理

#### 启动服务
```bash
# 启动所有服务
docker compose up -d

# 启动特定服务
docker compose up -d backend
docker compose up -d frontend
docker compose up -d mysql
```

#### 停止服务
```bash
# 停止所有服务
docker compose down

# 停止特定服务
docker compose stop backend
docker compose stop frontend
docker compose stop mysql
```

#### 重启服务
```bash
# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart backend
docker compose restart frontend
docker compose restart mysql
```

#### 查看服务状态
```bash
# 查看所有服务状态
docker compose ps

# 查看详细状态
docker compose ps -a

# 查看资源使用情况
docker stats
```

### 日志管理

#### 查看日志
```bash
# 实时查看所有服务日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mysql

# 查看最近 N 行日志
docker compose logs --tail=100 backend

# 查看特定时间范围的日志
docker compose logs --since 2024-01-01T00:00:00 backend
docker compose logs --until 2024-01-02T00:00:00 backend

# 搜索日志
docker compose logs backend | grep -i error
docker compose logs backend | grep -i warning
```

#### 日志清理
```bash
# 清理 Docker 日志
sudo sh -c "truncate -s 0 /var/lib/docker/containers/*/*-json.log"

# 清理应用日志（保留最近 7 天）
find backend/logs -name "*.log" -mtime +7 -delete

# 配置日志轮转
sudo tee /etc/logrotate.d/fanshi-video <<EOF
/home/user/Fanshi_vidio_clone/backend/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
EOF
```

### 性能监控

#### 系统资源监控
```bash
# CPU 使用率
top
htop

# 内存使用
free -h
vmstat 1

# 磁盘使用
df -h
du -sh backend/uploads/*

# 磁盘 I/O
iostat -x 1

# 网络流量
iftop
nethogs
```

#### 容器资源监控
```bash
# 查看容器资源使用
docker stats

# 查看特定容器资源使用
docker stats fanshi-backend fanshi-frontend fanshi-mysql

# 导出资源使用数据
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" > stats.txt
```

#### 数据库性能监控
```bash
# 连接到 MySQL
docker exec -it fanshi-mysql mysql -u root -p

# 查看当前连接
SHOW PROCESSLIST;

# 查看慢查询
SHOW VARIABLES LIKE 'slow_query%';
SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;

# 查看表状态
SHOW TABLE STATUS;

# 查看索引使用情况
SHOW INDEX FROM videos;
SHOW INDEX FROM analyses;
```

### 备份验证

#### 每日备份检查
```bash
# 运行备份脚本
./scripts/backup.sh

# 验证备份文件
ls -lh backups/

# 检查备份完整性
gunzip -t backups/db_backup_*.sql.gz
tar -tzf backups/uploads_backup_*.tar.gz > /dev/null
```

#### 每周恢复测试
```bash
# 在测试环境恢复备份
./scripts/restore.sh

# 验证数据完整性
docker exec fanshi-mysql mysql -u root -p -e "USE fanshi_video; SELECT COUNT(*) FROM videos;"

# 验证文件完整性
ls -la backend/uploads/
```

## 定期维护

### 每日维护任务

#### 1. 健康检查
```bash
# 运行健康检查脚本
./scripts/health-check.sh

# 检查服务状态
docker compose ps

# 检查磁盘空间
df -h | grep -E '(Filesystem|/$|/home)'
```

#### 2. 日志检查
```bash
# 检查错误日志
docker compose logs --since 24h | grep -i error | wc -l

# 检查警告日志
docker compose logs --since 24h | grep -i warning | wc -l

# 检查异常访问
docker compose logs nginx --since 24h | grep -E '(404|500|502|503)'
```

#### 3. 备份
```bash
# 执行每日备份
./scripts/backup.sh

# 验证备份成功
ls -lh backups/ | tail -5
```

### 每周维护任务

#### 1. 系统更新
```bash
# 更新系统包
sudo apt-get update
sudo apt-get upgrade -y

# 更新 Docker
sudo apt-get install --only-upgrade docker-ce docker-ce-cli containerd.io
```

#### 2. 数据库优化
```bash
# 连接到数据库
docker exec -it fanshi-mysql mysql -u root -p

# 优化表
USE fanshi_video;
OPTIMIZE TABLE videos;
OPTIMIZE TABLE analyses;
OPTIMIZE TABLE segments;
OPTIMIZE TABLE generation_tasks;

# 分析表
ANALYZE TABLE videos;
ANALYZE TABLE analyses;

# 检查表
CHECK TABLE videos;
CHECK TABLE analyses;
```

#### 3. 清理临时文件
```bash
# 清理 Docker 未使用的资源
docker system prune -f

# 清理旧的日志文件
find backend/logs -name "*.log" -mtime +7 -delete

# 清理临时上传文件
find backend/uploads/temp -mtime +1 -delete
```

#### 4. 备份恢复测试
```bash
# 在测试环境恢复最新备份
./scripts/restore.sh

# 验证恢复结果
./scripts/health-check.sh
```

### 每月维护任务

#### 1. 安全更新
```bash
# 检查安全更新
sudo apt-get update
sudo apt list --upgradable | grep -i security

# 应用安全更新
sudo apt-get upgrade -y

# 更新 Docker 镜像
docker compose pull
docker compose up -d
```

#### 2. 证书更新
```bash
# 检查证书有效期
openssl x509 -in nginx/ssl/cert.pem -noout -dates

# 更新 Let's Encrypt 证书
sudo certbot renew

# 重启 Nginx
docker compose restart nginx
```

#### 3. 性能审计
```bash
# 运行性能基准测试
cd backend
npm run perf:benchmark

# 分析慢查询日志
docker exec fanshi-mysql mysql -u root -p -e "SELECT * FROM mysql.slow_log ORDER BY query_time DESC LIMIT 20;"

# 检查数据库大小
docker exec fanshi-mysql mysql -u root -p -e "SELECT table_schema AS 'Database', ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)' FROM information_schema.tables GROUP BY table_schema;"
```

#### 4. 容量规划审查
```bash
# 检查磁盘使用趋势
df -h

# 检查数据库增长
docker exec fanshi-mysql mysql -u root -p -e "SELECT COUNT(*) FROM fanshi_video.videos;"
docker exec fanshi-mysql mysql -u root -p -e "SELECT COUNT(*) FROM fanshi_video.analyses;"

# 检查上传文件大小
du -sh backend/uploads/
```

### 每季度维护任务

#### 1. 灾难恢复演练
```bash
# 模拟服务器故障
docker compose down

# 从备份恢复
./scripts/restore.sh

# 验证恢复时间和数据完整性
./scripts/health-check.sh
```

#### 2. 依赖更新
```bash
# 更新后端依赖
cd backend
npm outdated
npm update
npm audit fix

# 更新前端依赖
cd frontend
npm outdated
npm update
npm audit fix

# 重新构建镜像
docker compose build --no-cache
```

#### 3. 安全审计
```bash
# 扫描 Docker 镜像漏洞
docker scan fanshi-backend
docker scan fanshi-frontend

# 检查依赖漏洞
cd backend && npm audit
cd frontend && npm audit

# 检查系统安全
sudo apt-get install lynis
sudo lynis audit system
```

## 容量规划

### 磁盘空间规划

#### 当前使用情况
```bash
# 查看总体磁盘使用
df -h

# 查看各目录大小
du -sh backend/uploads/
du -sh backend/logs/
du -sh backups/

# 查看数据库大小
docker exec fanshi-mysql mysql -u root -p -e "SELECT table_name, ROUND(((data_length + index_length) / 1024 / 1024), 2) AS 'Size (MB)' FROM information_schema.tables WHERE table_schema = 'fanshi_video' ORDER BY (data_length + index_length) DESC;"
```

#### 容量预测
- **视频文件**: 平均 50MB/视频
- **生成视频**: 平均 30MB/视频
- **数据库**: 约 1KB/视频记录
- **日志**: 约 100MB/天

#### 扩容建议
- **磁盘空间不足 20%**: 开始规划扩容
- **磁盘空间不足 10%**: 立即扩容
- **建议保留**: 至少 50GB 可用空间

### 内存规划

#### 当前使用情况
```bash
# 查看内存使用
free -h

# 查看容器内存使用
docker stats --no-stream
```

#### 内存分配建议
- **MySQL**: 2-4GB
- **Backend**: 2-4GB
- **Frontend**: 512MB-1GB
- **系统预留**: 2GB

### 带宽规划

#### 流量估算
- **视频上传**: 50MB/视频
- **视频下载**: 30MB/视频
- **API 请求**: 约 10KB/请求

#### 带宽建议
- **小规模（<100 用户/天）**: 10Mbps
- **中规模（100-1000 用户/天）**: 100Mbps
- **大规模（>1000 用户/天）**: 1Gbps

## 灾难恢复

### 备份策略

#### 备份频率
- **数据库**: 每天 1 次全量备份 + 每小时 1 次增量备份
- **文件**: 每天 1 次全量备份
- **配置**: 每次修改后备份

#### 备份保留
- **本地**: 保留最近 30 天
- **云存储**: 保留最近 90 天
- **归档**: 每月归档一次，保留 1 年

#### 备份验证
- **每日**: 验证备份文件完整性
- **每周**: 恢复测试
- **每月**: 完整灾难恢复演练

### 恢复流程

#### RTO（恢复时间目标）
- **数据库**: < 1 小时
- **文件**: < 30 分钟
- **服务**: < 2 小时

#### RPO（恢复点目标）
- **数据库**: < 1 小时（最近一次增量备份）
- **文件**: < 24 小时（最近一次全量备份）

#### 恢复步骤
1. **评估损失**: 确定需要恢复的数据范围
2. **选择恢复点**: 选择合适的备份时间点
3. **执行恢复**: 运行恢复脚本
4. **验证数据**: 检查数据完整性
5. **恢复服务**: 启动服务并验证功能

### 灾难场景

#### 场景 1: 数据库损坏
```bash
# 1. 停止服务
docker compose stop backend

# 2. 恢复数据库
./scripts/restore.sh

# 3. 验证数据
docker exec fanshi-mysql mysql -u root -p -e "USE fanshi_video; SELECT COUNT(*) FROM videos;"

# 4. 启动服务
docker compose start backend

# 5. 健康检查
./scripts/health-check.sh
```

#### 场景 2: 服务器故障
```bash
# 1. 在新服务器上安装 Docker
# 2. 克隆项目
git clone https://github.com/your-org/Fanshi_vidio_clone.git
cd Fanshi_vidio_clone

# 3. 恢复配置
# 从备份恢复 .env 和其他配置文件

# 4. 恢复数据
./scripts/restore.sh

# 5. 启动服务
./scripts/deploy.sh

# 6. 验证
./scripts/health-check.sh
```

#### 场景 3: 数据误删除
```bash
# 1. 立即停止服务（防止进一步损坏）
docker compose stop backend

# 2. 从最近的备份恢复
./scripts/restore.sh

# 3. 如果需要恢复特定数据
# 从备份中提取特定表或文件

# 4. 验证恢复结果
# 5. 重启服务
```

## 升级流程

### 版本升级

#### 准备工作
1. **备份当前版本**
```bash
./scripts/backup.sh
```

2. **查看更新日志**
```bash
git log --oneline origin/main..HEAD
```

3. **检查兼容性**
- 查看 CHANGELOG.md
- 检查数据库迁移脚本
- 检查配置文件变更

#### 升级步骤

##### 1. 小版本升级（如 1.0.1 -> 1.0.2）
```bash
# 拉取最新代码
git pull origin main

# 重新部署
./scripts/deploy.sh
```

##### 2. 大版本升级（如 1.0.x -> 2.0.0）
```bash
# 1. 备份
./scripts/backup.sh

# 2. 停止服务
docker compose down

# 3. 拉取新版本
git checkout v2.0.0

# 4. 更新配置
# 根据升级文档更新 .env 和其他配置

# 5. 运行数据库迁移
docker compose up -d mysql
# 等待 MySQL 启动
sleep 10
# 运行迁移脚本
docker exec fanshi-backend npm run db:migrate

# 6. 重新构建镜像
docker compose build --no-cache

# 7. 启动服务
docker compose up -d

# 8. 验证
./scripts/health-check.sh
```

### 数据库迁移

#### 创建迁移
```bash
cd backend
npx sequelize-cli migration:generate --name add-new-field
```

#### 运行迁移
```bash
# 在容器中运行
docker exec fanshi-backend npm run db:migrate

# 或手动运行
docker exec fanshi-backend npx sequelize-cli db:migrate
```

#### 回滚迁移
```bash
# 回滚最后一次迁移
docker exec fanshi-backend npx sequelize-cli db:migrate:undo

# 回滚所有迁移
docker exec fanshi-backend npx sequelize-cli db:migrate:undo:all
```

### 灰度发布

#### 蓝绿部署
```bash
# 1. 部署新版本到备用环境
docker compose -f docker-compose.blue.yml up -d

# 2. 验证新版本
curl http://localhost:5001/api/health

# 3. 切换流量（更新 Nginx 配置）
# 4. 监控新版本
# 5. 如果有问题，立即切回旧版本
```

#### 金丝雀发布
```bash
# 1. 部署新版本
# 2. 配置负载均衡器，将 10% 流量导向新版本
# 3. 监控错误率和性能
# 4. 逐步增加流量比例（10% -> 25% -> 50% -> 100%）
# 5. 如果有问题，立即回滚
```

## 监控告警

### 监控指标

#### 系统指标
- CPU 使用率 > 80%
- 内存使用率 > 80%
- 磁盘使用率 > 80%
- 磁盘 I/O 等待 > 50%

#### 应用指标
- 错误率 > 1%
- 响应时间 > 1000ms (P95)
- 请求量异常波动 > 50%
- 数据库连接池耗尽

#### 业务指标
- 视频上传失败率 > 5%
- 视频分析失败率 > 10%
- 视频生成失败率 > 10%

### 告警配置

#### 告警级别
- **Critical**: 立即处理（5 分钟内）
- **Warning**: 尽快处理（1 小时内）
- **Info**: 记录日志

#### 告警通知
- **邮件**: 所有级别
- **短信**: Critical 级别
- **Slack**: Warning 及以上

### 告警响应

#### Critical 告警响应流程
1. **确认告警**: 5 分钟内确认
2. **初步诊断**: 10 分钟内定位问题
3. **应急处理**: 30 分钟内恢复服务
4. **根因分析**: 24 小时内完成
5. **预防措施**: 7 天内实施

## 应急响应

### 应急联系人
- **系统管理员**: admin@example.com / 138-xxxx-xxxx
- **开发负责人**: dev@example.com / 139-xxxx-xxxx
- **运维负责人**: ops@example.com / 137-xxxx-xxxx

### 应急预案

#### 服务不可用
1. 检查服务状态
2. 查看错误日志
3. 尝试重启服务
4. 如果无法恢复，执行回滚
5. 通知相关人员

#### 数据库故障
1. 检查数据库状态
2. 查看数据库日志
3. 尝试重启数据库
4. 如果数据损坏，从备份恢复
5. 通知相关人员

#### 磁盘空间不足
1. 清理临时文件
2. 清理旧日志
3. 清理旧备份
4. 如果仍不足，扩容磁盘
5. 通知相关人员

### 事后总结

#### 事故报告模板
```markdown
# 事故报告

## 基本信息
- 事故时间: YYYY-MM-DD HH:MM
- 影响范围: 
- 持续时间: 
- 严重程度: Critical/Warning/Info

## 事故描述
[详细描述事故情况]

## 根本原因
[分析根本原因]

## 解决方案
[描述如何解决]

## 预防措施
[列出预防措施]

## 经验教训
[总结经验教训]
```

## 附录

### 常用命令速查表

```bash
# 服务管理
docker compose up -d              # 启动服务
docker compose down               # 停止服务
docker compose restart            # 重启服务
docker compose ps                 # 查看状态

# 日志查看
docker compose logs -f            # 实时日志
docker compose logs --tail=100    # 最近 100 行

# 备份恢复
./scripts/backup.sh               # 备份
./scripts/restore.sh              # 恢复
./scripts/rollback.sh             # 回滚

# 健康检查
./scripts/health-check.sh         # 健康检查

# 部署
./scripts/deploy.sh               # 部署

# 资源监控
docker stats                      # 容器资源
df -h                            # 磁盘空间
free -h                          # 内存使用
```

### 故障排查清单

- [ ] 检查服务状态
- [ ] 查看错误日志
- [ ] 检查磁盘空间
- [ ] 检查内存使用
- [ ] 检查网络连接
- [ ] 检查数据库连接
- [ ] 检查配置文件
- [ ] 检查环境变量
- [ ] 尝试重启服务
- [ ] 查看最近的变更

### 维护检查清单

#### 每日
- [ ] 运行健康检查
- [ ] 检查错误日志
- [ ] 执行备份
- [ ] 验证备份

#### 每周
- [ ] 系统更新
- [ ] 数据库优化
- [ ] 清理临时文件
- [ ] 备份恢复测试

#### 每月
- [ ] 安全更新
- [ ] 证书更新
- [ ] 性能审计
- [ ] 容量规划审查

#### 每季度
- [ ] 灾难恢复演练
- [ ] 依赖更新
- [ ] 安全审计
- [ ] 架构审查
