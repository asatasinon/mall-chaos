# Task 14 — Chaos: 慢 SQL 公共模块

**阶段**：Phase 3 — Chaos 功能  
**依赖**：Task 01（common 模块）  
**产出**：可复用的慢 SQL Chaos 组件，被所有需要慢 SQL 注入的服务引用

---

## 目标
抽取慢 SQL Chaos 通用实现，避免各服务重复编写相同逻辑。所有需要慢 SQL 的服务（catalog / inventory / order / payment / promotion / risk / fulfillment）均依赖此组件。

## 子任务

### 14.1 组件设计

**放置位置**：`common` 模块（或独立 `chaos-common` Maven 模块）

**`SlowSqlChaosState`**（线程安全状态持有者）
```java
@Component
public class SlowSqlChaosState {
    private volatile boolean enabled = false;
    private volatile String mode = "sleep";     // "real" | "sleep"
    private volatile long delayMs = 2000;
    private volatile double injectRate = 1.0;   // 0.0~1.0
    private volatile String scope = "ALL";
    private volatile Instant autoDisableAt = null;
    // getters / setters
}
```

**`SlowSqlChaosInterceptor`**（AOP 切面或手动调用）
```java
// 在目标 Service 方法前调用：
public void maybeDelay() {
    if (!state.isEnabled()) return;
    if (autoDisableAt != null && Instant.now().isAfter(autoDisableAt)) {
        state.setEnabled(false); return;
    }
    if (ThreadLocalRandom.current().nextDouble() > state.getInjectRate()) return;
    if ("sleep".equals(state.getMode())) {
        Thread.sleep(state.getDelayMs());
    } else { // "real"
        jdbcTemplate.execute("SELECT SLEEP(" + state.getDelayMs() / 1000.0 + ")");
    }
}
```

### 14.2 Chaos API 请求/响应 DTO

**`SlowSqlEnableRequest`**
```java
public record SlowSqlEnableRequest(
    String mode,        // "real" | "sleep"，默认 "sleep"
    long delayMs,       // 延迟毫秒数，默认 2000
    double injectRate,  // 注入概率 0.0~1.0，默认 1.0
    String scope,       // "ALL" | "PARTIAL"
    int durationSec     // 自动关闭时间，0=永不自动关闭
) {}
```

**`SlowSqlStatusResponse`**
```java
public record SlowSqlStatusResponse(
    boolean enabled,
    String mode,
    long delayMs,
    double injectRate,
    String scope,
    String autoDisableAt  // ISO 8601，null 表示不自动关闭
) {}
```

### 14.3 ChaosController 基类

提供 `AbstractSlowSqlChaosController`，各服务继承后仅需注入 `SlowSqlChaosState`：
```java
@RestController
@Profile("chaos")
public abstract class AbstractSlowSqlChaosController {
    @PostMapping("/internal/chaos/slow-sql/enable")
    public SlowSqlStatusResponse enable(@RequestBody SlowSqlEnableRequest req) { ... }

    @PostMapping("/internal/chaos/slow-sql/disable")
    public SlowSqlStatusResponse disable() { ... }
}
```

### 14.4 自动到期关闭
- [ ] `enable` 时若 `durationSec > 0`，计算 `autoDisableAt = now() + durationSec`
- [ ] `SlowSqlChaosInterceptor.maybeDelay()` 每次调用时检查是否过期，过期则自动 disable
- [ ] 也可使用 `ScheduledExecutorService` 定时任务扫描（精度更高）

### 14.5 chaos_policy 持久化（可选）
- [ ] 若需要重启后恢复状态，将当前 chaos 策略写入 `chaos_policy` 表
- [ ] 服务启动时读取 `chaos_policy` 表恢复内存状态
- [ ] `chaos_event_log` 记录每次 enable/disable 事件（service, scenario, trace_id, started_at, ended_at）

### 14.6 `chaos_event_log` 记录
```sql
-- 每次 enable 触发注入时（采样写入，避免高频写入压力）
INSERT INTO chaos_event_log (service, scenario, trace_id, started_at, result, error)
VALUES ('catalog', 'slow-sql', ?, NOW(), 'INJECTED', NULL);
```
- [ ] 采样写入（每 100 次注入写一次，或按 `injectRate` 采样）

### 14.7 验证
- [ ] 任意服务调用 `/internal/chaos/slow-sql/enable`（mode=sleep, delayMs=3000, durationSec=60）
- [ ] 该服务业务接口响应时间增加约 3s
- [ ] 60s 后自动恢复正常响应时间
- [ ] Prometheus metrics 显示 `chaos.slow_sql.active=1` → `0`

## 各服务接入步骤（checklist）
对每个需要慢 SQL 的服务：
- [ ] 在 Service 层关键方法中调用 `slowSqlChaosState.maybeDelay()`
- [ ] 注册 `AbstractSlowSqlChaosController` 子类 Bean
- [ ] `application.yml` 添加 `chaos` profile 配置
- [ ] 服务清单：catalog ✓、inventory ✓、order ✓、payment ✓、promotion ✓、risk ✓、fulfillment ✓
