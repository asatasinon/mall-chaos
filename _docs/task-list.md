# Castrel Shopfront 实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | 执行基线 |
| 版本 | 1.0 |
| 更新时间 | 2026-08-21 16:02 CST |
| 关联产品文档 | [product.md](product.md) |
| 关联技术设计 | [technical-design.md](technical-design.md) |

## 任务更新规则

1. 开始子任务时，将 `- [ ]` 更新为 `- [-]`；完成后更新为 `- [x]`。
2. 子任务完成后，立即更新所在阶段的“阶段进度”为“已完成子任务数 / 子任务总数”。
3. 只有所有子任务完成且阶段验收条件通过，才能将阶段状态更新为“已完成”。
4. 遇到实现问题时，先在对应阶段的“问题与解决方案”表追加记录；问题未关闭前，受影响实现子任务不得标记为完成。测试环境、服务器资源或部署窗口不足时，新增独立测试/验收子任务，不阻塞已经完成的实现子任务。
5. 子任务描述中的 API、状态机、事件与数据表以 [technical-design.md](technical-design.md) 为准；实现过程中发现设计冲突时，先更新设计文档和本清单，再改代码。
6. 每次更新 [task-list.md](task-list.md)、[product.md](product.md) 或 [technical-design.md](technical-design.md) 时，必须同步更新该文档“文档信息”中的“更新时间”为实际修改时间，格式为 `YYYY-MM-DD HH:mm TZ`；任务状态变更也属于文档更新。

## 阶段总览

| 阶段 | 目标 | 状态 | 进度 | 依赖 |
| --- | --- | --- | --- | --- |
| Phase 0 | 执行基线与环境准备 | 进行中 | 4 / 6 | 无 |
| Phase 1 | 安全、身份与网关边界 | 进行中 | 6 / 8 | Phase 0 |
| Phase 2 | Schema、购物车与商品读模型 | 进行中 | 5 / 6 | Phase 0、Phase 1 |
| Phase 3 | Checkout、库存、促销与支付 | 进行中 | 7 / 8 | Phase 1、Phase 2 |
| Phase 4 | 可靠事件、风控、履约与通知 | 进行中 | 0 / 8 | Phase 3 |
| Phase 5 | 控制面、完整 runner 与运维流程 | 未开始 | 0 / 5 | Phase 1、Phase 3、Phase 4 |
| Phase 6 | Shopfront、部署与端到端验收 | 未开始 | 0 / 5 | Phase 1 至 Phase 5 |

---

## Phase 0：执行基线与环境准备 - 进行中

**阶段进度**：5 / 6

**目标**：确定实现边界、测试基线和全新演示环境的运行方式，避免在旧数据或未定义契约上开始开发。

### T0.1 实现 backlog

复核产品规格、技术设计和当前实现后，确认以下差异需要按任务依赖顺序处理：

1. **Schema 与数据初始化**：当前 `infra/mysql/init/00-schema.sql` 仍是旧单商品模型，缺少 `schema_version`、多商品订单明细、购物车、会话/角色、支付尝试、Outbox/Inbox、履约时间线、客户通知、runner 活动和运营审计等 Version 1 契约；需要由 T0.3 统一重写。
2. **测试基线**：当前仓库未发现 Java、Next.js 或 Playwright 测试文件，也没有统一测试 Profile/命令；需要由 T0.2 建立并确保普通测试不启用故障注入。
3. **Schema 版本校验**：当前服务没有启动期 Schema 版本验证；需要由 T0.5 在就绪和业务流量入口前拒绝缺失或不匹配版本。
4. **身份与访问边界**：`user-service` 目前只有按路径读取用户/地址的旧接口，未实现注册登录、令牌撤销、角色和地址 CRUD；Gateway 目前仅配置旧订单/商品路由，未实现认证、身份头清洗、客户归属和内部服务认证。按 T1.1-T1.6 完成。
5. **购物车与商品读模型**：仓库没有 `cart-service` 模块；catalog 仍需扩展搜索、分页、媒体元数据和可售库存投影。按 T2.2-T2.5 完成。
6. **Checkout 与订单状态机**：订单服务仍接受客户端 `userId`、单个 `sku/qty`，并在同步请求中直接扣款；需要改为服务端归属的多商品 `CheckoutCommand`、购物车冻结、预占补偿、`PENDING_PAYMENT` 和版本条件状态转换。按 T3.1-T3.6 完成。
7. **支付后可靠事件链**：当前订单/支付模型没有按服务隔离的 Outbox/Inbox 和统一事件信封；需要按 T4.1-T4.7 实现支付结果、支付后风控、履约和通知链路。
8. **Runner 与消费者链路**：当前 runner 仅执行 `ORDER_SUCCESS`/`CANCEL_ORDER`，直接调用旧 `/api/orders` 并维护松散订单队列；需要按 T5.1-T5.4 改为经 Gateway 的客户白名单、服务凭据和完整购物流程编排。
9. **独立 Shopfront 与部署验收**：当前没有 `shopfront` 应用；需要按 T6.1-T6.4 新建消费者 BFF/UI，隔离入口和端口，并补齐端到端、安全、恢复和可观测性验收。

本 backlog 只记录现状与目标契约的差异，不在 T0.1 修改业务行为。

### 子任务

- [x] T0.1 复核 [product.md](product.md) 和 [technical-design.md](technical-design.md)，将所有现有实现与目标契约的差异记录为实现 backlog；不在本阶段修改业务行为。
- [x] T0.2 建立本地测试分层与命令：Java 单元测试、MySQL/Redis 集成测试、Next.js 类型检查/lint；测试 Profile 默认禁用故障注入。Playwright 和服务器验收另列为 T0.6。
- [x] T0.3 重写 `infra/mysql/init/00-schema.sql` 为 Version 1 全新 Schema 的唯一来源，并新增 `schema_version` 与启动期版本校验约定。
- [-] T0.4 编写运维重置 Runbook：运维手工停止全部业务服务、Gateway、worker 和外部流量，清除 MySQL/Redis 数据目录，重新启动、初始化、健康检查，最后恢复 runner；明确它与 inventory reset 的区别。
- [x] T0.5 在 `common` 实现 schema version verifier，各服务在健康就绪和流量处理前校验期望版本；补充版本正确、缺失和不匹配三组集成测试，版本错误时拒绝就绪和流量。
- [ ] T0.6 执行 Phase 0 测试与环境验收：Playwright 基线、完整重置演练、全栈健康检查、Redis/runner 队列清理和服务器部署验证。

**涉及文件**：

- `infra/mysql/init/00-schema.sql`
- `docker-compose.yml`
- `scripts/compose-down.sh`
- `scripts/compose-up.sh`
- `README.md`
- `common/src/main/java/com/castrel/chaos/common/`（计划新增 schema verifier）
- `*/src/main/resources/application.yml`
- `*_service/src/test/`、`traffic-control-plane/src/**/*.test.ts`、`shopfront/tests/`（计划新增测试目录）

### T0.3 验收结果

已在唯一初始化入口加入 `schema_version` Version 1 记录，并补齐购物车、多商品订单明细/地址快照、身份会话、支付尝试、库存/优惠券预留、按服务 Outbox/Inbox、履约、通知、runner 活动和运营审计表。真实 MySQL 全新目录初始化已通过：Schema 版本为 1，演示凭据/角色/购物车均有 2 条，Outbox/Inbox 各 5 张，Redis 初始键数为 0。旧 `orders.sku/qty` 字段保留为兼容适配字段，不作为新结算事实来源。

### T0.4 当前进展

已新增 [environment-reset.md](../docs/runbooks/environment-reset.md)，覆盖停流、停止业务服务/Gateway/worker、清空 MySQL/Redis 数据目录、重新初始化、Schema/Redis 校验、健康检查和最后恢复 runner，并明确与 inventory reset 的边界。已完成当前运行集的基础设施演练：停止并移除 user-service、MySQL、Redis，重建数据目录后 MySQL 初始化为 Version 1、Redis 为 0。由于本次环境中 Gateway、其余业务服务和 runner 原本未启动，完整全栈停止与 runner 恢复仍待执行，因此 T0.4 保持进行中。

### T0.5 验收结果

`common` 已新增 `SchemaVersionHealthIndicator`：查询失败、`schema_version` 行缺失或版本不匹配时返回 DOWN；九个持久化业务服务的 readiness group 已包含 `schemaVersion` 和 `readinessState`。单元测试和真实 user-service 验证均通过：版本正确返回 HTTP 200/UP，记录缺失和版本不匹配返回 HTTP 503/DOWN，恢复 Version 1 后重新返回 HTTP 200/UP。重复验证脚本为 [schema-version-smoke-test.sh](../scripts/schema-version-smoke-test.sh)。

### 阶段验收条件

- 全新数据目录可初始化，且 Schema 版本、演示客户、角色、地址、商品、库存、优惠券与 runner 配置齐全。
- 测试命令和测试 Profile 可在本地环境执行；故障注入不会在普通测试中自行启动。
- 运维重置 Runbook 经一次人工演练验证，重置后不存在旧 Redis 幂等键或 runner 队列。
- schema version 缺失或不匹配时，服务未就绪且拒绝业务流量；版本正确时服务正常就绪。

### 问题与解决方案

| 编号 | 日期 | 问题 | 影响任务 | 解决方案 | 状态 |
| --- | --- | --- | --- | --- | --- |
| P0-001 | 2026-08-20 | Java verifier、MySQL/Redis 集成、控制面 typecheck 和 lint 均已通过；lint 保留 64 条既有 warning，Shopfront 尚未创建，暂无 Playwright 场景。 | T0.6 | 本地测试命令已由 T0.2 收口；Shopfront 创建后在 T0.6 接入 Playwright，并逐步清理 lint warning。 | 进行中 |
| P0-003 | 2026-08-20 | Apple Silicon 上 Compose 使用 amd64 Java 镜像，完整业务栈启动非常慢；Cloudwise/OTel agents 默认开启时服务卡在 agent 初始化，关闭 agents 后仍有服务超过 150 秒才完成 Spring 启动，控制面尚未进入运行状态。 | T0.4 | 已用 `ENABLE_CLOUDWISE_AGENT=false ENABLE_OTEL_AGENT=false` 建立本地验证方式；待完整服务栈健康后再执行停机、重建数据和 runner 恢复，当前不将 T0.4 标记完成。 | 未关闭 |
| P0-002 | 2026-08-20 | 初始验证时 MySQL 未运行，且旧 Runbook 的通配符清理可能遗漏隐藏数据文件。 | T0.3、T0.4 | 已启动 MySQL/Redis 完成全新初始化验证；将 Runbook 改为删除并重建整个数据目录。真实版本故障测试已完成，Runbook 全流程演练仍待完成。 | 部分关闭 |

---

## Phase 1：安全、身份与网关边界 - 进行中

**阶段进度**：7 / 8

**目标**：在公开消费者功能之前建立客户、运营人员、runner 与服务间调用的可信身份链和网络边界。

### 子任务

- [x] T1.1 在 `user-service` 实现客户注册、登录、刷新、登出、个人资料及地址 CRUD；使用 BCrypt，新增 `CUSTOMER`、`OPERATOR` 角色和会话/令牌撤销能力，并支持默认地址设置、切换和删除后的回退规则。
- [x] T1.2 定义并实现客户/运营令牌契约：`iss`、`aud`、`sub`、角色、签发时间、过期时间和令牌 ID；Shopfront 的 HttpOnly、Secure、SameSite=Lax Cookie 集成由 T6.1 实现。
- [x] T1.3 在 `gateway-service` 实现认证过滤器、角色授权、身份头清洗与可信下游主体声明；拒绝伪造 `X-User-Id` / `X-User-Role`。
- [x] T1.4 定义并实现 `TRAFFIC_RUNNER` 服务凭据校验：网关检查客户白名单版本、`aud=gateway-service`、动作 scope 与有效期，并由网关生成短期下游主体声明；控制面不得签发客户令牌。
- [x] T1.5 为 `traffic-control-plane` 的全部变更型 `/internal/**` Route Handler 添加统一 `OPERATOR` 鉴权和 `operator_audit_logs` 审计；限制 Ingress 和 Compose 端口，禁止消费者入口访问内部路径。
- [x] T1.6 实现 Gateway 至业务服务的内部服务认证：下游主体声明验签、Compose 共享服务密钥注入与轮换、Kubernetes 配置接入。
- [ ] T1.7 编写并执行 Phase 1 自动化安全测试：客户/运营/runner 未认证、角色授权、身份头清洗、客户归属、JWT 声明、下游主体声明和内部直连拒绝；测试失败不回退已完成实现任务。
- [ ] T1.8 在服务器环境执行 Phase 1 部署验收：Ingress/Compose 入口隔离、Secret 轮换、全部服务内部调用、`operator_audit_logs` 落库、runner 白名单和完整拒绝矩阵。

**涉及文件**：

- `common/src/main/java/com/castrel/chaos/common/`（计划新增安全主体与声明组件）
- `user-service/src/main/java/com/castrel/chaos/user/`
- `gateway-service/src/main/java/com/castrel/chaos/gateway/`
- `gateway-service/src/main/resources/application.yml`
- `traffic-control-plane/src/app/internal/`
- `traffic-control-plane/src/lib/gateway-client.ts`
- `traffic-control-plane/src/lib/`（计划新增运营会话、鉴权与审计组件）
- `docker-compose.yml`
- `k8s/ingress/`、`k8s/services/`
- `k8s/secrets/`、`k8s/configmap/`

### 阶段验收条件

- 未认证客户、运营人员、runner 和伪造身份头均被拒绝。
- 客户只能访问自己的资源；业务服务不再作为公开入口。
- `TRAFFIC_RUNNER` 仅能代表演示客户白名单执行允许的客户动作，不能访问 `/internal/**`、运营能力或任意客户数据。
- 所有控制面变更操作都有可查询审计记录。
- 每个客户仅有一个默认地址；默认地址切换、删除回退和跨用户修改均符合归属规则。
- 直连、伪造或未认证的内部服务调用均无法获得可信主体上下文。

### T1.1 验收结果

`user-service` 已实现 BCrypt 凭据、`CUSTOMER`/`OPERATOR` 角色种子、可撤销会话持久化、注册、登录、刷新、登出、个人资料更新和地址归属 CRUD；默认地址切换及删除回退规则已实现。运行验证归入 T1.7/T1.8。

### T1.2 验收结果

`common` 已实现 JWT 签发/验签组件，令牌包含 `iss`、`aud`、`sub`、`roles`、`iat`、`exp` 和 `jti`；`user-service` 返回短期 access token，并保留可撤销 session token 作为刷新凭据。Shopfront Cookie 不属于 user-service 实现范围，已转交 T6.1。

### T1.3 验收结果

`gateway-service` 已实现客户认证 GlobalFilter、CUSTOMER 角色授权、身份头清洗、用户资料/地址路由和短期 `actor=GATEWAY` 下游主体声明；有效但不含 `CUSTOMER` 角色的 token 返回 HTTP 403，伪造身份头不会透传。实现切片已通过 Gateway 编译，自动化安全测试移至 T1.7，服务器跨服务验收移至 T1.8。

### T1.4 验收结果

`common` 已实现 `TRAFFIC_RUNNER` 凭据验签，要求 `aud=castrel-gateway-service`、`actor=TRAFFIC_RUNNER`、有效 `exp`、`customerId`、`whitelistVersion` 和 `customer_api` scope；Gateway 从 `CASTREL_RUNNER_WHITELIST_VERSION` 读取期望版本并生成短期下游主体声明，控制面只发送环境注入的 runner 凭据，不签发客户 token。密钥轮换和 scope 验收归入 T1.7/T1.8。

### T1.5 验收结果

`traffic-control-plane` 已实现 fail-closed 的 `/internal/**` middleware、运营凭据校验、混沌/runner/库存重置/告警变更审计和参数 SHA-256 摘要；Compose 已移除业务服务宿主机端口，仅保留基础设施、Gateway 和控制面入口。服务器入口和审计落库验证归入 T1.8。

### T1.6 验收结果

`common` 已实现 Servlet 业务服务的 `DownstreamPrincipalFilter`，Gateway 混沌分发和 order-service 下游客户端已接入声明传递；Compose 要求显式 `CASTREL_JWT_SECRET`，Kubernetes Secret/ConfigMap 已补充 JWT 配置，RestTemplate 客户端共享透传下游主体。服务器直连/伪造声明验证归入 T1.7/T1.8。

### T1.7 测试任务

待独立完成，不反向阻塞已完成的实现任务。测试范围包括：客户 JWT 401/403、伪造身份头清洗、客户资源归属、runner audience/scope/whitelistVersion、运营 middleware fail-closed、审计落库、下游声明缺失/过期/篡改和业务服务内部直连拒绝。

### T1.8 服务器验收任务

待服务器部署后执行，不在本地资源不足时阻塞代码实现。验收范围包括：Ingress 和 Compose 端口隔离、JWT secret/runner credential/operator token 轮换、全部业务服务启动、所有内部客户端声明传递、runner 白名单限制和 `operator_audit_logs` 查询。

### 问题与解决方案

| 编号 | 日期 | 问题 | 影响任务 | 解决方案 | 状态 |
| --- | --- | --- | --- | --- | --- |
| - | - | 暂无 | - | - | - |

---

## Phase 2：Schema、购物车与商品读模型 - 进行中

**阶段进度**：4 / 6

**目标**：建立多商品订单所需数据模型、持久化购物车和可供消费者/runner 共用的商品读模型。

### 子任务

- [x] T2.1 在全新初始化 Schema 中创建并规范化 `users`、`user_addresses`、`user_credentials`、`user_roles`、会话令牌、`orders`、`order_items`、`order_address_snapshots` 和相关索引/唯一约束；`user_addresses` 具备每客户默认地址唯一性约束，`order_items` 是订单明细唯一事实来源。
- [x] T2.2 新增 `cart-service` Maven/Spring Boot 模块，接入父 POM、Docker Compose 与 Gateway；实现客户归属的 `carts`、`cart_items` 及版本字段。
- [x] T2.3 实现购物车公开 API：查询、加购、改数量、删除、清空；使用 JPA 版本号处理并发修改，并校验商品数量。
- [x] T2.4 实现 Redis Checkout 冻结协议：`cart:checkout-freeze:{checkoutId}`、`SET NX`/Lua 原子版本校验、冻结令牌、TTL、幂等释放和成功后按令牌消费匹配版本购物车行。
- [x] T2.5 扩展 `catalog-service`：关键字/分类/排序/分页、稳定商品 DTO、商品媒体元数据与可售库存投影；统一 BFF 对分页响应的规范化。
- [ ] T2.6 编写并执行 Phase 2 测试：购物车客户归属、版本冲突、并发冻结、冻结 TTL/幂等释放、商品分页稳定性和不可售商品拒绝。

**涉及文件**：

- `pom.xml`
- `cart-service/`（计划新增 Maven 模块）
- `catalog-service/src/main/java/com/castrel/chaos/catalog/`
- `inventory-service/src/main/java/com/castrel/chaos/inventory/`
- `infra/mysql/init/00-schema.sql`
- `gateway-service/src/main/resources/application.yml`
- `docker-compose.yml`
- `k8s/services/`、`k8s/kustomization.yaml`
- `traffic-control-plane/src/lib/gateway-client.ts`

### 阶段验收条件

- 全新初始化环境拥有所有用户、购物车和多商品订单基础表及种子数据。
- 同一客户可持久化管理购物车；不同客户无法读取或修改彼此购物车。
- 并发购物车修改和相同版本的并发冻结不会造成重复结算；冻结过期不会影响已落库订单。
- 商品读取 API 对客户和 runner 返回一致、稳定的分页与可售状态。

### 问题与解决方案

| 编号 | 日期 | 问题 | 影响任务 | 解决方案 | 状态 |
| --- | --- | --- | --- | --- | --- |
| - | - | 暂无 | - | - | - |

---

## Phase 3：Checkout、库存、促销与支付 - 进行中

**阶段进度**：6 / 8

**目标**：实现从冻结购物车到创建待支付订单、模拟支付及库存/优惠券一致性处理的完整交易核心。

### 子任务

- [x] T3.1 实现 `POST /api/checkout` 与 `CheckoutCommand`：接收 `cartId`、`cartVersion`、`addressId`、`couponId`、`idempotencyKey`，从可信主体推导客户，拒绝客户端金额和商品明细。
- [x] T3.2 实现 checkout 同步链路：购物车冻结、商品权威价格校验、优惠券校验/预留、支付前风控、按订单预占库存、失败逆序幂等补偿、成功后创建 `PENDING_PAYMENT` 订单和地址/订单明细快照。
- [x] T3.3 实现库存预占状态机和 `reservationId` / `operationId` 幂等约束：`reserve`、`confirm`、`release` 互斥且可重放；禁止以 `SKU + quantity` 直接释放。
- [x] T3.4 实现支付意图创建、模拟支付确认、查询和重试；支付尝试区分 `SUCCESS`、不可重试 `FAILED` 与须对账的 `UNKNOWN`，并确保预占到期后的重试先重新原子预占。
- [x] T3.5 为订单增加 `version` 条件更新，完成支付成功、客户取消、预占到期三方竞争裁决；每次仅允许一个终态转换成功，其余流程读取终态后停止或补偿。
- [x] T3.6 实现客户订单 API：个人订单分页、详情、待支付订单取消、支付意图/确认/查询和重试；保留旧 `POST /api/orders` 仅作单商品 API 回归兼容，不作为 runner 主路径。
- [x] T3.7 实现仅限 `OPERATOR` / 测试身份的模拟退款：幂等将支付尝试转为 `REFUNDED`，写入审计和关联 ID，并定义退款后订单、库存、优惠券、履约和通知的补偿边界；客户公开 API 不得触发退款。
- [ ] T3.8 编写并执行 Phase 3 交易测试：checkout 幂等、库存/优惠券补偿、支付成功/失败/未知、支付重试、取消/到期竞争、退款越权和重复退款。

**涉及文件**：

- `order-service/src/main/java/com/castrel/chaos/order/`
- `payment-service/src/main/java/com/castrel/chaos/payment/`
- `inventory-service/src/main/java/com/castrel/chaos/inventory/`
- `promotion-service/src/main/java/com/castrel/chaos/promotion/`
- `risk-service/src/main/java/com/castrel/chaos/risk/`
- `catalog-service/src/main/java/com/castrel/chaos/catalog/`
- `cart-service/`（计划新增模块）
- `infra/mysql/init/00-schema.sql`
- `gateway-service/src/main/resources/application.yml`
- `traffic-control-plane/src/app/internal/`

### 阶段验收条件

- checkout 只创建 `PENDING_PAYMENT` 多商品订单，且订单快照不受后续商品、价格、地址或购物车变化影响。
- 重复 checkout、重复确认、支付失败、未知支付对账、库存不足、优惠券不符合条件和取消场景均无重复扣减或库存泄漏。
- 支付成功、取消和预占到期并发时，订单、库存、优惠券最终状态一致。
- checkout 服务拓扑与 [technical-design.md](technical-design.md) 的“Checkout 同步服务拓扑”一致。
- 未授权客户无法退款；重复模拟退款幂等，且退款后的订单、库存、优惠券、履约和通知行为符合定义边界。

### 问题与解决方案

| 编号 | 日期 | 问题 | 影响任务 | 解决方案 | 状态 |
| --- | --- | --- | --- | --- | --- |
| - | - | 暂无 | - | - | - |

---

## Phase 4：可靠事件、风控、履约与通知 - 进行中

**阶段进度**：0 / 8

**目标**：以服务私有 Outbox/Inbox 完成支付后的可靠事件链，确保风控通过后才履约。

### 子任务

- [-] T4.1 为 order、payment、risk、fulfillment、notification 服务创建各自 `*_outbox_events` 与 `*_inbox_events` 表、发布器、Inbox 去重和租约/重试机制；任何服务不得读写其他服务的事件表。
- [-] T4.2 实现 `payment-service -> PAYMENT_RESULT -> order-service`：支付状态与 `payment_outbox_events` 同事务写入；订单 Inbox 去重后裁决订单、库存和优惠券，并发布 `ORDER_PAID` 或 `ORDER_PAYMENT_FAILED`。
- [ ] T4.3 实现支付后风控事件链：`risk-service` 只消费 `ORDER_PAID`，发布 `POST_PAYMENT_RISK_PASSED` 或 `POST_PAYMENT_RISK_REJECTED`；拒绝结果触发订单规定补偿和客户通知。
- [ ] T4.4 实现履约和物流：`fulfillment-service` 只消费 `POST_PAYMENT_RISK_PASSED` 创建发货单和时间线，发布 `SHIPMENT_UPDATED`；实现演示发货、客户确认签收以及 `FULFILLING -> SHIPPED -> COMPLETED` 的幂等状态转换，不得直接消费支付成功事件。
- [ ] T4.5 定义并实现统一版本化事件信封：`eventId`、`eventType`、`aggregateId`、`aggregateVersion`、`occurredAt`、schema version、`traceparent` / `traceId`、`trafficRunId`；缺字段拒绝消费，重放保留原始信封。
- [ ] T4.6 实现通知偏好、客户通知记录、`GET/PATCH /api/notifications` 分页/已读 API 和事件订阅；通过 Gateway 强制客户归属。
- [ ] T4.7 实现业务可观测性和隐私安全：`checkout_total`、结算耗时、`cart_item_mutation_total`、`inventory_reservation_total`、`payment_attempt_total`、Outbox 延迟/失败、`fulfillment_transition_total`、`customer_api_error_total`；统一关联 ID、稳定错误码和日志/指标/链路中的 PII、令牌、密码及模拟支付密钥脱敏。
- [ ] T4.8 编写并执行 Phase 4 可靠性与隐私测试：Outbox/Inbox 重复投递、租约恢复、死信重放、事件版本兼容、风控门禁、通知归属、指标/链路关联和敏感信息脱敏。

**涉及文件**：

- `order-service/src/main/java/com/castrel/chaos/order/`
- `payment-service/src/main/java/com/castrel/chaos/payment/`
- `risk-service/src/main/java/com/castrel/chaos/risk/`
- `fulfillment-service/src/main/java/com/castrel/chaos/fulfillment/`
- `notification-service/src/main/java/com/castrel/chaos/notification/`
- `inventory-service/src/main/java/com/castrel/chaos/inventory/`
- `promotion-service/src/main/java/com/castrel/chaos/promotion/`
- `common/src/main/java/com/castrel/chaos/common/`
- `infra/mysql/init/00-schema.sql`
- `gateway-service/src/main/java/com/castrel/chaos/gateway/`
- `gateway-service/src/main/resources/application.yml`

### 阶段验收条件

- 每项跨服务副作用有唯一发布者、唯一的本地 Outbox 所有者与幂等消费者。
- 支付成功不能绕过支付后风控创建履约；重复投递不会创建重复履约或通知。
- 在 payment/order/risk/fulfillment 任一服务短暂不可用后，事件可恢复投递并在 Tempo 中关联原交易链路。
- 死信重放使用原 `eventId`，不会产生重复业务副作用。
- 事件信封缺字段会被拒绝，版本可识别且重放保持原始事件标识和关联上下文。
- 演示签收可使订单幂等进入 `COMPLETED`，重复签收不重复写时间线或通知。
- Prometheus 可查询所有规定业务指标；日志、指标和链路中不包含邮箱、电话、地址、令牌、密码或支付模拟密钥。

### 问题与解决方案

| 编号 | 日期 | 问题 | 影响任务 | 解决方案 | 状态 |
| --- | --- | --- | --- | --- | --- |
| - | - | 暂无 | - | - | - |

---

## Phase 5：控制面、完整 runner 与运维流程 - 未开始

**阶段进度**：0 / 5

**目标**：使 `traffic-control-plane` 通过完整消费者流程生成可观测流量，并保留安全的运营能力。

### 子任务

- [ ] T5.1 新增 `TrafficActionOrchestrator`，由 `RunnerEngine` 进程内调用；从演示客户白名单选择客户，生成 `trafficRunId`、动作 ID、结算幂等键和受控支付策略，并经 `GatewayClient` 调用客户 API。
- [ ] T5.2 重构 `RunnerEngine` 动作与状态队列：实现 `BROWSE_PRODUCT`、`SEARCH_CATALOG`、`ADD_CART_ITEM`、`UPDATE_CART_ITEM`、`CHECKOUT`、`PAYMENT_CONFIRM`、`CANCEL_PENDING_ORDER`、`QUERY_ORDER`、`QUERY_SHIPMENT`；只取消已记录的待支付订单，只查询已支付订单物流。
- [ ] T5.3 实现 `traffic_runs`、`traffic_actions` 持久化与活动记录，关联演示客户、购物车版本、订单、支付、动作、结果、耗时、错误码和 `traceId`；移除 runner 向旧 `/api/orders` 直接提交 `userId` 及已支付订单取消队列的旧行为。
- [ ] T5.4 更新控制台的 runner 配置、状态、活动和错误展示，支持动作比例、商品数量、支付成功/失败/未知比例和取消比例；确保内部控制面变更动作经过 Phase 1 的 `OPERATOR` 鉴权和审计。
- [ ] T5.5 编写并执行 Phase 5 runner/运维测试：客户白名单、动作状态队列、只取消待支付订单、重置后队列清理、配置乐观锁、控制面审计和完整 Gateway 流量链路。

**涉及文件**：

- `traffic-control-plane/src/worker/runner-engine.ts`
- `traffic-control-plane/src/worker/`（计划新增 `traffic-action-orchestrator.ts`）
- `traffic-control-plane/src/lib/runtime-state.ts`
- `traffic-control-plane/src/lib/runner-config.ts`
- `traffic-control-plane/src/lib/gateway-client.ts`
- `traffic-control-plane/src/app/runner/`
- `traffic-control-plane/src/app/internal/traffic/`
- `traffic-control-plane/src/components/`
- `infra/mysql/init/00-schema.sql`

### 阶段验收条件

- runner 经网关产生浏览、购物车、checkout、支付、风控、履约、通知和查询流量，不再走旧单 SKU 直下单路径。
- 每次 runner 动作都能关联 `trafficRunId`、客户、订单/支付、结果、耗时和完整 trace。
- runner 不会取消已支付订单，不会读取演示客户池外数据，也不会在 Redis/MySQL 重置后保留无效队列。

### 问题与解决方案

| 编号 | 日期 | 问题 | 影响任务 | 解决方案 | 状态 |
| --- | --- | --- | --- | --- | --- |
| - | - | 暂无 | - | - | - |

---

## Phase 6：Shopfront、部署与端到端验收 - 未开始

**阶段进度**：0 / 5

**目标**：交付独立消费者前台、部署隔离和完整业务/混沌验收。

### 子任务

- [ ] T6.1 新建独立 `shopfront` Next.js 应用及 BFF：实现会话处理、强类型网关客户端、商品列表/详情、购物车、结算、支付结果、账户资料、地址、订单、物流和通知路由。
- [ ] T6.2 实现消费者界面状态：商品不可售、购物车版本冲突、库存不足、价格/优惠券变化、支付失败/未知、风控拒绝、履约进度和可恢复故障提示；不得暴露内部服务地址或敏感错误细节。
- [ ] T6.3 更新 Docker Compose、镜像构建、Kubernetes、Ingress 和 README：独立部署 `shopfront` 与 `traffic-control-plane`，只公开 Gateway/前台入口，业务服务端口保持私有。
- [ ] T6.4 建立跨模块自动化验收套件：后端集成测试、Playwright 场景、身份/归属越权、支付竞争、Outbox/Inbox 恢复、runner 全链路和 `scripts/chaos/chaos-verify.sh` 执行编排。
- [ ] T6.5 执行 Phase 6 发布验收：注册至订单签收完成、资料/默认地址、通知已读、退款越权/幂等、指标/链路/脱敏、部署隔离和恢复流程。

**涉及文件**：

- `shopfront/`（计划新增独立 Next.js 应用）
- `traffic-control-plane/`
- `docker-compose.yml`
- `scripts/build-all.sh`
- `scripts/chaos/chaos-verify.sh`
- `k8s/ingress/`、`k8s/services/`、`k8s/kustomization.yaml`
- `README.md`
- `*/src/test/`、`shopfront/tests/`、`traffic-control-plane/src/**/*.test.ts`

### 阶段验收条件

- 消费者可完成注册/登录、浏览、购物车、多商品 checkout、模拟支付、订单查看和物流追踪。
- 消费者前台、Gateway、控制台和业务服务按设计隔离部署；消费者无法访问运营/内部端点。
- 自动化验收覆盖关键一致性、安全和故障恢复场景；runner 与现有混沌验证均可运行。

### 问题与解决方案

| 编号 | 日期 | 问题 | 影响任务 | 解决方案 | 状态 |
| --- | --- | --- | --- | --- | --- |
*** End Patch