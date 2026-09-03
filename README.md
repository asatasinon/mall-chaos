# Castrel Chaos

Castrel Chaos 是面向 SRE 培训的电商微服务平台。它通过真实业务请求、SQL、Redis、JVM、MySQL 锁和独立支付提供方，构造可观察、可恢复的 Fault Run 演练。

## 架构

```text
消费者浏览器 -> shopfront:13090 -> gateway-service:18080 -> 业务服务
运营浏览器   -> traffic-control-plane:13086
                 |-> Fault Run API / Runner / 控制台
                 |-> gateway-service（固定场景分发）
                 |-> MySQL / Redis（运行记录与租约）
                 `-> notification-restart-broker（固定通知服务重启）
```

控制面和 worker 不直连业务服务、PSP 或业务数据库表。业务请求必须经过 Gateway，运行记录和事件只写控制面数据表。消费者路径无法访问 `/internal/**` 运营入口。

## 固定场景

控制台从唯一场景 catalog 渲染 11 个场景：

- 商品浏览慢报表、订单查询慢报表
- 商品浏览流量突增、订单查询流量突增
- 购物车 Redis 大值读取、加购目录依赖失败
- 通知内存压力、通知存储追加
- 优惠券预留竞争、库存表独占锁
- PSP 提供方拒付或超时

全环境同时只允许一条 `CREATING`、`ACTIVE` 或 `RECOVERING` 运行。每次运行带 `faultRunId`、`expiresAt`、单调 `fencingToken`、确认和幂等键。控制台展示活动锁、倒计时、运行事件、停止结果和恢复结果。

## 本地启动

前置条件：Docker 24+、Docker Compose v2、JDK 21、Maven 3.8+、Node.js 20+ 和 pnpm。

```bash
# 设置必需密钥后，直接启动完整环境
export CASTREL_JWT_SECRET='change-me'
export CASTREL_INTERNAL_SERVICE_KEY='change-me-too'
export NOTIFICATION_RESTART_BROKER_KEY='a-separate-random-key'
./scripts/compose-up.sh

# 访问运营控制台与消费者前台
open http://localhost:13086
open http://localhost:13090

# 使用源码构建全部镜像，再启动
./scripts/build-all.sh
docker compose up -d --no-build

# 查看和关闭环境
docker compose ps
docker compose down
```

`notification-restart-broker` 是独立容器，唯一挂载 Docker Socket；`traffic-control-plane` 没有 Docker Socket。broker 只接受固定的 `notification-service` 重启请求，并在有界截止时间内轮询健康状态。

## Kubernetes

```bash
kubectl apply -k k8s
kubectl -n castrel get pods
```

Kubernetes broker 使用专用 `notification-restart-broker` ServiceAccount。Role 仅允许 `castrel` 命名空间中名为 `notification-service` 的 Deployment 执行 `get` 和 `patch`，控制面没有 Kubernetes API 权限。部署前必须将 `k8s/secrets/traffic-lifecycle-secret.yaml` 中的 broker key 替换为随机值。

## 数据与时间

- 全部 Java、Node.js、worker、MySQL 会话和日切逻辑使用 `Asia/Shanghai`（`+08:00`）。
- `product_price_history` 和 `user_behavior_log` 使用东八区 `RANGE COLUMNS` 日分区。
- 每表维持今天及前 179 天、每天 500,000 行，目标约 90,000,000 行。
- 预热只由 standalone worker 持有 Redis lease 后写入；空间和表大小保护触发时暂停。
- Fault Run、事件和运行专属审计明细保留 7 天；活动、恢复中、服务不可用或清理未完成记录不会被留存任务删除。

## 演练账号

`TRAFFIC_SCENARIO_ACCOUNTS` 使用对象 JSON 数组，例如：

```json
[{"label":"sam","email":"sam@example.com","password":"<secret>","expectedCustomerId":19}]
```

Sam（用户 ID 19）只用于 Redis 大值演练的独立购物车，不参与正常 Runner 生命周期。真实密码通过 Secret 注入，不提交到仓库。

## 控制面操作

登录控制台后，场景卡片只显示 catalog 固定的目标、操作和参数边界。创建、停止、清理和重启都要求运营会话、CSRF、确认、幂等键和审计记录。

内存场景到期后不释放已保留对象。通知服务健康失败并进入 `SERVICE_UNAVAILABLE` 后，控制台才显示不带服务名、命令、镜像或 patch body 的固定重启操作。存储追加场景只能对已经终止且被 catalog 标记允许清理的运行，按 `faultRunId` 执行确认式清理。

## 相关命令

```bash
cd traffic-control-plane
pnpm typecheck
pnpm lint
pnpm build

cd ..
mvn test

docker compose config --quiet
kubectl kustomize k8s >/dev/null
git diff --check
```

架构和场景细节见 [_docs/chaos-inject-plane/product.md](_docs/chaos-inject-plane/product.md)、[_docs/chaos-inject-plane/tech.md](_docs/chaos-inject-plane/tech.md) 和 [_docs/chaos-inject-plane/task-list.md](_docs/chaos-inject-plane/task-list.md)。
