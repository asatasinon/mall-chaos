# Task 06 — inventory-service

**阶段**：Phase 1 — 基础 7 服务  
**依赖**：Task 01、Task 02、Task 05（慢 SQL Chaos 组件）  
**产出**：库存预占、释放、查询与重置服务（含慢 SQL Chaos）

---

## 职责
库存预占、释放、库存查询，以及定期库存重置（配合 traffic-runner）。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| POST | `/internal/inventory/reserve` | 内部 | 预占库存 |
| POST | `/internal/inventory/release` | 内部 | 释放已预占库存 |
| GET | `/internal/inventory/{sku}` | 内部 | 查询 SKU 当前可用库存 |
| POST | `/internal/inventory/reset/plan` | 内部 | 生成重置预览（不执行写入）|
| POST | `/internal/inventory/reset` | 内部 | 按基线重置库存 |
| POST | `/internal/chaos/slow-sql/enable` | Chaos | 开启库存慢 SQL |
| POST | `/internal/chaos/slow-sql/disable` | Chaos | 关闭库存慢 SQL |

## 子任务

### 6.1 数据模型

**`inventories` 表**
```sql
CREATE TABLE inventories (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    sku             VARCHAR(32)  NOT NULL UNIQUE,
    available_qty   INT          NOT NULL DEFAULT 0,
    reserved_qty    INT          NOT NULL DEFAULT 0,
    version         INT          NOT NULL DEFAULT 0,  -- 乐观锁
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sku (sku)
);
```

**`inventory_baseline_snapshot` 表**（全局共用，建于 MySQL 初始化脚本）
```sql
CREATE TABLE inventory_baseline_snapshot (
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    sku               VARCHAR(32)  NOT NULL,
    baseline_qty      INT          NOT NULL,
    baseline_version  INT          NOT NULL DEFAULT 1,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sku (sku)
);
```

### 6.2 初始化数据
- [ ] 与 `products` 表 SKU 对应，每个 SKU 初始 `available_qty=1000`
- [ ] `inventory_baseline_snapshot` 同步插入基线 `baseline_qty=1000`，`baseline_version=1`

### 6.3 实现 InventoryController

**`POST /internal/inventory/reserve`**
- [ ] 请求体：`{ "orderId": "xxx", "sku": "SKU-001", "qty": 2 }`
- [ ] 执行：`UPDATE inventories SET available_qty=available_qty-?, reserved_qty=reserved_qty+?, version=version+1 WHERE sku=? AND available_qty>=? AND version=?`（乐观锁 CAS）
- [ ] 库存不足返回 `BizException(INVENTORY_NOT_ENOUGH)`
- [ ] 成功返回 `{ lockId, sku, qty }`

**`POST /internal/inventory/release`**
- [ ] 请求体：`{ "orderId": "xxx", "sku": "SKU-001", "qty": 2 }`
- [ ] 执行：`available_qty+qty, reserved_qty-qty`，版本+1

**`GET /internal/inventory/{sku}`**
- [ ] 返回 `{ sku, availableQty, reservedQty, version }`

**`POST /internal/inventory/reset/plan`**
- [ ] 读取 `inventory_baseline_snapshot`，与当前 `inventories` 对比
- [ ] 返回预览：`[ { sku, currentQty, baselineQty, diff } ]`，不执行写入

**`POST /internal/inventory/reset`**
- [ ] 请求体：`{ "expectedVersion": 1, "scope": "ALL" | ["SKU-001", "SKU-002"] }`
- [ ] 校验 `baseline_version == expectedVersion`，不一致返回 409
- [ ] 获取 Redis 分布式锁（key: `inventory:reset:lock`，TTL=30s）
- [ ] 在锁内批量 UPDATE `inventories.available_qty = baseline_qty`，`reserved_qty=0`，`version+1`
- [ ] 释放锁，返回 `{ resetCount, executedAt }`

### 6.4 慢 SQL Chaos
- [ ] 复用 Task 05 的 `SlowSqlChaosService` 组件
- [ ] 在 `reserve`、`release`、`query` 的 Service 层注入慢 SQL 拦截逻辑

### 6.5 Redis 分布式锁工具
- [ ] 实现 `DistributedLockService`（`SET NX PX`）
- [ ] 放入 `common` 模块供其他服务复用

### 6.6 actuator & metrics
- [ ] `inventory.reserve.success.count`
- [ ] `inventory.reserve.fail.count`（库存不足）
- [ ] `inventory.reset.count`

### 6.7 验证
- [ ] 连续预占直到库存耗尽，返回正确错误
- [ ] release 后库存恢复
- [ ] reset/plan 预览正确，reset 执行后库存恢复基线
- [ ] 并发 reset 只有一个成功（分布式锁验证）
