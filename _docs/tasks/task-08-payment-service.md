# Task 08 — payment-service

**阶段**：Phase 1 — 基础 7 服务  
**依赖**：Task 01、Task 02、Task 05（Chaos 组件）  
**产出**：支付模拟服务（含内存泄漏 + 慢 SQL + 死锁 Chaos）

---

## 职责
支付扣款模拟、支付状态查询与回执，可控制成功/失败/超时结果。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| POST | `/internal/payments/charge` | 内部 | 执行扣款 |
| GET | `/internal/payments/{id}` | 内部 | 查询支付单状态 |
| POST | `/internal/chaos/memory-leak/start` | Chaos | 启动内存泄漏 |
| POST | `/internal/chaos/memory-leak/stop` | Chaos | 停止内存泄漏分配 |
| POST | `/internal/chaos/memory-leak/clear` | Chaos | 清理泄漏对象引用 |
| GET | `/internal/chaos/memory-leak/status` | Chaos | 查询泄漏状态 |
| POST | `/internal/chaos/slow-sql/enable` | Chaos | 开启慢 SQL |
| POST | `/internal/chaos/slow-sql/disable` | Chaos | 关闭慢 SQL |
| POST | `/internal/chaos/deadlock/enable` | Chaos | 开启死锁场景 |
| POST | `/internal/chaos/deadlock/disable` | Chaos | 关闭死锁场景 |
| POST | `/internal/chaos/deadlock/clear` | Chaos | 清理死锁注入 |
| GET | `/internal/chaos/deadlock/status` | Chaos | 查询死锁状态 |

## 子任务

### 8.1 数据模型

**`payments` 表**
```sql
CREATE TABLE payments (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    payment_no      VARCHAR(32)     NOT NULL UNIQUE,
    order_no        VARCHAR(32)     NOT NULL,
    user_id         BIGINT          NOT NULL,
    amount          DECIMAL(10, 2)  NOT NULL,
    status          VARCHAR(16)     NOT NULL DEFAULT 'PROCESSING',
                    -- PROCESSING / SUCCESS / FAILED / TIMEOUT
    result_code     VARCHAR(32),     -- SUCCESS / INSUFFICIENT_BALANCE / TIMEOUT / ERROR
    fail_reason     VARCHAR(256),
    trace_id        VARCHAR(64),
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_order_no (order_no),
    INDEX idx_payment_no (payment_no)
);
```

### 8.2 扣款实现（可控结果）
- [ ] `POST /internal/payments/charge` 请求体：
  ```json
  {
    "orderId": "xxx",
    "orderNo": "ORD-20240416-001",
    "userId": 1,
    "amount": 99.00
  }
  ```
- [ ] 结果控制策略（模拟，可由配置控制比例）：
  - 默认 **100% 成功**
  - 0% `INSUFFICIENT_BALANCE`（余额不足）
  - 0% `TIMEOUT`（Thread.sleep 5s 后返回失败，模拟超时）
- [ ] 结果比例由 `application.yml` 配置，可热更新：
  ```yaml
  payment:
    success-rate: 1.0
    timeout-rate: 0.0
  ```
- [ ] 幂等：相同 `orderNo` 重复调用返回已有结果

### 8.3 查询支付单
- [ ] `GET /internal/payments/{id}` 返回 `PaymentDTO`（status, resultCode, failReason）

### 8.4 Chaos — 内存泄漏
- [ ] 复用 Task 07 `MemoryLeakChaosService` 的实现（抽取到 common 或各自独立实现）
- [ ] `start/stop/clear/status` 同 order-service

### 8.5 Chaos — 慢 SQL
- [ ] 复用 `SlowSqlChaosService`，应用于 `payments` 表读写操作

### 8.6 Chaos — 死锁
- [ ] 构造死锁场景：支付与订单状态更新互锁：
  - 事务 A：锁 `payments`(id=1) → 尝试锁 `payments`(id=2)
  - 事务 B：锁 `payments`(id=2) → 尝试锁 `payments`(id=1)
- [ ] `enable` 请求体：`{ "scope": "ALL", "injectRate": 0.3, "durationSec": 120 }`
- [ ] `durationSec` 到期自动 disable
- [ ] `status` 返回 `{ enabled, deadlockCount, lastError, autoDisableAt }`

### 8.7 actuator & metrics
- [ ] `payment.charge.success.count`，`payment.charge.fail.count`
- [ ] `payment.charge.timeout.count`
- [ ] `chaos.deadlock.count` counter（payment 维度）

### 8.8 验证
- [ ] 连续调用 100 次，成功率为 100%
- [ ] 超时场景 order-service 可感知并记录 FAILED
- [ ] 内存泄漏行为同 order-service
- [ ] 死锁注入后 `chaos_event_log` 有 payment 相关记录
