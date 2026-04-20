# Task 22 — chaos protocol 统一化

**阶段**：Phase 3.5 — 控制面重构  
**依赖**：Task 14、Task 16、Task 21  
**产出**：各业务服务按最新统一协议提供 chaos endpoint，旧 endpoint 直接下线

---

## 职责

将各业务服务的 chaos 协议统一为最新版本，供 gateway 分发层调用。

统一原则：

- [ ] 不保留旧 endpoint
- [ ] memory leak 使用 `enable / disable / cleanup / status`
- [ ] deadlock 使用 `enable / disable / cleanup / status`
- [ ] slow-sql 使用 `enable / disable / status`
- [ ] 所有 enable 接口支持 `durationSec`

---

## 统一接口要求

### 22.1 Slow SQL

```text
POST /internal/chaos/slow-sql/enable
POST /internal/chaos/slow-sql/disable
GET  /internal/chaos/slow-sql/status
```

### 22.2 Memory Leak

```text
POST /internal/chaos/memory-leak/enable
POST /internal/chaos/memory-leak/disable
POST /internal/chaos/memory-leak/cleanup
GET  /internal/chaos/memory-leak/status
```

### 22.3 Deadlock

```text
POST /internal/chaos/deadlock/enable
POST /internal/chaos/deadlock/disable
POST /internal/chaos/deadlock/cleanup
GET  /internal/chaos/deadlock/status
```

### 22.4 Table Lock / Maintenance

- [ ] 保留必要的维护型表锁接口
- [ ] 供 gateway 分发层调用
- [ ] 成功加锁后才允许上报激活状态

---

## 子任务

### 22.5 服务改造范围

- [ ] `catalog-service` slow-sql
- [ ] `inventory-service` slow-sql
- [ ] `order-service` slow-sql / memory-leak / deadlock / table-lock
- [ ] `payment-service` slow-sql / memory-leak / deadlock / table-lock
- [ ] `promotion-service` slow-sql
- [ ] `risk-service` slow-sql
- [ ] `fulfillment-service` slow-sql / table-lock
- [ ] `notification-service` slow-sql / table-lock

### 22.6 统一状态模型

- [ ] 返回 `active`
- [ ] 返回 `startedAt`
- [ ] 返回 `autoDisableAt`
- [ ] 返回 `details`
- [ ] 失败时返回统一错误结构

### 22.7 自动关闭

- [ ] 所有 enable 接口支持 `durationSec`
- [ ] 到期后自动关闭
- [ ] fail-safe：Redis 不可用或依赖异常时默认关闭注入

### 22.8 旧协议移除

- [ ] 删除 memory leak 旧 `start / stop / clear`
- [ ] 删除 deadlock 旧 `clear`
- [ ] 删除任何不再被 gateway/traffic 使用的旧控制入口

### 22.9 验证

- [ ] gateway 调用所有服务的新协议成功
- [ ] 旧 endpoint 不再暴露
- [ ] `durationSec` 自动关闭行为符合预期

