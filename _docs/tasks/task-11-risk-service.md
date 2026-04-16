# Task 11 — risk-service

**阶段**：Phase 2 — 进阶 4 服务  
**依赖**：Task 01、Task 02、Task 04（user）、Task 05（Chaos 组件）  
**产出**：前置风控与支付后复核服务（含慢 SQL Chaos）

---

## 职责
下单前风控校验（账号风险、地址风险、频率风险），支付后复核（决定是否冻结订单）。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| POST | `/internal/risk/pre-check` | 内部 | 下单前风控校验 |
| POST | `/internal/risk/post-pay-check` | 内部 | 支付后复核 |
| POST | `/internal/chaos/slow-sql/enable` | Chaos | 开启风控慢查询 |
| POST | `/internal/chaos/slow-sql/disable` | Chaos | 关闭慢查询 |

## 子任务

### 11.1 数据模型

**`risk_rules` 表**（风控规则，静态配置）
```sql
CREATE TABLE risk_rules (
    id           BIGINT       PRIMARY KEY AUTO_INCREMENT,
    rule_type    VARCHAR(32)  NOT NULL,   -- FREQ_LIMIT / AMOUNT_LIMIT / BLACKLIST
    threshold    INT,
    window_sec   INT,
    enabled      TINYINT      NOT NULL DEFAULT 1,
    description  VARCHAR(256)
);
-- 初始数据：每分钟同用户最多 10 单，单笔最高 5000 元
```

**`risk_events` 表**（风控事件日志）
```sql
CREATE TABLE risk_events (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    user_id     BIGINT       NOT NULL,
    order_no    VARCHAR(32),
    event_type  VARCHAR(32)  NOT NULL,   -- PRE_CHECK_PASS / PRE_CHECK_REJECT / POST_PAY_FREEZE
    reason      VARCHAR(256),
    trace_id    VARCHAR(64),
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_order_no (order_no)
);
```

### 11.2 实现 RiskController

**`POST /internal/risk/pre-check`**
- [ ] 请求体：`{ "userId": 1, "orderNo": "ORD-xxx", "amount": 99.00, "sku": "SKU-001", "qty": 2 }`
- [ ] 规则校验：
  - **频率风控**：Redis INCR `risk:freq:{userId}` + TTL 60s，超过阈值（默认 10次/分钟）拒绝
  - **金额风控**：`amount > 5000` 拒绝
  - **黑名单**：预置几个 userId 在 Redis Set `risk:blacklist` 中
- [ ] 通过返回：`{ "pass": true, "riskLevel": "LOW" }`
- [ ] 拒绝返回：`{ "pass": false, "reason": "FREQ_LIMIT_EXCEEDED" }`（HTTP 200，由 order 判断）

**`POST /internal/risk/post-pay-check`**
- [ ] 请求体：`{ "userId": 1, "orderNo": "ORD-xxx", "paymentId": "PAY-xxx", "amount": 99.00 }`
- [ ] 规则：金额 > 2000 元有 5% 概率触发人工审核冻结
- [ ] 结果：`{ "pass": true }` 或 `{ "pass": false, "action": "FREEZE", "reason": "HIGH_AMOUNT_REVIEW" }`
- [ ] 记录 `risk_events` 日志

### 11.3 Redis 频率计数
- [ ] `INCR risk:freq:{userId}`，首次写入时 `EXPIRE 60`
- [ ] 读取计数与阈值对比

### 11.4 慢 SQL Chaos
- [ ] 复用 `SlowSqlChaosService`，应用于风控规则查询和事件日志写入

### 11.5 actuator & metrics
- [ ] `risk.pre_check.pass.count`，`risk.pre_check.reject.count`
- [ ] `risk.post_pay.freeze.count`

### 11.6 验证
- [ ] 正常用户 pre-check 通过
- [ ] 高频用户（>10次/分钟）pre-check 被拒绝
- [ ] 黑名单用户被拒绝
- [ ] post-pay-check 高金额偶发冻结
