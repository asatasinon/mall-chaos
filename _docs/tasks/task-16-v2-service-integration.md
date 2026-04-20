# Task 16 — v2 各服务场景接入：表锁阻塞 + 慢 SQL + 内存泄漏

**阶段**：Phase 3 — Chaos 功能（v2 改版）  
**依赖**：Task 14（公共组件）、Task 15（大表数据）、Task 03-13（所有服务）  
**产出**：所有业务服务接入 v2 的 3 个故障注入场景  
**设计文档**：[chaos-v2.md](../plans/chaos-v2.md) §3-5, §10

---

## 目标

将 Task 14 提供的 3 个公共组件（`DataAuditService`、`QueryEnrichmentInterceptor`、`LocalQueryCacheManager`）接入所有业务服务，替换 v1 的 ChaosController。每个服务需要：

1. 删除 v1 的 `ChaosController` 和相关 chaos 代码
2. 新增 `MaintenanceController`（表锁阻塞 API）
3. 在数据访问层接入 `QueryEnrichmentInterceptor`（慢 SQL JOIN）
4. 在业务层接入 `LocalQueryCacheManager`（内存泄漏缓存）
5. 新增 `CacheManagementController`（缓存管理 API）

---

## 子任务

### 16.1 各服务 v1 代码清理

移除以下文件/代码：

| 服务 | 需删除的文件 |
|------|-------------|
| catalog-service | `ChaosController.java` |
| inventory-service | `ChaosController.java` |
| order-service | `ChaosController.java`、`chaos/OrderDeadlockChaosService.java` |
| payment-service | `ChaosController.java`、`chaos/DeadlockChaosService.java` |
| promotion-service | `ChaosController.java` |
| risk-service | `ChaosController.java` |
| fulfillment-service | `ChaosController.java` |
| notification-service | `ChaosController.java` |
| gateway-service | `ChaosEventsController.java` |

- [ ] 清理所有服务中 `@Profile("chaos")` 相关注解
- [ ] 清理 `application.yml` 中 `chaos` profile 的配置段（如有）
- [ ] 确保所有服务编译通过

### 16.2 MaintenanceController — 表锁阻塞 API

每个需要表锁的服务新增：

**路径**：`<service>/src/main/java/com/castrel/<service>/controller/MaintenanceController.java`

```java
@RestController
@RequestMapping("/internal/maintenance")
public class MaintenanceController {

    private final DataAuditService dataAuditService;

    @PostMapping("/data-audit/start")
    public ApiResponse<DataAuditStatus> startAudit(@RequestBody DataAuditRequest request) {
        dataAuditService.startAudit(request.tableName(), request.estimatedDurationSec());
        return ApiResponse.ok(dataAuditService.getStatus());
    }

    @PostMapping("/data-audit/stop")
    public ApiResponse<DataAuditStatus> stopAudit() {
        dataAuditService.stopAudit();
        return ApiResponse.ok(dataAuditService.getStatus());
    }

    @GetMapping("/data-audit/status")
    public ApiResponse<DataAuditStatus> auditStatus() {
        return ApiResponse.ok(dataAuditService.getStatus());
    }
}
```

**DataAuditRequest DTO**：
```java
public record DataAuditRequest(
    String tableName,
    String auditType,           // "FULL_CONSISTENCY"
    int estimatedDurationSec    // 默认 300
) {}
```

需要接入的服务与可锁定的表：

| 服务 | 可锁定表 |
|------|---------|
| order-service | `orders` |
| payment-service | `payments` |
| inventory-service | `inventories` |
| fulfillment-service | `fulfillments` |
| notification-service | `notification_logs` |
| risk-service | `risk_events` |
| promotion-service | `promotions` |

- [ ] order-service 接入
- [ ] payment-service 接入
- [ ] inventory-service 接入
- [ ] fulfillment-service 接入
- [ ] notification-service 接入
- [ ] risk-service 接入
- [ ] promotion-service 接入

### 16.3 慢 SQL — 各服务 JOIN 接入

在每个服务的数据访问层（Repository 或 Service 中的 JDBC 查询）添加条件 JOIN 逻辑。

#### 通用模式

```java
// 在 XxxRepository 或 XxxService 中注入:
@Autowired
private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

public Xxx findXxx(Long userId) {
    if (queryEnrichmentInterceptor.shouldEnrich()) {
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        if ("user_behavior_log".equals(joinTable)) {
            return findXxxWithBehaviorLog(userId);
        } else if ("product_price_history".equals(joinTable)) {
            return findXxxWithPriceHistory(userId);
        }
    }
    return findXxxNormal(userId);
}
```

#### 各服务 JOIN SQL

**order-service** — JOIN `user_behavior_log`：
```sql
SELECT o.* FROM orders o
  JOIN user_behavior_log ubl ON ubl.user_id = o.user_id
WHERE o.user_id = ?
  AND o.status = 'PENDING'
  AND ubl.action_type = 'PLACE_ORDER'
ORDER BY ubl.created_at DESC
LIMIT 1
```

**payment-service** — JOIN `user_behavior_log`：
```sql
SELECT p.* FROM payments p
  JOIN user_behavior_log ubl ON ubl.user_id = p.user_id
WHERE p.order_no = ?
  AND ubl.action_type = 'PLACE_ORDER'
ORDER BY ubl.created_at DESC
LIMIT 1
```

**catalog-service** — JOIN `product_price_history`（函数破坏索引）：
```sql
SELECT p.* FROM products p
  JOIN product_price_history pph ON CONCAT(pph.sku, '') = p.sku
WHERE p.sku = ?
  AND p.status = 1
  AND pph.effective_at <= NOW()
ORDER BY pph.effective_at DESC
LIMIT 1
```

**inventory-service** — JOIN `product_price_history`（函数破坏索引）：
```sql
SELECT i.* FROM inventories i
  JOIN product_price_history pph ON CONCAT(pph.sku, '') = i.sku
WHERE i.sku = ?
  AND pph.effective_at <= NOW()
ORDER BY pph.effective_at DESC
LIMIT 1
```

**promotion-service** — JOIN `product_price_history`（函数破坏索引）：
```sql
SELECT pr.* FROM promotions pr
  JOIN product_price_history pph ON CONCAT(pph.sku, '') = ?
WHERE pr.enabled = 1
  AND pph.effective_at <= NOW()
LIMIT 1
```

**risk-service** — JOIN `user_behavior_log`：
```sql
SELECT re.* FROM risk_events re
  JOIN user_behavior_log ubl ON ubl.user_id = re.user_id
WHERE re.user_id = ?
  AND ubl.action_type = 'PLACE_ORDER'
LIMIT 1
```

**fulfillment-service** — JOIN `user_behavior_log`：
```sql
SELECT f.* FROM fulfillments f
  JOIN user_behavior_log ubl ON ubl.user_id = ?
WHERE f.order_no = ?
  AND ubl.action_type = 'PLACE_ORDER'
LIMIT 1
```

**notification-service** — JOIN `user_behavior_log`：
```sql
SELECT n.* FROM notification_logs n
  JOIN user_behavior_log ubl ON ubl.user_id = n.user_id
WHERE n.order_no = ?
  AND ubl.action_type = 'PLACE_ORDER'
LIMIT 1
```

接入清单：
- [ ] order-service 接入 JOIN
- [ ] payment-service 接入 JOIN
- [ ] catalog-service 接入 JOIN
- [ ] inventory-service 接入 JOIN
- [ ] promotion-service 接入 JOIN
- [ ] risk-service 接入 JOIN
- [ ] fulfillment-service 接入 JOIN
- [ ] notification-service 接入 JOIN

### 16.4 内存泄漏 — 各服务缓存接入

在每个服务的关键查询返回处调用 `LocalQueryCacheManager.cacheIfNeeded()`：

```java
// OrderService.java
public Order getOrder(String orderNo) {
    Order order = orderRepository.findByOrderNo(orderNo);
    localQueryCacheManager.cacheIfNeeded("order:" + orderNo, order);
    return order;
}
```

各服务接入点：

| 服务 | 接入方法 | cache key 前缀 |
|------|---------|---------------|
| order-service | `OrderService.createOrder()` / `getOrder()` | `order:` |
| payment-service | `PaymentService.charge()` / `getPayment()` | `payment:` |
| catalog-service | `ProductService.getProduct()` | `product:` |
| inventory-service | `InventoryService.reserve()` | `inventory:` |
| promotion-service | `PromotionService.calculate()` | `promotion:` |
| risk-service | `RiskService.preCheck()` | `risk:` |
| fulfillment-service | `FulfillmentService.create()` | `fulfillment:` |
| notification-service | `NotificationService.send()` | `notification:` |

- [ ] order-service 接入缓存
- [ ] payment-service 接入缓存
- [ ] catalog-service 接入缓存
- [ ] inventory-service 接入缓存
- [ ] promotion-service 接入缓存
- [ ] risk-service 接入缓存
- [ ] fulfillment-service 接入缓存
- [ ] notification-service 接入缓存

### 16.5 CacheManagementController — 缓存管理 API

每个服务新增缓存管理 API：

**路径**：`<service>/src/main/java/com/castrel/<service>/controller/CacheManagementController.java`

```java
@RestController
@RequestMapping("/internal/cache/local")
public class CacheManagementController {

    private final LocalQueryCacheManager cacheManager;

    @PostMapping("/evict-all")
    public ApiResponse<CacheStats> evictAll() {
        CacheStats stats = cacheManager.evictAll();
        return ApiResponse.ok(stats);
    }

    @GetMapping("/stats")
    public ApiResponse<CacheStats> stats() {
        return ApiResponse.ok(cacheManager.getStats());
    }
}
```

- [ ] 所有 8 个业务服务接入

### 16.6 Gateway Chaos 分发 API

根据最新控制面设计，`traffic-runner-service` 不再直连业务服务。  
Console/Traffic 触发的所有 chaos 请求必须先到 `gateway-service`，由 gateway 统一分发到目标服务或基础设施代理。

在 `gateway-service` 中新增统一分发 API：

```java
@RestController
@RequestMapping("/internal/gateway")
public class ChaosDispatchController {

    @PostMapping("/chaos/slow-sql/enable")
    public ApiResponse<?> enableSlowSql(@RequestBody SlowSqlDispatchRequest req) { ... }

    @PostMapping("/chaos/slow-sql/disable")
    public ApiResponse<?> disableSlowSql(@RequestBody TargetServicesRequest req) { ... }

    @GetMapping("/chaos/slow-sql/status")
    public ApiResponse<?> slowSqlStatus(@RequestParam List<String> targets) { ... }

    @PostMapping("/chaos/memory-leak/enable")
    public ApiResponse<?> enableMemoryLeak(@RequestBody MemoryLeakDispatchRequest req) { ... }

    @PostMapping("/chaos/memory-leak/disable")
    public ApiResponse<?> disableMemoryLeak(@RequestBody TargetServicesRequest req) { ... }

    @PostMapping("/chaos/memory-leak/cleanup")
    public ApiResponse<?> cleanupMemoryLeak(@RequestBody TargetServicesRequest req) { ... }

    @GetMapping("/chaos/memory-leak/status")
    public ApiResponse<?> memoryLeakStatus(@RequestParam List<String> targets) { ... }

    @PostMapping("/chaos/deadlock/enable")
    public ApiResponse<?> enableDeadlock(@RequestBody DeadlockDispatchRequest req) { ... }

    @PostMapping("/chaos/deadlock/disable")
    public ApiResponse<?> disableDeadlock(@RequestBody TargetServicesRequest req) { ... }

    @PostMapping("/chaos/deadlock/cleanup")
    public ApiResponse<?> cleanupDeadlock(@RequestBody TargetServicesRequest req) { ... }

    @GetMapping("/chaos/deadlock/status")
    public ApiResponse<?> deadlockStatus(@RequestParam List<String> targets) { ... }

    @PostMapping("/chaos/table-lock/enable")
    public ApiResponse<?> enableTableLock(@RequestBody TableLockDispatchRequest req) { ... }

    @PostMapping("/chaos/table-lock/disable")
    public ApiResponse<?> disableTableLock(@RequestBody TableLockDispatchRequest req) { ... }

    @GetMapping("/chaos/table-lock/status")
    public ApiResponse<?> tableLockStatus(
            @RequestParam String targetService,
            @RequestParam String targetTable) { ... }
}
```

**请求 DTO**：
```java
public record TargetServicesRequest(List<String> targets) {}

public record SlowSqlDispatchRequest(
        List<String> targets,
        String mode,
        int delayMs,
        double injectRate,
        String scope,
        int durationSec) {}

public record MemoryLeakDispatchRequest(
        List<String> targets,
        int chunkSizeKb,
        int intervalMs,
        int maxMb,
        int durationSec) {}

public record DeadlockDispatchRequest(
        List<String> targets,
        double injectRate,
        String scope,
        int durationSec) {}

public record TableLockDispatchRequest(
        String targetService,
        String targetTable,
        int durationSec) {}
```

- [ ] `gateway-service` 实现 `ChaosDispatchController`
- [ ] gateway 按目标服务白名单分发 chaos 请求
- [ ] gateway 统一注入 traceId、审计日志、错误格式
- [ ] traffic-runner-service 只调用 gateway 分发 API
- [ ] 不保留 `/internal/runner/scenario/*`

### 16.6.1 traffic 控制面 API 对接

`traffic-runner-service` 中保留的是控制平面 API，而不是直连业务服务的 `ScenarioController`：

```text
GET    /internal/traffic/chaos/overview
POST   /internal/traffic/chaos/slow-sql/enable
POST   /internal/traffic/chaos/slow-sql/disable
GET    /internal/traffic/chaos/slow-sql/status

POST   /internal/traffic/chaos/memory-leak/enable
POST   /internal/traffic/chaos/memory-leak/disable
POST   /internal/traffic/chaos/memory-leak/cleanup
GET    /internal/traffic/chaos/memory-leak/status

POST   /internal/traffic/chaos/deadlock/enable
POST   /internal/traffic/chaos/deadlock/disable
POST   /internal/traffic/chaos/deadlock/cleanup
GET    /internal/traffic/chaos/deadlock/status

POST   /internal/traffic/chaos/table-lock/enable
POST   /internal/traffic/chaos/table-lock/disable
GET    /internal/traffic/chaos/table-lock/status
```

- [ ] traffic API 参数校验与状态聚合
- [ ] traffic API 仅通过 gateway 调用业务侧 chaos 能力
- [ ] memory leak 统一使用 `enable / disable / cleanup`
- [ ] deadlock 清理动作统一使用 `cleanup`
- [ ] 表锁状态必须在真实加锁成功后再标记激活

### 16.7 验证

#### 表锁阻塞验证
- [ ] 调用 `POST /internal/traffic/chaos/table-lock/enable` 锁定 `orders` 表
- [ ] traffic-runner 产生的订单全部超时
- [ ] MySQL `SHOW PROCESSLIST` 显示 `Waiting for table lock`
- [ ] 调用 disable 后流量恢复

#### 慢 SQL 验证
- [ ] 确认大表数据 ≥ 3000 万行
- [ ] 调用 `POST /internal/traffic/chaos/slow-sql/enable`
- [ ] order-service 响应时间从 ~50ms 飙升到 10s+
- [ ] MySQL 慢查询日志出现 JOIN 语句
- [ ] `EXPLAIN` 显示 `type=ALL`（全表扫描）
- [ ] 调用 disable 后恢复

#### 内存泄漏验证
- [ ] 调用 `POST /internal/traffic/chaos/memory-leak/enable`
- [ ] Grafana JVM Heap Used 持续上升
- [ ] 调用 `GET /internal/cache/local/stats` 查看缓存条目增长
- [ ] 调用 `POST /internal/cache/local/evict-all` 后堆内存回落
- [ ] 调用 disable 后停止缓存积累
