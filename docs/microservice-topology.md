# Castrel Chaos 服务拓扑

## 入口

| 入口 | 地址 | 边界 |
|---|---|---|
| Shopfront | `shopfront:3090` / `localhost:13090` | 消费者界面和 BFF，只允许业务资源 |
| Gateway | `gateway-service:8080` / `localhost:18080` | 业务 API 和固定 Fault Run 单目标分发 |
| Control plane | `traffic-control-plane:3086` / `localhost:13086` | 运营会话、Fault Run、Runner、场景控制台 |
| Restart broker | `notification-restart-broker:8095` | 固定 notification-service 重启适配器 |

## 业务服务

| 服务 | 端口 | 主要职责 |
|---|---:|---|
| user-service | 8081 | 用户、地址和认证资料 |
| catalog-service | 8082 | 商品、SKU、浏览报表 |
| inventory-service | 8083 | 库存预占、锁和可用性报表 |
| order-service | 8084 | 订单编排与客户订单报表 |
| payment-service | 8085 | 支付确认和对账 |
| promotion-service | 8087 | 优惠券与预留一致性 |
| risk-service | 8088 | 订单风控 |
| fulfillment-service | 8089 | 履约与发货 |
| notification-service | 8090 | 真实通知处理和持久化 |
| cart-service | 8091 | 购物车和目录校验 |
| psp-simulator | 8092 | 独立支付提供方模拟 |

## 控制流

- 消费者请求只能走 `shopfront -> gateway-service -> 业务服务`。
- 控制面 worker 只能通过 Gateway 调用固定公开业务路径或固定内部目标路径。
- 每个 Fault Run 只有 catalog 定义的目标和参数，Gateway 拒绝未知场景、任意 URL、批量目标和外部 patch。
- Runner 使用生命周期账号；Sam（用户 ID 19）只属于 `TRAFFIC_SCENARIO_ACCOUNTS`，不进入正常 Runner。
- MySQL 保存运行记录、事件和审计；Redis 保存 lease 与运行专属协调状态。
- 所有日期和会话使用 `Asia/Shanghai` / `+08:00`。
