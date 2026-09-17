# Phase 0 发布、资源与运行护栏

> 本文件是 Batch 0 的维护者/Operator 护栏，不是 Catalog 或业务服务契约。
> 场景事实、目标 operation、参数、时长和 recovery strategy 只从
> `traffic-control-plane/src/lib/fault-run-catalog.ts` 读取。
>
> 当前记录窗口：2026-09-17
> 当前 Catalog revision：
> `a9f117905993ed8898c0276c5c40267c4a434fc89b6254be8cb1725a7f15702b`
>
> 历史 Compose 健康核验使用的 revision 为
> `000ccc36e4a77ef27d22636bdbc4643ff79ddb0c205b21830967bc40b7abd7dc`；
> 两代 revision 的运行差异和 Redis 参数合同修订见
> [`catalog-coverage-matrix.md`](./catalog-coverage-matrix.md)。

## 1. 配置合同

Web 与 Worker 必须注入同一组发布和观测配置。默认关闭旁路采集，不新增
密码、token 或 service key。

| 配置 | 默认值 | 边界与用途 |
| --- | --- | --- |
| `BASELINE_CAPTURE_ENABLED` | `false` | 关闭时 baseline/pilot 写入口不可用；不停止 Worker，不改变 Fault Run 或业务请求 |
| `CASTREL_RELEASE_REVISION` | `UNKNOWN` | 由镜像构建/部署流水线注入 immutable digest 或 revision；缺失只形成 baseline limitation |
| `CASTREL_DEPLOYMENT_MODE` | `compose`（Compose）/ `kubernetes`（Kubernetes）/ `unknown`（代码默认） | 只接受显式配置，不通过 hostname、端口或 `NODE_ENV` 推断 |
| `BASELINE_OBSERVATION_CHECK_TIMEOUT_MS` | `5000` | 单项只读观测核验超时，边界 `1000..60000` 毫秒 |
| `BASELINE_OBSERVATION_WINDOW_SEC` | `900` | 默认观测查询窗口，边界 `60..86400` 秒；实际窗口还必须受场景 duration 与 retention 限制 |

当前配置来源：

- Compose 的 `traffic-control-plane` 与
  `traffic-control-plane-worker` 同时注入上述变量，默认值来自
  `docker-compose.yml`。
- Kubernetes Web 与 Worker 通过 `k8s/configmap/app-config.yaml` 共享同一组
  非秘密值；秘密仍只来自既有 Secret。
- `traffic-control-plane/src/lib/env.ts` 对超时和窗口执行整数边界校验。当前
  capture service 仍只保存观测摘要，未将缺失的现场观测伪造成可用结果。

## 2. 环境资源预算与实际边界

预算是声明的容量边界，不是资源耗尽、告警 firing、OOM 或固定恢复耗时的承诺。
实际运行必须记录 `UNKNOWN`、限制或真实观测摘要；不能用请求数量或固定延迟
推断资源结果。

| 环境 | 声明预算 | 已知实际观察 | 适用范围与限制 |
| --- | --- | --- | --- |
| 开发 Compose | Compose 没有为业务容器统一设置 CPU/内存上限；通用 Java 服务通常使用 `-Xmx256m`，Order 使用 `-Xmx1024m`；控制面与 Worker 使用应用配置和宿主机资源 | Apple Silicon 本地完整栈健康核验时，Order 曾因资源不足退出码 137；只为健康核验临时使用较低 JVM 上限后恢复 | 适合接口、迁移和文档联调；不能作为性能、容量或阶段 5 pilot 基线 |
| full disposable Compose | 同开发 Compose 的镜像和 JVM 声明，观测数据与业务数据使用工作区 `data/` 挂载 | 本窗口只做过健康/观测组件核验，没有执行新的场景或 warmup 写入；业务资源实际余量为 `UNKNOWN` | 只允许在明确停止窗口内运行；必须保留磁盘下限、危险场景隔离和人工停止边界 |
| 专用 Kubernetes pilot | 控制面 Web/Worker：`256Mi/250m` request、`512Mi/500m` limit；普通 Java 业务服务通常 `256Mi/250m`、`512Mi/500m`；Order/Payment `768Mi` limit；Shopfront/PSP `256Mi` limit；MySQL `512Mi/1Gi`、Redis `128Mi/256Mi` | 当前 Kubernetes namespace/runtime 未部署或未核验；不能把 manifest request/limit 写成实际使用量 | 只有在 namespace owner、观测 retention、告警接收和数据处理窗口明确后，才可进入单场景核验；完整清单以 `k8s/**/deployment.yaml` 为准 |

P0-14 远端 Compose 已完成 12 个 Catalog 条目、Redis 合同修订重跑、Data
Warmup 目标核验和 default-off 回退 smoke；这些结果是运行集合的事实，不把
Compose 资源观察外推为 Kubernetes 容量或性能基线。远端运行集合和限制见
[`task-list.md`](./task-list.md#p0-14-远端-compose-验收记录2026-09-17)。

### 2.1 危险场景隔离

| 场景类别 | 共享风险 | 必须具备的隔离与停止条件 |
| --- | --- | --- |
| `NOTIFICATION_STORAGE_APPEND` | 运行级文件增长可能消耗 `/data`；Kubernetes notification volume 声明 `12Gi` `emptyDir`，Compose 使用宿主机挂载 | 使用 disposable/专用卷；运行前记录可用空间和保护阈值；触及磁盘保护线、无关文件变化或写入边界不明时停止新业务写入并保留 limitation |
| `NOTIFICATION_HEAP_PRESSURE` | retained object 不承诺释放，可能扩展到 JVM heap、GC、节点内存和服务健康 | 单独实例/节点或明确的资源预算；出现临界 heap、频繁 GC、健康失败或节点压力时停止该场景，不能等待资源自行恢复 |
| `CATALOG_REDIS_LARGE_VALUE` | 逻辑 Hash 预算可能增加共享 Redis 内存，逻辑字节数不等于物理利用率 | 使用可观测的专用 Redis 容量或明确预留；超过 Redis/节点保护线、出现 eviction 或业务错误时停止并保留物理资源未知 |
| `INVENTORY_TABLE_EXCLUSIVE` / `INVENTORY_ROW_LOCK` / `PROMOTION_LOCK_CONTENTION` | 表锁、行锁或事务争用可能阻塞其他业务、占用连接池和 MySQL 线程 | 只在隔离数据集和明确业务低峰运行；出现非目标业务阻塞、连接池耗尽、数据库保护阈值或无法确认锁持有者时停止并验证正常业务路径 |
| `BROWSE_SURGE` / `ORDER_QUERY_SURGE` / 报表场景 | 受控流量可能扩展到 Gateway、Hikari、MySQL、Redis、节点 CPU/内存，且静态 dispatch 不代表请求已到达 | 仅使用专用或 disposable 流量窗口；请求率、错误率、延迟或共享资源越过预设保护线时停止新流量并等待可验证 drain，不把停止统计当作 drain 成功 |
| `PSP_PROVIDER_OUTCOME` | payment/PSP 结果可能影响订单创建和业务数据 | 使用 disposable 业务数据和明确的 provider outcome 边界；出现非目标订单/支付数据变化或无法区分业务结果时停止并保留证据限制 |

### 2.2 通用停止标准

以下任一情况出现时，Operator 必须停止当前核验并记录事实，不把停止动作解释为
恢复成功：

- 观测入口、控制面或目标服务健康状态无法确认；
- 磁盘、Redis、JVM、连接池、MySQL 或节点保护阈值达到运行手册规定的边界；
- Worker/Runner 缺少当前命名的终态或 drain 摘要；
- 请求出现非目标业务数据变更、消费者契约变化或无法归属的副作用；
- 当前运行的 recovery/cleanup 边界无法按 Catalog 解释；
- 任何需要手工数据处理的场景未取得明确确认。

## 3. 场景运行前后 smoke 与 baseline 步骤

### 3.1 运行前

1. 读取当前 Catalog revision、目标映射和 runbook；不得手工复制场景参数。
2. 确认 Operator session、审计、CSRF、观测入口和停止窗口；不要把配置文件中的
   Alertmanager URL 当作 receipt 能力。
3. 核对控制面、Gateway、目标服务、MySQL、Redis、Prometheus、Loki、Tempo 和
   Alertmanager 的健康状态；未知项记录为 `UNKNOWN`。
4. 核对 Data Warmup 数据库配置、租约/进度和数据处理边界；不通过手工 SQL
   或删除数据修复 stale progress。
5. 核对场景专属资源保护线、危险场景隔离、可用磁盘和目标服务正常业务 smoke。
6. 在场景运行前保存只读配置摘要：release revision、deployment mode、
   schema revision、warmup metadata 和观测配置；不保存凭据、原始观测载荷或
   完整日志/trace。

### 3.2 运行中与结束后

1. 按 Catalog 的固定 operation 和 `durationSec` 运行；只接受目标服务真实业务
   HTTP、SQL、Redis、JVM、存储、锁或 PSP 结果。
2. 观察 Worker/Runner 的开始、请求摘要、停止和 drain/lifecycle summary；缺失
   事件时保留 `INCOMPLETE`，不回填请求数、延迟或成功数。
3. 按 Catalog `recoveryStrategy` 阅读 recovery/cleanup：`WORKER`、`TARGET`、
   `MANUAL_CLEANUP`、`NON_RELEASING` 的事实边界不可互换。
4. baseline capture 只允许在终态和开关开启、迁移可用、Operator 审计成功时执行；
   `SOURCE_FAULT_RUN_ID` 幂等重复请求不得生成第二份摘要或审计。
5. 按时间线检查 `prepareStartedAt`、`activeAt`、`stopRequestedAt`、
   `recoveredAt`、`cleanupFinishedAt`；`RECOVERY_COMPLETED` 不自动等于业务恢复。
6. 分别记录五类失败：`TARGET_EFFECT_FAILURE`、`CONTROL_PLANE_FAILURE`、
   `WORKER_FAILURE`、`RECOVERY_FAILURE`、`CLEANUP_FAILURE`。
7. 复核残留资源、业务数据、观测窗口和告警 receipt；不把 Prometheus/Loki/Tempo
   readiness、候选 rule 或 `send_resolved` 配置写成实际 firing。
8. `MANUAL_CLEANUP` 只在确认后处理 run-scoped 文件/数据并验证无关资源；
   `NON_RELEASING` 必须保留残留边界，不承诺自动释放。

## 4. 发布检查与回退手册

### 4.1 发布前检查

- 新镜像已注入相同的 `CASTREL_RELEASE_REVISION`，Web/Worker 的
  `CASTREL_DEPLOYMENT_MODE` 一致。
- `BASELINE_CAPTURE_ENABLED=false` 仍是默认和共享环境初始值。
- `baseline` migration、fresh-install SQL 与 schema revision 一致，且 schema
  初始化失败不会阻断既有 Fault Run 生命周期。
- 观测 timeout/window 已通过配置边界校验；没有新增凭据，外部观测认证仍由部署
  侧管理。
- 资源预算、危险场景隔离、停止标准和 Operator owner 已登记。
- Alertmanager route、机器认证、receipt 和 resolved 集成事实未确认前，不得把
  pilot 或 Agent 前置条件标成可用。

### 4.2 关闭旁路采集

1. 将 `BASELINE_CAPTURE_ENABLED` 关闭并重新加载 Web/Worker 配置。
2. 观察新增 baseline/pilot 路由返回 disabled 边界；确认既有 Fault Run API、
   Worker、Gateway 和业务请求仍可用。
3. 不删除 `scenario_baselines`、`baseline_pilot_reviews`、Fault Run、业务数据
   或观测数据；已写 baseline 保持可读。
4. 保留关闭前后的 release revision、审计和健康摘要；若配置 reload 失败，按镜像
   回退路径处理，不静默宣称已关闭。

### 4.3 Web/Worker 镜像回退

- 先关闭旁路采集，再按现有 Worker graceful stop 边界处理正在运行的 Worker；
  不把进程终止、未完成 drain 或旧镜像启动成功写成业务恢复。
- Web/Worker 回到上一 immutable revision 时保留新增 additive schema 和已写
  baseline；旧版本不能删除新表或重写历史摘要。
- 对 active Fault Run 只读取状态和事件，按原有生命周期与 Catalog recovery
  边界处理；不因镜像回退删除运行记录、残留资源或业务数据。
- 若 schema 初始化失败，保留明确的 `BASELINE_CAPTURE_FAILED`/limitation，
  继续使用既有 Fault Run 路径；修复 migration 后再重试，不重置 MySQL volume。
- 回退后重新执行健康、消费者业务 smoke、Worker 存活和 baseline 只读检查，并
  将未完成的审计/事件保留为失败或未知，不改写成成功。

## 5. 事件和低基数指标约定

### 5.1 允许的事件边界

终态和 baseline 事件统一包含 `schemaVersion`、`source`、`phase`、`status`；
payload 只允许白名单内的状态、计数、延迟、cache/drain 摘要和稳定 failure code，
统一限制为 8 KiB UTF-8。现有可复用事件包括：

- `BASELINE_CAPTURE_REQUESTED`
- `BASELINE_RUNTIME_SUMMARY_RECORDED`
- `BASELINE_OBSERVATION_CHECK_RECORDED`
- `BASELINE_CAPTURE_COMPLETED`
- `BASELINE_CAPTURE_INCOMPLETE`
- `BASELINE_CAPTURE_FAILED`
- `REPORT_WORKER_STARTED` / `REPORT_WORKER_STOPPED`
- `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_STOPPED` /
  `SCENARIO_WORKER_DRAINED`
- `RUNNER_LIFECYCLE_SUMMARY`

事件行可通过数据库内部关联键归属运行，但 payload 不能复制 run/lifecycle ID、
消费者字段或目标服务控制状态。

### 5.2 低基数指标边界

新增或复用指标只能使用固定集合的 `service`、`operation`、`phase`、`status`、
`deployment_mode`、`failure_code` 或固定 `alert_name` 标签。禁止将
`runId`、`faultRunId`、`traceId`、email、SKU、URL、异常文本或请求参数作为
metric label；场景名只允许留在控制面维护者文档和受保护的控制面摘要中。

### 5.3 禁止记录内容

事件、指标、baseline JSON、audit 摘要和 Operator API 输出均不得记录 Cookie、
Authorization、密码、secret、token、原始 SQL/shell、完整 Alertmanager
envelope、完整日志/trace、原始 HTTP 响应、堆栈或可执行 remediation。只保存
稳定错误 code、状态、计数、时间窗口、查询引用和 limitation。

## 6. Rollout 路径

| 阶段 | 开关与范围 | 进入条件 | 回退点 |
| --- | --- | --- | --- |
| 0. 代码部署但关闭 | 部署 Web/Worker、schema 和配置；`BASELINE_CAPTURE_ENABLED=false` | typecheck/lint/build、migration parity、Compose/Kubernetes config 通过 | 保留旧镜像或 additive schema；不改变业务路径 |
| 1. disposable 联调 | 仅在当前工作区或一次性 Compose 验证配置、只读页面和 disabled/health smoke | Operator owner、停止窗口、资源保护线和观测入口明确 | 关闭开关并停止新旁路采集；保留数据和历史摘要 |
| 2. 测试环境旁路 | 单一测试环境、单 Operator、受控 source run；只允许低风险场景先行 | session/CSRF/audit、baseline 幂等、观测窗口和失败分类有证据 | 先关闭开关，再按 Worker graceful stop 和镜像回退处理 |
| 3. 单环境 pilot 核验 | 至多一个满足真实 baseline、告警 receipt、retention、业务恢复和资源边界的场景 | Alertmanager route/认证/receipt/resolved 和 Kubernetes runtime 已独立核验 | 保留 baseline/review，关闭采集，不删除业务或运行数据 |
| 4. 关闭回退 | 关闭开关并复核既有 Fault Run、Worker、Gateway 和消费者路径 | 回退 smoke 与审计完成 | 若失败，停留在代码部署但关闭阶段并登记 limitation |

任何阶段都不改变消费者 HTTP/SQL/Redis/PSP 契约，不向目标服务传递 Catalog
身份或控制面生命周期状态，也不授予 Agent 写权限。
