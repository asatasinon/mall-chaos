# Task 03 — gateway-service

**阶段**：Phase 1 — 基础 7 服务  
**依赖**：Task 01（模块骨架）、Task 02（基础设施）  
**产出**：统一业务入口、trace 注入、traffic 控制分发、基础设施代理的网关服务

---

## 职责

`gateway-service` 在最新设计中承担三类职责：

1. 业务请求统一入口
2. `traffic-runner-service` 的唯一控制分发层
3. ToxiProxy 等基础设施能力代理

关键网络约束：

- [ ] 浏览器不直接访问 gateway 的控制台页面
- [ ] `traffic-runner-service` 只能访问 `gateway-service`
- [ ] 业务服务不对 `traffic-runner-service` 直接暴露控制入口
- [ ] 所有 traffic 控制请求统一走 `traffic -> gateway -> services`

---

## 接口清单

### 3.0 业务路由 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/orders` | 转发到 `order-service POST /api/orders` |
| GET | `/api/orders/{id}` | 转发到 `order-service GET /api/orders/{id}` |
| GET | `/api/products` | 转发到 `catalog-service GET /api/products` |
| GET | `/internal/gateway/routes` | 返回当前业务路由快照 |

### 3.0.1 traffic 控制分发 API

以下接口供 `traffic-runner-service` 调用，不面向浏览器直接使用：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/internal/gateway/chaos/slow-sql/enable` | 分发慢 SQL 启用请求 |
| POST | `/internal/gateway/chaos/slow-sql/disable` | 分发慢 SQL 关闭请求 |
| GET | `/internal/gateway/chaos/slow-sql/status` | 聚合慢 SQL 状态 |
| POST | `/internal/gateway/chaos/memory-leak/enable` | 分发内存泄漏启用请求 |
| POST | `/internal/gateway/chaos/memory-leak/disable` | 分发内存泄漏停注入请求 |
| POST | `/internal/gateway/chaos/memory-leak/cleanup` | 分发内存泄漏清理请求 |
| GET | `/internal/gateway/chaos/memory-leak/status` | 聚合内存泄漏状态 |
| POST | `/internal/gateway/chaos/deadlock/enable` | 分发死锁启用请求 |
| POST | `/internal/gateway/chaos/deadlock/disable` | 分发死锁关闭请求 |
| POST | `/internal/gateway/chaos/deadlock/cleanup` | 分发死锁清理请求 |
| GET | `/internal/gateway/chaos/deadlock/status` | 聚合死锁状态 |
| POST | `/internal/gateway/chaos/table-lock/enable` | 分发表锁启用请求 |
| POST | `/internal/gateway/chaos/table-lock/disable` | 分发表锁关闭请求 |
| GET | `/internal/gateway/chaos/table-lock/status` | 聚合表锁状态 |
| POST | `/internal/gateway/network-delay/enable` | 注入网络延迟 |
| POST | `/internal/gateway/network-delay/disable` | 删除网络延迟 toxic |
| GET | `/internal/gateway/network-delay/status` | 查询网络延迟状态 |
| POST | `/internal/gateway/network-reset/enable` | 注入 reset_peer |
| POST | `/internal/gateway/network-reset/disable` | 删除网络 reset toxic |
| GET | `/internal/gateway/network-reset/status` | 查询网络 reset 状态 |
| POST | `/internal/gateway/inventory-reset/plan` | 分发库存重置预览请求 |
| POST | `/internal/gateway/inventory-reset` | 分发库存重置执行请求 |

### 3.0.2 基础设施代理 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/internal/toxiproxy/proxies` | 查询 ToxiProxy 代理列表 |
| POST | `/internal/toxiproxy/proxies/{proxyName}/toxics` | 创建 toxic |
| DELETE | `/internal/toxiproxy/proxies/{proxyName}/toxics/{toxicName}` | 删除 toxic |

---

## 子任务

### 3.1 技术边界

- [ ] 保持 `gateway-service` 为统一入口服务
- [ ] 不再承载 `chaos-console.html` 或任何控制台前端静态页面
- [ ] 新增 traffic 控制分发层能力
- [ ] 保持业务代理、控制分发、基础设施代理三种职责边界清晰

### 3.2 业务路由配置

- [ ] `application.yml` 配置业务路由规则，至少包含：
  - `/api/orders`
  - `/api/orders/**`
  - `/api/products/**`
- [ ] 业务流量仍由 gateway 转发到各微服务
- [ ] `traffic-runner-service` 的正常下单流量统一走 gateway

示例：

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-create
          uri: http://order-service:8084
          predicates:
            - Path=/api/orders
            - Method=POST
        - id: order-get
          uri: http://order-service:8084
          predicates:
            - Path=/api/orders/**
            - Method=GET
        - id: products
          uri: http://catalog-service:8082
          predicates:
            - Path=/api/products/**
```

### 3.3 TraceId 注入与透传

- [ ] 实现全局 Trace 过滤器
- [ ] 读取请求头 `X-Trace-Id`，若无则生成新值
- [ ] 写入 MDC `traceId`
- [ ] 透传到下游请求头
- [ ] 响应头回写 `X-Trace-Id`
- [ ] traffic 控制分发链路也必须保留 traceId

### 3.4 `GET /internal/gateway/routes`

- [ ] 返回当前所有业务路由 ID、目标 URI、断言规则的快照 JSON
- [ ] 不要求返回全部内部控制分发端点，但应能返回基础业务路由

### 3.5 traffic 控制分发 API

新增 `ChaosDispatchController`，统一接收来自 `traffic-runner-service` 的控制请求。

建议结构：

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

**请求 DTO 建议**：

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

- [ ] gateway 按目标服务白名单进行分发
- [ ] gateway 统一构造下游服务 URL
- [ ] gateway 禁止 traffic 传入任意地址进行转发
- [ ] gateway 统一响应 `ApiResponse<T>`
- [ ] 批量分发时返回成功与失败明细

### 3.6 下游转发规则

- [ ] gateway 只负责分发，不重写业务服务的 chaos 业务逻辑
- [ ] 各业务服务按新协议提供标准 chaos endpoint：
  - `/internal/chaos/slow-sql/enable|disable|status`
  - `/internal/chaos/memory-leak/enable|disable|cleanup|status`
  - `/internal/chaos/deadlock/enable|disable|cleanup|status`
  - 表锁相关维护 API
- [ ] gateway 对服务名到 base URL 的映射做集中配置
- [ ] gateway 必须校验该服务是否支持该类 chaos

### 3.7 网络故障代理

- [ ] 保留现有 `ToxiproxyProxyController`
- [ ] 在此基础上封装对外的 gateway 分发 API：
  - `/internal/gateway/network-delay/enable`
  - `/internal/gateway/network-delay/disable`
  - `/internal/gateway/network-delay/status`
  - `/internal/gateway/network-reset/enable`
  - `/internal/gateway/network-reset/disable`
  - `/internal/gateway/network-reset/status`
- [ ] network delay / reset 的底层执行仍通过 toxiproxy API 完成
- [ ] gateway 负责 proxyName 白名单校验与 toxic 名称规范

### 3.8 旧控制台下线

- [ ] 删除 gateway 中旧 `chaos-console.html`
- [ ] 删除旧控制台 JS/CSS 静态资源
- [ ] 删除仅服务于旧控制台的前端入口逻辑
- [ ] 若 `ConsoleConfigController` 仅服务旧页面，则评估移除或迁移到 traffic 控制面

### 3.9 安全与约束

- [ ] Chaos 分发接口仅在 `chaos` profile 下启用
- [ ] 仅允许来自 `traffic-runner-service` 的内部控制访问
- [ ] 对目标服务、proxyName、tableName 做白名单校验
- [ ] 对 `durationSec` 做上限校验
- [ ] 对异常统一返回友好错误信息

### 3.10 metrics

- [ ] 暴露 `prometheus`、`health` 端点
- [ ] 添加业务请求维度 metrics tag（`route_id`）
- [ ] 添加控制分发维度 metrics：
  - `gateway.chaos.dispatch.total`
  - `gateway.chaos.dispatch.fail`
  - `gateway.toxiproxy.dispatch.total`
  - `gateway.toxiproxy.dispatch.fail`

### 3.11 验证

- [ ] `POST /api/orders` 能路由到 order-service
- [ ] 响应中包含 `X-Trace-Id` 头
- [ ] `/internal/gateway/routes` 返回路由列表
- [ ] `traffic-runner-service` 可仅通过 gateway 完成 slow-sql 控制
- [ ] `traffic-runner-service` 可仅通过 gateway 完成 memory-leak 控制
- [ ] `traffic-runner-service` 可仅通过 gateway 完成 deadlock 控制
- [ ] `traffic-runner-service` 可仅通过 gateway 完成 table-lock 控制
- [ ] `traffic-runner-service` 可仅通过 gateway 完成 network-delay / network-reset 控制

## 数据模型

无数据库表，路由配置、服务映射、proxy 映射、白名单规则存放于 `application.yml`。
