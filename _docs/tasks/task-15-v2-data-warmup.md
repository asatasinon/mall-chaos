# Task 15 — v2 大表数据填充服务

**阶段**：Phase 3 — Chaos 功能（v2 改版）  
**依赖**：Task 14（DDL 建表）、Task 09（traffic-runner-service）  
**产出**：`DataWarmupService` — 在 `traffic-runner-service` 中后台填充 2 张大表至 ≥ 3000 万行  
**设计文档**：[chaos-v2.md](../plans/chaos-v2.md) §4.3

---

## 目标

在 `traffic-runner-service` 中实现后台数据填充服务，项目启动后自动以后台线程方式向 `product_price_history` 和 `user_behavior_log` 两张表持续写入数据，直到每张表 ≥ 3000 万行。

填充过程不影响正常业务流量，完全静默执行。

---

## 子任务

### 15.1 DataWarmupService 设计

**路径**：`traffic-runner-service/src/main/java/com/castrel/runner/service/DataWarmupService.java`

```java
@Service
public class DataWarmupService {

    private static final int TARGET_ROWS = 30_000_000;
    private static final int BATCH_SIZE = 5000;
    private static final long LOG_INTERVAL = 100_000; // 每 10 万条日志一次

    private final JdbcTemplate jdbcTemplate;
    private volatile WarmupProgress progress;
    private volatile boolean running = false;

    @PostConstruct
    public void init() {
        Thread warmup = new Thread(this::fillTables, "data-warmup");
        warmup.setDaemon(true);
        warmup.start();
    }

    public WarmupProgress getProgress() { return progress; }
}
```

- [ ] `@PostConstruct` 启动守护线程
- [ ] 每轮 batch insert 后 `Thread.yield()`，避免抢占业务 CPU
- [ ] 异常时 sleep 5 秒后重试，不中断填充
- [ ] 填充完毕后设置 `running = false`，线程退出

### 15.2 product_price_history 数据生成

每条记录的字段生成规则：

| 字段 | 生成规则 |
|------|---------|
| `sku` | 从 `SKU-001` ~ `SKU-050` 中随机选取 |
| `previous_price` | 该 SKU 的基础价格（来自 products 表） |
| `current_price` | `previous_price × (1 ± random(0.05, 0.20))`，保留 2 位小数 |
| `change_reason` | 随机选择：`PROMOTION`(40%) / `COST_ADJUST`(25%) / `SEASONAL`(25%) / `MANUAL`(10%) |
| `operator_id` | 随机 1-10 |
| `effective_at` | 过去 3 年内随机时间：`NOW() - random(0, 3*365*24*3600) 秒` |

**Batch Insert SQL**：
```sql
INSERT INTO product_price_history (sku, previous_price, current_price, change_reason, operator_id, effective_at)
VALUES (?,?,?,?,?,?), (?,?,?,?,?,?), ...
-- 每批 5000 条
```

- [ ] 使用 `JdbcTemplate.batchUpdate()` 批量写入
- [ ] 预加载 products 表的 SKU→price 映射
- [ ] 生成数据保持合理分布

### 15.3 user_behavior_log 数据生成

| 字段 | 生成规则 |
|------|---------|
| `user_id` | 随机 1-20 |
| `action_type` | 加权随机：`PAGE_VIEW`(60%) / `ADD_CART`(20%) / `PLACE_ORDER`(15%) / `SEARCH`(5%) |
| `target_id` | `PAGE_VIEW/ADD_CART/SEARCH` → 随机 SKU；`PLACE_ORDER` → 随机生成 order_no 格式 |
| `target_type` | 根据 action_type 对应：`PRODUCT` / `ORDER` / `CATEGORY` |
| `ip_address` | `10.0.` + random(0,255) + `.` + random(1,254) |
| `session_id` | `UUID.randomUUID().toString()` |
| `created_at` | 过去 1 年内随机时间 |

- [ ] 批量 5000 条写入
- [ ] `action_type` 分布与电商用户行为特征一致

### 15.4 进度跟踪

**WarmupProgress DTO**：
```java
public record WarmupProgress(
    long priceHistoryCount,
    long priceHistoryTarget,
    long behaviorLogCount,
    long behaviorLogTarget,
    boolean completed,
    String status  // "FILLING_PRICE_HISTORY" | "FILLING_BEHAVIOR_LOG" | "COMPLETED" | "ERROR"
) {
    public double percentage() {
        return (double)(priceHistoryCount + behaviorLogCount) / (priceHistoryTarget + behaviorLogTarget) * 100;
    }
}
```

- [ ] 每 10 万条更新一次 `progress` 对象
- [ ] 日志输出格式：`[data-warmup] product_price_history: 1,500,000 / 30,000,000 (5.0%)`

### 15.5 进度查询 API

在 `traffic-runner-service` 的 RunnerController 中增加：

```
GET /internal/runner/data-warmup/progress

响应：
{
  "code": 0,
  "data": {
    "priceHistoryCount": 18234000,
    "priceHistoryTarget": 30000000,
    "behaviorLogCount": 22100000,
    "behaviorLogTarget": 30000000,
    "completed": false,
    "status": "FILLING_BEHAVIOR_LOG",
    "percentage": 67.2
  }
}
```

- [ ] API 路径：`GET /internal/runner/data-warmup/progress`
- [ ] 返回 `ApiResponse<WarmupProgress>`

### 15.6 幂等与断点续传

- [ ] 启动时先 `SELECT COUNT(*) FROM product_price_history` 获取当前行数
- [ ] 如果已 ≥ `TARGET_ROWS` 则跳过该表
- [ ] 如果被中断后重启，从当前计数继续填充
- [ ] 不删除已有数据

### 15.7 性能与资源控制

- [ ] 每批次插入后 `Thread.sleep(10)` 控制写入速率
- [ ] 使用独立连接，不影响业务连接池
- [ ] 预计磁盘占用：`product_price_history` ~5 GB + `user_behavior_log` ~5 GB ≈ 10 GB
- [ ] 预计填充时间：30-60 分钟（取决于 I/O 性能）

### 15.8 验证

- [ ] 启动 traffic-runner-service，观察日志输出进度
- [ ] 调用 `GET /internal/runner/data-warmup/progress` 能正常返回进度
- [ ] 填充完毕后 `SELECT COUNT(*)` 两张表均 ≥ 3000 万
- [ ] 重启后不重复填充
- [ ] 填充过程中正常业务流量不受影响
- [ ] `EXPLAIN SELECT * FROM user_behavior_log WHERE user_id = 1` 显示 `type=ALL`（全表扫描）
- [ ] `EXPLAIN SELECT * FROM product_price_history WHERE sku = 'SKU-001'` 显示 `type=ref`（走索引）
