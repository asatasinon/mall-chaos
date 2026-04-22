# Chaos 场景触发原因手册

| 字段 | 内容 |
|---|---|
| 文档编号 | Q-CHAOS-GUIDE-001 |
| 状态 | 草案 |
| 版本号 | v1.0 |
| 最后更新时间 | 2026-04-22 |
| 审核人 | 待定 |
| 生效日期 | 2026-04-22 |
| 负责人 | 项目维护者 |

## 变更记录

| 版本 | 日期 | 变更内容 | 变更人 |
|---|---|---|---|
| v1.0 | 2026-04-22 | 初版，补齐 Task 19 与 README 引用缺失的场景故障手册，覆盖 7 个必测场景的触发主因、预期信号与误判边界。 | GitHub Copilot |

---

## 1. 适用范围

本手册用于 Task 19 的 7 个 Chaos 演练验收场景，目标不是重复操作步骤，而是回答下面 4 个问题：

1. 这类现象到底是谁触发的。
2. 哪些信号出现时，说明根因判断是成立的。
3. 哪些相似现象其实不能直接归因为当前故障。
4. 按什么顺序定位，才能最快把现象和根因对上。

如果需要具体执行步骤，请配合阅读 [Task 19](../tasks/task-19-chaos-verification.md)、[Task 17](../tasks/task-17-chaos-network.md)、[Task 22](../tasks/task-22-chaos-protocol-unification.md)。

## 2. 当前实现基线

本手册以当前仓库实现和现行任务文档为准。

### 2.1 统一协议

- 业务服务内部入口：`/internal/chaos/...`
- gateway 分发入口：`/internal/gateway/chaos/...`
- slow-sql：`enable / disable / status`
- memory-leak：`enable / disable / cleanup / status`
- deadlock：`enable / disable / cleanup / status`
- table-lock：`enable / disable / status`

### 2.2 与旧文档的差异

- memory leak 现行协议是 `enable / disable / cleanup`，不是 `start / stop / clear`。
- gateway 当前只暴露 `/internal/gateway/chaos/...` 分发入口，不存在统一的 `/internal/chaos/...` gateway 入口。
- slow SQL 现行实现以 v2 JOIN enrichment 为主，应观察 JOIN 放大后的慢查询与链路抬升，不再以 `SELECT SLEEP(...)` 作为默认判定依据。
- `chaos_event_log` 在 v2 中可以保留为历史审计表，但不再是故障注入逻辑的权威事实来源。当前判定以状态接口、指标、日志和 trace 为准。

## 3. 通用判定顺序

所有场景先走同一套判定顺序，再进入各场景特有信号。

### 3.1 先确认控制面是否真的触发

- 网络故障：先看 ToxiProxy toxic 是否存在。
- 慢 SQL / 内存泄漏 / 死锁：先看对应 `status` 是否为 `active=true`，以及 `startedAt`、`autoDisableAt` 是否合理。
- 库存重置：先确认 Runner 正在运行，再确认 reset 是否真的执行，而不是只有 plan 预览。

### 3.2 再看 trace 形状

- 网络故障：跨服务 span 时长被整体拉长。
- 慢 SQL：服务内部调用链未变，但数据库相关 span 或接口总耗时升高。
- 内存泄漏：trace 不一定出现单个固定热点，更多表现为 GC 抖动和整体尾延迟上升。
- 死锁：trace 中可见重试、回滚、最终失败或恢复成功。

### 3.3 再看指标和日志是否闭环

- 指标决定影响面。
- 日志决定错误类型。
- trace 决定时序关系。

三者不能闭环时，不要急着下根因结论。

### 3.4 最容易误判的 4 类情况

- 刚启动后的冷启动抖动，被误判为基线不稳定。
- 压测流量上升带来的自然延迟，被误判为网络故障或慢 SQL。
- 堆上涨但 `holding_mb` 不涨，被误判为内存泄漏。
- 事务重试成功导致最终成功率没明显下跌，被误判为没有死锁。

## 4. 场景总览

| 场景 | 主要故障面 | 主症状 | 最强判别信号 |
|---|---|---|---|
| 1. 基线稳定性 | 无注入 | 成功率和延迟稳定 | 所有 chaos 状态均未激活 |
| 2. order→payment 网络延迟 | 网络层 | payment 调用耗时 2-5s | ToxiProxy latency toxic 存在，payment span 被整体拉长 |
| 3. order JVM 内存泄漏 | JVM 堆 | Heap、GC、P95 持续抬升 | `chaos.memory_leak.holding_mb` 随时间上升 |
| 4. payment 慢 SQL | 数据访问层 | payment P95 抬升、慢日志增多 | JOIN enrichment 激活且慢查询日志出现 JOIN 放大查询 |
| 5. order + payment 死锁 | 数据库事务 | 重试、回滚、部分失败 | MySQL deadlock 日志加 `chaos.deadlock.retry.count` 上升 |
| 6. 库存定时重置 | 控制面 + 一致性 | reset 执行、版本冲突、并发锁保护 | 409 冲突与分布式锁行为符合预期 |
| 7. 组合故障 | 多故障叠加 | 成功率下降但不归零 | 网络、慢 SQL、死锁三组信号同时出现 |

## 5. 场景 1：基线稳定性

### 5.1 触发主因

没有任何 Chaos 注入，系统只承受 Runner 的正常业务流量。

### 5.2 预期信号

- Runner `running=true`
- 所有 chaos 状态接口返回 `active=false`
- Grafana 成功率长期稳定在 95% 以上
- P95 延迟稳定在 500ms 以下
- Tempo 中链路分布稳定，没有单个服务持续性拉长

### 5.3 误判边界

- 服务刚重启后的 1 到 3 分钟预热波动，不应直接视为基线失败。
- 短暂 GC 或单次数据库抖动，不应替代 30 分钟整体趋势判断。
- 历史慢查询日志或历史错误日志，不等于当前基线有问题。

### 5.4 建议定位顺序

1. 确认 Runner 是否持续运行。
2. 抽查各类 chaos `status` 是否未激活。
3. 看 Grafana 成功率和 P95 是否只是短尖峰还是持续恶化。
4. 如果持续恶化，再顺着 Tempo 和 Loki 找热点服务。

### 5.5 恢复完成判定

此场景没有恢复动作，目标是确认系统本身已经在稳定基线。

## 6. 场景 2：order→payment 网络延迟

### 6.1 触发主因

ToxiProxy 在 `order-to-payment` 代理上挂载 latency toxic，导致 order 调 payment 的网络往返时间被拉长。

### 6.2 预期信号

- ToxiProxy 可见 `chaos-delay` toxic 存在
- `payment.charge.timeout.count` 上升
- Tempo 中 payment 相关 span 耗时接近注入值，通常落在 2 到 5 秒
- order 侧超时订单进入 `FAILED`，而不是长时间卡在 `PENDING`
- 去除 toxic 后 5 分钟内成功率恢复

### 6.3 误判边界

- 如果 payment span 很慢，但 ToxiProxy 没有 active toxic，更可能是 payment 本身慢 SQL 或线程池拥塞。
- 如果只有数据库日志变慢，没有跨服务 span 被整体拉长，不应先归因于网络。
- 如果 success rate 降到 0，更像是链路不可达或服务挂死，不是单纯延迟。

### 6.4 建议定位顺序

1. 先查 toxic 是否还在。
2. 再查 Tempo 中 order→payment span 时长分布。
3. 再看 payment timeout 指标与 order 失败状态是否同步出现。
4. 最后确认移除 toxic 后恢复曲线是否回落。

### 6.5 恢复完成判定

- toxic 已删除
- payment span 耗时恢复到基线
- 5 分钟内成功率恢复到 90% 以上

## 7. 场景 3：order-service JVM 内存泄漏

### 7.1 触发主因

`LocalQueryCacheManager` 按配置持续持有查询结果缓冲区，导致 order-service 堆占用持续增长。

### 7.2 预期信号

- memory leak `status` 为 `active=true`
- `chaos.memory_leak.holding_mb` 持续上升，接近设定上限后停止增长
- JVM Heap 使用率持续抬升并触发告警
- GC 总耗时和暂停时间增加
- order-service P95 延迟在高堆占用期间明显变差
- 执行 `cleanup` 并经历一次 GC 后，Heap 明显回落

### 7.3 误判边界

- 只有堆上涨但 `holding_mb` 不涨，优先怀疑正常缓存增长、请求堆积或对象暂存，不要直接判为泄漏场景生效。
- 调用 `disable` 只会停止继续分配，不会释放已经持有的对象；如果没有执行 `cleanup`，Heap 不回落是正常现象。
- 低流量下即使内存泄漏开启，业务 P95 可能不明显，不能仅凭延迟是否抬升来判断场景是否失败。

### 7.4 建议定位顺序

1. 先查 memory leak 状态接口。
2. 再看 `holding_mb` 和 JVM Heap 是否同向上升。
3. 然后看 GC 指标和 order-service P95。
4. 最后在 `cleanup` 后验证 Heap 是否回落。

### 7.5 恢复完成判定

- `disable` 后不再继续增长
- `cleanup` 后 `holding_mb` 回到低位
- 下一次 GC 后 Heap 回到正常水位

## 8. 场景 4：payment 慢 SQL

### 8.1 触发主因

payment-service 开启 v2 slow SQL 后，查询被 `QueryEnrichmentInterceptor` 切换到 JOIN 大表路径，导致数据库扫描与排序放大。

### 8.2 预期信号

- slow-sql `status` 为 `active=true`
- payment-service P95 明显抬升
- MySQL 慢查询日志出现与 `user_behavior_log` 或其他配置大表关联的 JOIN 查询
- 在压力较高时，`payment.charge.timeout.count` 可能同步上升
- `durationSec` 到期后 `active=false`，P95 自动回落

### 8.3 误判边界

- 现行 v2 方案不要求出现 `SELECT SLEEP(...)`；如果只按 `SLEEP` 关键字验收，会把正常的 v2 慢 SQL 误判为失败。
- 只有 payment 接口慢但慢查询日志没有放大 JOIN，需要进一步排查连接池、线程池或下游依赖。
- 如果 order→payment span 整体被拉长且 payment 内部处理时间不高，更像网络延迟而不是慢 SQL。

### 8.4 建议定位顺序

1. 先查 slow-sql 状态接口是否激活。
2. 再看 payment P95 和 timeout 指标。
3. 再看 MySQL 慢查询日志是否出现 JOIN 放大查询。
4. 最后确认 `durationSec` 到期后是否自动恢复。

### 8.5 恢复完成判定

- `status.active=false`
- payment P95 回到接近基线
- 新增慢查询显著减少

## 9. 场景 5：order + payment 死锁注入

### 9.1 触发主因

order-service 与 payment-service 在注入开启后，以相反锁顺序争抢事务资源，触发 MySQL 死锁检测。

### 9.2 预期信号

- deadlock `status` 为 `active=true`
- `chaos.deadlock.count` 上升
- `chaos.deadlock.retry.count` 上升
- MySQL 错误日志出现 `Deadlock found when trying to get lock`
- 应用日志中能看到重试、退避、最终成功或到达上限失败
- Runner 成功率下降，但不会降到 0

### 9.3 误判边界

- 最终请求成功，不代表没有死锁；只要重试计数明显上升，说明场景已经生效。
- 只有单次事务超时，没有 MySQL deadlock 记录，更可能是锁等待或慢 SQL，不一定是死锁。
- 如果成功率完全归零，应优先怀疑更大范围的数据库不可用或网络故障。

### 9.4 建议定位顺序

1. 先看 deadlock 状态接口。
2. 再查 MySQL deadlock 日志。
3. 再看 `chaos.deadlock.count` 和 `chaos.deadlock.retry.count`。
4. 最后确认超过上限的请求是明确失败，而不是无限等待。

### 9.5 恢复完成判定

- `disable` 或 `cleanup` 后不再新增 deadlock 计数
- MySQL 不再出现新的死锁日志
- 成功率恢复到稳定区间

## 10. 场景 6：库存定时重置演练

### 10.1 触发主因

Runner 触发库存重置流程，经 gateway 先做 plan 预览，再按版本号执行 reset，并通过分布式锁保证并发安全。

### 10.2 预期信号

- `plan` 返回负向差值，说明库存确实已经被消耗
- `trigger` 后库存恢复到基线
- 人工制造版本冲突时返回 409
- 并发触发时只有一个执行成功
- 更新 schedule 后，下次执行时间立即刷新

### 10.3 误判边界

- `plan` 成功不等于 `reset` 已执行，必须看实际库存结果。
- 409 不是异常失败，而是乐观锁保护生效。
- 并发下多个请求都返回成功，才说明分布式锁有问题。

### 10.4 建议定位顺序

1. 先确认 Runner 正在持续消耗库存。
2. 再查 plan 的 diff 是否为负。
3. 再执行 trigger 并核对库存恢复。
4. 最后验证版本冲突和并发锁保护。

### 10.5 恢复完成判定

- 库存恢复到基线
- schedule 已恢复到预期配置
- 没有残留的错误锁定或重复执行

## 11. 场景 7：组合故障

### 11.1 触发主因

同一时间叠加网络延迟、慢 SQL 和死锁，验证系统是否还能维持降级可用，并在解除故障后回到稳定状态。

### 11.2 预期信号

- 网络层存在 toxic
- slow-sql `active=true`
- deadlock `active=true`
- 成功率明显下降，但保持在 20% 以上
- Grafana 同时可见 timeout、P95 抬升、deadlock 重试三组信号
- 移除全部故障后 5 分钟内恢复到 90% 以上成功率

### 11.3 误判边界

- 只看到成功率下降，而看不到三组故障信号同时出现，不能直接判为“组合故障成立”。
- 如果 Runner 崩溃停止发流，场景已经偏离“系统降级但存活”的目标。
- 只移除了部分故障就观察恢复，得出的恢复时间没有意义。

### 11.4 建议定位顺序

1. 先确认三类注入都已激活。
2. 再看成功率是否下降但未归零。
3. 再分别核对网络、慢 SQL、死锁三组特征信号是否同时存在。
4. 最后按 deadlock → slow-sql → network 的顺序移除并观察恢复曲线。

### 11.5 恢复完成判定

- 所有注入状态都回到 `active=false`
- toxic 已移除
- 成功率、P95、超时计数恢复到可接受范围
- Runner 没有中断，恢复后继续出流量

## 12. 演练结论建议写法

每个场景的验收结论建议按同一模板记录，避免只写“成功”或“失败”。

1. 触发方式：写明入口、参数、开始时间。
2. 主观测信号：写 2 到 3 个最关键指标或日志。
3. 排除项：写明为什么不是别的故障。
4. 恢复动作：写明 disable、cleanup 或 toxic remove 的时间点。
5. 恢复结论：写明恢复用时和是否回到阈值内。
