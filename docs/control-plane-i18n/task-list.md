# 控制台国际化实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | Phase A-F 完成；I18N-001、I18N-002 为非阻塞 warning |
| 版本 | 1.0 |
| 更新时间 | 2026-09-03 CST |
| 产品规格 | [product.md](product.md) |
| 技术设计 | [technical-design.md](technical-design.md) |

## 任务规则

1. 开始任务时将 `- [ ]` 改为 `- [-]`；通过该任务的验证后改为 `- [x]`。
2. 每完成一个任务，立即更新对应阶段进度、总体进度和本文件的更新时间。
3. 发现问题时，在“问题跟踪”中新增记录，填写影响、状态和可能的解决方案；问题解决后保留记录并更新状态，不删除历史。
4. 如果解决方案改变产品范围、语言策略、路由策略或数据边界，先同步更新 [product.md](product.md) 和 [technical-design.md](technical-design.md)，再继续实现。
5. 任务未完成或验证未通过时不得标记为 `[x]`；阻塞任务使用 `[!]` 并在问题跟踪中关联问题 ID。
6. 不修改与本功能无关的业务接口、鉴权契约、数据库结构、Gateway 路由或监控配置。
7. 本清单中的 `A1`、`B1` 等为任务组，阶段进度和总体进度按任务组统计；组内复选框为子任务，子任务完成后也要同步更新复选框数量。

## 总体进度

- **总体状态：** Phase A-F 完成；I18N-001、I18N-002 为非阻塞 warning
- **总体进度：** 44 / 44 个任务组（117 / 117 个子任务）
- **当前阶段：** Phase F：测试、构建与验收（已完成）
- **当前问题：** I18N-001：workspace root warning；I18N-002：开发环境 extractor/cache warning；I18N-003 已解决
- **可能的解决方案：** 保持当前实现可用；后续独立评估 `outputFileTracingRoot` 与 next-intl extractor/cache warning，不改变当前 i18n 功能范围

| 阶段 | 目标 | 状态 | 进度 | 前置依赖 |
| --- | --- | --- | --- | --- |
| A | next-intl 基础设施与根布局 | 已完成 | 7 / 7 | 无 |
| B | 语言切换与共享壳层 | 已完成 | 7 / 7 | A |
| C | 场景与 Fault Run 展示 | 已完成 | 8 / 8 | B |
| D | Runner 与 Operations | 已完成 | 8 / 8 | B |
| E | Alerts 管理界面 | 已完成 | 5 / 5 | B |
| F | 测试、构建与验收 | 已完成 | 9 / 9 | A 至 E |

## 执行依赖

```mermaid
graph TD
    A[Phase A: next-intl 基础设施] --> B[Phase B: 共享壳层与语言切换]
    B --> C[Phase C: 场景与 Fault Run]
    B --> D[Phase D: Runner 与 Operations]
    B --> E[Phase E: Alerts]
    C --> F[Phase F: 测试与验收]
    D --> F
    E --> F
```

---

## Phase A：next-intl 基础设施与根布局

**阶段目标：** 安装并锁定兼容的 `next-intl`，建立请求级 locale/message 解析，并让 Server Layout 与 Client Provider 使用同一份语言上下文。

**阶段状态：** 已完成
**阶段进度：** 7 / 7 个任务组（23 / 23 个子任务）
**问题：** I18N-001 待处理；I18N-002 已解决
**可能的解决方案：** I18N-001 后续评估 workspace root 配置；I18N-002 通过静态目录聚合入口解决

### A1. 依赖版本与锁文件

- [x] 在 `traffic-control-plane/package.json` 添加与当前 Next.js 15、React 19 兼容的 `next-intl@4.14.2`。
- [x] 更新 `traffic-control-plane/pnpm-lock.yaml`，确认只引入预期依赖变化并记录实际锁定版本。
- [x] 检查 peer dependency，确认 `next-intl@4.14.2` 兼容当前 Next.js 15.5.15 与 React 19.2.5。

### A2. 请求级 locale 解析

- [x] 新增 `traffic-control-plane/src/i18n/request.ts`，使用 `getRequestConfig` 和 `next/headers` 的 `cookies()`。
- [x] 仅接受 `en`、`zh-CN`；缺失、大小写变体、非法或恶意 Cookie 值统一回退 `en`。
- [x] 从 `control_plane_locale` 读取展示偏好，不读取或修改 `operator_session`、`operator_csrf`。
- [x] 加载对应 JSON 消息目录，并配置 `Asia/Shanghai` 等全局展示格式。

### A3. English canonical 消息目录

- [x] 新增 `traffic-control-plane/src/i18n/messages/en/` 命名空间目录及其 `index.ts` 聚合入口。
- [x] 按 `Common`、`Navigation`、`Login`、`Scenarios`、`FaultRuns`、`Runner`、`Operations`、`Alerts`、`Accessibility` 等命名空间整理前端自有文案。
- [x] 为所有计划覆盖的标题、按钮、状态显示、弹窗、日期选择器、Toast、Tooltip、ARIA 和前端 fallback 建立翻译键。
- [x] 不将后端错误、秘密、ID、服务名、PromQL、YAML 或运营人员编辑的监控内容放入目录。

### A4. Simplified Chinese 消息目录

- [x] 新增 `traffic-control-plane/src/i18n/messages/zh-CN/` 命名空间目录及其 `index.ts` 聚合入口，覆盖 English 目录全部键。
- [x] 保持两份目录的 ICU 占位符逐字一致，例如 `{count}`、`{duration}`、`{name}`。
- [x] 复核中文长文本在按钮、卡片、弹窗、头部和日期选择器中的可读性。

### A5. next-intl 类型声明

- [x] 新增 `traffic-control-plane/src/i18n/global.d.ts`，扩展 `next-intl` 的 `AppConfig`。
- [x] 将 canonical English 消息结构作为 `Messages` 类型，并将 locale 限定为 `en | zh-CN`。
- [x] 确认 `useTranslations`、`useLocale`、`useFormatter` 的类型能够被当前 TypeScript 配置解析。

### A6. Next.js 插件

- [x] 修改 `traffic-control-plane/next.config.mjs`，用 `createNextIntlPlugin('./src/i18n/request.ts')` 包装现有 standalone 配置。
- [x] 不增加旧版 Next.js `i18n` 配置，不配置 `localePrefix`，不迁移 `[locale]` 路由。

### A7. Root Layout 与 Provider

- [x] 修改 `traffic-control-plane/src/app/layout.tsx` 为异步 Server Component。
- [x] 使用 `getLocale()` 和 `getMessages()` 设置 `<html lang={locale}>`，保持 `suppressHydrationWarning` 的现有用途。
- [x] 用 `NextIntlClientProvider` 包裹现有 `ThemeProvider`、`ConsoleChrome` 和 `Toaster`。
- [x] 确认服务端初始 locale 与客户端 Provider locale/messages 一致，不依赖 `localStorage` 或 `navigator.language`。

---

## Phase B：语言切换与共享壳层

**阶段目标：** 在登录前和登录后提供一致的语言切换入口，完成公共页面、导航、主题、确认框和无障碍文本国际化。

**阶段状态：** 已完成
**阶段进度：** 7 / 7 个任务组（22 / 22 个子任务）
**问题：** I18N-003 已解决；I18N-001 仍为全局非阻塞 warning
**可能的解决方案：** 已完成语言切换、Cookie 持久化和共享壳层验证；I18N-001 后续评估 workspace root 配置

### B1. LocaleSwitcher 组件

- [x] 新增 `traffic-control-plane/src/components/LocaleSwitcher.tsx`。
- [x] 使用现有原生 `select` 的样式和可访问性模式，固定提供 `English` 与 `简体中文`。
- [x] 对 DOM 传入值再次执行 locale 白名单校验。

### B2. Cookie 持久化与刷新

- [x] 切换时写入 `control_plane_locale`，设置 `Path=/`、`Max-Age=31536000`、`SameSite=Lax`，生产环境按站点策略追加 `Secure`。
- [x] 立即更新 `document.documentElement.lang`，并调用 `router.refresh()` 重新读取请求级消息目录。
- [x] 不调用 `router.push()`，不修改 pathname、query 或 `returnTo`。
- [x] 确认语言 Cookie 不触碰认证 Cookie、业务请求 headers、表单 payload 或 API 鉴权。

### B3. 登录页

- [x] 修改 `traffic-control-plane/src/app/login/page.tsx`，接入登录页语言选择器。
- [x] 翻译标题、说明、用户名、密码、提交中、提交按钮、前端 fallback 和 `aria-label`。
- [x] 保留登录 API、认证错误原文、`safeReturnTo` 和现有跳转逻辑。

### B4. ConsoleChrome

- [x] 修改 `traffic-control-plane/src/components/ConsoleChrome.tsx`，在认证头部放置语言选择器。
- [x] 翻译页脚和共享壳层自有文案，确保登录页仍不显示认证后的导航。
- [x] 在窄屏下保持品牌、导航、语言选择、主题和登出入口可操作且不重叠。

### B5. NavBar

- [x] 修改 `traffic-control-plane/src/components/NavBar.tsx`，翻译 Scenarios、Runner、Operations、Alerts 和登出文案。
- [x] 使用 `useFormatter` 或 next-intl formatter 替换固定 `sv-SE` 时间格式，同时保持现有时区语义。
- [x] 保留所有无语言前缀链接和当前路由激活判断。

### B6. ThemeToggle 与 ConfirmDialog

- [x] 修改 `traffic-control-plane/src/components/ThemeToggle.tsx`，翻译主题切换 `title` 和无障碍名称。
- [x] 修改 `traffic-control-plane/src/components/ConfirmDialog.tsx`，翻译默认取消、确认和等待按钮文案。
- [x] 确认调用方传入的业务确认说明可以使用当前 locale，但动态后端消息仍原样展示。

### B7. 共享 UI 验收

- [x] 复核所有公共按钮、图标按钮、Tooltip、隐藏文本、`aria-label` 和 `title` 无硬编码 English 遗漏。
- [x] 在登录页和认证后页面分别验证切换、刷新、回退和无效 Cookie 行为。
- [x] 记录头部、登录卡片和确认弹窗在桌面/窄屏下发现的问题及解决方案。

---

## Phase C：场景与 Fault Run 展示

**阶段目标：** 将场景目录和 Fault Run 的人类可读展示接入消息目录，同时保持运行数据、协议值和安全解析逻辑不变。

**阶段状态：** 已完成
**阶段进度：** 8 / 8 个任务组（21 / 21 个子任务）
**问题：** I18N-003 已解决；I18N-001、I18N-002 为全局 warning
**可能的解决方案：** 已完成场景展示、Fault Run 安全摘要和中英文交互验证；Phase F 继续跟踪全局 warning

### C1. 场景元数据翻译键

- [x] 修改 `traffic-control-plane/src/components/scenarios/meta.ts`，为场景、分组和 PSP outcome 保存稳定 translation key。
- [x] 保留场景 ID、provider outcome value、图标、tone 和场景顺序不变。

### C2. 场景标签解析

- [x] 更新 `getScenarioLabel` 及其调用方，使用当前 locale 解析已知场景标签。
- [x] 为分组、provider outcome、目标服务/操作和已知状态提供安全显示映射。
- [x] 未知场景或状态回退原始稳定标识，不抛出渲染异常。

### C3. Fault Run 纯展示边界

- [x] 修改 `traffic-control-plane/src/components/scenarios/fault-run-view.ts`，保持 `buildFaultRunView` 为 locale-independent 的数据规范化和安全校验函数。
- [x] 将事件摘要、worker/cleanup 摘要、字节和成员列表展示拆为调用方传入 formatter 或 UI 层 formatter。
- [x] 不在纯工具模块中引入 React hook，不把整个后端 payload 交给翻译函数。

### C4. 场景首页

- [x] 修改 `traffic-control-plane/src/app/page.tsx`，翻译页面标题、加载/空状态、确认文案、前端 fallback 和 Toast。
- [x] 保留 Fault Run 创建、停止、清理请求的字段、路径、幂等和 CSRF 行为。

### C5. ScenarioControlSections

- [x] 修改 `traffic-control-plane/src/components/ScenarioControlSections.tsx`，翻译分组、历史、活动运行、详情、恢复、清理、指标和辅助说明。
- [x] 使用 locale-aware 日期、数字和容量展示，继续保持 `Asia/Shanghai`。
- [x] 保留运行 ID、trace ID、服务名、目标操作和 API 返回值原样。

### C6. ScenarioCardWithActions

- [x] 修改 `traffic-control-plane/src/components/ScenarioCardWithActions.tsx`，翻译卡片描述、参数 label/description、操作状态、provider outcome 和控件 ARIA 文案。
- [x] 保留提交给 API 的原始参数名、参数值、场景码和 outcome value。

### C7. 状态、Toast 与错误边界

- [x] 为已知 Fault Run 状态和安全 frontend result 建立显示翻译，不改变原始状态值。
- [x] 将前端自有 loading/empty/confirmation/fallback 文案接入消息目录。
- [x] 保持 `result.message`、`Error.message` 和服务端错误 payload 原样展示。

### C8. Fault Run 安全回归

- [x] 确认 `SCENARIO_REQUEST_FAILED` 等摘要仍只输出固定安全文案，不泄露 password、token 或原始 error payload。
- [x] 确认 `formatHashNamespace`、member SKU、faultRunId 和 cache/worker 标识仍按原值或安全格式展示。
- [x] 对场景页的桌面/窄屏长文本、详情弹窗和事件列表进行人工复核，记录问题及解决方案。

---

## Phase D：Runner 与 Operations

**阶段目标：** 覆盖生命周期 Runner、数据预热/补齐控制和日期选择器，统一展示格式，同时保护配置和机器值。

**阶段状态：** 已完成
**阶段进度：** 8 / 8 个任务组（18 / 18 个子任务）
**问题：** I18N-003 已解决；I18N-001、I18N-002 为全局 warning
**可能的解决方案：** 已完成 Runner/Operations 展示格式、日期选择器和中英文交互验证；Phase F 继续跟踪全局 warning

### D1. Runner 页面

- [x] 修改 `traffic-control-plane/src/app/runner/page.tsx`，翻译标题、配置反馈、成功/失败的前端 Toast、加载状态和无障碍文本。
- [x] 保留配置更新请求、乐观锁 `version`、比例值和后端返回错误原文。

### D2. RunnerPanels

- [x] 修改 `traffic-control-plane/src/components/runner/RunnerPanels.tsx`，翻译 lifecycle header、tab、指标、账号摘要、活动、队列、补券和库存补齐说明。
- [x] 已知 runner/action/status code 使用显示映射，底层 code、客户 ID、活动 ID 和服务端值保持不变。

### D3. RunnerDataControl

- [x] 修改 `traffic-control-plane/src/components/runner/RunnerDataControl.tsx`，翻译预热、补齐、任务状态、按钮、确认框、空/加载状态和 ARIA 文案。
- [x] 保留表名、任务 ID、窗口 ID、cron、数量和后端结果原值。

### D4. RunnerControls

- [x] 修改 `traffic-control-plane/src/components/runner/RunnerControls.tsx`，翻译字段 label、目标表说明、listbox label、选项描述和控件辅助文本。
- [x] 保留 `TABLE_OPTIONS` 的机器值和提交值，只对显示 label/description 做翻译。

### D5. DatePicker

- [x] 修改 `traffic-control-plane/src/components/runner/DatePicker.tsx`，使用当前 locale 展示月份、星期、日期和范围消息。
- [x] 翻译上一月/下一月、选择日期、弹出层和网格的 ARIA label。
- [x] 保持日期计算、ISO 输入值和 `todayInShanghaiClient()` 的 `YYYY-MM-DD` 输出不变。

### D6. Runner utils

- [x] 修改 `traffic-control-plane/src/components/runner/utils.ts`，将 `en-US`、默认 locale 等用户可见 formatter 迁移到 next-intl 或显式 locale formatter。
- [x] 保留上海业务时区、原始数值、配置值和请求值；只改变展示字符串。

### D7. Operations 页面

- [x] 修改 `traffic-control-plane/src/app/operations/page.tsx`，翻译数据操作页标题、tab、队列、状态、确认、加载/空状态和前端 fallback。
- [x] 保留操作 API 路径、参数、任务 ID、表名、服务端消息和鉴权行为。

### D8. Runner/Operations 集成复核

- [x] 检查所有 Runner/Operations 用户可见文本、`title`、`aria-label` 和 tooltip 无硬编码 English 遗漏。
- [x] 验证格式化不会把本地化字符串写回表单、配置对象、API payload 或数据库字段。
- [x] 记录长中文字段、数字单位、日期弹层和指标卡布局问题及可能的解决方案。

---

## Phase E：Alerts 管理界面

**阶段目标：** 翻译告警管理的 UI 自有文案，同时不修改保存到 Prometheus/Alertmanager 的配置内容。

**阶段状态：** 已完成
**阶段进度：** 5 / 5 个任务组（11 / 11 个子任务）
**问题：** I18N-003 已解决；I18N-001、I18N-002 为全局 warning
**可能的解决方案：** 已完成 Alerts UI 文案和编辑数据边界验证；Phase F 继续跟踪全局 warning

### E1. Alerts 页面

- [x] 修改 `traffic-control-plane/src/app/alerts/page.tsx`，翻译页面标题、tab、加载/空状态、刷新、保存和前端 fallback。
- [x] 保留告警 API 路径、响应数据和服务端/parser 错误原文。

### E2. AlertControls

- [x] 修改 `traffic-control-plane/src/components/alerts/AlertControls.tsx`，翻译配置来源、帮助说明、按钮、状态和控件 ARIA 文案。
- [x] 对 source kind、severity 等固定配置值提供显示 label，但提交 value 不变。

### E3. AlertEditors

- [x] 修改 `traffic-control-plane/src/components/alerts/AlertEditors.tsx`，翻译规则、接收器和路由编辑器的字段 label、placeholder 辅助说明、按钮和 validation UI。
- [x] 不翻译或重写 rule summary、rule description、PromQL、YAML、receiver 名称和路由值。

### E4. AlertModals 与 AlertRoutingSection

- [x] 修改 `traffic-control-plane/src/components/alerts/AlertModals.tsx` 和 `AlertRoutingSection.tsx`，翻译模态框标题、确认/取消、删除/保存、空状态和 ARIA 文案。
- [x] 保留编辑器中的原始配置字段、值、格式和错误详情。

### E5. Alerts 边界与布局复核

- [x] 检查 Alerts 全部用户可见 UI 文案均通过 next-intl，且运营编辑的监控内容不被当作翻译键。
- [x] 在 English/简体中文和桌面/窄屏下复核表单、编辑器、模态框、长 YAML/PromQL 内容不发生遮挡或截断。
- [x] 记录 parser/server error、长字段或编辑器布局问题及可能的解决方案。

---

## Phase F：测试、构建与验收

**阶段目标：** 用自动化测试验证语言目录、回退、安全边界和纯展示函数，并完成开发服务器双语走查。

**阶段状态：** 已完成
**阶段进度：** 9 / 9 个任务组（22 / 22 个子任务）
**问题：** I18N-001、I18N-002 为非阻塞 warning
**可能的解决方案：** 保留当前可用实现；后续独立评估 workspace root 和 next-intl extractor/cache warning

### F1. locale 解析测试

- [x] 新增 `traffic-control-plane/src/i18n/*.test.ts`，覆盖缺失 Cookie、`en`、`zh-CN`、非法值、大小写变体和恶意值回退。
- [x] 验证解析逻辑不读取或改变认证 Cookie。

### F2. 消息目录 parity 测试

- [x] 递归比较 `messages/en/` 与 `messages/zh-CN/` 聚合后的键集合。
- [x] 比较 ICU 占位符集合，发现缺失或多余占位符时测试失败。
- [x] 验证主要命名空间和 frontend fallback 消息键均存在。

### F3. 场景与 Fault Run 测试

- [x] 新增/扩展场景 metadata 测试，验证所有场景、分组和 provider outcome 均有双语显示文案。
- [x] 扩展 `src/components/scenarios/fault-run-view.test.ts`，验证双语摘要、未知 ID 回退、marker/cleanup 解析和错误 payload 脱敏。

### F4. Runner formatter 测试

- [x] 在 `src/components/runner/utils.test.ts` 或同目录测试中验证 English/简体中文日期、数字、容量展示。
- [x] 验证 `Asia/Shanghai` 语义、`todayInShanghaiClient()` ISO 输出和原始请求值不变。

### F5. 定向测试脚本

- [x] 在 `traffic-control-plane/package.json` 增加 `test:i18n`，覆盖新增的 locale、catalog、scenario 和 formatter 纯测试。
- [x] 执行 `pnpm test:i18n` 和既有 `pnpm test:runner`，修复本次改造引入的失败。

### F6. TypeScript 与 lint

- [x] 执行 `cd traffic-control-plane && pnpm typecheck`。
- [x] 执行 `pnpm lint`，区分既有 warning 与本次新增问题，并记录无法消除的既有问题。

### F7. 生产构建

- [x] 执行 `pnpm build`，确认 next-intl 插件、动态 request config、JSON 消息目录和 standalone 输出正常。
- [x] 检查构建输出没有把密码、token 或不应进入客户端的服务端配置打包到消息目录。

### F8. 语言切换与持久化手工验收

- [x] 启动 `pnpm dev`，清除 `control_plane_locale` 后访问 `/login`，确认 English 和 `<html lang="en">`。
- [x] 未登录时切换简体中文，确认当前路径不变；刷新后确认页面文案、消息目录和 `<html lang="zh-CN">` 同步。
- [x] 登录后切换两种语言，确认认证状态、`returnTo`、业务请求和当前页面不变。

### F9. 全页面、响应式与鉴权回归

- [x] 在 `/`、`/runner`、`/operations`、`/alerts` 两种语言下走查导航、场景卡片/详情、Runner 日历、数据操作、Alerts 编辑器、Toast 和确认框。
- [x] 在桌面和窄屏检查头部、语言选择器、品牌、主题、登出、按钮、卡片和模态框无重叠/裁切。
- [x] 确认 `/internal/**`、受保护页面、API 401、Operator 会话和 CSRF 行为与改造前一致。
- [x] 确认语言切换不改变 path、query、API payload、stable code、YAML/PromQL、服务名、表名或后端原始错误。

---

## 问题跟踪

问题发现后按以下字段追加记录；状态建议使用 `待处理`、`处理中`、`已解决` 或 `已阻塞`。

| ID | 发现阶段/任务 | 问题 | 影响 | 可能的解决方案/下一步 | 状态 |
| --- | --- | --- | --- | --- | --- |
| I18N-001 | Phase A / A7 | Next.js 检测到仓库根目录存在额外 lockfile，生产构建提示 workspace root 可能不准确。 | 当前构建成功；可能影响 standalone 文件追踪根目录判断。 | 后续评估在 `next.config.mjs` 设置 `outputFileTracingRoot`，或清理不相关的重复 lockfile；本阶段不扩大范围。 | 待处理 |
| I18N-002 | Phase A / A6、Phase F 前置验证 | `next-intl@4.14.2` extractor 在 webpack cache 依赖解析时产生 warning；生产 build 可通过，但开发服务器启动时仍可能复现。 | 当前功能、typecheck、lint 和 build 正常；开发环境可能出现 cache invalidation warning。 | 保持静态 locale/namespace 聚合入口；Phase F 复核 next-intl 版本、插件配置或关闭不必要的 extractor 行为，确认是否可消除。 | 待处理 |
| I18N-003 | Phase B/C/D/E 浏览器复核 | 截图发现中文页面仍显示英文或原始 UI 值，包括 ConfirmDialog 的 `Cancel`、网络异常的 `Failed to fetch`、导航 `Runner`、恢复策略 `TARGET/WORKER`、Operations 清理确认标题和 Alerts 严重级别。 | 影响中文界面的完整性；部分文案绕过消息目录，网络异常会直接暴露浏览器原始错误。 | 移除确认框硬编码默认值；为浏览器传输异常增加本地化 fallback；为导航、恢复策略、状态和严重级别增加显示映射；保留后端消息、稳定 code、配置值和 API payload 原样。 | 已解决 |

## 阶段更新记录

每完成一个任务或发现/解决一个问题后追加一行，保留历史进度。

| 日期 | 阶段/任务 | 总体进度 | 阶段进度 | 问题 | 可能的解决方案/下一步 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-03 | 建立任务清单 | 0 / 44 | A-F 均为 0 | 暂无 | 按 Phase A 开始实施 |
| 2026-09-03 | 完成 Phase A / A1-A7 | 7 / 44（23 / 117 子任务） | A：7 / 7（23 / 23 子任务） | I18N-001、I18N-002，均为非阻塞构建 warning | 开始 Phase B；后续评估 workspace root 与 extractor/cache warning |
| 2026-09-03 | 优化消息目录结构 | 7 / 44（23 / 117 子任务） | A：7 / 7（23 / 23 子任务） | 无新增问题；原有消息目录拆为语言/命名空间文件夹 | 保持 `messages/index.ts` 聚合入口，后续新增文案按命名空间追加文件 |
| 2026-09-03 | 解决 I18N-002 | 7 / 44（23 / 117 子任务） | A：7 / 7（23 / 23 子任务） | 动态 JSON import warning 不再复现 | 通过静态 namespace index 聚合消息目录；I18N-001 继续跟踪 workspace root warning |
| 2026-09-03 | 完成 Phase B / B1-B7 | 14 / 44（45 / 117 子任务） | B：7 / 7（22 / 22 子任务） | 无新增问题；I18N-001 仍为非阻塞 warning | 开始 Phase C/D/E；保持当前 URL、认证和 API 契约不变 |
| 2026-09-03 | Phase B 认证后 header 与窄屏复核 | 14 / 44（45 / 117 子任务） | B：7 / 7（22 / 22 子任务） | 无新增问题；中英文 header 切换和 390px 布局验证通过 | 进入 Phase C/D/E；继续保持无语言前缀路由和认证 Cookie 隔离 |
| 2026-09-03 | 完成 Phase C/D/E | 35 / 44（95 / 117 子任务） | C：8 / 8（21 / 21）；D：8 / 8（18 / 18）；E：5 / 5（11 / 11） | I18N-001 待处理；I18N-002 在开发服务器中重新出现，待 Phase F 复核 | active 页面、消息目录和兼容入口均已统一到本地化实现；进入 Phase F |
| 2026-09-03 | Phase C/D/E 浏览器交互复核 | 35 / 44（95 / 117 子任务） | C/D/E 全部完成 | 无新增问题；四个页面双语切换、日期选择器、Provider 选择器和新建告警模态框验证通过 | Phase F 补充自动化 parity/formatter 测试并处理两个 warning |
| 2026-09-03 | 修复 I18N-003 并完成截图残留复核 | 35 / 44（95 / 117 子任务） | C/D/E 复核完成 | I18N-003 已解决；I18N-001、I18N-002 仍为非阻塞 warning | 中文四页面普通 UI 英文扫描、确认框、Provider 选择器、告警弹窗和桌面/390px header 几何检查通过；进入 Phase F |
| 2026-09-03 | 完成 Phase F 自动化与最终验收 | 44 / 44（117 / 117 子任务） | F：9 / 9（22 / 22） | I18N-003 已解决；I18N-001、I18N-002 仍为非阻塞 warning | `test:i18n` 14/14、`test:runner` 68/68、typecheck、lint、build 通过；四页面双语 smoke、路由保持、嵌套弹窗/选择器和 390px header 检查通过 |

## 完成标准

- [x] Phase A-F 所有任务组完成，任务组进度达到 `44 / 44`，子任务进度达到 `117 / 117`。
- [x] `pnpm test:i18n`、`pnpm test:runner`、`pnpm typecheck`、`pnpm lint` 和 `pnpm build` 通过。
- [x] English 与简体中文在登录、场景、Runner、Operations、Alerts 和共享壳层的主要流程均完成手工验收。
- [x] 所有未解决问题都有明确状态和后续方案；没有已知的阻塞问题被隐藏在任务复选项之外。
