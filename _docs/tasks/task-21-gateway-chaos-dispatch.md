# Task 21 — gateway chaos dispatch

**阶段**：Phase 3.5 — 控制面重构  
**依赖**：Task 03、Task 17、Task 20  
**产出**：`gateway-service` 新增统一的 chaos / network 分发 API，成为 traffic 控制平面的唯一后端入口

---

## 职责

`gateway-service` 负责承接 `traffic-control-plane` 的控制请求，并统一分发到：

1. 业务服务的 chaos endpoint
2. ToxiProxy 代理
3. 必要的基础设施代理能力

关键约束：

- [ ] traffic 不能绕过 gateway
- [ ] gateway 必须做目标服务白名单校验
- [ ] gateway 不得暴露任意 URL 转发能力

---

## 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/internal/gateway/chaos/slow-sql/enable` | 分发慢 SQL 启用 |
| POST | `/internal/gateway/chaos/slow-sql/disable` | 分发慢 SQL 关闭 |
| GET | `/internal/gateway/chaos/slow-sql/status` | 聚合慢 SQL 状态 |
| POST | `/internal/gateway/chaos/memory-leak/enable` | 分发内存泄漏启用 |
| POST | `/internal/gateway/chaos/memory-leak/disable` | 分发内存泄漏停注入 |
| POST | `/internal/gateway/chaos/memory-leak/cleanup` | 分发内存泄漏清理 |
| GET | `/internal/gateway/chaos/memory-leak/status` | 聚合内存泄漏状态 |
| POST | `/internal/gateway/chaos/deadlock/enable` | 分发死锁启用 |
| POST | `/internal/gateway/chaos/deadlock/disable` | 分发死锁关闭 |
| POST | `/internal/gateway/chaos/deadlock/cleanup` | 分发死锁清理 |
| GET | `/internal/gateway/chaos/deadlock/status` | 聚合死锁状态 |
| POST | `/internal/gateway/chaos/table-lock/enable` | 分发表锁启用 |
| POST | `/internal/gateway/chaos/table-lock/disable` | 分发表锁关闭 |
| GET | `/internal/gateway/chaos/table-lock/status` | 聚合表锁状态 |
| POST | `/internal/gateway/network-delay/enable` | 注入网络延迟 |
| POST | `/internal/gateway/network-delay/disable` | 删除网络延迟 toxic |
| GET | `/internal/gateway/network-delay/status` | 查询网络延迟状态 |
| POST | `/internal/gateway/network-reset/enable` | 注入网络 reset |
| POST | `/internal/gateway/network-reset/disable` | 删除网络 reset toxic |
| GET | `/internal/gateway/network-reset/status` | 查询网络 reset 状态 |

---

## 子任务

### 21.1 ChaosDispatchController

- [ ] 新增 `ChaosDispatchController`
- [ ] 统一 DTO 与响应格式
- [ ] 批量目标服务请求返回成功/失败明细

### 21.2 服务映射与白名单

- [ ] 在 `application.yml` 中维护服务名 -> baseUrl 映射
- [ ] 为每类 chaos 建立服务白名单
- [ ] 校验 `proxyName`、`targetTable`、`durationSec`

### 21.3 下游转发

- [ ] 转发 slow-sql 请求
- [ ] 转发 memory-leak 请求
- [ ] 转发 deadlock 请求
- [ ] 转发表锁请求
- [ ] 转发时统一注入 traceId

### 21.4 基础设施代理

- [ ] 复用或扩展 `ToxiproxyProxyController`
- [ ] 将 network delay / reset 封装为 gateway 分发 API
- [ ] 统一 toxic 名称与清理策略

### 21.5 旧入口清理

- [ ] 下线 gateway 中旧控制台静态页
- [ ] 删除旧前端资源与仅服务于旧页面的入口逻辑

### 21.6 验证

- [ ] traffic 可仅通过 gateway 控制 slow-sql
- [ ] traffic 可仅通过 gateway 控制 memory-leak
- [ ] traffic 可仅通过 gateway 控制 deadlock
- [ ] traffic 可仅通过 gateway 控制 network delay / reset

