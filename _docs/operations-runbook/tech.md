# 场景操作手册技术设计

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | 规划中 |
| 版本 | 1.0 |
| 更新时间 | 2026-09-03 CST |
| 范围 | `traffic-control-plane` Next.js App Router |
| 产品规格 | [product.md](product.md) |

## 1. 设计目标与约束

本设计为现有 `traffic-control-plane` 增加一个受 Operator 认证保护的双语、只读操作手册。长篇内容采用仓库内的受控 Markdown，页面展示静态 Tempo 查询配方和 Mermaid 图表，不新建独立服务。

关键约束：

- 当前应用使用 Next.js App Router、`output: 'standalone'`、React 19、Tailwind 和 `next-intl`。
- 现有 `src/middleware.ts` 已保护除登录/会话外的页面和 API；`/runbooks` 自动继承保护，不应修改 middleware。
- 支持的 locale 仅为 `en` 和 `zh-CN`，由 `control_plane_locale` Cookie 决定；不使用 `[locale]` 路由段。
- `fault-run-catalog.ts` 是当前 12 个场景、固定目标、参数、时长与恢复策略的唯一机器可读事实来源。
- Markdown 内容必须位于控制台 build context 内，不能在 production runtime 读取仓库根目录 `_docs`。
- Mermaid 依赖浏览器 DOM；不得在 Server Component 或 Node runtime 中初始化 Mermaid。
- 不生成 Grafana Explore URL、Tempo trace URL 或外部重定向；页面只提供手动查询参数。
- `X-Trace-Id` / `fault_runs.trace_id` 是自定义业务关联 ID，未被证明为 OTel trace ID，不能成为 Tempo 深链输入。

## 2. 总体架构

```mermaid
flowchart LR
    Operator[Operator browser] --> Middleware[Operator middleware]
    Middleware --> RunbookPage[/runbooks Server Component]
    RunbookPage --> Catalog[fault-run-catalog.ts]
    RunbookPage --> Metadata[runbook.ts]
    RunbookPage --> Loader[runbook-content.ts]
    Loader --> Content[en and zh-CN Markdown]
    RunbookPage --> Workspace[RunbookWorkspace]
    Workspace --> Markdown[RunbookArticle and react-markdown]
    Markdown --> Mermaid[MermaidDiagram Client Component]
    Workspace --> Tempo[Static Tempo query panel]
    Operator --> ExistingTempo[Existing Grafana or Tempo UI]
```

运行流：

1. 认证后的浏览器请求 `/runbooks?scenario=<SCENARIO_ID>`。
2. 服务端页面读取当前 locale 和受限的 scenario query。
3. 页面从 catalog 推导稳定目标信息，从 typed runbook metadata 获取影响范围和 Tempo 查询配方，并加载对应语言的 Markdown。
4. `react-markdown` 服务器渲染常规 Markdown；只有 Mermaid fenced block 在 hydration 后由客户端组件绘制 SVG。
5. 操作人员复制 Tempo 参数，在已有观测界面中自行查询。页面不发送浏览器到 Grafana/Tempo 的跳转请求。

## 3. 文件布局

新增目录和文件：

```text
traffic-control-plane/
  src/
    app/runbooks/page.tsx
    components/runbook/
      RunbookWorkspace.tsx
      RunbookArticle.tsx
      MermaidDiagram.tsx
      CopyTextButton.tsx
    content/runbook/
      en/
        browse-report-sql.md
        ... 11 additional scenario articles
      zh-CN/
        browse-report-sql.md
        ... 11 additional scenario articles
    lib/
      runbook.ts
      runbook-content.ts
      runbook.test.ts
    i18n/messages/
      en/Runbook.json
      zh-CN/Runbook.json
```

修改文件：

```text
traffic-control-plane/
  package.json
  pnpm-lock.yaml
  Dockerfile
  src/app/globals.css
  src/components/NavBar.tsx
  src/i18n/messages/en/index.ts
  src/i18n/messages/zh-CN/index.ts
  src/i18n/messages.test.ts
```

不修改 `src/lib/env.ts`、根目录 `docker-compose.yml`、Grafana/Tempo 配置、Kubernetes manifest、Gateway 或任意业务服务。

## 4. 领域模型与唯一事实来源

### 4.1 Catalog 连接

`src/lib/runbook.ts` 以 `FaultRunScenario` 为主键。它必须使用 `listScenarioDefinitions()` 和 `getScenarioDefinition()` 拼合以下信息：

- `scenario`
- `targetService`
- `targetOperation`
- `maxDurationSec`
- `recoveryStrategy`
- `allowManualCleanup`
- 参数定义

这些字段不得在手册 metadata 或 Markdown 中再作为可变事实复制。文章可解释参数的业务含义，但控制台标题、固定目标、时长和恢复策略应直接使用 catalog 数据，避免两个页面随时间漂移。

### 4.2 Runbook metadata

`runbook.ts` 保存只有手册才拥有的、稳定的附加资料。建议模型如下：

```ts
import type { FaultRunScenario } from './fault-run-catalog';

export type TempoQueryRecipe = {
  services: readonly string[];
  route?: string;
  businessPath: readonly string[];
  timeRange: 'now-1h to now';
  slowThreshold: string;
  waterfallChecks: readonly ('HTTP' | 'JDBC' | 'REDIS' | 'EXCEPTION' | 'HEALTH')[];
};

export type ScenarioRunbookMetadata = {
  scenario: FaultRunScenario;
  articleFile: string;
  impactScope: 'REQUEST' | 'CUSTOMER' | 'ROW' | 'TABLE' | 'SERVICE' | 'DEPENDENCY' | 'PLATFORM';
  affectedResources: readonly string[];
  explicitlyExcluded: readonly string[];
  businessPath: readonly string[];
  tempo: TempoQueryRecipe;
};
```

`listRunbookEntries()` 应遍历 catalog，而不是自行维护场景数组；`getRunbookEntry()` 将 catalog definition 和 metadata 合并为页面模型。启动/测试时必须验证 metadata 与 catalog 一对一对应。

### 4.3 Query 参数解析

`resolveRunbookScenario(input: string | string[] | undefined)` 只接受已存在的 `FaultRunScenario`。缺失或未知值固定回退到第一个 catalog 场景。不得将 query 原文拼进：

- 文件名或文件系统路径；
- TraceQL 字符串；
- 外部 URL；
- React key、HTML 或错误消息模板。

文章路径只从 `ScenarioRunbookMetadata.articleFile` allowlist 得到。

## 5. 场景 Metadata 与 Tempo 配方

手册 metadata 必须覆盖以下事实。route 是静态的辅助收窄条件，只有实际 Tempo 中存在对应 `http.route` 时才建议输入；基础查询始终从 service name 开始。

| 场景 | Tempo 服务 | route 或业务路径 | 慢请求/错误观察重点 |
| --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | `catalog-service` | `/api/reports/product-browse` | 历史行为扫描、JDBC span、时延。 |
| `ORDER_REPORT_SQL` | `order-service` | `/api/reports/order-query` | 历史订单查询、N+1 明细 JDBC span、时延。 |
| `BROWSE_SURGE` | `gateway-service`, `catalog-service` | `/api/products` | 请求率、下游时延和服务错误。 |
| `ORDER_QUERY_SURGE` | `gateway-service`, `order-service` | `/api/orders` | 受控客户订单查询时延和服务错误。 |
| `CATALOG_REDIS_LARGE_VALUE` | `catalog-service` | `/api/products/{sku}` | Redis span、反序列化、超时和 5xx。 |
| `CART_CATALOG_DEPENDENCY` | `cart-service`, `catalog-service` | `POST /api/cart/items`、商品校验 | Cart 下游调用异常与写入前失败。 |
| `NOTIFICATION_HEAP_PRESSURE` | `notification-service` | 正常通知处理 | duration、error、健康失败或进程退出后的 trace 缺口。 |
| `NOTIFICATION_STORAGE_APPEND` | `notification-service` | 正常通知持久化 | 逻辑容量保护、持久化错误和运行级清理。 |
| `PROMOTION_LOCK_CONTENTION` | `promotion-service` | 优惠券预留一致性 | deadlock、`SQLException`、JDBC duration 和失败请求。 |
| `INVENTORY_TABLE_EXCLUSIVE` | `inventory-service` | `POST /internal/inventory/availability/report` | 表锁阻塞、超时、JDBC duration 和恢复。 |
| `INVENTORY_ROW_LOCK` | `inventory-service` | `POST /internal/inventory/reservations/summary` | `SKU-001` 锁等待、超时、JDBC duration。 |
| `PSP_PROVIDER_OUTCOME` | `psp-simulator`, `payment-service` | `POST /api/psp/authorize` | 拒付、客户端超时和支付失败路径。 |

每条 recipe 提供三个派生文本，由页面显示和复制：

```traceql
{ resource.service.name = "catalog-service" }
```

```traceql
{ resource.service.name = "catalog-service" && status = error }
```

```traceql
{ resource.service.name = "catalog-service" && duration > 2s }
```

多服务场景为每个服务生成独立可复制查询，避免依赖未验证的 TraceQL 多服务组合语法。路由细化示例仅作为可选补充：

```traceql
{ resource.service.name = "catalog-service" && span.http.route = "/api/products/{sku}" }
```

页面不得硬编码、接受或拼接任意操作人员输入的 TraceQL。

## 6. Markdown 内容加载

### 6.1 内容目录

每种语言按同一 allowlist 文件名存放完整文章：

```text
src/content/runbook/en/<articleFile>.md
src/content/runbook/zh-CN/<articleFile>.md
```

`runbook-content.ts` 负责：

1. 验证 locale 为 `en` 或 `zh-CN`。
2. 通过 `getRunbookEntry()` 解析 scenario。
3. 仅使用 metadata 中的 `articleFile` 组成内容路径。
4. 使用 `node:fs/promises` 读取 UTF-8 Markdown。
5. 对缺失或空内容抛出明确错误，由页面显示本地化的受控内容不可用状态；测试必须先于发布捕获该错误。

页面声明 Node runtime，以免 Edge runtime 缺少文件系统能力：

```ts
export const runtime = 'nodejs';
```

### 6.2 文章内容规则

所有文章都有相同章节结构：目的与固定目标、实际实现逻辑、参数与生命周期、影响范围、预期证据、Tempo 排障、恢复验证、限制与注意事项。

English 与中文文章在语义上成对覆盖。稳定值如服务名、场景码、API path、表名、错误码和 TraceQL 不翻译。文章以当前代码为权威；`_docs/chaos-inject-plane/product.md` 和 `_docs/chaos-inject-plane/tech.md` 仅是编写素材，不能作为 runtime loader 的读取路径。

## 7. Route 与组件设计

### 7.1 Server page

`src/app/runbooks/page.tsx` 是 Server Component：

1. 用 `getLocale()` 获取经过现有 `next-intl` request config 校验后的语言。
2. 读取并解析 `searchParams.scenario`。
3. 获取合并后的 runbook entry 和 Markdown。
4. 将数据传入 `RunbookWorkspace`。

页面不读取 `GRAFANA_BASE_URL`、`TEMPO_BASE_URL`、浏览器 Cookie 以外的运行身份数据，也不产生重定向到观测系统。

### 7.2 Workspace

`RunbookWorkspace` 负责目录、文章容器和 Tempo 诊断面板。它复用 `components/scenarios/meta.ts` 的 `SCENARIO_GROUPS` 和 label keys 组织目录，使场景分组与控制台首页一致。

目录项目使用普通内部 anchor：

```tsx
<a href={`/runbooks?scenario=${entry.scenario}`}>...</a>
```

当前项使用 `aria-current="page"`。采用 query 而非动态子路由，可保持 `NavBar` 当前对 `/runbooks` 的严格 active 判断，也使现有 `LocaleSwitcher.router.refresh()` 自然保留选中场景。

### 7.3 Article 与复制组件

`RunbookArticle` 使用：

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: RunbookCodeBlock }}>
  {markdown}
</ReactMarkdown>
```

它只对 fenced block 的 `className` 包含 `language-mermaid` 时渲染 `MermaidDiagram`。没有 language 标记或语言不是 `mermaid` 的块继续输出标准 `<pre><code>`，保持 SQL、TraceQL、JSON 和 shell 文本的可选中性。

`CopyTextButton` 是小型 Client Component，接收由 typed metadata 派生的文本。优先使用 `navigator.clipboard.writeText`，不支持时使用受限的浏览器回退；按钮使用 lucide `Copy` / `Check` 图标、当前 locale 的 `aria-label` 和短暂的本地化已复制状态。它不接受 URL、HTML 或用户输入。

Tempo 面板显示以下只读信息：

- OTel service name；
- 可选 route 或业务路径；
- 建议查询窗口；
- 服务、错误和慢请求的 TraceQL；
- waterfall 中应检查的 HTTP、JDBC、Redis、exception 或 health 证据。

## 8. Mermaid 设计

### 8.1 客户端隔离

`MermaidDiagram.tsx` 标注 `'use client'`。它不在模块顶层导入 Mermaid，而在 effect 内通过 dynamic import 加载，避免服务端构建/渲染访问 `window`、`document` 或 Mermaid 的 DOM API。

组件接收受控 Markdown 的 `source` 和本地化 `label`。每次 source 或 resolved theme 变化时：

1. 创建唯一且经字符清理的 diagram ID。
2. `await import('mermaid')`。
3. 使用严格配置初始化 Mermaid。
4. 渲染 SVG 并仅在组件仍为当前渲染周期时写入 DOM。
5. 在 effect cleanup 中标记结果已取消，防止异步旧图覆盖新文章或新主题。

建议配置：

```ts
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  theme: resolvedTheme === 'dark' ? 'dark' : 'default',
});
```

组件通过 `next-themes` 的 resolved theme 在浅色/深色切换时重新渲染。图表不支持 click/callback 行为，不把 Mermaid 作为导航、操作或脚本执行通道。

### 8.2 失败与无障碍

- 初始加载期间显示本地化的图表加载状态和原始 Mermaid 源码。
- Mermaid dynamic import 或语法解析失败时显示本地化错误提示和原始源码，错误仅影响当前图。
- 已成功的图使用 `<figure>`、本地化 `aria-label` 和 `<figcaption>`；SVG 包含在可横向滚动的容器中。
- 图表不得是唯一的信息载体；文章正文必须说明调用链、竞争/恢复顺序和受影响资源。
- 图表 wrapper 采用稳定的最大宽度和最小高度，避免 SVG 加载导致文章布局跳动。

## 9. 国际化与导航

新增 `Runbook.json` 到 `src/i18n/messages/en/` 和 `src/i18n/messages/zh-CN/`，再将它们导入各自 `index.ts`。只存放短 UI 文案，例如：

- 页面标题、说明和目录标签；
- Tempo 参数字段与复制状态；
- 内容缺失、Mermaid 加载和 Mermaid 错误回退文案；
- 图表无障碍标签。

长篇文章不进入 `NextIntlClientProvider` 的完整 message payload。现有 `messages.test.ts` 会递归验证两种语言的 key 和 ICU placeholder 一致；该测试应增加 `Navigation.runbook` 与所需 `Runbook` key。

`NavBar.tsx` 增加 `/runbooks` 入口和 `Navigation.runbook` 翻译。页面属于现有 `ConsoleChrome`，不新增独立 layout 或认证壳层。

## 10. 样式与响应式

在 `src/app/globals.css` 添加 scoped runbook styles，沿用当前 warm cream / charcoal / terracotta token：

- `.runbook-article` 下的标题、段落、列表、引用和 inline code；
- 可横向滚动的 `.runbook-table` 与 `.runbook-code`；
- 使用既有边框/卡片 token 的诊断面板，不嵌套无意义卡片；
- `.runbook-mermaid` 的最大宽度、溢出滚动、SVG 填满可用宽度和最小高度；
- 加载/失败源码回退的稳定尺寸、可读对比度和 focus-visible 状态。

目录在小屏可横向访问或以文档流显示；不得依赖固定 viewport 字号缩放。文字、图表、代码块和操作按钮必须在中文和英文下容纳其最长内容。

## 11. 依赖与镜像打包

在 `traffic-control-plane/package.json` 增加并锁定：

```json
{
  "react-markdown": "<verified version>",
  "remark-gfm": "<verified version>",
  "mermaid": "<verified version>"
}
```

安装后使用项目的 pnpm 版本更新 `pnpm-lock.yaml`。不引入 MDX loader、Docusaurus、Contentlayer、`rehype-raw` 或通用 HTML 注入插件。

因为 standalone output 不保证追踪任意动态文件读取，`Dockerfile` 的 runner stage 必须显式复制内容目录：

```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/src/content/runbook ./src/content/runbook
```

该修改与现有 `/app/src/worker`、`/app/src/lib` 的复制方式兼容。文章不放在 `public/`，避免绕过页面认证直接公开。

## 12. 测试与验证

### 12.1 Node 测试

新增 `src/lib/runbook.test.ts`，使用现有 `node:test` / `tsx --test` 方式验证：

1. `listRunbookEntries()` 与 `listScenarioDefinitions()` 一对一覆盖且共有 12 项。
2. 每个 entry 的固定目标、时长和恢复策略与 catalog 一致。
3. article 文件名唯一，不含路径分隔符或路径遍历内容。
4. 英文与简体中文每个 allowlisted Markdown 文件都存在、非空且成对覆盖。
5. 未知、空或数组形式的 `scenario` query 安全回退。
6. 每条 Tempo recipe 都有 allowlisted service、非空业务路径、时间范围、错误筛选和慢请求筛选。
7. `language-mermaid` fenced block 被识别为图表候选，SQL/TraceQL/JSON fenced block 不被识别。
8. 至少存在中英文成对的 Mermaid 图表样例，且 fenced block 闭合完整。

为 `package.json` 增加显式 `test:runbook` 脚本。`test:i18n` 增加 required key 断言，继续检查全部语言消息 key/placeholder 的 parity。

### 12.2 构建验证

发布前执行：

```bash
cd traffic-control-plane
pnpm test:runbook
pnpm test:i18n
pnpm test:runner
pnpm lint
pnpm typecheck
pnpm build
cd ..
docker compose build traffic-control-plane
```

Docker build 后检查 production image 的 `/app/src/content/runbook` 存在，确保 standalone runtime 可加载文章。

### 12.3 浏览器走查

1. 登录后访问 `/runbooks` 与 12 个 `?scenario=` 值，确认目录、文章和固定目标准确显示。
2. 在 EN/中文间切换，确认 query、`<html lang>`、UI 文案、正文与 Mermaid 图内容同步变化。
3. 在浅色/深色主题切换，确认 Mermaid SVG 重绘且文字/连线清晰。
4. 在桌面与窄屏检查目录、长中文段落、表格、TraceQL、SQL 和大图的滚动与焦点顺序。
5. 临时使用无效 Mermaid 语法，确认仅该图回退原始源码，其他文章内容和复制按钮继续可用。
6. 将手册给出的服务、时间范围和 TraceQL 粘贴到已有 Tempo/Grafana 查询界面，确认可从目标服务开始定位；只在真实数据确认后再把 route 属性作为推荐收窄条件。

## 13. 实施顺序

1. 添加 Markdown/Mermaid 依赖及 runbook metadata、scenario 解析、内容 loader 和纯函数测试。
2. 编写成对的 12 篇 English/简体中文文章，并让测试验证完整性。
3. 实现 `/runbooks` server page、目录、文章渲染、Tempo 参数面板与复制组件。
4. 实现隔离的 Mermaid client renderer、主题重绘、错误回退和 scoped styles。
5. 加入导航和轻量 i18n namespace。
6. 修改 Dockerfile 打包内容并执行测试、构建、Docker build 和浏览器走查。

## 14. 风险与边界

- Java OTel agent 的具体 span name、attribute 代际和 exception event 形式可能随 agent 版本变化；手册将 service query 作为可靠起点，route 作为需现场确认的收窄条件。
- 业务异常被包装为响应 envelope 时，HTTP/OTel status 不一定为 error；每篇文章需描述其他证据。
- 堆压力可以使服务在最终 span 导出前退出；缺失 trace、健康状态和日志是预期补充证据。
- Mermaid 只渲染受控 Markdown，仍以 `securityLevel: 'strict'` 和无交互配置降低 SVG/DOM 风险；未来若允许用户编辑 Markdown，必须重新进行独立的内容清洗与安全设计。