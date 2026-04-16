# Task 07 — order-service

**阶段**：Phase 1 — 基础 7 服务  
**依赖**：Task 01、Task 02、Task 04（user）、Task 05（catalog + Chaos 组件）、Task 06（inventory）、Task 08（payment）  
**产出**：订单编排核心服务（含内存泄漏 + 慢 SQL + 死锁 Chaos）

---

## 职责
订单编排、状态机流转、幂等控制。调用 user/catalog/inventory/payment 完成下单全链路。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| POST | `/api/orders` | 对外 | 创建订单主入口 |
| GET | `/api/orders/{id}` | 对外 | 查询订单状态 |
| POST | `/internal/orders/create` | 内部 | 内部创建订单（runner 调用）|
| POST | `/internal/orders/{id}/cancel` | 内部 | 主动取消订单 |
| POST | `/internal/chaos/memory-leak/start` | Chaos | 启动 JVM 内存泄漏 |
| POST | `/internal/chaos/memory-leak/stop` | Chaos | 停止内存泄漏分配 |
| POST | `/internal/chaos/memory-leak/clear` | Chaos | 清理持有引用 |
| GET | `/internal/chaos/memory-leak/status` | Chaos | 查看泄漏状态 |
| POST | `/internal/chaos/slow-sql/enable` | Chaos | 开启慢 SQL |
| POST | `/internal/chaos/slow-sql/disable` | Chaos | 关闭慢 SQL |
| POST | `/internal/chaos/deadlock/enable` | Chaos | 开启死锁场景 |
| POST | `/internal/chaos/deadlock/disable` | Chaos | 关闭死锁场景 |
| POST | `/internal/chaos/deadlock/clear` | Chaos | 清理死锁任务并回滚 |
| GET | `/internal/chaos/deadlock/status` | Chaos | 查看死锁状态 |

## 子任务

### 7.1 数据模型

**`orders` 表**
```sql
CREATE TABLE orders (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no        VARCHAR(32)     NOT NULL UNIQUE,    -- 业务幂等键
    user_id         BIGINT          NOT NULL,
    sku             VARCHAR(32)     NOT NULL,
    qty             INT             NOT NULL DEFAULT 1,
    amount          DECIMAL(10, 2)  NOT NULL,
    status          VARCHAR(16)     NOT NULL DEFAULT 'PENDING',
                    -- PENDING / PAID / FAILED / CANCELLED / COMPLETED
    payment_id      VARCHAR(64),
    fail_reason     VARCHAR(256),
    trace_id        VARCHAR(64),
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_order_no (order_no)
);
```

### 7.2 幂等控制
- [ ] 使用 `order_no` 作为幂等键（客户端传入或 runner 生成）
- [ ] Redis SET NX `idempotent:order:{order_no}`，TTL=300s
- [ ] 已存在返回已有订单，不重复创建

### 7.3 下单编排流程（基础链路）
```
1. 幂等检查（Redis）
2. 校验用户状态（user-service GET /internal/users/{id}）
3. 校验商品状态与价格（catalog-service POST /internal/catalog/batch）
4. 预占库存（inventory-service POST /internal/inventory/reserve）
5. 创建订单记录（status=PENDING）
6. 发起支付（payment-service POST /internal/payments/charge）
7a. 支付成功 → 更新订单 status=PAID
7b. 支付失败 → 释放库存 + 更新订单 status=FAILED
```

### 7.4 RestClient 配置
- [ ] 使用 Spring Boot 3 `RestClient`（非 WebClient）调用下游服务
- [ ] 配置超时：`connectTimeout=2s`，`readTimeout=5s`
- [ ] 配置 `traceId` 透传拦截器（从 MDC 读取，写入请求头）

### 7.5 取消订单
- [ ] `POST /internal/orders/{id}/cancel`：
  - 校验订单状态为 `PENDING`
  - 调用 `inventory/release`
  - 更新 `status=CANCELLED`

### 7.6 Chaos — 内存泄漏（详见 Task 15）
- [ ] 实现 `MemoryLeakChaosService`（持有 `List<byte[]>` 强引用）
- [ ] `start`：启动后台线程持续 `new byte[1024*1024]` 并加入 list
- [ ] `stop`：停止线程，但保留已持有引用
- [ ] `clear`：清空 list，触发 GC
- [ ] `status`：返回 `{ running, holdingMb, objectCount }`
- [ ] 只在 `chaos` profile 启用

### 7.7 Chaos — 慢 SQL
- [ ] 复用 `SlowSqlChaosService`，应用于订单查询与写入 SQL

### 7.8 Chaos — 死锁（详见 Task 16）
- [ ] `enable`：请求体含 `scope`, `injectRate`, `durationSec`
- [ ] 实现：后台调度线程以 `injectRate` 概率触发"构造死锁的两个事务"：
  - 事务 A：先锁 `orders`（id=1），再锁 `orders`（id=2）
  - 事务 B：先锁 `orders`（id=2），再锁 `orders`（id=1）
  - MySQL 检测死锁后抛异常，应用捕获记录 `chaos_event_log`
- [ ] `durationSec` 到期后自动 disable
- [ ] `clear`：停止调度，主动 rollback 所有挂起事务
- [ ] `status`：返回 `{ enabled, deadlockCount, lastError, autoDisableAt }`

### 7.9 actuator & metrics
- [ ] `order.create.success.count`，`order.create.fail.count`
- [ ] `order.status` gauge（各 status 计数）
- [ ] `chaos.memory_leak.holding_mb` gauge
- [ ] `chaos.deadlock.count` counter

### 7.10 验证
- [ ] 正常下单链路全流程通过
- [ ] 幂等键重复提交返回同一订单
- [ ] 支付失败路径：库存已释放，订单状态 FAILED
- [ ] 内存泄漏：start 后 JVM heap 持续增长；clear 后回落（Grafana 可见）
- [ ] 死锁：enable 后 MySQL error log 出现 deadlock 记录，`chaos_event_log` 有条目
