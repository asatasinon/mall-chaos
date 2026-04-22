# Castrel Chaos v2 — 隐蔽式故障注入设计

## 1. 总览

v2 对 **慢 SQL**、**MySQL 死锁（表锁阻塞）**、**内存泄漏** 三个场景进行重新设计，核心目标：

1. **代码零 chaos 痕迹**：所有类名、方法名、API 路径、Redis Key、表名均使用符合正常业务逻辑的命名。代码审查无法识别出这是故障注入工程。
2. **Redis 统一开关**：所有场景通过 Redis Key 控制启停，Console 管理页面操作 Redis，各服务轮询 Redis 获取指令。
3. **真实故障表现**：不使用 `Thread.sleep()` 或 `SELECT SLEEP(N)` 等人为延迟，所有故障均由真实的数据库行为产生（表锁竞争、大表全表扫描、堆内存持续增长）。
4. **任意节点可触发**：每个场景的控制粒度到服务级别，任何业务节点都可以独立开启/关闭。

---

## 2. 设计原则

1. **伪装原则**：所有注入逻辑在代码层面必须有合理的业务解释。
2. **Redis 驱动**：控制面与数据面分离，Console 只操作 Redis，服务端只读 Redis。
3. **渐进式影响**：故障注入后不是立即崩溃，而是随着正常流量进入逐步体现（延迟上升 → 超时增多 → 级联失败）。
4. **可逆性**：所有场景都可以通过 Redis Key 立即关闭恢复。
5. **可观测性**：故障现象必须体现在 Prometheus 指标、Grafana 面板、Loki 日志、Tempo 链路上。

---

## 3. 场景一：表锁阻塞（原"死锁"场景）

### 3.1 设计思路

通过一个看似正常的"数据审计" API，对用户选中的业务表执行 `LOCK TABLES <table> WRITE`，持有表级写锁。后续所有业务流量对该表的 **读写** 操作都会被阻塞，直到 `innodb_lock_wait_timeout`（默认 50s）超时抛出异常。

**伪装身份**：数据一致性审计服务 — 在正常业务系统中，DBA 或运维定期对关键表执行一致性校验是合理行为。

**故障链路**：
```
Console 开启 → Redis flag 写入 → API 调用目标服务 → LOCK TABLES 
→ 正常流量进入 → 写操作阻塞 → Lock wait timeout 
→ 订单创建失败 / 支付超时 → 级联告警
```

### 3.2 可锁定的表

| 表名 | 所属服务 | 锁定后影响 |
|------|---------|-----------|
| `orders` | order-service | 订单无法创建 / 更新，下单链路全部超时 |
| `payments` | payment-service | 支付无法处理，订单卡在 PENDING 状态 |
| `inventories` | inventory-service | 库存无法预占 / 释放，下单失败 |
| `fulfillments` | fulfillment-service | 履约单无法创建，发货链路中断 |
| `notification_logs` | notification-service | 通知无法写入，通知队列积压 |
| `risk_events` | risk-service | 风控事件无法记录，风控判断异常 |
| `promotions` | promotion-service | 促销规则无法更新 |

### 3.3 Redis Key 设计

```
Key:    castrel:maintenance:lock-audit
Type:   Hash
Fields:
  - active        : "true" | "false"
  - targetTable   : "orders" | "payments" | ...
  - targetService : "order-service" | "payment-service" | ...
  - startedAt     : ISO 8601 时间戳
  - durationSec   : 自动释放时间（秒），0 = 手动释放
  - operator      : 操作人标识
```

### 3.4 API 设计

每个可被锁定表的服务暴露如下"数据审计"API（看起来完全正常）：

```
POST /internal/maintenance/data-audit/start
请求体:
{
  "tableName": "orders",
  "auditType": "FULL_CONSISTENCY",
  "estimatedDurationSec": 300
}

响应:
{
  "code": 0,
  "message": "Data audit started",
  "data": {
    "auditId": "AUD-20260420-001",
    "tableName": "orders",
    "status": "RUNNING",
    "startedAt": "2026-04-20T10:00:00Z"
  }
}

POST /internal/maintenance/data-audit/stop
响应:
{
  "code": 0,
  "message": "Data audit completed",
  "data": {
    "auditId": "AUD-20260420-001",
    "tableName": "orders",
    "status": "COMPLETED",
    "duration": "5m 30s"
  }
}

GET /internal/maintenance/data-audit/status
响应:
{
  "code": 0,
  "data": {
    "active": true,
    "tableName": "orders",
    "status": "RUNNING",
    "startedAt": "2026-04-20T10:00:00Z",
    "holdingDuration": "2m 15s"
  }
}
```

### 3.5 服务端实现

**类命名**：`DataAuditService`（非 ChaosXxx）

```java
@Service
public class DataAuditService {

    private final DataSource dataSource;
    private final StringRedisTemplate redisTemplate;
    private volatile Connection lockConnection;
    private volatile boolean auditing = false;
    private Thread pollThread;

    /**
     * 启动数据审计（实际执行表级锁定）
     */
    public void startAudit(String tableName, int durationSec) {
        if (auditing) throw new BizException("AUDIT_ALREADY_RUNNING");

        auditing = true;
        // 1. 从 DataSource 获取一个独立连接（不归还连接池）
        lockConnection = dataSource.getConnection();
        lockConnection.setAutoCommit(false);

        // 2. 执行表级写锁
        Statement stmt = lockConnection.createStatement();
        stmt.execute("LOCK TABLES " + tableName + " WRITE");

        // 3. 启动后台轮询线程，检查 Redis 是否需要释放
        pollThread = new Thread(() -> {
            while (auditing) {
                try {
                    Thread.sleep(2000); // 每 2 秒检查一次
                    String active = redisTemplate.opsForHash()
                        .get("castrel:maintenance:lock-audit", "active");
                    if (!"true".equals(active)) {
                        stopAudit();
                        return;
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }, "data-audit-poll");
        pollThread.setDaemon(true);
        pollThread.start();

        // 4. 如果设置了 durationSec，注册定时自动释放
        if (durationSec > 0) {
            scheduler.schedule(this::stopAudit, durationSec, TimeUnit.SECONDS);
        }
    }

    /**
     * 停止审计（释放表锁）
     */
    public synchronized void stopAudit() {
        if (!auditing) return;
        auditing = false;
        try {
            Statement stmt = lockConnection.createStatement();
            stmt.execute("UNLOCK TABLES");
            lockConnection.close();
        } catch (SQLException e) {
            log.warn("Failed to unlock tables", e);
        }
        // 更新 Redis 状态
        redisTemplate.opsForHash().put(
            "castrel:maintenance:lock-audit", "active", "false");
    }
}
```

### 3.6 Console 操作流程

```
1. 用户在 Console 选择"数据一致性审计"
2. 选择目标表（orders / payments / ...）
3. 设置持续时间（可选）
4. 点击"开始审计"
   → Console 写入 Redis Hash
   → Console 调用目标服务 POST /internal/maintenance/data-audit/start
5. 点击"停止审计"
   → Console 更新 Redis Hash active=false
   → 或调用 POST /internal/maintenance/data-audit/stop
```

### 3.7 故障表现与排查路径

| 现象 | 指标 / 日志 | 排查方向（训练目标） |
|------|------------|-------------------|
| 订单创建超时 | `http_server_requests_seconds{uri="/api/orders"}` P99 飙升 | 慢查询日志 → `LOCK TABLES` |
| MySQL Lock wait timeout | `show processlist` 显示大量 `Waiting for table lock` | `SHOW OPEN TABLES WHERE In_use > 0` |
| 级联超时 | Tempo 链路显示 order-service 耗时极长 | 定位到 orders 表被锁 |
| 错误率上升 | `orders_create_total{result="error"}` counter 上升 | 错误日志中出现 `Lock wait timeout exceeded` |

---

## 4. 场景二：慢 SQL（大表 JOIN 全表扫描）

### 4.1 设计思路

新增 **2 张业务含义合理的大表**，每张表 **≥ 3000 万行**数据。通过 Redis 控制，让业务 SQL 动态 JOIN 这些大表。由于大表数据量巨大且在特定条件下无法走索引，产生真实的全表扫描和慢查询。

**训练价值**：
- **无索引表**：训练学员识别缺失索引，手动添加索引优化
- **有索引但被破坏**：训练学员识别索引失效（函数包裹、隐式类型转换），重写 SQL 让查询走索引

### 4.2 大表设计

#### 表一：`product_price_history`（有索引）

商品价格变更历史 — 电商系统中非常合理的表，记录每次调价。

```sql
CREATE TABLE IF NOT EXISTS product_price_history (
    id              BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sku             VARCHAR(32)     NOT NULL,
    previous_price  DECIMAL(10,2)   NOT NULL,
    current_price   DECIMAL(10,2)   NOT NULL,
    change_reason   VARCHAR(64)     NOT NULL COMMENT 'PROMOTION / COST_ADJUST / SEASONAL / MANUAL',
    operator_id     BIGINT          NOT NULL DEFAULT 0,
    effective_at    DATETIME        NOT NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='商品价格变更历史';
```

**索引情况**：`idx_sku (sku)` — 有索引，但注入时通过函数包裹破坏索引使用。

#### 表二：`user_behavior_log`（无索引）

用户行为日志 — 记录用户浏览、点击、加购等行为，电商标配数据。

```sql
CREATE TABLE IF NOT EXISTS user_behavior_log (
    id              BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT          NOT NULL,
    action_type     VARCHAR(32)     NOT NULL COMMENT 'PAGE_VIEW / ADD_CART / PLACE_ORDER / SEARCH',
    target_id       VARCHAR(64)     NOT NULL COMMENT '目标对象ID（商品SKU/订单号等）',
    target_type     VARCHAR(32)     NOT NULL COMMENT 'PRODUCT / ORDER / CATEGORY',
    ip_address      VARCHAR(45),
    session_id      VARCHAR(64),
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='用户行为日志';
```

**索引情况**：仅有主键，无业务索引。这是一个常见的反模式 — 日志表忘记加索引。

### 4.3 数据填充策略

由 `traffic-control-plane` 负责在启动后台线程持续写入数据：

```java
@Service
public class DataWarmupService {

    private static final int TARGET_ROWS = 30_000_000;
    private static final int BATCH_SIZE = 5000;

    @PostConstruct
    public void init() {
        Thread warmup = new Thread(this::fillTables, "data-warmup");
        warmup.setDaemon(true);
        warmup.start();
    }

    private void fillTables() {
        long priceHistoryCount = countTable("product_price_history");
        long behaviorLogCount = countTable("user_behavior_log");

        // 填充 product_price_history
        while (priceHistoryCount < TARGET_ROWS) {
            insertPriceHistoryBatch(BATCH_SIZE);
            priceHistoryCount += BATCH_SIZE;
            logProgress("product_price_history", priceHistoryCount);
        }

        // 填充 user_behavior_log
        while (behaviorLogCount < TARGET_ROWS) {
            insertBehaviorLogBatch(BATCH_SIZE);
            behaviorLogCount += BATCH_SIZE;
            logProgress("user_behavior_log", behaviorLogCount);
        }

        log.info("Data warmup completed: both tables >= {} rows", TARGET_ROWS);
    }
}
```

**数据生成规则**：
- `product_price_history`：
  - `sku`：从 50 个 SKU 中随机选取（与 products 表一致）
  - `previous_price` / `current_price`：原价 ± 随机浮动 5%-20%
  - `change_reason`：随机选择 `PROMOTION / COST_ADJUST / SEASONAL / MANUAL`
  - `effective_at`：过去 3 年内的随机时间
- `user_behavior_log`：
  - `user_id`：1-20 随机
  - `action_type`：`PAGE_VIEW(60%) / ADD_CART(20%) / PLACE_ORDER(15%) / SEARCH(5%)`
  - `target_id`：SKU 或 order_no 随机
  - `ip_address`：随机内网 IP
  - `session_id`：UUID

**预计填充时间**：约 30-60 分钟（取决于机器性能），后台静默执行，不影响业务启动。

### 4.4 Redis Key 设计

```
Key:    castrel:query:enrichment
Type:   Hash
Fields:
  - enabled       : "true" | "false"
  - joinTable     : "user_behavior_log" | "product_price_history"
  - targetServices: "order-service,payment-service,catalog-service"  （逗号分隔，空 = 全部）
  - operator      : 操作人标识
  - startedAt     : ISO 8601
```

### 4.5 业务 SQL 注入逻辑

每个服务的数据访问层（Repository / Mapper）中增加"数据增强查询"逻辑：

**类命名**：`QueryEnrichmentInterceptor`

```java
@Component
public class QueryEnrichmentInterceptor {

    private final StringRedisTemplate redisTemplate;
    private final String serviceName;

    // 本地缓存，避免每次请求都访问 Redis（5 秒刷新）
    private volatile EnrichmentConfig cachedConfig;
    private volatile long lastRefresh = 0;
    private static final long REFRESH_INTERVAL_MS = 5000;

    /**
     * 判断当前请求是否需要 JOIN 大表
     */
    public boolean shouldEnrich() {
        refreshConfigIfNeeded();
        if (cachedConfig == null || !cachedConfig.enabled) return false;
        // 检查当前服务是否在目标列表中
        if (cachedConfig.targetServices.isEmpty()) return true;
        return cachedConfig.targetServices.contains(serviceName);
    }

    /**
     * 返回需要 JOIN 的表名
     */
    public String getJoinTable() {
        return cachedConfig != null ? cachedConfig.joinTable : null;
    }

    private void refreshConfigIfNeeded() {
        long now = System.currentTimeMillis();
        if (now - lastRefresh < REFRESH_INTERVAL_MS) return;
        lastRefresh = now;

        Map<Object, Object> hash = redisTemplate.opsForHash()
            .entries("castrel:query:enrichment");
        if (hash.isEmpty()) {
            cachedConfig = null;
            return;
        }
        cachedConfig = new EnrichmentConfig(
            "true".equals(hash.get("enabled")),
            (String) hash.get("joinTable"),
            parseServiceList((String) hash.get("targetServices"))
        );
    }
}
```

### 4.6 JOIN SQL 示例

#### 场景 A：JOIN `user_behavior_log`（无索引，全表扫描）

```sql
-- 原始 SQL（order-service 查询订单）：
SELECT * FROM orders WHERE user_id = ? AND status = 'PENDING'

-- 注入后（JOIN 无索引大表）：
SELECT o.* FROM orders o
  JOIN user_behavior_log ubl ON ubl.user_id = o.user_id
WHERE o.user_id = ?
  AND o.status = 'PENDING'
  AND ubl.action_type = 'PLACE_ORDER'
ORDER BY ubl.created_at DESC
LIMIT 1
```

**慢查询原因**：`user_behavior_log` 无 `user_id` 索引，3000 万行全表扫描。

**优化方案**（训练目标）：
```sql
ALTER TABLE user_behavior_log ADD INDEX idx_user_action (user_id, action_type);
```

#### 场景 B：JOIN `product_price_history`（有索引但被破坏）

```sql
-- 原始 SQL（catalog-service 查询商品）：
SELECT * FROM products WHERE sku = ? AND status = 1

-- 注入后（JOIN 有索引大表，但函数包裹破坏索引）：
SELECT p.* FROM products p
  JOIN product_price_history pph ON CONCAT(pph.sku, '') = p.sku
WHERE p.sku = ?
  AND p.status = 1
  AND pph.effective_at <= NOW()
ORDER BY pph.effective_at DESC
LIMIT 1
```

**慢查询原因**：`CONCAT(pph.sku, '')` 对 `sku` 列使用了函数包裹，MySQL 无法使用 `idx_sku` 索引，退化为全表扫描。

**优化方案**（训练目标）：
```sql
-- 移除函数包裹，让 MySQL 走索引
SELECT p.* FROM products p
  JOIN product_price_history pph ON pph.sku = p.sku
WHERE p.sku = ?
  AND p.status = 1
  AND pph.effective_at <= NOW()
ORDER BY pph.effective_at DESC
LIMIT 1
```

### 4.7 各服务 JOIN 点

| 服务 | 原始查询场景 | JOIN 表 | 注入 SQL 逻辑 |
|------|------------|---------|-------------|
| order-service | 创建订单时查询用户历史 | `user_behavior_log` | `JOIN ubl ON ubl.user_id = o.user_id WHERE ubl.action_type = 'PLACE_ORDER'` |
| payment-service | 扣款前校验用户行为 | `user_behavior_log` | `JOIN ubl ON ubl.user_id = p.user_id WHERE ubl.action_type = 'PLACE_ORDER'` |
| catalog-service | 查询商品含价格变更 | `product_price_history` | `JOIN pph ON CONCAT(pph.sku,'') = p.sku` |
| inventory-service | 库存预占时关联价格 | `product_price_history` | `JOIN pph ON CONCAT(pph.sku,'') = i.sku` |
| promotion-service | 计算优惠时关联价格 | `product_price_history` | `JOIN pph ON CONCAT(pph.sku,'') = ?` |
| risk-service | 风控时查询用户行为 | `user_behavior_log` | `JOIN ubl ON ubl.user_id = ? WHERE ubl.action_type = 'PLACE_ORDER'` |
| fulfillment-service | 创建履约单时查行为 | `user_behavior_log` | `JOIN ubl ON ubl.user_id = f.user_id` |
| notification-service | 发送通知前查行为 | `user_behavior_log` | `JOIN ubl ON ubl.user_id = n.user_id` |

### 4.8 故障表现与排查路径

| 现象 | 指标 / 工具 | 排查方向（训练目标） |
|------|------------|-------------------|
| 接口响应时间从 50ms 飙升到 10s+ | Grafana HTTP Duration 面板 | 定位到哪个服务变慢 |
| MySQL 慢查询日志出现大量 JOIN | `slow_query_log` | `EXPLAIN` 分析执行计划 |
| `EXPLAIN` 显示 `type=ALL` 全表扫描 | MySQL EXPLAIN | 识别缺失索引 / 索引失效 |
| CPU 占用率飙升 | `node_cpu_seconds_total` | MySQL 全表扫描消耗 CPU |
| 连接池耗尽 | HikariCP metrics | 慢查询占用连接不释放 |

---

## 5. 场景三：内存泄漏（无淘汰缓存）

### 5.1 设计思路

伪装成一个"查询结果本地缓存"服务，当 Redis 开关打开时，每次业务请求的查询结果都会被缓存到一个 `ConcurrentHashMap` 中，**但没有实现淘汰策略**（模拟开发者忘记添加 TTL / LRU 淘汰的真实 Bug）。

随着业务流量持续进入，缓存不断膨胀，JVM 堆内存持续上升，最终导致：
- Full GC 频繁，STW 暂停增加
- 接口响应时间 P95 / P99 上升
- 达到 `-Xmx` 上限后 OOM

**伪装身份**：查询结果缓存层 — 在业务系统中添加本地缓存是非常常见的"性能优化"手段。

### 5.2 Redis Key 设计

```
Key:    castrel:cache:local-buffer
Type:   Hash
Fields:
  - enabled        : "true" | "false"
  - targetServices : "order-service,payment-service"  （逗号分隔，空 = 全部）
  - bufferSizeKb   : 每次缓存条目大小（KB），默认 8，用于控制泄漏速度
  - operator       : 操作人标识
  - startedAt      : ISO 8601
```

### 5.3 服务端实现

**类命名**：`LocalQueryCacheManager`（不是 MemoryLeakXxx）

```java
@Component
public class LocalQueryCacheManager {

    /**
     * 本地查询缓存 —— 用于"加速"热点查询结果
     * 注意：当前版本未实现淘汰策略（已提交优化 Ticket #PERF-2341）
     */
    private final ConcurrentHashMap<String, byte[]> queryCache = new ConcurrentHashMap<>();

    private final StringRedisTemplate redisTemplate;
    private final String serviceName;
    private volatile CachePolicy cachedPolicy;
    private volatile long lastRefresh = 0;

    /**
     * 业务层调用：缓存查询结果以提升后续查询性能
     */
    public void cacheIfNeeded(String queryKey, Object result) {
        refreshPolicyIfNeeded();
        if (cachedPolicy == null || !cachedPolicy.enabled) return;
        if (!cachedPolicy.targetServices.isEmpty()
            && !cachedPolicy.targetServices.contains(serviceName)) return;

        // 序列化结果 + 填充至指定大小
        byte[] data = serialize(result, cachedPolicy.bufferSizeKb);
        String cacheKey = queryKey + ":" + UUID.randomUUID(); // 每次生成新 key，永不覆盖
        queryCache.put(cacheKey, data);
    }

    /**
     * 获取缓存统计（供 actuator 暴露）
     */
    public CacheStats getStats() {
        long totalBytes = queryCache.values().stream()
            .mapToLong(b -> b.length).sum();
        return new CacheStats(
            queryCache.size(),
            totalBytes / 1024 / 1024  // MB
        );
    }

    /**
     * 清空缓存（手动运维操作）
     */
    public void evictAll() {
        queryCache.clear();
        // 提示 JVM 进行 GC
        System.gc();
    }

    private byte[] serialize(Object result, int sizeKb) {
        // 序列化 result，并填充至 sizeKb 大小
        byte[] serialized = objectMapper.writeValueAsBytes(result);
        if (serialized.length >= sizeKb * 1024) return serialized;
        byte[] padded = new byte[sizeKb * 1024];
        System.arraycopy(serialized, 0, padded, 0, serialized.length);
        return padded;
    }
}
```

### 5.4 业务集成点

每个服务在关键查询返回后调用缓存：

```java
// OrderService.java
public Order getOrder(String orderNo) {
    Order order = orderRepository.findByOrderNo(orderNo);
    // "缓存查询结果以提升性能"
    localQueryCacheManager.cacheIfNeeded("order:" + orderNo, order);
    return order;
}
```

**注入的表象**：代码看起来完全正常 — 就是一个查询结果缓存层，但因为 key 使用了 UUID 后缀（`queryKey + ":" + UUID`），永远不会命中已有缓存，每次都产生新条目，且永不淘汰。

### 5.5 故障表现与排查路径

| 现象 | 指标 / 工具 | 排查方向（训练目标） |
|------|------------|-------------------|
| JVM Heap Used 持续上升不回落 | `jvm_memory_used_bytes{area="heap"}` | Heap Dump 分析 |
| Full GC 频率增加 | `jvm_gc_pause_seconds_count{action="end of major GC"}` | GC 日志分析 |
| 接口 P99 延迟上升 | `http_server_requests_seconds` P99 | 关联 GC 暂停时间 |
| OOM Killer | 容器被杀 / JVM 退出 | Heap Dump → MAT 分析 → 定位 `ConcurrentHashMap` 占用 |
| 对象数量持续增长 | `jmap -histo` 输出 `byte[]` 对象大量增加 | 定位 `LocalQueryCacheManager` |

### 5.6 JVM 参数配置

```yaml
# docker-compose.yml 中相关服务的 JAVA_TOOL_OPTIONS
# Kubernetes 中也可继续使用 JAVA_OPTS，入口脚本会透传并补齐通用默认项
JAVA_TOOL_OPTIONS: >-
  -Xms256m -Xmx256m
  -Dfile.encoding=UTF-8
  -Dsun.jnu.encoding=UTF-8
  -Djava.security.egd=file:/dev/./urandom
  -XX:+UseContainerSupport
  -XX:+UseG1GC
  -XX:+UseStringDeduplication
  -XX:+ParallelRefProcEnabled
  -XX:MaxGCPauseMillis=200
  -XX:InitialRAMPercentage=25.0
  -XX:MinRAMPercentage=25.0
  -XX:MaxRAMPercentage=75.0
```

### 5.7 管理 API

```
POST /internal/cache/local/evict-all
说明：清空本地查询缓存（运维操作）
响应：{ "code": 0, "data": { "evictedEntries": 12580, "freedMb": 98 } }

GET /internal/cache/local/stats
说明：查看本地缓存统计
响应：{ "code": 0, "data": { "entryCount": 12580, "holdingMb": 98, "serviceName": "order-service" } }
```

---

## 6. Redis Key 汇总

| Key | 场景 | 数据类型 | 说明 |
|-----|------|---------|------|
| `castrel:maintenance:lock-audit` | 表锁阻塞 | Hash | 表锁审计开关与配置 |
| `castrel:query:enrichment` | 慢 SQL | Hash | 大表 JOIN 开关与配置 |
| `castrel:cache:local-buffer` | 内存泄漏 | Hash | 本地缓存开关与配置 |

所有 Key 使用 `castrel:` 前缀，符合项目统一命名。

---

## 7. 数据库变更

### 7.1 新增表

在 `infra/mysql/init/00-schema.sql` 中追加：

```sql
-- =============================================================================
-- 商品价格变更历史（慢 SQL 场景用）
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_price_history (
    id              BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sku             VARCHAR(32)     NOT NULL,
    previous_price  DECIMAL(10,2)   NOT NULL,
    current_price   DECIMAL(10,2)   NOT NULL,
    change_reason   VARCHAR(64)     NOT NULL COMMENT 'PROMOTION / COST_ADJUST / SEASONAL / MANUAL',
    operator_id     BIGINT          NOT NULL DEFAULT 0,
    effective_at    DATETIME        NOT NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='商品价格变更历史';

-- =============================================================================
-- 用户行为日志（慢 SQL 场景用）
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_behavior_log (
    id              BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT          NOT NULL,
    action_type     VARCHAR(32)     NOT NULL COMMENT 'PAGE_VIEW / ADD_CART / PLACE_ORDER / SEARCH',
    target_id       VARCHAR(64)     NOT NULL,
    target_type     VARCHAR(32)     NOT NULL COMMENT 'PRODUCT / ORDER / CATEGORY',
    ip_address      VARCHAR(45),
    session_id      VARCHAR(64),
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='用户行为日志';
```

### 7.2 相关表处理

当前实现不依赖以下历史表，可保留但不参与现行注入流程：

| 表名 | 说明 |
|------|------|
| `chaos_switch` | 被 Redis Key 替代 |
| `chaos_event_log` | 可保留作为审计日志，但不再由注入逻辑写入 |

---

## 8. 代码变更清单

### 8.1 需要移除或调整的文件

| 原路径 | 操作 | 新路径 / 说明 |
|--------|------|-------------|
| `common/.../chaos/SlowSqlChaosService.java` | 删除 | 由 `QueryEnrichmentInterceptor` 替代 |
| `common/.../chaos/MemoryLeakChaosService.java` | 删除 | 由 `LocalQueryCacheManager` 替代 |
| `common/.../ChaosScope.java` | 删除 | 不再需要 |
| `common/.../config/ChaosCommonAutoConfiguration.java` | 重写 | 注册 v2 组件 |
| `common/.../config/ChaosJdbcAutoConfiguration.java` | 删除 | JDBC 层不再需要拦截 |
| `common/.../config/ChaosRedisAutoConfiguration.java` | 删除 | Redis 层不再需要拦截 |
| 各服务 `ChaosController.java` | 重写 | 拆分为 `DataAuditController` + `CacheManagementController` |
| `order-service/.../chaos/OrderDeadlockChaosService.java` | 删除 | 由 `DataAuditService` 替代 |
| `payment-service/.../chaos/DeadlockChaosService.java` | 删除 | 由 `DataAuditService` 替代 |

### 8.2 新增文件

| 路径 | 说明 |
|------|------|
| `common/.../interceptor/QueryEnrichmentInterceptor.java` | 慢 SQL JOIN 拦截器 |
| `common/.../cache/LocalQueryCacheManager.java` | 内存泄漏缓存管理 |
| `common/.../config/ServiceComponentAutoConfiguration.java` | 自动注册 v2 组件 |
| 各服务 `MaintenanceController.java` | 数据审计 API（表锁场景） |
| 各服务 `CacheManagementController.java` | 缓存管理 API（内存泄漏场景） |
| `traffic-control-plane/.../service/DataWarmupService.java` | 大表数据填充服务 |

---

## 9. Console 管理页面设计

### 9.1 场景面板

```
┌──────────────────────────────────────────────────────────┐
│  故障场景管理                                              │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────┐  ┌─────────────────────┐       │
│  │ 📊 表锁阻塞          │  │ 🐌 慢 SQL            │       │
│  │                     │  │                     │       │
│  │ 目标表: [orders ▼]  │  │ JOIN 表:             │       │
│  │ 持续时间: [300] 秒   │  │ ○ user_behavior_log  │       │
│  │                     │  │   (无索引，全表扫描)   │       │
│  │ [🟢 开启] [⬜ 关闭]  │  │ ○ product_price_     │       │
│  │                     │  │   history             │       │
│  │ 状态: 未运行         │  │   (有索引，索引失效)   │       │
│  └─────────────────────┘  │                     │       │
│                           │ 目标服务:             │       │
│  ┌─────────────────────┐  │ ☑ order-service      │       │
│  │ 💾 内存泄漏          │  │ ☑ payment-service    │       │
│  │                     │  │ ☑ catalog-service    │       │
│  │ 目标服务:            │  │ ☐ ...               │       │
│  │ ☑ order-service     │  │                     │       │
│  │ ☑ payment-service   │  │ [🟢 开启] [⬜ 关闭]  │       │
│  │ 缓冲大小: [8] KB    │  │                     │       │
│  │                     │  │ 状态: 未运行         │       │
│  │ [🟢 开启] [⬜ 关闭]  │  └─────────────────────┘       │
│  │                     │                                │
│  │ 状态: 未运行         │                                │
│  │ 堆占用: 0 MB         │                                │
│  └─────────────────────┘                                │
│                                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │ 📈 数据填充进度                                │       │
│  │ product_price_history: 18,234,000 / 30,000,000│       │
│  │ user_behavior_log:     22,100,000 / 30,000,000│       │
│  │ [████████████████░░░░░] 67%                   │       │
│  └──────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

### 9.2 Console API（供前端调用）

Console 后端 API 建议放在 `traffic-control-plane`（已有控制面板职能）：

```
-- 表锁阻塞
POST   /internal/runner/scenario/table-lock/enable
       Body: { "targetTable": "orders", "targetService": "order-service", "durationSec": 300 }
POST   /internal/runner/scenario/table-lock/disable
GET    /internal/runner/scenario/table-lock/status

-- 慢 SQL
POST   /internal/runner/scenario/slow-query/enable
       Body: { "joinTable": "user_behavior_log", "targetServices": ["order-service","payment-service"] }
POST   /internal/runner/scenario/slow-query/disable
GET    /internal/runner/scenario/slow-query/status

-- 内存泄漏
POST   /internal/runner/scenario/memory-pressure/enable
       Body: { "targetServices": ["order-service"], "bufferSizeKb": 8 }
POST   /internal/runner/scenario/memory-pressure/disable
GET    /internal/runner/scenario/memory-pressure/status

-- 数据填充进度
GET    /internal/runner/data-warmup/progress
```

---

## 10. 服务接入清单

### 10.1 表锁阻塞

| 服务 | 需要的 API | 可锁定的表 |
|------|----------|-----------|
| order-service | `MaintenanceController` + `DataAuditService` | `orders` |
| payment-service | `MaintenanceController` + `DataAuditService` | `payments` |
| inventory-service | `MaintenanceController` + `DataAuditService` | `inventories` |
| fulfillment-service | `MaintenanceController` + `DataAuditService` | `fulfillments` |
| notification-service | `MaintenanceController` + `DataAuditService` | `notification_logs` |
| risk-service | `MaintenanceController` + `DataAuditService` | `risk_events` |
| promotion-service | `MaintenanceController` + `DataAuditService` | `promotions` |

### 10.2 慢 SQL

所有 7 个业务服务均需接入 `QueryEnrichmentInterceptor`，在关键查询路径上添加 JOIN 逻辑。

### 10.3 内存泄漏

所有服务均需接入 `LocalQueryCacheManager`，在关键查询返回后调用 `cacheIfNeeded()`。

---

## 11. 验证方案

### 11.1 表锁阻塞验证

```bash
# 1. 开启 orders 表锁
curl -X POST http://localhost:8086/internal/runner/scenario/table-lock/enable \
  -H 'Content-Type: application/json' \
  -d '{"targetTable":"orders","targetService":"order-service","durationSec":120}'

# 2. 观察 traffic-runner 的订单创建全部超时
# 3. 检查 MySQL: SHOW PROCESSLIST → 大量 Waiting for table lock
# 4. 检查 Grafana: order-service P99 飙升到 50s+
# 5. 120 秒后自动释放，流量恢复

# 手动关闭:
curl -X POST http://localhost:8086/internal/runner/scenario/table-lock/disable
```

### 11.2 慢 SQL 验证

```bash
# 前提：确认数据填充完成
curl http://localhost:8086/internal/runner/data-warmup/progress

# 1. 开启慢 SQL（无索引表）
curl -X POST http://localhost:8086/internal/runner/scenario/slow-query/enable \
  -H 'Content-Type: application/json' \
  -d '{"joinTable":"user_behavior_log","targetServices":["order-service"]}'

# 2. 观察 order-service 响应时间从 ~50ms 飙升到 10s+
# 3. 检查 MySQL 慢查询日志：出现 JOIN user_behavior_log 的全表扫描
# 4. 训练学员执行 EXPLAIN 分析 → 识别缺失索引
# 5. 学员执行: ALTER TABLE user_behavior_log ADD INDEX idx_user_action(user_id, action_type);
# 6. 响应时间恢复正常

# 关闭:
curl -X POST http://localhost:8086/internal/runner/scenario/slow-query/disable
```

### 11.3 内存泄漏验证

```bash
# 1. 开启内存泄漏
curl -X POST http://localhost:8086/internal/runner/scenario/memory-pressure/enable \
  -H 'Content-Type: application/json' \
  -d '{"targetServices":["order-service"],"bufferSizeKb":16}'

# 2. 观察 Grafana JVM Heap Used 持续上升
# 3. 约 5-10 分钟后 Full GC 开始频繁触发
# 4. order-service P99 响应时间随 GC 暂停上升
# 5. 训练学员分析 Heap Dump → 定位 ConcurrentHashMap<String, byte[]> 占大量堆

# 关闭并清理:
curl -X POST http://localhost:8086/internal/runner/scenario/memory-pressure/disable
# 清理缓存:
curl -X POST http://localhost:8084/internal/cache/local/evict-all
```

---

## 12. 安全与注意事项

1. **表锁持续时间限制**：`durationSec` 最大值建议限制为 600 秒，防止遗忘导致长期锁表。
2. **大表数据磁盘占用**：2 × 30M 行预计占用 ~10 GB 磁盘，需确保 MySQL 数据卷有足够空间。
3. **内存泄漏 maxHeap 保护**：`-Xmx` 必须设置合理上限，并启用 `HeapDumpOnOutOfMemoryError`。
4. **连接泄漏防护**：`DataAuditService` 持有的独立连接必须在 JVM shutdown hook 中释放。
5. **Redis 可用性**：如果 Redis 不可用，所有场景的 `shouldXxx()` 检查应默认返回 `false`（fail-safe）。

