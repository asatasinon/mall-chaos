# Task 16 — Chaos: 数据库死锁

**阶段**：Phase 3 — Chaos 功能  
**依赖**：Task 07（order-service）、Task 08（payment-service）、Task 02（chaos_event_log 表）  
**产出**：MySQL 死锁 Chaos 注入，验证死锁可观测性、重试机制与失败补偿

---

## 目标
在 order-service 和 payment-service 中实现死锁场景注入：通过构造互锁事务触发 MySQL 死锁检测，验证应用层幂等重试、指数退避、`chaos_event_log` 记录完整。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/internal/chaos/deadlock/enable` | 开启死锁注入 |
| POST | `/internal/chaos/deadlock/disable` | 关闭死锁注入 |
| POST | `/internal/chaos/deadlock/clear` | 清理任务并主动回滚 |
| GET | `/internal/chaos/deadlock/status` | 查看死锁状态与统计 |

## 子任务

### 16.1 死锁注入原理

**Order-service 死锁构造**（`orders` 表行锁互换）：
```
事务 A（线程1）: BEGIN; UPDATE orders SET status='X' WHERE id=1; sleep(50ms); UPDATE orders SET status='X' WHERE id=2;
事务 B（线程2）: BEGIN; UPDATE orders SET status='X' WHERE id=2; sleep(50ms); UPDATE orders SET status='X' WHERE id=1;
```
MySQL innodb 检测到死锁后回滚代价较小的事务，抛出 `Deadlock found when trying to get lock` 异常。

**Payment-service 死锁构造**（`payments` 表）：同上，对 `payments` id=1 和 id=2 互换锁顺序。

### 16.2 DeadlockChaosService 设计

```java
@Service
@Profile("chaos")
public class DeadlockChaosService {
    private volatile boolean enabled = false;
    private volatile double injectRate = 0.3;
    private volatile String scope = "ALL";
    private volatile Instant autoDisableAt = null;
    private final AtomicInteger deadlockCount = new AtomicInteger(0);
    private volatile String lastError = null;

    private ScheduledFuture<?> scheduledTask = null;
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);
}
```

### 16.3 enable 接口
- [ ] 请求体：`{ "scope": "ALL", "injectRate": 0.3, "durationSec": 120 }`
- [ ] 启动定时任务（`scheduler.scheduleAtFixedRate`，每 1s 执行一次）
- [ ] 每次执行：以 `injectRate` 概率触发死锁构造（提交两个并发事务）
- [ ] `durationSec > 0` 时记录 `autoDisableAt`，过期自动 disable
- [ ] 使用 `@Transactional(propagation=REQUIRES_NEW)` 确保事务隔离

### 16.4 死锁事务实现
```java
@Transactional(propagation = REQUIRES_NEW)
public void lockRowA_thenB(int idA, int idB) {
    jdbcTemplate.update("UPDATE orders SET updated_at=NOW() WHERE id=?", idA);
    Thread.sleep(50);
    jdbcTemplate.update("UPDATE orders SET updated_at=NOW() WHERE id=?", idB);
}

@Transactional(propagation = REQUIRES_NEW)
public void lockRowB_thenA(int idA, int idB) {
    jdbcTemplate.update("UPDATE orders SET updated_at=NOW() WHERE id=?", idB);
    Thread.sleep(50);
    jdbcTemplate.update("UPDATE orders SET updated_at=NOW() WHERE id=?", idA);
}
```
- [ ] 在两个线程中并发执行 A 和 B，触发死锁
- [ ] 捕获 `DeadlockLoserDataAccessException`，记录到 `chaos_event_log`，更新 `deadlockCount`

### 16.5 disable 接口
- [ ] `enabled = false`，取消 `scheduledTask`（`cancel(false)`）

### 16.6 clear 接口
- [ ] disable 后，额外执行：`DELETE FROM chaos_event_log WHERE scenario='deadlock'`（可选）
- [ ] 检查是否有未提交事务（通过 `information_schema.innodb_trx` 查询），记录警告日志

### 16.7 status 接口
- [ ] 返回：
  ```json
  {
    "enabled": true,
    "injectRate": 0.3,
    "durationSec": 120,
    "autoDisableAt": "2024-04-16T12:00:00Z",
    "deadlockCount": 42,
    "lastError": "Deadlock found when trying to get lock; try restarting transaction",
    "lastOccurredAt": "2024-04-16T11:58:30Z"
  }
  ```

### 16.8 应用层重试机制
- [ ] order-service `OrderService.createOrder()` 捕获死锁异常，执行指数退避重试：
  - 最多重试 3 次，初始等待 100ms，每次 * 2
  - 超过重试上限后返回 `BizException(ORDER_DEADLOCK_MAX_RETRY)`
- [ ] 每次死锁重试写入 `chaos_event_log`（`result=RETRY`）
- [ ] 最终失败写入 `chaos_event_log`（`result=FAILED`）

### 16.9 chaos_event_log 写入
```sql
INSERT INTO chaos_event_log (service, scenario, trace_id, started_at, ended_at, result, error)
VALUES ('order', 'deadlock', ?, NOW(), NOW(), 'DEADLOCK', 'Deadlock found...');
```

### 16.10 actuator & metrics
- [ ] `chaos.deadlock.count` counter（tag: `service=order|payment`）
- [ ] `chaos.deadlock.retry.count` counter
- [ ] Grafana 面板：死锁次数时间线 + 重试次数

### 16.11 验证场景
- [ ] 调用 `enable`（injectRate=0.5, durationSec=60）
- [ ] 观察 `chaos_event_log` 出现 deadlock 记录
- [ ] MySQL 慢日志/error log 出现 `Deadlock found` 字样
- [ ] Grafana `chaos.deadlock.count` 曲线上升
- [ ] 应用重试成功后，正常流量继续（成功率不大幅下降）
- [ ] 60s 后自动 disable，死锁注入停止
