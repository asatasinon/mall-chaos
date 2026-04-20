# Chaos 场景触发原因手册

本文档用于解释 Task 19 七个验收场景的触发原因、预期表现与分析判定口径，避免只知道“怎么触发”，却不知道“为什么会这样”。

配套文档：
- [Chaos 演练验收](../tasks/task-19-chaos-verification.md)
- [Chaos: 慢 SQL 公共模块](../tasks/task-14-chaos-slow-sql.md)
- [Chaos: JVM 内存泄漏](../tasks/task-15-chaos-memory-leak.md)
- [Chaos: 数据库死锁](../tasks/task-16-chaos-deadlock.md)
- [Chaos: 网络故障注入](../tasks/task-17-chaos-network.md)
- [架构总览](../plans/chaos-v1.md)

## 使用方法

在执行每个场景前，先确认三件事：

1. 这次是通过什么动作触发的。
2. 触发后应该优先看到哪些指标、日志和 trace 变化。
3. 如果观测结果与触发链路不一致，应优先怀疑环境、脚本、路由或配置问题，而不是直接认定分析结论成立。

## 全局判定原则

- 先确认注入动作真实生效，再解读现象。没有成功注入，后续分析没有意义。
- 先看最接近触发点的信号，再看下游放大效应。比如先看 ToxiProxy、堆占用、死锁日志，再看成功率与 P95。
- 单个场景应有单一主因。若出现与主因无关的大面积异常，优先排查是否叠加了其他故障或存在环境噪声。
- 分析结论至少要同时被两类信号支撑，例如 metrics + logs，或 trace + 日志。

## 场景 1：基线稳定性

### 触发原因

该场景不注入任何 Chaos。它的作用是建立系统在默认流量下的基线行为，作为后续所有异常分析的对照组。

### 触发动作

- 保持 Runner 运行。
- 不调用任何 `/internal/chaos/*` 接口。
- 不注入 ToxiProxy toxic、Pumba 或 Chaos Mesh。

### 正确分析应看到的现象

- 成功率稳定高于验收阈值。
- P95 延迟稳定，没有持续抬升。
- `chaos_event_log` 没有注入记录。
- Grafana、Loki、Tempo 中不存在明显的故障型尖刺。

### 容易误判的点

- 如果基线场景已经出现超时、错误率上升、Heap 异常增长，这不属于 Chaos 结果，而是系统本身存在不稳定因素。
- 如果 `chaos_event_log` 有数据，说明环境没有清干净，后续场景分析会被污染。

## 场景 2：order 到 payment 网络延迟

### 触发原因

该场景通过 ToxiProxy 在 `order -> payment` 调用链路上增加网络延迟。主因不是 payment 业务慢，也不是数据库慢，而是网络层转发被人为变慢。

### 触发动作

- 执行 `scripts/chaos/network-delay.sh order-to-payment 3000 1000 300`。
- 其本质是在 `order-to-payment` proxy 上增加 latency toxic。

### 触发机理

- order-service 对 payment-service 的调用本来通过 ToxiProxy 转发。
- latency toxic 生效后，请求和响应在网络层被额外延迟 2 到 5 秒。
- 上游 order-service 因等待 payment 返回而出现超时、重试、熔断或失败回写。

### 正确分析应看到的现象

- `payment.charge.timeout.count` 上升。
- Tempo 中 payment span 耗时明显变长。
- order 超时订单应落为 FAILED，而不是长期卡在 PENDING。
- 移除 toxic 后，成功率和耗时逐步恢复。

### 容易误判的点

- 如果 payment span 本身不慢，但 order 仍超时，优先检查 gateway 或 order 自身线程池，而不是直接归因给 payment。
- 如果移除 toxic 后现象不恢复，应怀疑 toxic 未删除、代理链路未走 ToxiProxy，或已触发上游熔断后的恢复延迟。

## 场景 3：order-service JVM 内存泄漏

### 触发原因

该场景通过持续分配 `byte[]` 并保留强引用来抬高 JVM 堆占用。主因是堆内对象被长期持有，导致 GC 压力上升和延迟抖动。

### 触发动作

- 调用 `POST /internal/chaos/memory-leak/start`。
- 典型参数：`chunkSizeKb=1024`、`intervalMs=300`、`maxMb=350`。

### 触发机理

- 后台任务按固定间隔分配内存块。
- 分配出的 `byte[]` 被放入长期存活的列表，GC 无法回收。
- 随着持有对象增加，heap usage 上升，GC 变频繁，暂停时间增加。
- `stop` 只停止继续分配，不会释放已持有对象。
- `clear` 才会清空强引用，使后续 GC 有机会回收内存。

### 正确分析应看到的现象

- JVM Heap 持续升高，接近 `maxMb` 后增长趋缓。
- `chaos.memory_leak.holding_mb` 与 Heap 走势方向一致。
- GC 相关指标增加，order-service 延迟抬升。
- `clear` 后，Heap 不会立刻归零，但应在后续 GC 周期明显回落。

### 容易误判的点

- `stop` 后堆没有下降是正常现象，因为对象还被持有。
- `clear` 后堆不立刻下降也是正常现象，因为 `System.gc()` 只是建议，不保证立即执行。
- 如果 `holding_mb` 没涨但 Heap 在涨，应怀疑是其他对象分配、流量放大或内存配置问题，而不是该场景本身。

## 场景 4：payment 慢 SQL

### 触发原因

该场景通过 slow SQL chaos 让 payment 的数据库访问变慢。主因是数据库侧等待时间被人为拉长，不是网络延迟，也不是 JVM 堆问题。

### 触发动作

- sleep 模式：调用 `POST /internal/chaos/slow-sql/enable`，设置 `mode=sleep`。
- real 模式：调用相同接口，设置 `mode=real`。

### 触发机理

- sleep 模式：在应用侧直接 `Thread.sleep(delayMs)`，请求线程被挂起。
- real 模式：在事务里执行 `SELECT SLEEP(N)`，数据库连接被真实占用，慢查询日志可见。
- 注入概率由 `injectRate` 控制，到期时间由 `durationSec` 控制。

### 正确分析应看到的现象

- sleep 模式下，payment 接口耗时上升明显。
- real 模式下，MySQL 慢查询日志应出现 `SELECT SLEEP(...)`。
- Payment P95 抬升，duration 到期后自动回落。
- `chaos_event_log` 中存在 slow-sql 事件。

### 容易误判的点

- sleep 模式不会在 MySQL 慢查询日志里留下 `SELECT SLEEP`，这是模式差异，不代表注入失败。
- real 模式如果接口变慢但慢日志没有记录，应先检查是否真的走到了数据库路径。
- 如果全链路都慢但 payment 指标不明显，可能是上游网络或 gateway 先出问题。

## 场景 5：order 和 payment 死锁注入

### 触发原因

该场景通过两个并发事务以相反顺序锁定相同行，主动制造 MySQL 死锁。主因是数据库锁顺序冲突，不是单纯 SQL 慢。

### 触发动作

- order-service 调用 `POST /internal/chaos/deadlock/enable`。
- payment-service 调用 `POST /internal/chaos/deadlock/enable`。

### 触发机理

- 事务 A 先锁记录 1 再锁记录 2。
- 事务 B 先锁记录 2 再锁记录 1。
- InnoDB 检测到循环等待后，主动回滚代价较小的一方。
- 应用收到死锁异常后进入退避重试或失败补偿。

### 正确分析应看到的现象

- `chaos.deadlock.count` 上升。
- MySQL error log 出现 `Deadlock found when trying to get lock`。
- `chaos.deadlock.retry.count` 上升，说明重试路径真的被触发。
- 超过重试上限的请求应快速失败，而不是长时间卡住。

### 容易误判的点

- 只有错误率升高但没有 deadlock log，不能直接认定是死锁场景命中。
- 若完全没有重试计数增长，说明应用层恢复链路可能未接住该异常。
- 死锁会导致失败和重试，但不应把系统整体成功率打到 0；如果全部不可用，应怀疑连接池耗尽、事务未释放或其他叠加问题。

## 场景 6：库存定时重置演练

### 触发原因

该场景不是故障注入，而是验证库存重置机制本身的正确性。主因是 Runner 主动触发 `plan -> reset` 链路，并校验版本与分布式锁保护是否生效。

### 触发动作

- 调用 `POST /internal/runner/inventory-reset/trigger`。
- 调用 `PUT /internal/runner/inventory-reset/schedule` 调整定时策略。
- 人为制造 `baseline_version` 冲突以验证 409。

### 触发机理

- `reset/plan` 先做差异预览，不写库。
- `reset` 需要携带 `expectedVersion`，版本一致才执行。
- 执行期间持有 Redis 分布式锁，避免并发 reset 互相覆盖。
- 调度更新后，Runner 内存中的计划应立即刷新。

### 正确分析应看到的现象

- `plan` 返回当前库存与基线的差值。
- `reset` 后库存恢复基线，后续下单恢复正常。
- 版本冲突时返回 409，且不执行写入。
- 并发触发时只能有一个 reset 成功。

### 容易误判的点

- 库存恢复失败不一定是 reset 逻辑错，也可能是基线快照本身错误。
- 返回 409 是保护机制生效，不是故障。
- 调度修改后未立即生效，应优先检查 Runner 是否刷新内存调度，而不是直接怀疑 inventory-service。

## 场景 7：组合故障

### 触发原因

该场景同时叠加网络延迟、慢 SQL 与死锁，目的是验证系统在多重压力下仍具备部分可用性与可恢复性。主因不是单一故障，而是多个故障在同一时间窗内共同放大。

### 触发动作

同时执行以下三项注入：

1. ToxiProxy 为 `order -> payment` 增加延迟。
2. order-service 开启 slow SQL。
3. order-service 开启 deadlock。

### 触发机理

- 网络延迟拉长远程调用耗时。
- 慢 SQL 拉长本地数据库交互耗时。
- 死锁制造局部事务失败与重试。
- 三者叠加后，线程、连接、事务与超时预算被同时消耗，因此成功率下降比单场景更明显。

### 正确分析应看到的现象

- 多类指标同时异常，而不是只出现单一信号。
- 全链路 trace、日志和 metrics 都能对应到同一时间窗。
- 系统成功率下降，但不应完全归零。
- 按顺序移除故障后，指标逐步回到正常范围。

### 容易误判的点

- 如果只看到一种故障信号，说明可能并没有成功叠加全部注入。
- 如果恢复后仍长期不回稳，应怀疑残留 toxic、未关闭的 chaos 开关、连接池打满后的恢复慢，或其他场景没有清理干净。
- 组合场景分析不能只引用单个指标下结论，至少要交叉核对网络、数据库和应用三个层面。

## 快速判定模板

执行或复盘任意场景时，建议按以下模板记录：

1. 注入动作：具体接口、脚本、参数。
2. 直接主因：网络、堆内存、数据库等待、数据库锁冲突、调度与版本控制中的哪一种。
3. 第一现场信号：最先变化的 metrics、logs、trace。
4. 业务后果：成功率、P95、状态机结果、补偿行为。
5. 恢复证据：disable、clear、remove toxic 或调度修复后，哪些指标回到了正常范围。
6. 结论：现象是否与该场景的预期机理一致；如果不一致，缺口在哪。

---

## 观测信号对照表

速查每个场景应在哪里看到最直接的信号。按"离注入点最近的信号优先"排列，越靠上越能直接确认注入是否生效。

### Metrics（Prometheus / Grafana）

| 指标名 | 类型 | 触发场景 | 含义 |
|---|---|---|---|
| `chaos.memory_leak.holding_mb` | Gauge | 场景 3 | 当前被强引用持有的泄漏内存（MB）；注入后持续上升，`clear` 后归零 |
| `chaos.memory_leak.object_count` | Gauge | 场景 3 | 泄漏对象数量；与 holding_mb 同步变化，上升趋势应与 intervalMs 吻合 |
| `jvm.memory.used{area="heap"}` | Gauge | 场景 3 | JVM 堆实际占用；应与 holding_mb 走势方向一致，但比 holding_mb 稍高（含正常对象） |
| `jvm.gc.pause.total` | Counter | 场景 3 | GC 暂停时间累计；heap 高位时应显著增加 |
| `chaos.slow_sql.active` | Gauge | 场景 4、7 | 慢 SQL 开关状态；1 表示注入中，`durationSec` 到期后自动归 0 |
| `chaos.slow_sql.count` | Counter | 场景 4、7 | 累计慢 SQL 注入次数；每次 maybeDelay() 命中时 +1 |
| `chaos.deadlock.count` | Counter | 场景 5、7 | 死锁发生总次数；按 `service=order` 或 `service=payment` 区分维度 |
| `chaos.deadlock.retry.count` | Counter | 场景 5、7 | 应用层退避重试次数；该值上升说明死锁被捕获并进入重试路径 |
| `payment.charge.timeout.count` | Counter | 场景 2、7 | payment 超时次数；ToxiProxy 网络延迟命中后最先上升的业务指标 |
| `order.create.success.count` | Counter | 全场景 | 下单成功次数；基线值用于计算故障期间成功率下降幅度 |
| `inventory.reserve.fail.count` | Counter | 场景 6 | 库存不足失败次数；库存耗尽阶段应上升，reset 后回落 |

**判断注入是否真正生效的最小集：**

| 场景 | 必须先确认的 metric |
|---|---|
| 场景 2（网络延迟） | `payment.charge.timeout.count` 上升 |
| 场景 3（内存泄漏） | `chaos.memory_leak.holding_mb` 上升 |
| 场景 4（慢 SQL） | `chaos.slow_sql.active = 1` 且 `chaos.slow_sql.count` 在增加 |
| 场景 5（死锁） | `chaos.deadlock.count` 上升，`chaos.deadlock.retry.count` 同步上升 |
| 场景 7（组合） | 上述三类指标同时存在异常 |

---

### Logs（Loki / 结构化 JSON）

所有日志为 JSON 格式，通过 Promtail 采集进 Loki。以下是各场景最关键的日志关键词：

| 场景 | 日志来源 | 关键词 / 字段 | 含义 |
|---|---|---|---|
| 场景 2（网络延迟） | order-service | `"timeout"`, `"payment"` | order 调用 payment 超时，应与 ToxiProxy 注入时间吻合 |
| 场景 3（内存泄漏） | order-service | `chaos.memory_leak`, `"holdingMb"` | 泄漏状态日志，注入开始/停止时记录 |
| 场景 4（慢 SQL）- real 模式 | MySQL error / slow log | `SELECT SLEEP(` | 确认 real 模式 SQL 真正执行到数据库层 |
| 场景 4（慢 SQL）- sleep 模式 | payment-service | `"slow-sql"`, `"injected"` | 应用层注入记录，不会出现在 MySQL 日志 |
| 场景 5（死锁） | MySQL error log | `Deadlock found when trying to get lock` | InnoDB 死锁检测，确认死锁真实发生在 DB 层 |
| 场景 5（死锁） | order-service / payment-service | `"deadlock"`, `"retry"`, `ORDER_DEADLOCK_MAX_RETRY` | 应用层重试链路日志；无该日志说明异常未被捕获 |
| 场景 5（死锁） | `chaos_event_log` 表 | `scenario='deadlock'`, `result='RETRY'` / `'FAILED'` | 记录每次重试和最终失败，含 traceId 供链路关联 |
| 场景 6（库存重置） | inventory-service | `"reset"`, `"version"`, `"409"` | 版本冲突日志；应与手动制造 version 不一致的时机对应 |
| 场景 7（组合） | 全服务 | 同时出现场景 2/4/5 的关键词 | 三类信号应在相同时间窗内出现；缺少任意一类说明该注入未生效 |

**Loki 常用查询模板：**

```logql
# 查看特定时间窗内 order-service 的 chaos 相关日志
{service="order-service"} |= "chaos" | json

# 查看死锁事件（含 traceId）
{service="order-service"} |= "deadlock" | json | line_format "{{.traceId}} {{.message}}"

# 查看慢 SQL 注入记录
{service="payment-service"} |= "slow-sql" | json

# 查看 MySQL slow query log（需 promtail 采集 slow.log）
{job="mysql-slow"} |= "SELECT SLEEP"
```

---

### Traces（Tempo）

Tempo 通过 OTLP 接收全链路 trace，每条 trace 包含完整的 span 树。

| 场景 | 关注的 span | 异常表现 | 判定要点 |
|---|---|---|---|
| 场景 2（网络延迟） | order → payment 的 HTTP 出站 span | 该 span duration 应约等于 ToxiProxy 设定的延迟（2–5s） | 若 span 不慢但 order 超时，说明延迟出现在 span 以外（如 ToxiProxy 未代理该路径） |
| 场景 3（内存泄漏） | order-service 任意业务 span | GC 暂停期间 span 出现"空白区间"（duration 长但内部无子 span） | 对比基线 trace，找到相同接口但耗时异常偏长的 span |
| 场景 4（慢 SQL）- sleep | payment-service DB 相关 span | span duration 约等于 delayMs | 查找 payment-service 的 JDBC 或 transaction span |
| 场景 4（慢 SQL）- real | payment-service DB span | span duration 增加；MySQL 慢日志时间戳与 span 时间吻合 | 可通过 traceId 在 Loki + Tempo 交叉查 |
| 场景 5（死锁） | order/payment DB span | 出现异常结束（error=true）或极短但带 error tag 的 span | 死锁事务被 InnoDB 回滚，span 会快速结束并附带错误信息 |
| 场景 5（死锁重试） | order-service 业务 span | 同一 traceId 下出现多次 DB span | 指数退避重试会在同一 trace 产生多次 DB 调用 |
| 场景 7（组合） | 全链路 span 树 | 同时出现网络延迟、DB 慢、DB 错误三类特征 | 所有异常 span 应对应同一时间窗；若 traceId 断裂说明 traceId 传播有问题 |

**Tempo 查询建议：**

- 按服务+错误过滤：选择 `service=order-service` + `status=error` 找死锁或超时 trace。
- 按耗时过滤：设置 duration > 3s，找到被网络延迟或慢 SQL 拖长的 trace。
- 交叉关联：从 Loki 日志中取 `traceId`，粘贴到 Tempo 搜索框，查看完整链路。

---

### 三类信号对应关系速查

| 场景 | Metrics 先看 | Logs 先看 | Trace 先看 |
|---|---|---|---|
| 1 基线 | 全部稳定，无尖刺 | `chaos_event_log` 无记录 | 无异常 span |
| 2 网络延迟 | `payment.charge.timeout.count` ↑ | order 超时日志 | payment span duration 2–5s |
| 3 内存泄漏 | `chaos.memory_leak.holding_mb` ↑ | chaos memory-leak 状态日志 | 业务 span 出现空白区间 |
| 4 慢 SQL | `chaos.slow_sql.active=1` | MySQL slow log（real）/ payment 注入日志（sleep） | payment DB span 变慢 |
| 5 死锁 | `chaos.deadlock.count` ↑ + `retry.count` ↑ | MySQL `Deadlock found` + `chaos_event_log` | DB span error=true |
| 6 库存重置 | `inventory.reserve.fail.count` 变化 | 409 响应日志 | — |
| 7 组合故障 | 场景 2/4/5 三类 metrics 同时异常 | 三类关键词同时在日志中出现 | 全链路 span 同时有三类特征 |