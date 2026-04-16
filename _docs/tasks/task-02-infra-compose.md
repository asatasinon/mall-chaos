# Task 02 — Docker Compose + 基础设施

**阶段**：Phase 0 — 基础搭建  
**依赖**：Task 01（服务镜像构建需要 JAR）  
**产出**：一键启动的完整本地环境（MySQL + Redis + 观测栈 + 所有服务）

---

## 目标
提供 `docker-compose up -d` 可运行的完整环境，包含 MySQL 8、Redis、Prometheus、Grafana、Loki、Tempo，以及所有业务服务容器。

## 文件结构
```
castrel-chaos/
├── docker-compose.yml              # 基础设施 + 所有服务
├── docker-compose.override.yml     # 本地开发覆盖（可选热重载）
├── infra/
│   ├── mysql/
│   │   ├── init/
│   │   │   └── 00-schema.sql       # 全量建表脚本
│   │   └── my.cnf                  # 慢查询日志、死锁检测配置
│   ├── redis/
│   │   └── redis.conf
│   ├── prometheus/
│   │   └── prometheus.yml
│   ├── grafana/
│   │   ├── provisioning/
│   │   │   ├── datasources/
│   │   │   └── dashboards/
│   │   └── dashboards/
│   │       ├── services-overview.json
│   │       └── chaos-events.json
│   ├── loki/
│   │   └── loki-config.yml
│   └── tempo/
│       └── tempo-config.yml
```

## 子任务

### 2.1 MySQL 8 配置
- [ ] `my.cnf` 开启：
  - `slow_query_log=ON`，`long_query_time=1`
  - `innodb_deadlock_detect=ON`，`innodb_print_all_deadlocks=ON`
  - `binlog` 开启（供演练分析使用）
- [ ] `00-schema.sql` 建表（详见 Task 03–09 各服务数据模型）
- [ ] 运行 `init/` 目录下 SQL 脚本自动初始化

### 2.2 Runner 配置表初始化 SQL
- [ ] `runner_profile` 表及默认行（`base_qps=5`, `enabled=true`, `version=1`）
- [ ] `runner_inventory_reset_policy` 表及默认行
- [ ] `inventory_baseline_snapshot` 表
- [ ] `runner_mix_rule` 表及初始规则行
- [ ] `runner_time_window` 表
- [ ] `chaos_policy` 表
- [ ] `chaos_event_log` 表

### 2.3 Redis 配置
- [ ] `redis.conf`：`maxmemory 256mb`，`maxmemory-policy allkeys-lru`
- [ ] 用于：订单幂等锁、分布式锁（库存重置）、Runner 状态缓存

### 2.4 Prometheus 配置
- [ ] `prometheus.yml` 配置 scrape targets（每服务 `/actuator/prometheus`）：
  ```yaml
  scrape_configs:
    - job_name: 'gateway'
      static_configs:
        - targets: ['gateway-service:8080']
    # ... 其余 10 个服务
  ```
- [ ] 采集间隔 `15s`

### 2.5 Grafana 配置
- [ ] datasource provisioning：Prometheus、Loki、Tempo
- [ ] 预置 Dashboard：
  - **Services Overview**：各服务 QPS、P50/P95/P99、错误率、JVM Heap
  - **Chaos Events**：`chaos_event_log` 时间线、注入状态
- [ ] 默认 admin 账密通过环境变量注入

### 2.6 Loki + Tempo 配置
- [ ] Loki：收集所有服务结构化日志（`traceId` 字段索引）
- [ ] Tempo：接收 OTLP traces，与 Loki、Prometheus 联动
- [ ] 服务侧配置：`application.yml` 中 `management.tracing.enabled=true`，OTLP exporter 指向 Tempo

### 2.7 docker-compose.yml 服务定义
- [ ] 基础设施服务：`mysql`, `redis`, `prometheus`, `grafana`, `loki`, `tempo`
- [ ] 业务服务（全部 11 个）：
  - `build: ./<service-name>` 或引用本地镜像
  - `depends_on: [mysql, redis]`
  - 环境变量注入：DB URL、Redis URL、服务间调用 URL
  - `SPRING_PROFILES_ACTIVE=docker,chaos`
- [ ] 网络：统一 `castrel-net` bridge 网络
- [ ] 健康检查：`healthcheck` 调用 `/actuator/health`

### 2.8 ToxiProxy 集成（Chaos 网络注入）
- [ ] 添加 `toxiproxy` 容器
- [ ] 为 `order->payment`、`order->inventory` 等关键链路配置代理端口
- [ ] 提供 `infra/toxiproxy/toxiproxy.json` 初始代理配置

### 2.9 验证
- [ ] `docker-compose up -d` 无报错
- [ ] Grafana `http://localhost:3000` 可访问，数据源全绿
- [ ] `http://localhost:8080/actuator/health` 返回 UP
- [ ] MySQL 表结构全部创建成功

## 关键配置示例

### application.yml 共用片段（各服务继承）
```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus,metrics
  metrics:
    export:
      prometheus:
        enabled: true
  tracing:
    enabled: true
    sampling:
      probability: 1.0

logging:
  structured:
    format: json                  # Spring Boot 3.x 结构化日志
```
