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
| JVM | JVM 内存泄漏 | Notification 保留高基数对象，允许 JVM 堆自然耗尽。 |
| 存储 | 通知存储增长 | Notification 持久化事务追加受限、可识别的数据量。 |
| 数据库 | 促销死锁 | 优惠券预留和过期清理以相反锁顺序运行真实事务。 |
| 数据库 | 库存表锁 | 专用连接持有 `inventories` 表写锁，库存读取实际阻塞。 |
| 数据库 | 库存行锁 | 专用事务对固定库存记录执行 `SELECT ... FOR UPDATE`，预留摘要实际等待。 |
| 外部依赖 | PSP 外部依赖 | Payment 调用独立 PSP，按授权、拒付或超时得到真实远程结果。 |

全环境同时只允许一条 `CREATING`、`ACTIVE` 或 `RECOVERING` 运行。每次运行带 `faultRunId`、`expiresAt`、单调 `fencingToken`、确认和幂等键。控制台展示活动锁、倒计时、运行事件、停止结果和恢复结果。

## 真实性与术语隔离

- 所有场景必须通过真实业务 HTTP、SQL、Redis、JVM、存储、锁或 PSP 调用产生可观察效果。禁止以 `SLEEP()`、伪造延迟、Controller 直接伪造业务失败、随机假结果或专用演示返回值模拟结果。
- 除 `traffic-control-plane` 外，运行时源码不得出现“故障注入”“故障演练”“故障场景”及同义说明，也不得包含 catalog 场景 ID 或展示名称。该限制覆盖 Gateway、业务服务、`common` 和 `psp-simulator` 的路由、Endpoint、类/方法、DTO、参数、错误码、日志、指标、trace 属性、注释和配置键。
- 非控制面服务如需关联一次受控运行，只能使用不带演练语义的内部关联信息；不得把场景名、控制状态或运营字段放入消费者请求、响应、Header、异常或可观测性数据。
- 面向消费者的接口必须保持正常业务语义，并统一转换异常而不返回原始堆栈。异常类、方法与消息也必须采用业务命名，使用户无法从接口、错误详情或堆栈判断异常由演练触发。

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
