# Castrel Chaos

一个专为**混沌工程训练**构建的电商微服务平台。系统自动产生真实业务流量，支持注入网络故障、JVM 内存泄漏、慢 SQL 和数据库死锁，全程可观测。

---

## 目录

- [项目概述](#项目概述)
- [开发者常用命令速查表](#开发者常用命令速查表)
- [架构总览](#架构总览)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [本地启动](#本地启动)
- [打包、构建与推镜像](#打包构建与推镜像)
- [Kubernetes 部署](#kubernetes-部署)
- [配置说明](#配置说明)
- [Chaos 注入](#chaos-注入)
- [可观测性](#可观测性)
- [验收场景](#验收场景)

---

## 项目概述

Castrel Chaos 是一个完整的电商微服务系统，包含下单、支付、库存、促销、风控、履约、通知等完整链路。系统内置一个 **traffic control plane**（`traffic-control-plane`），由 `Next.js + pnpm + TypeScript + worker` 构成：控制台负责可视化与操作，worker 负责持续业务流量生成；配合 gateway 分发的 Chaos 控制接口，可随时触发网络延迟、内存泄漏、慢 SQL、死锁等故障场景，用于混沌工程培训与系统韧性验证。

**核心特性：**

- 10 个 Spring Boot 业务/网关服务 + 1 个 `Next.js` traffic control plane
- traffic control plane 自动产生真实业务流量，支持热更新 QPS、场景编排与控制台操作
- 4 类 Chaos 注入：网络故障 / JVM 内存泄漏 / 慢 SQL / 数据库死锁
- 所有 Chaos `enable` 接口均支持 `durationSec` 自动关闭（死锁支持 `injectRate`）
- Prometheus + Grafana + Loki + Tempo 全链路可观测
- 双轨部署：Docker Compose（本地）/ Kubernetes（生产演练）

---

## 开发者常用命令速查表

| 场景 | 命令 |
|---|---|
| 直接拉取预构建镜像并启动本地环境 | `./scripts/compose-up.sh` |
| 从 Docker Hub / 官方源拉取镜像启动 | `./scripts/compose-up.sh --image-source dockerhub` |
| 本地改完代码后，重新打包并构建全部镜像 | `./scripts/build-all.sh` |
| 用本地刚构建的镜像拉起容器 | `docker compose up -d --no-build` |
| 构建并推送业务镜像 | `REGISTRY=harbor.cloudwise.com/noname BASE_IMAGE_REGISTRY=harbor.cloudwise.com/noname/ ./scripts/build-all.sh --push --tag v1.0.0` |
| 同步基础镜像到 Harbor | `./scripts/push-base-images.sh` |
| 同步基础设施镜像到 Harbor | `./scripts/push-infra-images.sh` |
| 单独开发 `traffic-control-plane` Web | `cd traffic-control-plane && pnpm dev` |
| 单独启动 `traffic-control-plane` Worker | `cd traffic-control-plane && pnpm worker` |
| 关闭服务并保留数据卷 | `docker compose down` |
| 关闭服务并清空数据卷 | `docker compose down -v` |
| 运行混沌验收助手 | `./scripts/chaos/chaos-verify.sh` |

---

## 架构总览

```text
Browser
  -> traffic-control-plane :18086 (Next.js UI + Route Handlers)
  -> gateway-service :18080 (仅由 traffic/业务流量访问)

traffic-control-plane
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

| 服务 | 宿主机访问端口 | 职责 |
|---|---|---|
| gateway-service | 18080 | 统一入口、路由转发、traceId 注入、traffic 控制分发 |
| user-service | 18081 | 用户资料、收货地址 |
| catalog-service | 18082 | 商品查询、SKU 价格 |
| inventory-service | 18083 | 库存预占/释放/重置 |
| order-service | 18084 | 下单编排、状态机、3 类 Chaos |
| payment-service | 18085 | 支付模拟、3 类 Chaos |
| traffic-control-plane | 18086 | Next.js 控制台、Route Handlers、Runner worker |
| promotion-service | 18087 | 优惠券计算、慢 SQL Chaos |
| risk-service | 18088 | 前置风控、支付后复核 |
| fulfillment-service | 18089 | 履约单、发货状态流转 |
| notification-service | 18090 | 事件驱动通知、结构化日志 |

说明：上表列的是宿主机访问端口；容器内部端口仍分别使用 `8080` 到 `8090`，`traffic-control-plane` 容器内部端口为 `3086`。

---

## 技术栈

| 类别 | 选型 |
|---|---|
| 语言 / 框架 | Java 21 · Spring Boot 3.5.x · Maven 3.8+ · Next.js · TypeScript |
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
├── traffic-control-plane/        # Next.js 控制台 + Runner worker
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

`traffic-control-plane/` 目录结构：

```text
traffic-control-plane/
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

## 本地启动

### 前置条件

| 使用场景 | 必需环境 |
|---|---|
| 直接拉取预构建镜像启动 | Docker 24+ 与 Docker Compose v2 |
| 本地改代码并重新打包 / 构建镜像 | Docker 24+、Docker Compose v2、JDK 21、Maven 3.8+ |
| 单独开发 `traffic-control-plane` | 额外需要 Node.js 20+ 与 `pnpm` |

### 先判断你要走哪条路径

| 目标 | 推荐命令 |
|---|---|
| 直接跑现成镜像 | `./scripts/compose-up.sh` |
| 改了源码后，用本地刚构建的镜像启动 | `./scripts/build-all.sh` + `docker compose up -d --no-build` |
| 改了 `traffic-control-plane` 前端，单独本地调试 | `pnpm dev` / `pnpm worker` |

关键区别：

- `./scripts/compose-up.sh` 会先执行 `docker compose pull`，适合“直接拉远端镜像启动”，不适合“优先使用本地刚构建的镜像”。
- `./scripts/build-all.sh` 会完成 `common` 安装、各 Java 服务 `mvn package`、以及全部业务镜像和 `traffic-control-plane` 镜像构建。
- 如果你的目标只是产出 Docker 镜像，不需要先手动执行 `mvn clean package -DskipTests` 或 `pnpm build`；`build-all.sh` 和 `traffic-control-plane/Dockerfile` 会处理这些步骤。

### 路径 A：直接拉取预构建镜像启动

```bash
# 克隆项目
git clone https://git.cloudwise.com/castrel/castrel-chaos.git
cd castrel-chaos

# 默认从内网 Harbor 拉取镜像并启动
./scripts/compose-up.sh

# 如果要改为从 Docker Hub / 官方镜像源拉取
./scripts/compose-up.sh --image-source dockerhub

# 短参数别名也可以
./scripts/compose-up.sh --hub dockerhub

# 停止容器
./scripts/compose-down.sh

# 按当前选定镜像源重新拉取并重启
./scripts/compose-restart.sh --hub internal

# 查看容器状态
docker compose ps
```

说明：

- `./scripts/compose-up.sh` 默认等价于“设置镜像来源变量后，先 `docker compose pull`，再 `docker compose up -d --no-build`”。
- `--hub` 是 `--image-source` 的短别名，支持 `dockerhub` 和 `internal` 两个值。
- `--image-source dockerhub` 会把业务镜像切到 `castrel/*`，基础设施镜像切到 Docker Hub / GHCR 对应官方源。
- 如需显式覆盖单个镜像，仍可传环境变量，例如 `MYSQL_IMAGE=... ./scripts/compose-up.sh --image-source dockerhub`。
- `./scripts/compose-down.sh` 和 `./scripts/compose-restart.sh` 也支持同样的 `--hub` / `--image-source` 参数。
- `./scripts/compose-restart.sh` 会执行 `down -> pull -> up --no-build`，适合切换镜像源后整套服务重启。

### 路径 B：修改源码后，本地打包并启动本地镜像

```bash
# 克隆项目
git clone https://git.cloudwise.com/castrel/castrel-chaos.git
cd castrel-chaos

# 本地打包并构建全部镜像
./scripts/build-all.sh

# 使用本地刚构建的镜像启动
docker compose up -d --no-build
```

如果你希望使用自定义镜像前缀或标签，构建和启动阶段必须保持一致：

```bash
REGISTRY=castrel IMAGE_TAG=dev ./scripts/build-all.sh --tag dev
REGISTRY=castrel IMAGE_TAG=dev docker compose up -d --no-build
```

说明：

- 本地镜像启动时，不要再执行 `./scripts/compose-up.sh`，否则脚本会先 `pull` 远端同名镜像。
- `docker-compose.yml` 使用的是 `image:`，不是 `build:`；因此“重新打包 / 重建镜像”的正确入口是 `./scripts/build-all.sh`，而不是 `docker compose up --build`。

### 验证启动成功

```bash
# 网关健康检查
curl http://localhost:18080/actuator/health

# 查询商品列表
curl http://localhost:18080/api/products

# 查看 Runner 状态（应为 running=true）
curl http://localhost:18086/internal/traffic/runner/status
```

服务启动后，traffic control plane 会自动以默认 QPS 向系统发送业务流量。

### 常用运维命令

```bash
# 停止可观测性组件
docker compose stop prometheus grafana loki tempo obs-auth-proxy mysqld-exporter promtail

# 打开 Grafana
open http://localhost:13000   # admin / admin

# 停止服务，保留数据卷
docker compose down

# 停止服务并删除数据卷
docker compose down -v
```

### 重新拉起 / 重新打包

```bash
# 重新拉取远端镜像并强制重建容器
./scripts/compose-up.sh -- --force-recreate

# 重新打包本地源码并强制重建容器
./scripts/build-all.sh
docker compose up -d --no-build --force-recreate

# 连数据卷一起清空后重建本地环境
docker compose down -v
./scripts/build-all.sh
docker compose up -d --no-build
```

---

## 打包、构建与推镜像

### 命令职责总览

| 命令 | 用途 |
|---|---|
| `./scripts/build-all.sh` | 安装 `common`、打包所有 Java 服务，并构建全部业务镜像与 `traffic-control-plane` 镜像 |
| `./scripts/build-all.sh --push --tag <tag>` | 在构建完成后推送业务镜像与 `traffic-control-plane` 镜像 |
| `./scripts/push-base-images.sh` | 同步基础镜像：`alpine`、`eclipse-temurin`、`node` |
| `./scripts/push-infra-images.sh` | 同步 MySQL / Redis / Prometheus / Loki / Tempo / Grafana / ToxiProxy 等基础设施镜像 |
| `./scripts/compose-up.sh` | 拉取远端镜像并启动容器，不负责编译源码或构建镜像 |

### 全量打包与镜像构建

```bash
# 使用默认镜像前缀 harbor.cloudwise.com/noname，默认标签 latest
./scripts/build-all.sh

# 显式指定镜像前缀与标签
REGISTRY=harbor.cloudwise.com/noname IMAGE_TAG=v1.0.0 ./scripts/build-all.sh --tag v1.0.0
```

补充说明：

- `build-all.sh` 会先执行 `mvn clean install -pl common -DskipTests`。
- 随后逐个执行业务服务的 `mvn package -DskipTests` 与 `docker build`。
- `traffic-control-plane` 的 Docker 构建会在镜像构建阶段内部完成 `pnpm install` 和 `pnpm build`。

### 推送业务镜像

```bash
REGISTRY=harbor.cloudwise.com/noname \
BASE_IMAGE_REGISTRY=harbor.cloudwise.com/noname/ \
./scripts/build-all.sh --push --tag v1.0.0
```

说明：

- `REGISTRY` 控制业务镜像与 `traffic-control-plane` 的目标前缀。
- `BASE_IMAGE_REGISTRY` 控制 Dockerfile 里的基础镜像来源，必须带结尾 `/`。
- 如果构建机无法稳定访问 Docker Hub，先同步基础镜像和基础设施镜像，再执行 `build-all.sh --push`。

### 同步基础镜像 / 基础设施镜像到 Harbor

```bash
# 登录 Harbor
docker login harbor.cloudwise.com

# 同步基础镜像（alpine、eclipse-temurin、node）
./scripts/push-base-images.sh

# 同步基础设施镜像（mysql、redis、prometheus、grafana、loki、tempo、toxiproxy 等）
./scripts/push-infra-images.sh
```

说明：

- `push-base-images.sh` 和 `push-infra-images.sh` 默认目标仓库都是 `harbor.cloudwise.com/noname`。
- `push-base-images.sh` 兼容 `HARBOR_REGISTRY` 和旧变量名 `TARGET_REGISTRY`。
- `BASE_IMAGE_REGISTRY` 与 `HARBOR_REGISTRY` 最好指向同一个 Harbor 项目，避免构建时基础镜像找不到。

### 单服务打包 / 构建示例

```bash
# 仅打包单个 Java 服务
mvn clean package -pl order-service -DskipTests

# 基于仓库根目录作为构建上下文，构建单个服务镜像
docker build -t harbor.cloudwise.com/noname/order-service:latest -f order-service/Dockerfile .
```

如果首次单独打包某个服务，建议先安装 `common`：

```bash
mvn clean install -pl common -DskipTests
```

### traffic-control-plane 单独开发 / 构建

```bash
cd traffic-control-plane

# 安装依赖
pnpm install

# 本地开发：Next.js Web
pnpm dev

# 生产构建
pnpm build

# 启动 Next.js Web
pnpm start

# 单独启动 Runner worker
pnpm worker
```

部署约束：

- `traffic-control-plane` 包含两个运行角色：`web` 与 `worker`。
- `worker` 默认单实例运行，避免重复产生业务流量。
- 所有业务 HTTP 调用仍必须经由 `gateway-service`。

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
REGISTRY=castrel ./scripts/build-all.sh --tag v1.0.0

# 如使用 minikube，加载镜像到本地 cluster
for svc in gateway-service user-service catalog-service inventory-service order-service payment-service promotion-service risk-service fulfillment-service notification-service; do
  minikube image load castrel/${svc}:v1.0.0
done
minikube image load castrel/traffic-control-plane:v1.0.0
```

说明：当前 `k8s/services/*` 清单默认引用 `castrel/*:latest`；如果不修改清单，构建 K8s 本地镜像时应显式设置 `REGISTRY=castrel`。

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

### Spring Profiles 与 Chaos 开关

| Profile | 用途 |
|---|---|
| `local` | 本地开发，连接 localhost |
| `docker` | Docker Compose / K8s 容器网络 |
| `chaos` | 当前 `docker-compose.yml` 与 `k8s/configmap/app-config.yaml` 仍保留的兼容 profile；v2 不再依赖它来注册 Chaos 端点 |

当前仓库现状：

- Docker Compose 和 Kubernetes ConfigMap 仍默认传入 `SPRING_PROFILES_ACTIVE=docker,chaos`。
- v2 下 Chaos 端点是否可用，实际由 `chaos.endpoints.enabled` 控制，而不是由 `chaos` profile 决定。
- `gateway-service` 在配置中显式设置 `chaos.endpoints.enabled=false`，因此网关自身不会注册业务 Chaos 端点。
- 业务服务侧 `ChaosService` 使用 `matchIfMissing=true`，未显式关闭时默认启用。

如果要在生产环境关闭业务 Chaos 端点，应优先关闭 `chaos.endpoints.enabled`，不要只依赖是否带有 `chaos` profile。

### 默认端口映射

| 组件 | 宿主机端口 | 容器内端口 |
|---|---|---|
| gateway-service | `18080` | `8080` |
| user-service | `18081` | `8081` |
| catalog-service | `18082` | `8082` |
| inventory-service | `18083` | `8083` |
| order-service | `18084` | `8084` |
| payment-service | `18085` | `8085` |
| traffic-control-plane | `18086` | `3086` |
| promotion-service | `18087` | `8087` |
| risk-service | `18088` | `8088` |
| fulfillment-service | `18089` | `8089` |
| notification-service | `18090` | `8090` |
| MySQL | `13306` | `3306` |
| Redis | `16379` | `6379` |
| Grafana | `13000` | `3000` |
| Prometheus（经 nginx Basic Auth） | `19090` | `19090` |
| Loki（经 nginx Basic Auth） | `13100` | `13100` |
| Tempo HTTP API（经 nginx Basic Auth） | `13200` | `13200` |
| Tempo OTLP gRPC | `14317` | `4317` |
| Tempo OTLP HTTP | `14318` | `4318` |
| ToxiProxy API | `18474` | `8474` |

### 默认镜像仓库与标签

| 场景 | 默认值 | 说明 |
|---|---|---|
| Docker Compose 业务镜像前缀 | `harbor.cloudwise.com/noname` | 由 `REGISTRY` 控制，默认用于 `gateway-service` 等业务镜像与 `traffic-control-plane` |
| Docker Compose 基础设施镜像 | `harbor.cloudwise.com/noname/*` | 由 `MYSQL_IMAGE`、`REDIS_IMAGE`、`GRAFANA_IMAGE` 等变量控制 |
| `build-all.sh` 输出镜像前缀 | `harbor.cloudwise.com/noname` | 未显式传入 `REGISTRY` 时的默认值 |
| Dockerfile 基础镜像前缀 | `harbor.cloudwise.com/noname/` | 由 `BASE_IMAGE_REGISTRY` 控制，必须带结尾 `/` |
| `compose-up.sh --image-source dockerhub` | 业务镜像切到 `castrel/*`，基础设施镜像切到官方源 | 适合直接拉取预构建镜像运行 |
| Kubernetes manifests | `castrel/*:latest` | 当前 `k8s/services/*` 清单写死使用 `castrel/*` |

### 关键环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SPRING_PROFILES_ACTIVE` | `docker,chaos` | 当前 Compose / K8s 兼容 profile 组合 |
| `REGISTRY` | `harbor.cloudwise.com/noname` | 业务镜像与 `traffic-control-plane` 镜像前缀 |
| `IMAGE_TAG` | `latest` | 业务镜像与 `traffic-control-plane` 镜像标签 |
| `BASE_IMAGE_REGISTRY` | `harbor.cloudwise.com/noname/` | Dockerfile 基础镜像前缀，必须带 `/` |
| `SPRING_DATASOURCE_URL` | `jdbc:mysql://mysql:3306/castrel` | MySQL 连接串 |
| `SPRING_DATA_REDIS_HOST` | `redis` | Redis 主机 |
| `OTLP_ENDPOINT` | `http://tempo:4318` | Docker Compose 中注入给 Java 服务的 OTLP 端点 |
| `CHAOS_CONSOLE_GRAFANA_BASE_URL` | `http://localhost:13000` | Grafana 深链基础地址 |
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

> **安全约束**：v2 中业务 Chaos 端点不再以 `chaos` Spring Profile 作为唯一注册条件，而是由 `chaos.endpoints.enabled` 控制。当前实现里 `gateway-service` 显式关闭该开关，业务服务默认开启；生产环境如需禁用，应显式关闭该属性。

### 可视化控制台（故障触发）

新的控制台由 `traffic-control-plane` 承载，提供流量控制、场景执行、slow SQL / memory leak / deadlock / table lock / network fault 控制：

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

- 浏览器只访问 `traffic-control-plane`
- `traffic-control-plane` 只访问 `gateway-service`
- 所有控制请求统一走 `traffic -> gateway -> services`

深链地址配置：

- 推荐通过环境变量 `CHAOS_CONSOLE_GRAFANA_BASE_URL` 配置（例如 `https://grafana.castrel.example.com`）
- 本地开发默认值为 `http://localhost:13000`（docker-compose 已设置）
- 页面上修改 `Grafana Base URL` 后会持久化到浏览器本地（刷新仍保留）

### 慢 SQL

适用服务：catalog / inventory / order / payment / promotion / risk / fulfillment / notification

```bash
# 通过 traffic 控制面开启 v2 慢 SQL（JOIN user_behavior_log，持续 3 分钟后自动关闭）
curl -X POST http://localhost:18086/internal/traffic/chaos/slow-sql/enable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["payment-service"],"joinTable":"user_behavior_log","durationSec":180}'

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

# 通过 traffic-control-plane 触发（带分布式锁保护）
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
> 默认账号 `castrel`，密码 `C@stre1_best_ai`，可在 `infra/nginx/.htpasswd` 中修改（使用 `openssl passwd -apr1 '<new-password>'` 重新生成哈希）。  
> Grafana 与各组件之间的内部通信无需认证。

可观测性组件会随“本地启动”流程一起拉起，无需单独执行额外命令：

- 直接拉预构建镜像：`./scripts/compose-up.sh`
- 使用本地刚构建的镜像：`./scripts/build-all.sh` 后执行 `docker compose up -d --no-build`

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
