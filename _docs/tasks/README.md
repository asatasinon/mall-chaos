# Castrel Chaos — 任务总览

> 基于 [chaos-v1.md](../plans/chaos-v1.md) 拆分，共 19 个 Task，分 4 个阶段。

## 阶段依赖关系

```
Phase 0 (基础搭建)
  ├── Task 01: Maven 多模块脚手架
  └── Task 02: Docker Compose + 基础设施

Phase 1 (基础 7 服务) — 依赖 Phase 0
  ├── Task 03: gateway-service
  ├── Task 04: user-service
  ├── Task 05: catalog-service          ← 含慢 SQL Chaos 公共组件
  ├── Task 06: inventory-service        ← 含分布式锁、库存重置
  ├── Task 07: order-service            ← 含内存泄漏 + 慢 SQL + 死锁 Chaos
  ├── Task 08: payment-service          ← 含内存泄漏 + 慢 SQL + 死锁 Chaos
  └── Task 09: traffic-runner-service   ← 含配置热更新、库存重置调度

Phase 2 (进阶 4 服务) — 依赖 Phase 1
  ├── Task 10: promotion-service
  ├── Task 11: risk-service
  ├── Task 12: fulfillment-service
  └── Task 13: notification-service

Phase 3 (Chaos 公共模块) — 与 Phase 1 并行或先行
  ├── Task 14: 慢 SQL Chaos 公共模块   ← 被 Task 05-13 引用
  ├── Task 15: JVM 内存泄漏 Chaos      ← order + payment
  ├── Task 16: 数据库死锁 Chaos        ← order + payment
  └── Task 17: 网络故障注入            ← ToxiProxy + Chaos Mesh

Phase 4 (部署与验收) — 依赖全部
  ├── Task 18: Kubernetes 部署
  └── Task 19: Chaos 演练验收（7 个场景）
```

## 任务清单

| # | Task | 阶段 | 核心产出 |
|---|---|---|---|
| 01 | [Maven 多模块脚手架](task-01-project-scaffold.md) | Phase 0 | 12 个模块骨架，可编译 |
| 02 | [Docker Compose + 基础设施](task-02-infra-compose.md) | Phase 0 | MySQL + Redis + 观测栈 |
| 03 | [gateway-service](task-03-gateway-service.md) | Phase 1 | 路由转发、traceId 注入 |
| 04 | [user-service](task-04-user-service.md) | Phase 1 | 用户资料、收货地址 |
| 05 | [catalog-service](task-05-catalog-service.md) | Phase 1 | 商品查询、慢 SQL Chaos |
| 06 | [inventory-service](task-06-inventory-service.md) | Phase 1 | 库存预占/释放/重置 |
| 07 | [order-service](task-07-order-service.md) | Phase 1 | 下单编排、幂等、3 种 Chaos |
| 08 | [payment-service](task-08-payment-service.md) | Phase 1 | 支付模拟、3 种 Chaos |
| 09 | [traffic-runner-service](task-09-traffic-runner-service.md) | Phase 1 | 自动流量、热更新、库存重置调度 |
| 10 | [promotion-service](task-10-promotion-service.md) | Phase 2 | 优惠券计算、慢 SQL Chaos |
| 11 | [risk-service](task-11-risk-service.md) | Phase 2 | 前置风控、支付后复核 |
| 12 | [fulfillment-service](task-12-fulfillment-service.md) | Phase 2 | 履约单、发货状态流转 |
| 13 | [notification-service](task-13-notification-service.md) | Phase 2 | 通知分发、结构化日志 |
| 14 | [Chaos: 慢 SQL 公共模块](task-14-chaos-slow-sql.md) | Phase 3 | 7 个服务共用的慢 SQL 组件 |
| 15 | [Chaos: JVM 内存泄漏](task-15-chaos-memory-leak.md) | Phase 3 | order + payment 内存泄漏场景 |
| 16 | [Chaos: 数据库死锁](task-16-chaos-deadlock.md) | Phase 3 | order + payment 死锁注入 |
| 17 | [Chaos: 网络故障注入](task-17-chaos-network.md) | Phase 3 | ToxiProxy + Pumba + Chaos Mesh |
| 18 | [Kubernetes 部署](task-18-kubernetes.md) | Phase 4 | K8s 全量部署 YAML |
| 19 | [Chaos 演练验收](task-19-chaos-verification.md) | Phase 4 | 7 个必测场景验收清单 |

## 推荐执行顺序

**最小可运行路径（基础 7 服务 + 流量）**：
`01 → 02 → 14 → 03 → 04 → 05 → 06 → 08 → 07 → 09`

**完整方案**：
`01 → 02 → 14 → [03~09 并行] → [10~13 并行] → [15,16,17 并行] → 18 → 19`

## 关键约束速查

| 约束 | 位置 |
|---|---|
| Runner 配置更新必须带 `version`（乐观锁） | Task 09 §9.5 |
| 库存 reset 必须带 `expectedVersion` + 分布式锁 | Task 06 §6.3 |
| 所有 Chaos `enable` 必须支持 `durationSec` 自动关闭 | Task 14 §14.4 |
| Chaos 接口仅 `chaos` profile 暴露 | Task 14 §14.3 |
| 慢 SQL `real` 模式使用 `SELECT SLEEP(N)` | Task 14 §14.1 |
| 死锁注入使用互换锁顺序的两个并发事务 | Task 16 §16.1 |
