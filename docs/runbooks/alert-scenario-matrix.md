# 场景与告警覆盖矩阵

本文说明当前 12 个场景与 Prometheus 告警规则之间的关系。告警是基于运行结果和资源指标的通用监控，不是场景启动确认信号；启动场景不代表一定会触发告警。

## 结论

- 当前规则可以覆盖大部分场景产生的**结果信号**，但不是每个场景都有专用告警。
- 报表慢 SQL、流量突增、锁竞争和 Redis 大值主要依赖 HTTP 延迟、HTTP 错误、JVM、连接池、MySQL 和 Redis 规则；是否越过阈值取决于数据量、并发、间隔、资源容量和持续时间。
- `NOTIFICATION_STORAGE_APPEND` 的 `totalBytes` 是应用内逻辑预留，不等于物理磁盘写满。只有实际数据库/文件系统指标越过阈值时，基础设施告警才会触发。
- `PROMOTION_LOCK_CONTENTION`、`INVENTORY_TABLE_EXCLUSIVE` 和 `INVENTORY_ROW_LOCK` 当前没有死锁或锁等待专用告警，只能通过慢请求、错误、连接池和 MySQL 通用信号判断。
- Compose 与 Kubernetes 必须使用同一组规则。Kubernetes ConfigMap 已同步 Compose 中的数据盘、InnoDB 写入和关联退化规则；部署后仍需确认 Prometheus 已加载新配置。

## 场景映射

标记含义：**主要**表示最直接的结果信号，**可能**表示只有资源压力或错误达到阈值才会触发，**不保证**表示场景本身不会直接产生该告警。

| 场景 | 主要告警 | 可能伴随的告警 | 覆盖判断与边界 |
| --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` 商品浏览慢 SQL | `HighLatencyP99`、`CriticalLatencyP99`、`MySQLSlowQueries` | `HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLHighThreads`、`HighErrorRate`、`NodeHighCPU` | 部分覆盖。没有商品报表专用告警；慢 SQL 的扫描量和请求 P99 必须达到各自阈值。 |
| `ORDER_REPORT_SQL` 订单查询慢 SQL | `HighLatencyP99`、`CriticalLatencyP99`、`MySQLSlowQueries` | `HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLHighThreads`、`HighErrorRate`、`NodeHighCPU` | 部分覆盖。没有订单报表专用告警；N+1 和历史数据量可能只表现为慢请求，不一定耗尽连接池。 |
| `BROWSE_SURGE` 商品浏览流量突增 | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate` | `HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLHighThreads`、`MySQLSlowQueries`、`NodeHighCPU`、`NodeHighMemory`、`RedisHighMemory` | 条件覆盖。流量生成本身不告警，只有 Gateway/Catalog 或其后端资源越过阈值才告警。 |
| `ORDER_QUERY_SURGE` 订单查询流量突增 | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate` | `HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLHighThreads`、`MySQLSlowQueries`、`NodeHighCPU`、`NodeHighMemory` | 条件覆盖。订单查询突增不直接触发订单创建失败告警；只有共享资源受到连带影响时才会出现业务告警。 |
| `CATALOG_REDIS_LARGE_VALUE` 商品详情 Redis 大值 | `RedisHighMemory`、`HighLatencyP99`、`HighHeapUsage`、`FrequentGCPause` | `CriticalHeapUsage`、`CriticalLatencyP99`、`HighErrorRate`、`NodeHighMemory` | 部分覆盖。当前没有 Redis 延迟、淘汰、单 key 大小或 Catalog cache 专用告警；逻辑字节预算也不等于 Redis 物理内存阈值。 |
| `CART_CATALOG_DEPENDENCY` 加购依赖失败 | `HighErrorRate` | `CriticalLatencyP99`、`HighLatencyP99` | 部分覆盖。若 Cart 加购或 Catalog 校验的 503 被 Prometheus 记录为 5xx，按 URI 的错误率达到 5% 且持续 2 分钟才告警；没有 Cart-to-Catalog 专用告警。 |
| `NOTIFICATION_HEAP_PRESSURE` 通知 JVM 内存压力 | `HighHeapUsage`、`CriticalHeapUsage`、`FrequentGCPause` | `HighErrorRate`、`HighLatencyP99`、`CriticalLatencyP99`、`NodeHighMemory`、`ServiceDown` | 较强覆盖。JVM 进入不可用后可触发 `ServiceDown`，但 OOM、告警时间和最后一条 trace 都不保证。 |
| `NOTIFICATION_STORAGE_APPEND` 通知存储增长 | 无必然专用告警 | `MySQLInnoDBDataWriteRateHigh`、`NodeDataFilesystemGrowthRateHigh`、`NodeDataFilesystemUsageHigh`、`MySQLSlowQueries`、`HighErrorRate` | 弱覆盖。当前场景的主要容量控制是逻辑预留；应用保护错误不会自动计入 `NotificationFailRateHigh`，物理磁盘告警只在真实文件系统增长并越过阈值时触发。 |
| `PROMOTION_LOCK_CONTENTION` 促销锁竞争 | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate` | `HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLSlowQueries`、`MySQLHighThreads` | 部分覆盖。死锁/超时异常经目标服务或 Gateway 观测 URI 以 HTTP 5xx 返回并达到错误率阈值时触发 `HighErrorRate`；仅锁等待不超时则主要表现为慢请求。 |
| `INVENTORY_TABLE_EXCLUSIVE` 库存表锁 | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate` | `HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLSlowQueries`、`MySQLHighThreads` | 部分覆盖。阻塞请求超时或异常经目标服务或 Gateway 观测 URI 以 HTTP 5xx 返回并达到错误率阈值时触发 `HighErrorRate`；`InventoryReserveFailRateHigh` 不会由该观测接口直接产生。 |
| `INVENTORY_ROW_LOCK` 库存行锁 | `HighLatencyP99`、`CriticalLatencyP99`、`HighErrorRate` | `HikariPoolExhaustion`、`HikariPoolFull`、`HikariPoolPending`、`MySQLSlowQueries`、`MySQLHighThreads` | 部分覆盖。行锁等待超时/异常经 Gateway 观测 URI 以 HTTP 5xx 返回并达到错误率阈值时触发 `HighErrorRate`；目标服务的业务 envelope 即使保持 200，也可能被 Gateway 转为 502。 |
| `PSP_PROVIDER_OUTCOME` PSP 外部依赖 | `DECLINED` 时为 `PaymentFailureRateHigh`；`TIMEOUT` 时为 `PaymentTimeoutSpike`、`HighLatencyP99`、`CriticalLatencyP99` | `HighErrorRate`、`OrderFailureRateHigh`、`CorrelatedServiceDegradation` | 条件覆盖。`AUTHORIZED` 预期不触发告警；`effectPercentage` 小于 100% 或请求量不足时，拒付/超时比例可能达不到阈值。 |

上表中的 `CorrelatedServiceDegradation` 存在于 Compose 和 Kubernetes 两套规则中。按当前 PromQL，它在 HTTP 5xx 与库存预留失败同时存在，或支付超时速率大于零时成立；不能作为所有场景的通用确认信号。

## 规则阈值速查

规则每 30 秒评估一次；`for` 时间满足后才进入告警状态。以下名称是 Prometheus 中的 `alert` 值：

| 规则组 | 告警 | 触发条件 |
| --- | --- | --- |
| HTTP | `HighErrorRate` | 同一 `service`、`uri` 的 5xx 比例大于 5%，持续 2 分钟 |
| HTTP | `HighLatencyP99` / `CriticalLatencyP99` | P99 分别大于 5 秒持续 3 分钟 / 大于 10 秒持续 1 分钟 |
| JVM | `HighHeapUsage` / `CriticalHeapUsage` | 堆使用率分别大于 85% 持续 3 分钟 / 大于 95% 持续 1 分钟 |
| JVM | `FrequentGCPause` | Major GC 速率大于 0.1 次/秒，持续 3 分钟 |
| 数据库连接池 | `HikariPoolExhaustion` / `HikariPoolFull` | 活跃连接占最大连接数分别大于 80% 持续 2 分钟 / 大于 95% 持续 1 分钟 |
| 数据库连接池 | `HikariPoolPending` | 等待连接数大于 10，持续 1 分钟 |
| 业务 | `OrderFailureRateHigh` / `PaymentFailureRateHigh` | 对应成功/失败比例大于 10%，持续 2 分钟 |
| 业务 | `PaymentTimeoutSpike` | 支付超时速率大于 0.5 次/秒，持续 2 分钟 |
| 业务 | `InventoryReserveFailRateHigh` | 库存预留失败比例大于 20%，持续 2 分钟 |
| 业务 | `RiskRejectRateHigh` | 风控拒绝比例大于 50%，持续 3 分钟 |
| 业务 | `NotificationFailRateHigh` | 通知失败比例大于 10%，持续 2 分钟 |
| 节点 | `NodeHighCPU` / `NodeHighMemory` | 节点 CPU 大于 80% / 内存大于 85%，均持续 3 分钟 |
| 节点存储 | `NodeDataFilesystemUsageHigh` | `/data` 使用率大于 85%，持续 5 分钟 |
| 节点存储 | `NodeDataFilesystemGrowthRateHigh` | `/data` 可用空间下降速率超过 10 MiB/秒，持续 5 分钟 |
| MySQL | `MySQLHighThreads` / `MySQLSlowQueries` | 连接数大于 100 持续 2 分钟 / 慢查询速率大于 0.5 次/秒持续 2 分钟 |
| MySQL | `MySQLInnoDBDataWriteRateHigh` | InnoDB 写入速率大于 1 MiB/秒，持续 2 分钟；级别为 `info` |
| Redis | `RedisHighMemory` | Redis 使用率大于 80%，持续 3 分钟 |
| 关联判断 | `CorrelatedServiceDegradation` | HTTP 5xx 与库存预留失败或支付超时同时存在，持续 1 分钟；级别为 `info` |

`ServiceDown` 在业务服务 `up == 0` 持续 1 分钟时触发；`InfraExporterDown` 在 Node、MySQL 或 Redis exporter 不可用持续 2 分钟时触发。它们属于平台健康告警，不是某个场景的专属告警。`RiskRejectRateHigh` 也没有当前目录中直接控制风控结果的场景，主要用于正常业务流量中的异常拒绝率。

## 目前仍缺少的专用信号

如果希望做到“启动某个场景就能明确知道它已生效”，还需要增加带场景无关业务语义的专用指标或数据库 exporter 规则，并在控制面运行事件中交叉确认。当前缺口包括：

- 商品/订单报表的扫描行数、查询计划或接口专用慢查询信号。
- Redis 单 key 大小、命中延迟、淘汰和后端错误信号。
- MySQL deadlock、lock wait、lock wait timeout，以及按表/行区分的等待信号。
- Cart-to-Catalog 校验失败和通知存储保护拒绝的业务计数器。
- 通知逻辑预留容量的使用率；现有物理文件系统规则不能替代它。

在排障时应同时查看 Prometheus 告警、对应场景的 `fault_run_events`、Tempo 请求/JDBC/Redis span、服务日志和数据库诊断。告警未触发不等于场景未生效，告警触发也不单独证明一定由该场景造成。
