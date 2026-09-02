# 商品详情 Redis 回源与 Hash 大值场景实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | Phase A-E 已完成，Phase F-G 待实施 |
| 版本 | 1.0 |
| 更新时间 | 2026-09-02 CST（Phase E 完成） |
| 关联产品规格 | [product.md](product.md) |
| 关联技术设计 | [tech.md](tech.md) |

## 任务规则

1. 开始任务时将 `- [ ]` 改为 `- [-]`；实现和对应验证全部完成后改为 `- [x]`。
2. 每完成一个任务，更新所属阶段的进度、问题、可能的解决方案和文档更新时间。
3. 每个阶段完成后更新阶段状态；只有该阶段所有任务和阶段验收完成后，才标记为已完成。
4. 发现问题时必须记录影响范围、复现条件和当前解决方案；尚未决定的内容标记为“待决策”，不能静默跳过。
5. 业务请求必须经 `gateway-service`；traffic-control-plane、Runner 和 Fault Run worker 不得直连 Catalog、Redis 或 MySQL 业务表。
6. 商品详情缓存和 Redis 数据结构只能由 `catalog-service` 管理；控制面不得直接写商品详情 Hash 或 active marker。
7. 一个运行只创建一个 Redis Hash；`memberCount` 是 field/member 数，不是顶层 key 数，也不是读取并发数。
8. 大值 payload 必须是可解析的商品详情 cache envelope；`memberSizeBytes` 代表序列化 value 的逻辑 UTF-8 字节数，不包含 Redis 内部开销。
9. 正常生命周期保留数据库登录；不缓存密码、JWT、session token 或 refresh token，不依赖客户端伪造的 Fault Run header。
10. 全环境同一时刻只允许一条 `CREATING`、`ACTIVE` 或 `RECOVERING` Fault Run；停止、到期、补偿和重启恢复必须遵循 fencing 与按运行清理规则。
11. 页面不得允许输入任意 Redis key、服务地址、URL、完整 value 或未受控 SKU 集合；所有参数由 catalog 和目标服务双重校验。
12. 不将“变慢”或“超时”写成所有参数组合必然满足的断言；只有明确 request deadline 被触发时才记录 timeout。
13. 完成任务时同步维护本文件，不修改产品/技术契约而不留下变更记录。

## 阶段总览

| 阶段 | 目标 | 状态 | 进度 | 前置依赖 |
| --- | --- | --- | --- | --- |
| A | 商品详情缓存契约与 Cache Resolver | 已完成 | 5 / 5 | 无 |
| B | 正常生命周期商品详情步骤 | 已完成 | 4 / 4 | A |
| C | Fault Run Catalog、Gateway 与 Coordinator | 已完成 | 5 / 5 | A |
| D | Catalog Hash 生成、Marker、Fencing 与清理 | 已完成 | 6 / 6 | A、C |
| E | 大值读取 Worker、停止与观测 | 已完成 | 4 / 4 | C、D |
| F | Traffic/Fault Run 页面与文档同步 | 待实施 | 0 / 4 | C、D、E |
| G | 测试、Smoke、恢复与发布验收 | 待实施 | 0 / 7 | A 至 F |
| **合计** |  | **进行中** | **24 / 35** |  |

---

## Phase A：商品详情缓存契约与 Cache Resolver

**阶段状态：已完成**
**阶段进度：5 / 5**

**当前问题**

- `CatalogService.getProduct()` 当前先查数据库，再调用 `LocalQueryCacheManager`；没有商品详情 Redis 命中、miss、回源和回填语义。
- 现有 `LocalQueryCacheManager` 是本地 JVM retention 组件，不适合承担商品详情响应缓存。
- `availableQty` 来自库存表，完整缓存 `ProductDTO` 会引入库存短暂陈旧问题。

**可能的解决方案**

- 新增 Catalog 专用商品详情 cache service、serializer 和 envelope，不复用 `LocalQueryCacheManager`。
- 使用 Hash field `sku` 存储商品详情；Redis 异常时只做有界数据库 fallback，不无限重试缓存。
- 为 envelope 增加逻辑过期时间，采用短 TTL/短 freshness 窗口；checkout 和库存预占继续使用领域服务的实时校验。

### A1. 定义商品详情 Redis 缓存协议

- [x] 明确默认 Hash、运行级 Hash、active marker、fencing key 的固定命名空间。
- [x] 明确正常缓存、运行缓存、marker 和 fencing 的 TTL、逻辑过期和清理责任。
- [x] 明确 `CACHE_HIT`、`CACHE_MISS_DB_FALLBACK`、`CACHE_INVALID_FALLBACK`、`CACHE_BACKEND_ERROR`、`PRODUCT_NOT_FOUND` 和 `PRODUCT_DETAIL_TIMEOUT` 结果码。
- [x] 更新 `tech.md` 与本清单，记录协议确认、未决项和最终选择。

**完成记录**

- 进度：`1 / 1`
- 问题：active marker 的原子发布和 fencing 删除属于 Phase D，当前阶段只需要固定协议和 resolver 校验规则。
- 可能的解决方案：默认 Hash 使用 `catalog:product-detail:cache`，运行 Hash 使用 `catalog:product-detail:exercise:{faultRunId}`，marker 使用 `catalog:product-detail:active`；正常 Hash 使用逻辑 TTL，运行 Hash/marker 使用运行 TTL 和按 run 清理。Phase D 沿用这些常量实现原子发布。

### A2. 实现商品详情 cache envelope 与序列化器

- [x] 定义包含 `schemaVersion`、`sku`、`cachedAt`、`expiresAt`、`product` 和可选 `padding` 的 envelope。
- [x] 实现 JSON 序列化、反序列化、字段类型校验和 envelope schema 版本校验。
- [x] 实现 UTF-8 logical bytes 计算和精确 padding；拒绝小于无 padding envelope 最小长度的 `memberSizeBytes`。
- [x] 确保大值 payload 仍能还原为对外一致的 `ProductDTO`，不把 padding 暴露到 API 响应。

**完成记录**

- 进度：`1 / 1`
- 问题：缓存 envelope 的最小大小由 ProductDTO 实际 JSON 字段决定，不能在控制面写死。
- 可能的解决方案：serializer 先计算带空 padding envelope 的 UTF-8 大小，再按 ASCII `x` 补齐；target 小于最小大小时由 Catalog target 拒绝。已通过 Unicode DTO、精确目标字节数和非法 envelope 测试。

### A3. 实现 Redis-first 商品详情读取

- [x] 修改 `CatalogService.getProduct()` 或其委托 service，先解析 active marker，再执行一次目标 Hash `HGET(sku)`。
- [x] 合法且未逻辑过期的 value 直接返回；field miss、逻辑过期或非法 envelope 回源 `ProductRepository.findBySku()`。
- [x] 数据库成功后回填当前目标 Hash；Redis write 失败不得覆盖已经获得的业务结果。
- [x] 保持 `ApiResponse<ProductDTO>`、商品不存在错误和既有公开接口路径不变。

**完成记录**

- 进度：`1 / 1`
- 问题：active marker 尚未由 Phase D provisioning 发布；当前 resolver 已支持 marker 校验，但无 marker 时回退默认 Hash。
- 可能的解决方案：由 Catalog cache service 封装 marker 选择和 Hash 读写，Controller 保持现有公开商品详情接口；Phase D 只负责发布/撤销 marker，不改变公开读取契约。

### A4. 处理缓存异常、库存 freshness 和 timeout

- [x] 为 marker 读取、HGET、HSET、反序列化和数据库 fallback 定义有界 timeout。
- [x] Redis backend error 时按约定记录结果并有界回源；数据库/详情请求超时返回稳定错误，不无限等待。
- [x] 对 `availableQty` 的短暂陈旧策略补充配置、逻辑 TTL 或明确文档说明。
- [x] 增加低基数 Micrometer 指标和结构化日志，不把 SKU、run ID、完整 key/value 或 token 作为高基数标签/日志内容。

**完成记录**

- 进度：`1 / 1`
- 问题：Catalog 服务内部 deadline 已固定为 Redis connect/read 1s/2s、商品 JPA 查询 2s 和库存 JDBC statement 2s；调用方 lifecycle 的 AbortController deadline 仍属于 Phase B。
- 可能的解决方案：当前使用 Redis driver timeout、逻辑 TTL、JPA query hint、JDBC statement timeout 和稳定的 `PRODUCT_DETAIL_TIMEOUT`/`PRODUCT_DETAIL_DB_ERROR` 映射；Phase B 再补调用方 deadline，避免 HTTP 请求无限等待。

### A5. 完成 Phase A 阶段验收

- [x] 验证 Redis hit 不访问商品数据库。
- [x] 验证 field miss 查询数据库并回填，第二次读取命中。
- [x] 验证 invalid envelope、逻辑过期、Redis 读写异常、商品不存在和数据库超时的结果码。
- [x] 验证默认 Hash 不设置会连带删除所有商品 field 的 key-level TTL。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；真实 Redis TTL/故障注入仍需在 Phase G Compose smoke 中复核。
- 可能的解决方案：已通过 `ProductDetailCacheSerializerTest`、`ProductDetailCacheServiceTest` 和 `CatalogServiceProductDetailCacheTest`；Phase G 再用小参数 Redis smoke 验证真实 driver timeout、marker 和运行 Hash。

---

## Phase B：正常生命周期商品详情步骤

**阶段状态：已完成**
**阶段进度：4 / 4**

**当前问题**

- 生命周期此前只在购物车商品不在初始目录结果时条件性调用商品详情，不能稳定覆盖商品详情缓存路径；现已增加必经步骤。
- probe SKU 与大值 target 的全量选择契约仍需在 Phase D 汇合；当前生命周期已按实际目录结果稳定排序选择 probe。
- 商品详情请求此前依赖下游默认超时；现已增加调用方受限 deadline，Catalog target 的全量压力验证仍属于 Phase G。

**可能的解决方案**

- 在 `LOGIN -> BROWSE_CATALOG` 后增加必经 `PRODUCT_DETAIL_READ`，从真实目录响应选择 SKU。
- 生命周期按 SKU 稳定排序取最后一个作为 probe；Phase D target 使用同一规则保留不生成的 field。
- orchestrator 使用 100ms 至 30s 的受限 request budget，并将中断与 timeout 分开记录。

### B1. 增加必经 `PRODUCT_DETAIL_READ` 步骤

- [x] 在 `TrafficActionOrchestrator.executeLifecycle()` 的登录和商品浏览成功后插入商品详情读取。
- [x] 使用现有 `GatewayClient.customerGet('/api/products/{sku}')`，保持 bearer session、trace 和 caller signal。
- [x] 详情步骤完成后才进入 `CART_READ_INITIAL`，失败不能悄悄跳过并报告完整生命周期成功。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；详情失败会在购物车读取之前终止本次生命周期。
- 可能的解决方案：复用现有 `runStep()`，使用当前 customer session、trace 和 caller signal；已通过生命周期 focused test。

### B2. 实现稳定 probe SKU 选择和响应校验

- [x] 从 `findSellableProducts()` 的实际结果中选择 probe SKU，不使用固定下架 SKU 或独立猜测的 SKU。
- [x] 与 Catalog target 约定稳定排序/保留规则，并在页面或 summary 中记录 probe 摘要。
- [x] 校验 `response.data.sku` 与请求 SKU 一致，缺失或错配返回稳定错误码。
- [x] 确保详情读取不改变后续购物车选品集合。

**完成记录**

- 进度：`1 / 1`
- 问题：Catalog target 的全量 SKU 选择将在 Phase D 实现；当前 lifecycle 已对有界目录结果按 SKU 稳定排序选择最后一个作为 probe。
- 可能的解决方案：保持与 `tech.md` 的“稳定排序后保留最后一个 probe”规则一致；若目录没有合法 probe，返回 `PRODUCT_DETAIL_NO_PROBE`，不猜测固定 SKU。已通过错配响应测试。

### B3. 增加详情请求 deadline 和 timeout 结果

- [x] 为商品详情请求增加可配置但服务端受限的 request deadline。
- [x] 区分 `LIFECYCLE_INTERRUPTED`、`PRODUCT_DETAIL_TIMEOUT`、HTTP 错误和响应格式错误。
- [x] 确保 timeout 后 session 仍按既有 finally 路径关闭，订单/购物车状态不被错误重试。

**完成记录**

- 进度：`1 / 1`
- 问题：调用方 timeout 默认 5 秒，服务端限制在 100ms 至 30s；Catalog/Redis/DB 内部 timeout 与调用方预算仍需在集成验证中对齐。
- 可能的解决方案：orchestrator 派生独立 `AbortController`，父 signal 只负责中断传播；deadline 映射为 `PRODUCT_DETAIL_TIMEOUT`，父 signal 映射为 `LIFECYCLE_INTERRUPTED`。已通过 100ms timeout、父 signal 中断和 session cleanup 测试。

### B4. 完成 Phase B 阶段验收

- [x] 验证 lifecycle 步骤顺序为 `LOGIN -> BROWSE_CATALOG -> PRODUCT_DETAIL_READ -> CART_READ_INITIAL`。
- [x] 验证商品详情请求经 Gateway、使用当前客户会话和 trace，不发送伪造 Fault Run header。
- [x] 验证商品详情失败/timeout 被记录为子步骤失败，后续不伪造成功结果。
- [x] 更新 `traffic-lifecycle-orchestrator.test.ts` 和相关 activity 断言。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；完整 runner 测试仍需在本次阶段收口时执行。
- 可能的解决方案：已补最小 mock、响应 SKU 校验、顺序断言、timeout 和父 signal 中断测试；保留既有购物车/checkout 分支并已通过 lifecycle focused test。

---

## Phase C：Fault Run Catalog、Gateway 与 Coordinator

**阶段状态：进行中**
**阶段进度：0 / 5**

**当前问题**

- 现有 `CART_REDIS_LARGE_VALUE` 固定指向 Cart/Sam；场景定义参数使用 `fieldCount`，与本方案的 Hash field 语义和 Catalog 目标不一致。
- `FaultRunCoordinator` 当前会丢弃 target start 的返回值，worker 和详情页面无法得到实际 member、bytes、probe 和 namespace。
- 旧 Cart 场景可能仍有 ACTIVE/RECOVERING 运行，直接改名会造成停止/清理兼容问题。

**可能的解决方案**

- 将可创建场景不兼容替换为 `CATALOG_REDIS_LARGE_VALUE`，固定 Catalog start/stop/cleanup target。
- 扩展 target summary 的持久化/事件模型，至少保留 field 数、逻辑/观测字节、probe 和成员摘要。
- 发布前清理旧 Cart 运行；如需迁移窗口，只保留受保护的固定旧 stop/cleanup，不允许创建新旧场景。

### C1. 替换 Fault Run 场景定义

- [x] 在 `fault-run-catalog.ts` 将 `CART_REDIS_LARGE_VALUE` 替换为 `CATALOG_REDIS_LARGE_VALUE`。
- [x] 固定 `targetService=catalog-service`、`targetOperation=catalog-product-detail-large-value`、`recoveryStrategy=TARGET` 和 manual cleanup 能力。
- [x] 参数改为 `durationSec`、`memberCount`、`memberSizeBytes`、`concurrency`、`requestIntervalMs`、`keyTtlSec`。
- [x] 保证参数名称、默认值、单位、错误码和页面提示与 `tech.md` 一致。

**完成记录**

- 进度：`1 / 1`
- 问题：旧 Cart 场景仍存在于部分 UI、worker 和历史文档，不能在 catalog 替换后继续作为可创建入口。
- 可能的解决方案：catalog 已改为 `CATALOG_REDIS_LARGE_VALUE`；C3 保留旧 Cart 仅释放/清理兼容，C5 再完成迁移盘点，Phase F 同步 UI 文案。catalog focused tests 已通过。

### C2. 增加 N/S/总预算/TTL 交叉校验

- [x] 校验所有参数为有限整数，并分别限制 member 数、单 member 大小、读取并发、读取间隔和运行时长。
- [x] 校验 `memberCount` 不超过可售 SKU 数减一，始终保留 probe SKU。
- [x] 校验 `memberCount * memberSizeBytes` 不超过部署侧 aggregate logical budget。
- [x] 校验 `keyTtlSec` 覆盖 `durationSec` 和清理余量，不允许用短 TTL 让 ACTIVE 运行自然丢失数据。
- [x] 在 Catalog target 重复执行权威校验，不依赖前端归一化。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；控制面静态校验与 Catalog target 的实时可售 SKU、envelope 最小大小、服务端 aggregate budget 校验已形成双重边界。
- 可能的解决方案：控制面负责快速反馈，Catalog provisioning service 在 start 时再次校验 47、member size、logical budget、TTL 和实时可售集合；已通过 catalog/provisioning focused tests。

### C3. 更新 Gateway 固定映射与内部 contract

- [x] 更新 `FaultRunDispatchController` 的 Catalog start/stop/cleanup 固定映射和 operation 校验。
- [x] 保持 `ScenarioRunContext`、内部服务认证、expiresAt、fencingToken 和 idempotencyKey 的转发。
- [x] 拒绝错误 scenario、错误 operation、错误 target service、任意 URL、任意 Redis key 和批量 targets。
- [x] 确认公开 `/api/products/{sku}` 路由仍只转发正常商品详情请求。

**完成记录**

- 进度：`1 / 1`
- 问题：旧 Cart stop/per-run cleanup 兼容与新 Catalog start/stop/cleanup 共享 Gateway contract，需要确保旧场景不能 start，也不能执行 scenario-wide cleanup。
- 可能的解决方案：TARGETS 只注册 Catalog；旧 Cart 只进入 release-only 兼容表，start 和 scenario-wide cleanup 校验不接受。Gateway focused test 已覆盖新 Catalog start、旧 Cart start 拒绝和旧 Cart scenario-wide cleanup 拒绝。

### C4. 扩展 target summary 持久化

- [x] 修改 Coordinator/Repository/Event 类型，使 target start 返回值可以写入 `TARGET_CONFIRMED` 或等价 detail summary。
- [x] 保存 `layout=HASH`、Hash namespace、memberCount、memberSizeBytes、logicalBytes、observedBytes、probeSku、member SKU 摘要和 TTL。
- [x] 限制成员摘要长度，禁止保存完整 value、密码、token 或 authorization header。
- [x] 让控制面重启后仍能为 worker 和详情页面提供已确认的成员集合。

**完成记录**

- 进度：`1 / 1`
- 问题：target summary 目前通过 `TARGET_CONFIRMED` 事件保存，主表没有独立 summary 字段；详情/worker 读取时需要按事件聚合。
- 可能的解决方案：先使用现有事件 payload 保存安全 summary，并限制 Hash key、SKU 和数组长度；若页面查询证明事件聚合不足，再增加 repository projection。Coordinator focused test 已验证真实 Gateway 双层响应和完整 value 被丢弃。

### C5. 完成 Phase C 阶段验收和旧运行迁移检查

- [x] 验证旧 Cart 场景不再出现在可创建 catalog 中。
- [x] 验证新场景的参数未知项、边界值、总预算和 TTL 错误均被拒绝。
- [x] 验证 Gateway 只能分发到 Catalog 固定目标。
- [x] 盘点并停止/清理旧 `CART_REDIS_LARGE_VALUE` ACTIVE/RECOVERING 运行，记录迁移结果。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；MySQL 旧运行查询和 Redis 旧 key 扫描均为空，因此没有需要执行的真实 stop/cleanup。
- 可能的解决方案：已在 MySQL 中确认没有旧 `CART_REDIS_LARGE_VALUE` 的 `CREATING/ACTIVE/RECOVERING` 记录，在 Redis 中确认 `cart:exercise:*:large-value` 数量为 0；代码层保留 per-run release/cleanup 兼容，但不再提供旧场景创建和 scenario-wide cleanup。

---

## Phase D：Catalog Hash 生成、Marker、Fencing 与清理

**阶段状态：已完成**
**阶段进度：6 / 6**

**当前问题**

- Catalog target、运行级商品详情 Hash、active marker、owner/fence companion keys 和按 run 清理已实现。
- 临时 Hash 完整写入并校验后才 rename 和发布 marker；marker 发布/删除使用 Lua CAS。
- Coordinator 已提供 worker drain hook，运行 Hash 与默认商品缓存使用不同 namespace。

**可能的解决方案**

- Catalog 增加固定内部 Fault Run controller/service，按运行 ID 派生 key，不接受 caller key，并校验 `FAULT_RUN_CONTROL` scope。
- 先写临时 Hash、校验数量和 logical bytes、设置 TTL，再原子 rename，最后使用 owner/fence CAS 发布 marker。
- stop/cleanup 先 compare-and-delete marker，再删除本 run Hash；运行 key、marker 和回填均有 TTL 兜底。

### D1. 实现 Catalog target start/stop/cleanup Controller

- [x] 新增固定的 `/internal/catalog/fault-runs/start`、`/stop` 和 `/cleanup` 入口或等价 service。
- [x] 校验 scenario、operation、内部认证、`ScenarioRunContext`、expiresAt 和 fencing token。
- [x] 使用 `ScenarioRunGuard.acceptStart()`，拒绝过期或旧 fencing token。
- [x] stop/cleanup 只接受服务端派生的 run ID namespace，不接受任意 key/path/body 参数。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；Catalog target 已复用现有内部运行上下文，并额外要求 `FAULT_RUN_CONTROL` downstream scope。
- 可能的解决方案：已由 `CatalogFaultRunController` 固定路由到 provisioning service；所有 key 由 run ID 派生，参数和请求来源由服务端校验。

### D2. 实现可售 SKU 选择和 probe 保留

- [x] 查询当前可售且库存为正的 SKU，并按确定性顺序排序。
- [x] 预留一个 probe SKU 不写入大 Hash，其余前 N 个 SKU 作为注入 members。
- [x] 在 start summary 保存 probe 和有界 member SKU 摘要，供 worker 使用。
- [x] 可售 SKU 不足、无法保留 probe 或选择结果不稳定时拒绝 start。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；可售 SKU 由 Catalog 数据库和库存快照共同决定。
- 可能的解决方案：已按 SKU 稳定排序保留最后一个 probe，并在集合不足时返回 `INSUFFICIENT_SELLABLE_PRODUCTS`；provisioning test 已验证顺序和 probe 排除。

### D3. 实现 Hash field 大值生成

- [x] 为每个注入 SKU 生成合法商品详情 envelope。
- [x] 通过 padding 让每个 value 的 UTF-8 logical bytes 精确等于 `memberSizeBytes`。
- [x] 计算并保存 logical bytes，另行读取/记录 Redis `MEMORY USAGE`，不混淆两个口径。
- [x] 生成过程中不写入商品、库存、购物车、订单或用户数据。

**完成记录**

- 进度：`1 / 1`
- 问题：Redis `MEMORY USAGE` 在单测中可为空，真实 observed bytes 需要运行 Redis 验证。
- 可能的解决方案：已复用正常 resolver serializer，logical bytes 作为强约束，`MEMORY USAGE` 作为非阻断观测；生成过程只写 Redis Hash。

### D4. 实现原子建立和 active marker 发布

- [x] 使用临时运行 key 批量写入 fields，校验 `HLEN`、逻辑大小和必要的实际内存占用。
- [x] 设置运行 Hash TTL，保证覆盖运行期、停止窗口和控制面故障恢复时间。
- [x] 使用原子 rename/transaction 或等价方案发布正式运行 key。
- [x] 在 Hash 完整可读后，以 compare-and-set 语义最后写入 `catalog:product-detail:active` marker。
- [x] 任一步骤失败都不发布 marker，并删除临时/正式运行 key。

**完成记录**

- 进度：`1 / 1`
- 问题：`MEMORY USAGE` 依赖 Redis 版本/权限，观测值可能为空；逻辑 payload、HLEN、TTL 和 marker CAS 不依赖该命令成功。
- 可能的解决方案：已采用临时 Hash + atomic rename，使用 Lua 同步设置 marker/owner/fence 和 TTL；start 失败会清理临时/正式 Hash，provisioning test 已覆盖 marker 拒绝回滚。

### D5. 实现 resolver 对 active marker 的选择

- [x] 无有效 marker 时读取默认商品详情 Hash。
- [x] marker schema、expiresAt、fencing、run namespace 校验通过时读取运行 Hash。
- [x] 注入 field 命中大 envelope，probe field miss 后回源数据库并回填运行 Hash。
- [x] marker 缺失、过期或读取异常按约定 fallback，不根据客户端 Fault header 猜测运行状态。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；resolver 已同时校验 marker schema、过期时间、run namespace、owner 和 fencing，运行 Hash 被淘汰后回填会恢复兜底 TTL。
- 可能的解决方案：已通过 marker 缺失、owner 不匹配、invalid/expired envelope 和运行 Hash TTL 恢复 focused tests。

### D6. 实现 fencing、stop、cleanup 和重启恢复

- [x] marker 删除使用 run ID + fencing token compare-and-delete，禁止无条件删除 active marker。
- [x] 运行 Hash 按 run namespace 删除，重复 stop/cleanup 视为幂等成功，错误 token 不得影响新运行。
- [x] 控制面停止顺序与目标 stop 顺序一致：先 drain worker，再撤销 marker，再清理 Hash。
- [x] 控制面和 Catalog 重启后扫描/识别 ACTIVE、RECOVERING、过期 marker 和未完成清理。
- [x] 目标本地 TTL 能在控制面不可用时阻止过期 Hash 继续影响正常详情请求。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；Catalog target 的 marker/hash CAS 清理、按 run 删除、TTL 兜底和 Coordinator worker drain hook 已实现。
- 可能的解决方案：Coordinator 在 target stop 前调用已注册 drain 并将结果写入 recovery event；Phase E 的商品详情 reader 注册同一 hook，Phase G 继续做真实重启/TTL 验收。已通过 stop 顺序 focused test。

---

## Phase E：大值读取 Worker、停止与观测

**阶段状态：已完成**
**阶段进度：4 / 4**

**当前问题**

- `ScenarioExerciseWorkers` 已移除旧 Sam/Cart 分支，并通过持久化 target summary 读取 Catalog members；真实 Gateway/Catalog reader smoke 已完成。
- `ControlledExerciseWorker` 已增加商品详情请求使用的 timeout、cache 结果和 p50/p95/p99 统计，并接入 Coordinator drain。
- 单个 Hash field 的 HGET 不会读取全部 N 个 field；只 provisioning 不足以保证请求变慢或超时，实际效果仍需按参数和环境观测。

**可能的解决方案**

- 使用 target summary 的 member SKU，通过 Gateway 调用商品详情 API；不建立客户 session，不写购物车；真实 smoke 已验证该路径。
- 复用受控 worker 的并发、间隔、AbortController 和 drain；每个请求独立 trace 并使用统一 deadline。
- 将 worker 统计与正常 lifecycle activity 分开写入 Fault Run events，超时只在 deadline 触发时记录；真实 smoke 观察到 cache hit、请求延迟和 drain，错误/timeout 计数由 focused tests 覆盖。

### E1. 改造 ScenarioExerciseWorkers 为 Catalog reader

- [x] 将 `CART_REDIS_LARGE_VALUE` 分支替换为 `CATALOG_REDIS_LARGE_VALUE`。
- [x] 不再加载 Sam、创建 customer session、写入购物车或发送 customer bearer token。
- [x] 从 target summary 读取 member SKU；summary 缺失时 setup failure，不猜测 SKU。
- [x] 通过 `GatewayClient.get('/api/products/{sku}')` 调用公开商品详情接口。

**完成记录**

- 进度：`1 / 1`
- 问题：无新增问题；summary 加载失败和 target event 写入失败会记录 setup failure。
- 可能的解决方案：通过依赖注入复用 `loadFaultRunTargetSummary`，worker 只调用公开详情 API；focused worker test 已验证只访问 member SKU、不访问 probe、不建立 customer session。

### E2. 增加并发、间隔和单请求 deadline

- [x] `concurrency` 只限制同时在途详情请求，不能改变已生成 field 数。
- [x] `requestIntervalMs` 控制请求节奏，运行到期或进入 RECOVERING 后不再发起新请求。
- [x] 每个请求使用独立 trace 和 per-request deadline，区分 timeout、HTTP error 和 worker stop。
- [x] 复用或扩展 `ControlledExerciseWorker`，避免未排空请求在 target cleanup 后继续访问。

**完成记录**

- 进度：`1 / 1`
- 问题：未发现阻塞问题；真实响应时间仍随 Gateway、Catalog、Redis 和 MySQL 状态变化，request deadline 只在明确超时信号出现时计数。
- 可能的解决方案：reader 为每次请求创建独立 deadline signal，worker stop 先 abort 新请求并等待 in-flight；真实 smoke 观察到商品详情延迟，focused tests 覆盖 timeout、worker stop 和 Coordinator drain。

### E3. 增加 Fault Run 读取统计和事件

- [x] 记录请求总数、成功数、失败数、timeout 数、在途数、latency 摘要和 stop reason。
- [x] 记录 cache hit/miss/error 的低基数结果汇总，但不保存完整 response value。
- [x] 记录 `SCENARIO_WORKER_SETUP_FAILED`、`SCENARIO_WORKER_DRAINED` 和周期性 summary。
- [x] 将 target summary、worker summary 和清理结果关联到 faultRunId/traceId。

**完成记录**

- 进度：`1 / 1`
- 问题：Catalog response header 只提供低基数 cache result，不能暴露缓存 value 或内部 Redis 细节。
- 可能的解决方案：Catalog 使用 `X-Castrel-Cache-Result`，worker 汇总 cache result、timeout、average latency 和 p50/p95/p99；真实 reader smoke 已通过 faultRunId 关联的 target summary/worker 运行验证事件统计路径，完整发布验收仍留给 Phase G。

### E4. 完成 Phase E 阶段验收

- [x] 验证 worker 只经 Gateway 读取已生成 SKU，不直连 Catalog、Redis、MySQL。
- [x] 验证 worker 不创建客户 session、不使用 Sam、不产生 Cart/CartItem 数据。
- [x] 验证 stop/expiry 时先停止新请求、排空在途请求，再进入 target stop/cleanup。
- [x] 验证 Hash 读取压力、详情响应延迟、错误和 timeout 可以被事件/指标观察到，但不保证固定超时。

**完成记录**

- 进度：`1 / 1`
- 问题：未发现阻塞问题；实际延迟、错误和 timeout 仍由运行参数、数据库和 Redis 状态共同决定，不承诺固定 504。
- 可能的解决方案：已通过 Gateway/Catalog 真实 smoke 验证 Hash hit、probe miss 回源、TTL/marker 和 cleanup；reader smoke 观察到 4 次计划请求、3 次完成请求、p50/p95/p99 和 drain 后 `inFlight=0`，focused tests 覆盖 HTTP error/timeout 计数。

---

## Phase F：Traffic/Fault Run 页面与文档同步

**阶段状态：待实施**
**阶段进度：0 / 4**

**当前问题**

- 现有场景页面仍显示 Cart/Sam、`fieldCount` 和 Cart 加购语义。
- target start summary 当前不完整，页面无法显示实际 field 数、logical/observed bytes、probe 和读取统计。
- 旧的 scenario-wide Cart cleanup 不符合按运行清理要求。

**可能的解决方案**

- 复用现有 Scenario Card、Fault Run detail、CSRF、确认、幂等和 audit 结构，只替换本场景参数与摘要。
- 页面明确显示“1 个 Hash + N 个 field”，把读取并发单独命名为 concurrency。
- 详情只展示非敏感摘要，使用 per-run cleanup，不展示完整 value 或内部秘密。

### F1. 更新 Scenario Card 参数和说明

- [ ] 更新 `ScenarioCardWithActions` 和场景 catalog UI，移除 Cart/Sam 大值文案。
- [ ] 展示 `memberCount`、`memberSizeBytes`、`durationSec`、`concurrency`、`requestIntervalMs` 和 `keyTtlSec`。
- [ ] 显示 `1 个 Redis Hash + N 个 SKU field`、预计 logical budget 和 field/并发的区别。
- [ ] 前端提交前做友好提示，但不替代服务端校验，不允许编辑 Hash key/value。

**完成记录**

- 进度：`0 / 1`
- 问题：待开始。
- 可能的解决方案：让页面从 catalog definition 动态渲染字段，避免 UI 重新维护一套参数 schema。

### F2. 更新 Fault Run 详情、事件和 cleanup 操作

- [ ] 展示 target summary、Hash namespace 摘要、field 数、logical/observed bytes、probe、TTL 和 marker 状态。
- [ ] 展示读取成功/失败/timeout、延迟摘要、worker drain、恢复和清理结果。
- [ ] 修正详情 response/type 不一致，确保 summary/event/audit 类型一致。
- [ ] 将页面 cleanup 改为 per-run cleanup，禁止继续调用旧 scenario-wide Cart cleanup。

**完成记录**

- 进度：`0 / 1`
- 问题：待开始。
- 可能的解决方案：扩展现有 FaultRunDetails 类型和详情组件，保留统一事件时间线。

### F3. 保持控制面权限和敏感信息边界

- [ ] 创建、停止、清理操作继续要求运营会话、CSRF、confirmation、idempotency 和 audit。
- [ ] 服务端拒绝任意服务名、URL、Redis key、完整 value 和未经允许的 SKU 集合。
- [ ] 页面不展示密码、access token、session token、refresh token、authorization header 或完整缓存 value。
- [ ] 校验消费者 Shopfront 路径无法访问 Fault Run 页面和内部 provisioning endpoint。

**完成记录**

- 进度：`0 / 1`
- 问题：待开始。
- 可能的解决方案：沿用 middleware、auth-fetch 和固定 Gateway internal contract；新增字段先经过服务端 allowlist。

### F4. 同步专题和既有规格文档

- [ ] 将本任务清单的状态和进度与 `product.md`、`tech.md` 保持一致。
- [ ] 更新 `_docs/chaos-inject-plane/` 和 `_docs/traffic-optimize/` 中的 Redis 大值、商品详情生命周期和旧 Cart/Sam 描述。
- [ ] 更新 API、流程图、场景名称、参数名称和验收条件，删除已失效的旧实现描述。
- [ ] 记录每次设计变更的原因、影响和解决方案，避免只修改任务状态而不更新契约。

**完成记录**

- 进度：`0 / 1`
- 问题：已知既有 task-list 仍保留旧 Cart/Sam 验收任务，需要在实现迁移时同步处理。
- 可能的解决方案：专题文档作为新大值方案唯一事实来源；既有文档保留历史说明时明确标注已被替换。

---

## Phase G：测试、Smoke、恢复与发布验收

**阶段状态：待实施**
**阶段进度：0 / 7**

**当前问题**

- 当前 Catalog 测试覆盖不足，缺少 Redis cache hit/miss、envelope、Hash provisioning、marker、fencing 和 cleanup 测试。
- 当前 lifecycle 测试没有必经商品详情步骤和 deadline 断言。
- 当前控制面没有覆盖商品详情 Fault Run 的 API/页面/Compose smoke；Redis 512MB 与控制面状态共享，过大预算可能影响租约和运行状态。

**可能的解决方案**

- 先做 service/unit/contract 测试，再用小参数短时 Compose smoke 验证真实 Redis、Gateway、Catalog 和正常 Runner。
- 使用 logical bytes 做输入预算，使用 `MEMORY USAGE` 做观测，不以 Redis 内部占用反推用户输入大小。
- 以无 Fault Run、Hash active、停止/到期后三组对照验证影响和恢复；将超时作为明确 deadline 的条件结果。

### G1. 完成 TypeScript catalog、Coordinator 和 lifecycle 测试

- [ ] 测试新场景名称、固定 target、未知参数、边界值、N/S 总预算和 TTL 规则。
- [ ] 测试 target start summary 保存、Fault Run detail 读取、stop/compensation/recovery 和旧 run 迁移行为。
- [ ] 测试 lifecycle 步骤顺序、probe 详情请求、response SKU 校验、失败/timeout 和 session cleanup。
- [ ] 测试 worker 使用 summary member SKU、并发/间隔/deadline、停止 drain 和不创建 customer session。

**完成记录**

- 进度：`0 / 1`
- 问题：待开始。
- 可能的解决方案：在现有 `test:runner` 之外补齐被 package script 漏掉的 worker/catalog/coordinator 测试，并保持测试使用依赖注入。

### G2. 完成 Catalog Java cache resolver 测试

- [ ] 测试 Redis hit 不访问 `ProductRepository`。
- [ ] 测试 miss 查询数据库、生成 DTO、HSET 回填和第二次 hit。
- [ ] 测试 invalid envelope、逻辑过期、marker 缺失/过期、Redis read/write error、商品不存在和数据库 timeout。
- [ ] 测试公开响应仍为既有 `ApiResponse<ProductDTO>`，padding 不进入响应。

**完成记录**

- 进度：`0 / 1`
- 问题：待开始。
- 可能的解决方案：使用 Mockito 验证 repository/Redis 调用次数，必要时用 Testcontainers/Compose Redis 做序列化和 TTL 验证。

### G3. 完成 Catalog provisioning、fencing 和 cleanup 测试

- [ ] 测试可售 SKU 选择、probe 排除、Hash field 数量和精确 logical bytes。
- [ ] 测试 aggregate budget、envelope 最小长度、TTL、错误 operation、错误 scenario 和错误 fencing。
- [ ] 测试 marker 最后发布、半成品失败回滚、compare-and-delete、重复 cleanup 和旧 token 不影响新 run。
- [ ] 测试控制面/Catalog 重启后过期 marker、未完成清理和运行 TTL 行为。

**完成记录**

- 进度：`0 / 1`
- 问题：待开始。
- 可能的解决方案：把 Redis 命令交互封装为可替换 adapter；对 Lua/transaction 使用集成测试验证原子语义。

### G4. API 和控制台 smoke

- [ ] 使用运营 session、CSRF、confirmation 和 idempotency 创建短时 `CATALOG_REDIS_LARGE_VALUE`。
- [ ] 验证 Gateway 固定转发到 Catalog，Fault Run 进入 `ACTIVE`，target summary、event 和 audit 可查询。
- [ ] 验证页面显示 Hash/field/N/S/concurrency 的正确含义，不显示 value/secret。
- [ ] 验证停止、per-run cleanup 和页面状态更新。

**完成记录**

- 进度：`0 / 1`
- 问题：待开始。
- 可能的解决方案：优先使用 API smoke，再补 Traffic/Fault Run 页面 Playwright；测试用小 N、低 S 和短 duration，避免影响共享 Redis。

### G5. Redis、商品详情和生命周期对照验证

- [ ] 用 Redis 只读命令验证运行 key 类型为 Hash、field 数为 N、每个 value logical bytes 为 S。
- [ ] 另行记录 `MEMORY USAGE`、marker、TTL、Hash namespace 和默认缓存隔离。
- [ ] 注入 SKU 详情请求验证 cache hit；probe 第一次验证 miss -> DB -> HSET，第二次验证 hit。
- [ ] 无 Fault Run 验证正常生命周期包含 `LOGIN -> BROWSE_CATALOG -> PRODUCT_DETAIL_READ -> CART`。
- [ ] 有 Fault Run 验证正常 lifecycle 和 worker 的详情 latency、DB query、Redis memory、错误和 timeout 变化。

**完成记录**

- 进度：`0 / 1`
- 问题：Hash 单 field HGET 不会自动传输全部 N 个 members，单纯增大 N 不代表单请求必然变慢。
- 可能的解决方案：同时运行 bounded reader worker 产生真实读取/响应压力；验收比较趋势，不把 504 写成固定结果。

### G6. 停止、到期、故障和重启恢复验证

- [ ] 验证停止顺序为停止新 worker 请求、排空/取消在途请求、撤销 marker、删除本 run Hash。
- [ ] 验证到期、手动 stop、target start compensation 和控制面重启使用一致的清理语义。
- [ ] 验证 Catalog/控制面重启后过期 marker 不会重新激活，旧 fencing 不会删除新 Hash。
- [ ] 验证默认商品缓存、products/inventories、Cart、订单和其它运行数据不受清理影响。

**完成记录**

- 进度：`0 / 1`
- 问题：待开始。
- 可能的解决方案：在 stop/expiry/restart 场景中保留 Redis、Fault Run events 和 Catalog 日志证据，按时间顺序核对 marker、worker 和 Hash 状态。

### G7. 发布前检查

- [ ] 执行 `mvn clean install -pl common -DskipTests` 和 Catalog/Gateway 相关 Maven tests。
- [ ] 执行 `cd traffic-control-plane && pnpm test:runner && pnpm typecheck && pnpm lint && pnpm build`。
- [ ] 执行 `./scripts/integration-test.sh`，补充商品详情 Hash 场景 smoke 并确认显式 lifecycle Secret/内部 key 前置条件。
- [ ] 全仓搜索旧 `CART_REDIS_LARGE_VALUE` 创建入口、Cart/Sam 大值 worker、旧 scenario-wide cleanup 和错误文案。
- [ ] 更新本清单、`product.md`、`tech.md`、既有规格和发布记录；Phase G 全部通过后将状态改为“已完成”。

**完成记录**

- 进度：`0 / 1`
- 问题：当前 `_docs/tasks/` 不存在，仓库现行专题文档位于 `_docs/scenarios/`、`_docs/chaos-inject-plane/` 和 `_docs/traffic-optimize/`。
- 可能的解决方案：以本专题 `product.md`、`tech.md`、`task-list.md` 为商品详情 Redis 场景的实施入口，并在发布检查中注明文档来源。

---

## 总体进度记录

| 更新时间 | 已完成 | 总任务 | 当前阶段 | 主要问题 | 可能的解决方案 |
| --- | ---: | ---: | --- | --- | --- |
| 2026-09-02 CST | 24 | 35 | Phase F：Traffic/Fault Run 页面与文档同步 | Phase F/G 尚未开始；实际变慢或 timeout 仍需按运行参数观测 | Phase E 已完成 reader、summary 校验、per-request deadline、timeout/cache/latency 统计和 drain；E4 真实 Gateway/Catalog smoke 已验证 Hash hit、probe miss 回源、TTL/marker、cleanup 和 reader drain |

## 变更记录

| 日期 | 变更 | 原因 | 影响/解决方案 |
| --- | --- | --- | --- |
| 2026-09-02 CST | 创建专题任务清单，按 `tech.md` 拆分为 7 个阶段、35 个任务 | 为实现商品详情 cache-aside 和 Hash 大值场景提供可追踪执行入口 | 新增状态/进度/问题/解决方案/验收记录；旧 Cart/Sam 大值方案按迁移任务处理 |
| 2026-09-02 CST | 完成 Phase A：缓存协议、envelope、Redis-first 读取、数据库 timeout 和 focused tests | 开始按任务清单实施 | A1-A5 标记完成，进度更新为 5/35；Phase D 的 marker provisioning 和真实 Compose 验证保留为后续任务 |
| 2026-09-02 CST | 完成 Phase B：必经商品详情读取、probe 选择、响应校验、request deadline 和 lifecycle tests | 让正常生命周期稳定触发商品详情缓存链路，并为大值运行保留未生成 probe field | B1-B4 标记完成，进度更新为 9/35；Catalog target 的实际 marker/Hash provisioning 仍在 Phase D |
| 2026-09-02 CST | 完成 Phase C1、C3、C4，并完成 C2 控制面校验 | 将旧 Cart 大值创建契约迁移到 Catalog，并让 worker/UI 后续能够识别安全的运行摘要 | C1、C3、C4 标记完成；C2 的 Catalog target 权威校验留给 Phase D，整体进度为 12/35 |
| 2026-09-02 CST | 收紧旧 Cart release-only 边界并更新 Catalog 场景 UI 元数据 | 避免旧 scenario-wide cleanup 继续影响新商品详情场景 | Gateway 仅允许旧 Cart per-run stop/cleanup 兼容；旧 Cart start 和 scenario-wide cleanup 被拒绝；相关 focused Gateway 测试通过 |
| 2026-09-02 CST | 完成 C5 旧 Cart 运行迁移盘点 | Redis/MySQL 已启动后确认旧场景没有活动运行或遗留 Redis key | MySQL 中旧场景 `CREATING/ACTIVE/RECOVERING` 查询为空，Redis `cart:exercise:*:large-value` 扫描为 0；无需执行 cleanup，C5 标记完成，整体进度更新为 13/35 |
| 2026-09-02 CST | 完成 Phase D：Catalog Hash provisioning、active marker、owner/fence CAS、按 run 清理、TTL 兜底和 Coordinator worker drain hook | 让商品详情请求能够切换到运行 Hash，并保证 stop/recovery 不误删新运行 | D1-D6 标记完成，C2 的 Catalog target 权威校验由 provisioning service 执行；Catalog focused tests、Runner/typecheck/lint、Gateway tests 和隔离 Redis CAS smoke 通过，整体进度更新为 20/35 |
| 2026-09-02 CST | 完成 Phase E1-E3：Catalog reader、成员 summary、deadline、timeout/cache/latency 统计和 drain 接入 | 让大值运行通过真实商品详情 API 读取已生成 members，并将影响与恢复结果纳入 Fault Run 事件 | E1-E3 标记完成，新增 8 项 focused worker/summary 测试，`pnpm test:runner` 44/44 通过；E4 真实 Gateway/Catalog 压力对照待运行环境完成，整体进度更新为 23/35 |
| 2026-09-02 CST | 完成 Phase E4：Gateway/Catalog 真实商品详情、Hash hit/probe miss、TTL/marker/cleanup 和 reader drain smoke | 验证大值 worker 的真实业务链路、低基数 cache result、延迟统计和停止顺序 | E4 标记完成；真实 reader smoke 4 次计划请求、3 次完成、停止后 `inFlight=0` 且 Coordinator 状态为 `STOPPED`；HTTP error/timeout 计数由 focused tests 覆盖，整体进度更新为 24/35 |

## 完成定义

本专题只有在以下条件全部满足后才能标记为完成：

- Phase A 至 F 的实现、阶段验收和文档同步完成。
- Phase G 的单元、契约、API、Redis、Compose、停止/到期/重启恢复检查全部通过。
- 正常生命周期可以稳定执行 `LOGIN -> BROWSE_CATALOG -> PRODUCT_DETAIL_READ`，并验证商品详情的 Redis hit、miss 回源和回填。
- 商品详情大值运行只创建一个 Hash、N 个 field，每个 field 的逻辑 value 大小为 S，worker 通过 Gateway 读取已生成 members。
- probe field 第一次读取可观察到 `Redis miss -> DB query -> HSET`，后续读取可观察到 hit。
- stop/expiry/restart 不会删除默认缓存或业务数据；旧 fencing 不能删除新运行资源。
- 运行页面、Fault Run 事件和文档不泄露密码、token、完整 value 或任意内部连接信息。
- 构建、类型检查、lint、Maven tests、integration smoke 和发布前旧引用清理检查全部通过。
