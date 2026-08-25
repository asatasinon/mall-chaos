---
name: castrel-architecture
description: 当需要理解 castrel-chaos 仓库中各服务之间的调用关系、每个服务依赖了什么（MySQL/Redis）、网关路由是如何工作的，或者混沌故障注入机制（慢 SQL、表锁/死锁、内存压力）是如何在各服务间串联起来的时候使用本 skill。
---

# Castrel-Chaos 系统架构

## Overview

castrel-chaos 是一个电商风格的 Java 微服务系统，用于压测/混沌演练场景模拟。11 个业务微服务 + 1 个 `common` 共享模块。**服务间没有消息队列（MQ）**，所有跨服务调用均为同步 HTTP（`RestClient`/`RestTemplate`），通过 `TraceContext`（`X-Trace-Id` 头）串联全链路。

## 服务清单与依赖

| 服务 | 端口 | MySQL | Redis | 角色 |
|---|---|---|---|---|
| gateway-service | 8080 | 否 | 否 | 全局网关，路由转发 + traceId 注入 |
| user-service | - | 是 | 否 | 用户资料、收货地址 |
| catalog-service | 8082 | 是 | 否 | 商品/SKU 数据，支持 Slow SQL 混沌 |
| inventory-service | - | 是 | 是 | 库存预占，Redis 分布式锁 |
| order-service | 8084 | 是 | 是 | 订单编排/幂等，支持 Slow SQL/内存泄漏/死锁混沌 |
| payment-service | - | 是 | 是 | 支付流程模拟，支持 Slow SQL/死锁混沌 |
| promotion-service | - | 是 | 是 | 折扣/优惠券，Redis 缓存 |
| risk-service | - | 是 | 否 | 下单前/支付后风控校验 |
| fulfillment-service | - | 是 | 否 | 订单履约，异步发货状态更新 |
| notification-service | 8090 | 是 | 是 | 通知发送（订单创建/支付结果/发货），当前**无调用方**，接口已就位但未接入 |
| traffic-control-plane | 3086 | 否 | 是（worker） | Next.js 控制台、自动化流量生成与混沌场景编排 |

所有服务的 MySQL/Redis 均指向共享实例：`jdbc:mysql://mysql:3306/castrel`、`redis:6379`（见 `k8s/configmap/app-config.yaml`）。

## 调用关系图

```
client → gateway-service (8080)
           ├─ /api/orders/**    → order-service:8084
           ├─ /api/products/**  → catalog-service:8082
           ├─ /ops/chaos/{svc}/** → 对应 service（strip 前缀转发）
           ├─ /api/orders/*/payment-intents → payment-service:8085
           ├─ /api/orders/*/shipment/** → fulfillment-service:8089
           └─ /internal/chaos/** → target service（控制面分发）
           └─ /ops/toxiproxy/** , /internal/toxiproxy/** → toxiproxy:8474

order-service → (DownstreamClients.java, RestClient + TraceContext 传播)
           ├─ user-service      GET  /internal/users/{id}
           ├─ catalog-service   POST /internal/catalog/batch
           ├─ inventory-service POST /internal/inventory/{reserve,release}
           ├─ promotion-service POST /internal/promotions/preview
           └─ risk-service      POST /internal/risk/pre-check

traffic-control-plane worker → (TrafficActionOrchestrator，流量编排)
           持有 order/payment/inventory/catalog/promotion/risk/fulfillment/notification
           的 URL，调用各服务 /internal/maintenance/data-audit/{start,stop}
           通过 Gateway dispatch 下发表锁、慢查询和内存压力故障
```

其余服务（catalog、inventory、payment、promotion、risk、user、fulfillment）彼此之间**无**直连调用，只作为 order-service 或控制面的下游被调用。

**关键点：只有 order-service 是业务编排的调用发起方**（下单流程串联 user/catalog/inventory/promotion/risk）；traffic-control-plane 是外部流量与混沌控制面，不属于业务调用链。

## 混沌故障注入机制

所有支持混沌的业务服务（order/inventory/payment/promotion/risk/fulfillment/notification）都通过 `common` 模块自动装配了同一套故障钩子，无需各自实现：

1. **表锁/死锁模拟**：目标服务的 `/internal/chaos/**` 由 Gateway dispatch 到 `common` 的 `ChaosService` 和 `DataAuditService`，按统一协议启动、停止和查询。
2. **慢查询模拟**：traffic-runner 翻转 Redis flag `castrel:query:enrichment`，服务内 `common` 的 `QueryEnrichmentInterceptor` 读取该 flag 并人为延迟 SQL。
3. **内存泄漏/压力模拟**：Redis flag `castrel:cache:local-buffer`，由 `common` 的 `LocalQueryCacheManager` 读取并持续占用内存。

即：故障是通过 **Redis 共享 flag + common 自动配置的拦截器/Bean** 生效的，某服务是否"支持"某类混沌，取决于它是否引入了 `common` 里对应的 auto-configuration（`ChaosRedisAutoConfiguration`、`ServiceComponentAutoConfiguration`）。

## common 共享模块

路径：`common/src/main/java/com/castrel/chaos/common/`

- `ApiResponse`：统一响应体
- `TraceContext`：ThreadLocal + `X-Trace-Id`，由 gateway 注入，`DownstreamClients.withTrace` 转发给下游 → 实现全链路 traceId
- `DistributedLockService`：基于 Redis `setIfAbsent` 的分布式锁（inventory-service 库存预占用它）
- `BizException`：业务异常
- `cache/`：`CachePolicy`、`CacheStats`、`LocalQueryCacheManager`（内存压力混沌钩子）
- `interceptor/`：`QueryEnrichmentInterceptor`、`EnrichmentConfig`（慢查询混沌钩子）
- `maintenance/`：`DataAuditService`、`DataAuditRequest`、`DataAuditStatus`（表锁/死锁混沌后端）
- `config/`：`ServiceComponentAutoConfiguration`、`ChaosRedisAutoConfiguration`（把上述 Bean 自动注入各服务）

## 可观测性数据查询位置

三类数据分别存放在三个独立后端，通过 Grafana 统一查询和跳转：

| 数据类型 | 存储/查询后端 | 采集方式 |
|---|---|---|
| 指标（Metrics） | Prometheus | 主动 scrape 各服务 `/actuator/prometheus`；另外还 scrape MySQL Exporter 和 Node Exporter |
| 日志（Logs） | Loki | Promtail 监听 Docker 容器日志，解析 JSON 日志（LogstashEncoder 输出），提取 `level`、`traceId` 作为 label 后 push 到 Loki |
| 链路（Traces） | Tempo | 各服务通过 OTLP 上报 trace，`TraceContext`（`X-Trace-Id`）与 Tempo 的 traceId 对齐 |
| 统一查询/可视化 | Grafana | 作为 Prometheus/Loki/Tempo 的统一查询入口和 Dashboard 展示层，三个数据源之间可互相跳转 |

**三者已在 Grafana 里打通、可互相跳转**：
- Loki 日志行里若含 `"traceId":"xxx"`，会识别并生成跳转到 Tempo 对应 trace 的链接
- Tempo trace 详情页可反向跳转到 Loki（按 traceId 过滤日志）
- Tempo 还能生成 service map（关联 Prometheus 指标），即链路数据可以关联出服务调用拓扑图

预置 Dashboard：`infra/grafana/dashboards/services-overview.json`（服务总览）、`infra/grafana/dashboards/chaos-events.json`（混沌事件）。

**查询建议**：
- 排查某次请求的完整链路 → Tempo，用 traceId（`X-Trace-Id`）查
- 看某服务当前状态（QPS、延迟、JVM）→ Prometheus / Grafana 面板
- 看某服务某个时间点的报错细节 → Loki，按 `service` 或 `trace_id` label 过滤
- 三者关联排查：从 Tempo trace 页跳到 Loki 看该 trace 下的日志，或从日志行跳到对应 trace

## 快速定位

- 想看下单调用链：`order-service/src/main/java/.../client/DownstreamClients.java`
- 想看网关路由表：`gateway-service/src/main/resources/application.yml`
- 想看某类故障怎么触发：`traffic-control-plane/src/app/chaos/` 与 `common/src/main/java/com/castrel/chaos/common/chaos/ChaosService.java`
- 想看某服务是否支持某混沌：看它是否依赖 `common` 的对应 auto-configuration + 有没有 `MaintenanceController`
- k8s 层服务发现用 `<name>-service` DNS 名，环境变量见 `k8s/configmap/app-config.yaml`，与各服务 `application.yml` 默认值一一对应

## 常见误区

| 误区 | 实际情况 |
|---|---|
| 以为服务间用 MQ 通信 | 全部是同步 HTTP，无 Kafka/RabbitMQ/RocketMQ |
| 以为 notification-service 被订单/支付流程调用 | 接口已定义但当前代码中**无任何调用方**，是预留集成点 |
| 以为 traffic-control-plane 是业务服务 | 它是流量/混沌控制面，不参与真实下单业务编排 |
| 以为每个服务的混沌能力是独立实现的 | 实际由 `common` 模块的 Redis flag + 拦截器统一驱动 |
