# 场景操作手册实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | Phase F 已完成 |
| 版本 | 1.0 |
| 更新时间 | 2026-09-04 CST |
| 产品规格 | [product.md](product.md) |
| 技术设计 | [tech.md](tech.md) |

## 任务规则

1. 开始任务时将 `- [ ]` 改为 `- [-]`；完成实现和该任务定义的验证后改为 `- [x]`。
2. 每完成、阻塞或重新开始一项任务，立即更新本文件的文档信息、总体进度、所在阶段进度和“阶段更新记录”。
3. 发现问题时，在“问题跟踪”新增唯一 `RB-xxx` 记录，填写影响、状态、可能解决方案和关联任务；问题解决后保留历史并更新状态，不删除记录。
4. 遇到影响路由、认证、语言策略、内容安全、Tempo 证据边界、Mermaid 安全配置或部署范围的变更，先同步更新 [product.md](product.md) 和 [tech.md](tech.md)，再继续相关任务。
5. 任务未完成、测试未通过或浏览器验证未完成时不得标记为 `[x]`；被阻塞的任务使用 `[!]` 并关联问题 ID。
6. 不修改 `gateway-service`、业务服务、OTel agent、Grafana/Tempo、告警、Kubernetes 或 `docker-compose.yml`。手册只在 `traffic-control-plane` 内实现。
7. 手册不生成 Grafana Explore 链接、Tempo trace 深链、外部重定向，也不把 `X-Trace-Id` 或 `fault_runs.trace_id` 当作 OTel trace ID。
8. 长篇文章只来自控制台源码目录的受控 Markdown；不得放在 `public/`，不得读取仓库根目录 `docs` 作为 production runtime 内容。
9. 本清单按任务组统计总体进度。子任务全部完成且任务组验证通过，才算一个完成任务组。

## 总体进度

- **总体状态：** Phase F 已完成
- **总体进度：** 29 / 29 个任务组（98 / 98 个子任务）
- **当前阶段：** 全部阶段完成
- **当前问题：** RB-001 至 RB-015 已解决
- **可能的解决方案：** F1-F5 已完成；保留构建环境 warning 的历史记录，后续可独立处理，不影响当前功能验收

| 阶段 | 目标 | 状态 | 进度 | 前置依赖 |
| --- | --- | --- | --- | --- |
| A | Runbook 领域模型与受控内容加载 | 已完成 | 5 / 5 | 无 |
| B | 双语 Markdown 内容与证据准确性 | 已完成 | 6 / 6 | A |
| C | `/runbooks` 页面、目录与 Tempo 参数面板 | 已完成 | 5 / 5 | A、B |
| D | Mermaid 与 Markdown 展示体验 | 已完成 | 4 / 4 | B、C |
| E | 国际化、导航与 production 镜像打包 | 已完成 | 4 / 4 | C、D |
| F | 自动化、构建与浏览器验收 | 已完成 | 5 / 5 | A 至 E |

## 执行依赖

```mermaid
graph TD
    A[Phase A: 领域模型与内容加载] --> B[Phase B: 双语 Markdown 内容]
    A --> C[Phase C: Runbook 页面与 Tempo 参数]
    B --> C
    B --> D[Phase D: Mermaid 与 Markdown 展示]
    C --> D
    C --> E[Phase E: i18n、导航与镜像]
    D --> E
    A --> F[Phase F: 自动化与验收]
    B --> F
    C --> F
    D --> F
    E --> F
```

---

## Phase A：Runbook 领域模型与受控内容加载

**阶段目标：** 以 `fault-run-catalog.ts` 为稳定事实来源，建立受限场景解析、Tempo 查询配方和 production-safe Markdown loader。

**阶段状态：** 已完成  
**阶段进度：** 5 / 5 个任务组（19 / 19 个子任务）  
**问题：** RB-001 已解决：初始统计将完成标准复选框计入阶段子任务  
**可能的解决方案：** 已完成 catalog 对齐、Tempo 查询配方、allowlist loader 和 Node runtime 测试；进入 Phase B 内容编写

### RB-A1. Runbook metadata 类型与目录对齐

- [x] 新增 `traffic-control-plane/src/lib/runbook.ts`，定义 `ScenarioRunbookMetadata`、`TempoQueryRecipe` 和合并后的页面 entry 类型。
- [x] 使用 `FaultRunScenario` 作为 metadata 主键，涵盖当前 catalog 的全部 12 个场景。
- [x] metadata 仅保存文章文件名、业务链路、影响范围、明确排除项、Tempo 服务/route/时延阈值和 waterfall 检查点。
- [x] 不在 metadata 中复制 `targetService`、`targetOperation`、参数、时长、恢复策略和人工清理权限等 catalog 已拥有的可变事实。

**完成判据：** metadata 类型能表达产品规格中的全部手册专属资料，且不引入任意 URL、运行 ID 或用户输入字段。

### RB-A2. Catalog 合并与场景解析

- [x] 实现 `listRunbookEntries()`，遍历 `listScenarioDefinitions()` 生成稳定顺序的完整目录。
- [x] 实现 `getRunbookEntry()`，从 `getScenarioDefinition()` 合并固定目标、参数、时长和恢复策略。
- [x] 实现 `resolveRunbookScenario(input)`，仅接受已知 scenario；空值、未知值和数组值安全回退到确定默认场景。
- [x] 确保 scenario query 原文不进入文件路径、TraceQL、HTML、React key 或错误模板。

**完成判据：** 纯函数可由 Node 测试覆盖已知场景和非法输入，目录与 catalog 一对一对应。

### RB-A3. 静态 Tempo 查询配方

- [x] 为每个场景定义 allowlisted OTel service name、可选 route/业务路径、默认 `now-1h to now` 时间范围和慢请求阈值。
- [x] 为每个目标服务派生服务范围、`status = error` 和 duration TraceQL 文本；多服务场景分别提供每个服务的查询，不依赖未验证的跨服务语法。
- [x] 定义各场景 waterfall 检查点，只允许 `HTTP`、`JDBC`、`REDIS`、`EXCEPTION`、`HEALTH` 等固定值。
- [x] 明确 route 条件是需在实际 Tempo 属性中确认的可选收窄条件，基础查询以 `resource.service.name` 为起点。

**完成判据：** 所有 12 个场景都有完整、静态、无外部 URL 的 Tempo recipe。

### RB-A4. 受控 Markdown loader

- [x] 新增 `traffic-control-plane/src/lib/runbook-content.ts`，只接受 `en` / `zh-CN` 和经 `resolveRunbookScenario()` 验证的 scenario。
- [x] 只以 metadata allowlist `articleFile` 形成路径，使用 `node:fs/promises` 读取 UTF-8 内容。
- [x] 对缺失、空白或不可读内容提供明确的受控错误结果，页面可显示本地化不可用状态。
- [x] 不从 `public/`、仓库根目录 `docs`、请求参数或外部地址读取文章。

**完成判据：** loader 的路径不会被 query 注入，且失败模式可被测试精确验证。

### RB-A5. Node runtime 和任务测试骨架

- [x] 在 `src/app/runbooks/page.tsx` 预声明 `export const runtime = 'nodejs'`，保证后续文件系统读取不落到 Edge runtime。
- [x] 新增 `traffic-control-plane/src/lib/runbook.test.ts` 和 `package.json` 的 `test:runbook` 脚本骨架。
- [x] 覆盖 catalog/metadata 一对一、解析安全回退、固定 Tempo 配方字段和禁止 URL/trace ID 输入的纯函数测试。

**完成判据：** `pnpm test:runbook` 可执行并覆盖 Phase A 的纯函数契约。

---

## Phase B：双语 Markdown 内容与证据准确性

**阶段目标：** 为 12 个场景编写成对、可审计的 English / 简体中文文章，确保描述以当前代码为准并清楚界定运行证据。

**阶段状态：** 已完成
**阶段进度：** 6 / 6 个任务组（23 / 23 个子任务）
**问题：** RB-002、RB-003 已解决；无新增问题
**可能的解决方案：** 24 篇文章已完成，内容完整性、双语配对、Mermaid 围栏和当前实现事实均已复核；进入 Phase C 页面实现

### RB-B1. 内容目录与统一文章模板

- [x] 创建 `src/content/runbook/en/` 和 `src/content/runbook/zh-CN/`。
- [x] 建立与 metadata 完全一致的文件名 allowlist；两种语言保持相同文件名集合。
- [x] 在每篇文章使用统一顺序：目的与固定目标、实现逻辑、参数与生命周期、影响范围、证据、Tempo 排障、恢复验证、已知限制。
- [x] 仅翻译解释性文字；场景码、服务、操作、接口、参数、表名、错误码、事件名、SQL 和 TraceQL 保持原值。

**完成判据：** 内容目录结构可由 loader 读取，文章模板覆盖产品规格第 6 节的全部信息。

### RB-B2. 慢 SQL 与流量场景文章

- [x] 编写 `BROWSE_REPORT_SQL` 英文/中文文章，说明历史行为扫描、商品浏览报表、JDBC 观察和优化/验证边界。
- [x] 编写 `ORDER_REPORT_SQL` 英文/中文文章，说明客户历史订单范围、N+1 明细读取和执行计划证据。
- [x] 编写 `BROWSE_SURGE` 英文/中文文章，说明控制面 worker 经 Gateway 的商品浏览请求、下游影响和 Tempo 起点。
- [x] 编写 `ORDER_QUERY_SURGE` 英文/中文文章，说明受控客户订单查询、并发/间隔参数和影响范围。

**完成判据：** 四个场景均写明真实调用链、影响范围、恢复边界和匹配其 metadata 的 Tempo 参数。

### RB-B3. 缓存与依赖场景文章

- [x] 编写 `CATALOG_REDIS_LARGE_VALUE` 英文/中文文章，说明运行级 Hash、marker、商品详情回源、停止顺序和默认缓存隔离。
- [x] 编写 `CART_CATALOG_DEPENDENCY` 英文/中文文章，说明 Cart 到 Catalog 的校验调用、写入前失败和 `CATALOG_UNAVAILABLE` 证据边界。
- [x] 在两篇文章中清楚区分 HTTP、Redis span、应用 envelope 和控制面运行事件。

**完成判据：** 缓存/依赖影响不会被描述为任意 Redis key 控制或全量 Catalog 服务故障。

### RB-B4. Notification 与 PSP 场景文章

- [x] 编写 `NOTIFICATION_HEAP_PRESSURE` 英文/中文文章，说明高基数对象保留、非释放型恢复、健康失败和可能缺失的末尾 trace。
- [x] 编写 `NOTIFICATION_STORAGE_APPEND` 英文/中文文章，说明普通通知记录、逻辑字节预留、运行级清理和不承诺物理磁盘写满的边界。
- [x] 编写 `PSP_PROVIDER_OUTCOME` 英文/中文文章，说明授权、拒付、60 秒 PSP 返回与 Payment 30 秒客户端超时的实际链路。
- [x] 明确 PSP 的 `effectPercentage` 影响活动期间授权，而不是所有支付请求必然失败。

**完成判据：** 三个场景分别说明服务不可用、人工清理和 PSP 超时的不同恢复语义。

### RB-B5. 锁竞争场景文章

- [x] 编写 `PROMOTION_LOCK_CONTENTION` 英文/中文文章，说明反向锁顺序、准备预留、MySQL deadlock 和 JDBC exception 证据。
- [x] 编写 `INVENTORY_TABLE_EXCLUSIVE` 英文/中文文章，说明专用连接 `LOCK TABLES inventories WRITE`、全表影响和释放后恢复验证。
- [x] 编写 `INVENTORY_ROW_LOCK` 英文/中文文章，说明固定 `SKU-001` 的 `SELECT ... FOR UPDATE`、行级影响和锁等待。
- [x] 不承诺固定锁等待、超时或 deadlock 重现时间；这些依赖数据库/驱动与运行时条件。

**完成判据：** 三种锁的锁粒度、观察接口、影响范围和恢复顺序清晰且互不混淆。

### RB-B6. 双语内容与证据边界复核

- [x] 验证 12 个 English/中文 article 均非空、成对存在且使用 allowlist 文件名。
- [x] 验证每篇文章明确区分 `fault_run_events`、业务日志、指标、数据库现象与 Tempo trace。
- [x] 验证文章不承诺用 `fault_runs.trace_id` / `X-Trace-Id` 查询 OTel trace；需要精确关联时仅说明 Loki 业务日志关联和时间窗口结合。
- [x] 逐篇对照当前 catalog 与实现，移除任何过期的 Cart 大 key、随机支付结果、任意服务 fan-out 或旧 Chaos 协议描述。

**完成判据：** 内容测试通过，且人工审阅确认没有将设计意图或不确定运行时现象写成代码已保证的事实。

---

## Phase C：`/runbooks` 页面、目录与 Tempo 参数面板

**阶段目标：** 在既有认证和控制台壳层中提供只读手册工作区、场景目录、文章和可复制的静态 Tempo 参数。

**阶段状态：** 已完成
**阶段进度：** 5 / 5 个任务组（16 / 16 个子任务）
**问题：** RB-004 已解决；RB-001、RB-002、RB-003 已解决
**可能的解决方案：** server-first 页面、目录、普通 Markdown、Tempo 参数面板和复制交互已完成；进入 Phase D Mermaid 实现

### RB-C1. Server page 与数据装配

- [x] 新增 `traffic-control-plane/src/app/runbooks/page.tsx`，读取 `getLocale()` 与 `searchParams.scenario`。
- [x] 使用 Phase A 的 parser、entry 和 loader 装配页面数据；不读取运行记录、Grafana URL 或外部服务配置。
- [x] 对受控内容读取失败显示可本地化的页面错误状态，不暴露内部文件路径或原始错误细节。

**完成判据：** `/runbooks` 可作为 Server Component 渲染默认场景和已知 query 场景。

### RB-C2. 场景目录与选择行为

- [x] 新增 `components/runbook/RunbookWorkspace.tsx`，复用 `SCENARIO_GROUPS` 和场景 translation key 组织目录。
- [x] 目录项使用 `/runbooks?scenario=<SCENARIO_ID>` 内部链接，当前项具有 `aria-current="page"`。
- [x] 目录和文章标题显示稳定场景码，并从 catalog 显示固定服务和操作；未知 query 安全回退。

**完成判据：** 12 个场景可导航，语言切换后 query 仍被保留，且 NavBar `/runbooks` 状态无需改造动态路由判断。

### RB-C3. Article renderer 与普通代码块

- [x] 新增 `RunbookArticle.tsx`，使用 `react-markdown` 与 `remark-gfm` 渲染受控 Markdown。
- [x] 支持标题、列表、表格、引用、inline code 和 fenced code block；不安装或启用 `rehype-raw`。
- [x] 为非 Mermaid 的 SQL、TraceQL、JSON、shell 等代码块保留标准文本渲染、可选择性和横向滚动。

**完成判据：** 受控文章不执行原始 HTML，普通代码不会被 Mermaid renderer 误处理。

### RB-C4. Tempo 参数面板

- [x] 显示 allowlisted OTel 服务、route/业务路径、建议时间范围、服务/错误/慢请求查询和 waterfall 检查点。
- [x] 多服务场景按服务分别列出查询，避免不明确的合并语法。
- [x] 明示服务查询是起点，route 属性需按实际 trace 确认；业务 envelope error、慢请求和进程退出需结合其他证据判断。
- [x] 不添加 Grafana/Tempo 链接、URL 输入、重定向、trace ID 输入或运行 ID 查询功能。

**完成判据：** 面板内容完全来自 typed metadata，无用户可编辑/可注入的查询字段。

### RB-C5. 剪贴板交互与错误回退

- [x] 新增 `CopyTextButton.tsx`，优先使用 `navigator.clipboard.writeText` 复制 metadata 派生的文本。
- [x] 使用受限浏览器回退处理 clipboard API 不可用的情况，不复制 HTML 或任意用户输入。
- [x] 使用 lucide `Copy` / `Check` 图标、本地化 `aria-label`、`title` 和短暂成功/失败反馈。

**完成判据：** 每个 Tempo 参数可复制，权限拒绝或旧浏览器不导致页面崩溃。

---

## Phase D：Mermaid 与 Markdown 展示体验

**阶段目标：** 安全地渲染受控文章中的 Mermaid 图表，并确保普通 Markdown、代码、图表和长中文内容在不同视口/主题下可用。

**阶段状态：** 已完成
**阶段进度：** 4 / 4 个任务组（12 / 12 个子任务）
**问题：** RB-005、RB-006、RB-007 已解决；RB-001、RB-002、RB-003、RB-004 已解决
**可能的解决方案：** 已完成 Mermaid 客户端渲染、严格安全配置、主题重绘、代码分类、源码回退、复制反馈和桌面/窄屏浏览器走查；进入 Phase E

### RB-D1. Mermaid client renderer

- [x] 新增 `'use client'` 的 `MermaidDiagram.tsx`，不在模块顶层导入 Mermaid。
- [x] 在 effect 中 dynamic import `mermaid`，只接收受控 Markdown loader 提供的源码与本地化 label。
- [x] 在 source 或 resolved theme 变化时生成稳定唯一 diagram ID、取消过期异步结果并重新绘制。

**完成判据：** Server render 不触碰 Mermaid DOM API，切换文章或主题时旧渲染不会覆盖新图。

### RB-D2. Mermaid 安全与失败回退

- [x] 用 `startOnLoad: false`、`securityLevel: 'strict'`、`htmlLabels: false` 初始化 Mermaid。
- [x] 不支持 click/callback、HTML label 或以 Mermaid 承载操作、导航和脚本执行。
- [x] 加载中显示本地化状态和源码；dynamic import 或语法错误时显示本地化错误及源码，且只影响当前图。

**完成判据：** 图表失败不会中断文章、目录、Tempo 面板或复制功能。

### RB-D3. Markdown code renderer 集成

- [x] 在 `RunbookArticle` 中仅识别 fenced block 的 `language-mermaid` class 并传给 `MermaidDiagram`。
- [x] 保证未标语言、`sql`、`traceql`、`json`、`bash` 等 fenced block 继续作为普通代码块。
- [x] 为每种语言文章至少加入一个流程图或时序图，表达调用链、资源竞争或恢复顺序，并用相邻正文表达等价操作信息。

**完成判据：** Mermaid fenced block 分类有测试，图表不是唯一的操作信息来源。

### RB-D4. Scoped styles 与响应式走查

- [x] 在 `src/app/globals.css` 增加限定于 runbook 的标题、表格、代码、诊断面板和 Mermaid 样式，沿用现有 token。
- [x] 表格、长 TraceQL、SQL 和 SVG 图表支持安全横向滚动，图表 wrapper 有稳定最小高度和最大宽度。
- [x] 为 `<figure>`、`figcaption`、图表本地化 label 和 focus-visible 状态补齐语义与可访问性。

**完成判据：** 桌面和窄屏下英文/中文、浅色/深色主题均无不可用的重叠、截断或布局跳动。

---

## Phase E：国际化、导航与 production 镜像打包

**阶段目标：** 使新页面融入既有控制台语言和导航体系，并确保 standalone production image 包含受保护内容文件。

**阶段状态：** 已完成
**阶段进度：** 4 / 4 个任务组（12 / 12 个子任务）
**问题：** RB-008、RB-009 已解决；RB-001 至 RB-007 已解决
**可能的解决方案：** Runbook message、导航、依赖、lockfile 和 standalone Markdown 打包均已验证；进入 Phase F

### RB-E1. Runbook UI messages

- [x] 在 `src/i18n/messages/en/Runbook.json` 与 `zh-CN/Runbook.json` 添加相同 key 集合。
- [x] 覆盖页面标题、目录、固定目标、Tempo 字段、复制状态、内容不可用、Mermaid 加载/失败和图表无障碍标签。
- [x] 将两个 JSON 文件加入各自 messages `index.ts`；不将 24 篇 Markdown 长文加入 `NextIntlClientProvider` payload。

**完成判据：** 两种语言的短 UI 文案完整，message key 和 ICU placeholder 可由现有 parity 测试验证。

### RB-E2. 导航和共享壳层集成

- [x] 在 `Navigation.json` 的 English/中文目录增加 `runbook` 翻译。
- [x] 修改 `src/components/NavBar.tsx` 增加 `/runbooks` 项，维持现有无语言前缀链接、登出和 strict pathname active 行为。
- [x] 验证现有 `LocaleSwitcher` 切换后保留 `/runbooks?scenario=...`，不修改认证/CSRF Cookie 或业务请求。

**完成判据：** 登录后可从主导航到达手册，切换语言不丢失当前文章。

### RB-E3. 依赖与锁文件

- [x] 在 `traffic-control-plane/package.json` 添加经过当前 Next.js/React 版本验证的 `react-markdown`、`remark-gfm` 和 `mermaid`。
- [x] 使用项目规定 pnpm 更新 `pnpm-lock.yaml`，检查 peer dependency 和 lockfile 变化只包含预期依赖树。
- [x] 不引入 MDX loader、Docusaurus、Contentlayer、`rehype-raw` 或通用 HTML 注入插件。

**完成判据：** TypeScript、lint 和 production build 能解析三项依赖，无意外 peer warning 或运行时缺包。

### RB-E4. Standalone Docker 内容打包

- [x] 修改 `traffic-control-plane/Dockerfile`，从 builder 显式复制 `/app/src/content/runbook` 到 runner 的同一路径。
- [x] 保持文章不进入 `public/`，以避免受 middleware 保护的内容被静态绕过。
- [x] 执行 `docker compose build traffic-control-plane`，在 image 中确认 `/app/src/content/runbook` 和英文/中文文章存在。

**完成判据：** standalone runtime 可从容器内读取文章，不依赖宿主仓库 `docs`。

---

## Phase F：自动化、构建与浏览器验收

**阶段目标：** 验证场景覆盖、内容边界、语言契约、Mermaid 回退、生产构建与受保护页面行为。

**阶段状态：** 已完成
**阶段进度：** 5 / 5 个任务组（16 / 16 个子任务）
**问题：** RB-010、RB-012、RB-013、RB-014、RB-015 已解决；RB-001 至 RB-009、RB-011 已解决
**可能的解决方案：** F1-F5 已完成；12 场景全量浏览器、双语 query 保留、主题重绘、复制反馈、Mermaid 回退、390px 响应式和 HttpOnly 会话鉴权跳转均通过

### RB-F1. Runbook 纯函数与内容完整性测试

- [x] 运行并完善 `pnpm test:runbook`，验证 metadata/catalog 一对一完整覆盖、固定目标来自 catalog、article file 唯一安全。
- [x] 验证 12 个场景的 English/中文文章均存在、非空、成对，并具有统一必要章节。
- [x] 验证空/未知/数组 scenario 回退，且模型/API 不接收 trace ID、Grafana URL、外部 URL 或任意 TraceQL 输入。

**完成判据：** 新测试稳定通过，并能在删除文章、遗漏场景或放宽输入时失败。

### RB-F2. Tempo 与 Mermaid 契约测试

- [x] 验证每个 Tempo recipe 的服务、业务路径、时间范围、错误筛选和慢请求筛选均来自 metadata allowlist。
- [x] 验证 `language-mermaid` 被识别为图表候选，其他代码语言不会进入 Mermaid 组件。
- [x] 验证中英文文章至少各有一个闭合的 Mermaid fenced block，普通 SQL/TraceQL 围栏未被误分类。

**完成判据：** Node 测试覆盖静态查询和 Markdown 分类边界；不在无 DOM 的 Node 测试中伪造 Mermaid SVG 行为。

### RB-F3. i18n、类型与 lint 回归

- [x] 扩展 `messages.test.ts` required keys，覆盖 `Navigation.runbook` 与 `Runbook` 的关键 UI/无障碍文案。
- [x] 执行 `pnpm test:i18n`、`pnpm typecheck` 和 `pnpm lint`，修复本功能引入的问题。
- [x] 区分已有 warning 与本功能新增 warning，在问题跟踪中记录不可在本范围内解决的项。

**完成判据：** 所有本功能引入的语言、类型、lint 问题均关闭或有明确非阻塞问题记录。

### RB-F4. Production build 与容器验证

- [x] 执行 `pnpm build`，确认 Server Component、Node runtime loader、dynamic Mermaid chunk 和 standalone output 正常。
- [x] 执行 `docker compose build traffic-control-plane`，确认 image 打包 Markdown 并可启动。
- [x] 检查 build 输出和客户端 bundle，不包含文章中的秘密、运行时环境变量或不受控文件系统路径。

**完成判据：** 控制台 production build 和 Docker build 均通过，运行时内容边界没有回归。

### RB-F5. 浏览器、响应式与鉴权验收

- [x] 登录后访问 `/runbooks` 和全部 12 个 query 场景，验证目录、固定目标、文章、Tempo 参数和复制按钮。
- [x] 在 EN/中文、浅色/深色主题间切换，确认 query、`<html lang>`、UI 文案、文章及 Mermaid SVG 同步更新。
- [x] 在桌面和窄屏验证目录、长中文文本、表格、代码、Mermaid 图、键盘焦点和复制反馈。
- [x] 使用无效 Mermaid 样例确认局部源码回退；使用未登录会话确认 `/runbooks` 仍遵循既有 `returnTo` 登录跳转。

**完成判据：** 产品规格第 9 节全部验收项通过，发现的问题已在问题跟踪和阶段更新记录中反映。

---

## 问题跟踪

问题发现后按以下字段追加记录；状态使用 `待处理`、`处理中`、`已解决` 或 `已阻塞`。不可删除已解决记录，以保留决策和验证历史。

| ID | 发现阶段/任务 | 问题 | 影响 | 可能的解决方案/下一步 | 状态 |
| --- | --- | --- | --- | --- | --- |
| RB-001 | 建立清单后统计复核 | 初始总数把“完成标准”复选框计入阶段子任务，导致 103 与任务组内实际 98 不一致。 | 可能造成后续进度汇报失真。 | 按 Phase A-F 任务组内复选项重新统计，修正为 98 个子任务；完成标准继续单独验收。 | 已解决 |
| RB-002 | Phase B 前置核验 / RB-B2、RB-B5 | Inventory 两个观测接口实际使用 `POST`，而产品/技术设计和 Phase A metadata 曾写为 `GET`。 | 若不修正，文章和 Tempo route 说明会给出错误调用方法。 | 已按 `InventoryAvailabilityController`、`InventoryReservationController` 和 Gateway dispatch 修正为 `POST`；文章统一使用修正后的方法。 | 已解决 |
| RB-003 | Phase B / 首批文章验证 | Phase A 的缺失文章测试使用了 `BROWSE_REPORT_SQL` 作为缺失 fixture；Phase B 创建该文章后，测试断言失效。 | `pnpm test:runbook` 在内容已正确存在时错误失败，阻断后续文章验证。 | 将断言改为验证 allowlisted Markdown 成功读取和不泄露服务器路径；非法 locale 测试继续覆盖 loader 错误分支。 | 已解决 |
| RB-004 | Phase C / RB-C5 | 复制按钮初版通过点击后的 `activeElement` 反查查询容器，焦点已经落在按钮上时无法取得查询文本，复制必然失败。 | Tempo 查询参数无法复制，影响排障操作。 | 将查询文本作为 `CopyTextButton` 的显式 `value` prop 传入，保留 Clipboard API 和受限 fallback；lint 与 focused test 通过。 | 已解决 |
| RB-005 | Phase D / RB-D1、RB-D3 | `react-markdown` fenced code 同时生成 `code.language-*` 和外层 `pre`；初版仅替换 code 会保留不合适的 pre，且多 class 场景的 Mermaid 分类测试与实现边界不一致。 | Mermaid 图可能无法以稳定图表容器显示，普通代码语言边界存在误判风险。 | 通过 renderer 探针确认 props；同步自定义 `code`/`pre`，仅按 `language-mermaid` token 解包 Mermaid，普通代码剥离 AST `node` 属性；使用输入快照避免主题/文章切换时旧异步结果覆盖。 | 已解决 |
| RB-006 | Phase D / RB-D4 | Mermaid SVG、主题重绘、语法错误回退和桌面/窄屏布局尚未完成真实浏览器走查；静态检查不能证明 hydration、DOM/SVG 和实际视口布局可用。 | 在未完成视觉和交互验证前关闭 D4 可能掩盖图表空白、主题不同步、回退失效或窄屏溢出。 | 已用真实浏览器验证：SVG 非空、light/dark 重绘、无效语法局部源码回退、`figure`/`figcaption` 语义、390px 页面无横向溢出；结果已恢复并记录。 | 已解决 |
| RB-007 | Phase D / RB-D4 复制反馈 | 本地浏览器的 Clipboard API 可能因权限策略拒绝或迟迟不 resolve，直接等待会使复制按钮没有确定的可见结果。 | 操作人员无法判断查询是否已复制，浏览器走查也可能被权限 Promise 阻塞。 | 为 `navigator.clipboard.writeText` 增加 1 秒上限；立即拒绝时使用同步 fallback，超时时显示本地化 `复制失败`；已验证 stub 成功显示 `已复制`、真实权限路径有界显示失败。 | 已解决 |
| RB-008 | Phase E / RB-E1 至 RB-E4 | `/runbooks` 已使用 Runbook namespace 和依赖，但主导航、显式 required-key 断言和 Dockerfile 内容复制在 Phase E 开始时尚未完成。 | 页面可能无法从控制台导航到达，消息回归不易发现，standalone runtime 可能无法读取 Markdown。 | 增加双语 `Navigation.runbook`、NavBar 项、message required-key 断言、依赖/lockfile 确认和 Dockerfile 内容复制；i18n、typecheck、lint、build、Docker image 文件检查均通过。 | 已解决 |
| RB-009 | Phase E / RB-E4 | 在 Apple Silicon 主机上构建并运行默认 `linux/amd64` control-plane image 时出现平台不匹配 warning。 | 当前 image 构建和内容检查成功；跨平台运行可能有额外仿真开销。 | 镜像检查使用显式 `--platform linux/amd64` 完成；生产部署按目标节点架构构建/拉取对应 image，当前不扩大功能范围。 | 已解决 |
| RB-010 | Phase F / RB-F1 至 RB-F5 | 最终验证尚未在当前工作区重新执行，且 12 个场景的双语/主题/响应式/鉴权浏览器走查尚未形成完整证据。 | 在关闭 Phase F 前可能遗漏依赖锁定、production bundle、场景 query、语言切换或鉴权回归问题。 | F1-F5 已全部通过：`test:runbook`、`test:i18n`、`test:runner`、typecheck、lint、build、Docker image 检查和全场景浏览器走查均完成。 | 已解决 |
| RB-011 | Phase F / 清单格式检查 | Phase F 状态和问题行带有 Markdown 行尾空格，导致 `git diff --check` 失败。 | 不影响运行时功能，但会阻断清单格式验收。 | 删除行尾空格，并重新运行 `git diff --check`；没有扩大功能范围。 | 已解决 |
| RB-012 | Phase F / RB-F5 | 390px 浏览器测量显示全局 `<main>` 的内部 scrollWidth 被文章中的长路径/行内代码撑宽，虽然 body/header 没有溢出。 | 窄屏主滚动区域可能出现隐藏的横向滚动或内容被裁切。 | 为 `.runbook-article` 和 `.runbook-code-inline` 增加 `overflow-wrap:anywhere` / `word-break:break-word`，保留 `pre` 与 Mermaid viewport 的局部横向滚动；修复后 body/header/main/article 均无溢出，图表仅自身滚动。 | 已解决 |
| RB-013 | Phase F / RB-F5 | `operator_session` 为 HttpOnly，页面 JavaScript 无法直接清除它，初次未登录验收脚本仍处于已认证状态。 | 可能误判 middleware 未登录跳转行为。 | 使用隔离浏览器的 CDP `Network.clearBrowserCookies` 清除会话后重新验证；访问 `/runbooks?scenario=PSP_PROVIDER_OUTCOME` 正确跳转并保留 `returnTo`。 | 已解决 |
| RB-014 | Phase F / RB-F5 | `NOTIFICATION_HEAP_PRESSURE` 文章的 Mermaid 节点标签包含嵌套 `[]`，Mermaid 解析失败并只显示源码回退。 | 一个场景的实现图无法渲染，暴露了只有浏览器全场景回归才能发现的内容语法问题。 | 将节点标签改为不含 Mermaid 保留括号的等价文本，并同步修复 English 和 `zh-CN` 文章；两种语言均验证为非空 SVG。 | 已解决 |
| RB-015 | Phase F / RB-F5 | 新增第五个主导航项后，390px 下 `NavBar` 内容宽于 header 可用区域，导致 header 内部存在隐藏横向溢出。 | 窄屏导航项可能被裁切，操作人员无法可靠访问全部控制台页面。 | 让 `.console-nav` 独立承接横向滚动，并让导航链接保持稳定宽度；修复后 header/body 无横向溢出，导航自身可滚动访问全部 5 项。 | 已解决 |

## 阶段更新记录

每完成一个任务、发现/解决一个问题或调整范围后追加一行。进度使用“完成任务组 / 全部任务组（完成子任务 / 全部子任务）”格式；问题没有时填“无”。

| 日期 | 阶段/任务 | 总体进度 | 阶段进度 | 问题 | 可能的解决方案/下一步 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-03 | 建立任务清单 | 0 / 29（0 / 98 子任务） | A-F：0 | 无 | 从 RB-A1 开始，先建立 catalog 对齐的 metadata 和受控内容 loader |
| 2026-09-03 | 统计口径修正 | 0 / 29（0 / 98 子任务） | A-F：0 | RB-001 已解决 | 完成标准复选框不计入阶段子任务，继续执行 Phase A |
| 2026-09-03 | 完成 RB-A1 至 RB-A3 | 3 / 29（12 / 98 子任务） | A：3 / 5（12 / 19 子任务） | RB-001 已解决；无新增问题 | 实现 RB-A4 受控 Markdown loader 和 RB-A5 Node runtime/测试骨架 |
| 2026-09-03 | 开始 RB-A4/RB-A5 | 3 / 29（14 / 98 子任务） | A：3 / 5（14 / 19 子任务） | RB-001 已解决；无新增问题 | 新增固定路径 Markdown loader 和 `runtime = 'nodejs'` 页面骨架，随后验证 loader 失败回退 |
| 2026-09-03 | 完成 Phase A / RB-A1 至 RB-A5 | 5 / 29（19 / 98 子任务） | A：5 / 5（19 / 19 子任务） | RB-001 已解决；无新增问题 | `pnpm test:runbook` 9/9 通过；运行 `typecheck` 后开始 Phase B 双语文章内容 |
| 2026-09-03 | 开始 Phase B / RB-B1 至 RB-B6 | 5 / 29（19 / 98 子任务） | B：0 / 6（0 / 23 子任务） | RB-001 已解决；无新增问题 | 编写 24 篇成对 Markdown，使用内容测试核对章节、事实边界和 Mermaid 围栏 |
| 2026-09-03 | Phase B 前置事实复核 | 5 / 29（19 / 98 子任务） | B：0 / 6（0 / 23 子任务） | RB-002 已解决；RB-001 已解决 | Inventory 观测接口已统一为 `POST`，文章按当前 Controller 和 Gateway 实现编写 |
| 2026-09-03 | 修正 RB-003 测试夹具 | 5 / 29（19 / 98 子任务） | B：0 / 6（0 / 23 子任务） | RB-003 已解决；RB-002、RB-001 已解决 | 缺失 fixture 改为稳定的成功读取断言，继续验证首批双语文章 |
| 2026-09-03 | 完成 Phase B / RB-B1 至 RB-B6 | 11 / 29（42 / 98 子任务） | B：6 / 6（23 / 23 子任务） | RB-001、RB-002、RB-003 已解决；无新增问题 | 24 篇文章、精确章节、Mermaid 围栏和 metadata allowlist 测试通过；开始 Phase C 页面实现 |
| 2026-09-04 | 开始 Phase C / RB-C1 至 RB-C5 | 11 / 29（42 / 98 子任务） | C：0 / 5（0 / 16 子任务） | RB-001、RB-002、RB-003 已解决；无新增问题 | 实现 server-first `/runbooks` 页面、目录、Markdown、Tempo 参数面板和复制组件 |
| 2026-09-04 | 完成 Phase C / RB-C1 至 RB-C5 | 16 / 29（58 / 98 子任务） | C：5 / 5（16 / 16 子任务） | RB-001、RB-002、RB-003、RB-004 已解决；无新增问题 | `test:runbook` 11/11、`test:i18n` 15/15、typecheck、lint 通过；开始 Phase D Mermaid 实现 |
| 2026-09-04 | 开始 Phase D / RB-D1 至 RB-D4 | 16 / 29（58 / 98 子任务） | D：0 / 4（0 / 12 子任务） | RB-001、RB-002、RB-003、RB-004 已解决；无新增问题 | 确认 `react-markdown` fenced code 渲染边界后，实现 Mermaid 客户端 SVG、严格安全配置、源码回退和 scoped styles |
| 2026-09-04 | 完成 Phase D / RB-D1 至 RB-D4 | 20 / 29（70 / 98 子任务） | D：4 / 4（12 / 12 子任务） | RB-001、RB-002、RB-003、RB-004、RB-005 已解决；无新增问题 | `test:runbook` 12/12、lint 通过；typecheck/build 作为后续 Phase E/F 继续验证，开始 Phase E |
| 2026-09-04 | 开始 Phase C / RB-C1 至 RB-C5 | 11 / 29（42 / 98 子任务） | C：0 / 5（0 / 16 子任务） | RB-001、RB-002、RB-003 已解决；无新增问题 | 实现 server-first `/runbooks` 页面、目录、Markdown、Tempo 参数面板和复制组件 |
| 2026-09-04 | 修正 Phase D 进度记录 | 19 / 29（67 / 98 子任务） | D：3 / 4（9 / 12 子任务） | RB-006 待处理；RB-001 至 RB-005 已解决 | 静态实现、typecheck、lint 和 build 已通过；D4 保留真实浏览器走查，完成后再进入 Phase E |
| 2026-09-04 | 完成 Phase D / RB-D1 至 RB-D4 | 20 / 29（70 / 98 子任务） | D：4 / 4（12 / 12 子任务） | RB-001 至 RB-007 已解决；无新增问题 | 浏览器验证通过：SVG 非空、主题重绘、无效 Mermaid 局部回退、390px 无页面横向溢出；`test:runbook` 12/12、typecheck、lint、build 通过；进入 Phase E |
| 2026-09-04 | 开始 Phase E / RB-E1 至 RB-E4 | 20 / 29（70 / 98 子任务） | E：0 / 4（0 / 12 子任务） | RB-008 待处理；RB-001 至 RB-007 已解决 | 补齐导航、Runbook message 显式 parity 断言和 Markdown 内容显式复制，随后验证 i18n、typecheck、lint 和 Docker build |
| 2026-09-04 | 完成 Phase E / RB-E1 至 RB-E4 | 24 / 29（82 / 98 子任务） | E：4 / 4（12 / 12 子任务） | RB-001 至 RB-009 已解决；无新增问题 | `test:i18n` 15/15、`test:runbook` 12/12、typecheck、lint、build 和 `docker compose build traffic-control-plane` 通过；image 内 Markdown 为 24 篇（en 12、zh-CN 12）；进入 Phase F |
| 2026-09-04 | 调整导航位置 | 24 / 29（82 / 98 子任务） | E：4 / 4（12 / 12 子任务） | RB-001 至 RB-009 已解决；无新增问题 | 将 `操作手册` 调整到 `场景` 后面，保持路由和 active 判断不变；继续 Phase F 验收 |
| 2026-09-04 | 开始 Phase F / RB-F1 至 RB-F5 | 24 / 29（82 / 98 子任务） | F：0 / 5（0 / 16 子任务） | RB-010 待处理；RB-001 至 RB-009 已解决 | 执行完整测试、production build、Docker 内容检查和 12 个场景的双语/主题/响应式/鉴权浏览器验收 |
| 2026-09-04 | 完成 Phase F 静态验收 / RB-F1 至 RB-F4 | 28 / 29（94 / 98 子任务） | F：4 / 5（12 / 16 子任务） | RB-010 处理中；RB-011 已解决；RB-001 至 RB-009 已解决 | `test:runbook` 12/12、`test:i18n` 15/15、`test:runner` 68/68、typecheck、lint、build 和 Docker image 内容检查通过；开始 F5 浏览器验收 |
| 2026-09-04 | RB-F5 首轮全场景浏览器回归 | 28 / 29（94 / 98 子任务） | F：4 / 5（12 / 16 子任务） | RB-010 处理中；RB-012 处理中；RB-014 待处理；RB-015 待处理；RB-011 已解决 | 12 个场景核心页面通过；发现通知堆压力 Mermaid 语法、390px 主区域长文本溢出和窄屏导航溢出，分别修复并复测 |
| 2026-09-04 | 修复 RB-014 Mermaid 内容 | 28 / 29（94 / 98 子任务） | F：4 / 5（12 / 16 子任务） | RB-014 已解决；RB-010、RB-012、RB-015 处理中；RB-011 已解决 | 修正嵌套 `[]` Mermaid label，English/中文通知堆压力图均恢复为非空 SVG |
| 2026-09-04 | 修复 RB-015 窄屏导航 | 28 / 29（94 / 98 子任务） | F：4 / 5（12 / 16 子任务） | RB-015 已解决；RB-010、RB-012 处理中；RB-014 已解决 | 导航超宽内容改由 `.console-nav` 内部滚动承接，390px header/body 不再溢出 |
| 2026-09-04 | 修复 RB-012 窄屏主区域 | 28 / 29（94 / 98 子任务） | F：4 / 5（12 / 16 子任务） | RB-012 已解决；RB-010、RB-014、RB-015 已解决 | 文章和行内代码增加断行规则，390px body/header/main/article 无溢出，Mermaid 图表仅自身横向滚动 |
| 2026-09-04 | 完成 RB-F5 / Phase F | 29 / 29（98 / 98 子任务） | F：5 / 5（16 / 16 子任务） | RB-001 至 RB-015 已解决；无新增问题 | 12 场景全量浏览器回归、双语 query 保留、主题 SVG 重绘、复制反馈、无效 Mermaid 局部回退、390px 响应式和 HttpOnly 会话鉴权跳转均通过；全部阶段完成 |

## 完成标准

- [x] Phase A-F 全部任务组完成，任务组进度达到 `29 / 29`，子任务进度达到 `98 / 98`。
- [x] 12 个场景的 English / 简体中文文章、catalog metadata、Tempo 参数和 Mermaid 样例均完整并通过对应测试。
- [x] `pnpm test:runbook`、`pnpm test:i18n`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 和 `docker compose build traffic-control-plane` 通过。
- [x] `/runbooks` 的登录保护、语言切换、主题切换、响应式、Markdown、Mermaid 和复制操作完成浏览器验收。
- [x] 每项已知问题都有状态、影响、可能解决方案和阶段更新记录；没有被隐藏的阻塞任务。