# Castrel Chaos 微服务拓扑文档

> 生成日期：2026-04-21
> 分析者：SRE 架构分析

---

## 总体架构概览

| 属性 | 值 |
|---|---|
| 构建工具 | Maven（多模块项目） |
| 运行时 | Java 21 |
| 框架 | Spring Boot 3.5.x + Spring Cloud 2025.0.0 |
| 可观测性 | Micrometer + Prometheus + OpenTelemetry（Trace）|
| 日志 | Logstash Logback Encoder → Loki（by Promtail） |
| 观测栈 | Prometheus + Grafana + Loki + Tempo |
| 部署 IP | 10.106.2.78 |

---

## 服务基础信息 & 部署拓扑

| 服务名称 | 开发语言 / 框架 | 容器端口 | 宿主机端口 | 部署 IP |
|---|---|---|---|---|
| `gateway-service` | Java / Spring Cloud Gateway (WebFlux) | 8080 | 18080 | 10.106.2.78 |
| `user-service` | Java / Spring Boot Web + JPA | 8081 | 18081 | 10.106.2.78 |
| `catalog-service` | Java / Spring Boot Web + JPA + Redis | 8082 | 18082 | 10.106.2.78 |
| `inventory-service` | Java / Spring Boot Web + JPA + Redis | 8083 | 18083 | 10.106.2.78 |
| `order-service` | Java / Spring Boot Web + JPA + Redis | 8084 | 18084 | 10.106.2.78 |
| `payment-service` | Java / Spring Boot Web + JPA + Redis | 8085 | 18085 | 10.106.2.78 |
| `traffic-runner-service` | Java / Spring Boot Web + JPA + Redis | 8086 | 18086 | 10.106.2.78 |
| `promotion-service` | Java / Spring Boot Web + JPA + Redis | 8087 | 18087 | 10.106.2.78 |
| `risk-service` | Java / Spring Boot Web + JPA + Redis | 8088 | 18088 | 10.106.2.78 |
| `fulfillment-service` | Java / Spring Boot Web + JPA + Redis | 8089 | 18089 | 10.106.2.78 |
| `notification-service` | Java / Spring Boot Web + JPA + Redis | 8090 | 18090 | 10.106.2.78 |

---

## Prometheus 监控埋点

### 通用说明

- **Prometheus SDK**：`io.micrometer:micrometer-registry-prometheus`（parent pom 全局继承，所有服务无需单独声明）
- **Prometheus 抓取端点**：`GET /actuator/prometheus`
- **健康检查端点**：`GET /actuator/health`
- **抓取间隔**：15s

---

### gateway-service

| 指标名称 | 类型 | 说明 |
|---|---|---|
| *(无自定义指标)* | — | 仅暴露 Spring Boot 自动指标（HTTP 请求统计等） |

---

### user-service

| 指标名称 | 类型 | 说明 |
|---|---|---|
| *(无自定义指标)* | — | 仅暴露 Spring Boot 自动指标 |

---

### catalog-service

| 指标名称 | 类型 | Tag | 说明 |
|---|---|---|---|
| `catalog.query.count` | Counter | `type=list` | 商品列表查询次数 |
| `catalog.query.count` | Counter | `type=single` | 单品查询次数 |
| `catalog.query.count` | Counter | `type=batch` | 批量 SKU 查询次数 |

---

### inventory-service

| 指标名称 | 类型 | 说明 |
|---|---|---|
| `inventory.reserve.success.count` | Counter | 库存预占成功次数 |
| `inventory.reserve.fail.count` | Counter | 库存预占失败次数（库存不足） |
| `inventory.reset.count` | Counter | 库存重置执行次数 |

---

### order-service

| 指标名称 | 类型 | Tag | 说明 |
|---|---|---|---|
| `order.create.success.count` | Counter | — | 订单创建成功次数（支付完成） |
| `order.create.fail.count` | Counter | — | 订单创建失败次数 |
| `chaos.deadlock.count` | Counter | `service=order` | 死锁混沌注入计数（chaos profile 激活时） |

---

### payment-service

| 指标名称 | 类型 | 说明 |
|---|---|---|
| `payment.charge.success.count` | Counter | 支付成功次数 |
| `payment.charge.fail.count` | Counter | 支付失败次数（余额不足等） |
| `payment.charge.timeout.count` | Counter | 支付超时次数（5s 模拟网关超时） |
| `chaos.deadlock.count` | Counter（`service=payment`） | 死锁混沌注入计数（chaos profile 激活时） |

---

### traffic-runner-service

| 指标名称 | 类型 | 说明 |
|---|---|---|
| `runner.request.total` | Counter | 流量生成器发出的总请求数 |
| `runner.request.success` | Counter | 成功请求数（订单状态为 PAID） |
| `runner.request.fail` | Counter | 失败请求数 |
| `runner.qps` | Gauge | 当前实际 QPS（60s 滑动窗口） |

---

### promotion-service

| 指标名称 | 类型 | Tag | 说明 |
|---|---|---|---|
| `promotion.calculate.count` | Counter | `type=calculate` | 正式优惠计算次数 |
| `promotion.discount.total` | Counter | — | 累计优惠金额（浮点增量） |

---

### risk-service

| 指标名称 | 类型 | 说明 |
|---|---|---|
| `risk.pre_check.pass.count` | Counter | 风控前检通过次数 |
| `risk.pre_check.reject.count` | Counter | 风控前检拒绝次数（黑名单 / 频率 / 金额超限） |
| `risk.post_pay.freeze.count` | Counter | 支付后风控冻结次数 |

---

### fulfillment-service

| 指标名称 | 类型 | 说明 |
|---|---|---|
| `fulfillment.create.count` | Counter | 履约单创建次数 |
| `fulfillment.cancel.count` | Counter | 履约单取消次数 |

---

### notification-service

| 指标名称 | 类型 | Tag | 说明 |
|---|---|---|---|
| `notification.sent.count` | Counter | `event_type`, `channel=MOCK` | 通知发送成功次数 |
| `notification.fail.count` | Counter | — | 通知发送失败次数（2% 随机模拟失败） |

---

## Chaos 注入能力矩阵

| 服务 | SlowSQL | MemoryLeak | Deadlock | 备注 |
|---|:---:|:---:|:---:|---|
| `gateway-service` | — | — | — | 路由代理层，不注入 |
| `user-service` | — | — | — | — |
| `catalog-service` | ✓ | — | — | — |
| `inventory-service` | ✓ | — | — | — |
| `order-service` | ✓ | ✓ | ✓ | Deadlock 需激活 `chaos` profile |
| `payment-service` | ✓ | ✓ | ✓ | Deadlock 需激活 `chaos` profile |
| `traffic-runner-service` | — | — | — | 流量生成器本身无故障注入 |
| `promotion-service` | ✓ | — | — | — |
| `risk-service` | ✓ | — | — | — |
| `fulfillment-service` | ✓ | — | — | — |
| `notification-service` | ✓ | — | — | — |

---

## ToxiProxy 网络故障注入

以下服务支持通过 ToxiProxy 进行网络层故障模拟（延迟、丢包、断连等）：

| 服务 | 原始端口 | ToxiProxy 代理端口 |
|---|---|---|
| `inventory-service` | 18083 | 18183 |
| `order-service` | 18084 | 18184 |
| `payment-service` | 18085 | 18185 |

ToxiProxy API 通过 `gateway-service` 的 `/ops/toxiproxy/**` 路由统一管理。

---

## 链路追踪

所有服务均通过环境变量 `JAVA_TOOL_OPTIONS` 注入 OpenTelemetry Java Agent：

| 配置项 | 值 |
|---|---|
| Trace 上报地址 | `http://tempo:4318` |
| Metrics 导出器 | `none`（由 Micrometer 独立负责） |
| Logs 导出器 | `none`（由 Loki 独立负责） |
