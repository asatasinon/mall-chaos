# 批次 4：实时 Evidence Query 实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | 任务清单已生成；完整 Phase 4 运行时未开始；真实环境验证与阶段退出阻塞 |
| 版本 | 1.0 |
| 更新时间 | 2026-10-09 CST |
| 产品规格 | [product.md](./product.md) |
| 技术设计 | [tech.md](./tech.md)，当前 v1.6 |
| 路线阶段 | [阶段 4](../../roadmap/phases/phase-4-evidence-query.md) |
| 前置清单 | [批次 3 任务清单](../batch-3-scenario-contract/task-list.md) |
| 场景事实来源 | `traffic-control-plane/src/lib/fault-run-catalog.ts` |
| Evidence DSL 来源 | `traffic-control-plane/src/lib/scenario-contract.ts` |

本文件是批次 4 实施进度的持久记录。任务清单生成不等于开始实现，也不代表阶段 0～3 的运行环境门禁已经通过。后续每次任务完成、阻塞、恢复或取消，必须立即更新本文件，不能等整个批次结束后补记。

## 1. 已核对的实施起点

- Phase 3 已提供 Catalog supplement、Evidence DSL、完整 `contractRevision`、canonicalizer 和 Evidence-only hash。批次 4直接 import，不复制类型或另建可变场景映射。
- `evidence-contract-snapshot.ts` 已实现 snapshot 创建、序列化、hash 检查和缺失 snapshot 显式失败；这是内存 consumer seam，不是数据库持久化能力。
- `evidence-query-prometheus-renderer.ts` 已支持 `PAYMENT_FAILURE_RATIO`、`PAYMENT_TIMEOUT_RATE`、`NODE_FILESYSTEM_GROWTH_RATE` 三种固定模板；其他模板和 live clients 仍待实现。
- 当前 `test:contract`、`test:runner` 已包含上述 seam 的测试。后续任务扩展现有 runner，不引入另一套测试框架。
- Phase 3 清单截至 2026-10-08 仍将外部 CI、clean-DB/disposable canary 和 live rollback 列为暂缓或阻塞；环境访问与完整 reset record 尚未提供。不能把已有代码或本地 fixture 视为阶段退出证据。
- 部署采用用户已确认的 **clean-slate bootstrap**：不支持已有 volume/schema upgrade，不新增仓库 wipe 工具，不自行 reset MySQL、Redis 或业务资源。

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

- **总体状态：** 清单建立完成；尚未执行 Phase 4 实现。
- **当前完成：** 3 / 60 个子任务（仅 P4-00 文档规划工作）。
- **运行时交付：** 0 / 57 个子任务；已有 Phase 3 seam 不重复计入。
- **当前任务：** 无进行中的实现任务。
- **实施起点：** P4-01 复核代码、设计和前置门禁；真实启用必须等待相应门禁通过。
- **阶段退出：** 阻塞。外部 CI、环境访问、完整 reset record 和 canary 证据未齐，不能声明 Phase 4 完成或进入 5.0。

| 任务组 | 目标 | 状态 | 完成 | 依赖 |
| --- | --- | --- | --- | --- |
| P4-00 | 建立清单与进度机制 | 已完成 | 3 / 3 | 当前设计 |
| P4-01 | 核对前置门禁与设计差异 | 未开始 | 0 / 3 | P4-00 |
| P4-02 | 配置与默认关闭开关 | 未开始 | 0 / 3 | P4-01 |
| P4-03 | 五张 Evidence 表与空库 bootstrap | 未开始 | 0 / 3 | P4-01 |
| P4-04 | 严格 DTO 与 Repository | 未开始 | 0 / 3 | P4-03 |
| P4-05 | capture 与创建事务接线 | 未开始 | 0 / 3 | P4-02、P4-04 |
| P4-06 | 安全时间线与确定性窗口 | 未开始 | 0 / 3 | P4-01、P4-04 |
| P4-07 | 全量受控查询渲染 | 未开始 | 0 / 3 | P4-01 |
| P4-08 | 不可变 Manifest 与 revision | 未开始 | 0 / 3 | P4-05～07 |
| P4-09 | 三类观测后端客户端 | 未开始 | 0 / 3 | P4-02、P4-07 |
| P4-10 | CURRENT 业务检查与 Run Event adapter | 未开始 | 0 / 3 | P4-06～08 |
| P4-11 | coverage、predicate 与状态聚合 | 未开始 | 0 / 3 | P4-06、P4-09、P4-10 |
| P4-12 | 同步 report service 与 attempt | 未开始 | 0 / 3 | P4-04、P4-08～11 |
| P4-13 | retention 前 Manifest 保全 | 未开始 | 0 / 3 | P4-08 |
| P4-14 | Operator Manifest/report API | 未开始 | 0 / 3 | P4-12、P4-13 |
| P4-15 | 分析笔记与审计/诊断 | 未开始 | 0 / 3 | P4-04、P4-12、P4-14 |
| P4-16 | Evidence UI 与双语状态 | 未开始 | 0 / 3 | P4-14、P4-15 |
| P4-17 | Compose/Kubernetes 配置与运行指引 | 未开始 | 0 / 3 | P4-02、P4-13～16 |
| P4-18 | 综合回归与数据库验收 | 部分验收阻塞 | 0 / 3 | P4-05～17、环境资料 |
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

### P4-01：前置门禁与设计对齐

- [ ] **P4-01.1** 核对阶段 0～3 清单和现有 Coordinator、Repository、owner/drain/action journal，记录缺失前置证据；明确已有 `PREPARE_STARTED`/`STOP_REQUESTED` 是否可复用，不重复写事件。
- [ ] **P4-01.2** 对齐设计中仍描述旧代码的段落、模块名和 schema 列；snapshot 复用 `evidence-contract-snapshot.ts`，DSL 只从 Phase 3 import，renderer 扩展已有 seam，禁止镜像定义。
- [ ] **P4-01.3** 记录 12 场景 template/source/read-check 覆盖和 flags 生效边界；任何实质设计冲突先登记并提问。验收为代码/设计映射及明确的 G0 结论，不默认前置环境门禁已通过。

### P4-02：配置与开关

- [ ] **P4-02.1** 实现 capture、query、execution 三个默认 `false` 开关；固定 source origin、credential 与 retention 配置；区分 Web 查询配置和 Worker retention 需要的能力。
- [ ] **P4-02.2** 校验 source/total timeout、report/recipe/source concurrency、response cap；禁止空 URL 回退到公网、Grafana 或浏览器 endpoint，拒绝 userinfo/不合法 origin。
- [ ] **P4-02.3** 添加配置负向测试与 kill-switch 契约：capture 关闭不要求 snapshot；query/execution 关闭不改变运行生命周期；Worker 不需要观测凭据。若配置所有权与最新 Web-only 约定冲突，先提问解决。

### P4-03：schema 与 clean-bootstrap

- [ ] **P4-03.1** 实现 snapshot、Manifest、attempt、attempt item、note 五张表和唯一约束、索引、枚举检查；不建 telemetry result/raw error 列，不对 Fault Run 设置 cascade。
- [ ] **P4-03.2** 检查实际编号，接入 runtime schema、下一顺序号 `src/lib/migrations`、fresh-install init 和已有 `db:verify`；不硬编码规划中的 `00N/0N`。
- [ ] **P4-03.3** 添加 DDL/schema verifier fixture，证明两条空库 bootstrap 声明等价，非 clean schema fail fast；已有 volume upgrade 和实际 reset 均不在本任务授权范围。真实空库验收见 P4-18.2。

### P4-04：DTO 与 Repository

- [ ] **P4-04.1** 新增 Manifest/window/attempt/note DTO 与 runtime JSON guard；直接复用 Phase 3 Evidence 类型，严格限制输出字段，校验 snapshot hash/revision。
- [ ] **P4-04.2** 实现参数化 SQL、snapshot 查询、Manifest revision 分配、attempt/item 写入和有界历史读取；并发同 timeline 只产生一个 revision，事务失败不能部分成功。
- [ ] **P4-04.3** 为并发冲突、非法 JSON、字段越界和 persistence allowlist 添加测试；拒绝保存 sample、log line、trace/span、business body、endpoint credential 或未校验 event payload。

### P4-05：capture 与创建事务

- [ ] **P4-05.1** capture 开启时，在原 Fault Run 创建事务中保存 Evidence plan、Evidence-only `contractHash` 和 Phase 3 完整 `contractRevision` 原值；与 Run/CREATED revision 一致。
- [ ] **P4-05.2** 处理 flag 关闭、snapshot 校验/DB 失败与同部署幂等 replay；关闭时不 capture，失败时目标 prepare 尚未执行，replay 不补写或覆盖 snapshot。
- [ ] **P4-05.3** 添加事务/Coordinator 测试：Run、CREATED、snapshot 同成同败，Catalog 后续变化不改变已冻结 plan，出站 Gateway header/body 不泄露 Evidence/revision。

### P4-06：时间线与窗口

- [ ] **P4-06.1** 从受控 Run/event/action facts 投影时间线，按 `(created_at,id)` 排序并输出 UTC；缺失为 `null`，禁止从 `Date.now()`、流量首请求或成功 prepare 补造事实。
- [ ] **P4-06.2** 使用 frozen policy 解析四类窗口，校验硬上限；终态 failed/unavailable 的 active fallback 附限制，recovery/cleanup 缺失分别为 NOT_READY/NOT_APPLICABLE。
- [ ] **P4-06.3** 添加四类恢复策略、终态、UTC、同毫秒、missing anchor、clock-skew 和窗口上限测试；若未来窗口 end 尚未到达的执行语义未定，在 P4-11 前提问，不能默认为完整覆盖。

### P4-07：固定查询渲染

- [ ] **P4-07.1** 扩展现有 Prometheus renderer，覆盖 Catalog 实际使用的全部有限 templates；保留已批准的支付 5m 和 filesystem growth 15m 三项 seam，不复制 Catalog 阈值。
- [ ] **P4-07.2** 实现 aggregate LogQL、固定 TraceQL 和 CURRENT business-check plan 渲染，保留 DSL 字段；验证 source/template/scope/projection/window 的合法组合。
- [ ] **P4-07.3** 添加 12 场景 coverage、query escaping、固定 labels、未解析占位符、scope 注入和 effectRule 引用测试；无自由 query/URL/业务 ID 输入。

### P4-08：Manifest 物化

- [ ] **P4-08.1** 实现终态 get-or-create：使用 persisted snapshot 和安全 timeline/windows/rendered recipes 生成 timelineHash、manifestHash，拒绝 active states。
- [ ] **P4-08.2** 实现并发幂等、递增 revision、cleanup 新 revision、旧 attempt 保持旧 Manifest；snapshot 缺失显式 unavailable，不按 revision 从当前 Catalog 重建。
- [ ] **P4-08.3** 测试 hash/revision 稳定、snapshot 损坏、source Run 已删除后的读模型、legacy/capture-off 运行；Manifest 浏览不访问外部 source、不修改控制状态。

### P4-09：观测客户端

- [ ] **P4-09.1** 实现 Prometheus/Loki range query、Tempo fixed TraceQL search typed adapters；service-side 计算 range/step，限制点数、series、Tempo limit 和内存解析。
- [ ] **P4-09.2** 接入 AbortSignal、总 deadline、单 source timeout、redirect 拒绝、byte cap、content-type/JSON shape 校验和有限重试；原始 provider 错误映射为稳定安全码。
- [ ] **P4-09.3** 本地 mock HTTP 测试正确编码、断连/429/5xx/timeout、无重试 400/401/403、超大响应和 malformed body；不能将失败转为空数组/零值。达到 Tempo limit 的覆盖语义若不明确，登记决策后再实现。

### P4-10：业务与事件 adapter

- [ ] **P4-10.1** 固定 `CATALOG_PRODUCT_LIST`、`CATALOG_BROWSE_REPORT` 正常 Gateway GET，静态参数，无 Fault Run context/Operator credential；响应仅受控当前检查结果。
- [ ] **P4-10.2** 实现 Run Event adapter 与 CURRENT/WINDOWED 分离：CURRENT 附 `checkedAt`，不冒充历史效果、清理或窗口内恢复，不让 CURRENT 进入 effectRule。
- [ ] **P4-10.3** 测试无直接业务 service HTTP、无写调用、无 run-context-bound inventory/promotion/storage endpoint、无业务 body 透传；若 GET 有实际副作用或恢复检查语义不匹配，暂停并提问。

### P4-11：覆盖和判断规则

- [ ] **P4-11.1** 使用一次 DB 当前时间按 source retention 做 FULL/PARTIAL/NONE preflight；全部过期不调用后端，部分覆盖不移动 canonical window，缺数据不补零。
- [ ] **P4-11.2** 实现 DSL predicate、ALL/ANY effectRule、availability/coverage/overall status；NO_DATA、unavailable、invalid query 与内部 FAILED 分开，CURRENT 不掩盖历史证据过期。
- [ ] **P4-11.3** 增加 truth-table 测试：完整匹配才 OBSERVED、完整明确不匹配才 NOT_OBSERVED，其余 INCONCLUSIVE；未来窗口、range lookback 与截断查询不得产生虚假的 FULL coverage。

### P4-12：同步 report service

- [ ] **P4-12.1** 编排 frozen Manifest、preflight、并发 semaphore 和总 deadline；只执行显式请求，不启动 Web 后台任务、evidence worker 或持久队列。
- [ ] **P4-12.2** 创建 metadata-only attempt 并写终态/item；相同 key 返回 metadata replay 不重复 query，新 key 才重查；中断/存储失败可诊断且不虚报成功。
- [ ] **P4-12.3** 测试 report 容量 429、取消、deadline、部分失败、idem race 和结果允许字段；进程退出留下 RUNNING attempt 的处置若设计未明确，先提问，禁止自动重复 source reads。

### P4-13：retention 保全

- [ ] **P4-13.1** 在现有 retention 事务/lease 删除前用同一 materializer 固定最新 Manifest，标记 `source_run_retained=false`，保留 snapshot/Manifest/attempt/note。
- [ ] **P4-13.2** capture-off/无 snapshot 运行不补造历史合同；保留原 eligible 删除边界，不以 Evidence 改动扩大删除范围或触发 cleanup。
- [ ] **P4-13.3** 测试并发 cleanup/retention、事务失败、source 删除后历史查询与 CURRENT check 分离、Worker 无 observability 请求/credential；真实 DB 行为在 P4-18.2 验收。

### P4-14：Operator API

- [ ] **P4-14.1** 实现 Manifest GET、report history GET 和 live report POST；未知 UUID/Run、非终态、无 snapshot、旧 hash 与源行已删除都有固定 envelope。
- [ ] **P4-14.2** 保持 session、CSRF、confirmation、idempotency、body/分页限制和安全响应 headers；拒绝 query、URL、range、source、operation 等额外输入。
- [ ] **P4-14.3** route/middleware 测试 401/403/400/404/409/422/429、unavailable 结构化响应与 metadata replay；所有 GET 不执行 live query，所有响应 no-store。

### P4-15：Note、Audit 与诊断

- [ ] **P4-15.1** 实现 append-only 2,048 字符 plain-text note、查询/创建 API、确认的敏感输入拒绝策略；不支持编辑/删除或遥测导出粘贴。
- [ ] **P4-15.2** 关联独立 attempt/note audit ID，不调用 `attachOperatorAudit()` 覆盖 Run 审计；结构化 Pino 和 history 只记录安全状态/时长/reason code。
- [ ] **P4-15.3** 添加 DB/audit/log/DTO 泄露负向测试和诊断运行指引；若要新增 metrics 依赖/端点，必须先提问取得决策，未获批时使用设计允许的 Pino/audit/history。

### P4-16：Operator UI 与 i18n

- [ ] **P4-16.1** 在现有 RunDetails 集成 EvidencePanel 和防御性 view model；GET-only 浏览，独立展示控制、效果、当前业务恢复、清理、证据与 limitation。
- [ ] **P4-16.2** 显式确认后执行刷新，新 key 重查，metadata replay 提示再次主动刷新；复制仅 frozen recipe，不保存 response 到 storage/URL，不新增公共查询控制台。
- [ ] **P4-16.3** 添加中英文、no-data/unavailable/unknown 状态、CURRENT checkedAt、访问性/复制/错误 UI 测试；仅当前 React memory 有 live summary，页面重载不显示伪历史结果。

### P4-17：部署声明与指引

- [ ] **P4-17.1** Compose 配置三旗默认关闭、Web-only 内部 endpoints/凭据注入，Worker 仅 retention；README 记录 clean-slate 外部责任、复查边界、kill switch 和非快照语义。
- [ ] **P4-17.2** Kubernetes Web config/专用 Secret 引用/最小 NetworkPolicy 声明同步；保留 DNS 和既有必需出站路径，不阻断正常 control-plane 能力，Worker 不获 query 凭据。
- [ ] **P4-17.3** 核对 Loki retention、log shipping、Prometheus/Tempo 存储和实际 source capability；未完成 parity 不开启 K8s execution。新增采集器/PVC/认证方式等部署选择需提问，不自行升级基础设施。

### P4-18：综合验证

- [ ] **P4-18.1** 执行改动范围对应的 Node tests、Contract/runbook/i18n、typecheck/lint、静态部署和术语边界检查；沿用现有工具，回归不能与修复无关的旧问题混做。
- [!] **P4-18.2** 在获批可丢弃数据库分别运行 init 与 db:migrate/db:verify 空库路径，验收创建事务、并发 Manifest/attempt、retention 保全。阻塞：P4-ISSUE-001；没有环境授权/reset record 不执行实际 reset。
- [ ] **P4-18.3** 综合 mock provider/route 流程：重复查询不漂移、partial/timeout/expiry/cancel/idem/no-snapshot、数据库/日志不含遥测；记录与真实 pilot 的差别。

### P4-19：pilot、回退与阶段退出

- [!] **P4-19.1** 取得 Phase 3 门禁证据及用户批准的单 Worker、单 Operator、可丢弃 Compose 环境和 pilot 场景；capture-only 再 query/execution。阻塞：P4-ISSUE-001、P4-ISSUE-002。
- [!] **P4-19.2** 完成真实成功复查、同 Manifest 重查、每 source 故障/超时/retention 演练、kill-switch 与生命周期不受影响的回退证据；K8s 未就绪明确限定。阻塞：P4-ISSUE-001。
- [!] **P4-19.3** 汇总 12 场景合同/renderer coverage、真实 pilot、clean DB 和外部发布门禁，更新产品/技术/阶段文档；未满足前置及退出项不得转 5.0。阻塞：P4-ISSUE-002。

## 6. 问题与用户决策

### 6.1 已知阻断

| ID | 状态 | 影响 | 已知事实/恢复条件 | 需用户决策时的提问 |
| --- | --- | --- | --- | --- |
| P4-ISSUE-001 | 阻塞 | P4-18.2、P4-19.1～2 | Phase 3 清单仍缺环境访问、完整外部 reset record 和 disposable canary；本次未授权任何破坏性操作。获得批准且核实的环境与记录后恢复 | 到真实验证阶段时，询问使用哪个可丢弃环境及其明确授权；不在清单生成时提前要求不存在的资料 |
| P4-ISSUE-002 | 阻塞阶段退出 | P4-19.1、P4-19.3 | Phase 3 外部 CI/canary/live rollback 尚未全部关闭；准备默认关闭代码不代表前置门禁通过 | 开启/发布前，询问继续保持暂缓，还是提供前置门禁证据；若要求改变阶段依赖，先记录设计决策 |

上述问题来自已记录的 Phase 3 状态，本次不擅自改变用户的暂缓决策。到达受影响任务时刷新事实，再通过提问确认。

### 6.2 执行中需关注的决策点

以下是设计待细化的检查点，不是当前已确认的缺陷，也不提前替用户选定实现：

| 检查点 | 首次处理任务 | 决策触发条件 |
| --- | --- | --- |
| future recovery/active tail 与 PromQL/LogQL lookback 覆盖 | P4-06 / P4-11 | 最新 Contract 与设计不能唯一确定等待、拒绝、部分查询或 coverage 语义 |
| Tempo 搜索 limit/部分结果 | P4-09 / P4-11 | 无法证明返回的是完整集合，影响 FULL/效果判断 |
| interrupted RUNNING attempt | P4-12 | 同步取消/进程退出后，历史状态恢复方式需要新增状态或运行职责 |
| note 敏感内容策略 | P4-15 | 检测方案会引入误拒绝、内容改写或额外依赖，且设计没有明确规定 |
| feature metrics | P4-15 | 需要增加依赖、metrics route 或 scraper；未决策前使用现有诊断方式 |
| Kubernetes parity、Secret 与 network/storage | P4-17 | 需要选采集器、持久存储、共享认证或变更已有网络权限 |
| destructive test 与 pilot 范围 | P4-18 / P4-19 | 要连接真实环境、reset 数据或运行有实际资源影响的场景 |

新的实质问题按 `P4-ISSUE-003` 起递增编号，记录备选方案、推荐、风险、用户回答和落实证据。不要将此表的“检查点”当作已批准的新范围。

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
