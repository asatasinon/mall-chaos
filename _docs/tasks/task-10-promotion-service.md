# Task 10 — promotion-service

**阶段**：Phase 2 — 进阶 4 服务  
**依赖**：Task 01、Task 02、Task 05（Chaos 组件）  
**产出**：优惠券与促销规则计算服务（含慢 SQL Chaos）

---

## 职责
优惠券与促销规则计算，供 order-service 进阶下单链路调用。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| POST | `/api/promotions/preview` | 对外 | 预览优惠结果 |
| POST | `/internal/promotions/calculate` | 内部 | 下单时计算最终优惠明细 |
| POST | `/internal/chaos/slow-sql/enable` | Chaos | 开启促销规则慢查询 |
| POST | `/internal/chaos/slow-sql/disable` | Chaos | 关闭慢查询 |

## 子任务

### 10.1 数据模型

**`promotions` 表**（活动）
```sql
CREATE TABLE promotions (
    id          BIGINT          PRIMARY KEY AUTO_INCREMENT,
    type        VARCHAR(32)     NOT NULL,  -- DISCOUNT / FULL_REDUCTION / COUPON
    name        VARCHAR(128)    NOT NULL,
    min_amount  DECIMAL(10,2)   NOT NULL DEFAULT 0,  -- 满减门槛
    discount    DECIMAL(4,2),                         -- 折扣率 (0.8 = 8折)
    reduce_amt  DECIMAL(10,2),                        -- 减免金额
    enabled     TINYINT         NOT NULL DEFAULT 1,
    start_at    DATETIME,
    end_at      DATETIME,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**`coupons` 表**（用户持有的券）
```sql
CREATE TABLE coupons (
    id              BIGINT          PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT          NOT NULL,
    promotion_id    BIGINT          NOT NULL,
    status          TINYINT         NOT NULL DEFAULT 0,  -- 0=未使用, 1=已使用
    expire_at       DATETIME,
    used_at         DATETIME,
    INDEX idx_user_id (user_id),
    INDEX idx_promotion_id (promotion_id)
);
```

### 10.2 初始化数据
- [ ] 插入 3~5 个促销活动（折扣券、满减、无门槛券）
- [ ] 为 userId=1~20 各分配 2~3 张未使用优惠券

### 10.3 实现 PromotionController

**`POST /api/promotions/preview`**
- [ ] 请求体：`{ "userId": 1, "skus": [{ "sku": "SKU-001", "qty": 2, "price": 99.00 }] }`
- [ ] 返回：`{ "originalAmount": 198.00, "discountAmount": 19.80, "finalAmount": 178.20, "appliedPromotions": [...] }`

**`POST /internal/promotions/calculate`**
- [ ] 请求体同 preview，但额外锁定优惠券（`coupon.status=1` 标记使用）
- [ ] 返回优惠明细 + 使用的券 ID
- [ ] 幂等：同 `orderId` 重复调用返回同一结果（Redis SET NX `promo:calc:{orderId}`）

### 10.4 优惠计算规则（简化版）
- [ ] 优先使用满减，再叠加折扣券
- [ ] 同一订单最多使用 1 张优惠券
- [ ] 最终优惠金额 = originalAmount - reduce_amt（或 * discount）
- [ ] 最低支付金额 0.01 元（不能免单）

### 10.5 慢 SQL Chaos
- [ ] 复用 `SlowSqlChaosService`，应用于促销规则查询与优惠计算 SQL

### 10.6 actuator & metrics
- [ ] `promotion.calculate.count`（按 type tag）
- [ ] `promotion.discount.total` 累计优惠金额

### 10.7 验证
- [ ] preview 接口返回正确优惠金额
- [ ] calculate 接口锁定优惠券，重复调用幂等
- [ ] 慢 SQL chaos 开启后延迟上升
