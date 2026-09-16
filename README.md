# Castrel Chaos

Castrel Chaos 是面向 SRE 培训的电商微服务平台。它通过真实业务请求、SQL、Redis、JVM、存储、MySQL 锁和独立支付提供方，构造可观察、可恢复的业务异常演练；不以伪造延迟、伪造业务结果或 Controller 直返失败代替真实行为。每个场景都必须落在真实业务路径和真实资源行为上，控制面只负责编排、限时、观测和恢复，不能把控制接口当成业务异常的替身。

## 当前实现

- 本文记录当前可运行的部署、配置和验证方式；场景固定目标、参数边界、时长和恢复策略以 [traffic-control-plane/src/lib/fault-run-catalog.ts](traffic-control-plane/src/lib/fault-run-catalog.ts) 为准。
- `traffic-control-plane` 提供受保护的运营控制台、运行记录、审计与恢复控制；独立 worker 负责 Runner、场景执行、补给、留存和可选的数据预热。
- `shopfront`、Gateway 和业务服务组成消费者业务路径，Prometheus、Grafana、Loki 与 Tempo 提供指标、日志和 trace 观测。
- 贡献代码时遵循 [CLAUDE.md](CLAUDE.md) 中的模块归属、术语隔离、运行时约束和验证要求。

## 架构

```text
消费者浏览器 -> shopfront:13090 -> gateway-service:18080 -> 业务服务

运营浏览器 -> traffic-control-plane:13086（Next.js Web/API）
                 |-> gateway-service（固定业务操作）
                 |-> MySQL / Redis（控制面记录、会话和租约）
                 `-> notification-restart-broker（固定通知服务重启）

traffic-control-plane-worker（独立进程/Deployment）
                 |-> gateway-service（Runner 与场景请求）
                 |-> MySQL / Redis（恢复、留存、补给和租约）
                 `-> product_price_history / user_behavior_log（仅数据预热例外）
```

Web/API 不运行后台调度。`traffic-control-plane-worker` 负责 Runner、报表与流量场景执行、其他场景 worker、优惠券/库存补给、到期恢复、每日留存清理和可选数据预热。除数据预热外，控制面的所有业务 HTTP 请求都经 Gateway；不会直连业务服务、PSP 或业务数据库表。数据预热是明确例外：worker 仅在持有 Redis lease 时直接写入 `product_price_history` 与 `user_behavior_log`；消费者路径无法访问 `/internal/**` 运营入口。

`traffic-control-plane` 是唯一持有场景 catalog、运行生命周期、运营审计和恢复控制语义的模块；其余运行时服务只保留自然的业务语义。场景 catalog 的权威实现是 [traffic-control-plane/src/lib/fault-run-catalog.ts](traffic-control-plane/src/lib/fault-run-catalog.ts)。

Compose 和 Kubernetes 都将控制面拆成 `traffic-control-plane` 与 `traffic-control-plane-worker` 两个 workload。两者必须指向同一套 MySQL、Redis、Gateway 和内部认证配置；只启动 Web/API 容器不会启动后台任务。

## 组件与端口

以下是 `docker-compose.yml` 默认发布到宿主机的端口。业务服务本身只加入 `castrel-net`，不直接发布宿主机端口；共享环境应在网络层进一步限制数据库、Redis、OTLP 和 exporter 端口。

| 类别 | 宿主机端口 | 组件与用途 |
| --- | ---: | --- |
| 应用入口 | `13086` | `traffic-control-plane` 运营控制台和受保护 Route Handler。 |
| 应用入口 | `13090` | `shopfront` 消费者前台。 |
| 应用入口 | `18080` | `gateway-service` 业务请求入口。 |
| 数据 | `13306` | MySQL 本地开发数据库。 |
| 数据 | `16379` | Redis 本地开发实例。 |
| 观测 UI | `13000` | Grafana。Compose 默认开放匿名 Viewer；管理员默认值仅供本地开发。 |
| 观测 API | `19090` / `19093` | 经 `obs-auth-proxy` 认证的 Prometheus 与 Alertmanager。 |
| 观测 API | `13100` / `13200` | 经 `obs-auth-proxy` 认证的 Loki 与 Tempo HTTP API。 |
| Trace 接收 | `14317` / `14318` | Tempo OTLP gRPC / HTTP 接收端口，当前 Compose 不加认证。 |
| 指标导出 | `19100` / `19104` / `19121` | node-exporter、mysqld-exporter、redis-exporter。 |
| 可选 profile | `13091` | SkyWalking UI，经 `obs-auth-proxy` 认证。 |
| 可选 profile | `11800` / `12800` | SkyWalking OAP gRPC 接收与 HTTP/GraphQL API。 |

当前 Compose 的观测反向代理 Basic Auth 为 `castrel` / `castrel`；Grafana 管理员默认值为 `castrel` / `C@stre1_best_ai`。这些都是本地开发默认值，部署时必须替换或收紧访问策略。

## 受控场景

控制台从唯一 catalog 渲染以下 12 个固定场景。每项的效果都来自列出的真实业务路径和资源行为，场景代码、目标服务、目标操作和参数边界以 [traffic-control-plane/src/lib/fault-run-catalog.ts](traffic-control-plane/src/lib/fault-run-catalog.ts) 为准：

| 类别 | 场景 | 固定业务位置与真实行为 |
| --- | --- | --- |
| 报表 | 商品浏览慢 SQL | Catalog 商品浏览报表扫描历史行为数据。 |
| 报表 | 订单报表慢 SQL | Order 客户订单报表查询历史订单并读取明细。 |
| 流量 | 浏览流量突增 | Runner 经 Gateway 持续调用公开商品浏览 API。 |
| 流量 | 订单查询突增 | Runner 经 Gateway 以合规演示客户持续调用订单查询 API。 |
| 缓存 | 商品详情 Redis Hash | Catalog 商品详情 API 读取运行级 Hash 中的真实 Redis 大值。 |
| 依赖 | 购物车依赖失败 | 加购前的 Cart-to-Catalog 商品校验真实失败，写入前终止。 |
| JVM | JVM 内存泄漏 | Notification 真实通知路径保留高基数对象，允许 JVM 堆自然耗尽；到期不释放已保留对象。 |
| 存储 | 通知存储增长 | Runner 经 Gateway 调用 Notification 专用存储追加接口，向运行级文件追加受限、可识别的数据量；终止后可按运行进行确认式人工清理。 |
| 数据库 | 促销死锁 | 优惠券预留和过期清理以相反锁顺序运行真实事务。 |
| 数据库 | 库存表锁 | 专用连接持有 `inventories` 表写锁，库存读取实际阻塞。 |
| 数据库 | 库存行锁 | 专用事务对固定库存记录执行 `SELECT ... FOR UPDATE`，预留摘要实际等待。 |
| 外部依赖 | PSP 外部依赖 | Payment 经真实 HTTP 调用独立 `psp-simulator`；在受限生效比例内得到授权、拒付或超时结果，走正常客户端超时和业务错误路径。 |

全环境同时只允许一条 `CREATING`、`ACTIVE` 或 `RECOVERING` 运行。运行记录带 `faultRunId`、`expiresAt`、单调 `fencingToken` 和固定目标快照；创建、停止、清理与重启请求还必须带确认和幂等键。控制台展示活动锁、倒计时、运行事件、停止结果和恢复结果。

## 真实性与术语隔离

### 真实场景规则

- 12 个场景都必须通过真实业务 HTTP、SQL、Redis、JVM、存储、锁或 PSP 调用产生可观察效果。禁止以 `SLEEP()`、固定等待、伪造延迟、Controller 直返失败、随机假结果、专用演示返回值或脱离业务链路的测试端点代替真实行为。
- 每个场景只能通过 catalog 绑定一个固定目标服务、固定业务操作、受服务端校验的参数和有限时长；效果必须来自该操作实际使用的资源。慢 SQL 必须执行真实报表查询，表锁/行锁必须由真实 JDBC 会话或事务持有，PSP 场景必须经过独立 PSP HTTP 客户端。
- 存储追加是运行级文件的真实追加，不等同于已经验证物理磁盘写满；锁等待、死锁、OOM、健康失败、告警和恢复耗时取决于数据库、JVM、卷配额和编排配置，不能写成必然结果或固定时间。
- 控制面运行记录、事件、审计和恢复状态只属于 `traffic-control-plane`；业务服务只保留自然的业务语义。仓库中的运营手册可以解释场景，但不能成为运行时接口或可观测性字段的依据。

### 运行时代码边界

- 用户所说的 `traffic-control-panel` 在本仓库对应目录 `traffic-control-plane`。它是唯一允许持有 catalog 场景码、Fault Run 生命周期、场景展示名和故障演练控制语义的模块。
- 除 `traffic-control-plane/**` 外，运行时服务源码（包括 `src/**` 下的源码配置）不得出现“故障注入”“故障演练”“故障场景”、catalog 场景码，或用控制面场景展示名说明目标端受控行为。真实业务实现所需的自然领域术语可以保留，但不能组合成注入或演练语义。限制覆盖 Gateway、业务服务、`common`、`psp-simulator`、路由、Controller/Endpoint、类/方法、DTO、参数、错误码/消息、配置键、日志、指标、trace 属性、注释和健康响应。
- 受保护的服务间 `/internal/**` 路径可以为幂等、过期和 fencing 传递通用 `operation` 与不透明 `runId` 上下文；它们不携带场景身份，不使用 `faultRunId` 字段名，也不解释 catalog 或控制面生命周期。该上下文只能由控制面经 Gateway 发起，且不得进入消费者路径。
- 业务服务如需关联一次内部运行，只能使用上述不带演练语义的内部关联信息；不得把场景名、控制状态、`faultRunId`、运营字段或内部控制 Header 暴露给消费者、Shopfront、公开响应、异常文本、原始堆栈、日志、指标或 trace。
- 消费者接口必须保持普通业务契约，异常统一转换为业务错误 envelope，不返回原始堆栈。异常类、方法、日志和错误消息必须采用业务命名，使用户不能从接口、错误详情、Header、日志、指标、trace 或堆栈判断请求来自受控场景。
- 新增或修改场景时，必须同时通过控制面 catalog 校验、目标业务路径测试、用户可见错误/堆栈检查和 `./scripts/check-runtime-terminology.sh`；任何一项失败都不能合并。

## 本地运行

### 前置条件

- Docker Engine 24+ 和 Docker Compose v2。
- JDK 21、Maven 3.8+；Java 服务和镜像构建都以 JDK 21 为基线。
- Node.js 22 与 Corepack/pnpm 10.27.0；这与两个 Next.js 镜像的运行时保持一致。
- 运行 [scripts/catalog-product-detail-smoke.sh](scripts/catalog-product-detail-smoke.sh) 还需要 `curl`、`jq` 和 Docker CLI。
- Compose 会把运行数据保存在 `data/`。数据预热默认开启，首次完整环境会持续写入较大的历史数据集；只做界面或接口联调时可在首次初始化前显式设置 `DATA_WARMUP_ENABLED=false`。首次初始化后，所有 `DATA_WARMUP_*` 只作为严格校验的数据库默认值，运行时以 Operations 页面保存的数据库配置为准。

### 1. 配置并启动 Compose

`./scripts/compose-up.sh` 默认从内部镜像仓库拉取镜像，再以 detached 模式执行 `docker compose up --no-build`。传入 `-s hub` 或 `-s dockerhub` 可改用 Docker Hub 风格镜像。启动前请设置以下配置：

| 变量 | 是否必需 | 用途 |
| --- | --- | --- |
| `CASTREL_JWT_SECRET` | 是 | Java 服务的 JWT 配置；控制面未设置专用会话密钥时也会以它回退。 |
| `CASTREL_INTERNAL_SERVICE_KEY` | 是 | 受保护服务间调用、控制面 worker 与重启 broker 的认证基础。 |
| `TRAFFIC_LIFECYCLE_ACCOUNTS` | 是 | 非空 JSON 账号数组。worker 启动时会校验；账号必须能登录当前 seed 或自建数据，密码至少 8 位。 |
| `CONTROL_PLANE_SESSION_SECRET` | 强烈建议 | 运营会话签名密钥。共享环境必须独立于 `CASTREL_JWT_SECRET`。 |
| `NOTIFICATION_RESTART_BROKER_KEY` | 建议 | broker 专用密钥；省略时回退为 `CASTREL_INTERNAL_SERVICE_KEY`。 |
| `TRAFFIC_SCENARIO_ACCOUNTS` | 建议 | 场景账号 JSON，必须包含 `sam@example.com`、`expectedCustomerId: 19` 的有效账号。 |
| `DATA_WARMUP_ENABLED` | 可选 | 仅在 `data_warmup_config` 尚不存在时初始化启用状态；后续运行时启停由 Operations 页面和数据库配置控制。 |
| `DATA_WARMUP_WINDOW_DAYS` / `DATA_WARMUP_ROWS_PER_DAY` / `DATA_WARMUP_TARGET_ROWS` | 可选 | 仅在首次创建 `data_warmup_config` 时初始化窗口和目标，且必须满足乘积不变量；后续由 Operations 页面编辑。 |
| `DATA_WARMUP_BATCH_SIZE` / `DATA_WARMUP_BATCH_INTERVAL_MS` / `DATA_WARMUP_MAX_CONCURRENCY` / `DATA_WARMUP_DB_CONCURRENCY` | 可选 | 仅在首次创建 `data_warmup_config` 时初始化批量和并发边界；后续由 Operations 页面编辑。 |
| `BASELINE_CAPTURE_ENABLED` | 可选 | 默认 `false`；开启 Operator baseline API 和旁路采集，不能在完成迁移、验证和回退前于共享环境启用。 |
| `CASTREL_RELEASE_REVISION` / `CASTREL_DEPLOYMENT_MODE` | 可选 | 为 baseline 注入发布 revision 和显式部署模式；缺失 revision 记录为 `UNKNOWN`，不通过运行时特征猜测。 |
| `BASELINE_OBSERVATION_CHECK_TIMEOUT_MS` / `BASELINE_OBSERVATION_WINDOW_SEC` | 可选 | 只读观测核验的单项超时和默认查询窗口，默认 `5000` / `900`，受边界校验且不包含任何凭据。 |

下面的值只用于本地示例，真实密码和随机密钥应经环境管理或 Secret 注入：

```bash
export CASTREL_JWT_SECRET='replace-with-a-random-secret'
export CASTREL_INTERNAL_SERVICE_KEY='replace-with-another-random-secret'
export CONTROL_PLANE_SESSION_SECRET='replace-with-a-third-random-secret'
export NOTIFICATION_RESTART_BROKER_KEY='replace-with-a-fourth-random-secret'
export TRAFFIC_LIFECYCLE_ACCOUNTS='[{"label":"alice","email":"alice@example.com","password":"<seeded-password>","expectedCustomerId":1}]'
export NOTIFICATION_RESTART_BROKER_KEY='replace-with-a-fourth-random-secret'
export TRAFFIC_LIFECYCLE_ACCOUNTS='[{"label":"alice","email":"alice@example.com","password":"<seeded-password>","expectedCustomerId":1}]'
export TRAFFIC_SCENARIO_ACCOUNTS='[{"label":"sam","email":"sam@example.com","password":"<sam-password>","expectedCustomerId":19}]'

# 仅在首次创建数据库配置前进行轻量本地联调时可关闭预热；已有配置不会被该变量覆盖。
export DATA_WARMUP_ENABLED=false

# 默认使用内部镜像源。若没有内部 registry 访问权限，使用 -s hub。
./scripts/compose-up.sh
# ./scripts/compose-up.sh -s hub

# 等待服务健康后检查入口；Runner 状态接口需要运营会话，不能作为匿名健康检查。
docker compose ps
curl -fsS http://localhost:18080/actuator/health
curl -fsSI http://localhost:13086/

# 访问运营控制台与消费者前台
open http://localhost:13086
open http://localhost:13090

# 停止容器会保留 data/ 中的本地状态。
docker compose down
```

Compose 的运营登录默认值是 `castrel` / `C@stre1_best_ai`，仅适合本地开发。共享部署必须覆盖 `CONTROL_PLANE_USERNAME`、`CONTROL_PLANE_PASSWORD` 和独立的 `CONTROL_PLANE_SESSION_SECRET`。正常启动会同时创建 Web/API 容器和 `traffic-control-plane-worker`；后者负责 Runner、报表/流量场景执行、资源补给、到期恢复、留存清理和可选数据预热。停止源码 worker 时请发送 `SIGINT` 或 `SIGTERM`，让它按顺序释放租约和受控资源。

### 2. 构建本地镜像

`build-all.sh` 会构建 common、全部 Java 服务、控制面、重启 broker 和 shopfront，默认目标平台为 `linux/amd64`。它默认使用本地基础镜像缓存；需要刷新基础镜像时增加 `--pull`。构建未推送的镜像后，直接调用 `docker compose`，避免 `compose-up.sh` 再次拉取远程镜像：

```bash
# 使用默认内部 registry 构建
./scripts/build-all.sh
docker compose up -d --no-build --pull never --force-recreate

# 使用 Docker Hub 风格的 castrel/* 标签构建
PLATFORM=linux/amd64 ./scripts/build-all.sh -s hub --tag local
REGISTRY=castrel IMAGE_TAG=local docker compose up -d --no-build --pull never --force-recreate
```

### 3. 源码运行控制面

只运行源码中的控制面时，Web/API 与 worker 仍是两个独立进程。Web/API 需要可用的 MySQL、Redis、Gateway 和会话密钥；worker 还需要 `CASTREL_INTERNAL_SERVICE_KEY` 与有效的生命周期账号配置：

```bash
cd traffic-control-plane
pnpm install

# 终端 A：Web/API，监听 13086
pnpm dev

# 终端 B：Runner、场景 worker、恢复、留存、补给和可选预热
pnpm worker
```

### 4. 可选 SkyWalking

默认观测链路是 OTel/Tempo。SkyWalking 仅提供 Compose profile，不随 Kubernetes 清单部署。推荐以下方式启动：脚本会自动包含项目 override；缺少 MySQL connector 时会下载 `mysql-connector-j-8.0.33.jar`。

```bash
COMPOSE_PROFILES=skywalking TRACING_MODE=both ./scripts/compose-up.sh -s hub
```

`TRACING_MODE=both` 同时报送 OTel 与 SkyWalking；`sw-only` 只启用 SkyWalking，默认 `otel-only` 则不需要该 profile。手工执行 `docker compose --profile skywalking ...` 前，必须先准备 connector JAR；脚本自动包含 [infra/skywalking/skywalking.override.yml](infra/skywalking/skywalking.override.yml) 和自动下载 JAR 的行为不会在手工启动时发生。在没有 Cloudwise 服务的独立本地环境中，可设置 `ENABLE_CLOUDWISE_AGENT=false`；该 agent 在 Compose 中默认开启。

`notification-restart-broker` 是独立容器，拥有 Docker Socket 的写权限；Promtail 仅以只读方式挂载 Socket，`traffic-control-plane` 和 worker 都不挂载。broker 只接受固定的 `notification-service` 重启请求，并在有界截止时间内轮询健康状态。

## Kubernetes

`k8s/` 是可部署模板，不应原样用于共享或生产环境。提交前与部署前都不得把真实密码、JWT 或运营账号写入仓库。至少完成以下替换和检查：

1. 在 [k8s/secrets/db-secret.yaml](k8s/secrets/db-secret.yaml) 替换数据库凭据、`CASTREL_JWT_SECRET` 和 `CASTREL_INTERNAL_SERVICE_KEY` 的开发值。
2. 在 [k8s/secrets/traffic-lifecycle-secret.yaml](k8s/secrets/traffic-lifecycle-secret.yaml) 配置非空的 `TRAFFIC_LIFECYCLE_ACCOUNTS`、包含有效 Sam 账号的 `TRAFFIC_SCENARIO_ACCOUNTS`，以及随机的 `NOTIFICATION_RESTART_BROKER_KEY`。
3. 当前两个 Secret 模板没有定义 `CONTROL_PLANE_USERNAME`、`CONTROL_PLANE_PASSWORD` 或 `CONTROL_PLANE_SESSION_SECRET`。因此 Web/API 会使用内置的开发登录值，并将会话签名回退到 `CASTREL_JWT_SECRET`。共享环境必须将这三个变量加入受管 Secret，并注入 `traffic-control-plane` Deployment。
4. 在 [k8s/kustomization.yaml](k8s/kustomization.yaml) 的 `images` 段设置要发布的镜像名称和 tag；先运行渲染校验，再执行 apply。

```bash
kubectl kustomize k8s >/dev/null
kubectl apply -k k8s
kubectl -n castrel get pods

# 集群没有配置外部 Ingress 时，可用 port-forward 访问
kubectl -n castrel port-forward svc/traffic-control-plane 13086:3086
kubectl -n castrel port-forward svc/shopfront 13090:3090
```

Kubernetes 维持独立的 Web/API 与 worker Deployment，并仅部署 Prometheus、Alertmanager、Grafana、Loki 与 Tempo；SkyWalking 是 Compose 专用 profile。broker 使用专用 `notification-restart-broker` ServiceAccount，Role 仅允许对 `castrel` 命名空间中名为 `notification-service` 的 Deployment 执行 `get` 和 `patch`；控制面本身没有 Kubernetes API 权限。

## 数据预热、时间与清理边界

- 全部 Java、Node.js、worker、MySQL 会话和日切逻辑使用 `Asia/Shanghai`（`+08:00`）。
- `product_price_history` 和 `user_behavior_log` 使用东八区 `RANGE COLUMNS` 日分区。
- 预热运行时配置保存在 `data_warmup_config` 单行表中，由 Operations 页面编辑并通过版本 CAS、CSRF、审计和影响确认保护；`windowDays × rowsPerDay` 必须等于 `targetRows`。`DATA_WARMUP_*` 仅用于首次初始化，数据库已有配置时不会覆盖。
- 预热只由 standalone worker 在持有 Redis lease 后写入；它通过心跳续租，失去 lease 后停止写入。空间或表大小保护触发时暂停。禁用预热只停止后续自动写入，不会停止 Runner、场景 worker、恢复、补给或留存任务；已有数据不会因禁用自动删除。
- `durationSec` 结束的是受控活动或租约，不等同于所有资源数据都会自动删除。通知存储追加保留运行级文件，必须在 catalog 允许且运行终止后进行确认式清理；通知堆保留属于明确的非释放型行为。
- Fault Run、事件和运行专属审计明细保留 7 天；活动、恢复中、服务不可用或清理未完成记录不会被留存任务删除。预热与手动清理只由受保护的控制面操作触发，并保留相应审计记录。

## 演练账号

`TRAFFIC_LIFECYCLE_ACCOUNTS` 与 `TRAFFIC_SCENARIO_ACCOUNTS` 都是对象 JSON 数组，但承担不同职责。前者供正常 Runner 的客户生命周期、订单查询和报表请求使用，worker 启动时必须至少解析出一个有效账号；后者用于独立场景账号校验，必须含 `sam@example.com` 且 `expectedCustomerId` 为 `19`。不要把两类账号混用，也不要把真实密码提交到仓库。

```json
[
    {"label":"alice","email":"alice@example.com","password":"<secret>","expectedCustomerId":1},
    {"label":"sam","email":"sam@example.com","password":"<secret>","expectedCustomerId":19}
]
```

`expectedCustomerId` 用于在登录后核验账户身份。当前商品详情 Redis Hash 场景通过 Catalog 商品详情 API 工作，不依赖 Sam 的购物车或 Cart Redis 大值路径。

## 控制面操作

登录控制台后，场景卡片只显示 catalog 固定的目标、操作和参数边界。创建、停止、清理和重启都要求运营会话、CSRF、确认、幂等键和审计记录；消费者接口不携带这些控制字段。

通知服务健康失败并进入 `SERVICE_UNAVAILABLE` 后，控制台才显示不带服务名、命令、镜像或 patch body 的固定重启操作。存储追加场景只能对已终止且被 catalog 标记允许清理的运行执行确认式清理。执行前应在控制台确认目标、参数边界、恢复策略和当前运行状态。

## 验证与维护

先按改动范围选择最小验证集，再运行会影响本地基础设施或数据的命令：

| 命令 | 覆盖范围与注意事项 |
| --- | --- |
| `cd traffic-control-plane && pnpm test:runner` | 控制面 Runner、catalog、账号、worker 和相关组件测试。 |
| `cd traffic-control-plane && pnpm test:runbook && pnpm test:i18n` | 操作手册内容与控制面国际化测试。 |
| `cd traffic-control-plane && pnpm typecheck && pnpm lint` | 控制面 TypeScript 与 ESLint。 |
| `cd shopfront && pnpm typecheck && pnpm lint && pnpm test:e2e` | Shopfront 类型、Lint 与 Playwright 端到端测试。 |
| `mvn test` | Java 模块测试。 |
| `./scripts/test-baseline.sh` | 运行 Maven test、启动并检查本地 MySQL/Redis、控制面 typecheck/lint，以及 Shopfront typecheck/lint/Playwright。它不会自动运行 `test:runner`、`test:runbook`、`test:i18n`、构建或 catalog smoke。 |
| `./scripts/catalog-product-detail-smoke.sh` | 需要已运行的完整环境、有效运营账号以及 `curl`/`jq`/Docker。脚本会创建运行、写入 Redis、经 Gateway 发起商品详情请求，再尝试停止和清理；不要把它当作无副作用的探测。 |
| `docker compose config --quiet` / `kubectl kustomize k8s >/dev/null` | 无需启动全栈的 Compose/Kubernetes 清单校验。 |
| `./scripts/check-runtime-terminology.sh` | 扫描控制面以外 `src/**` 是否泄露控制面术语或 catalog 标识。 |
| `git diff --check` | 检查待提交变更中的空白错误。 |

```bash
cd traffic-control-plane
pnpm install
pnpm typecheck
pnpm lint
pnpm test:runner
pnpm test:runbook
pnpm test:i18n
pnpm build

cd ..
cd shopfront
pnpm install
pnpm typecheck
pnpm lint
pnpm test:e2e

cd ..
mvn test

docker compose config --quiet
kubectl kustomize k8s >/dev/null
git diff --check
```

术语检查覆盖稳定的注入术语和 catalog 标识；评审仍须检查目标端文字、消费者接口、错误响应和原始堆栈没有泄露控制面语义。

## 补充资料

- 当前系统架构与主要功能： [docs/architecture-overview.md](docs/architecture-overview.md)
- 当前告警覆盖、触发阈值和已知缺口： [docs/runbooks/alert-scenario-matrix.md](docs/runbooks/alert-scenario-matrix.md)
- 当前服务拓扑： [docs/microservice-topology.md](docs/microservice-topology.md)
