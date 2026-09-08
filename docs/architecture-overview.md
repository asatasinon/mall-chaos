# Castrel Chaos 架构与主要功能说明

> 本文面向开发者、维护者和部署人员，说明当前仓库的系统边界、运行链路、模块职责和主要功能。
> 结论以运行时代码、配置、数据库初始化脚本和部署清单为准；README 仍然是安装、配置和日常操作的权威入口。

## 1. 系统定位

Castrel Chaos 是一个面向 SRE 和可观测性培训的电商微服务平台。它同时承担两类职责：

1. 提供一条接近真实电商系统的消费者业务链路：登录、商品浏览、购物车、结算、支付、风控、履约和通知。
2. 提供一个受控的运营控制面，通过真实的 HTTP、SQL、Redis、JVM、文件系统、锁和外部支付提供方路径制造可观察的运行行为，并支持停止、恢复、审计和清理。

系统的核心设计取向不是在 Controller 中直接返回错误或固定延迟，而是让异常效果来自真实业务路径和真实资源竞争。例如：

- 报表场景执行真实历史数据查询；
- Redis 场景通过商品详情 API 读取运行级 Hash；
- 表锁和行锁场景作用于真实库存表和事务；
- 存储场景追加真实文件；
- PSP 场景经独立 HTTP 客户端访问 `psp-simulator`；
- 指标、结构化日志、Trace 和告警记录实际影响。

## 2. 总体架构

```text
消费者浏览器
    |
    v
shopfront:13090（Next.js 前台 / BFF）
    |
    v
gateway-service:18080（认证、路由、Trace、统一异常边界）
    |
    +--> user-service
    +--> catalog-service
    +--> cart-service
    +--> inventory-service
    +--> order-service
    +--> payment-service --> psp-simulator
    +--> promotion-service
    +--> risk-service
    +--> fulfillment-service
    `--> notification-service

运营浏览器
    |
    v
traffic-control-plane:13086（Next.js Web/API）
    |
    +--> MySQL / Redis（控制面状态、审计、租约）
    +--> gateway-service（固定业务操作）
    `--> notification-restart-broker（受限重启适配）

traffic-control-plane-worker（独立进程 / Deployment）
    |
    +--> 客户生命周期 Runner
    +--> 受控运行和场景 Worker
    +--> 到期恢复、补给、留存
    +--> gateway-service
    +--> MySQL / Redis
    `--> product_price_history / user_behavior_log
        （数据预热的唯一直接写表例外）

可观测性
    Java Actuator / Prometheus --> Grafana / Alertmanager
    Java 结构化日志 --> Promtail --> Loki --> Grafana
    OpenTelemetry --> Tempo
```

### 2.1 入口和边界

| 入口 | 默认地址 | 责任 |
| --- | --- | --- |
| Shopfront | `localhost:13090` | 消费者界面和 BFF，只代理普通业务资源 |
| Gateway | `localhost:18080` | 消费者 API、认证、固定内部操作分发和统一错误边界 |
| Control Plane | `localhost:13086` | 运营登录、运行目录、运行生命周期、审计和恢复控制 |
| Grafana | `localhost:13000` | 指标、日志和 Trace 的统一查询入口 |

业务服务通常只加入容器网络，不直接发布宿主机端口。完整端口、密钥、Compose/Kubernetes 启动方式和本地默认值见 [README.md](../README.md)。

### 2.2 运行时所有权

- `traffic-control-plane` 是运行目录、Fault Run 生命周期、运营审计和恢复语义的唯一所有者。
- Web/API 负责控制请求和查询，不负责后台调度。
- `traffic-control-plane-worker` 负责持续执行 Runner、场景 Worker、补给、到期恢复、留存和可选数据预热。
- Shopfront、Gateway 和 Java 业务服务只表达自然的消费者业务语义。
- Gateway 只接受代码中定义的固定 operation，不允许控制面提交任意 URL 或任意目标。
- 控制面发起的业务 HTTP 调用必须经过 Gateway；数据预热是唯一直接写入两个历史表的例外。

## 3. 仓库模块和职责

根 Maven 工程使用 Java 21、Spring Boot 3.5.x 和 Spring Cloud 2025.x。Java 服务通过 `common` 共享响应、认证、Trace、Redis 锁和审计等基础能力。前端和控制面是两个独立的 Next.js 应用。

### 3.1 应用模块

| 模块 | 技术栈 | 主要职责 |
| --- | --- | --- |
| `shopfront` | Next.js / React / TypeScript | 商品、购物车、结算、支付、订单、通知和账户页面；提供面向浏览器的 BFF |
| `gateway-service` | Spring Cloud Gateway | `/api/**` 路由、客户 JWT 校验、内部固定分发、Trace 透传、错误转换 |
| `user-service` | Spring Boot | 注册、登录、刷新/注销会话、用户资料、收货地址 |
| `catalog-service` | Spring Boot | 商品列表、商品详情、Redis 商品缓存、商品浏览报表 |
| `cart-service` | Spring Boot | 购物车读写、加购前商品校验、Checkout freeze |
| `inventory-service` | Spring Boot | 库存查询、预占、释放、确认、过期、补给以及表锁/行锁路径 |
| `order-service` | Spring Boot | Checkout 编排、订单查询/取消、支付结果处理、订单报表 |
| `payment-service` | Spring Boot | 支付意图、确认、重试、退款和 PSP 调用 |
| `promotion-service` | Spring Boot | 优惠券查询、促销计算、券预留/释放/确认和补给 |
| `risk-service` | Spring Boot | 黑名单、频率、金额风控以及支付后复核 |
| `fulfillment-service` | Spring Boot | 履约创建、发货状态、送达确认和履约时间线 |
| `notification-service` | Spring Boot | 支付/物流通知、通知查询、偏好设置和通知存储 |
| `psp-simulator` | Spring Boot | 独立支付提供方的授权、拒付和超时结果 |
| `traffic-control-plane` | Next.js / TypeScript | 运营控制台、控制 API、Fault Run 目录、状态机、审计和后台 Worker |
| `common` | Spring Boot library | `ApiResponse`、安全过滤器、Trace、Redis 分布式锁、数据审计等共享组件 |

### 3.2 控制面内部组成

`traffic-control-plane` 可按职责分为以下几层：

| 层次 | 代表位置 | 作用 |
| --- | --- | --- |
| 页面和 Route Handler | `src/app/**` | 运营登录、控制台展示和受保护 API |
| 领域和持久化 | `src/lib/**` | Catalog、运行协调器、状态仓储、配置、审计、MySQL/Redis 客户端 |
| Worker | `src/worker/**` | Runner、场景执行、补给、恢复、留存和数据预热 |
| 共享 UI/国际化 | `src/components/**`、`src/i18n/**` | 运行卡片、状态展示、操作确认和多语言消息 |

Web/API 和 Worker 必须作为两个进程运行。只启动 Web/API 不会启动 Runner、场景执行、恢复或数据预热。

## 4. 消费者业务链路

### 4.1 Shopfront 和 BFF

Shopfront 是消费者唯一的浏览器入口。页面调用集中在 `shopfront/src/lib/api.ts`，浏览器请求先发送到 Shopfront 的 `/api/**`，再由 BFF 转发到 Gateway。

BFF 的职责包括：

- 仅允许业务资源路径；
- 将 Gateway 地址隐藏在服务端；
- 管理 HttpOnly 认证 Cookie；
- 将非成功 HTTP 响应或业务 `code` 转成 `ShopApiError`；
- 拒绝 `/internal/**` 和路径穿越，避免消费者借 Shopfront 访问内部协议。

公开业务资源主要包括：

```text
/api/auth/**
/api/me/**
/api/products/**
/api/cart/**
/api/checkout
/api/orders/**
/api/payments/**
/api/notifications/**
```

### 4.2 Gateway

Gateway 是消费者和控制面业务调用的固定入口，主要职责为：

1. 根据 `/api/**` 路径将请求路由到固定服务；
2. 对客户资源校验 CUSTOMER JWT；
3. 清除客户端伪造的身份 Header，并为下游签发受保护的主体信息；
4. 生成或透传 `X-Trace-Id`；
5. 将下游网络错误、超时和 5xx 转换为统一业务响应；
6. 为控制面提供固定的 prepare、release、cleanup、observation 和补给分发。

控制面使用的内部 operation 由 Gateway 代码固定映射到服务和路径。例如：

```text
products-browse-report
    -> catalog-service
    -> /internal/catalog/reports/product-browse/prepare

orders-query-report
    -> order-service
    -> /internal/orders/reports/order-query/prepare

product-detail-cache
    -> catalog-service
    -> /internal/catalog/product-details/cache/prepare

provider-outcome
    -> psp-simulator
    -> /internal/psp/provider-outcome/prepare
```

控制面不会把场景身份或运营生命周期传给目标服务。内部协议只携带通用的 `operation`、不透明 `runId`、过期时间、幂等信息和 fencing 上下文。

### 4.3 登录和会话

```text
Shopfront
    -> Gateway /api/auth/login
    -> user-service
    -> access token + session token
    -> Shopfront HttpOnly cookies
```

Gateway 验证客户 JWT 的 issuer、audience、有效期和角色；随后使用仅供下游验证的短生命周期主体信息调用业务服务。业务服务通过 `common` 中的安全过滤器读取客户身份，不信任浏览器直接提交的身份 Header。

### 4.4 商品浏览和购物车

商品列表链路为：

```text
Shopfront -> Gateway -> catalog-service -> MySQL
```

列表支持分类、关键字、排序和分页。商品详情采用 cache-aside：

1. 根据当前缓存活动标记选择默认 Hash 或运行专属 Hash；
2. 从 Redis 读取 SKU；
3. 命中且内容有效时返回缓存；
4. 未命中、失效或 Redis 异常时回退 MySQL；
5. 回填缓存并返回缓存结果信息。

加购链路为：

```text
Shopfront
    -> Gateway
    -> cart-service
    -> catalog-service（校验商品存在且在售）
    -> MySQL carts / cart_items
```

Catalog 校验失败时，购物车不会先写入无效商品。Checkout freeze 使用 Redis value 和 TTL 标记一次结算占用，释放或消费时会校验对应 token。

### 4.5 Checkout 编排

Checkout 采用“本地事务 + 跨服务补偿”，不是分布式事务。典型顺序如下：

```text
1. 校验客户、购物车、版本、地址和幂等键
2. 按客户和幂等键查找是否已有订单
3. 冻结购物车
4. 批量读取商品并计算原价
5. 计算并预留优惠券
6. 执行风控预检查
7. 逐个预占库存
8. 创建 PENDING_PAYMENT 订单和订单明细
9. 保存地址快照
10. 消费购物车冻结并清空购物车
```

中途失败时，`order-service` 会尝试释放已经预占的库存、优惠券和购物车冻结。各服务通过幂等键、版本条件更新和状态机约束避免重复请求覆盖新状态。

### 4.6 支付、风控、履约和通知

支付主链路为：

```text
Shopfront / Runner
    -> payment-service
    -> psp-simulator（独立 HTTP）
    -> payment-service
    -> order-service（支付结果）
```

支付成功后，订单服务继续：

```text
确认库存
    -> 确认优惠券
    -> 支付后风控
    -> 创建履约或标记风控拒绝
    -> 发送通知
```

履约服务推进发货状态，并通过内部 HTTP 事件调用通知服务。当前系统没有 Kafka 或 RabbitMQ；`EventEnvelope` 表示的事件通过同步内部 HTTP 传递，并由共享组件做事件格式和来源校验。因此，下游不可用会直接影响上游请求，重试、去重和补偿由业务代码负责。

## 5. 控制面和受控运行

### 5.1 Catalog 是唯一事实来源

`traffic-control-plane/src/lib/fault-run-catalog.ts` 是受控运行的机器可读契约。每个条目定义：

- 场景标识和展示信息；
- 固定目标服务；
- 固定目标 operation；
- 参数类型及边界；
- 最大持续时间；
- 恢复策略；
- 是否允许人工清理。

当前有 12 个 catalog 场景：

| 类别 | 场景 | 真实业务或资源路径 |
| --- | --- | --- |
| 报表 | 商品浏览慢 SQL | Catalog 商品浏览报表扫描历史行为数据 |
| 报表 | 订单报表慢 SQL | Order 报表读取订单及明细历史数据 |
| 流量 | 浏览流量突增 | 经 Gateway 持续调用商品列表 API |
| 流量 | 订单查询突增 | 使用演示客户账号持续查询订单 |
| 缓存 | 商品详情 Redis Hash | 商品详情 API 读取运行级 Redis Hash |
| 依赖 | 购物车依赖失败 | 加购前的 Catalog 商品校验真实失败 |
| JVM | JVM 内存压力 | 通知路径保留高基数对象，产生真实堆压力 |
| 存储 | 通知存储增长 | 通知服务向运行级文件追加受限数据 |
| 数据库 | 促销锁竞争 | 优惠券相关事务产生真实锁竞争 |
| 数据库 | 库存表锁 | JDBC 会话持有 `inventories` 表写锁 |
| 数据库 | 库存行锁 | 事务对固定库存记录执行 `SELECT ... FOR UPDATE` |
| 外部依赖 | PSP 外部依赖 | Payment 经独立 PSP HTTP 客户端获得授权、拒付或超时 |

场景名称和控制字段只属于控制面及运营文档。消费者接口、业务服务日志、指标、Trace、错误信息和堆栈应保持普通业务语义。

### 5.2 Fault Run 生命周期

核心状态为：

```text
CREATING -> ACTIVE -> RECOVERING -> RECOVERED
                         |             ^
                         +-> STOPPED -+

创建或恢复失败时可能进入 FAILED；
目标服务健康失败时可能进入 SERVICE_UNAVAILABLE。
```

创建流程：

```text
校验 catalog 和参数
    -> 计算 expiresAt
    -> 写入 CREATING 记录
    -> 分配单调 fencingToken
    -> 经 Gateway 调用固定 prepare
    -> 成功转 ACTIVE，失败执行补偿并标记 FAILED
```

停止或到期恢复流程：

```text
清除本地 timer
    -> 转 RECOVERING
    -> drain 对应场景 Worker
    -> 经 Gateway 调用目标 release
    -> 成功转 STOPPED / RECOVERED
    -> 失败转 FAILED，保留恢复证据
```

数据库层通过活动运行唯一约束保证同一环境同时最多存在一个 `CREATING`、`ACTIVE` 或 `RECOVERING` 运行。创建、停止、清理和服务重启操作均要求运营会话、CSRF、确认、幂等键和审计记录。

### 5.3 Worker 模型

Worker 启动后依次加载配置、恢复中断运行、启动补给、启动场景执行器、启动到期扫描和留存任务，最后启动正常客户生命周期 Runner 和可选数据预热。

#### 正常客户生命周期

Runner 使用真实生命周期账号登录，不直接伪造用户身份。一次典型生命周期为：

```text
LOGIN
 -> BROWSE_CATALOG
 -> PRODUCT_DETAIL_READ
 -> CART_READ / ADD_CART_ITEM
 -> ADDRESS_READ 或 ADDRESS_CREATE
 -> COUPON_SELECT（可选）
 -> CHECKOUT
 -> QUERY_CREATED_ORDER
 -> PAYMENT_INTENT
 -> PAYMENT_CONFIRM
 -> QUERY_FINAL
 -> LOGOUT
```

Access token 和 session token 只保存在 Worker 进程内存中。Runner 配置通过 `version` 乐观锁更新，避免多个操作员或进程覆盖彼此的配置。

#### 场景 Worker

- 报表 Worker 持续调用真实商品浏览报表或订单查询报表；
- 流量 Worker 持续调用商品列表或客户订单查询；
- 资源 Worker 使用受限并发、间隔、取消信号和 drain；
- Worker 记录请求成功/失败/超时、延迟分位数和运行事件；
- 运行到期时必须先停止请求，再释放目标资源。

## 6. 数据和基础设施

### 6.1 MySQL

系统在部署上使用一个 MySQL 实例和 `castrel` 数据库，表按业务边界划分：

```text
身份：users、user_credentials、user_roles、user_addresses、session_tokens
商品/库存：products、inventories、inventory_reservations
交易：carts、cart_items、orders、order_items、payments
促销/风控：promotions、coupons、coupon_reservations、risk_rules、risk_events
履约/通知：fulfillments、shipment_timeline_events、customer_notifications
控制和运行：runner_profile、traffic_runs、fault_runs、fault_run_events、operator_audit_logs
预热：product_price_history、user_behavior_log、data_warmup_progress
```

逻辑上由各服务拥有自己的表和 Repository，但物理上共享数据库，因此数据库锁、连接池和 Schema 变更仍是全系统耦合点。`00-schema-ddl.sql`、`04-fault-run-schema.sql` 和 `05-warmup-partitions.sql` 分别承担业务表、控制面表和预热分区初始化。

### 6.2 Redis

Redis 同时承担缓存和协调状态：

- 用户会话和刷新辅助状态；
- Catalog 商品详情 Hash、活动 marker 和运行 owner；
- Cart checkout freeze；
- Promotion 幂等和券预留协调；
- Risk 黑名单和频率状态；
- Inventory reset lock 和运行 fencing；
- 控制面数据预热 lease 和留存 lease。

Redis 不是单纯的可选缓存。部分流程依赖其中的 TTL、token 校验、分布式锁或 lease 来保证安全释放和单实例执行。

### 6.3 文件系统

通知存储增长场景使用真实的非稀疏文件：

- 每次运行使用独立 UUID 文件；
- 写入前检查可用空间和最小剩余空间；
- 写入后调用 `FileChannel.force(true)`；
- 清理只删除符合运行 UUID 规则的文件。

因此，运行结束代表受控写入停止，不代表所有磁盘痕迹自动消失。允许清理的运行文件必须在终止后由确认式控制操作清理；JVM 对象保留则是明确的非释放型行为。

### 6.4 数据预热

数据预热用于为真实报表提供历史数据，是控制面唯一直接写业务表的功能。目标表为：

```text
product_price_history
user_behavior_log
```

默认支持的目标组合为：

```text
180 天 × 300,000 行/天 = 54,000,000 行
```

Worker 通过 Redis lease 取得写入权，使用 heartbeat 续租；发现 lease 丢失后停止写入。它还负责日分区滚动、进度记录、过期分区处理和陈旧手动作业恢复。`DATA_WARMUP_ENABLED=false` 只关闭预热，不会关闭 Runner、场景 Worker、恢复、补给或留存。

## 7. 补给、恢复和留存

### 7.1 业务数据补给

Worker 通过 Gateway 调用固定的内部补给 operation：

```text
Worker -> Gateway -> promotion-service
      -> 演示优惠券补给

Worker -> Gateway -> inventory-service
      -> 演示库存补给
```

补给使用批次记录和幂等约束，只处理配置范围内的演示数据，避免控制面直接修改业务表。

### 7.2 到期恢复

恢复有四个触发来源：

- 创建时注册的 `expiresAt` timer；
- Worker 周期扫描过期运行；
- Worker 启动时恢复重启前未完成的运行；
- 操作员手动停止。

恢复顺序固定为“先 drain Worker，再 release 目标”，以免释放发生后仍有旧请求写入资源。Java 目标服务使用 Redis fencing 和过期检查拒绝旧运行的迟到操作。

### 7.3 留存清理

控制面每天执行 retention，并通过 Redis lease 避免多实例重复清理。只清理已经结束、存在恢复结果且超过保留时间的运行记录；活动中、恢复中、服务不可用或恢复未完成的记录不会被删除。

## 8. 认证和安全边界

### 8.1 消费者边界

- 浏览器只能访问 Shopfront；
- Shopfront 只代理 allowlist 中的业务资源；
- `/internal/**` 不进入消费者路径；
- Gateway 不信任浏览器自带的内部身份 Header；
- 业务错误使用统一 envelope，不返回原始堆栈或控制面字段。

### 8.2 控制面边界

- 页面和控制 API 默认要求运营会话；
- 状态变更要求 CSRF；
- 创建、停止、清理和重启要求明确确认；
- 变更请求要求幂等键；
- Operator、动作、目标、参数摘要、结果和关联 ID 写入审计日志。

### 8.3 服务间边界

- Gateway 内部分发要求 `X-Internal-Service-Key`；
- 目标服务通过 Gateway 签发的下游主体或内部服务密钥验证来源；
- 内部上下文只传递通用 operation、runId、过期和 fencing 信息；
- 目标业务服务不解析 catalog 身份、运营状态或控制面生命周期。

## 9. 可观测性架构

### 9.1 指标

Java 服务统一暴露 Actuator health、info 和 Prometheus 指标。Prometheus 采集服务、MySQL、Redis 和主机指标，业务指标覆盖：

- 请求量、错误率和延迟；
- Checkout、支付、库存预占、优惠券和通知结果；
- JVM Heap、GC、线程池和连接池；
- MySQL 慢查询、锁和等待；
- Redis 内存和命令状态；
- 文件系统和节点资源。

### 9.2 日志

Java 服务输出结构化 JSON 日志并携带 `traceId`。Promtail 读取 Docker 日志后写入 Loki，敏感数据清洗器会处理邮箱、Bearer/token、password、secret 和 apiKey 等字段。

### 9.3 Trace

Gateway 和服务通过 `X-Trace-Id` 做应用级请求关联，并使用 OpenTelemetry Java Agent 将 Trace 发送到 Tempo。需要注意：`X-Trace-Id` 是应用自定义关联 ID，不应直接当作 Tempo 的 OTel Trace ID 使用。

### 9.4 告警和查询

Prometheus/Alertmanager 覆盖服务不可用、5xx、P99、JVM、数据库、Redis、支付、库存、风控、通知和节点资源等信号。Grafana 统一查询 Prometheus、Loki 和 Tempo；SkyWalking 是可选的 Compose profile，不属于 Kubernetes 默认部署栈。

## 10. 部署形态

### 10.1 Docker Compose

Compose 将应用、MySQL、Redis 和观测组件放入 `castrel-net`。控制面明确拆成：

```text
traffic-control-plane          Web/API
traffic-control-plane-worker   Runner、场景执行和后台维护
```

业务服务通常只在容器网络内可达，宿主机主要暴露 Shopfront、Gateway、Control Plane、数据库、Redis 和观测入口。Compose 默认会挂载 `data/` 持久化 MySQL、Redis、日志、Trace 和各服务运行数据。

### 10.2 Kubernetes

`k8s/kustomization.yaml` 组织应用、基础设施和观测组件。Control Plane Web/API 与 Worker 使用独立 Deployment；当前单副本是运行不变量，用于避免重复 Runner、场景执行、补给和本地 timer。

通知服务重启通过独立 `notification-restart-broker` 完成。Kubernetes 中该 broker 使用受限 ServiceAccount，只能读取和 patch 指定命名空间中的 `notification-service` Deployment，控制面本身不直接访问 Kubernetes API。

## 11. 关键不变量

1. 同一环境最多一个处于 `CREATING`、`ACTIVE` 或 `RECOVERING` 的 Fault Run。
2. 每个运行只能使用 catalog 定义的固定目标和参数，不能动态指定 URL 或批量目标。
3. 每次运行具有运行 ID、过期时间、幂等键和单调 fencing token。
4. 运行到期先停止 Worker，再释放目标资源。
5. `durationSec` 表示受控活动或 lease 的时长，不保证文件、数据库历史数据或 JVM 对象全部自动删除。
6. 控制面业务 HTTP 必须经过 Gateway；数据预热直接写表必须持有 Redis lease。
7. Runner 配置更新必须携带版本；库存 reset 必须携带期望版本并持有分布式锁。
8. 消费者请求不能访问内部协议，也不能看到场景标识、控制面生命周期或内部运行字段。
9. 共享数据库、Redis 和观测组件的开发默认配置不能直接用于共享环境。

## 12. 主要功能清单

从产品能力角度，本项目主要提供：

| 功能域 | 功能 |
| --- | --- |
| 消费者电商 | 用户认证、商品目录、缓存商品详情、购物车、Checkout、支付、订单、履约和通知 |
| 业务一致性 | 幂等键、库存预占/确认/释放、优惠券预留/确认/释放、风控和补偿 |
| 运营控制 | 运行目录、参数校验、运行状态、停止/恢复、人工清理、通知服务受限重启 |
| 真实异常路径 | 慢报表、流量突增、Redis 大值、依赖失败、JVM 堆压力、文件增长、锁竞争和 PSP 结果 |
| 运行流量 | 基于真实账号的客户生命周期 Runner、报表流量和订单查询流量 |
| 数据维护 | 优惠券/库存补给、历史数据预热、分区滚动、过期恢复和运行留存 |
| 可观测性 | Prometheus、Grafana、Loki、Tempo、Alertmanager、结构化日志和 Trace |
| 部署 | Docker Compose 本地/演示环境和 Kubernetes Kustomize 模板 |

## 13. 设计优点与当前注意事项

### 13.1 设计优点

- **边界清晰**：消费者、Gateway、业务服务和控制面职责分离。
- **效果可观察**：异常来自真实 HTTP、SQL、Redis、锁、文件和 PSP 路径。
- **可恢复**：数据库状态机、幂等键、fencing、lease、drain、到期扫描和补偿共同构成恢复闭环。
- **观测完整**：请求、服务、数据库、Redis、日志、指标、Trace 和告警可以串联分析。
- **单一事实来源**：受控运行的目标、参数和恢复策略集中在 catalog，避免多处复制。

### 13.2 当前实现注意事项

- 所有 Java 服务逻辑上按领域拆分，但物理上共享一个 MySQL 数据库，Schema 和资源竞争仍是全局耦合点。
- 服务间事件目前是同步内部 HTTP，不是消息队列；下游不可用会沿调用链传播。
- Control Plane Web/API 和 Worker 当前依赖单副本运行模型，扩容前需要重新评估重复流量、timer、补给和本地 Worker 协调。
- Compose/Kubernetes 模板含开发环境回退配置；共享或生产部署必须替换登录、会话、JWT、内部服务和观测凭据。
- PSP 超时和其他受控效果的最终表现取决于部署资源、连接池、JVM、数据库和网络；不能把场景描述成固定耗时或必然 OOM。

## 14. 推荐阅读顺序

1. [README.md](../README.md)：本地启动、配置、部署和验证。
2. [docs/microservice-topology.md](microservice-topology.md)：服务和端口速览。
3. [pom.xml](../pom.xml)：Java 模块边界。
4. [docker-compose.yml](../docker-compose.yml) 与 [k8s/kustomization.yaml](../k8s/kustomization.yaml)：部署拓扑。
5. `shopfront/src/lib/api.ts`、`shopfront/src/app/api/[...path]/route.ts`：消费者 BFF。
6. `gateway-service/src/main/resources/application.yml`：API 和内部 operation 路由。
7. `order-service/.../OrderService.java`、`payment-service/.../PaymentService.java`：交易主链路。
8. `traffic-control-plane/src/lib/fault-run-catalog.ts`：受控运行契约。
9. `traffic-control-plane/src/lib/fault-run-coordinator.ts` 与 `src/worker/index.ts`：生命周期和后台模型。
10. `infra/mysql/init/00-schema-ddl.sql`、`04-fault-run-schema.sql`、`05-warmup-partitions.sql`：数据和控制面表。
11. `infra/prometheus/`、`infra/loki/`、`infra/tempo/`、`infra/grafana/`：观测配置。

