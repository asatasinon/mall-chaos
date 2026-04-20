# Castrel Chaos — 任务总览

> 基于 [chaos-v1.md](../plans/chaos-v1.md) + [chaos-v2.md](../plans/chaos-v2.md) 以及 traffic control plane redesign 拆分，共 23 个 Task，分 5 个阶段。  
> v2 改版说明：Task 14-16 已按 [chaos-v2.md](../plans/chaos-v2.md) 重新设计为隐蔽式故障注入，旧版归档于 [`archived-v1/`](archived-v1/)。

## 阶段依赖关系

```
Phase 0 (基础搭建)
  ├── Task 01: Maven 多模块脚手架
  └── Task 02: Docker Compose + 基础设施

Phase 1 (基础 7 服务) — 依赖 Phase 0
  ├── Task 03: gateway-service
  ├── Task 04: user-service
  ├── Task 05: catalog-service
  ├── Task 06: inventory-service        ← 含分布式锁、库存重置
  ├── Task 07: order-service            ← 下单编排、幂等
  ├── Task 08: payment-service          ← 支付模拟
  └── Task 09: traffic-runner-service   ← 含配置热更新、库存重置调度

Phase 2 (进阶 4 服务) — 依赖 Phase 1
  ├── Task 10: promotion-service
  ├── Task 11: risk-service
  ├── Task 12: fulfillment-service
  └── Task 13: notification-service

Phase 3 (隐蔽式故障注入 v2) — 依赖 Phase 0，与 Phase 1/2 并行或后续
  ├── Task 14: v2 公共模块              ← common 层 3 个核心组件 + DDL + Redis Key
  ├── Task 15: v2 大表数据填充          ← traffic-runner 中 DataWarmupService
  ├── Task 16: v2 各服务场景接入        ← 表锁 + 慢 SQL + 内存泄漏，8 个服务改造
  └── Task 17: 网络故障注入             ← ToxiProxy + Pumba + Chaos Mesh

Phase 4 (部署与验收) — 依赖全部
  ├── Task 18: Kubernetes 部署
  └── Task 19: Chaos 演练验收（7 个场景）

Phase 3.5 (控制面重构) — 依赖 Phase 1/3 的相关能力
  ├── Task 20: traffic control plane 脚手架
  ├── Task 21: gateway chaos dispatch
  ├── Task 22: chaos protocol 统一化
  └── Task 23: traffic console 与场景编排
```

## 任务清单

| # | Task | 阶段 | 核心产出 |
|---|---|---|---|
| 01 | [Maven 多模块脚手架](task-01-project-scaffold.md) | Phase 0 | 12 个模块骨架，可编译 |
| 02 | [Docker Compose + 基础设施](task-02-infra-compose.md) | Phase 0 | MySQL + Redis + 观测栈 |
| 03 | [gateway-service](task-03-gateway-service.md) | Phase 1 | 路由转发、traceId 注入 |
| 04 | [user-service](task-04-user-service.md) | Phase 1 | 用户资料、收货地址 |
| 05 | [catalog-service](task-05-catalog-service.md) | Phase 1 | 商品查询 |
| 06 | [inventory-service](task-06-inventory-service.md) | Phase 1 | 库存预占/释放/重置 |
| 07 | [order-service](task-07-order-service.md) | Phase 1 | 下单编排、幂等 |
| 08 | [payment-service](task-08-payment-service.md) | Phase 1 | 支付模拟 |
| 09 | [traffic-runner-service](task-09-traffic-runner-service.md) | Phase 1 | 自动流量、热更新、库存重置调度 |
| 10 | [promotion-service](task-10-promotion-service.md) | Phase 2 | 优惠券计算 |
| 11 | [risk-service](task-11-risk-service.md) | Phase 2 | 前置风控、支付后复核 |
| 12 | [fulfillment-service](task-12-fulfillment-service.md) | Phase 2 | 履约单、发货状态流转 |
| 13 | [notification-service](task-13-notification-service.md) | Phase 2 | 通知分发、结构化日志 |
| **14** | [**v2 公共模块**](task-14-v2-common-components.md) | **Phase 3** | **QueryEnrichmentInterceptor + DataAuditService + LocalQueryCacheManager** |
| **15** | [**v2 大表数据填充**](task-15-v2-data-warmup.md) | **Phase 3** | **DataWarmupService，2 × 3000 万行大表** |
| **16** | [**v2 各服务场景接入**](task-16-v2-service-integration.md) | **Phase 3** | **表锁阻塞 + 慢 SQL JOIN + 内存泄漏，8 服务改造** |
| 17 | [网络故障注入](task-17-chaos-network.md) | Phase 3 | ToxiProxy + Pumba + Chaos Mesh |
| 18 | [Kubernetes 部署](task-18-kubernetes.md) | Phase 4 | K8s 全量部署 YAML |
| 19 | [Chaos 演练验收](task-19-chaos-verification.md) | Phase 4 | 7 个必测场景验收清单 |
| 20 | [traffic control plane 脚手架](task-20-traffic-control-plane-scaffold.md) | Phase 3.5 | Next.js + pnpm traffic 控制平面骨架 |
| 21 | [gateway chaos dispatch](task-21-gateway-chaos-dispatch.md) | Phase 3.5 | gateway 统一控制分发与基础设施代理 |
| 22 | [chaos protocol 统一化](task-22-chaos-protocol-unification.md) | Phase 3.5 | 各服务 chaos endpoint 最新协议统一 |
| 23 | [traffic console 与场景编排](task-23-traffic-console-and-scenarios.md) | Phase 3.5 | 新控制台、overview、scenarios、recover-all |

### 归档的 v1 任务

| 原编号 | 任务 | 归档路径 |
|--------|------|---------|
| 14 (v1) | 慢 SQL Chaos 公共模块 | [archived-v1/task-14-chaos-slow-sql.md](archived-v1/task-14-chaos-slow-sql.md) |
| 15 (v1) | JVM 内存泄漏 Chaos | [archived-v1/task-15-chaos-memory-leak.md](archived-v1/task-15-chaos-memory-leak.md) |
| 16 (v1) | 数据库死锁 Chaos | [archived-v1/task-16-chaos-deadlock.md](archived-v1/task-16-chaos-deadlock.md) |

## 推荐执行顺序

**最小可运行路径（基础 7 服务 + 流量）**：
`01 → 02 → 03 → 04 → 05 → 06 → 08 → 07 → 09`

**完整方案（含 v2 故障注入）**：
`01 → 02 → [03~09 并行] → [10~13 并行] → 14 → 15 → 16 → [17 并行] → [20 → 21 → 22 → 23] → 18 → 19`

**v2 故障注入专项路径**（假设 Phase 1/2 已完成）：
`14 → 15 → 16`

**控制面重构专项路径**：
`03 → 09 → 20 → 21 → 22 → 23`

## 关键约束速查

| 约束 | 位置 |
|---|---|
| Runner 配置更新必须带 `version`（乐观锁） | Task 09 §9.5 |
| 库存 reset 必须带 `expectedVersion` + 分布式锁 | Task 06 §6.3 |
| v2 代码中零 chaos 字样 | Task 14 核心约束 |
| 表锁 `durationSec` 最大 600 秒 | Task 14 §14.3 |
| 大表 JOIN 通过 Redis 开关控制 | Task 14 §14.2 |
| Redis 不可用时所有注入默认关闭（fail-safe） | Task 14 核心约束 |
| 大表每张 ≥ 3000 万行 | Task 15 §15.1 |
| 表名白名单校验防 SQL 注入 | Task 14 §14.3 |
