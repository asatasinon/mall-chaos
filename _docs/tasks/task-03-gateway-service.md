# Task 03 — gateway-service

**阶段**：Phase 1 — 基础 7 服务  
**依赖**：Task 01（模块骨架）、Task 02（基础设施）  
**产出**：可路由转发、注入 traceId 的统一网关

---

## 职责
统一入口、路由转发、鉴权透传、trace 注入。

## 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/orders` | 转发到 `order-service POST /api/orders` |
| GET | `/api/orders/{id}` | 转发到 `order-service GET /api/orders/{id}` |
| GET | `/api/products` | 转发到 `catalog-service GET /api/products` |
| GET | `/internal/gateway/routes` | 返回当前路由快照 |

## 子任务

### 3.1 依赖选型
- [ ] 选用 `Spring Cloud Gateway`（WebFlux 响应式）
- [ ] 或使用 `Spring MVC` + `RestClient` 反向代理（更简单，适合本项目规模）
- [ ] 推荐：MVC 简单代理，避免引入 WebFlux 复杂性

### 3.2 路由配置
- [ ] `application.yml` 配置路由规则（或用 `@RouteLocator` Java Config）：
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

### 3.3 TraceId 注入 Filter
- [ ] 实现全局 `GlobalFilter`（Gateway）或 `HandlerInterceptor`（MVC）：
  - 读取请求头 `X-Trace-Id`，若无则生成 UUID
  - 写入 MDC `traceId`，透传到下游请求头
  - 响应头回写 `X-Trace-Id`

### 3.4 `GET /internal/gateway/routes`
- [ ] 返回当前所有路由 ID、目标 URI、断言规则的快照 JSON

### 3.5 actuator & metrics
- [ ] 暴露 `prometheus`、`health` 端点
- [ ] 添加请求维度 metrics tag（`route_id`）

### 3.6 验证
- [ ] `POST /api/orders` 能路由到 order-service（order-service 未实现前可用 mock）
- [ ] 响应中包含 `X-Trace-Id` 头
- [ ] `/internal/gateway/routes` 返回路由列表

## 数据模型
无数据库表，路由配置存放于 `application.yml`。
