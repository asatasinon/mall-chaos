# 批次 4：实时 Evidence Query 实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | P4-01～P4-18.3本地fixture综合验收完成；P4-18.2真实DB验收与P4-19环境门禁阻塞 |
| 版本 | 5.2 |
| 更新时间 | 2026-10-12 CST |
| 产品规格 | [product.md](./product.md) |
| 技术设计 | [tech.md](./tech.md)，当前 v2.8 |
| 路线阶段 | [阶段 4](../../roadmap/phases/phase-4-evidence-query.md) |
| 前置清单 | [批次 3 任务清单](../batch-3-scenario-contract/task-list.md) |
| 场景事实来源 | `traffic-control-plane/src/lib/fault-run-catalog.ts` |
| Evidence DSL 来源 | `traffic-control-plane/src/lib/scenario-contract.ts` |

本文件是批次 4 实施进度的持久记录。任务清单生成不等于开始实现，也不代表阶段 0～3 的运行环境门禁已经通过。后续每次任务完成、阻塞、恢复或取消，必须立即更新本文件，不能等整个批次结束后补记。

## 1. 已核对的实施起点

- Phase 3 已提供 Catalog supplement、Evidence DSL、完整 `contractRevision`、canonicalizer 和 Evidence-only hash。批次 4直接 import，不复制类型或另建可变场景映射。
- `evidence-contract-snapshot.ts` 已实现 snapshot 创建、序列化、hash 检查和缺失 snapshot 显式失败；这是内存 consumer seam，不是数据库持久化能力。
- `evidence-query-prometheus-renderer.ts` 已覆盖 Catalog 当前声明的 11 种 Prometheus 模板；LogQL/TraceQL live clients 和后端可用性仍待实现。
- 当前 `test:contract`、`test:runner` 已包含上述 seam 的测试。后续任务扩展现有 runner，不引入另一套测试框架。
- Phase 3 清单截至 2026-10-08 仍将外部 CI、clean-DB/disposable canary 和 live rollback 列为暂缓或阻塞；环境访问与完整 reset record 尚未提供。不能把已有代码或本地 fixture 视为阶段退出证据。
- 部署采用用户已确认的 **clean-slate bootstrap**：不支持已有 volume/schema upgrade，不新增仓库 wipe 工具，不自行 reset MySQL、Redis 或业务资源。

### 1.1 2026-10-09 用户确认与复审收敛

用户通过逐项提问确认：baseline 派生仅作对照；capture 同时冻结渲染计划/版本和窗口上限；future tail 返回部分证据并主动重查；deadline 到期的 RUNNING attempt 请求时 CAS 结算，不新增 Worker；active 任一采样、recovery 全部采样，effectRule 按 ALL/ANY 三态组合；Prometheus/Loki每query最多64个series。

本次同时将遥测/控制状态分离、run-scoped report/note 幂等、旧 Manifest 访问、Gateway bounded read、lookback/Tempo 截断纳入设计和明确验收。问题“设计已解决”不等于实施完成；P4-ISSUE-003～012 保持待实施验收。

2026-10-09补充确认：Loki只按当前Promtail实际索引的service/log_level筛选，渲染scope显式标记为SERVICE_ONLY；route/filesystem DSL字段不当作Loki过滤器，Loki只提供上下文信息且不得进入effectRule。

2026-10-09补充确认：safe-runtime若有多个stop/recovery attempt，时间线固定首次STOP_REQUESTED及同一attempt的实际DRAIN_STARTED；后续重试不移动canonical recovery anchor，缺少该attempt的DRAIN_STARTED时保持null。Prometheus/Loki每query固定最多64个series。

2026-10-11补充确认：多个metric series在同一latest timestamp有值时，当前响应的单一`latest`取该时间点的最大值，消除provider series顺序对摘要/baseline差值的影响；实现不得落库series标签或原始samples。

## 2. 状态与进度更新规则

| 标记 | 状态 | 使用条件 |
| --- | --- | --- |
| `[ ]` | 未开始 | 未进行实现或验证 |
| `[-]` | 进行中 | 开始工作前先更新状态 |
| `[x]` | 已完成 | 交付内容与该子任务要求的验收证据均已记录 |
| `[!]` | 阻塞 | 关联 `P4-ISSUE-nnn`，记录影响、待决策事项与恢复条件 |
| `[~]` | 取消/替代 | 记录用户决策、原因及替代任务，不计为已完成 |

每完成一个编号子任务，立即同步更新四处：其复选框、任务组计数、总体计数、执行记录。执行记录必须包含日期、任务 ID、实际修改范围、最小验证命令与结果、剩余限制和关联问题。

只完成代码、尚未获得要求的数据库或真实环境证据时不能标记 `[x]`。可以拆分出已完成的代码子任务，将环境验收保留为阻塞，禁止虚报整组完成。现有 seam 是复用输入，不自动计为本清单的完整运行时交付。

遇到需要用户决策的问题时：

1. 先将受影响子任务标为 `[!]`，登记问题，不写入未经批准的行为。
2. 使用提问工具一次询问一个明确决策，给出推荐选项、取舍和对任务的影响。
3. 把用户回答和日期记录在问题表；涉及范围、schema、权限、状态、部署或回退的变更先同步产品/技术设计。
4. 决策落实且验收通过后才能关闭问题。等待期间仅继续不依赖该决策的独立任务。

不因“需要用户决策”而向用户询问普通命名、局部实现细节或已有设计明确规定的行为；这类工作按仓库约定执行。

## 3. 总体进度

- **总体状态：** P4-01～P4-18本地测试与fixture矩阵完成；P4-18.2及P4-19仍受可丢弃环境、外部门禁与授权阻塞。
- **当前完成：** 59 / 63 个子任务。
- **实施清单进度：** 53 / 57（前置核对、配置、schema、strict DTO、Repository、全Catalog固定query plan、创建事务capture、安全timeline/window、Manifest、source clients、Gateway/Run Event/CURRENT adapters、coverage/preflight、truth-table聚合、同步executor、attempt幂等/终态、retention保全、Operator API、Note API、事务审计、诊断、Evidence UI/i18n、Compose/Kubernetes静态声明及综合fixture回归）；真实环境验收未完成；已有 Phase 3 seam 不重复计入。
- **当前任务：** P4-19.1 获取获批可丢弃环境、clean-slate reset record 与操作授权（当前阻塞）。
- **下一步：** 等待用户确认真实验证目标与授权；在环境、reset record 和明确授权齐备前，不执行DB reset、真实source/Gateway query或canary；K8s Evidence execution继续关闭。
- **阶段退出：** 阻塞。外部 CI、环境访问、完整 reset record 和 canary 证据未齐，不能声明 Phase 4 完成或进入 5.0。

| 任务组 | 目标 | 状态 | 完成 | 依赖 |
| --- | --- | --- | --- | --- |
| P4-00 | 建立清单与进度机制 | 已完成 | 3 / 3 | 当前设计 |
| P4-00R | 覆盖复审与决策落文档 | 已完成 | 3 / 3 | P4-00、用户决策 |
| P4-01 | 核对前置门禁与设计差异 | 已完成（G0本地准备） | 3 / 3 | P4-00R |
| P4-02 | 配置与默认关闭开关 | 已完成 | 3 / 3 | P4-01 |
| P4-03 | 五张 Evidence 表与空库 bootstrap | 已完成（声明/fixture） | 3 / 3 | P4-01 |
| P4-04 | 严格 DTO 与 Repository | 已完成（本地fixture） | 3 / 3 | P4-03 |
| P4-05 | capture 与创建事务接线 | 已完成（本地fixture） | 3 / 3 | P4-02、P4-04、P4-07 |
| P4-06 | 安全时间线与确定性窗口 | 已完成（fixture） | 3 / 3 | P4-01、P4-04 |
| P4-08 | 不可变 Manifest 与 revision | 已完成（本地fixture） | 3 / 3 | P4-05～07 |
| P4-07 | 全量受控查询渲染 | 已完成（fixture） | 3 / 3 | P4-01 |
| P4-09 | 三类观测后端客户端 | 已完成（mock） | 3 / 3 | P4-02、P4-07 |
| P4-10 | CURRENT 业务检查与 Run Event adapter | 已完成（mock） | 3 / 3 | P4-06～08 |
| P4-11 | coverage、predicate 与状态聚合 | 已完成（本地fixture） | 3 / 3 | P4-06、P4-09、P4-10 |
| P4-12 | 同步 report service 与 attempt | 已完成（本地fixture/mock） | 3 / 3 | P4-04、P4-08～11 |
| P4-13 | retention 前 Manifest 保全 | 已完成（本地fixture/mock） | 3 / 3 | P4-08 |
| P4-14 | Operator Manifest/report API | 已完成（本地fixture/mock） | 3 / 3 | P4-12、P4-13 |
| P4-15 | 分析笔记与审计/诊断 | 已完成（本地fixture/mock） | 3 / 3 | P4-04、P4-12、P4-14 |
| P4-16 | Evidence UI 与双语状态 | 已完成（本地fixture/mock） | 3 / 3 | P4-14、P4-15 |
| P4-17 | Compose/Kubernetes 配置与运行指引 | 已完成（K8s execution保持关闭） | 3 / 3 | P4-02、P4-13～16 |
| P4-18 | 综合回归与数据库验收 | 部分验收阻塞 | 2 / 3 | P4-05～17、环境资料 |
| P4-19 | canary、回退演练与阶段退出 | 阻塞 | 0 / 3 | P4-18、前置阶段门禁、用户决策 |

## 4. 分阶段交付门禁

| 门禁 | 任务范围 | 允许交付 | 不允许宣称 |
| --- | --- | --- | --- |
| G0：设计/前置核对 | P4-01 | 明确可复用代码、差异和阻断点 | Phase 3 外部 CI/canary 已完成 |
| G1：capture + Manifest | P4-02～08、P4-13 | 默认关闭的实现、纯函数/事务 fixture | 未验空库即可启用 capture |
| G2：受控实时 executor | P4-09～12 | mock provider 证明边界与错误语义 | 真实 metric/log/trace 一定存在 |
| G3：Operator 完整入口 | P4-14～17 | session/CSRF、UI、诊断和部署声明 | Kubernetes parity 或网络隔离已实测 |
| G4：空库与真实 pilot | P4-18～19 | 获批环境中记录真实复查和回退证据 | fixture 等同 canary 或阶段退出 |

后续开发可以准备默认关闭的代码，但不能越过启用门禁。P4-19 的 Phase 3 环境阻断解除前，不能扩大为真实场景执行。

## 5. 详细任务

除明确给出的 infra/docs 路径外，下列 `src/**` 均位于 `traffic-control-plane`。每组子任务包括相应的最小单元/fixture 验证；综合环境验收另列于 P4-18/P4-19。

### P4-00：建立任务清单

- [x] **P4-00.1** 读取产品规格、技术设计 v1.6、Phase 3 交接与现有 seam，区分已实现底座和未实现完整运行时。
- [x] **P4-00.2** 拆分任务、依赖、验收、问题处理规则，建立可持久更新的总体与分组进度。
- [x] **P4-00.3** 将任务清单接入产品、技术设计和 implementation 索引，记录首次执行更新。

完成证据：本清单及配套导航；没有新增运行时代码，也没有启用 flag。

### P4-00R：覆盖复审与设计决策

- [x] **P4-00R.1** 审查设计/任务/实际 DSL，确认 baseline、历史执行协议、predicate/聚合、幂等、历史入口和 Gateway 限制七项缺口及三项未定边界。
- [x] **P4-00R.2** 通过提问取得五项用户行为决策，落入 tech v1.7、产品和阶段边界；不修改 Phase 3 DSL 或运行代码。
- [x] **P4-00R.3** 更新实现任务、依赖、问题映射和验收；同步计数/执行记录，保持运行时 0/57。

### P4-01：前置门禁与设计对齐

- [x] **P4-01.1** 核对阶段 0～3 清单和现有 Coordinator、Repository、owner/drain/action journal，记录缺失前置证据；明确已有 `PREPARE_STARTED`/`STOP_REQUESTED` 是否可复用，不重复写事件。
- [x] **P4-01.2** 对齐设计中仍描述旧代码的段落、模块名和 schema 列；snapshot 复用 `evidence-contract-snapshot.ts`，DSL 只从 Phase 3 import，renderer 扩展已有 seam，禁止镜像定义。
- [x] **P4-01.3** 记录 12 场景 template/source/read-check 覆盖和 flags 生效边界；任何实质设计冲突先登记并提问。验收为代码/设计映射及明确的 G0 结论，不默认前置环境门禁已通过。

2026-10-09 G0覆盖核对：通过`listScenarioDefinitions()`读取12场景，全部声明RUN_EVENT、Prometheus、Loki和Tempo；3场景有CURRENT检查，仅使用Catalog已声明的两个正常GET；当前使用17种template（11 Prometheus、1 Loki、2 Tempo、2 BUSINESS_CHECK、1 RUN_TIMELINE），现有renderer只支持其中3项Prometheus。active遥测可派生63个baseline item，数量来自本次Catalog投影，不是新的可变事实源。`scenario-contract.test.ts`及两个Evidence seam测试13/13通过；仅允许default-off本地实施，不解锁真实CI/DB/canary。

### P4-02：配置与开关

- [x] **P4-02.1** 实现 capture、query、execution 三个默认 `false` 开关；固定 source origin、credential 与 retention 配置；区分 Web 查询配置和 Worker retention 需要的能力。
- [x] **P4-02.2** 校验 source/total timeout、report/recipe/source concurrency、response cap；禁止空 URL 回退到公网、Grafana 或浏览器 endpoint，拒绝 userinfo/不合法 origin。
- [x] **P4-02.3** 添加配置负向测试与 kill-switch 契约：capture 关闭不要求 snapshot；query/execution 关闭不改变运行生命周期；Worker 不需要观测凭据。若配置所有权与最新 Web-only 约定冲突，先提问解决。

### P4-03：schema 与 clean-bootstrap

- [x] **P4-03.1** 实现 snapshot、Manifest、attempt、attempt item、note 五张表；snapshot 增加独立 rendered plan/version/hash/硬上限，attempt 增加 run-scoped key/requestHash/deadline，note 增加 run-scoped key/requestHash；不建 telemetry result/raw error 列，不对 Fault Run 设置 cascade。
- [x] **P4-03.2** 检查实际编号，接入 runtime schema、下一顺序号 `src/lib/migrations`、fresh-install init 和已有 `db:verify`；不硬编码规划中的 `00N/0N`。
- [x] **P4-03.3** 添加 DDL/schema verifier fixture，证明两条空库 bootstrap 声明等价，非 clean schema fail fast；已有 volume upgrade 和实际 reset 均不在本任务授权范围。真实空库验收见 P4-18.2。

### P4-04：DTO 与 Repository

- [x] **P4-04.1** 新增 Manifest/window/attempt/note DTO 与 runtime JSON guard；直接复用 Phase 3 Evidence 类型，严格限制输出字段，校验 snapshot hash/revision。
- [x] **P4-04.2** 实现参数化 SQL、snapshot/plan hash 查询、Manifest revision 分配、按 ID/revision 的有界历史读取、run-scoped attempt/note idem 和 deadline CAS；并发同 timeline 只产生一个 revision，终态 item/attempt/audit 同事务。
- [x] **P4-04.3** 为并发冲突、非法 JSON、字段越界和 persistence allowlist 添加测试；拒绝保存 sample、log line、trace/span、business body、endpoint credential 或未校验 event payload。

### P4-05：capture 与创建事务

- [x] **P4-05.1** capture 开启时，同一创建事务保存 Evidence DSL/contractHash、Phase 3 contractRevision 原值、独立已渲染计划/renderer与evaluation版本/planHash及创建时硬上限；所有模板在 prepare 前渲染成功。P4-ISSUE-004。
- [x] **P4-05.2** 处理 flag 关闭、snapshot 校验/DB 失败与同部署幂等 replay；关闭时不 capture，失败时目标 prepare 尚未执行，replay 不补写或覆盖 snapshot。
- [x] **P4-05.3** 测试 Run/CREATED/DSL/rendered plan 同成同败；renderer 或 Catalog 改变后首次物化仍用冻结 query/上限，坏 hash/未知协议显式失败，不从当前模板重建；Gateway 不泄露 Evidence/revision。

### P4-06：时间线与窗口

- [x] **P4-06.1** 从受控 Run/event/action facts 投影时间线，按 `(created_at,id)` 排序并输出 UTC；缺失为 `null`，禁止从 `Date.now()`、流量首请求或成功 prepare 补造事实。用户2026-10-09确认首次STOP_REQUESTED与同attempt DRAIN_STARTED为固定canonical anchor，后续重试不移动。
- [x] **P4-06.2** 使用 frozen policy 解析四类窗口，校验硬上限；终态 failed/unavailable 的 active fallback 附限制，recovery/cleanup 缺失分别为 NOT_READY/NOT_APPLICABLE。
- [x] **P4-06.3** 测试四类恢复策略、UTC、同毫秒、missing anchor、clock-skew 和冻结上限；future tail 不移动 canonical window，查询已到达范围，标记 PARTIAL/INCONCLUSIVE，零长度不查询。P4-ISSUE-010。

### P4-07：固定查询渲染

- [x] **P4-07.1** 扩展现有 Prometheus renderer，覆盖 Catalog 实际使用的全部有限 templates；保留已批准的支付 5m 和 filesystem growth 15m 三项 seam，不复制 Catalog 阈值。
- [x] **P4-07.2** 实现 aggregate LogQL、TraceQL/CURRENT fixed plan 渲染，冻结单位/lookback/predicate解释/归约；从 active WINDOWED 遥测派生 baseline `(originId, baseline)`，不改 DSL 或新增阈值。
- [x] **P4-07.3** 测试 12 场景覆盖、escaping、labels、scope注入、planHash/版本、baseline 派生、不进入 effectRule；slow-request 秒阈值渲染为 duration filter，COUNT 是匹配 trace 数，不能比较数与秒。P4-ISSUE-003～005。

### P4-08：Manifest 物化

- [x] **P4-08.1** 终态 get-or-create 仅使用 persisted DSL/冻结渲染计划/上限和安全 timeline；hash 包含执行协议与schema版本，拒绝 active states，不调用当前 renderer 重建。
- [x] **P4-08.2** 实现并发幂等、递增 revision、cleanup 新 revision、旧 attempt 保持旧 Manifest；snapshot 缺失显式 unavailable，不按 revision 从当前 Catalog 重建。
- [x] **P4-08.3** 测试 hash/revision 稳定、plan 损坏/未知协议、retention后及历史 revision 读模型；source_run_retained 是 hash 外的可变元数据，旧 immutable core 不变，浏览不查询 source。P4-ISSUE-004、008。

### P4-09：观测客户端

- [x] **P4-09.1** 实现Prometheus/Loki range query、Tempo fixed TraceQL search typed adapters；service-side计算range/step，最多64 series/每series 1500 points、Tempo最多100结果并有界内存解析。用户2026-10-09确认series上限64。
- [x] **P4-09.2** 接入AbortSignal、总deadline配合、单source timeout、redirect拒绝、byte cap、content-type/JSON shape校验和最多一次受限重试；原始provider错误映射为稳定安全码。
- [x] **P4-09.3** mock测试编码、断连/429/5xx/timeout、无重试400/401/403、byte cap和malformed body；Tempo达到100/未完成/完整性未知输出SEARCH_INCOMPLETE/PARTIAL，不分页成无限查询，不假报精确总体或零。P4-ISSUE-011。

### P4-10：业务与事件 adapter

- [x] **P4-10.1** 固定两项正常 Gateway GET；复用/扩展 bounded read seam，同样执行signal/deadline/redirect拒绝/byte cap/content-type与业务 envelope guard，禁止无界 res.json()；无 runtime context/Operator凭据。P4-ISSUE-009。
- [x] **P4-10.2** 实现 Run Event adapter 与 CURRENT/WINDOWED 分离：CURRENT 附 `checkedAt`，不冒充历史效果、清理或窗口内恢复，不让 CURRENT 进入 effectRule。
- [x] **P4-10.3** 测试无直接service/写/active-context入口/body透传，以及超大/重定向/慢响应/HTTP200业务失败；不能把列表可达等同run-scoped cache或整条业务恢复。实际 GET 副作用与已批准边界冲突时暂停提问。

### P4-11：覆盖和判断规则

- [x] **P4-11.1** DB当前时间/retention/冻结lookback preflight，执行范围与 canonical 分离；future/缺sample/NaN/Inf/warning/截断降低coverage，全过期不查，不补零。baseline仅完整兼容数据作当前差值，零基线不计算百分比。
- [x] **P4-11.2** 实现单位一致的 active 任一/recovery 全部 predicate、ALL/ANY三态；controlFacts/telemetry/currentChecks 独立，历史遥测全不可用最终unavailable，timeline/CURRENT不掩盖，optional缺口仍partial。P4-ISSUE-005、006。
- [x] **P4-11.3** 验收ANY一项MET其余未知可OBSERVED但report PARTIAL，ALL一项NOT_MET其余未知为NOT_OBSERVED；partial单项始终未知，future/lookback/Tempo无伪FULL，baseline/NONE不进入effectRule。P4-ISSUE-003、010、011。

### P4-12：同步 report service

- [x] **P4-12.1** 编排 frozen Manifest、preflight、并发 semaphore 和总 deadline；只执行显式请求，不启动 Web 后台任务、evidence worker 或持久队列。
- [x] **P4-12.2** run-scoped key/requestHash在latest判断前lookup；相同signature metadata replay，异输入409，新revision使用新key；DB deadline固定total+5s，history/report请求CAS结算过期RUNNING为FAILED/EXECUTION_INTERRUPTED，不自动重查。
- [x] **P4-12.3** 测试容量、取消、deadline/late completion CAS、进程退出模拟、cleanup后旧key重试、新Manifest同key冲突、item/attempt/audit原子终态；没有queue/timer/source replay。P4-ISSUE-007、012。

### P4-13：retention 保全

- [x] **P4-13.1** 在现有 retention 事务/lease 删除前用同一 materializer 固定最新 Manifest，标记 `source_run_retained=false`，保留 snapshot/Manifest/attempt/note。
- [x] **P4-13.2** capture-off/无 snapshot 运行不补造历史合同；保留原 eligible 删除边界，不以 Evidence 改动扩大删除范围或触发 cleanup。
- [x] **P4-13.3** 测试并发 cleanup/retention、事务失败、source 删除后历史查询与 CURRENT check 分离、Worker 无 observability 请求/credential；真实 DB 行为在 P4-18.2 验收。

### P4-14：Operator API

- [x] **P4-14.1** 实现latest Manifest、manifests有界列表、指定Manifest详情、report history和POST；校验ID归属/hash，明确选择旧revision允许重查，源行删除后仍可读取，非终态/无snapshot明确失败。P4-ISSUE-008。
- [x] **P4-14.2** 保持 session、CSRF、confirmation、idempotency、body/分页限制和安全响应 headers；拒绝 query、URL、range、source、operation 等额外输入。
- [x] **P4-14.3** route测试401/403/400/404/409/422/429、unknownProtocol/unavailable、错误Manifest归属、idem异signature、指定旧revision重查与no-store；GET只物化/本地惰性结算，不执行source query。

### P4-15：Note、Audit 与诊断

- [x] **P4-15.1** append-only 2,048字符note，run-scoped key/signature去重、异正文/Manifest409；确定性显式凭据/HTML/导出拒绝不回显，不静默改正文，不承诺识别全部secret，不新增检测服务。P4-ISSUE-007。
- [x] **P4-15.2** note/idem/audit同事务，completion audit与attempt/item终态同事务；独立audit reference不覆盖Run，Pino/history只安全状态，不吞审计失败。
- [x] **P4-15.3** 添加 DB/audit/log/DTO 泄露负向测试和诊断运行指引；若要新增 metrics 依赖/端点，必须先提问取得决策，未获批时使用设计允许的 Pino/audit/history。

### P4-16：Operator UI 与 i18n

- [x] **P4-16.1** RunDetails EvidencePanel包含baseline/active对照、Manifest历史选择、实际执行范围/future/lookback限制，独立control/telemetry/CURRENT/效果状态；浏览不查source。
- [x] **P4-16.2** 显式选择ID/hash/key，网络重试保留原请求，不自动切latest；主动重查新key，metadata replay不冒充live summary；复制仅冻结recipe，不存storage/URL，不新增公共控制台。
- [x] **P4-16.3** 添加中英文、no-data/unavailable/unknown 状态、CURRENT checkedAt、访问性/复制/错误 UI 测试；仅当前 React memory 有 live summary，页面重载不显示伪历史结果。

### P4-17：部署声明与指引

- [x] **P4-17.1** Compose 配置三旗默认关闭、Web-only 内部 endpoints/凭据注入，Worker 仅 retention；README 记录 clean-slate 外部责任、复查边界、kill switch 和非快照语义。
- [x] **P4-17.2** Kubernetes Web config/专用 Secret 引用/最小 NetworkPolicy 声明同步；保留 DNS 和既有必需出站路径，不阻断正常 control-plane 能力，Worker 不获 query 凭据。
- [x] **P4-17.3** 核对 Loki retention、log shipping、Prometheus/Tempo 存储和实际 source capability；未完成 parity 不开启 K8s execution。新增采集器/PVC/认证方式等部署选择需提问，不自行升级基础设施。按 P4-ISSUE-018 用户决策保持关闭，不扩展基础设施。

### P4-18：综合验证

- [x] **P4-18.1** 执行改动范围对应的 Node tests、Contract/runbook/i18n、typecheck/lint、静态部署和术语边界检查；沿用现有工具，回归不能与修复无关的旧问题混做。
- [!] **P4-18.2** 在获批可丢弃数据库分别运行 init 与 db:migrate/db:verify 空库路径，验收创建事务、并发 Manifest/attempt、retention 保全。阻塞：P4-ISSUE-001；没有环境授权/reset record 不执行实际 reset。
- [x] **P4-18.3** 综合验收本地fixture覆盖baseline派生、renderer变更后首次物化、冻结上限、ANY/ALL、telemetry全过期但timeline可用、future/lookback/Tempo截断、Gateway cap、历史revision/跨revision idem/note retry及中断CAS；明确记录这些fixture不是实测pilot，真实差异验收留在P4-19.2。

### P4-19：pilot、回退与阶段退出

- [!] **P4-19.1** 取得 Phase 3 门禁证据及用户批准的单 Worker、单 Operator、可丢弃 Compose 环境和 pilot 场景；capture-only 再 query/execution。阻塞：P4-ISSUE-001、P4-ISSUE-002。
- [!] **P4-19.2** 完成真实成功复查、同 Manifest 重查、每 source 故障/超时/retention 演练、kill-switch 与生命周期不受影响的回退证据；K8s 未就绪明确限定。阻塞：P4-ISSUE-001。
- [!] **P4-19.3** 汇总 12 场景合同/renderer coverage、真实 pilot、clean DB 和外部发布门禁，更新产品/技术/阶段文档；未满足前置及退出项不得转 5.0。阻塞：P4-ISSUE-002。

## 6. 问题与用户决策

### 6.1 已知阻断

| ID | 状态 | 影响 | 已知事实/恢复条件 | 需用户决策时的提问 |
| --- | --- | --- | --- | --- |
| P4-ISSUE-001 | 阻塞 | P4-18.2、P4-19.1～2 | Phase 3 清单仍缺环境访问、完整外部 reset record 和 disposable canary。P4-18.2要在目标DB验证fresh-bootstrap/migration/verify及事务并发行为；P4-19会运行真实场景/数据源/Gateway请求和回退演练。未获明确授权时不重置数据库、不接触真实source、不制造运行资源。获得批准且核实的可丢弃环境与记录后恢复 | 先确认要使用哪个可丢弃环境；之后再单独确认 reset record 和具体操作授权 |
| P4-ISSUE-002 | 阻塞阶段退出 | P4-19.1、P4-19.3 | Phase 3 外部 CI/canary/live rollback尚未全部关闭；P1 verification/P2 runtime限制保留，当前retention尚无手工清理eligible过滤；准备默认关闭代码不代表前置门禁通过 | 开启/发布前先核实门禁证据；若要求改变依赖或修复前置运行安全边界，先提问记录决策 |
| P4-ISSUE-018 | 已解决（2026-10-12） | P4-17.3、Kubernetes execution rollout | 用户选择保持 K8s Evidence query/execution 关闭，不扩展本批次基础设施。当前 K8s Prometheus/Tempo/Loki 均有 168h retention 声明但数据使用 `emptyDir`；无 log shipper，真实 source labels/TraceQL 未验证 | 未来若要补 collector、PVC、认证或变更网络权限，重新提问；当前仅记录差异 |

上述问题来自已记录的 Phase 3 状态，本次不擅自改变用户的暂缓决策。到达受影响任务时刷新事实，再通过提问确认。

### 6.2 复审问题与实施关闭门槛

以下问题的设计方案已落入 tech v1.7，状态为**设计已解决、待实施验收**。只有列出的实现/验收完成后才可标记关闭；不能因为本次文档调整已完成就声称能力已交付。

| ID | 缺口与处理方案 | 实施任务 | 最低关闭证据 |
| --- | --- | --- | --- |
| P4-ISSUE-003 | 派生baseline，仅作对照；用户2026-10-09确认，不新增相对阈值 | P4-07、11、16、18 | 实际执行同配方baseline；不改DSL/effectRule、不落库数值；baseline缺失限制、零基线与单位不兼容测试 |
| P4-ISSUE-004 | capture冻结query plan/版本/硬上限；用户2026-10-09确认 | P4-03～05、07、08 | 修改renderer/Catalog后首次物化仍用原query/上限；未知版本不重建；hash损坏失败 |
| P4-ISSUE-005 | 单位/归约及ALL/ANY三态；用户确认active任一、recovery全部 | P4-07、11、18 | 含ANY成员未知、ALL否定、COUNT/秒解释、多series/sample、NaN/gap的truth-table |
| P4-ISSUE-006 | 控制事实与历史遥测分离，optional缺口不隐藏 | P4-11、16、18 | 遥测全过期但timeline/CURRENT成功，最终仍unavailable；缺optional为partial |
| P4-ISSUE-007 | report/note run-scoped key、requestHash与事务audit | P4-03、04、12、14～16 | cleanup新增revision后旧request replay不二次查询；新输入同key409；note重试不重复 |
| P4-ISSUE-008 | 历史Manifest有界列表/详情与显式旧revision重查 | P4-04、08、14、16 | 旧attempt可定位旧protocol；retention后仍读；ID/hash/归属校验；不自动换latest |
| P4-ISSUE-009 | Gateway GET执行同等bounded read与envelope guard | P4-10、12、18 | 大body/慢响应/redirect/非法JSON/HTTP200业务失败测试；无无界res.json或body透传 |
| P4-ISSUE-010 | future先partial后主动重查；用户确认；lookback纳入retention/coverage | P4-06、07、09、11、16 | canonical不动、executed范围受限；5m/15m输入过期、未settled、零长度/gap不伪FULL |
| P4-ISSUE-011 | Tempo达到limit/搜索不完整为PARTIAL，不做精确否定 | P4-09、11、18 | 100条/未完成/完整性未知无精确总体或假零；无无限分页；完整空结果才可判断 |
| P4-ISSUE-012 | DB deadline、请求时CAS结算中断attempt；用户确认 | P4-03、04、12、14、18 | 无后台任务/自动source replay；late completion不能覆盖FAILED；idem replay仍同attempt |
| P4-ISSUE-013 | 2026-10-09用户确认safe-runtime以实际DRAIN_STARTED作recovery开始，STOP_REQUESTED仅受理；无事件为null | P4-01、06、13 | 对照已有event/action/projection；无重复恢复事件，不把202/release ack推为恢复 |
| P4-ISSUE-014 | 2026-10-09用户确认独立Web-only Evidence配置，Worker仅消费persisted records | P4-01、02、05、17 | Web instrumentation严格校验；shared env/Worker不解析query flag/凭据，default-off不改变lifecycle |
| P4-ISSUE-015 | 2026-10-09用户确认Loki只按Promtail已索引service/log_level查询；route/filesystem scope只保留为DSL上下文，不宣称被LogQL过滤，且Loki不得参与effectRule | P4-07、11、16、18 | frozen plan显示SERVICE_ONLY；固定LogQL仅用indexed labels；effectRule拒绝Loki；真实label/retention仍须pilot核验 |
| P4-ISSUE-016 | 2026-10-09用户确认safe-runtime多次重试仍固定首次STOP_REQUESTED及匹配attempt的DRAIN_STARTED，后续重试不移动canonical anchor | P4-06、08、11 | P4-06 timeline fixture验证首次attempt配对；P4-08 manifest/window fixture仍待完成 |
| P4-ISSUE-017 | 2026-10-09用户确认Prometheus/Loki每query最多接受64个series | P4-09、11、18 | mock证明65 series拒绝、64系列边界接受；配置不可超越该固定上限；真实后端pilot另验 |

### 6.3 仍需在执行现场确认的范围

五项核心行为选择已经获得用户确认；以下新增范围仍需到相应任务时提问，不因本次优化而自动批准：

| 检查点 | 首次处理任务 | 决策触发条件 |
| --- | --- | --- |
| note检测扩展 | P4-15 | 超出已有有界显式模式拒绝，要新增检测依赖/服务或改写正文 |
| feature metrics | P4-15 | 需要增加依赖、metrics route 或 scraper；未决策前使用现有诊断方式 |
| Kubernetes parity、Secret 与 network/storage | P4-17 | 2026-10-12用户决定保持执行关闭、不扩展基础设施；未来新增采集器/持久存储/认证或网络权限仍需提问 |
| destructive test 与 pilot 范围 | P4-18 / P4-19 | 要连接真实环境、reset 数据或运行有实际资源影响的场景 |

新的实质问题按下一个空闲编号（当前从 `P4-ISSUE-019` 起）递增，记录备选方案、推荐、风险、用户回答和落实证据。不要将此表的“检查点”当作已批准的新范围。

## 7. 验收与证据记录约定

每个任务完成的记录应采用以下字段，放在第 8 节，不另建未获请求的追踪文件：

| 字段 | 要求 |
| --- | --- |
| 日期与任务 | 实际 CST 日期、编号子任务 |
| 交付范围 | 已改文件/能力；未实现部分显式列出 |
| 验证 | 最小现有 test selector/命令、结果及模式（fixture/mock/真实 DB/真实 Stack） |
| 限制 | 无环境、未触发真实 effect、未验 K8s、未开 flags 等 |
| 问题/决策 | 对应 issue、用户回答日期和解决证据 |
| 下一步 | 当前可执行依赖和仍阻塞项 |

通常先运行改变模块的 `tsx --test` selectors，再按触及边界扩大到已有 `test:contract`、`test:runner`、`test:runbook`、`test:i18n`、typecheck/lint 和部署检查。新测试可以扩展既有 runner；未审批不引入新框架。文档-only 任务不运行应用构建。

真实 DB/Stack 验证必须记录环境的非敏感标识、授权/reset record reference、source/release revision、flag 和模式；不能把密码、cookie、service key、raw telemetry 或业务 payload 写入任务清单。

## 8. 执行更新记录

| 日期 | 任务 | 更新 | 完成证据/限制 |
| --- | --- | --- | --- |
| 2026-10-09 | P4-00.1～00.3 | 生成 v1.0 清单，建立 20 组/60 子任务、依赖、状态规则和决策登记；同步文档导航 | 按技术设计 v1.6 和实际 Phase 3 consumer seam 拆分；仅文档规划完成，运行时 0/57，未执行 DB reset、live query、canary 或发布 |
| 2026-10-09 | P4-00R.1～00R.3 | 覆盖复审和五项用户决策落入tech v1.7/task v1.1；补七项缺口和future/lookback、Tempo、中断attempt，新增问题003～012及关闭证据，修正capture依赖renderer | 21组/63子任务，文档6/63、运行时0/57；问题为设计已解决而非实现已关闭；未执行reset/live query/发布 |
| 2026-10-09 | P4-01.1 | 核对P0～P3清单和当前create/stop/action/recovery/retention代码；创建事务已写Run/CREATED contractRevision；STOP_REQUESTED已存在，safe-runtime实际恢复由Worker DRAIN_STARTED开始，PREPARE_STARTED未存在，owner模式可用PREPARE action.dispatchStartedAt | 7/63；P0观测/K8s、P1验证adapter、P2 runtime/DB、P3CI/cleanDB/canary限制继续保留；当前retention仍只按终态/recovery_result/7天过滤，不声称手工清理门禁已解决；无环境操作 |
| 2026-10-09 | P4-01.2 | 技术设计v1.8按当前源码对齐create事务、PREPARE action、stop受理、safe/legacy恢复、retention和schema编号；用户确认DRAIN_STARTED锚点及独立Web-only配置；snapshot/renderer复用现有seam，不重复写事件 | 8/63；P4-ISSUE-013/014方案已确认，具体runtime验收保留到P4-02/06；无source请求/DB mutation |
| 2026-10-09 | P4-01.3 | Catalog直接派生12场景/17种template/63 baseline候选；两种CURRENT正常GET边界保持，记录Web-only/capture-off和G0限制 | 9/63；`pnpm exec tsx --test src/lib/scenario-contract.test.ts src/lib/evidence-contract-snapshot.test.ts src/lib/evidence-query-prometheus-renderer.test.ts`13/13；本机Node24.14.0/pnpm10.27.0，Node22镜像/runtime验收仍待真实环境，未执行远端或reset |
| 2026-10-09 | P4-02.1 | 新增evidence-web-config纯解析/显式读取，三旗default-off、source origin/retention及成对凭据；Node instrumentation调用，Edge跳过；shared strict parsers抽为environment-values以保持env原行为 | 10/63；config+env聚焦15/15；Worker import子进程使用非法Evidence配置仍成功，Web bootstrap非法值失败；未实现snapshot写入、API/query或部署flags |
| 2026-10-09 | P4-02.2 | 校验source 100～8000ms、total 1000～20000ms且严格大于source、recipe1～4/report1～2、固定source并发2、body1KiB～1MiB、safe毫秒retention；reject URL userinfo/path/query/fragment/whitespace与不完整/控制字符凭据，错误不回显值 | 11/63；聚焦config+env16/16、pnpm typecheck及修改TS文件eslint通过；仅配置约束，source executor enforcement待P4-09/12 |
| 2026-10-09 | P4-02.3 | 增加test:evidence入口，README明确Web-only/default-off/未接线范围及配置边界；证明显式读取不缓存旧flags、Worker子进程不解析Evidence、Web启动非法配置失败和Edge跳过 | 12/63；config+Contract admission+Coordinator+WorkerRuntime聚焦40/40；typecheck/修改文件eslint已通过；真实query kill-switch/capture-off不写snapshot由后续接线任务验收，不宣称P4功能已启用 |
| 2026-10-09 | P4-03.1 | 新增evidence-schema五表声明，包含frozen plan/version/hash、run-scoped idem、deadline和执行范围；明确只存protocol/状态/判断，不含telemetry结果列、FK或cascade | 13/63；schema声明/metadata verifier fixture 6/6、typecheck及文件eslint通过；未向任何数据库执行DDL，真实空库验收仍P4-18.2阻塞 |
| 2026-10-09 | P4-03.2 | 使用确认空闲的006-evidence-query.sql和10-evidence-query-schema.sql，runtime SCHEMA_STATEMENTS并入同一DDL；migration runner required tables增加五表，db:verify接入只读columns/index/CHECK/FK verifier | 14/63；schema/migration聚焦12/12，runtime/migration/init逐语句规范化parity通过；不运行db:migrate/db:verify真实连接，不承诺existing-volume upgrade |
| 2026-10-09 | P4-03.3 | fixture覆盖缺字段/错误nullable/type/length/precision/default/unsigned/auto_increment、额外payload列、缺/非unique/重排/前缀idem索引、缺/未enforced/不匹配CHECK和任何FK；db:verify只读拒绝不修复 | 15/63；最终test:evidence26/26+existing migration5/5、typecheck和修改文件eslint通过；较早Evidence+env+repository+Coordinator+WorkerRuntime67/67、术语脚本通过。所有DB验证是fixture，P4-18.2真实空库/Node22运行与canary/CI继续阻塞 |
| 2026-10-09 | P4-04.1 | 新增严格Manifest/window/attempt/item/note DTO与JSON/SQL timestamp parser；Phase 3 scenario-contract输出owner-owned enum values和Evidence plan runtime guard，snapshot parser验证完整contractRevision、contractHash、renderer/evaluation版本和rendered-plan hash | 16/63；`pnpm test:evidence`34/34、Contract validator/scenario-contract26/26、typecheck/相关eslint通过；所有fixture，无DB连接 |
| 2026-10-09 | P4-04.2 | 新增参数化 `SqlEvidenceRepository`：snapshot持久化/严格回读、run→snapshot锁序、终态Run门禁、Manifest hash与revision幂等/历史查询、run-scoped attempt/note requestHash、audit事务、DB deadline CAS惰性结算及terminal items写入原子性；attempt items 必须匹配 frozen Manifest recipe/source/window | 17/63；`pnpm test:evidence`42/42、`pnpm test:contract`87/87、migration fixture 5/5、typecheck与相关eslint通过。并发SQL锁语义仅由fixture建模，未连接MySQL；真实空库/并发DB验收仍属P4-18.2 |
| 2026-10-09 | P4-04.3 | 增加相同timeline并发物化、损坏存储JSON显式失败、非法recipe拒绝及item/audit/attempt事务回滚与persistence allowlist测试；DTO测试覆盖字段越界和原始遥测字段拒绝 | 18/63；最终`pnpm test:evidence`44/44、typecheck、相关eslint、`git diff --check`通过。均为本地fixture，未写真实DB、未触发source查询；阶段退出仍受P4-18/19阻塞 |
| 2026-10-09 | P4-05.1→P4-07.1 | 检查创建事务接线前置，发现当前固定 Prometheus renderer 仅支持3/11个Catalog使用模板；按清单依赖停止capture接线，P4-05.1标阻塞并转入P4-07.1；没有提交不完整snapshot或改变运行行为 | 18/63，实施完成仍12/57；P4-ISSUE-004设计已定但需P4-07全部模板先验收；无数据库连接、prepare请求或 flag 启用 |
| 2026-10-09 | P4-07.1 | 扩展固定 Prometheus renderer 覆盖Catalog全部11种模板：HTTP P99/error/rate、Hikari/JVM、MySQL/Redis、filesystem ratio，并保留payment与15m filesystem-growth query；仅从固定template及校验scope构造PromQL，阈值原样保留在Catalog predicate | 19/63；renderer selector 7/7、typecheck、修改TS文件eslint通过；表达式与现有Prometheus规则/采集service label对照，fixture级别，无真实source查询。Loki/Tempo及综合报告renderer仍未实现，P4-05.1继续等待P4-07 |
| 2026-10-09 | P4-07.2 | 新增版本化Evidence plan renderer，统一固化11种Prometheus、aggregate LogQL、TraceQL、CURRENT check与Run Event；冻结units/lookback/aggregation/predicate及max window，并从active windowed telemetry生成同query的baseline对照；runbook复用同一TraceQL renderer。按用户确认，Loki plan新增`scopeMode=SERVICE_ONLY`，只查Promtail已索引service/log_level且不进effectRule；TraceQL slow duration保留秒级filter，输出predicate比较count>0。修复已有Catalog recipe ID最长112而Phase 3/runtime及DDL上限仅96的问题，统一支持128 | 20/63；`pnpm test:evidence`54/54、`pnpm test:contract`90/90、`pnpm test:runbook`13/13、typecheck、相关eslint、`git diff --check`和terminology script通过。仅fixture/本地配置事实，未查询真实source或数据库；P4-07.3仍未关闭，P4-05.1继续等待P4-07 |
| 2026-10-09 | P4-07.3 | 覆盖全部12个Catalog scenario的rendered plan与snapshot序列化/hash/revision；验证baseline只由active windowed telemetry派生且predicate为NONE、CURRENT/Run Event不查询、Loki SERVICE_ONLY且不进effectRule、TraceQL秒阈值转duration filter并按count>0判断、PromQL/TraceQL escape与非法scope拒绝 | 21/63、15/57；`pnpm test:evidence`56/56、`pnpm test:contract`90/90、`pnpm test:runbook`13/13、typecheck、修改文件eslint、diff/terminology通过。均为本地fixture，未执行source query或DB。P4-ISSUE-015语义已按用户决定编码，真实labels/retention仍需pilot |
| 2026-10-09 | P4-05.1 | Web/API创建请求按独立capture flag决定是否渲染，协调器验证该Resolved Contract revision与Admission一致，完成全Catalog query plan/版本/hash/max-window；`createFaultRun`在同一MySQL connection/transaction内依次写Run、CREATED、frozen snapshot及可选execution/action，snapshot写入失败走原事务rollback；重复key命中Run后不会执行snapshot insert | 22/63、16/57；新增Coordinator capture/replay与render-failure-before-create fixture、Operator route开关来源测试；`test:evidence`56/56、Coordinator+route+config 33/33、typecheck、相关eslint通过。未连接MySQL；完整Run/CREATED/snapshot提交或回滚的数据库验收仍由P4-05.3/P4-18.2负责 |
| 2026-10-09 | P4-05.2 | Web route仅读取服务端capture flag（不接受body开关）；默认false不附snapshot；同key重放不因flag变化补写或替换既有snapshot；snapshot准备/持久化异常在`store.create`前后都不会触发target prepare或成功返回 | 23/63、17/57；Coordinator+route+config聚焦35/35、`pnpm test:evidence`56/56、typecheck、相关eslint和diff-check通过。持久化异常由memory fixture模拟；MySQL事务rollback仍待P4-05.3/P4-18.2实测 |
| 2026-10-09 | P4-05.3 | Fake PoolConnection证明Run、CREATED、snapshot共用同一transaction，写snapshot/校验失败均回滚Run/event/sequence；idempotent replay不重复snapshot；全Catalog snapshot renderer/evaluation版本和hash稳定，严格拒绝unknown renderer；Gateway prepare payload无Evidence/revision字段 | 24/63、18/57；创建coordinator+repository聚焦32/32、`test:evidence`57/57、typecheck、相关eslint通过。均为fixture，真实空库、并发/ crash atomicity仍P4-18.2阻塞 |
| 2026-10-09 | P4-06.1决策与实现 | 用户确认safe-runtime重试固定首次STOP_REQUESTED与同attempt首次DRAIN_STARTED，后续retry不移动canonical anchor；实现纯时间线投影，仅读取排序后的event时间、PREPARE dispatch_started_at和经验证recovery projection，不复制payload；legacy只使用明确RECOVERY_STARTED/SERVICE_RECOVERED | 25/63、19/57；timeline fixture5/5、`pnpm test:evidence`62/62、`pnpm test:runner`通过、typecheck/相关eslint、diff及terminology通过。未读取真实数据库；P4-ISSUE-016的Manifest/window后续验收保留P4-08 |
| 2026-10-09 | P4-05.3 | 将事务创建逻辑抽为可fixture验证的`persistFaultRunCreateTransaction`；Fake PoolConnection证明Run、CREATED、snapshot同连接并同成同败、同key replay不重复snapshot；未知renderer protocol导致快照校验失败并回滚sequence/Run/event；冻结计划变动不影响已序列化query/hash，Gateway prepare payload不含Evidence或contract revision | 24/63、18/57；`fault-run-coordinator`+`fault-run-repository` 32/32，`test:evidence`57/57、typecheck、相关eslint通过。全为本地fixture，无真实MySQL连接；实际空库、锁和crash atomicity仍由P4-18.2验收 |
| 2026-10-09 | P4-06.1阻塞 | 开始安全timeline projector fixture；发现safe-runtime允许多个recovery attempt，而设计只指定DRAIN_STARTED来源但未明确重试时锚点固定到首次attempt还是最终attempt；暂不关闭任务或固化该边界 | 24/63、18/57；timeline/event/action投影测试5/5、Evidence suite62/62、typecheck及相关eslint通过；尚未接入Manifest/API，重试anchor等待P4-ISSUE-016用户决策 |
| 2026-10-09 | P4-06.2 | 新增frozen-policy窗口解析器，从cleanup RUN_TIMELINE recipe派生适用性；解析baseline/active/recovery/cleanup UTC范围、terminal fallback limitation、NOT_READY/NOT_APPLICABLE及`CLOCK_SKEW_TOLERANCE_60S`，不裁剪/移动边界，反向/超hard limit显式失败；保留零长度READY供query layer决定不查询 | 26/63、20/57；window fixtures6/6覆盖四类、12场景hard cap、fallback、cleanup语义、clock skew与zero-length；`pnpm test:evidence`68/68、typecheck、相关eslint、diff/terminology通过。均为fixture，无source/DB访问；P4-06.3仍待完成 |
| 2026-10-09 | P4-06.3 | 测试首次stop attempt锚点及同毫秒`(created_at,id)`排序、recovering/legacy/terminal event正确性、缺失/失败projection不补造时间；新增future-tail execution planner，只查询已到达正长度范围、保留canonical end并标PARTIAL/INCONCLUSIVE，zero-length/not-ready不发query | 27/63、21/57；`pnpm test:evidence`70/70、`pnpm test:runner`通过、typecheck、相关eslint、diff/terminology通过。仅fixture，无真实MySQL/source query；Manifest窗口接线与窗口revision仍待P4-08 |
| 2026-10-09 | P4-08.1 | 新增`createEvidenceManifestDraft`仅从持久化snapshot与安全timeline生成窗口/limitations/recipe；`getOrCreateManifestForRun`同事务锁Run→snapshot、读取Event/PREPARE dispatch事实、验证Run scenario/contractRevision与snapshot一致，再物化/回读Manifest；active/missing Run拒绝，旧action表缺失只使prepare anchor为null，不触发当前renderer | 28/63、22/57；Manifest materializer fixture验证自定义frozen query被保留、Run Contract错配/active Run拒绝、lock顺序与cleanup NOT_APPLICABLE；`test:evidence`73/73、typecheck、相关eslint通过。Fake MySQL协议，无真实DB连接；真正并发锁与部署schema验收仍留P4-18.2 |
| 2026-10-09 | P4-08.2 | 新增materializer路径并发get-or-create幂等、cleanup事件生成revision 2；旧Manifest仍可按ID读取，已经创建的attempt继续引用revision 1；无capture snapshot时显式NOT_FOUND且不从Catalog重建 | 29/63、23/57；evidence repository fixtures覆盖同timeline并发、cleanup后新revision、old attempt linkage、active state和missing snapshot；`test:evidence`75/75、typecheck、相关eslint通过。无实际MySQL并发/retention DB操作 |
| 2026-10-09 | P4-08.3 | 覆盖Run/snapshot revision错配、active/missing Run、缺失snapshot、corrupt/unknown renderer拒绝；验证source_run_retained变化不改Manifest hash/recipes、历史详情不查fault_runs、旧attempt保留原revision | 30/63、24/57；`pnpm test:evidence`76/76、typecheck、相关eslint与diff/terminology通过。历史/retention均为fixture，未删除真实Run、未连接MySQL；P4-08整组数据库/并发部署验收继续受P4-18.2阻塞 |
| 2026-10-09 | P4-09.1 | 新增固定Prometheus/Loki range与Tempo `/api/search` TraceQL typed adapter；服务端按canonical range算step≥15s；固定64 series、1500 points/series、100 Tempo hits，输出只含数值sample/duration，不保留labels、trace IDs或body；Loki只允许SERVICE_ONLY | 31/63、25/57；固定path/参数/URL encoding、query范围、64/65 series、Tempo100 truncated mock覆盖。未访问真实endpoint |
| 2026-10-09 | P4-09.2 | 所有fetch采用GET/no-store、AbortSignal、per-source timeout、manual redirect拒绝、streaming byte cap、JSON content-type/shape检查、稳定安全错误码；最多一次重试仅对timeout/network/429/502/503/504，取消不重试，400/401/403及500不重试 | 32/63、26/57；response cap、timeout abort、retry/no-retry mock覆盖；响应错误不回传body/credential；整体report deadline由调用方AbortSignal约束，未真实请求source |
| 2026-10-09 | P4-09.3 | 完成编码/断连/429/5xx/timeout、认证、malformed body、series/point/body cap及Tempo达到100条截断fixture；不做Tempo无限分页，保留truncated标志供后续聚合为SEARCH_INCOMPLETE/PARTIAL | 33/63、27/57；最终`pnpm test:evidence`84/84、typecheck、修改文件eslint、`git diff --check`和runtime terminology通过。全部mock，无Prometheus/Loki/Tempo凭据或真实网络访问；P4-ISSUE-017实现验收完成，Pilot事实仍待P4-18 |
| 2026-10-09 | P4-10.1 | 扩展GatewayClient专用bounded GET seam，仅允许Catalog固定商品列表/浏览报表路径和静态分页参数；stream cap/content-type/JSON校验在解析前执行，拒绝redirect；CURRENT检查只返回PASS/FAIL/NO_DATA+checkedAt，不回传商品/报表正文 | 34/63、28/57；`pnpm test:evidence`93/93、Gateway business adapter/client fixtures 8/8、`pnpm test:runner`通过、typecheck、全改动TS ESLint、diff/terminology通过。只使用mock，未发真实Gateway GET；P4-ISSUE-009需在pilot验证实际envelope/副作用 |
| 2026-10-09 | P4-10.2 | 新增Run Timeline/CURRENT适配器：Timeline facts仅提供safe anchors/window availability且永不predicate判定；CURRENT结果保留checkedAt和状态，显式标记isHistorical=false/effectRuleEligible=false并拒绝被effectRule引用 | 35/63、29/57；`pnpm test:evidence`96/96、`pnpm test:runner`通过、typecheck、ESLint与diff/terminology通过。全部fixture/mock，不发Gateway请求；P4-10.3继续覆盖边界负例 |
| 2026-10-09 | P4-10.3 | 完成Gateway allowlist、固定query参数/no body/no Runtime context、HTTP200业务失败Envelope、NO_DATA与bounded response/timeout/redirect/slow failure覆盖；验证业务列表可达仅是CURRENT PASS，不成为历史恢复或effect predicate | 37/63、31/57；`pnpm test:evidence`96/96、Gateway adapter/client fixtures通过、`pnpm test:runner`通过、`pnpm test:contract`90/90、`pnpm test:runbook`13/13、typecheck/ESLint/diff/terminology通过。全部mock，无真实Gateway请求；P4-ISSUE-009真实网络/read-only副作用仍待P4-18 pilot |
| 2026-10-09 | P4-11.1 | 新增基于单次MySQL CURRENT_TIMESTAMP的lookback/retention preflight，canonical window不移动，实际执行范围裁定在retention+lookback且end不超过DB now；实现series/sample gap、NaN/Inf、provider warning/truncation coverage与INCONCLUSIVE提示；baseline仅完整兼容NUMERIC同字段对照，COUNT并列、零基线省略percentage | 38/63、32/57；`pnpm test:evidence`109/109覆盖preflight/coverage/baseline、`pnpm test:contract`90/90、`pnpm test:runbook`13/13、`pnpm test:runner`通过、typecheck/ESLint/diff/terminology通过。没有发真实MySQL/Prometheus/Loki/Tempo请求 |
| 2026-10-10 | P4-11.2 | 完成单位一致的 active 任一/recovery 全部 predicate 与 ALL/ANY 三态聚合；control facts、historical telemetry、CURRENT 检查分离，telemetry 全不可用时不被 timeline/CURRENT 掩盖 | 39/63、33/57；`pnpm test:evidence`116/116与`pnpm typecheck`通过；实现和断言均为本地fixture/mock。同步 report service 尚未接线，未连接MySQL或观测后端 |
| 2026-10-10 | P4-11.3 | 增加ALL/ANY完整组合表、partial单项保持INCONCLUSIVE、ANY命中与optional coverage gap并存仍报告PARTIAL、baseline/NONE不进入effect outcome、Tempo不完整搜索不产生精确判断的回归验收 | 40/63、34/57；`pnpm test:evidence`116/116与`pnpm typecheck`通过；preflight/lookback/future和Tempo coverage由mock fixtures覆盖。未连接MySQL、真实观测后端或Gateway；report service仍待P4-12 |
| 2026-10-10 | P4-12.1 | 新增只接受typed frozen Manifest/其持久化snapshot的同步executor，校验二者合同/hash/渲染recipe一致；一次DB clock驱动所有preflight，执行受限query/CURRENT adapter、按recipe与source semaphore调度、进程级报告限流、AbortSignal取消和总deadline，超时缺项安全投影为REPORT_DEADLINE_EXCEEDED；导出共享Web service getter但不从Worker调用 | 41/63、35/57；`pnpm test:evidence`121/121、`pnpm typecheck`、新增TS文件ESLint通过。仅fixture/mock，无数据库/source/Gateway真实请求；route、attempt持久化及history deadline CAS待P4-12.2～14 |
| 2026-10-10 | P4-12.2 | 接入显式attempt执行：在live source调用前创建run-scoped幂等attempt/audit，同签名replay仅返回metadata，未查询latest或重新执行；不同Manifest revision复用key拒绝；attempt终态与status-only items同事务完成，取消写FAILED/EXECUTION_CANCELLED。报告请求先CAS结算过期RUNNING记录；固定DB deadline=total timeout+5s | 42/63、36/57；report service+repository聚焦24/24、typecheck及四个修改TS文件ESLint通过；Fake DB fixtures验证原子回滚、old-key replay、新revision冲突、deadline CAS。无真实MySQL连接，完整容量/中断边界归P4-12.3 |
| 2026-10-10 | P4-12.3 | 补齐同步执行链容量拒绝、per-source并发上限、总deadline abort/超时缺项、主动取消终态、同签名不重查、deadline后迟到完成拒绝、进程中断惰性CAS、Manifest revision变化时旧key replay/新revision冲突及attempt item/audit事务回滚验收 | 43/63、37/57；`pnpm test:evidence`125/125、`pnpm typecheck`、全部修改Evidence TS ESLint、`git diff --check`及runtime terminology通过。全部本地fixture/mock；无真实MySQL、source/Gateway请求或持久后台队列 |
| 2026-10-10 | P4-13.1 | 抽取可复用的transaction-bound终态Manifest materializer；Worker retention在同一删除事务和lease内锁定eligible source row/snapshot、物化最新Manifest并标记`source_run_retained=0`，之后才删除event/run。无snapshot legacy run显式跳过，不重建合同 | 44/63、38/57；新增Repository fixture验证复用安全timeline/持久化recipe、caller transaction内物化及mark；`evidence-repository`+`fault-run-repository`聚焦30/30、typecheck/相关ESLint通过。未执行真实retention或DB transaction |
| 2026-10-10 | P4-13.2 | 核对并测试捕获缺失时不物化Manifest；保留原7天、终态、recovery_result和100条批次eligible条件及既有event/audit/run删除集合；无Evidence表时不做运行时DDL并保持legacy删除，partial schema阻止删除，不触发cleanup/observability请求 | 45/63、39/57；retention helper fixture验证capture/legacy与schema缺失/partial分支、Manifest失败时DELETE未开始、eligible SQL边界不扩张；聚焦30/30、typecheck/ESLint通过。无真实DB或Worker运行 |
| 2026-10-10 | P4-13.3 | 验收retention与并发Manifest/cleanup事实共用source-run锁、唯一revision和失败回滚；历史Manifest读取不依赖source run行，CURRENT通过独立adapter；Worker retention只接收Evidence保存repository seam，不持有provider client；DB表只读探测，不创建observability schema | 46/63、40/57；`pnpm test:evidence`129/129、`pnpm test:runner`355/355、typecheck/修改TS ESLint、`git diff --check`和runtime terminology通过。都是fixture/mock，未连接MySQL、启动真实Worker或调用观测/Gateway |
| 2026-10-10 | P4-14.1 | 新增latest Manifest、有界历史列表、指定revision详情、report history和显式POST report路由；read-only只解析独立Web query flag，source-run/id/hash归属由Repository约束；legacy/no-snapshot与retained source行为固定；POST不查latest，直接复用run-scoped幂等service | 47/63、41/57；API handler、middleware和repository聚焦37/37、typecheck及相关ESLint通过。返回只含Manifest或attempt/status item DTO并设置no-store；全为mock，没有真实DB/source/Gateway请求，状态矩阵和边界安全继续P4-14.2/.3 |
| 2026-10-11 | P4-14.2 | 完成Operator session与CSRF边界、report confirmation/idempotency key、4 KiB exact-key JSON、严格分页/查询参数白名单及统一no-store/no-cache/no-referrer响应；未认证Evidence响应同样禁止缓存 | 48/63、42/57；`evidence-api-route-handlers.test.ts` 8/8、对应ESLint通过。只做本地 handler/middleware 测试，无真实数据库/source/Gateway访问 |
| 2026-10-11 | P4-14.3 | 完成API状态矩阵与历史revision/归属测试；固定401/403/400/404/409/422/429响应，未知冻结协议映射`422 INVALID_QUERY`，legacy无snapshot显式返回`EVIDENCE_UNAVAILABLE`；报告只执行显式选择的旧Manifest，不隐式解析latest；GET只读取/物化metadata，不访问source | 49/63、43/57；`pnpm test:evidence` 138/138、`pnpm test:runner` 356/356、typecheck、相关ESLint、`git diff --check`和runtime terminology通过。全为本地fixture/mock，无真实MySQL、观测后端或Gateway请求；P4-18/19环境门禁未通过也未执行 |
| 2026-10-11 | P4-15.1 | 将既有事务型 append-only note repository 接入有界 notes GET/POST；新增 UTF-8 byte cap、仅换行归一、明确凭据/HTML/JSON及NDJSON导出拒绝、固定拒绝码不回显；校验run-scoped幂等409、CSRF、cursor与no-store | 50/63、44/57；`pnpm test:evidence` 145/145、`pnpm test:runner` 356/356、typecheck、相关ESLint、`git diff --check`和runtime terminology通过。策略仅拒绝确定性可识别内容，不声称覆盖任意纯文本secret；全为mock/本地测试 |
| 2026-10-11 | P4-15.2 | 验收 note/idempotency/audit 创建共事务、attempt与终态/items/audit原子更新、audit reference独立且不更新Fault Run；审计insert/update失败均显式传播并回滚note/attempt状态，报告审计不复制正文或查询载荷 | 51/63、45/57；`evidence-repository.test.ts` 20/20、typecheck、相关ESLint通过。采用Fake DB事务语义，没有连接真实MySQL |
| 2026-10-11 | P4-15.3 | 补齐固定 API envelope 不回显原始 provider exception、attempt item/audit字段白名单与 note 正文不进入 audit 的泄漏负测；新增安全诊断指引，明确默认关闭、GET副作用边界、status/reason/audit/history排查路径；不添加 Evidence Pino日志、metrics或新依赖 | 52/63、46/57；`pnpm test:evidence` 146/146、typecheck、相关ESLint、`git diff --check`和runtime terminology通过。日志边界通过实现审查（Evidence模块不写Pino）；mock/fixture验收，未连接真实服务 |
| 2026-10-11 | P4-16.1 | 在 RunDetails 集成双语 EvidencePanel，显示bounded Manifest/attempt/note metadata、历史revision、规范与实际执行窗口、baseline/active兼容对照、CURRENT检查、限制和彼此分离的control/telemetry/effect状态；只发no-store GET、不执行报告；使用字段allowlist并在1MiB body上限内解析 | 52/63、46/57；`pnpm test:i18n` 26/26、`pnpm typecheck`、相关ESLint和`pnpm build`通过；review发现并修复history identity/item pairing、baseline compatibility和response cap问题。全为mock，无真实DB/source请求 |
| 2026-10-11 | P4-16.2 | 接入二次确认的report POST与明确note表单；新请求固定选中Manifest/hash并生成key，网络重试复用原body/key，不自动切latest；live summaries/差值/effect只在POST响应和React memory，history只保留metadata；复制仅frozen query，不进URL/storage；attempt/item DB仍只写status。完成full-coverage baseline numeric对照、COUNT并列和同timestamp多series latest=max | 53/63、47/57；`pnpm test:evidence` 148/148、`pnpm test:i18n` 30/30、`pnpm test:runner`通过、typecheck、相关ESLint、`pnpm build`、`git diff --check`和runtime terminology通过。review发现并修复source-run切换状态、note retry草稿、重复items、baseline/summary交叉校验、finite overflow与空Tempo full-count一致性；均为fixture/mock，无真实DB/source/Gateway请求 |
| 2026-10-11 | P4-16.3 | 完成双语 no-data/unavailable/unknown/effect 状态区分、CURRENT checkedAt、loading/alert/label/aria-busy、copy成功/失败与安全错误码回归；页面重载只显示metadata history，不伪造数值或effect结果 | 54/63、48/57；`pnpm test:i18n` 33/33、`pnpm test:evidence` 148/148、`pnpm test:runner`通过、typecheck、相关ESLint、`pnpm build`、`git diff --check`和runtime terminology通过。生产构建仅报告既存、无关的Worker unused import warning；mock/fixture验收，无真实DB/source请求 |
| 2026-10-12 | P4-17.1 | Compose Web/API 显式声明三项默认关闭 flag、内部 Prometheus/Loki/Tempo origins、可选成对认证及 bounded budgets/retention；Worker 未注入 EVIDENCE_* 变量。README更新 capture/query/execution区别、显式查询触发、restart kill switch、no-snapshot及 clean-slate 责任 | 55/63、49/57；`docker compose config --quiet`通过，解析后的三个flags均为false、source目标为内部service名且Worker evidence key为空；`git diff --check`和runtime terminology通过。未启动服务、未触发capture/report、未访问DB/source |
| 2026-10-12 | P4-17.2 | 新增 Web-only K8s Evidence ConfigMap 与专用空credential Secret refs；Worker不读Evidence config/secret。添加仅选择Web/API的egress NetworkPolicy，允许kube-system DNS、MySQL、Redis、Gateway、restart broker、Prometheus/Alertmanager、Loki、Tempo OTLP/query固定端口；README提醒NodeLocal DNS须按CNI核验，K8s query flags保持关闭 | 56/63、50/57；`kubectl kustomize k8s`、Web/Worker manifest client-side parse、`git diff --check`和runtime terminology通过。未apply manifest、未访问集群/数据源；K8s Loki retention/log shipping parity仍待P4-17.3 |
| 2026-10-12 | P4-17.3 | 静态核对K8s source parity：Prometheus/Tempo/Loki均声明168h retention但使用emptyDir；未声明log shipper；真实metric/label/TraceQL能力无法由本地模板证明。用户确认本批次不扩展基础设施，保持K8s query/execution关闭 | 57/63、51/57；`kubectl kustomize k8s`通过；本地静态核对，无集群访问/部署/source query。P4-ISSUE-018已解决；任何未来collector/PVC/auth/network变更需重新提问 |
| 2026-10-12 | P4-18.1 | 完成本批次本地综合回归：Evidence、Contract、runbook、runner、i18n、typecheck/lint、Compose/Kustomize、runtime terminology与diff边界；真实MySQL/source/Gateway/pilot仍另属18.2/19门禁 | 58/63、52/57；`test:evidence` 148/148、`test:contract` 90/90、`test:runbook` 13/13、`test:i18n` 33/33、`test:runner`通过、typecheck/lint、`pnpm build`、`docker compose config --quiet`、`kubectl kustomize k8s`、`git diff --check`和runtime terminology通过。lint/build只有既存Worker unused import warning；所有运行时测试为本地fixture/mock |
| 2026-10-12 | P4-18.3 | 复核本地跨层fixture矩阵覆盖 baseline/render冻结/上限/truth-table/retention与lookback/future/Tempo/Gateway/manifest和同key新revision/note retry/deadline CAS；明确fixture不是实测pilot | 59/63、53/57；`test:evidence` 148/148、`test:contract` 90/90、`test:runbook` 13/13、`test:i18n` 33/33、`test:runner`通过。未连接真实MySQL、source、Gateway或pilot；实测留P4-19.2 |
