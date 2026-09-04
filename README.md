# Castrel Chaos

Castrel Chaos 是面向 SRE 培训的电商微服务平台。它通过真实业务请求、SQL、Redis、JVM、存储、MySQL 锁和独立支付提供方，构造可观察、可恢复的业务异常演练；不以伪造延迟、伪造业务结果或 Controller 直返失败代替真实行为。

## 架构

```text
消费者浏览器 -> shopfront:13090 -> gateway-service:18080 -> 业务服务
运营浏览器   -> traffic-control-plane:13086
                 |-> 受保护的运行控制 API / Runner / 控制台
                 |-> gateway-service（固定业务操作）
                 |-> MySQL / Redis（运行记录与租约）
                 `-> notification-restart-broker（固定通知服务重启）
```

控制面和 worker 不直连业务服务、PSP 或业务数据库表。业务请求必须经过 Gateway，运行记录和事件只写控制面数据表。消费者路径无法访问 `/internal/**` 运营入口。

`traffic-control-plane` 是唯一持有场景 catalog、运行生命周期、运营审计和恢复控制语义的模块；其余运行时服务只保留自然的业务语义。场景 catalog 的权威实现是 [traffic-control-plane/src/lib/fault-run-catalog.ts](traffic-control-plane/src/lib/fault-run-catalog.ts)。

Compose 和 Kubernetes 都将控制面拆成两个独立 workload：`traffic-control-plane` 只运行 Next.js Web/API，`traffic-control-plane-worker` 才运行 Runner、场景 worker、恢复/留存任务和数据预热。两者必须使用同一套 MySQL、Redis、Gateway 和密钥配置；只启动 Web 容器不会启动后台运行任务。

## 组件与端口

以下是 Compose 默认发布到宿主机的端口；业务服务本身只加入 `castrel-net`，不直接发布宿主机端口。

| 组件 | 宿主机端口 | 用途 |
| --- | ---: | --- |
| `traffic-control-plane` | `13086` | 运营控制台与受保护 Route Handler |
| `shopfront` | `13090` | 消费者前台 |
| `gateway-service` | `18080` | 业务请求入口 |
| MySQL | `13306` | 本地开发数据库 |
| Redis | `16379` | 本地开发 Redis |
| Grafana | `13000` | 观测面板 |
| Prometheus | `19090` | 认证后的 Prometheus API |
| Alertmanager | `19093` | 认证后的告警管理 API |
| Loki | `13100` | 认证后的日志查询 API |
| Tempo | `13200` | 认证后的 Trace API |

SkyWalking 是可选 Compose profile：`docker compose --profile skywalking up -d`；启用后 UI 经 `13091` 访问，OAP 接收端口为 `11800`（gRPC）和 `12800`（HTTP）。默认观测链路使用 OTel/Tempo，不需要启用该 profile。

## 受控场景

控制台从唯一 catalog 渲染以下 12 个固定场景。每项的效果都来自列出的真实业务路径和资源行为：

| 类别 | 场景 | 固定业务位置与真实行为 |
| --- | --- | --- |
| 报表 | 商品浏览慢 SQL | Catalog 商品浏览报表扫描历史行为数据。 |
| 报表 | 订单报表慢 SQL | Order 客户订单报表查询历史订单并读取明细。 |
| 流量 | 浏览流量突增 | Runner 经 Gateway 持续调用公开商品浏览 API。 |
| 流量 | 订单查询突增 | Runner 经 Gateway 以合规演示客户持续调用订单查询 API。 |
| 缓存 | 商品详情 Redis Hash | Catalog 商品详情 API 读取运行级 Hash 中的真实 Redis 大值。 |
| 依赖 | 购物车依赖失败 | 加购前的 Cart-to-Catalog 商品校验真实失败，写入前终止。 |
| JVM | JVM 内存压力 | Notification 真实通知路径保留高基数对象，允许 JVM 堆自然耗尽；到期不释放已保留对象。 |
| 存储 | 通知存储增长 | Notification 持久化事务追加受限、可识别的数据量。 |
| 数据库 | 促销死锁 | 优惠券预留和过期清理以相反锁顺序运行真实事务。 |
| 数据库 | 库存表锁 | 专用连接持有 `inventories` 表写锁，库存读取实际阻塞。 |
| 数据库 | 库存行锁 | 专用事务对固定库存记录执行 `SELECT ... FOR UPDATE`，预留摘要实际等待。 |
| 外部依赖 | PSP 外部依赖 | Payment 调用独立 PSP，按授权、拒付或超时得到真实远程结果。 |

全环境同时只允许一条 `CREATING`、`ACTIVE` 或 `RECOVERING` 运行。运行记录带 `faultRunId`、`expiresAt`、单调 `fencingToken` 和固定目标快照；创建、停止、清理与重启请求还必须带确认和幂等键。控制台展示活动锁、倒计时、运行事件、停止结果和恢复结果。

## 真实性与术语隔离

- 所有场景必须通过真实业务 HTTP、SQL、Redis、JVM、存储、锁或 PSP 调用产生可观察效果。禁止以 `SLEEP()`、伪造延迟、Controller 直接伪造业务失败、随机假结果或专用演示返回值模拟结果。
- 除 `traffic-control-plane` 外，运行时源码不得出现“故障注入”“故障演练”“故障场景”及同义说明，也不得包含 catalog 场景 ID 或展示名称。该限制覆盖 Gateway、业务服务、`common` 和 `psp-simulator` 的路由、Endpoint、类/方法、DTO、参数、错误码、日志、指标、trace 属性、注释和配置键。
- 非控制面服务如需关联一次受控运行，只能使用不带演练语义的内部关联信息；不得把场景名、控制状态或运营字段放入消费者请求、响应、Header、异常或可观测性数据。
- 面向消费者的接口必须保持正常业务语义，并统一转换异常而不返回原始堆栈。异常类、方法与消息也必须采用业务命名，使用户无法从接口、错误详情或堆栈判断异常由演练触发。

## 本地启动

前置条件：Docker 24+、Docker Compose v2、JDK 21、Maven 3.8+、Node.js 20+ 和 pnpm 10.27.0。

### Docker Compose

完整环境启动前至少要提供三个密钥和一组非空的 Runner 生命周期账号。`TRAFFIC_LIFECYCLE_ACCOUNTS` 默认是空数组，worker 会拒绝在没有生命周期账号时启动；账号密码必须与 seed 数据或你自己的用户数据匹配，且密码长度至少为 8 个字符。

```bash
export CASTREL_JWT_SECRET='replace-with-a-random-secret'
export CASTREL_INTERNAL_SERVICE_KEY='replace-with-another-random-secret'
export NOTIFICATION_RESTART_BROKER_KEY='replace-with-a-third-random-secret'

# 至少放入一个 expectedCustomerId 不为 19 的启用 Runner 账号。
export TRAFFIC_LIFECYCLE_ACCOUNTS='[{"label":"alice","email":"alice@example.com","password":"<seeded-password>","expectedCustomerId":1}]'

# 必须包含 Sam（customer ID 19）；这是独立的场景账号配置。
export TRAFFIC_SCENARIO_ACCOUNTS='[{"label":"sam","email":"sam@example.com","password":"<sam-password>","expectedCustomerId":19}]'

# 默认使用内部镜像仓库；脚本会先执行 docker compose pull。
./scripts/compose-up.sh

# 访问运营控制台与消费者前台
open http://localhost:13086
open http://localhost:13090

# 查看和关闭环境
docker compose ps
docker compose down
```

控制台默认登录账号由 Compose 提供，为 `castrel` / `C@stre1_best_ai`；共享环境必须通过 `CONTROL_PLANE_USERNAME`、`CONTROL_PLANE_PASSWORD` 和 `CONTROL_PLANE_SESSION_SECRET` 覆盖默认值。正常启动会同时创建 Web 与 `traffic-control-plane-worker` 容器；worker 收到 `SIGINT`/`SIGTERM` 后才会按顺序释放租约、停止 worker 和关闭连接。

`compose-up.sh` 支持 `internal`（默认）和 `dockerhub`/`hub` 镜像源：

```bash
./scripts/compose-up.sh -s dockerhub
./scripts/compose-up.sh -s internal -- --force-recreate
```

### 本地构建镜像

`build-all.sh` 会构建 common、全部 Java 服务、控制面、重启 broker 和 shopfront；默认平台是 `linux/amd64`。构建完成后不要让 Compose 再拉取远程镜像：

```bash
# 使用默认内部 registry 构建
./scripts/build-all.sh
docker compose up -d --no-build --pull never --force-recreate

# 使用 Docker Hub 风格的 castrel/* 标签构建
PLATFORM=linux/amd64 ./scripts/build-all.sh -s hub --tag local
REGISTRY=castrel IMAGE_TAG=local docker compose up -d --no-build --pull never --force-recreate
```

如需只运行源码中的控制面，分别在两个终端执行 `cd traffic-control-plane && pnpm install && pnpm dev` 和 `cd traffic-control-plane && pnpm worker`；worker 仍需要可用的 MySQL、Redis、Gateway、密钥及账号环境变量。

`notification-restart-broker` 是独立容器，拥有 Docker Socket 的写权限；Promtail 仅以只读方式挂载 Socket，`traffic-control-plane` 和 worker 都不挂载。broker 只接受固定的 `notification-service` 重启请求，并在有界截止时间内轮询健康状态。

## Kubernetes

部署前先修改 `k8s/secrets/db-secret.yaml` 和 `k8s/secrets/traffic-lifecycle-secret.yaml` 中的占位密钥。`traffic-lifecycle-secret.yaml` 的 `TRAFFIC_LIFECYCLE_ACCOUNTS` 不能保持空数组，`TRAFFIC_SCENARIO_ACCOUNTS` 必须包含 customer ID 19 的 Sam 账号；镜像 tag 由 `k8s/kustomization.yaml` 的 `images` 段控制。

```bash
kubectl apply -k k8s
kubectl -n castrel get pods

# 集群没有配置外部 Ingress 时，可用 port-forward 访问
kubectl -n castrel port-forward svc/traffic-control-plane 13086:3086
kubectl -n castrel port-forward svc/shopfront 13090:3090
```

Kubernetes broker 使用专用 `notification-restart-broker` ServiceAccount。Role 仅允许 `castrel` 命名空间中名为 `notification-service` 的 Deployment 执行 `get` 和 `patch`，控制面没有 Kubernetes API 权限。

## 数据与时间

- 全部 Java、Node.js、worker、MySQL 会话和日切逻辑使用 `Asia/Shanghai`（`+08:00`）。
- `product_price_history` 和 `user_behavior_log` 使用东八区 `RANGE COLUMNS` 日分区。
- 预热窗口由 `DATA_WARMUP_WINDOW_DAYS`、`DATA_WARMUP_ROWS_PER_DAY` 和 `DATA_WARMUP_TARGET_ROWS` 共同决定，三个值必须保持一致：`180 × 300,000 = 54,000,000`。
- 预热只由 standalone worker 持有 Redis lease 后写入；空间或表大小保护触发时暂停。设置 `DATA_WARMUP_ENABLED=false` 只禁用预热，不会停止 Runner、场景 worker、恢复和留存任务。
- Fault Run、事件和运行专属审计明细保留 7 天；活动、恢复中、服务不可用或清理未完成记录不会被留存任务删除。

## 演练账号

`TRAFFIC_LIFECYCLE_ACCOUNTS` 和 `TRAFFIC_SCENARIO_ACCOUNTS` 都使用对象 JSON 数组。前者供正常 Runner 的客户生命周期、订单查询和报表请求使用，必须至少包含一个可用账号；Runner 会排除 customer ID 19。后者必须包含 Sam，供独立场景账号校验使用，不应与正常 Runner 生命周期混用。例如：

```json
[
    {"label":"alice","email":"alice@example.com","password":"<secret>","expectedCustomerId":1},
    {"label":"sam","email":"sam@example.com","password":"<secret>","expectedCustomerId":19}
]
```

Sam（用户 ID 19）是固定的 `TRAFFIC_SCENARIO_ACCOUNTS` 校验账号，不参与正常 Runner 生命周期；当前商品详情 Redis Hash 场景通过 Catalog 商品详情 API 工作，不再依赖 Sam 的购物车或 Cart Redis 大值路径。真实密码通过 Secret 注入，不提交到仓库。

## 控制面操作

登录控制台后，场景卡片只显示 catalog 固定的目标、操作和参数边界。创建、停止、清理和重启都要求运营会话、CSRF、确认、幂等键和审计记录。

内存场景到期后不释放已保留对象。通知服务健康失败并进入 `SERVICE_UNAVAILABLE` 后，控制台才显示不带服务名、命令、镜像或 patch body 的固定重启操作。存储追加场景只能对已经终止且被 catalog 标记允许清理的运行，按 `faultRunId` 执行确认式清理。

## 相关命令

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

架构和场景细节见 [_docs/chaos-inject-plane/product.md](_docs/chaos-inject-plane/product.md)、[_docs/chaos-inject-plane/tech.md](_docs/chaos-inject-plane/tech.md) 和 [_docs/chaos-inject-plane/task-list.md](_docs/chaos-inject-plane/task-list.md)。告警与场景覆盖、触发阈值和当前缺口见 [docs/runbooks/alert-scenario-matrix.md](docs/runbooks/alert-scenario-matrix.md)。
