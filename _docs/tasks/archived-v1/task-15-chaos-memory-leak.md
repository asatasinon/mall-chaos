# Task 15 — Chaos: JVM 内存泄漏

**阶段**：Phase 3 — Chaos 功能  
**依赖**：Task 07（order-service）、Task 08（payment-service）  
**产出**：JVM 内存泄漏 Chaos 注入，供 order 与 payment 服务使用

---

## 目标
在 order-service 和 payment-service 中实现可控的 JVM 内存泄漏场景（通过持续持有 byte[] 引用），用于演练堆内存告警、GC 抖动与延迟上升的观测与恢复。

## 接口（order-service 和 payment-service 各自独立实现）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/internal/chaos/memory-leak/start` | 启动内存泄漏（持续分配并持有引用）|
| POST | `/internal/chaos/memory-leak/stop` | 停止分配，但保留已持有引用 |
| POST | `/internal/chaos/memory-leak/clear` | 清空引用，触发 GC 可回收 |
| GET | `/internal/chaos/memory-leak/status` | 查看泄漏状态 |

## 子任务

### 15.1 MemoryLeakChaosService 设计

```java
@Service
@Profile("chaos")
public class MemoryLeakChaosService {
    // 持有强引用，防止 GC 回收
    private final List<byte[]> leakHolder = new ArrayList<>();
    private volatile boolean running = false;
    private Thread leakThread = null;

    private int chunkSizeKb = 1024;    // 每次分配 1 MB（1024 KB）
    private long intervalMs = 500;      // 分配间隔 500ms
    private int maxMb = 512;            // 最大持有 512 MB，防止 OOM 影响系统

    // start 请求体参数
    public void start(int chunkSizeKb, long intervalMs, int maxMb) { ... }
    public void stop() { running = false; }
    public void clear() { leakHolder.clear(); System.gc(); }
    public MemoryLeakStatus status() { ... }
}
```

### 15.2 start 接口
- [ ] 请求体：`{ "chunkSizeKb": 1024, "intervalMs": 500, "maxMb": 256 }`
- [ ] 默认值：`chunkSizeKb=1024`，`intervalMs=500`，`maxMb=512`
- [ ] 启动后台 `Thread`（daemon=true）：
  ```java
  while (running) {
      if (holdingMb() >= maxMb) { Thread.sleep(intervalMs); continue; }
      leakHolder.add(new byte[chunkSizeKb * 1024]);
      Thread.sleep(intervalMs);
  }
  ```
- [ ] 已在运行时重复调用 start：先 stop 旧线程，再以新参数启动

### 15.3 stop 接口
- [ ] 设置 `running = false`，等待线程终止（不清空 `leakHolder`）
- [ ] 返回当前持有内存量

### 15.4 clear 接口
- [ ] 清空 `leakHolder`
- [ ] 调用 `System.gc()`（提示 JVM 尽快 GC，但不保证立即执行）
- [ ] 返回清理前的持有量

### 15.5 status 接口
- [ ] 返回 `MemoryLeakStatus`：
  ```json
  {
    "running": true,
    "holdingMb": 128,
    "objectCount": 128,
    "chunkSizeKb": 1024,
    "intervalMs": 500,
    "maxMb": 512
  }
  ```

### 15.6 JVM 参数建议
在 `docker-compose.yml` 中为 order/payment 设置：
```
JAVA_OPTS=-Xms256m -Xmx512m -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/heapdump.hprof
```
确保内存泄漏演练在有限堆内完成，避免 OOM 杀掉容器。

### 15.7 actuator & metrics
- [ ] 注册 `chaos.memory_leak.holding_mb` Gauge（`Micrometer`）
- [ ] 注册 `chaos.memory_leak.object_count` Gauge
- [ ] Grafana 面板：JVM Heap Used vs. Chaos Holding MB 双轨对比图

### 15.8 Grafana 告警规则
- [ ] `jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"} > 0.80` → 触发告警
- [ ] 告警消息：`"[Chaos] order-service heap usage > 80%, memory leak in progress"`

### 15.9 验证场景
- [ ] 调用 `start`（chunkSizeKb=1024, intervalMs=500, maxMb=200）
- [ ] 观察 Grafana JVM Heap 持续上升
- [ ] 约 200s 后达到 200 MB cap，停止分配
- [ ] 调用 `clear`，Heap 在下次 GC 后回落
- [ ] order-service P95 响应时间在 heap 高位时应上升（GC 暂停）
