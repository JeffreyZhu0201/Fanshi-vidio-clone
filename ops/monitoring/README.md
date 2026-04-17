# 阶段 5 监控与告警

该目录存放 Fanshi-vidio-clone 的基础 Prometheus 监控与告警样例，供阶段 5 本地验证和阶段 6 部署落地复用。

## 监控入口
- 后端健康检查：`GET /api/health`
- 数据库健康检查：`GET /api/health/database`
- Prometheus 指标：`GET /api/metrics`
- 前端监控采集：`POST /api/monitoring/events`

## 已暴露的后端指标
- `fanshi_backend_http_requests_total`
- `fanshi_backend_http_request_duration_ms`
- `fanshi_backend_http_requests_active`
- `fanshi_backend_frontend_monitoring_events_total`

## 推荐接入
1. 使用 `prometheus.scrape.yml` 抓取后端、Node Exporter 和 MySQL Exporter。
2. 使用 `alert.rules.yml` 导入 Prometheus 告警规则。
3. 将 `frontend/.env.example` 中的 `VITE_MONITORING_ENDPOINT` 指向后端监控采集接口。
4. 在生产环境为 Prometheus、Grafana、Alertmanager 增加独立鉴权和 TLS。

## 当前告警阈值
- 5 分钟错误率 > 1%
- P95 响应时间 > 1s
- 磁盘剩余空间 < 10%
- 内存使用率 > 80%
- MySQL 不可用
