# 场景操作手册产品规格

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | 规划中 |
| 版本 | 1.0 |
| 更新时间 | 2026-09-03 CST |
| 面向对象 | 培训运营、研发、测试、SRE |
| 实现设计 | [tech.md](tech.md) |

## 1. 产品定义

场景操作手册是 `traffic-control-plane` 中面向运营人员的只读知识页面。运营人员可以在执行演练前后，按场景查看真实业务路径中的底层实现逻辑、可能影响的服务和资源、恢复边界，以及在 Tempo 中定位现象所需的服务名、接口、时间范围与 TraceQL 参数。

手册属于受保护的 Fault Run 控制台，不是消费者商城、公开文档站或独立微服务。它不改变任何场景行为、业务 API、Gateway 分发、Tempo/Grafana 配置或 Operator 权限。

## 2. 目标与非目标

### 2.1 目标

1. 覆盖当前场景 catalog 中的全部 12 个 `FaultRunScenario`，而不是仅说明部分高风险场景。
2. 为每个场景提供可审计的底层逻辑、业务调用链、影响范围、恢复方式和排障证据说明。
3. 支持 English 与简体中文；语言切换后保持当前场景选择和页面位置。
4. 复用 Markdown 编写长篇内容，支持 GitHub 风格表格、列表、代码块和 Mermaid 流程图/时序图。
5. 向操作人员提供可复制的 Tempo 查询参数，而不是要求其猜测服务、接口或错误筛选方式。
6. 明确区分控制面运行记录、业务日志、指标和 OTel trace，避免将不同证据源误解为同一数据。
7. 让文档跟随控制台发布，避免运行时依赖开发仓库根目录或外部文档服务。

### 2.2 非目标

- 不新增独立的文档服务、数据库表、后台 worker 或公开 API。
- 不向 `shopfront`、消费者 API 或业务服务暴露操作手册。
- 不修改 `gateway-service`、业务服务、OTel Java agent、Tempo、Grafana、告警规则或 Kubernetes 基础设施。
- 不自动执行、停止、清理或恢复演练；手册只提供说明和现有控制台入口。
- 不生成 Grafana Explore 链接、Tempo trace 深链、外部重定向或基于运行 ID 的查询 URL。
- 不承诺 `fault_runs.trace_id` 或 `X-Trace-Id` 可以作为 OTel trace ID 查询。
- 不把 Markdown 当作用户提交内容；首版只渲染仓库随控制台发布的受控文章。

## 3. 用户与使用场景

| 用户 | 目标 | 典型使用方式 |
| --- | --- | --- |
| 培训运营人员 | 了解开始某场演练前的风险和停止边界 | 在场景控制页开始运行前打开对应手册，确认固定目标、影响范围和恢复策略。 |
| SRE | 定位一次演练期间的慢请求、错误或资源竞争 | 读取手册给出的 Tempo 服务、路由、时间范围和 TraceQL，手动在已有观测界面中检索。 |
| 研发/测试 | 复核场景是否来自真实业务实现 | 查看调用链、关键资源、已知限制和与源码一致的实现描述。 |
| 双语团队成员 | 用熟悉的语言理解同一场景 | 使用控制台现有语言切换器在 English 与简体中文间切换，不改变场景码、服务名或查询参数。 |

## 4. 体验与导航

### 4.1 路由与访问

- 手册入口为受保护路由 `/runbooks`。
- 文章选择使用 `/runbooks?scenario=<SCENARIO_ID>`，例如 `/runbooks?scenario=INVENTORY_TABLE_EXCLUSIVE`。
- 未登录访问沿用控制台既有认证中间件，跳转到 `/login` 并保留 `returnTo`。
- 手册不调用内部写 API，不新增 CSRF 流程，也不改变 Operator 身份或权限模型。

### 4.2 页面结构

页面是高密度的运营工作区，而非营销式落地页：

1. 页面标题和简短说明，明确这是只读操作手册。
2. 按既有场景分组显示的目录；当前文章有明显状态和 `aria-current` 标记。
3. 文章区显示稳定场景码、固定目标服务/操作、双语长文和 Mermaid 图表。
4. Tempo 诊断面板显示服务、接口或业务路径、建议相对时间范围，以及可复制的服务、错误和慢请求 TraceQL。
5. 文章内的 SQL、TraceQL、JSON 和 shell 示例以普通代码块展示；Mermaid fenced block 渲染为图表。

桌面可并列显示目录与文章，窄屏按正常文档流显示，确保中文长文本、表格、代码和图表不遮挡其他控件。

### 4.3 语言策略

- 支持 `en` 和 `zh-CN`，复用控制台现有 `control_plane_locale` Cookie 和语言切换器。
- 控制壳层、目录、按钮、加载/错误状态、Tempo 面板和无障碍标签随当前语言显示。
- 英文和中文各有完整的 12 篇 Markdown 文章，不依赖机器翻译或浏览器翻译。
- 场景码、服务名、操作名、路由、表名、错误码、事件名、参数名、TraceQL、SQL 和机器值保持原样。
- 切换语言不得改变 pathname、`scenario` query、认证 Cookie、业务请求或运行数据。

## 5. 场景覆盖与影响范围

每篇文章至少覆盖其固定目标、真实机制、可能影响范围、明确排除项、恢复边界与排障证据。以下目录是首版的完整范围。

| 场景码 | 场景 | 固定目标或实际业务路径 | 主要影响范围 |
| --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | 商品浏览慢 SQL | `catalog-service` 商品浏览报表，`GET /api/reports/product-browse` | Catalog 报表、MySQL 历史行为数据查询、连接池与报表调用时延；不修改业务数据。 |
| `ORDER_REPORT_SQL` | 订单查询慢 SQL | `order-service` 订单报表，`GET /api/reports/order-query` | 选定客户的订单报表、Order DB 和明细读取；可能出现历史扫描和 N+1 读取。 |
| `BROWSE_SURGE` | 商品浏览流量突增 | 控制面 worker 经 Gateway 调用 `GET /api/products` | Gateway、Catalog、商品转换中的库存查询及后端存储资源。 |
| `ORDER_QUERY_SURGE` | 订单查询流量突增 | 控制面 worker 经 Gateway 调用 `GET /api/orders` | Gateway、Order 服务、Order DB 和受控演示客户的查询路径。 |
| `CATALOG_REDIS_LARGE_VALUE` | Redis 大值 | `catalog-service` 商品详情，`GET /api/products/{sku}` | 选中商品详情读取、Catalog 堆/网络、共享 Redis；只使用运行级 Hash 和 marker。 |
| `CART_CATALOG_DEPENDENCY` | 加购依赖失败 | `cart-service -> catalog-service` 商品校验，`POST /api/cart/items` | 所有加购商品校验请求在写入 Cart 前失败；Catalog 其他业务 API 仍可用。 |
| `NOTIFICATION_HEAP_PRESSURE` | 通知堆压力 | `notification-service` 正常通知处理路径 | 整个 Notification JVM 和通知处理能力；可能导致健康失败或进程退出。 |
| `NOTIFICATION_STORAGE_APPEND` | 通知存储追加 | `notification-service` 正常通知持久化路径 | 通知持久化、运行级可识别记录和逻辑容量预算；停止后可能需要人工清理。 |
| `PROMOTION_LOCK_CONTENTION` | 优惠券锁竞争 | `promotion-service` 预留一致性路径 | 演练准备的优惠券/预留事务及短时共享数据库锁竞争，可能产生 MySQL deadlock。 |
| `INVENTORY_TABLE_EXCLUSIVE` | 库存表锁 | `inventory-service`，`POST /internal/inventory/availability/report` | 整个 `inventories` 表的读写可能被阻塞。 |
| `INVENTORY_ROW_LOCK` | 库存行锁 | `inventory-service`，`POST /internal/inventory/reservations/summary` | 固定 `SKU-001` 记录及需要该行锁的事务。 |
| `PSP_PROVIDER_OUTCOME` | PSP 拒付/超时 | `payment-service -> psp-simulator`，`POST /api/psp/authorize` | 活动期间按生效比例的 PSP 授权，以及依赖它的支付/订单流程。 |

## 6. 每篇文章的最小内容

每篇中英文文章采用相同的信息顺序，确保操作人员跨场景能快速定位需要的内容：

1. **目的与固定目标**：场景码、业务含义、目标服务、目标操作和可配置参数。
2. **实际实现逻辑**：真实 HTTP、SQL、Redis、JVM、MySQL 锁或 PSP 调用链；不使用“模拟故障”之类模糊描述替代实现事实。
3. **生命周期与恢复**：创建、活动、到期、手动停止、自动恢复或人工清理的行为与限制。
4. **影响范围**：受影响的请求、客户、行、表、服务或依赖，以及明确不受影响的资源。
5. **证据与判断**：`fault_run_events`、业务日志、指标、数据库现象和 Tempo trace 分别能证明什么。
6. **Tempo 排障**：服务、可选 route、建议时间窗口、服务筛选、错误筛选、慢请求筛选和 waterfall 检查点。
7. **恢复验证与已知限制**：释放锁、请求恢复、服务健康、运行级资源清理等验证；同时注明需以实际部署为准的现象。

### 6.1 Mermaid 图表

文章可以使用以下形式表达跨服务调用、锁竞争或恢复顺序：

````markdown
```mermaid
flowchart LR
  ControlPlane[traffic-control-plane] --> Gateway[gateway-service]
  Gateway --> Inventory[inventory-service]
```
````

图表只作为理解辅助。每张图中的关键操作、服务和恢复顺序都必须在相邻正文中用文字说明，不能让图表成为唯一的操作依据。

## 7. Tempo 排障要求

### 7.1 提供的内容

手册不跳转到 Grafana 或 Tempo，而是为操作人员提供以下可复制参数：

- 目标 OTel `resource.service.name`。
- 可选 HTTP route 或业务路径，用于在实际 trace 属性存在时收窄范围。
- 推荐时间范围，默认从当前时间向前查看 1 小时，并覆盖该场运行窗口。
- 服务范围查询，例如：

```traceql
{ resource.service.name = "catalog-service" }
```

- 错误查询，例如：

```traceql
{ resource.service.name = "catalog-service" && status = error }
```

- 时延查询，例如：

```traceql
{ resource.service.name = "catalog-service" && duration > 2s }
```

### 7.2 证据边界

- 控制面保存的 `fault_run_events` 是运行生命周期证据，不是 Tempo span event。
- Java 服务的 trace、HTTP/JDBC/Redis span 与 exception event 由 OTel Java agent 自动产生；具体 span name 和属性代际需以实际 Tempo 数据为准。
- `fault_runs.trace_id` 与 `X-Trace-Id` 是业务关联 ID。代码未证明它们会被装入 OTel `SpanContext`，不得以它们生成 Tempo trace 深链或承诺精确查询。
- 必须用该业务关联 ID 追踪特定运行时，可在 Loki 中查询业务日志，并结合演练的时间窗口和目标服务检查 Tempo。
- 业务服务异常会原样抛出，由 Gateway 统一转换为对应的 HTTP 5xx 和 `ApiResponse` envelope；排障仍应结合 HTTP 状态、exception event 和服务日志。
- 堆压力导致进程退出时，末尾请求可能没有导出的 span；服务健康、容器重启和缺失 trace 同样是排障证据。

## 8. 内容准确性要求

手册必须优先采用当前代码和场景 catalog 的实际行为；设计文档仅作为辅助来源。尤其需要避免以下不准确承诺：

- 通知存储追加目前是逻辑字节预留加普通通知记录，不能描述为已验证的物理磁盘写满。
- 慢 SQL 的实际时延、扫描行数和优化收益取决于数据预热规模、索引、执行计划与部署环境。
- 表锁/行锁的具体超时时间取决于数据库和驱动配置，不能写成固定响应时间。
- OOM、容器退出、告警触发与恢复耗时取决于 JVM 限制、编排和健康检查，不能保证一定发生或在固定时间发生。
- 控制面 worker 本身没有已配置的 OTel exporter，不能把 `traffic-control-plane` 作为可查询的 Tempo `service.name`；流量场景应从 Gateway 和下游 Java 服务开始检索。

## 9. 验收标准

1. 登录后的导航存在手册入口；未认证访问 `/runbooks` 沿用现有登录跳转行为。
2. `/runbooks` 可显示全部 12 个 catalog 场景，`?scenario=` 可选择每个已知场景，未知值不会导致页面崩溃或文件路径读取。
3. 每个场景都有非空 English 和简体中文文章，文章覆盖实现逻辑、影响范围、恢复、证据和 Tempo 参数。
4. 切换 English/简体中文后，当前场景 query、页面语言和文章内容同步变化，稳定机器值保持原样。
5. Markdown 可正确渲染标题、列表、表格、普通代码块和 Mermaid 图表。
6. Mermaid 渲染失败时，只显示该图的源码回退；文章其余内容、Tempo 参数和目录仍可使用。
7. 普通 SQL、TraceQL、JSON 和 shell 代码块不会被 Mermaid 组件接管；Tempo 查询可从页面复制。
8. 手册不包含 Grafana Explore 外链、Tempo trace 深链、外部重定向、任意 URL 输入或基于 `traceId` 的查询承诺。
9. 桌面和窄屏下，目录、中文长文本、表格、代码块和 Mermaid SVG 不发生不可用的遮挡或溢出。
10. 文档内容随 `traffic-control-plane` production image 一起发布，不依赖仓库根目录 `_docs` 在运行时可访问。

## 10. 发布边界

首版只要求控制台前端和其 Docker image 发布。没有数据库迁移、业务服务发布、Gateway API 版本变更或观测基础设施变更。部署方继续使用已有的 Grafana/Tempo 界面，并根据手册展示的参数手动检索。