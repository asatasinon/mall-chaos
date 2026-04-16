# Task 12 — fulfillment-service

**阶段**：Phase 2 — 进阶 4 服务  
**依赖**：Task 01、Task 02、Task 06（inventory）、Task 05（Chaos 组件）  
**产出**：履约单创建、取消与物流状态跟踪服务（含慢 SQL Chaos）

---

## 职责
支付成功后创建履约单与发货任务，订单关闭时取消，提供物流状态查询。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| GET | `/api/fulfillments/{orderId}` | 对外 | 查询订单履约与发货状态 |
| POST | `/internal/fulfillments/create` | 内部 | 支付成功后创建履约单 |
| POST | `/internal/fulfillments/cancel` | 内部 | 订单关闭时取消履约 |
| POST | `/internal/chaos/slow-sql/enable` | Chaos | 开启履约慢 SQL |
| POST | `/internal/chaos/slow-sql/disable` | Chaos | 关闭慢 SQL |

## 子任务

### 12.1 数据模型

**`fulfillments` 表**
```sql
CREATE TABLE fulfillments (
    id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
    order_id        BIGINT       NOT NULL UNIQUE,
    order_no        VARCHAR(32)  NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'CREATED',
                    -- CREATED / PICKING / SHIPPED / DELIVERED / CANCELLED
    tracking_no     VARCHAR(64),
    carrier         VARCHAR(32)  DEFAULT 'MockExpress',
    shipped_at      DATETIME,
    delivered_at    DATETIME,
    cancel_reason   VARCHAR(256),
    trace_id        VARCHAR(64),
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_order_id (order_id),
    INDEX idx_order_no (order_no)
);
```

### 12.2 实现 FulfillmentController

**`POST /internal/fulfillments/create`**
- [ ] 请求体：`{ "orderId": 1, "orderNo": "ORD-xxx", "userId": 1, "sku": "SKU-001", "qty": 2 }`
- [ ] 创建履约单（`status=CREATED`），生成虚拟运单号（`TRACK-{UUID前8位}`）
- [ ] 启动异步任务（`@Async`）模拟发货进度流转：
  - 5s 后 `status=PICKING`
  - 10s 后 `status=SHIPPED`，记录 `shipped_at`
  - 30s 后 `status=DELIVERED`，记录 `delivered_at`（演示用，实际可配置）
- [ ] 幂等：同 `orderId` 重复调用返回已有履约单

**`POST /internal/fulfillments/cancel`**
- [ ] 请求体：`{ "orderId": 1, "reason": "ORDER_CLOSED" }`
- [ ] 只允许在 `status IN (CREATED, PICKING)` 时取消
- [ ] 已发货（SHIPPED/DELIVERED）无法取消，返回 `BizException(FULFILLMENT_CANNOT_CANCEL)`

**`GET /api/fulfillments/{orderId}`**
- [ ] 返回 `FulfillmentDTO`（status, trackingNo, carrier, shippedAt, deliveredAt）

### 12.3 慢 SQL Chaos
- [ ] 复用 `SlowSqlChaosService`，应用于履约单创建与查询

### 12.4 actuator & metrics
- [ ] `fulfillment.create.count`
- [ ] `fulfillment.cancel.count`
- [ ] `fulfillment.status` gauge（各状态计数）

### 12.5 验证
- [ ] 创建后状态正确流转（CREATED → PICKING → SHIPPED → DELIVERED）
- [ ] 取消 CREATED 状态成功，取消 SHIPPED 状态返回错误
- [ ] 重复创建幂等
