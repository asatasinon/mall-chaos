# Task 19 — Chaos 演练验收

**阶段**：Phase 4 — 部署与验收  
**依赖**：Task 01–18（全部完成）  
**产出**：7 个必测场景全部通过，验收标准达成

---

## 目标
按照 plan 定义的 7 个必测场景逐一执行并验收，确保系统在故障注入期间可观测、可恢复、Runner 持续运行。

---

## 场景 1：基线稳定性（30 分钟连续流量）

**目标**：无 Chaos 注入时，系统在 30 分钟内保持稳定。

**执行步骤**：
- [ ] 确认 Runner 以默认 QPS 运行（`GET /internal/runner/status` 返回 `running=true`）
- [ ] 等待 30 分钟（或调高 QPS 缩短演练时间）

**验收标准**：
- [ ] Grafana 成功率持续 > 95%
- [ ] P95 延迟 < 500ms
- [ ] 无 `BizException` 以外的未知错误
- [ ] `chaos_event_log` 无记录（未注入）

---

## 场景 2：order→payment 网络延迟（2-5 秒）

**目标**：验证超时重试与熔断触发。

**执行步骤**：
- [ ] 注入：`scripts/chaos/network-delay.sh order-to-payment 3000 1000 300`
- [ ] 观察 5 分钟
- [ ] 移除：`scripts/chaos/network-remove-toxic.sh order-to-payment chaos-delay`
- [ ] 观察恢复 5 分钟

**验收标准**：
- [ ] Grafana `payment.charge.timeout.count` 显著上升
- [ ] Tempo trace 可见 payment span 耗时 3-5s
- [ ] order-service 超时订单状态为 FAILED（不是 PENDING 卡死）
- [ ] 移除 toxic 后 5 分钟内成功率恢复 > 90%
- [ ] Runner 全程未停止（成功率下降但未中断）

---

## 场景 3：order-service JVM 内存泄漏（10-15 分钟）

**目标**：验证堆告警与 clear 后恢复。

**执行步骤**：
- [ ] 注入：`POST /internal/chaos/memory-leak/start`（chunkSizeKb=1024, intervalMs=300, maxMb=350）
- [ ] 观察 Grafana JVM Heap 持续上升，GC 时间增加
- [ ] 10 分钟后调用 `stop`
- [ ] 再调用 `clear`，观察 Heap 回落

**验收标准**：
- [ ] Grafana JVM Heap > 80% 触发 Prometheus 告警
- [ ] GC `gc.pause.total` 明显增加
- [ ] `chaos.memory_leak.holding_mb` gauge 上升到 ~350 MB 后停止
- [ ] `clear` 后下次 GC Heap 回落到正常水位（< 40%）
- [ ] order-service P95 延迟在 heap 高位时上升，clear 后下降

---

## 场景 4：payment 慢 SQL（real + sleep 模式）

**目标**：验证慢查询日志、P95 上升与错误率可观测。

**执行步骤**：
- [ ] 注入 sleep 模式：`POST payment-service /internal/chaos/slow-sql/enable`（mode=sleep, delayMs=3000, injectRate=1.0, durationSec=180）
- [ ] 观察 3 分钟
- [ ] 调用 disable 后，注入 real 模式（mode=real, delayMs=2000, injectRate=0.5, durationSec=180）
- [ ] 观察 3 分钟

**验收标准**：
- [ ] sleep 模式：payment 接口 P50 > 3s，`payment.charge.timeout.count` 上升
- [ ] real 模式：MySQL 慢查询日志中出现 `SELECT SLEEP(2)`
- [ ] Grafana payment P95 曲线可见明显抬升
- [ ] durationSec 到期后自动 disable，P95 自动回落
- [ ] `chaos_event_log` 有 payment/slow-sql 注入记录

---

## 场景 5：order/payment 死锁注入

**目标**：验证死锁错误可观测、重试上限与回滚补偿生效。

**执行步骤**：
- [ ] 注入 order 死锁：`POST order-service /internal/chaos/deadlock/enable`（injectRate=0.4, durationSec=180）
- [ ] 注入 payment 死锁：`POST payment-service /internal/chaos/deadlock/enable`（injectRate=0.3, durationSec=180）
- [ ] 观察 3 分钟

**验收标准**：
- [ ] `chaos.deadlock.count` counter 上升（order + payment 各维度）
- [ ] MySQL error log 出现 `Deadlock found when trying to get lock`
- [ ] `chaos_event_log` 有 deadlock 事件记录（含 traceId）
- [ ] 应用层指数退避重试成功（`chaos.deadlock.retry.count` 上升）
- [ ] 超过重试上限的请求以 `ORDER_DEADLOCK_MAX_RETRY` 错误结束，不卡死
- [ ] Runner 成功率下降但不为 0

---

## 场景 6：库存定时重置演练

**目标**：验证 plan→reset 链路与版本检查，不破坏进行中订单一致性。

**执行步骤**：
- [ ] 让 Runner 持续运行直到库存出现不足（可临时调高 QPS 加速）
- [ ] 调用 `POST /internal/runner/inventory-reset/trigger` 立即触发重置
- [ ] 验证 plan 返回差值、reset 执行
- [ ] 模拟版本冲突：先修改 `baseline_version`，再 trigger，验证 409 返回
- [ ] 更新 schedule：`PUT /internal/runner/inventory-reset/schedule`（cron 改为 1 分钟一次）
- [ ] 等待自动触发，验证重置生效

**验收标准**：
- [ ] `reset/plan` 预览返回 `diff < 0`（库存已消耗）
- [ ] `reset` 执行后库存恢复基线，下单不再因库存不足失败
- [ ] 版本不一致时 reset 返回 409（不执行写入）
- [ ] 并发 trigger 只有一个成功（分布式锁保护）
- [ ] schedule 更新后内存调度器立即刷新（下次执行时间变化）

---

## 场景 7：组合故障（网络 + 慢 SQL + 死锁）

**目标**：验证系统在多重故障下的恢复时间与业务可用性。

**执行步骤**：
- [ ] 同时注入三个 Chaos：
  1. ToxiProxy：order→payment 延迟 2s
  2. `POST order-service /internal/chaos/slow-sql/enable`（delayMs=1500, injectRate=0.5）
  3. `POST order-service /internal/chaos/deadlock/enable`（injectRate=0.2）
- [ ] 观察 5 分钟
- [ ] 移除所有 Chaos（按顺序：deadlock disable → slow-sql disable → toxic remove）
- [ ] 观察恢复过程

**验收标准**：
- [ ] 故障期间系统仍可下单（成功率 > 20%，未完全不可用）
- [ ] Grafana 全链路可观测（trace 存在，metrics 可见，日志有 traceId）
- [ ] 移除所有 chaos 后 5 分钟内成功率恢复 > 90%
- [ ] Runner 全程未崩溃，恢复后继续产生流量
- [ ] `chaos_event_log` 有完整事件时间线

---

## 全局验收清单

- [ ] 故障注入全程有统一 `traceId`（Tempo 可查完整链路）
- [ ] Runner 支持不停机动态调速（`POST /internal/runner/rate`）
- [ ] Runner 配置更新即生效（`PUT /internal/runner/config`，版本乐观锁）
- [ ] 所有 Chaos enable 接口支持 `scope + injectRate + durationSec`
- [ ] `durationSec` 到期后所有 Chaos 自动关闭
- [ ] Chaos 接口仅在 `chaos` profile 下注册（生产环境不暴露）
- [ ] Grafana 两个 Dashboard 完整展示（Services Overview + Chaos Events）
