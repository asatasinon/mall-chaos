# Task 05 — catalog-service

**阶段**：Phase 1 — 基础 7 服务  
**依赖**：Task 01、Task 02  
**产出**：商品信息、SKU 与价格查询服务（含慢 SQL Chaos）

---

## 职责
商品信息、SKU 与价格查询，批量商品校验，以及慢 SQL Chaos 注入。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| GET | `/api/products` | 对外 | 商品列表与基础筛选查询 |
| GET | `/api/products/{sku}` | 对外 | SKU 详情（价格、上下架状态）|
| POST | `/internal/catalog/batch` | 内部 | 批量查询商品，供下单校验 |
| POST | `/internal/chaos/slow-sql/enable` | Chaos | 开启慢 SQL 场景 |
| POST | `/internal/chaos/slow-sql/disable` | Chaos | 关闭慢 SQL 场景 |

## 子任务

### 5.1 数据模型

**`products` 表**
```sql
CREATE TABLE products (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    sku         VARCHAR(32)     NOT NULL UNIQUE,
    name        VARCHAR(128)    NOT NULL,
    price       DECIMAL(10, 2)  NOT NULL,
    status      TINYINT         NOT NULL DEFAULT 1,  -- 1=上架, 0=下架
    category    VARCHAR(64),
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sku (sku),
    INDEX idx_status (status)
);
```

### 5.2 初始化数据
- [ ] 插入 20–50 个 SKU（`SKU-001` ~ `SKU-050`），价格范围 10~500 元
- [ ] 绝大多数 `status=1`（上架），少量 `status=0`

### 5.3 实现 CatalogController
- [ ] `GET /api/products`：支持可选参数 `?category=&page=&size=`，返回分页列表
- [ ] `GET /api/products/{sku}`：精确查询，不存在返回 404
- [ ] `POST /internal/catalog/batch`：
  - 请求体：`{ "skus": ["SKU-001", "SKU-002"] }`
  - 返回：`{ "products": [ { sku, name, price, status } ] }`
  - 未找到的 SKU 在结果中标记为 `status=-1`（不存在）

### 5.4 慢 SQL Chaos（共用模块）
- [ ] 创建 `chaos-common` 组件（或在 `common` 模块中），提供 `SlowSqlChaosService`
- [ ] 慢 SQL 模式：
  - `real`：执行 `SELECT SLEEP(N)` 作为前置语句，或在查询中嵌入 `SLEEP`
  - `sleep`：在 Java 层 `Thread.sleep(N)` 模拟延迟
- [ ] `SlowSqlChaosService` 字段：`enabled`, `mode(real/sleep)`, `delayMs`, `injectRate`, `scope`, `autoDisableAt`
- [ ] `ChaosController`（`/internal/chaos/slow-sql/enable|disable`）：
  - 请求体：`{ "mode": "real", "delayMs": 2000, "injectRate": 0.5, "scope": "ALL", "durationSec": 300 }`
  - `durationSec` 到期后自动 disable（ScheduledExecutorService 定时任务）
- [ ] 只在 `chaos` profile 下注册 `ChaosController` bean

### 5.5 actuator & metrics
- [ ] `catalog.query.count`，tag：`type=single|batch|list`
- [ ] `catalog.chaos.slow_sql.active`（gauge，0/1）

### 5.6 验证
- [ ] `GET /api/products?page=0&size=10` 返回商品列表
- [ ] `GET /api/products/SKU-001` 返回商品详情
- [ ] `POST /internal/catalog/batch` 批量返回正确
- [ ] 启用慢 SQL chaos 后，查询耗时明显上升，`durationSec` 到期后自动关闭
