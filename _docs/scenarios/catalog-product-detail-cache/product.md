# 商品详情 Redis 回源与 Hash 大值场景产品规格

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | Phase F 页面与文档已完成，Phase G 待验收 |
| 版本 | 1.0 |
| 更新时间 | 2026-09-02 CST（Phase F 完成） |
| 面向对象 | 培训运营、产品、研发、测试、SRE |
| 配套设计 | [tech.md](tech.md) |

## 1. 背景与问题

当前客户生命周期已经具备真实登录、商品浏览、购物车、结算和支付/取消路径，但商品详情查询仍然是数据库优先，不能展示一个有业务意义的 Redis 缓存回源过程。

本方案把商品详情作为正常生命周期中的缓存场景：

```text
登录 -> 浏览商品列表 -> 查询商品详情 -> 加购 -> 结算 -> 查单 -> 支付或取消
```

商品详情适合作为目标业务，因为用户浏览列表后通常会打开详情页，SKU 是稳定的业务标识，详情数据也天然适合按 SKU 缓存。登录本身仍然使用 user-service 的数据库认证，不把密码、JWT 或 session token 作为 Redis 缓存内容。

在此基础上，Redis 大值演练不再写入 Cart 专用 key，而是写入商品详情缓存使用的 Hash。运营人员可以在 Traffic/Fault Run 页面指定 field 数量和每个 field 的逻辑大小，让同一条商品详情读取链路承受真实的 Redis 读取、序列化和网络传输压力。

## 2. 产品目标

1. 正常生命周期在登录和商品列表浏览后，必经一次商品详情读取。
2. 商品详情遵循明确的 cache-aside 语义：Redis 命中直接返回；field 不存在时查询数据库并回填 Redis。
3. 运营人员可以创建一个商品详情 Redis Hash 大值运行：一个顶层 Hash、N 个 SKU field、每个 field 一个指定逻辑大小的合法缓存值。
4. 大值运行通过真实的商品详情 API 影响正常生命周期和持续读取 worker，而不是通过伪造延迟或控制面直接改写业务结果。
5. 运营人员可以观察缓存命中、缓存 miss 回源、详情请求延迟、失败、超时以及停止后的恢复结果。
6. 运行停止、到期或控制面重启后，不删除默认商品缓存、商品数据库、购物车或订单数据。

## 3. 范围

### 3.1 包含

- 生命周期第一步仍是客户真实登录。
- 商品列表浏览之后新增 `PRODUCT_DETAIL_READ` 步骤。
- 商品详情 `GET /api/products/{sku}` 使用 Redis Hash cache-aside。
- `CATALOG_REDIS_LARGE_VALUE` 场景在一个运行级 Hash 中生成 N 个 SKU fields。
- 每个 field 的 value 是可被商品详情服务反序列化的合法缓存 envelope，并达到运营人员指定的逻辑字节数。
- Fault Run worker 通过 Gateway 持续读取已经生成的大 field。
- 生命周期固定读取一个没有被当前运行预生成的 SKU field，完成一次真实的 miss、数据库回源和缓存回填。

创建操作必须经过运营确认；运行详情从受保护的 Fault Run 事件读取 target summary、worker 统计、marker/TTL 和 recovery 结果。运行进入 `RECOVERED` 或 `STOPPED` 后，页面只提供带 `faultRunId` 的 per-run cleanup，不提供按场景清空商品缓存的操作。
- Traffic/Fault Run 页面展示参数、预算、运行状态、读取结果和恢复结果。
- 运行、事件、审计和清理行为遵循现有 Fault Run 权限与单运行约束。

### 3.2 不包含

- 不把登录改为 Redis-first，不缓存密码、JWT、session token 或 refresh token。
- 不继续使用 Cart Redis exercise Hash、Sam 演练账号或购物车写入来制造大值读取。
- 不提供 String/Hash 选择；本场景固定使用一个 Hash。
- 不把 N 解释为 N 个顶层 Redis key，也不把 N 与读取并发数混用。
- 不允许 Traffic 页面或 worker 直接连接 Redis、MySQL 或业务服务；所有业务请求仍经 Gateway，Redis 写入由 Catalog 所有。
- 不保证任意参数组合都必然产生 504。过慢或超时必须以实际资源压力和明确的请求 deadline 为依据。
- 不把商品详情缓存作为 checkout 的权威价格、库存或资格来源；结算仍由现有服务端校验负责。

## 4. 用户与角色

| 角色 | 主要行为 | 约束 |
| --- | --- | --- |
| 培训运营人员 | 在受保护的 Traffic/Fault Run 页面创建、查看、停止商品详情大值运行 | 需要运营会话、CSRF、确认、幂等键和审计；不能输入任意 Redis key 或服务地址 |
| 正常生命周期 Runner | 登录后浏览目录并读取商品详情 | 只使用配置的客户账号，经 Gateway 调用公开客户 API；不使用 Sam 演练账号 |
| 大值读取 Worker | 持续读取已生成的商品详情 fields | 只经 Gateway 调用 `GET /api/products/{sku}`；并发和间隔不改变 field 数 |
| Catalog 服务 | 管理商品详情缓存、数据库回源、Hash 生成和清理 | 是商品详情缓存与 Redis 数据结构的唯一所有者 |
| Gateway | 转发公开商品 API 和固定 Fault Run target | 只接受 catalog 中声明的固定目标，不接受任意 URL、服务或 Redis key |

## 5. 正常生命周期

每条生命周期继续使用同一真实客户会话和同一 `traceId`。新增步骤位于商品列表成功之后、读取购物车之前：

| 顺序 | 步骤 | 产品行为 | 成功条件 |
| --- | --- | --- | --- |
| 1 | `LOGIN` | 使用演示客户账号登录并建立 bearer session | 登录响应中的客户 ID 与账号预期一致 |
| 2 | `BROWSE_CATALOG` | 通过目录 API 获取可售且有库存的商品 | 获得至少一个合法 SKU；没有候选时记录 `NOOP` |
| 3 | `PRODUCT_DETAIL_READ` | 从本次目录结果中按稳定规则选择一个 probe SKU，调用商品详情 API | 返回的商品存在、SKU 与请求一致，并记录缓存结果和耗时 |
| 4 | `CART_READ_INITIAL` 及后续购物车步骤 | 保留已有购物车，选择其它可售 SKU 继续加购 | 沿用现有生命周期规则 |
| 5 | `CHECKOUT`、查单、支付/取消 | 完成现有订单收尾分支 | 沿用现有生命周期规则 |

probe SKU 是业务层面的正常详情读取对象。创建大值运行时，Catalog 会从注入 field 集合中排除该 SKU；因此运行开始后第一次详情读取会自然地产生：

```text
HGET 运行 Hash probeSku -> field 不存在
查询商品数据库 -> 生成 ProductDTO
HSET 运行 Hash probeSku -> 返回详情
```

后续再次读取同一个 field 时应成为缓存命中，不通过每次删除 field 的方式伪造 miss。

## 6. 商品详情缓存产品语义

### 6.1 读取结果

| 情况 | 用户可见行为 | 运营观测结果 |
| --- | --- | --- |
| 合法缓存命中 | 直接返回商品详情 | `CACHE_HIT` |
| field 不存在或逻辑过期 | 查询商品数据库，成功后回填并返回详情 | `CACHE_MISS_DB_FALLBACK` |
| 缓存值无法反序列化 | 丢弃该值并按 miss 回源 | `CACHE_INVALID_FALLBACK` |
| Redis 不可用 | 有界地绕过缓存查询数据库；数据库成功时仍返回详情 | `CACHE_BACKEND_ERROR` |
| 商品不存在 | 返回既有商品不存在错误 | `PRODUCT_NOT_FOUND` |
| 数据库或详情请求超过 deadline | 返回稳定错误，不无限等待 | `PRODUCT_DETAIL_TIMEOUT` 或下游错误码 |
| 商品数据库不可用 | 返回稳定的服务错误，不把异常细节暴露给客户 | `PRODUCT_DETAIL_DB_ERROR` |

缓存命中只表示商品详情缓存有效，不改变商品详情 API 的响应 envelope。商品库存可能随交易变化，缓存必须采用短 TTL 或逻辑过期；checkout、库存预占和优惠券校验仍以各领域服务的实时数据为准。

### 6.2 对正常业务的影响

没有活动大值运行时，商品详情使用默认商品缓存命名空间。活动运行时，Catalog 服务端 marker 将商品详情读取切换到当前运行 Hash：

- 注入的 SKU field 命中指定大小的合法 envelope，详情响应仍保持正常业务格式。
- 未注入的 probe SKU field 先 miss，再查询数据库并回填同一个运行 Hash。
- 正常生命周期和 Shopfront 的商品详情请求都可以受到当前运行影响，不需要客户端携带 Fault Run header。
- 大值运行停止或到期后，商品详情回到默认缓存命名空间。

## 7. Traffic/Fault Run 页面行为

当前控制面入口是受保护的 Fault Run 场景页面。页面不直接写 Redis，而是提交经 catalog 校验的运行创建请求。

### 7.1 用户输入

| 参数 | 页面含义 | 规则 |
| --- | --- | --- |
| `durationSec` | 运行持续时间 | 服务端按场景上限校验 |
| `memberCount` | 一个 Hash 中的 field 数量 N | 必须小于可售 SKU 数，至少保留一个 probe SKU |
| `memberSizeBytes` | 每个 field value 的逻辑 UTF-8 字节数 S | 必须足够容纳合法商品详情 envelope |
| `concurrency` | 持续读取 worker 的并发请求数 | 只控制请求压力，不改变 N |
| `requestIntervalMs` | 读取请求之间的间隔 | 服务端限制范围 |
| `keyTtlSec` | 运行 Hash 的兜底 TTL | 必须覆盖运行期和清理余量 |

页面必须同时显示以下解释，避免把 Hash field 误认为顶层 key：

```text
本次运行：1 个 Redis Hash，N 个商品 SKU field
预计逻辑 payload：N × S bytes
读取并发：concurrency（不增加 field 数）
```

页面可显示预计逻辑预算和实际观测到的 Redis `MEMORY USAGE`，但不显示完整 field value、密码、token 或原始 authorization header。

创建操作必须经过运营确认；运行详情从受保护的 Fault Run 事件读取 target summary、worker 统计、marker/TTL 和 recovery 结果。运行进入 `RECOVERED` 或 `STOPPED` 后，页面只提供带 `faultRunId` 的 per-run cleanup，不提供按场景清空商品缓存的操作。

### 7.2 运行状态

运行详情至少展示：

- 场景、固定目标、运行 ID、状态、开始时间、到期时间和停止原因。
- Hash 为一个顶层 key、实际 field 数、每 field 逻辑大小、总逻辑字节和 Redis 实际占用摘要。
- 注入 SKU 覆盖摘要、probe SKU、当前 marker/TTL 状态。
- 详情读取请求总数、成功数、失败数、timeout 数、延迟摘要和 worker drain 状态。
- `CACHE_HIT`、`CACHE_MISS_DB_FALLBACK`、`CACHE_BACKEND_ERROR` 等低基数结果摘要。
- target start、停止、恢复、清理和审计事件。

页面不得展示完整 Redis key value。Hash key 只能作为受保护运行详情中的 namespace 摘要，不作为用户可编辑输入。

## 8. 停止、到期与恢复

停止或到期时按以下顺序处理：

1. 禁止大值读取 worker 发起新请求。
2. 等待或取消在途详情请求，并记录 drain 结果。
3. 由 Catalog 撤销当前运行 marker，防止新的正常详情请求继续选择运行 Hash。
4. 删除本次运行创建的 Hash；运行 Hash 的 TTL 作为控制面或目标服务异常时的兜底。
5. 将 Fault Run 更新为 `STOPPED` 或 `RECOVERED`，写入清理摘要。
6. 正常商品缓存、商品数据库、购物车、订单和其它运行数据保持不变。

旧 fencing token、旧 run ID 或重复 stop 请求不能删除新运行的 marker 或 Hash。控制面重启后应扫描未终止运行，Catalog 重启后也不能重新激活过期 marker。

## 9. 产品验收标准

1. 正常生命周期的步骤中存在 `LOGIN -> BROWSE_CATALOG -> PRODUCT_DETAIL_READ`，并且详情读取发生在购物车操作之前。
2. 第一次读取没有缓存 field 的商品时，服务查询数据库并回填 Redis；第二次读取同一 field 命中 Redis。
3. 商品详情 Redis 故障时，服务按约定记录 `CACHE_BACKEND_ERROR`，数据库可用时能有界回源；数据库不可用或超过 deadline 时返回稳定失败结果。
4. 页面创建的运行只产生一个 Hash；Hash field 数等于 N，每个 field 的逻辑 payload 大小等于 S，并且所有 value 都能被商品详情服务解析。
5. N 表示 field 数，`concurrency` 只表示读取请求并发；页面明确显示“1 个 Hash + N 个 field”。
6. 注入 field 的详情请求沿用 `GET /api/products/{sku}`，经 Gateway 到 Catalog，不需要客户端伪造 Fault Run header。
7. 生命周期 probe SKU 未被预生成；运行开始后的第一次 probe 读取出现 miss、数据库回源和回填，后续读取可以命中。
8. 大值运行停止或到期后，marker 被撤销、worker 收敛、运行 Hash 被删除或由 TTL 清理，默认缓存和业务数据不受影响。
9. 运营操作受权限、CSRF、确认、幂等和审计保护；不能输入任意服务、URL、Redis key、SKU 集合或完整 value。
10. 无 Fault Run 时验证生命周期正常完成；有 Fault Run 时能够观察详情延迟、失败、timeout、Redis 内存和 Catalog 数据库访问变化，但不把超时承诺为所有参数组合的必然结果。

## 10. 术语

| 术语 | 定义 |
| --- | --- |
| 商品详情 cache-aside | 先查 Redis，未命中时查数据库并回填缓存 |
| Hash field/member | Hash 内以 SKU 为 field name 的一条商品详情缓存记录 |
| `memberCount` | 一个运行级 Hash 的 field 数量 N |
| `memberSizeBytes` | 每个 field value 的逻辑 UTF-8 序列化字节数 S |
| probe SKU | 当前运行明确不预生成、用于验证 miss 回源的 SKU |
| logical bytes | value 序列化后的 UTF-8 字节数，不含 Redis key、field name 和 Redis 内部开销 |
| observed bytes | Redis `MEMORY USAGE` 等工具观测到的实际占用摘要 |
