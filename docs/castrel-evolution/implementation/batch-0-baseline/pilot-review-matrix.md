# P0-10 阶段 5 Pilot Review Matrix

> 本文件是 P0-10 的评审事实台账，不是第二份 Catalog。场景、目标
> service/operation、时长、参数和 recovery strategy 始终以
> `traffic-control-plane/src/lib/fault-run-catalog.ts` 为准。
>
> 评审窗口：2026-09-16  
> 历史 Catalog revision：
> `000ccc36e4a77ef27d22636bdbc4643ff79ddb0c205b21830967bc40b7abd7dc`

> **后续修订（2026-09-17）：** P0-13 已补齐控制面
> `/internal/alertmanager/webhook`、`CASTREL_INTERNAL_SERVICE_KEY` 机器认证、
> `alert_receipts` 持久化、CART Scenario Worker dispatch 和 Kubernetes
> retention 配置挂载。本矩阵仍保留原评审窗口的运行事实；没有真实
> firing/resolved 投递、场景运行或 Kubernetes runtime，因此这些代码/配置变更
> 不升级任何 `UNKNOWN`/`UNVERIFIED` 为运行证据。

> **P0-14 当前运行 revision（2026-09-17）：**
> `a9f117905993ed8898c0276c5c40267c4a434fc89b6254be8cb1725a7f15702b`
> （Redis `memberSizeBytes` 最小值修订后）。本文件下方新增的 P0-14 评审
> 记录不覆盖 2026-09-16 的历史快照。

## 评审边界

- 本次矩阵由 `catalog-coverage-matrix.md`、英文 runbook 的 `Alert mapping`
  和 P0-09 的观测核验记录派生；候选告警是声明/候选规则，不是已 firing
  的告警。
- 本次没有执行新的 Fault Run、真实 baseline capture、Data Warmup 写入或
  场景 remediation。所有 `actual firing`、请求统计、效果、恢复和告警
  receipt 均为 `UNKNOWN`/`UNVERIFIED`，不以 `0` 或“未触发”代替。
- Compose 观测组件的短窗口查询可用，但 Tempo effective retention 同时暴露
  `168h` root compactor 和 `336h` backend scheduler 字段，适用语义尚未拆解。
  Kubernetes runtime 未核验，Kubernetes Loki 没有可确认的 retention
  ConfigMap 挂载。
- Alertmanager 的 active config 有三个 `send_resolved=true` receiver；控制面
  route 和机器认证已在 P0-13 的代码/配置中具备，但没有真实投递，因此没有可
  证明的告警 receipt。
- `BASELINE_CAPTURE_ENABLED=false`，本次没有调用新增 Operator 写接口。只读
  MySQL 核验显示 `baseline_pilot_reviews` 为空，`scenario_baselines` 为空；
  本矩阵的“不具备选择资格”不是持久化的 Operator review。
- “不具备选择资格（本轮相当于 REJECTED）”只表示当前证据窗口不能进入
  `SELECTED`，不表示场景永久排除。后续必须以同一 Catalog revision 的真实
  baseline、告警 receipt、证据窗口和 remediation 验证重新评审。

## P0-14 远端 Compose 实际评审（2026-09-17）

本次远端 Compose 已完成 12 个 Catalog 条目的真实 Fault Run，另对 Redis 合同
修订后的条目追加一次重跑；本轮运行集合共 13 个。数据库中 `scenario_baselines`
共 15 条 `COMPLETE_WITH_LIMITATIONS`、4 条 `INCOMPLETE`；本轮选定运行集合
包含 12 个条目基线和 1 个修订后 Redis 基线。所有已核对基线记录
`releaseRevision=1.4.0`、`deploymentMode=compose` 和 Data Warmup 元数据。
`baseline_pilot_reviews` 已通过 Operator API 持久化 12 条当前 revision 的
`REJECTED` review，`SELECTED=0`。

Alertmanager route 的机器认证、firing/resolved 和重复投递已通过真实控制面
入口验证，receipt 表当前为 3 条 firing、3 条 resolved；这证明接收端点和幂等，
不等同于每个场景都产生了 Alertmanager firing。由于真实 Prometheus/Loki/Tempo
adapter 尚未实现，场景 query window 仍为 `UNKNOWN`，因此没有候选满足
`SELECTED` eligibility。Kubernetes 只有 kustomize/声明核验，没有 runtime。

| Scenario | P0-14 Run ID | Runtime result | Review decision | 主要阻塞 |
| --- | --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | `a1f064ac-cd31-4a35-b198-09c4d412337b` | `RECOVERED`；约 60 秒，1/0/1 | `REJECTED` | 慢 SQL 运行限制、无真实 observation window |
| `ORDER_REPORT_SQL` | `14450128-9a3c-467e-ac6a-05aadf69774f` | `RECOVERED`；约 60 秒，1/0/1 | `REJECTED` | 慢 SQL 运行限制、无真实 observation window |
| `BROWSE_SURGE` | `7fffdf75-b6a3-4983-8ab7-ebf61b07fdd9` | `RECOVERED`；110/110，drained | `REJECTED` | 无真实 observation window、资源边界未核验 |
| `ORDER_QUERY_SURGE` | `0fcb640c-5655-4373-9bc6-ff694bf3f9c1` | `RECOVERED`；80/80，drained | `REJECTED` | 无真实 observation window、资源边界未核验 |
| `CATALOG_REDIS_LARGE_VALUE` | `6b8e8d21-f9e8-4f9a-98df-9986f1922d68`、`d4bfa872-c48b-44c1-b425-1df59df5765f` | 均 `RECOVERED`；1024B，含 cleanup/drain | `REJECTED` | 逻辑字节不等于物理容量、无真实 observation window |
| `CART_CATALOG_DEPENDENCY` | `0ac60702-0c11-4c62-849b-861f3af733bf` | `RECOVERED`；91/0/91，drained | `REJECTED` | 业务 failure code 仍需复核、无真实 observation window |
| `NOTIFICATION_HEAP_PRESSURE` | `4bb51b52-3879-473b-b09d-e1fe7dd1bc06` | `RECOVERED`；3 Runner summary，`NON_RELEASING` | `REJECTED` | 非释放资源与资源容量未核验、无真实 observation window |
| `NOTIFICATION_STORAGE_APPEND` | `09a819ba-d1df-4bec-a9f7-018e786bcd0d` | `RECOVERED`；Runner summary，cleanup 200 | `REJECTED` | 物理文件/数据处理边界未进入 pilot、无真实 observation window |
| `PROMOTION_LOCK_CONTENTION` | `19c75f1c-4c83-43e0-9b8a-a92527046ee4` | `RECOVERED`；160/0，drained | `REJECTED` | 共享锁/资源边界未核验、无真实 observation window |
| `INVENTORY_TABLE_EXCLUSIVE` | `5c4b5858-2ea1-4dd9-a8a2-4233c129dfd5` | `RECOVERED`；约 10.9 秒，drained | `REJECTED` | 表锁共享影响未核验、无真实 observation window |
| `INVENTORY_ROW_LOCK` | `c647bf0b-8995-493a-a9e1-b7327c9f3735` | `RECOVERED`；4/2/2，drained | `REJECTED` | 行锁共享影响未核验、无真实 observation window |
| `PSP_PROVIDER_OUTCOME` | `5707b05d-774e-43ba-9fd0-3a112cf46aae` | `RECOVERED`；Runner summary，target failure | `REJECTED` | PSP/订单业务恢复与 observation window 未核验 |

**当前结论：** `SELECTED=0` 是证据门槛的正确结果，不是运行失败。下一次
评审必须继续使用 Catalog 当前 revision，并补齐真实 observation adapter、
Kubernetes runtime/retention、场景级查询窗口和资源/remediation 证据；不得因
已有 baseline 或 Alertmanager route receipt 自动升级为 `SELECTED`。

## 共同证据状态

| 项目 | 当前事实 | 评审含义 |
| --- | --- | --- |
| Actual firing | `UNKNOWN / NOT_EXECUTED`；没有新的场景运行窗口 | 不得写成告警未触发、已触发或已恢复 |
| Alert receipt | `UNVERIFIED`；route/认证代码与静态配置已具备，但未执行真实投递 | 不满足阶段 5 告警接收前置条件 |
| Scenario query window | `UNAVAILABLE`；只核验过观测组件短窗口 API，不是场景证据 | 不得把组件 readiness 当作场景 baseline |
| Compose retention | Prometheus `1w`、Loki limits `1w`；Tempo root `168h`，另有 `336h` scheduler 字段 | 可用但有 limitation，不能证明所有证据窗口语义一致 |
| Kubernetes retention/runtime | `UNKNOWN`；Prometheus/Tempo 为声明，Loki retention 挂载未核验 | 不能从 Compose 借用 Kubernetes 事实 |
| Persistence | `scenario_baselines=0`、`baseline_pilot_reviews=0` | 本轮不产生持久化 `CANDIDATE`、`REJECTED` 或 `SELECTED` |

## 逐项评审矩阵

| Scenario | Catalog 派生 target service / operation | Runbook 候选告警规则 | Actual firing / query window | Shared resource risk | 当前评审结论与排除理由 |
| --- | --- | --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | `catalog-service` / `products-browse-report` | `HighLatencyP99`、`CriticalLatencyP99`、`MySQLSlowQueries`、`HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLHighThreads`、`NodeHighCPU`；无 product-report 专用告警 | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | 历史查询可能消耗 Catalog 的 Hikari/MySQL 和共享节点 CPU；阈值告警为条件性结果 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：无真实 baseline、firing、receipt 和完整 retention 证据；P0-ISSUE-009 |
| `ORDER_REPORT_SQL` | `order-service` / `orders-query-report` | `HighLatencyP99`、`CriticalLatencyP99`、`MySQLSlowQueries`、`HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLHighThreads`、`NodeHighCPU`；无 order-report 专用告警 | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | N+1/历史订单读取可能消耗 Order 的连接池、MySQL 和共享节点 CPU；本地 Order JVM 资源限制不能作为性能基线 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：无真实 baseline、firing、receipt 和完整 retention 证据；P0-ISSUE-007、009 |
| `BROWSE_SURGE` | `catalog-service` / `browse-api-worker` | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate`、`TrafficSurge`、`HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLHighThreads`、`MySQLSlowQueries`、`NodeHighCPU`、`NodeHighMemory`、`RedisHighMemory` | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | 受控浏览流量可能扩展到 Gateway/Catalog、Hikari、MySQL、Redis 和节点资源；`TrafficSurge` 不证明每个请求到达业务服务 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：无真实 firing/receipt，且 Catalog 矩阵缺少实际 surge drain 事实；P0-ISSUE-009、011 |
| `ORDER_QUERY_SURGE` | `order-service` / `order-query-worker` | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate`、`TrafficSurge`、`HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLHighThreads`、`MySQLSlowQueries`、`NodeHighCPU`、`NodeHighMemory`、`OrderFailureRateHigh` | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | 查询流量可能扩展到 Order 的连接池、MySQL 和节点资源，并间接影响下单路径；`OrderFailureRateHigh` 不是直接结果 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：无真实 firing/receipt，且 Catalog 矩阵缺少实际 surge drain 事实；P0-ISSUE-007、009、011 |
| `CART_CATALOG_DEPENDENCY` | `catalog-service` / `cart-product-validation` | `HighErrorRate`、`HighLatencyP99`、`CriticalLatencyP99`；无 Cart-to-Catalog 专用告警 | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | Catalog 依赖错误/延迟可能通过 Cart 业务 envelope 表现，外层 HTTP 200 不能证明依赖成功 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：P0-13 已补齐控制面 dispatch 和生命周期事件，但没有真实请求/终态汇总事实；P0-ISSUE-001、009 |
| `CATALOG_REDIS_LARGE_VALUE` | `catalog-service` / `product-detail-cache` | `RedisHighMemory`、`HighLatencyP99`、`CriticalLatencyP99`、`HighHeapUsage`、`CriticalHeapUsage`、`FrequentGCPause`、`HighErrorRate`；无 Redis large-key 专用告警 | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | run-scoped Redis Hash 可能增加共享 Redis 使用量，反序列化可能增加 Catalog heap/GC；逻辑字节预算不等于物理 Redis 利用率 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：未核验效果、告警、资源边界或允许的数据处理证据；P0-ISSUE-009 |
| `NOTIFICATION_HEAP_PRESSURE` | `notification-service` / `notification-retention` | `HighHeapUsage`、`CriticalHeapUsage`、`FrequentGCPause`、`HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate`、`NodeHighMemory`、`ServiceDown` | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | 保留对象可能造成 JVM heap/GC、节点内存和服务可用性压力；`NON_RELEASING` 不能承诺资源自行回收 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：未核验真实告警 receipt、业务恢复和非释放资源边界；P0-ISSUE-009 |
| `NOTIFICATION_STORAGE_APPEND` | `notification-service` / `notification-storage` | `NodeDataFilesystemGrowthRateHigh`、`NodeDataFilesystemUsageHigh`、`HighErrorRate`；无保证的专用告警 | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | 物理 `/data` 文件增长可能影响节点磁盘和 append endpoint；告警取决于挂载卷、增长速率和阈值 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：未执行物理文件证据或获批的数据处理验证，且需要明确人工边界；P0-ISSUE-009 |
| `PROMOTION_LOCK_CONTENTION` | `promotion-service` / `coupon-reservation-consistency` | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate`、`HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLSlowQueries`、`MySQLHighThreads`；无 deadlock/lock-wait 专用告警 | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | 锁等待/死锁可能扩展到 Promotion 连接池和 MySQL；仅有请求失败、Tempo JDBC 和数据库诊断可关联原因 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：未核验锁等待效果、告警 firing、恢复和 receipt；P0-ISSUE-009 |
| `INVENTORY_TABLE_EXCLUSIVE` | `inventory-service` / `inventory-availability-report` | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate`、`HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLSlowQueries`、`MySQLHighThreads`、`InventoryReserveFailRateHigh` | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | 整表写锁可能阻塞需要 `inventories` 的其他读写并占用连接池/数据库线程；`InventoryReserveFailRateHigh` 不是该观察端点的直接结果 | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：未核验锁效果、业务恢复、告警 firing 或 receipt；P0-ISSUE-009 |
| `INVENTORY_ROW_LOCK` | `inventory-service` / `inventory-reservation-summary` | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate`、`HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLSlowQueries`、`MySQLHighThreads`；无 row-lock-wait 专用告警 | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | 固定行锁可能造成并发等待、连接池压力和 MySQL 线程增长；需要 Tempo/JDBC 和行锁诊断补充 Prometheus | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：未核验锁等待、恢复、告警 firing 或 receipt；P0-ISSUE-009 |
| `PSP_PROVIDER_OUTCOME` | `psp-simulator` / `provider-outcome` | `PaymentFailureRateHigh`、`PaymentTimeoutSpike`、`HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate`、`CorrelatedServiceDegradation`、`OrderFailureRateHigh` | `UNKNOWN / NOT_EXECUTED`；没有场景查询窗口 | PSP outcome 可能通过 payment client、PSP simulator 和 order creation 路径表现为延迟/失败；`AUTHORIZED` 不应被推断为 failure alert | **不具备选择资格（本轮相当于 REJECTED，未持久化）**：未核验 outcome、真实 firing、receipt 和业务恢复；P0-ISSUE-009 |

## Remediation boundary

下表只描述未来具备事实后可由正常业务/基础设施运维执行和验证的边界。本次没有执行这些动作，也不把它们写成已有恢复结果。

| Scenario | 允许记录的 remediation、验证和数据处理边界 |
| --- | --- |
| `BROWSE_REPORT_SQL` | 在正常运维流程中恢复报告请求和数据库容量/连接池到稳定状态；用产品报告延迟、JDBC 观测和共享资源指标复核恢复，不承诺固定延迟或告警自动消失 |
| `ORDER_REPORT_SQL` | 恢复订单报告依赖的数据库与连接池容量并复核正常订单查询；使用 Order 业务请求、JDBC 观测和资源指标验证，不把本地 JVM 临时配置当作修复 |
| `BROWSE_SURGE` | 由业务/基础设施运维调整正常浏览流量容量或资源配额；复核请求率、延迟、错误率和 downstream 资源回到稳定范围，不把 `TrafficSurge` 当作 drain 证明 |
| `ORDER_QUERY_SURGE` | 由业务/基础设施运维恢复订单查询容量并验证订单主路径；复核请求率、延迟、错误率、连接池和 MySQL 指标，不承诺共享资源影响必然出现 |
| `CART_CATALOG_DEPENDENCY` | 修复并验证 Cart 与 Catalog 的正常依赖调用、超时和错误 envelope；使用客户端/服务端 trace、业务日志和正常购物车路径复核，不能用尚未执行的运行路径补齐事实 |
| `CATALOG_REDIS_LARGE_VALUE` | 按已批准的数据处理边界处理 run-scoped cache 数据并复核 Redis 内存、Catalog heap/GC 和 product detail 路径；不把逻辑字节预算当作物理资源恢复证明 |
| `NOTIFICATION_HEAP_PRESSURE` | 通过正常服务运维流程恢复 notification JVM/节点容量并复核 heap、GC、健康和通知请求；该场景不承诺 retained object 自动释放 |
| `NOTIFICATION_STORAGE_APPEND` | 仅在获批的数据处理窗口内处理 run-scoped 文件，核对物理文件系统、无关文件和 notification 请求；不得把文件达到目标大小或人工确认替代实际磁盘证据 |
| `PROMOTION_LOCK_CONTENTION` | 恢复 Promotion 正常锁/事务处理能力，复核 reservation consistency、锁等待、JDBC 观测和错误率；不得把没有专用告警解释为没有锁影响 |
| `INVENTORY_TABLE_EXCLUSIVE` | 恢复库存报告和正常库存读写，复核表级阻塞、连接池、MySQL 诊断和业务请求；必须明确整表影响边界，不承诺固定等待时长 |
| `INVENTORY_ROW_LOCK` | 恢复库存 reservation summary 与相关正常交易，复核行锁等待、连接池、JDBC 观测和错误率；必须以真实成功业务请求证明恢复 |
| `PSP_PROVIDER_OUTCOME` | 将支付提供方结果恢复到经批准的正常业务配置，复核 payment、PSP 和 order creation 的成功路径及相关指标；不得由 `AUTHORIZED`/`DECLINED`/`TIMEOUT` 名称推断告警已发生 |

## P0-10 结论与解除条件

- 本轮 `SELECTED = 0`，且没有持久化 pilot review。这个结果由缺少真实 baseline、
  告警 receipt、场景 firing、完整 retention 语义和 Kubernetes runtime 证据共同
  导致，不是对 12 个场景永久否决。
- P0-ISSUE-001 代码路径已补齐但运行仍待核验；P0-ISSUE-002 代码/静态边界已具备但 receipt 仍待核验；P0-ISSUE-003、009、
  011 继续待后续环境/运行核验。此次矩阵没有发现需要新增的独立问题，因此不创建
  P0-ISSUE-016。
- 允许后续写入 `CANDIDATE` 或 `REJECTED` 前，必须使用当前 Catalog revision、
  Operator session/CSRF、审计和 review API；允许 `SELECTED` 前还必须同时拥有
  完整 baseline、真实告警 receipt、可复查 Prometheus/Loki/Tempo 窗口、已解释的
  retention、业务恢复和资源处理边界。
