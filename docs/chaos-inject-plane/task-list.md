# 故障演练控制面实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | Phase A-E 已完成，Phase F 待实施 |
| 版本 | 1.0 |
| 更新时间 | 2026-08-27 CST（Phase E 完成） |
| 关联规格 | [product.md](product.md) |
| 关联设计 | [tech.md](tech.md) |

> 迁移说明：本清单早期的 Cart/Sam Redis 大值任务已由 [商品详情 Redis Hash 专题](../scenarios/catalog-product-detail-cache/product.md) 不兼容替换。当前可创建的大值场景只属于 `catalog-service`；下方旧 Cart 条目保留为历史实施记录，不代表当前可用入口。

## 任务规则

1. 开始任务时将 `- [ ]` 改为 `- [-]`；通过最终验收后改为 `- [x]`。
2. 每个阶段完成后更新本文件的阶段进度和文档更新时间。
3. 业务请求必须经 `gateway-service`；控制面 worker、Runner 和控制台不得直连业务服务或直接写业务表。
4. 全环境同一时刻只允许一条 `CREATING`、`ACTIVE` 或 `RECOVERING` 的 Fault Run；不得以并行运行、兼容分支或旧协议绕开该约束。
5. 业务服务日志、代码注释、类/方法和 Endpoint 名称不得使用“故障注入”及同义表述；运行归因仅保留在受保护的控制面数据库记录和审计中。
6. 本方案为不兼容替换。删除旧通用 Chaos 协议、旧 Gateway fan-out、旧控制面 UI/API、网络延迟/重置面板及其 DTO、配置、脚本、仪表盘引用和测试；不得保留弃用、feature flag 或未调用代码。
7. 全部服务、worker、MySQL 会话和日切逻辑统一使用东八区 `+08:00`；不得依赖宿主机、容器或数据库默认时区。
8. 除最终 Phase F 外，前置阶段只放开发与迁移任务，不混入单元、集成、Compose、端到端或发布验收项。

## 阶段总览

| 阶段 | 目标 | 状态 | 进度 | 前置依赖 |
| --- | --- | --- | --- |
| A | Fault Run 契约、持久化与单运行协调 | 已完成 | 5 / 5 | 无 |
| B | Gateway 单目标分发与业务场景接口 | 已完成 | 7 / 7 | A |
| C | Worker、Runner 复用与 Sam 演练账号隔离 | 已完成 | 5 / 5 | A、B |
| D | 54M 日分区预热与全栈东八区 | 已完成 | 4 / 4 | A |
| E | PSP、重启适配器、控制台与旧系统清理 | 已完成 | 5 / 5 | A 至 D |
| F | 统一验证、验收与发布检查 | 待开始 | 0 / 18 个验证任务组 | A 至 E |

---

## Phase A：Fault Run 契约、持久化与单运行协调

**阶段进度：5 / 5**

目标：建立唯一运行模型、数据库证据与控制面协调器，使任何场景都有统一的创建、到期、停止和恢复语义。

### A1. Fault Run Schema 与七天留存

- [x] 在 traffic-control-plane 新建 `fault_runs` migration、类型、Repository 和数据访问层，包含场景、固定目标、参数快照、状态、开始/到期/停止时间、停止原因、恢复结果、审计关联、trace 关联和 `fencing_token`。
- [x] 在数据库层实现只允许一条 `CREATING`、`ACTIVE` 或 `RECOVERING` 运行的约束；创建冲突返回现有运行 ID，不能依赖仅进程内锁。
- [x] 新建 `fault_run_events` migration、类型和 Repository，以 `fault_run_id` 保存创建、目标确认、Runner 调用汇总、停止、恢复和错误事件的结构化 payload。
- [x] 新建每日留存任务，按外键顺序分批删除已终止且超过 7 天的运行、事件和运行专属审计明细；活动、恢复中、服务不可用或清理未完成的记录永不按时间删除。
- [x] 删除或迁移旧控制面通用 Chaos 运行状态、旧 status 聚合和旧 recover-all 持久化路径，不保留兼容读写分支。

### A2. 场景 Catalog 与运行状态机

- [x] 在 TypeScript 建立唯一场景 catalog，作为控制台、Route Handler、Coordinator、Gateway 映射和参数校验的唯一事实来源；每项固定场景、目标、参数 schema、最大持续时间、恢复策略、数据库事件字段和人工清理权限。
- [x] 实现 `FaultRunCoordinator` 的 `CREATING -> ACTIVE -> RECOVERING -> RECOVERED` 主路径，以及 `FAILED`、`STOPPED`、`SERVICE_UNAVAILABLE` 分支。
- [x] 实现创建补偿：目标确认前失败或部分分发失败时，协调器按相同 `faultRunId` 释放已启动资源并写事件。
- [x] 实现到期调度、人工停止和控制面启动扫描；三者复用同一幂等停止与恢复逻辑。
- [x] 内存耗尽场景实现非释放型到期语义：只停止后续保留动作，健康失败后转为 `SERVICE_UNAVAILABLE`，等待固定通知服务重启。

### A3. 目标侧到期与 fencing 契约

- [x] 定义固定内部运行上下文：`faultRunId`、`expiresAt`、单调 `fencingToken`、幂等键和内部服务认证；拒绝用户传入目标服务、任意 URL、表名、SKU、客户或 shell 参数。
- [x] 为每个可恢复目标资源实现最近 fencing token 持久化/缓存、过期或较旧 token 拒绝和本地到期任务；控制面不可用时目标服务仍能停止或释放资源。
- [x] 将运行 ID、到期时间和 token 经 Gateway 传递到目标服务，并为目标确认、过期拒绝、本地恢复写入 `fault_run_events`。
- [x] 为运行专属 Redis key、专用 JDBC 锁连接、PSP 运行状态、Cart 运行状态和通知存储运行状态定义统一的幂等清理归属规则。

### A4. 控制面运行资源 API 与审计

- [x] 新建受保护的 Route Handler：创建、列表、详情、停止、存储清理与固定通知服务重启；全部依据 catalog 校验输入。
- [x] 为创建、停止、清理和重启加入运营会话、CSRF、确认、幂等键和审计写入；拒绝浏览器消费者路径与未认证内部调用。
- [x] 运行详情 API 从 `fault_runs`、`fault_run_events` 和审计明细聚合结果；不新增 Prometheus 指标、Grafana 面板、告警规则或业务服务日志。
- [x] 更新控制面数据库初始化与部署配置，注册运行扫描、到期调度和七天留存任务。

### A5. Gateway 分发基础替换

- [x] 将 Gateway 从旧通用 chaos fan-out 替换为场景到单一固定目标的映射，拒绝未知场景、错误目标、批量 target 和任意 URL。
- [x] 定义各固定内部路径的服务认证和运行上下文转发规则；清洗外部伪造的运行、身份和内部认证头。
- [x] 删除 `ChaosDispatchController`、`ChaosDispatchService`、通用 dispatch DTO、旧 `/internal/gateway/chaos/**` 和旧网络故障 dispatch 路由。
- [x] 删除 common 中 `ChaosService`、`ChaosController`、自动配置扫描和旧 `/internal/chaos/**` 协议及相关配置。

---

## Phase B：Gateway 单目标分发与业务场景接口

**阶段进度：7 / 7**

目标：在固定服务位置实现真实业务路径和窄内部接口，不采用伪造 Controller 结果或合成延迟。

### B1. 可优化的商品与订单慢报表

- [x] 在 Catalog 增加经 Gateway 公开访问的商品浏览当日报表；初版等值关联真实行为与商品数据，但遗漏日期范围，并保留无匹配复合索引的 baseline Schema。
- [x] 在 Order 增加经 Gateway 可信客户身份访问的客户今日订单报表；初版遗漏日期范围、按客户全部历史排序，并逐订单查询明细形成 N+1。
- [x] 实现独立的应用修复版本和 migration：商品报表补半开日期范围及 `(action_type, target_type, created_at, target_id)` 索引；订单报表补日期范围、`(user_id, created_at, id)` 索引和投影/分组汇总。
- [x] 将报表 SQL 与 MySQL 东八区会话绑定，确保“今日”的应用语义、执行计划和日期分区边界一致。

### B2. 流量突增与报表运行目标

- [x] 定义浏览与订单查询突增的公开 Gateway 请求路径、受控参数和固定客户/订单来源；不修改现有 Runner 的串行配置或生命周期。
- [x] 将慢报表运行目标配置为由控制面持续调用公开报表 API；目标服务只提供窄状态/确认能力，不修改 SQL 或自动执行优化。
- [x] 将请求汇总、停止原因和恢复结果写入 `fault_run_events`，不在服务侧生成新的业务日志或监控指标。

### B3. Cart Redis 大 key 与 Catalog 依赖失败

- [x] 在 Cart 实现运行 ID 命名空间的 Redis 大 key 创建、受限字段/总大小/TTL、活动运行读取和幂等删除；非活动运行或非演练客户不得读取该 key。
- [x] 在 Cart 的真实加购路径中记录运行专属 key 的读取结果，并实现按 `faultRunId` 清理的 Cart/CartItem 演练数据归属。
- [x] 新增 Cart 到 Catalog 的认证 HTTP 商品校验客户端；SKU 不存在或未上架时，在 Cart/CartItem 持久化前通过真实下游失败终止。
- [x] 在 Catalog 实现受认证、固定范围的依赖响应控制，不接受任意路径、任意服务或随机失败参数；恢复后正常 Catalog 响应保持不变。

### B4. 通知内存与存储路径

- [x] 在 `NotificationService.send()` 的真实对象处理路径接入运行专属高基数保留，支持节奏和持续时间，且不执行 `System.gc()`、清理保留对象或主动退出进程。
- [x] 在正常通知持久化事务接入运行专属受限追加，限制总字节、追加大小、速率和最小剩余空间；存储数据按运行 ID 供后续人工清理。
- [x] 实现通知目标侧本地到期与运行清理语义，内存运行仅停止新保留，存储运行停止新写入；两者均写数据库运行事件。

### B5. Promotion 死锁接口

- [x] 在 Promotion 增加受认证的优惠券预留一致性核对内部接口，只允许访问运行创建的可识别过期预留记录。
- [x] 实现两条真实事务：预留路径按 `coupon -> coupon_reservation` 加锁，过期核对路径按 `coupon_reservation -> coupon` 加锁；完成、回滚或 MySQL 死锁后恢复准备数据。
- [x] 实现受限竞争并发与本地到期释放；接口及服务日志/注释使用预留一致性、过期核对等中性词汇。

### B6. Inventory 表锁与可用性报表接口

- [x] 在 Inventory 实现单活动运行的专用 JDBC 锁连接，使用 `LOCK TABLES inventories WRITE`，并在停止、到期、异常与启动恢复路径中 `UNLOCK TABLES`、关闭连接。
- [x] 新增受认证的库存可用性报表接口，查询受限 SKU 集合的真实库存摘要，不接受任意 SQL、表名或 SKU 输入。
- [x] 实现表锁运行的本地到期顺序：停止新报表调用、释放锁连接、收敛在途调用，并将结果写入数据库事件。

### B7. PSP 模拟服务与支付映射

- [x] 新建 `psp-simulator` Maven 模块、Docker Compose 服务、Kubernetes Deployment/Service、健康端点和受认证固定运行控制端点。
- [x] 在 payment-service 新建 `PspClient`，支付确认通过 HTTP 调用 PSP；正常授权继续支付、明确拒付映射 `FAILED`，PSP 超时由 payment-service 的 HTTP 客户端原始请求超时异常上抛。
- [x] 移除 payment-service 中冲突的随机进程内支付结果策略；PSP 运行状态按 `faultRunId`、到期时间和 fencing token 管理。

---

## Phase C：Worker、Runner 复用与 Sam 演练账号隔离

**阶段进度：5 / 5**

目标：在不改变现有串行生命周期的前提下，实现受控持续调用，并确保 Redis 大 key 使用隔离的 Sam 账号。

### C1. 受控持续调用 Worker 框架

- [x] 为 Fault Run 实现可取消、可排空的 worker 执行框架，支持受限并发、请求间隔、截止时间、停止原因和数据库事件汇总。
- [x] Worker 仅经 `GatewayClient` 调用公开业务 API 或固定 Gateway 内部路径；不得直连业务服务、Redis、MySQL 业务表或 PSP 服务。
- [x] 到期与人工停止统一执行：禁止新请求、等待或取消在途请求、调用目标恢复、写入事件和更新运行状态。

### C2. 报表与流量突增 Worker

- [x] 实现 `ReportExerciseWorker`，在运行期持续调用商品或订单报表，并将请求结果汇总写入数据库。
- [x] 实现独立 `TrafficSurgeExecutor`，以受限并发和间隔调用商品浏览或客户订单查询；不改写 `RunnerEngine`、配置版本、串行生命周期或其调度。
- [x] 突增订单查询只使用现有 Runner 已持久化的合规演示客户和订单来源，不猜测客户或订单数据。

### C3. Cart、Promotion 与 Inventory Exercise Worker

- [x] 删除旧 `CartLargeValueExerciseWorker`、Sam 大值加购和 Cart exercise Hash 路径；当前 Redis 大值读取由 Catalog 商品详情 worker 负责。
- [x] 实现 `PromotionLockExerciseWorker`，在运行期经 Gateway 持续调用优惠券预留一致性核对接口，限制竞争并发与速率。
- [x] 实现 `InventoryLockExerciseWorker`，在表锁持有期经 Gateway 持续调用库存可用性报表接口，并在释放锁后收敛调用。

### C4. Sam Seed、角色与购物车隔离

- [x] 更新 seed，使 `users.id = 19` 固定为 Sam，并加入 `TRAFFIC_EXERCISE` 演练账号白名单及同名业务角色；补齐其可登录凭证、地址、独立购物车和可加购演示 SKU 前置数据。
- [x] 修改 Runner 演示客户选择、会话创建、订单生成、库存补齐关联与正常运行状态，显式排除账号 ID `19` 和 `TRAFFIC_EXERCISE` 角色。
- [x] 移除 Cart 对 Redis 大值和 Sam 演练购物车的专用读取/写入；普通 Cart/CartItem 业务路径不再依赖 Fault Run。
- [x] 盘点旧 Cart 运行和 `cart:exercise:*:large-value` key，确认无活动运行或遗留资源后完成不兼容替换。

### C5. Runner 复用的通知与 PSP 触发

- [x] 将通知内存和存储演练接入既有 Runner 的真实业务请求触发，不新增专属通知 worker，也不改变 Runner 的串行生命周期。
- [x] 将 PSP 拒付和超时演练接入既有 Runner 的真实支付请求，不新增专属支付 worker，也不以 payment-service 作为泛化目标。
- [x] 将关联到活动 Fault Run 的 Runner 结果汇总写入 `fault_run_events`；常规 Runner 记录不标记为 Fault Run。

---

## Phase D：54M 日分区预热与全栈东八区

**阶段进度：4 / 4**

目标：将慢 SQL 数据源维护为东八区 180 天、每日 30 万行的 54M 固定窗口，并使全部日期语义一致。

### D1. MySQL 日分区迁移

- [x] 为 `product_price_history(effective_at)` 与 `user_behavior_log(created_at)` 设计并执行 MySQL `RANGE COLUMNS` 日分区 migration，分区命名为 `pYYYYMMDD`，上界为下一个东八区自然日。
- [x] 在分区前调整两表主键和全部唯一键，使每个唯一键包含分区时间列，满足 MySQL 分区限制并保持既有业务约束。
- [x] 为窗口初始化创建“今天至前 179 天”的 180 个分区；数据迁移和新表初始化不采用无界删除或均匀随机时间替代按日配额。

### D2. 常驻预热 Worker

- [x] 将 `DataWarmupService` 改为常驻 Redis 租约 worker，按表和日期重建配额，逐日填满 300,000 行，行为分区包含足量 `PAGE_VIEW`、`PRODUCT` 和真实 SKU 目标。
- [x] 实现 `BACKFILLING`、`APPENDING`、`ROLLOVER_CLEANUP`、`ERROR`、`DISABLED` 状态及进度持久化；重启不重复完整分区或跳过缺失分区。
- [x] 日切后先创建当天分区并完成当天配额，再以 `DROP PARTITION` 删除窗口外最早整日分区；禁止以对 54M 表无界 `DELETE` 作为滚动机制。
- [x] 保留空间、表大小、批大小、间隔、速率限制和退避保护；保护触发时不新增写入或破坏窗口外数据。

### D3. 东八区部署与连接配置

- [x] 在 Compose 与 Kubernetes 为全部 Java 服务设置 `TZ=Asia/Shanghai` 与 `-Duser.timezone=Asia/Shanghai`，为 Next.js 和 standalone worker 设置 `TZ=Asia/Shanghai`。
- [x] 配置 MySQL `default-time-zone = '+08:00'`，并在所有 JDBC URL 强制连接会话时区为 `+08:00`。
- [x] 更新应用、worker、预热和报表的日期工具，统一通过 `APP_TIME_ZONE=Asia/Shanghai` 计算“今日”、日切与分区边界。
- [x] 更新数据预热状态 API，输出分区、当天配额、表行数、表大小、过期分区删除、租约和保护原因的数据库记录。

### D4. 数据与运行记录清理调度

- [x] 将预热过期分区删除与 Fault Run 七天记录留存作为独立调度任务，分别使用各自锁和数据库事务，不相互耦合。
- [x] 为人工通知存储清理实现仅按 `faultRunId` 的受保护入口，保留操作审计并拒绝用户输入任意表、SQL 或文件路径。
- [x] 更新容量说明和部署变量，区分 54M 数据窗口、通知存储追加上限、运行记录七天留存和预热 guard 阈值。

---

## Phase E：PSP、重启适配器、控制台与旧系统清理

**阶段进度：5 / 5**

目标：交付受保护的运营入口、通知重启能力和不兼容替换后的部署与文档。

### E1. 通知服务受限重启

- [x] 实现 Compose 重启 broker，控制面仅可请求固定 `notification-service` restart；broker 独占 Docker 控制权，控制面不得挂载 Docker Socket。
- [x] 实现 Kubernetes 专用 ServiceAccount 和最小 RBAC，只允许固定 namespace 的 `notification-service` Deployment `get`/`patch` pod-template restart annotation。
- [x] 固定重启 Route 拒绝服务名、命令、namespace、镜像和 patch body；重启后在有界截止时间内轮询健康并写数据库事件。

### E2. 故障演练控制台

- [x] 用场景卡片替换旧泛化服务多选、网络延迟与连接重置界面；卡片只显示 catalog 固定目标、允许参数、状态、倒计时、数据库事件、停止与恢复结果。
- [x] 实现活动运行互斥显示：已有运行时禁止其他卡片创建，并提供当前运行详情和停止入口。
- [x] 实现慢 SQL 卡片的报表语义、数据窗口、baseline/修复执行计划证据和修复状态；实现 Sam、死锁、表锁、通知和 PSP 的数据库事件展示。
- [x] 内存卡片默认显示确认式固定重启操作；点击时检查通知服务健康状态，仅在服务不存活时执行重启，不显示可编辑服务名、命令或基础设施参数。

### E3. 部署、配置与操作文档

- [x] 更新 Compose、Kubernetes、ConfigMap、Secret、Dockerfile 和 worker 启动配置，注入固定 Gateway 地址、内部服务认证、MySQL/Redis、PSP、重启 broker、`APP_TIME_ZONE` 和数据预热环境变量。
- [x] 更新根 README、架构文档、部署说明和运行手册，说明单运行限制、东八区、Sam 隔离、分区窗口、七天留存、重启边界和各场景恢复语义。
- [x] 移除旧 Chaos、网络控制、旧 worker 注册、旧环境变量、旧 Compose/Kubernetes 配置、脚本、Grafana/告警引用和文档说明。

### E4. 运行记录的访问与清理界面

- [x] 实现运行列表与详情的 7 天查询范围、状态/场景筛选、事件时间线和审计关联，不暴露秘密、原始认证头或内部地址。
- [x] 实现通知存储清理的确认式界面，仅允许已终止且符合场景 catalog 的运行 ID；显示数据库记录的清理结果。
- [x] 删除旧控制台对 Gateway chaos status、recover-all、服务 fan-out 和网络控制状态的读取与展示。

### E5. 全仓替换收尾

- [x] 删除旧 common chaos 组件、Gateway dispatch、控制面旧 route/UI/worker、旧 DTO/测试夹具和不再使用的依赖。
- [x] 更新模块依赖、Maven reactor、Docker 镜像、Kubernetes 清单与 Compose 服务，使 PSP、重启 broker、预热和新的控制面运行模型成为唯一部署路径。
- [x] 将产品、技术设计、任务清单、脚本和 runbook 的版本、状态和交叉链接更新到本方案。

---

## Phase F：统一验证、验收与发布检查

**阶段进度：0 / 18 个验证任务组**

目标：在 A-E 全部开发完成后，集中执行自动化、契约、集成、Compose、数据迁移、安全和发布验收；前置阶段不再拆分验证任务。

### F1. Fault Run 与安全边界

- [ ] 验证并发创建仅产生一条 `CREATING`、`ACTIVE` 或 `RECOVERING` 运行，冲突请求返回现有运行 ID；创建补偿、人工停止、到期停止和控制面重启恢复均保持幂等。
- [ ] 验证旧或过期 fencing token、错误运行 ID、错误目标、任意 URL、批量 target 和无效幂等键均被 Gateway 与目标服务拒绝；控制面断连后目标侧按 `expiresAt` 自行恢复。
- [ ] 验证运行 Route 的运营会话、CSRF、确认、内部服务认证、消费者路径拒绝和审计记录；所有记录、API 与错误输出均不含密码、token、原始 authorization header 或内部地址。
- [ ] 验证 `fault_runs`、`fault_run_events` 及关联审计明细仅保留已终止记录 7 天，活动、恢复中、服务不可用和清理未完成记录不被误删。

### F2. Gateway 与旧系统替换

- [ ] 验证每个场景只能通过 Gateway 到达固定单一目标，所有业务 worker 和 Runner 均未直连业务服务或业务表。
- [ ] 对全仓执行旧协议、旧端点、旧 DTO、旧 ChaosService/Controller、fan-out、网络延迟/重置、recover-all、旧 UI 和旧配置的定向搜索，确认无实现、配置、测试或文档残留。

### F3. 慢 SQL 与东八区语义

- [ ] 验证商品和订单报表 baseline 都出现“语义为今日、实现扫描历史”的真实结果和执行计划；部署修复及索引后只返回东八区当日数据、使用范围访问且订单无 N+1。
- [ ] 验证 Compose、Kubernetes、Java、Next.js/worker、MySQL global/session、JDBC 与 `CURRENT_DATE` 均使用 `+08:00`，并覆盖东八区午夜日切边界。

### F4. 分区预热与容量窗口

- [ ] 验证两个表均为 `RANGE COLUMNS` 日分区且所有唯一键符合 MySQL 分区限制；初始化后存在 180 个东八区分区、每分区 300,000 行、总量约 54M。
- [ ] 验证日切先创建和补满当天分区，再 `DROP PARTITION` 删除最早分区；重启续跑、双 worker 租约竞争、空间 guard、MySQL 失败退避和缺失分区重建均正确。
- [ ] 验证预热、通知存储和 Fault Run 留存三个清理任务各自加锁、互不删除对方数据，且进度 API 不泄露秘密。

### F5. Sam 与 Cart Redis 大 key

- [ ] 验证 seed 中第 19 个账号为 Sam，拥有 `TRAFFIC_EXERCISE` 白名单/角色、可登录、独立购物车和演练所需前置数据；Runner 客户选择、会话、订单、库存补齐与串行生命周期全部排除 Sam。
- [ ] 验证 Redis 大 key 运行只由 Sam 经 Gateway 调用真实加购 API，正常客户和无效运行上下文不读取大 key；停止后仅清理该运行的 Sam 购物车项和 Redis key，不遗留在途请求或删除非演练数据。
- [ ] 验证 Cart Catalog 依赖失败发生在真实下游校验，失败时不写 Cart、CartItem 或版本；恢复后合法商品可正常加购。

### F6. 锁、通知与 PSP 场景

- [ ] 验证 Promotion 持续核对接口仅使用演练预留记录，真实反向锁顺序产生 MySQL 死锁，结束后准备数据和在途事务均收敛。
- [ ] 验证 Inventory 专用连接持有 `LOCK TABLES inventories WRITE` 时，库存可用性报表真实阻塞；停止、到期、异常和启动恢复均释放锁、关闭连接并恢复请求。
- [ ] 验证通知内存仅停止新保留、不自动释放，健康失败后仅能通过受限固定重启恢复；通知存储停止写入后仅按运行 ID 人工清理。
- [ ] 验证 PSP 正常、拒付和超时分别驱动 payment-service 的真实 HTTP 映射；通知与 PSP 场景只复用既有 Runner，不新增或修改其串行调度。

### F7. Worker、控制台与部署验收

- [ ] 验证报表、突增、Cart、Promotion 和 Inventory worker 的并发、间隔、取消、在途排空和停止顺序；它们不改写 `RunnerEngine` 的版本、串行间隔或生命周期。
- [ ] 验证控制台只展示场景 catalog 固定参数和数据库运行证据，活动运行时其他创建入口不可用；内存重启、存储清理与停止操作均受确认和审计保护。
- [ ] 执行 touched Maven 模块测试、traffic-control-plane `pnpm typecheck`、`pnpm lint`、`pnpm build`、目标 worker 测试和 Compose 场景 smoke tests；使用干净环境执行 PSP、重启 broker、分区预热和所有场景的端到端路径。

**完成条件**：所有 Phase A-E 开发任务完成；所有 Fault Run、业务路径、恢复、分区、时区、Sam 隔离、数据库留存与不兼容替换路径均有自动化或 Compose 验收覆盖；最终部署配置与文档不保留旧方案引用。

## 交付完成定义

1. 控制面以数据库约束保证全环境单一 Fault Run，并在控制面或网络异常时由目标侧到期/fencing 自行收敛可恢复资源。
2. 所有演练效果来自真实 HTTP、Redis、JVM、MySQL SQL/锁或文件路径，且控制调用、业务调用和 Runner 均经 Gateway 到达固定目标。
3. Redis 大 key 只由第 19 个账号 Sam 的独立演练购物车触发；Sam 永不参与普通串行 Runner 生命周期。
4. 两张慢 SQL 数据表以东八区日分区维持 180 天、每日 30 万、每表约 54M 行窗口，日切以创建/删除分区完成。
5. 服务、worker、MySQL 会话、报表语义和预热日切统一使用 `+08:00`。
6. 运行证据仅保存在控制面数据库和审计明细，已终止记录保留 7 天；本阶段不增加指标、告警、Grafana 面板或业务服务日志。
7. 旧通用 Chaos、Gateway fan-out、网络控制与旧控制台实现已完全删除，且最终验证与发布检查在 Phase F 集中完成。