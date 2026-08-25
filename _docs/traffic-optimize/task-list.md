# 流量生命周期优化实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | 待实施 |
| 版本 | 1.0 |
| 更新时间 | 2026-08-25 CST |
| 关联规格 | [product.md](product.md) |
| 关联设计 | [technical-design.md](technical-design.md) |

## 任务规则

1. 开始任务时将 `- [ ]` 改为 `- [-]`；通过验收后改为 `- [x]`。
2. 每个任务完成后更新本文件的阶段进度和文档更新时间。
3. 业务请求必须经 `gateway-service`；worker 和 runner 禁止直接访问业务服务或直接写业务表。
4. 常规生命周期不制造支付失败/未知、库存耗尽、商品下架、价格变化、券争用或下游异常；这些结果仅由有 `faultScenarioId` 的故障注入场景产生并单独记录。
5. 不记录或返回密码、access token、session token、refresh token 或原始 authorization header。
6. 旧库存 reset 不属于本方案。实现期间不能移除既有运维 reset 能力，但新生命周期、worker 调度和控制台不得依赖它。

## 阶段总览

| 阶段 | 目标 | 状态 | 进度 | 前置依赖 |
| --- | --- | --- | --- | --- |
| A | 契约、Schema 与安全边界 | 待开始 | 0 / 10 | 无 |
| B | 优惠券和库存基线补齐 | 待开始 | 0 / 8 | A |
| C | 真实登录客户生命周期 | 待开始 | 0 / 10 | A、B |
| D | Worker 串行调度与可观测性 | 待开始 | 0 / 8 | B、C |
| E | 控制台、验证与迁移 | 待开始 | 0 / 5 | A 至 D |

---

## Phase A：契约、Schema 与安全边界

**阶段进度：0 / 10**

目标：先建立可路由、可鉴权、可持久化的契约，禁止 runner 为获得客户资源绕开 Gateway 或猜测数据。

### A1. 生命周期配置与活动 Schema

- [ ] 在 `runner_profile` 或等价配置表加入 `traffic_mode`、`lifecycle_interval_sec`、`successful_payment_ratio`、`coupon_usage_ratio` 和 `background_actions_enabled`。
- [ ] `lifecycle_interval_sec` 仅接受 `60`、`30`、`20`、`10`，保留配置 `version` 乐观锁。
- [ ] 为 `traffic_actions` 增加 nullable `lifecycle_id`，为 `(traffic_run_id, lifecycle_id, created_at)` 建索引；父记录使用 `CUSTOMER_LIFECYCLE`，子步骤保留稳定动作类型。
- [ ] 增加运行补齐状态持久化或等价可查询记录：窗口 ID、操作类型、状态、开始/完成时间、重试次数、结果摘要和关联 ID；禁止保存秘密。
- [ ] 更新初始化 SQL、数据访问层和配置 DTO；保留旧字段的兼容读取或安排一次明确的全新初始化。

### A1-V. 生命周期配置与活动 Schema 验证

- [ ] 验证非法间隔或比例被服务端拒绝；并发配置更新只有一个成功；生命周期父子记录可按 `lifecycleId` 查询；活动/补齐记录无秘密字段。

### A2. Gateway 路由与权限矩阵

- [ ] 增加 `/api/me/coupons/** -> promotion-service` 的精确路由，沿用 CUSTOMER bearer token 验证、身份头清洗和可信下游主体声明。
- [ ] 增加 `/internal/gateway/promotions/demo-coupons/replenish -> promotion-service` 和 `/internal/gateway/inventory/demo-stock/replenish -> inventory-service` 的内部调度路由。
- [ ] 内部调度路由只接受 traffic-control-plane 的内部服务认证；拒绝 CUSTOMER token、浏览器请求、Shopfront、公开 Ingress 和任何自定义客户/SKU/数量参数。
- [ ] 确认路由优先级不会被通用 `/api/**` 或 `/internal/**` 路由遮蔽。
### A2-V. Gateway 路由与权限矩阵验证

- [ ] 为客户券查询、补券、补库存三种路径编写并执行 Gateway 鉴权、路由和直连拒绝测试，验证客户仅能经 Gateway 获取自身券、worker 内部命令到达正确服务，以及全部越权/直连尝试被拒绝。

### A3. 客户优惠券查询 API

- [ ] 在 promotion-service 增加 `GET /api/me/coupons?status=AVAILABLE`，仅从可信主体获取 customer ID。
- [ ] 定义稳定 Coupon DTO：`id`、promotion 类型、名称、最低金额、折扣/减免、过期时间和可用状态；不得返回其他客户数据。
- [ ] 过滤已使用、已预留、已过期或关联促销失效的券；列表只作为候选，checkout 保持最终校验权威性。
- [ ] 实现 `couponId == null` 为明确无券：不得自动选择、预留或消耗第一张可用券。
- [ ] 修正 COUPON 满减与 DISCOUNT 折扣的金额计算，并保证最低应付金额规则不变。

### A3-V. 客户优惠券查询 API 验证

- [ ] 验证无券 checkout 不产生优惠券预留、客户无法读取他人券、满减和折扣优惠金额正确，以及过期券不显示也不能结算。

### A4. 优惠券原子预留与释放

- [ ] 将非空 `couponId` 的检查、归属校验、过期校验、促销启用/门槛校验和 `AVAILABLE -> RESERVED` 状态转换做成单一原子操作。
- [ ] 使用条件更新或悲观锁保证同一券并发 checkout 最多一个成功；定义稳定错误码 `COUPON_INELIGIBLE`、`COUPON_ALREADY_RESERVED`。
- [ ] 支付成功确认 `RESERVED -> USED`；checkout 失败、取消、风控拒绝、订单到期恰好一次释放并恢复可用。
- [ ] 实现过期 reservation 的受控清理或将其接入已有订单到期补偿路径，拒绝过期券及过期 reservation。

### A4-V. 优惠券原子预留与释放验证

- [ ] 验证并发抢同一券只产生一条有效 reservation、每种终态后券和 reservation 状态一致，以及重放确认/释放不重复改变状态。

### A5. 演示账号与支付成功基线

- [ ] 在 traffic-control-plane 增加 server-only 生命周期账号配置，解析 `TRAFFIC_LIFECYCLE_LOGIN_ENABLED` 和 Secret 注入的账号 JSON。
- [ ] 配置校验账号标签/邮箱唯一、账号启用、预期 customer ID 与登录响应一致；控制台只显示安全摘要。
- [ ] 为训练环境的真实 CUSTOMER 支付定义固定成功基线，且不依赖 `X-Traffic-Runner-Payment-Strategy`。
- [ ] 将支付失败/未知、库存耗尽、商品下架、价格变化、券争用和下游异常明确转入 `faultScenarioId` 故障注入验证路径。

### A5-V. 演示账号与支付成功基线验证

- [ ] 验证默认常规支付稳定成功、故障未启用时不随机出现失败/未知支付，以及 token、密码和登录邮件不进入日志或活动记录。

---

## Phase B：优惠券和库存基线补齐

**阶段进度：0 / 8**

目标：由 worker 协调每六小时补齐演示资源，但由领域服务独占发行和库存写入规则。

### B1. promotion-service 演示券池补齐命令

- [ ] 实现受内部服务认证保护的无参数 `DemoCouponPoolService`/内部 Controller 命令。
- [ ] 使用服务端配置的演示客户、promotion 类型、`targetAvailableCount`、`replenishBelowCount` 和券有效期；不得接受 worker 提供的客户、券或数量。
- [ ] 统计未过期 `AVAILABLE` 券，低水位时补至目标数量。
- [ ] 使用发行批次或幂等键保证超时重送、重复调用和多实例场景不会超额补券。
- [ ] 记录每次补齐的补充数、跳过数、失败数、窗口 ID 与关联 ID。

### B1-V. 演示券池补齐命令验证

- [ ] 验证仅演示客户获得新券、重复调用不超额、成功支付消耗券后下一轮恢复目标基线，以及取消和 checkout 失败复用释放券而非额外补发。

### B2. inventory-service 演示库存补齐命令

- [ ] 实现受内部服务认证保护的无参数 `DemoInventoryBaselineService`/内部 Controller 命令。
- [ ] 使用服务端配置的演示 SKU 和 `targetAvailableQty`；worker 不传 SKU、数量或版本。
- [ ] 计算可售库存缺口并以条件更新补齐；不覆盖未过期预占、不回滚已确认的交易结果。
- [ ] 使用补齐批次/窗口幂等键保证多实例、超时重送和重试不重复加库存。
- [ ] 记录 SKU 数、补充数量、跳过数、失败数、窗口 ID 与关联 ID。

### B2-V. 演示库存补齐命令验证

- [ ] 验证常规目录中演示商品维持正库存、重复补齐不重复增加库存，以及已有预占状态不被 reset 或覆盖。

### B3. Worker 补券调度器

- [ ] 新增 `CouponReplenishmentScheduler`，复用 worker 的 `cron-parser`、Redis 与 GatewayClient 模式。
- [ ] worker 启动并在启动生命周期前触发一次补齐；之后在 `0 0 */6 * * *` UTC 窗口调度。
- [ ] 采用短期执行锁与独立成功完成标记；锁竞争只跳过当前实例，不将窗口标记为完成。
- [ ] Gateway 或 promotion-service 失败时，在同一窗口有限退避重试；仅成功后写完成标记。
- [ ] 在 worker 生命周期中启动、停止和报告调度器状态。

### B3-V. Worker 补券调度器验证

- [ ] 验证启动后立即补齐、同窗口多实例只有一次有效补齐，以及持锁实例崩溃或 Gateway 一次失败后其他实例/重试仍可在窗口内完成。

### B4. Worker 库存补齐调度器

- [ ] 新增 `InventoryReplenishmentScheduler`，实现与 B3 相同的启动补齐、UTC 六小时调度、锁、成功标记和窗口内重试语义。
- [ ] 仅经 `/internal/gateway/inventory/demo-stock/replenish` 调用，禁止调用 reset 路径。
- [ ] 将旧 inventory reset scheduler 保留为运维兼容能力，但从 worker 启动、runner 生命周期和控制台主路径移除其依赖。
- [ ] 补充状态/活动记录，展示下次执行、上次结果、补充数和重试状态。

### B4-V. Worker 库存补齐调度器验证

- [ ] 验证新流量路径从未调用 inventory reset、库存补齐失败可恢复，以及补齐状态可被运营 API 查询且无业务秘密。

---

## Phase C：真实登录客户生命周期

**阶段进度：0 / 10**

目标：一次串行生命周期用同一真实客户会话完成浏览、续加购、地址、优惠券、结算、查单与支付/取消。

### C1. GatewayClient 客户认证模式

- [ ] 扩展 GatewayClient 的登录、刷新、登出和 bearer-authenticated `GET`/`POST`/`PATCH`/`DELETE` 能力。
- [ ] 登录/刷新/登出与客户请求均携带 trace；客户模式不得附加任何 `X-Traffic-Runner-*` 或 runner credential 头。
- [ ] 首次 `401` 或临期 token 时最多 refresh 一次并重试；失败后结束生命周期并清除内存 session。
- [ ] 对错误消息、Pino 日志与活动 DTO 进行 token/password 脱敏。

### C1-V. GatewayClient 客户认证模式验证

- [ ] 验证请求头契约正确、refresh/retry 次数受限，以及任何失败输出中没有 token 或密码。

### C2. CustomerSessionManager

- [ ] 新增内存会话管理器，随机选择启用演示账号、登录并校验 customer ID。
- [ ] 维护 lifecycle 内唯一 CustomerSession，提供统一的客户请求上下文。
- [ ] 生命周期结束 best-effort logout 并立即丢弃 session；不得写入 Redis 或 MySQL。
- [ ] 对账号禁用、密码变化、预期客户 ID 不匹配、refresh 失败定义稳定结果码。

### C2-V. CustomerSessionManager 验证

- [ ] 验证同一生命周期的购物车、订单、支付/取消均使用同一客户，账号不能跨越生命周期共享 token，且异常不会切换其他账号继续处理已有订单。

### C3. 购物车、目录与地址步骤

- [ ] 从目录分页/搜索响应选择可售且正库存 SKU；常规模式不接受零库存、下架或价格异常作为随机结果。
- [ ] 先读取购物车，排除已有 SKU 后随机选择不同 SKU 加购；已有明细保留。
- [ ] 当购物车已达到 `maxItems` 或没有可新增 SKU 时，复用已有购物车并记录 `CART_REUSED`。
- [ ] 读取默认地址或首条地址；无地址时经 `/api/me/addresses` 创建确定性演示地址并设为默认地址。
- [ ] 记录初始购物车明细、本次新增明细、购物车版本、地址创建结果和稳定错误码。

### C3-V. 购物车、目录与地址步骤验证

- [ ] 验证不重复加购已有 SKU、已有地址不被修改、无地址账号可正常 checkout，以及所有请求经 Gateway 且客户归属正确。

### C4. 优惠券、checkout 与订单收尾

- [ ] 按 `couponUsageRatio` 调用客户券 API 并从符合当前购物车门槛的候选中选择一张；无可用券时记录 `COUPON_UNAVAILABLE` 后走无券 checkout。
- [ ] 使用唯一 checkout 幂等键，提交 `cartId`、`cartVersion`、`addressId` 和可选 `couponId`；拒绝客户端金额和明细。
- [ ] checkout 成功后立即查询订单并要求 `PENDING_PAYMENT`；记录 coupon、订单、购物车与 trace 关联。
- [ ] 按 `successfulPaymentRatio` 走标准客户支付成功，或重新查询后仅取消仍为 `PENDING_PAYMENT` 的订单。
- [ ] 两个收尾分支都最终查单，以服务端状态记录结果。

### C4-V. 优惠券、checkout 与订单收尾验证

- [ ] 验证有券/无券分支可按目标比例产生、支付不使用 runner 策略头、取消从不操作已支付订单，以及每个创建订单都完成创建后和收尾后查询。

### C5. 中断与故障注入边界

- [ ] worker 停止/部署中断时将当前生命周期和已完成子步骤标记为 `INTERRUPTED`，安全等待或终止 in-flight 持久化。
- [ ] 已创建订单允许保留 `PENDING_PAYMENT`，不由 runner 强制取消或重试。
- [ ] 接入既有订单到期、库存/优惠券释放和补偿路径处理遗留待支付订单。
- [ ] 对故障注入运行写入 `faultScenarioId`；常规运行不得记录常规随机失败。

### C5-V. 中断与故障注入边界验证

- [ ] 验证中断后记录可追踪且无孤儿 token/会话、待支付订单最终由既有领域补偿恢复，以及故障结果能与常规流量指标隔离。

---

## Phase D：Worker 串行调度与可观测性

**阶段进度：0 / 8**

目标：用四档固定间隔调度完整生命周期，准确展示真实执行节奏、活动和补齐状态。

### D1. RunnerEngine 串行间隔调度

- [ ] 将主模式 action pick 替换为 `CUSTOMER_LIFECYCLE` 执行。
- [ ] 移除主路径的 base QPS、峰值倍率、波形、抖动和按 action mix 的调度语义。
- [ ] 一条生命周期完成后等待 `lifecycle_interval_sec` 再开始下一条；慢生命周期绝不重叠。
- [ ] 停止时停止下一次调度，并把未完成生命周期安全标记为中断；在 run 完成前等待必要的持久化 drain。

### D1-V. RunnerEngine 串行间隔调度验证

- [ ] 验证 `60/30/20/10` 四档均严格串行、实际间隔有记录，以及生命周期耗时超过间隔时不会并发或重复启动。

### D2. 父子活动与持久化

- [ ] 每条生命周期写父活动记录及登录、浏览、加购、地址、选券、checkout、创建后查单、支付/取消、最终查单子记录。
- [ ] 持久化 lifecycle/step ID、trace、账号标签或客户 ID、订单/支付/券关联、购物车与地址摘要、状态、稳定错误码、耗时和中断原因。
- [ ] Redis recent activity 保留非敏感近期状态；MySQL 保存可审计历史；停止前不丢失已完成子步骤。
- [ ] 保持 token、密码、邮箱、原始认证头不落盘。

### D2-V. 父子活动与持久化验证

- [ ] 验证可从父生命周期重建完整步骤顺序、活动中不存在秘密，以及 Redis/DB 记录与 Gateway/订单关联一致。

### D3. 状态与指标

- [ ] 状态 API 返回选定间隔、当前 lifecycle、上次开始/完成时间、累计开始/完成/NOOP/失败/中断数和实际平均间隔。
- [ ] 输出目标与实际支付/取消/用券比例、地址自动创建数、购物车复用数、待支付保留数。
- [ ] 输出优惠券与库存补齐的下次执行、上次结果、窗口 ID、重试次数、补充/跳过/失败数。
- [ ] 将常规生命周期与 `faultScenarioId` 故障注入结果拆分指标、日志和活动过滤条件。

### D3-V. 状态与指标验证

- [ ] 验证运营人员可在不访问秘密的前提下判断 runner、券池、库存基线及故障注入是否健康。

### D4. 旧路径兼容与清理

- [ ] 明确旧 runner credential/action mix 的支持状态：移除、禁用或作为显式背景流量；不能默认混入 `CUSTOMER_LIFECYCLE`。
- [ ] 从 runner 主状态、主调度和 UI 移除 QPS/峰值/抖动、失败/未知支付与 inventory reset 依赖。
- [ ] 保留运维 inventory reset endpoint 和旧表/路由时，增加弃用说明，避免误作为 lifecycle 资源补齐机制。
- [ ] 更新 `.env.example`、Compose、Kubernetes Secret/ConfigMap，声明演示账号 Secret、模式 flag 和安全默认值。

### D4-V. 旧路径兼容与清理验证

- [ ] 验证常规生命周期运行不使用 runner credential 或 reset、旧能力不会意外暴露或被删除，以及部署配置 fail-closed。

---

## Phase E：控制台、验证与迁移

**阶段进度：0 / 5**

目标：让运营人员可安全配置、观测与验证完整生命周期，形成可重复的交付验收。

### E1. Runner 控制台与内部 API

- [ ] 配置 API 以 `version` 接收 lifecycle mode、四档间隔、支付成功比例和用券比例；服务端校验所有边界。
- [ ] Runner 页面移除 QPS、峰值、周期、抖动、支付失败/未知和 inventory reset 的主控件。
- [ ] 增加间隔单选、成功支付/取消比例、用券/无券比例、账号健康摘要、父子活动展开、补券/补库存状态。
- [ ] 配置修改与手动安全操作写入 operator audit；页面不展示 email、密码、token 或原始请求头。

### E1-V. Runner 控制台与内部 API 验证

- [ ] 验证 UI 与 API 仅允许设计范围内配置、并发版本冲突可见，以及敏感信息无泄露。

### E2. 单元、契约与集成测试

- [ ] 扩展 runner TypeScript 测试：认证头互斥、token refresh、同一客户会话、随机选品、购物车续用、补地址、优惠券分支、checkout/支付/取消顺序、最终查单和中断。
- [ ] 为 Gateway、promotion-service、inventory-service、order/payment 相关切片增加鉴权、路由、无券、有券并发预留、补齐幂等、支付成功和待支付补偿测试。
- [ ] 为两个 worker 补齐调度器增加启动、UTC 六小时、锁竞争、崩溃/锁过期、Gateway 失败重试、重复投递测试。
- [ ] 为故障注入场景添加测试，确认失败只在 `faultScenarioId` 启用时出现，并与常规流量隔离。

**完成条件**：所有设计中的验证路径都有自动化覆盖；常规与故障流量的断言不相互污染。

### E3. Compose 端到端验收

- [ ] 以有效 JWT/内部服务 Secret 和演示账号 Secret 启动干净 Compose 环境。
- [ ] 验证 worker 启动立即完成券池/库存补齐；使用可控时钟覆盖六小时窗口、失败重试和幂等重送。
- [ ] 分别执行 `alice`、`bob` 的有券成功支付、无券成功支付、有券取消、购物车复用和自动补地址生命周期。
- [ ] 依次验证四档串行间隔；中断 worker 后验证 `PENDING_PAYMENT` 保留及既有补偿。
- [ ] 验证 Gateway 拒绝直连、跨客户券读取、无 token、伪造身份头、浏览器/Shopfront 调用内部补齐命令。

**完成条件**：订单、支付、库存预占、优惠券 reservation、补齐记录、`traffic_runs`、`traffic_actions` 与 Redis 活动相互一致且无秘密。

### E4. 文档、迁移与发布清单

- [ ] 更新根级产品/技术设计、README、环境说明和运维 Runbook，说明真实登录模式、常规/故障边界、补齐机制和旧 reset 的非依赖关系。
- [ ] 记录 Schema 初始化或迁移步骤、配置 Secret、Gateway 新路由、回滚策略和旧 runner 背景流量开关。
- [ ] 将实施结果回填本任务清单、[product.md](product.md) 和 [technical-design.md](technical-design.md) 的状态/更新时间。

### E5. 发布前验证

- [ ] 运行并记录以下最低验证命令：

```bash
cd traffic-control-plane
pnpm test:runner
pnpm typecheck
pnpm lint
pnpm build

cd ..
mvn test -pl promotion-service,inventory-service,order-service,gateway-service
```

**完成条件**：发布前文档、部署配置、回滚方式和验证结果完整；没有未说明的安全边界变化。

## 交付完成定义

1. 常规 runner 以真实演示客户、固定串行间隔经 Gateway 完成浏览、续加购、补地址、可选用券、checkout、查单、成功支付或取消。
2. 优惠券和库存均由 worker 启动补齐及六小时周期补齐维持基线；worker 不直写业务数据、不调用 reset。
3. 客户/内部补齐路由具备明确 Gateway 鉴权和入口隔离，且直接访问和越权访问均被拒绝。
4. 常规流量与故障注入流量通过 `faultScenarioId` 明确分离；故障不会伪装成常规随机失败。
5. 运营控制台只提供四档执行间隔与安全的比例/状态观测；全链路记录可关联且不含秘密。
6. 自动化与 Compose 验收覆盖两个账号、有券/无券、支付/取消、补地址、购物车续用、补齐、串行调度、中断待支付和安全拒绝矩阵。
