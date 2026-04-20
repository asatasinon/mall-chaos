# Task 14 — v2 公共模块：隐蔽式故障注入组件

**阶段**：Phase 3 — Chaos 功能（v2 改版）  
**依赖**：Task 01（common 模块）、Task 02（Redis / MySQL 基础设施）  
**产出**：`common` 模块中的 3 个核心组件 + 数据库 DDL 变更 + Redis Key 规范  
**设计文档**：[chaos-v2.md](../plans/chaos-v2.md)

---

## 目标

在 `common` 模块中实现 v2 隐蔽式故障注入的 3 个核心公共组件，替代 v1 的 `SlowSqlChaosService`、`MemoryLeakChaosService`、`DeadlockChaosService`。所有组件命名不包含任何 chaos 字样，以正常业务逻辑命名。

### 核心约束

1. 代码中零 chaos 痕迹 — 类名、方法名、日志、注释均使用业务化命名
2. 所有组件通过 Redis Hash 读取开关状态（只读），不使用特殊 Spring Profile
3. Redis 不可用时默认关闭注入（fail-safe）
4. 组件以 Spring Boot Auto-Configuration 自动注册

---

## 子任务

### 14.1 清理 v1 Chaos 代码

从 `common` 模块中移除以下 v1 文件：

| 文件 | 操作 |
|------|------|
| `common/.../chaos/SlowSqlChaosService.java` | 删除 |
| `common/.../chaos/MemoryLeakChaosService.java` | 删除 |
| `common/.../ChaosScope.java` | 删除 |
| `common/.../config/ChaosCommonAutoConfiguration.java` | 重写 → `ServiceComponentAutoConfiguration` |
| `common/.../config/ChaosJdbcAutoConfiguration.java` | 删除 |
| `common/.../config/ChaosRedisAutoConfiguration.java` | 删除 |

- [ ] 确保 `common` 模块编译通过（其他服务暂时可以报错，后续 Task 16 修复）

### 14.2 QueryEnrichmentInterceptor（慢 SQL 场景）

**路径**：`common/src/main/java/com/castrel/common/interceptor/QueryEnrichmentInterceptor.java`

```java
@Component
public class QueryEnrichmentInterceptor {

    private final StringRedisTemplate redisTemplate;

    @Value("${spring.application.name}")
    private String serviceName;

    // 本地缓存，避免每次请求都访问 Redis（5 秒刷新）
    private volatile EnrichmentConfig cachedConfig;
    private volatile long lastRefresh = 0;
    private static final long REFRESH_INTERVAL_MS = 5000;
    private static final String REDIS_KEY = "castrel:query:enrichment";

    public boolean shouldEnrich() { ... }
    public String getJoinTable() { ... }
    private void refreshConfigIfNeeded() { ... }
}
```

**`EnrichmentConfig` record**：
```java
public record EnrichmentConfig(
    boolean enabled,
    String joinTable,
    Set<String> targetServices
) {}
```

- [ ] 读取 Redis Hash `castrel:query:enrichment`
- [ ] 本地缓存 5 秒刷新间隔
- [ ] Redis 访问异常时 `shouldEnrich()` 返回 `false`（fail-safe）
- [ ] `targetServices` 为空时匹配所有服务
- [ ] 单元测试覆盖：开关切换、服务过滤、Redis 不可用

### 14.3 DataAuditService（表锁阻塞场景）

**路径**：`common/src/main/java/com/castrel/common/maintenance/DataAuditService.java`

```java
@Service
public class DataAuditService {
    private final DataSource dataSource;
    private final StringRedisTemplate redisTemplate;
    private volatile Connection lockConnection;
    private volatile boolean auditing = false;
    private final ScheduledExecutorService scheduler;

    public void startAudit(String tableName, int durationSec) { ... }
    public synchronized void stopAudit() { ... }
    public DataAuditStatus getStatus() { ... }
}
```

实现要点：
- [ ] 从 `DataSource` 获取独立 `Connection`，不归还连接池
- [ ] 执行 `LOCK TABLES <tableName> WRITE`（白名单校验 tableName，防注入）
- [ ] 后台守护线程每 2 秒轮询 Redis Hash `castrel:maintenance:lock-audit` 的 `active` 字段
- [ ] `active != "true"` 时自动调用 `stopAudit()`
- [ ] `durationSec > 0` 时使用 `ScheduledExecutorService` 注册自动释放
- [ ] `stopAudit()` 执行 `UNLOCK TABLES` + 关闭 Connection
- [ ] JVM Shutdown Hook 确保释放连接
- [ ] `durationSec` 最大值校验 ≤ 600 秒

**tableName 白名单**：
```java
private static final Set<String> ALLOWED_TABLES = Set.of(
    "orders", "payments", "inventories", "fulfillments",
    "notification_logs", "risk_events", "promotions", "coupons"
);
```

**DataAuditStatus DTO**：
```java
public record DataAuditStatus(
    boolean active,
    String tableName,
    String status,       // "RUNNING" | "IDLE"
    String startedAt,
    String holdingDuration
) {}
```

### 14.4 LocalQueryCacheManager（内存泄漏场景）

**路径**：`common/src/main/java/com/castrel/common/cache/LocalQueryCacheManager.java`

```java
@Component
public class LocalQueryCacheManager {

    private final ConcurrentHashMap<String, byte[]> queryCache = new ConcurrentHashMap<>();
    private final StringRedisTemplate redisTemplate;

    @Value("${spring.application.name}")
    private String serviceName;

    private volatile CachePolicy cachedPolicy;
    private volatile long lastRefresh = 0;
    private static final String REDIS_KEY = "castrel:cache:local-buffer";

    public void cacheIfNeeded(String queryKey, Object result) { ... }
    public CacheStats getStats() { ... }
    public CacheStats evictAll() { ... }
}
```

实现要点：
- [ ] 读取 Redis Hash `castrel:cache:local-buffer`（5 秒刷新间隔）
- [ ] `cacheIfNeeded()` 被调用时：序列化 result → 填充至 `bufferSizeKb` 大小 → 以 `queryKey + ":" + UUID` 为 key 存入 Map
- [ ] key 中包含 UUID 后缀确保永不覆盖已有条目
- [ ] `getStats()` 返回条目数和总占用 MB
- [ ] `evictAll()` 清空 Map + `System.gc()` + 返回清理前统计
- [ ] Redis 不可用时默认不缓存（fail-safe）

**CachePolicy record**：
```java
public record CachePolicy(
    boolean enabled,
    Set<String> targetServices,
    int bufferSizeKb
) {}
```

**CacheStats record**：
```java
public record CacheStats(
    int entryCount,
    long holdingMb
) {}
```

### 14.5 ServiceComponentAutoConfiguration

**路径**：`common/src/main/java/com/castrel/common/config/ServiceComponentAutoConfiguration.java`

```java
@Configuration
@ConditionalOnBean(StringRedisTemplate.class)
@ComponentScan(basePackages = {
    "com.castrel.common.interceptor",
    "com.castrel.common.maintenance",
    "com.castrel.common.cache"
})
public class ServiceComponentAutoConfiguration {
}
```

- [ ] 注册到 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`
- [ ] 仅当 Redis 可用时激活
- [ ] 替代原有 `ChaosCommonAutoConfiguration`

### 14.6 数据库 DDL 变更

在 `infra/mysql/init/00-schema.sql` 末尾追加 2 张大表的建表语句：

```sql
-- =============================================================================
-- 商品价格变更历史
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
-- 用户行为日志
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

- [ ] `product_price_history` 仅有 `idx_sku (sku)` 索引
- [ ] `user_behavior_log` 无任何业务索引（仅主键）
- [ ] 注释中不出现 chaos / 注入等字样

### 14.7 Redis Key 规范

| Key | 数据类型 | 场景 | 字段 |
|-----|---------|------|------|
| `castrel:maintenance:lock-audit` | Hash | 表锁阻塞 | `active`, `targetTable`, `targetService`, `startedAt`, `durationSec`, `operator` |
| `castrel:query:enrichment` | Hash | 慢 SQL | `enabled`, `joinTable`, `targetServices`, `operator`, `startedAt` |
| `castrel:cache:local-buffer` | Hash | 内存泄漏 | `enabled`, `targetServices`, `bufferSizeKb`, `operator`, `startedAt` |

### 14.8 v1 表处理

| 表名 | 处理方式 |
|------|---------|
| `chaos_switch` | 保留但不再使用，不影响业务 |
| `chaos_event_log` | 保留但不再由注入逻辑写入 |

### 14.9 验证

- [ ] `common` 模块 `mvn clean compile` 通过
- [ ] 三个组件的单元测试全部通过
- [ ] `DataAuditService` 的 tableName 白名单校验测试：非法表名应抛异常
- [ ] Redis 不可用时三个组件均正常工作（不注入）
