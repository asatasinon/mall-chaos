# Castrel Chaos

一个专为**混沌工程训练**构建的电商微服务平台。系统自动产生真实业务流量，支持注入网络故障、JVM 内存泄漏、慢 SQL 和数据库死锁，全程可观测。

---

## 目录

- [项目概述](#项目概述)
- [架构总览](#架构总览)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [快速开始（Docker Compose）](#快速开始docker-compose)
- [构建](#构建)
- [Kubernetes 部署](#kubernetes-部署)
- [配置说明](#配置说明)
- [Chaos 注入](#chaos-注入)
- [可观测性](#可观测性)
- [验收场景](#验收场景)

---

## 项目概述

Castrel Chaos 是一个完整的电商微服务系统，包含下单、支付、库存、促销、风控、履约、通知等完整链路。系统内置一个 **traffic control plane**（`traffic-runner-service`），由 `Next.js + pnpm + TypeScript + worker` 构成：控制台负责可视化与操作，worker 负责持续业务流量生成；配合 gateway 分发的 Chaos 控制接口，可随时触发网络延迟、内存泄漏、慢 SQL、死锁等故障场景，用于混沌工程培训与系统韧性验证。

**核心特性：**

- 10 个 Spring Boot 业务/网关服务 + 1 个 `Next.js` traffic control plane
- traffic control plane 自动产生真实业务流量，支持热更新 QPS、场景编排与控制台操作
- 4 类 Chaos 注入：网络故障 / JVM 内存泄漏 / 慢 SQL / 数据库死锁
- 所有 Chaos 均支持 `injectRate + durationSec` 自动关闭
- Prometheus + Grafana + Loki + Tempo 全链路可观测
- 双轨部署：Docker Compose（本地）/ Kubernetes（生产演练）

---

## 架构总览

```text
Browser
  -> traffic-runner-service :18086 (Next.js UI + Route Handlers)
  -> gateway-service :18080 (仅由 traffic/业务流量访问)

traffic-runner-service
  -> Runner Worker
  -> gateway-service

gateway-service
  -> user-service         :18081
  -> catalog-service      :18082
  -> inventory-service    :18083
  -> order-service        :18084
  -> payment-service      :18085
  -> promotion-service    :18087
  -> risk-service         :18088
  -> fulfillment-service  :18089
  -> notification-service :18090
  -> toxiproxy / infra proxy
```

| 服务 | 端口 | 职责 |
|---|---|---|
| gateway-service | 18080 | 统一入口、路由转发、traceId 注入、traffic 控制分发 |
| user-service | 18081 | 用户资料、收货地址 |
| catalog-service | 18082 | 商品查询、SKU 价格 |
| inventory-service | 18083 | 库存预占/释放/重置 |
| order-service | 18084 | 下单编排、状态机、3 类 Chaos |
| payment-service | 18085 | 支付模拟、3 类 Chaos |
| traffic-runner-service | 18086 | Next.js 控制台、Route Handlers、Runner worker |
| promotion-service | 18087 | 优惠券计算、慢 SQL Chaos |
| risk-service | 18088 | 前置风控、支付后复核 |
| fulfillment-service | 18089 | 履约单、发货状态流转 |
| notification-service | 18090 | 事件驱动通知、结构化日志 |

---

## 技术栈

| 类别 | 选型 |
|---|---|
| 语言 / 框架 | Java 21 · Spring Boot 3.3.x · Maven 3.8+ · Next.js · TypeScript |
| Node 工具链 | Node.js 20+ · pnpm |
| 数据存储 | MySQL 8.0（慢查询日志开启）· Redis 7.2（LRU 策略） |
| 可观测 | Prometheus · Grafana · Loki · Tempo (OTLP) |
| 网络故障 | ToxiProxy · Pumba |
| K8s 混沌 | Chaos Mesh |
| 容器化 | Docker Compose（本地）· Kubernetes（生产） |

---

## 目录结构

```
castrel-chaos/
├── common/                     # 公共模块（ApiResponse, BizException, TraceContext）
├── gateway-service/
├── user-service/
├── catalog-service/
├── inventory-service/
├── order-service/
├── payment-service/
├── traffic-runner-service/       # Next.js control plane + worker
├── promotion-service/
├── risk-service/
├── fulfillment-service/
├── notification-service/
├── infra/
│   ├── mysql/
│   │   ├── my.cnf              # 慢查询日志配置
│   │   └── init/00-schema.sql  # 数据库初始化脚本
│   ├── redis/redis.conf
│   ├── prometheus/prometheus.yml
│   ├── grafana/
│   │   ├── provisioning/       # 数据源自动配置
│   │   └── dashboards/         # 预置 Dashboard JSON
│   ├── loki/loki-config.yml
│   ├── tempo/tempo-config.yml
│   └── toxiproxy/toxiproxy.json
├── k8s/
│   ├── namespace.yaml
│   ├── configmap/
│   ├── secrets/
│   ├── infra/                  # MySQL / Redis / 观测栈
│   ├── services/               # 11 个业务服务
│   ├── ingress/
│   ├── chaos/                  # Chaos Mesh 实验 YAML
│   └── kustomization.yaml
├── scripts/
│   ├── build-all.sh            # Maven 构建 + Docker 镜像打包
│   ├── k8s-deploy.sh           # K8s 一键部署
│   ├── k8s-teardown.sh         # K8s 清理
│   └── chaos/
│       ├── chaos-verify.sh     # 7 场景交互式验收助手
│       ├── network-delay.sh    # ToxiProxy 注入延迟
│       ├── network-remove-toxic.sh
│       ├── network-reset-all.sh
│       ├── pumba-delay.sh
│       └── toxiproxy-status.sh
├── docker-compose.yml
└── pom.xml
```

`traffic-runner-service/` 在重构后建议包含：

```text
traffic-runner-service/
├── app/                          # Next.js UI + Route Handlers
├── components/
├── lib/
├── server/
├── worker/                       # Runner worker 入口与调度逻辑
├── public/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── next.config.* 
```

---

## 快速开始（Docker Compose）

### 前置条件

- Docker 24+ 与 Docker Compose v2
- JDK 21 + Maven 3.8+（构建 Java 服务）
- Node.js 20+ 与 `pnpm`（构建 traffic control plane）

### 1. 启动基础服务（无需本地构建）

```bash
# 克隆项目
git clone https://github.com/your-org/castrel-chaos.git
cd castrel-chaos

# Java 服务打包
mvn clean package -DskipTests

# traffic control plane 安装依赖并构建
cd traffic-runner-service
pnpm install
pnpm build
cd ..

# 启动基础设施 + 全部业务服务
docker compose up -d

# 查看各服务状态
docker compose ps
```

### 2. 验证启动成功

```bash
# 网关健康检查
curl http://localhost:18080/actuator/health

# 查询商品列表
curl http://localhost:18080/api/products

# 查看 Runner 状态（应为 running=true）
curl http://localhost:18086/internal/traffic/runner/status
```

服务启动后，traffic control plane 会自动以默认 QPS 向系统发送业务流量。

### 3. 关闭可观测性栏（可选）

可观测性栏（Grafana / Prometheus / Loki / Tempo）默认随 `docker compose up -d` 一起启动。如需关闭：

```bash
# 停止可观测性服务
docker compose stop prometheus grafana loki tempo obs-auth-proxy mysqld-exporter promtail
```

访问 Grafana：

```bash
open http://localhost:13000   # admin / admin
```

### 4. 停止服务

```bash
docker compose down          # 保留数据卷
docker compose down -v       # 同时删除数据卷（清空数据库）
```

### 5. 全部重建

```bash
mvn clean package -DskipTests

# 重新构建 Java 服务
mvn clean package -DskipTests

# 重新构建 traffic control plane
(cd traffic-runner-service && pnpm install && pnpm build)

# 保留数据，重建全部容器并重新构建镜像
docker compose down
docker compose up -d --build --force-recreate

# 连数据卷一起清空，做彻底重建
docker compose down -v
docker compose up -d --build --force-recreate
```

---

## 构建

### 全量构建（推荐）

```bash
# 构建 Java 模块
./scripts/build-all.sh

# 构建 traffic control plane
cd traffic-runner-service
pnpm install
pnpm build
cd ..

# 再构建 Docker 镜像
./scripts/build-all.sh
```

### 单服务构建

```bash
# 仅构建 Java JAR
mvn clean package -pl order-service -DskipTests

# 构建 Docker 镜像
docker build -t castrel/order-service:latest ./order-service
```

### traffic-runner-service 构建

```bash
cd traffic-runner-service

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 生产构建
pnpm build

# 启动 Next.js 服务
pnpm start

# 启动 Runner worker
pnpm worker
```

部署约束：

- `traffic-runner-service` 至少包含两个运行角色：`web` 与 `worker`
- `worker` 默认单实例运行，避免重复产生业务流量
- 所有业务 HTTP 调用仍必须经由 `gateway-service`

### common 模块

所有业务服务依赖 `common` 模块，首次构建必须先安装：

```bash
mvn clean install -pl common -DskipTests
```

---

## Kubernetes 部署

### 前置条件

- Kubernetes 1.25+（本地可用 minikube / kind / k3s）
- `kubectl` 已配置目标集群
- 镜像已构建并推送（或本地 cluster 可访问）

### 1. 安装 Chaos Mesh（可选，用于 K8s 网络混沌）

```bash
helm repo add chaos-mesh https://charts.chaos-mesh.org
helm install chaos-mesh chaos-mesh/chaos-mesh \
  --namespace=chaos-mesh --create-namespace \
  --set chaosDaemon.runtime=containerd \
  --set chaosDaemon.socketPath=/run/containerd/containerd.sock
```

### 2. 构建并打标镜像

```bash
./scripts/build-all.sh --tag v1.0.0

# 如使用 minikube，加载镜像到本地 cluster
for svc in gateway user catalog inventory order payment traffic-runner promotion risk fulfillment notification; do
  minikube image load castrel/${svc}-service:v1.0.0
done
```

### 3. 部署

```bash
# 预览（dry-run）
./scripts/k8s-deploy.sh --dry-run

# 正式部署
./scripts/k8s-deploy.sh
```

### 4. 验证

```bash
# 查看 Pod 状态（全部应为 Running）
kubectl get pods -n castrel

# 访问 Grafana
kubectl port-forward -n castrel svc/grafana 3000:3000

# 访问 Chaos Mesh Dashboard
kubectl port-forward -n chaos-mesh svc/chaos-dashboard 2333:2333
```

### 5. 配置 hosts（Ingress 访问）

```bash
echo "127.0.0.1 castrel.local" | sudo tee -a /etc/hosts

# 测试
curl http://castrel.local/api/products
```

### 6. 清理

```bash
./scripts/k8s-teardown.sh              # 保留 MySQL PVC
./scripts/k8s-teardown.sh --delete-pvc # 同时删除数据卷
```

---

## 配置说明

### Spring Profiles

| Profile | 用途 |
|---|---|
| `local` | 本地开发，连接 localhost |
| `docker` | Docker Compose / K8s 容器网络 |
| `chaos` | **必须加载此 profile，Chaos 注入接口才会注册** |

生产部署默认激活 `docker,chaos`（见 ConfigMap `app-config`）。

### 关键环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SPRING_PROFILES_ACTIVE` | `docker,chaos` | Spring Profile |
| `SPRING_DATASOURCE_URL` | `jdbc:mysql://mysql:3306/castrel` | MySQL 连接串 |
| `SPRING_DATA_REDIS_HOST` | `redis` | Redis 主机 |
| `MANAGEMENT_OTLP_TRACING_ENDPOINT` | `http://tempo:4318/v1/traces` | Tempo OTLP 地址 |
| `JAVA_OPTS` | `-Xms256m -Xmx512m` | JVM 参数 |

### 数据库

MySQL 初始化脚本位于 `infra/mysql/init/00-schema.sql`，Docker Compose 首次启动自动执行。

慢查询日志配置见 `infra/mysql/my.cnf`（阈值 1s，写入 `/var/lib/mysql/slow.log`）。

### Redis

配置文件 `infra/redis/redis.conf`，开启 LRU 淘汰（`maxmemory-policy allkeys-lru`）。

### traffic control plane 配置热更新

```bash
# 查看当前配置
curl http://localhost:18086/internal/traffic/runner/config

# 更新 QPS（必须带 version 字段，乐观锁保护）
curl -X PUT http://localhost:18086/internal/traffic/runner/config \
  -H 'Content-Type: application/json' \
  -d '{"baseQps": 20, "version": 1}'

# 动态调速（无需 version）
curl -X POST http://localhost:18086/internal/traffic/runner/rate \
  -H 'Content-Type: application/json' \
  -d '{"multiplier": 2.0}'
```

---

## Chaos 注入

> **安全约束**：Chaos 接口仅在 `chaos` Spring Profile 下注册。生产环境禁用此 profile 即可关闭所有 Chaos 端点。

### 可视化控制台（故障触发）

新的控制台由 `traffic-runner-service` 承载，提供流量控制、场景执行、slow SQL / memory leak / deadlock / table lock / network fault 控制：

```bash
# 启动后访问
http://localhost:18086/
```

控制台特性：

- 系统拓扑可视化（节点状态高亮）
- Slow SQL 八服务批量启停（catalog/inventory/order/payment/promotion/risk/fulfillment/notification）
- order/payment 内存泄漏与死锁一键控制
- 表锁阻塞控制
- ToxiProxy 网络故障注入（延迟、reset_peer、清空 toxics）
- Grafana/Tempo 深链跳转（dashboard、按服务过滤、按 traceId 检索）
- 预置 Task 19 场景按钮（场景 2/4/5/7 + 一键恢复）

网络访问约束：

- 浏览器只访问 `traffic-runner-service`
- `traffic-runner-service` 只访问 `gateway-service`
- 所有控制请求统一走 `traffic -> gateway -> services`

深链地址配置：

- 推荐通过环境变量 `CHAOS_CONSOLE_GRAFANA_BASE_URL` 配置（例如 `https://grafana.castrel.example.com`）
- 本地开发默认值为 `http://localhost:13000`（docker-compose 已设置）
- 页面上修改 `Grafana Base URL` 后会持久化到浏览器本地（刷新仍保留）

### 慢 SQL

适用服务：catalog / inventory / order / payment / promotion / risk / fulfillment / notification

```bash
# 通过 traffic 控制面开启 sleep 模式（100% 注入，持续 3 分钟后自动关闭）
curl -X POST http://localhost:18086/internal/traffic/chaos/slow-sql/enable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["payment-service"],"mode":"sleep","delayMs":3000,"injectRate":1.0,"scope":"ALL","durationSec":180}'

# 开启 real 模式（SELECT SLEEP(N) 真实慢查询，50% 注入）
curl -X POST http://localhost:18086/internal/traffic/chaos/slow-sql/enable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["payment-service"],"mode":"real","delayMs":2000,"injectRate":0.5,"scope":"ALL","durationSec":180}'

# 手动关闭
curl -X POST http://localhost:18086/internal/traffic/chaos/slow-sql/disable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["payment-service"]}'
```

### JVM 内存泄漏

适用服务：order / payment

```bash
# 开始泄漏（每 300ms 分配 1MB，上限 350MB，持续 3 分钟）
curl -X POST http://localhost:18086/internal/traffic/chaos/memory-leak/enable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["order-service"],"chunkSizeKb":1024,"intervalMs":300,"maxMb":350,"durationSec":180}'

# 停止分配（已持有内存不释放）
curl -X POST http://localhost:18086/internal/traffic/chaos/memory-leak/disable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["order-service"]}'

# 释放所有持有内存
curl -X POST http://localhost:18086/internal/traffic/chaos/memory-leak/cleanup \
  -H 'Content-Type: application/json' \
  -d '{"targets":["order-service"]}'
```

### 数据库死锁

适用服务：order / payment

```bash
# 开启死锁注入（40% 概率，3 分钟后自动停止）
curl -X POST http://localhost:18086/internal/traffic/chaos/deadlock/enable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["order-service"],"injectRate":0.4,"scope":"ALL","durationSec":180}'

# 手动关闭
curl -X POST http://localhost:18086/internal/traffic/chaos/deadlock/disable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["order-service"]}'
```

### 网络故障（ToxiProxy）

```bash
# 向 order→payment 注入 3s 延迟（自动 120s 后移除）
curl -X POST http://localhost:18086/internal/traffic/chaos/network-delay/enable \
  -H 'Content-Type: application/json' \
  -d '{"proxyName":"order-to-payment","latencyMs":3000,"jitterMs":1000,"durationSec":120}'

# 查看网络故障状态
curl "http://localhost:18086/internal/traffic/chaos/network-delay/status?proxyName=order-to-payment"

# 移除网络延迟
curl -X POST http://localhost:18086/internal/traffic/chaos/network-delay/disable \
  -H 'Content-Type: application/json' \
  -d '{"proxyName":"order-to-payment"}'
```

ToxiProxy 代理映射：

| 代理名 | 路径 | 本地端口 |
|---|---|---|
| `order-to-payment` | order → payment-service | 18185 |
| `order-to-inventory` | order → inventory-service | 18183 |
| `gateway-to-order` | gateway → order-service | 18184 |

### Chaos Mesh（Kubernetes）

```bash
# 注入 order→payment 3s 网络延迟
kubectl apply -f k8s/chaos/network-delay.yaml

# 随机 kill order-service pod（每 5 分钟一次）
kubectl apply -f k8s/chaos/pod-kill.yaml

# 内存压力（stress）
kubectl apply -f k8s/chaos/stress-mem.yaml

# 移除
kubectl delete -f k8s/chaos/network-delay.yaml
```

### 库存重置

```bash
# 通过 gateway 预览将要重置的差值（不写入）
curl -X POST http://localhost:18080/internal/gateway/inventory-reset/plan

# 通过 gateway 执行重置（需要 expectedVersion）
curl -X POST http://localhost:18080/internal/gateway/inventory-reset \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion": 1}'

# 通过 traffic-runner 触发（带分布式锁保护）
curl -X POST http://localhost:18086/internal/traffic/runner/inventory-reset/trigger
```

---

## 可观测性

| 服务 | 地址 | 凭据 | 说明 |
|---|---|---|---|
| Grafana | http://localhost:13000 | admin / admin | 可视化面板 |
| Prometheus | http://localhost:19090 | castrel / castrel | 指标查询（Basic Auth） |
| Loki | http://localhost:13100 | castrel / castrel | 日志聚合（Basic Auth） |
| Tempo | http://localhost:13200 | castrel / castrel | 分布式追踪（Basic Auth） |
| ToxiProxy API | http://localhost:18474 | — | 网络故障管理 |

> **认证说明**：Prometheus、Loki、Tempo 的外部端口通过 nginx 反向代理保护，需要 HTTP Basic Auth。  
> 默认账号 `castrel`，密码 `castrel`，可在 `infra/nginx/.htpasswd` 中修改（使用 `openssl passwd -apr1 '<new-password>'` 重新生成哈希）。  
> Grafana 与各组件之间的内部通信无需认证。

可观测性栏默认随 `docker compose up -d` 一起启动，无需额外命令。

```bash
mvn clean package -DskipTests

docker compose up -d
```

**关键指标：**

| 指标 | 说明 |
|---|---|
| `chaos.slow_sql.count` | 慢 SQL 注入次数 |
| `chaos.memory_leak.holding_mb` | 当前持有泄漏内存（MB） |
| `chaos.deadlock.count` | 死锁注入次数 |
| `chaos.deadlock.retry.count` | 死锁重试次数 |
| `payment.charge.timeout.count` | 支付超时次数 |
| `order.create.success.count` | 下单成功次数 |
| `jvm.memory.used` | JVM 堆内存使用 |

所有日志为结构化 JSON 格式，包含 `traceId`，由 Promtail 采集发送到 Loki。

---

## 验收场景

使用交互式验收助手运行 7 个必测场景：

场景触发原因、预期信号和分析判定口径见 [Chaos 场景触发原因手册](_docs/guides/chaos-scenario-trigger-handbook.md)。建议在执行每个场景前先阅读对应章节，避免只看到现象却无法判断根因分析是否正确。

```bash
# 交互菜单（本地 Docker Compose）
./scripts/chaos/chaos-verify.sh

# 指定场景（K8s 环境）
GATEWAY_URL=http://castrel.local ./scripts/chaos/chaos-verify.sh --scenario 4

# 全局验收清单
./scripts/chaos/chaos-verify.sh --global
```

| # | 场景 | 目标 |
|---|---|---|
| 1 | 基线稳定性 | 无 Chaos，30 分钟成功率 > 95% |
| 2 | order→payment 网络延迟 2-5s | 超时订单 FAILED，熔断触发，恢复后 > 90% |
| 3 | order JVM 内存泄漏 10 分钟 | 堆告警触发，clear 后 Heap 回落 |
| 4 | payment 慢 SQL（sleep + real） | 慢查询日志可见，durationSec 到期自动关闭 |
| 5 | order + payment 死锁注入 | 退避重试成功，超限报错不卡死 |
| 6 | 库存定时重置演练 | 版本冲突 409，并发锁保护，调度立即生效 |
| 7 | 组合故障（网络+慢SQL+死锁） | 成功率 > 20%，5 分钟内恢复 > 90% |
