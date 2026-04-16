# Task 13 — notification-service

**阶段**：Phase 2 — 进阶 4 服务  
**依赖**：Task 01、Task 02  
**产出**：订单、支付、发货通知分发服务（模拟发送，结构化日志记录）

---

## 职责
接收订单创建、支付结果、发货通知事件，模拟发送通知（邮件/短信/Push），写入结构化日志供观测。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| POST | `/internal/notifications/order-created` | 内部 | 订单创建成功通知 |
| POST | `/internal/notifications/payment-result` | 内部 | 支付成功/失败通知 |
| POST | `/internal/notifications/shipping-created` | 内部 | 发货通知 |

## 子任务

### 13.1 数据模型

**`notification_logs` 表**
```sql
CREATE TABLE notification_logs (
    id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
    event_type    VARCHAR(32)  NOT NULL,   -- ORDER_CREATED / PAYMENT_SUCCESS / PAYMENT_FAILED / SHIPPING
    user_id       BIGINT       NOT NULL,
    order_no      VARCHAR(32),
    channel       VARCHAR(16)  NOT NULL DEFAULT 'MOCK',   -- MOCK / SMS / EMAIL / PUSH
    status        VARCHAR(16)  NOT NULL DEFAULT 'SENT',    -- SENT / FAILED
    payload       JSON,
    trace_id      VARCHAR(64),
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_event_type (event_type),
    INDEX idx_order_no (order_no)
);
```

### 13.2 实现 NotificationController

**`POST /internal/notifications/order-created`**
- [ ] 请求体：`{ "userId": 1, "orderNo": "ORD-xxx", "amount": 99.00, "sku": "SKU-001" }`
- [ ] 模拟发送（log 输出 + DB 记录）：`"【下单成功】您的订单 ORD-xxx 已创建，金额 ¥99.00"`
- [ ] 写入 `notification_logs`

**`POST /internal/notifications/payment-result`**
- [ ] 请求体：`{ "userId": 1, "orderNo": "ORD-xxx", "success": true, "amount": 99.00 }`
- [ ] 成功：`"【支付成功】订单 ORD-xxx 支付 ¥99.00 成功"`
- [ ] 失败：`"【支付失败】订单 ORD-xxx 支付失败，请重试"`

**`POST /internal/notifications/shipping-created`**
- [ ] 请求体：`{ "userId": 1, "orderNo": "ORD-xxx", "trackingNo": "TRACK-abc12345", "carrier": "MockExpress" }`
- [ ] 消息：`"【已发货】您的订单已由 MockExpress 发出，单号：TRACK-abc12345"`

### 13.3 失败模拟（可配置）
- [ ] `application.yml` 配置 `notification.fail-rate=0.02`（2% 发送失败）
- [ ] 失败时 `status=FAILED`，记录错误原因，但 HTTP 仍返回 200（通知失败不影响主链路）

### 13.4 actuator & metrics
- [ ] `notification.sent.count`（tag: `event_type`, `channel`）
- [ ] `notification.fail.count`

### 13.5 验证
- [ ] 三类通知接口正确写入 `notification_logs`
- [ ] 失败时记录 `status=FAILED`，不影响调用方
- [ ] Loki 中可搜索 `traceId` 关联到通知发送日志
