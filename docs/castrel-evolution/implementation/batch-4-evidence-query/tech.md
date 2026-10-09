# 批次 4：实时 Evidence Query 技术设计

> 状态：技术设计 v1.8；2026-10-09执行前核对已对齐现有action/recovery事实和Web-only配置决策；完整Batch 4运行时尚未交付<br>
> 配套产品规格：[product.md](./product.md)<br>
> 实施任务与进度：[task-list.md](./task-list.md)<br>
> 对应路线阶段：阶段 4<br>
> 前置条件：阶段 0～3 的退出门槛已满足，尤其是批次 3 已提供并阻断式校验完整的 Scenario Evidence Contract<br>
> 设计原则：合同单一事实来源、运行级不可变查询协议、实时只读查询、结果不落库、控制/效果/恢复/清理事实严格分离

### P3-04 implementation handoff (2026-09-30)

The user approved and the implementation completed the two blocked handoffs as a deliberately narrow Batch 4 consumer seam in `traffic-control-plane`. `evidence-contract-snapshot.ts` imports the Phase 3 `EvidenceContractPlan`, reuses its canonicalizer/hash, persists only the Evidence plan JSON alongside the unchanged full `contractRevision`, and fails missing snapshots with `CONTRACT_SNAPSHOT_UNAVAILABLE` rather than consulting current Catalog data. `evidence-query-prometheus-renderer.ts` implements only the three approved fixed templates, retaining the Catalog predicate and enforcing fixed service/filesystem scope and 5m/15m metric windows; metric fixtures cover the emitted Payment counters and node-exporter series. This is not the full Batch 4 runtime: capture flags, Fault Run transaction wiring, database tables, manifests, live provider clients, routes, and UI remain unimplemented. Phase 3 remains the sole source of Evidence types and mutable Catalog facts; renderer inputs remain typed Catalog recipes with no free-form query slot.

### 2026-10-09 复审决策

用户已分别确认：baseline 从 active 遥测配方派生，仅作对照，不新增相对阈值；capture 时同时冻结独立渲染计划和窗口硬上限；未来窗口不等待、不移动 canonical window，返回部分证据并由 Operator 主动重查；中断 attempt 用数据库 deadline 和请求时 CAS 惰性结算，不新增后台执行器；active predicate 使用任一有效采样，recovery predicate 使用全部有效采样，按 Catalog ALL/ANY 三态组合。下文定义具体落地规则与验收，设计完成不代表运行时代码已实现。

执行前追加确认：safe-runtime以相应attempt的实际Worker `DRAIN_STARTED`作为恢复开始，不能用STOP受理代替；Evidence配置由独立Web-only模块解析和instrumentation校验，Worker不解析查询开关/观测凭据，只处理已存Evidence记录。

## 1. 设计结论

批次 4 在 `traffic-control-plane` 内实现一个仅供 Operator 使用的 Evidence Query 子系统。它由三个彼此独立的层组成：

1. **可选的运行创建时冻结合同**：只有 `EVIDENCE_MANIFEST_CAPTURE_ENABLED=true` 时，才在创建 Fault Run 的同一 MySQL 事务保存 Phase 3 `contractRevision` 引用、Evidence DSL snapshot 及 `contractHash`、独立的已渲染查询计划及其版本/hash和创建时窗口硬上限。后续 Catalog 或 renderer 修改不会改写它；flag 关闭时不要求也不写 snapshot。
2. **终态按需物化 Manifest**：Operator 首次查看终态运行的证据时，服务端使用 frozen contract 与按 `(created_at, id)` 排序的 Run Event 生成不可变 `EvidenceQueryManifest`。若清理等后续生命周期事实发生，则创建新 revision，绝不原地改写旧 Manifest。
3. **Operator 显式实时查询**：Operator 主动发起一次有严格时间、并发和响应体上限的同步查询。控制面只向 Prometheus、Loki、Tempo 和既有 Gateway 固定只读检查发请求，结果只在当前 HTTP 响应中以受限摘要返回；数据库、审计、日志和指标只记录状态、判断、时长和安全错误码。

```text
Catalog / Scenario Evidence Contract
        |
        +-- capture flag ON --> snapshot frozen atomically at Fault Run creation
        |                         |
        |                         v
        |                  EvidenceContractSnapshot
        |                         |
        +-- capture flag OFF -----+--> no snapshot; report unavailable
                                  |
Fault Run + ordered Run Events --+--> EvidenceManifestService
                                       |
                                       v
                               immutable Manifest revision
                                       |
Operator explicitly requests a report
        |
        +--> bounded live executor --> Prometheus / Loki / Tempo / Gateway
                                       |
                                       v
                         sanitized, no-store Operator response
```

本设计不新增业务服务的场景语义、通用观测代理、离线证据包、自动恢复或 Agent 入口。`traffic-control-plane` 仍然是 Catalog、Fault Run、审计、恢复和证据语义的唯一所有者。

### 1.1 备选方案与选择

| 方案 | 描述 | 优点 | 不采用的原因 |
| --- | --- | --- | --- |
| 浏览器直接查询 Grafana/观测后端 | 前端携带查询并调用 datasource 或 Grafana deep link | 实现表面上最少 | 泄露连接边界，无法限制查询，不能统一窗口、审计、脱敏和错误语义 |
| Worker 队列化执行并持久化完整报告 | Web 创建作业，独立 Worker 查询后写回报告 | 适合以后长时间 Evaluator | 阶段 4 不需要后台评估；会增加 lease/retry/队列语义，并容易把实时结果变成现场快照 |
| **冻结合同 + 同步受限执行** | 服务端对终态 Manifest 执行一次实时只读查询 | 保持实时性、最小化状态、无 Web 后台任务、可复用给阶段 5 | 单次响应受总时限约束，Operator 需用新请求主动重查 |

因此，本批次选择第三种方案。同步只指一次有硬性 deadline 的 HTTP 操作；它不是在 Web/API 中启动后台任务。后续阶段 5.2 如需队列化 Evaluator，应复用本批次的 Manifest resolver 和 query executor，而不是复制查询实现。

## 2. 当前实现基线与进入门槛

### 2.1 已有可复用事实

| 事实 | 当前来源 | 批次 4 的使用方式 |
| --- | --- | --- |
| 场景、目标 service/operation、参数、时长和恢复策略 | `traffic-control-plane/src/lib/fault-run-catalog.ts` | 唯一的场景事实来源；Evidence Contract 附着于此处 |
| 运行状态、创建/启动/停止时间 | `fault_runs`、`fault-run-repository.ts` | 读取受控生命周期事实，不从 UI 或浏览器时间推断 |
| 生命周期和 Worker 观察 | `fault_run_events` | 以 `(created_at, id)` 规则折叠为安全的时间线投影 |
| 固定 Tempo service/route 元数据 | `traffic-control-plane/src/lib/runbook.ts` | 迁移为 Catalog Evidence Contract 的派生展示数据，不能形成第二份配方 |
| Operator session、CSRF 和统一响应 envelope | `middleware.ts`、`csrf.ts`、`api-response.ts` | 保护所有 `/internal/**` 路由；POST 必须 CSRF |
| Operator 审计 | `operator-audit.ts`、`operator_audit_logs` | 查询执行和分析笔记各自保留 audit reference，不复用 `fault_runs.operator_audit_id` |
| Gateway 固定观测入口 | `OperationDispatchController` | 仅复用已经存在、可验证为只读的固定入口；不新增通用代理 |
| Prometheus、Loki、Tempo | Compose/Kubernetes 观测配置 | 通过服务端内部 endpoint 做实时只读请求，不经浏览器或宿主机暴露端口 |

Phase 3 已实现 `contract.evidence` supplement、Contract revision、Evidence snapshot 内存 seam 和三项 Prometheus renderer。缺少的是 Batch 4 capture 持久化/事务接线、完整渲染计划、Manifest、live clients 和 Operator 入口；不能通过路由、组件、Markdown 或 SQL 里的手工映射绕过。

### 2.2 开始编码前的阻断门禁

以下门禁全部满足后才能打开批次 4 的 capture 或 query flag：

1. 批次 0 已能把未知运行事实表示为 `UNKNOWN`、`null` 或 limitation，未把 `prepare` 成功解释为效果已发生。
2. 批次 1 已记录停止、drain、release 和 cleanup 的边界；手工清理和 `NON_RELEASING` 行为不能由终态状态伪造。
3. 批次 2 的 owner、heartbeat、fencing 和重协调结果已经稳定，重启不会让事件时间线失去可解释性。
4. 批次 3 已为 12 个 Catalog 场景校验：
   - `contractRevision`；
   - 固定 evidence recipe、窗口 policy、required 标记和 predicate；
   - 可选的固定 Gateway read-check；
   - 合法的 runbook、i18n 和 alert contract；
   - 所有 recipe、window、read-check 映射都没有用户输入插槽。
5. Phase 3 的静态 Contract gate 已通过；Phase 3 只保存 revision。只有显式启用 Batch 4 capture flag 时，新 Fault Run 才在目标 prepare 之前原子保存对应的 Evidence Contract snapshot；flag 关闭不要求也不写 snapshot。
6. 每个候选观测后端均有已验证的内部服务 endpoint；不会用 Grafana 公共 URL、浏览器 cookie 或开发环境 Basic Auth 作为查询凭据。

批次 4 不负责修复当前 `deleteExpiredFaultRuns()` 对手工清理边界的既有缺口；该运行安全门禁属于前置阶段。批次 4 只能消费已经可靠记录的事实。当前该函数仍按终态、非空recovery_result和stopped_at超过7天筛选，不能声称会排除未完成手工清理；它继续阻断真实启用/阶段退出。

### 2.3 2026-10-09 源码交接事实

| 边界 | 当前实现 | Batch 4接入 |
| --- | --- | --- |
| create事务 | `createFaultRun()` 原子写Run、CREATED、revision；owner模式还写execution/PREPARE action | 新snapshot/capture plan插入该事务，幂等replay不补写 |
| prepare开始 | owner模式`fault_run_actions.dispatch_started_at`有DB时间；没有PREPARE_STARTED通用event | 优先读取实际PREPARE dispatch；不存在则null，不用CREATED冒充 |
| stop受理 | `requestFaultRunStop()`事务写STOP_REQUESTED与受控stop attempt | 只作为stopRequestedAt，202不是恢复执行开始 |
| safe-runtime恢复 | RecoveryExecutor写DRAIN_STARTED、RELEASE/VERIFY等事件，Repository验证projection/attempt后写RECOVERY_COMPLETED | 使用对应attempt真实DRAIN_STARTED；成功anchor须满足成功projection，VERIFY_UNAVAILABLE不等于已恢复 |
| legacy恢复 | `legacy-fault-run-recovery.ts`仍写RECOVERY_STARTED | 仅对明确legacy事实复用该事件，不给safe-runtime补造 |
| retention | WorkerRuntime持有既有retention lease，Repository删除eligible run/event及关联audit | 将Evidence保全接入同一事务/lease，不另启任务或查询source |
| schema | 当前Batch 4已落地006 migration/10 init和runtime五表声明，db:verify接入metadata verifier | fixture证明声明parity；真实空库与SQL执行仍待P4-18.2，不承诺旧volume升级 |
| 配置 | `scenario-contract-web-config.ts`由Node instrumentation校验，Worker导入shared env | 复用该分层方式；不把Evidence配置加到shared env |

阶段0仍有真实观测/K8s限制，阶段1有verification adapter限制，阶段2有DB/runtime门禁，阶段3外部CI/cleanDB/canary仍暂缓。G0只允许默认关闭的本地实现，不解锁真实环境门禁。


## 3. 范围、非目标与不变量

### 3.1 本批次范围

- 终态 Fault Run 的固定 Contract snapshot、Manifest、窗口和限制说明。
- Prometheus range query、Loki aggregate query、Tempo TraceQL search、控制面时间线和已批准 Gateway read-check 的实时复查。
- Operator 侧 Manifest 浏览、显式刷新、受控摘要、状态解释与可选分析笔记。
- 查询请求、查询结果可用性、判断和错误码的低敏审计/运行元数据。
- Compose 优先的单环境 pilot，以及 Kubernetes 启用前的观测能力核验。

### 3.2 明确非目标

- 不保存 Prometheus sample/matrix/exemplar、Loki log line/label dump、Tempo trace/span/attribute、HTTP response body、MySQL/Redis/JVM/文件系统现场快照。
- 不提供自由输入 PromQL、LogQL、TraceQL、URL、service、route、时间范围、业务 operation 或业务请求体。
- 不创建 AgentRcaReport、alert receipt、incident、Evaluator queue、Ground Truth、评分、remediation outcome 或自动 remediation。
- 不调用 `FaultRunCoordinator.stop()`、release、cleanup、restart、业务写 API 或真实业务恢复动作。
- 不把 `faultRunId`、`X-Trace-Id` 或数据库业务 ID 当作 OTel trace ID。
- 不把配置中的 retention 时长误表述为现场数据必然仍然存在。
- 不要求所有场景都有独立业务检查；缺少安全固定 read-check 时应明确为未配置，而不是新增任意业务代理。

### 3.3 必须持续成立的事实分离

| 事实 | 唯一依据 | 不得由其推导 |
| --- | --- | --- |
| 控制动作已接受 | `TARGET_CONFIRMED` 和 Fault Run 状态转换 | 目标效果已观察到 |
| 目标效果已观察到 | 已冻结 predicate 在完整可用查询中的判断结果，或将来的显式独立观察事实 | `prepare`、Worker 已启动、trace correlation ID |
| 业务已经恢复 | 已声明的恢复/read-check predicate | release/stop/recovery API 返回成功 |
| 清理已完成 | 显式 `MANUAL_CLEANUP_COMPLETED` 及其适用检查 | 运行进入终态 |
| 证据可用 | 真实查询结果、窗口可解析性和 retention 覆盖 | 没有查询结果、告警已 resolved |
| Operator 分析 | 有界 analysis note | 生命周期状态或遥测结果 |

## 4. 总体架构和数据流

### 4.1 运行创建与 Contract snapshot

```mermaid
sequenceDiagram
  participant O as Operator
  participant API as Fault Run API
  participant C as FaultRunCoordinator
  participant K as Catalog / Contract
  participant DB as MySQL
  participant G as Gateway

  O->>API: POST /internal/fault-runs
  API->>API: session + CSRF + idempotency validation
  API->>C: create(command)
  C->>K: validate ResolvedScenarioContract.evidence
  alt EVIDENCE_MANIFEST_CAPTURE_ENABLED=true
    C->>K: freeze DSL, rendered plan, renderer revision and window bounds
    C->>DB: transaction: fault_runs + CREATED event + contract snapshot
  else capture disabled
    C->>DB: transaction: fault_runs + CREATED event
  end
  DB-->>C: committed run
  Note over C,DB: owner prepare uses persisted action dispatch time; missing anchor stays null
  C->>G: fixed prepare operation
  G-->>C: target response
  C->>DB: transaction: ACTIVE + TARGET_CONFIRMED
  C-->>API: run
  API-->>O: normal control-plane envelope
```

Phase 3 的 `contractRevision` 仅用于识别创建时的场景合同，不是历史快照，也不可用于重建 Evidence DSL。Batch 4 的 Contract snapshot 只记录当次运行应使用的查询协议，不查询任何观测后端。若 capture flag 已开启，snapshot 写入失败必须在任何目标 `prepare` 调用之前使创建失败；否则会产生无法按已批准合同解释的“reportable run”。当 capture flag 关闭时，现有 Fault Run 创建路径保持不变，新运行明确标记为没有 Evidence Contract snapshot。

Batch 4 直接消费 Phase 3 Catalog supplement 中版本化的 `EvidenceContractPlan` 类型/值，包括 `EvidenceWindowPolicy`、`EvidenceRecipeDefinition` 和 `effectRule`。不得维护第二份可变 template/scope/predicate/projection/window 定义，也不做 DSL 类型/字段 rename；snapshot 将同一 `EvidenceContractPlan` 作为 JSON 序列化。

已渲染计划是该 DSL 在 capture 时的不可变派生产物，另存于 `rendered_plan_json`，不是另一份可变 DSL。所有适用模板必须在 target prepare 前完成安全渲染；渲染不支持或校验失败时 capture 失败，不能创建运行后再按最新 renderer 补齐。

### 4.2 终态 Manifest 物化与实时报告

```mermaid
sequenceDiagram
  participant O as Operator
  participant API as Evidence API
  participant M as Manifest service
  participant DB as MySQL
  participant P as Prometheus
  participant L as Loki
  participant T as Tempo
  participant G as Gateway

  O->>API: GET evidence manifest
  API->>M: getOrCreateTerminalManifest(run)
  M->>DB: load snapshot + ordered safe lifecycle facts
  M->>M: derive UTC windows, recipes, limitations and hash
  M->>DB: insert immutable manifest if timeline hash is new
  M-->>API: manifest
  API-->>O: no-store manifest response

  O->>API: POST evidence reports
  API->>DB: create metadata-only attempt
  API->>M: execute frozen manifest under deadline
  par bounded read-only requests
    M->>P: fixed PromQL range query
    M->>L: fixed aggregate LogQL range query
    M->>T: fixed TraceQL search
    M->>G: fixed Gateway read-check
  end
  M->>M: summarize and evaluate predicates in memory
  M->>DB: persist state/reason/duration only
  M-->>API: sanitized live summary
  API-->>O: no-store report response
```

Manifest 浏览绝不触发外部查询。页面轮询、详情打开、列表筛选和历史读取也绝不触发外部查询。只有明确的 `POST` 可执行一次 live report。

### 4.3 为什么 Manifest 在终态物化

阶段 4 的产品重点是运行后可重复复查；只有终态后 `baseline`、`active` 和恢复窗口才具有稳定边界。将 active Fault Run 的“当前时间”写入历史 Manifest 会破坏确定性，也会让 UI 轮询意外制造观测负载。

因此：

- `CREATING`、`ACTIVE`、`RECOVERING` 的 Manifest/report 请求返回 `409 RUN_NOT_TERMINAL`。
- `RECOVERED`、`STOPPED`、`FAILED` 和 `SERVICE_UNAVAILABLE` 可以生成 Manifest。
- 对 `FAILED` 或 `SERVICE_UNAVAILABLE` 缺少 recovery anchor 的窗口返回 `NOT_READY`/`EVIDENCE_UNAVAILABLE`，但已稳定的 baseline/active 窗口仍可复查。
- 手工 cleanup 在首次 Manifest 之后完成时，下一次物化生成一个新 revision；旧 revision 继续可读，以保留当时的查询协议。

## 5. Catalog 与 Contract 设计

### 5.1 单一事实来源

`traffic-control-plane/src/lib/fault-run-catalog.ts` 继续是所有可变场景事实的唯一来源。批次 3 在 `FaultRunScenarioDefinition` 上增加必填 `contract: ScenarioContractSupplement`；Evidence plan 位于 `contract.evidence`。Phase 3 的 `scenario-contract.ts` 是 Evidence DSL 类型/schema 的唯一来源，Batch 4 直接 import 并消费，不得再声明 `EvidenceRecipe`、`EvidenceWindowPolicy`、`EvidenceTemplateId`、`EvidenceScope` 或 `EvidencePredicate` 的镜像类型。

```ts
import type { EvidenceContractPlan } from '@/lib/scenario-contract';

type EvidenceContractSnapshotRecord = {
  contractRevision: string;
  contractHash: string;
  evidence: EvidenceContractPlan;
};
```

`contract_json` 持久化该 `EvidenceContractSnapshotRecord.evidence` 对象；canonical JSON 是计算 hash 时的确定性序列化，不重复作为第二份 snapshot 存储。字段名与 Phase 3 DSL 完全一致，不做 `EvidenceRecipeDefinition`→`EvidenceRecipe` 或其他 schema rename。`contractHash` 为该 Evidence plan canonical JSON 的 64-character lowercase SHA-256；它只标识 snapshot 内容，不是 Fault Run 的 scenario contract revision。模板/scope/predicate 仍是有限枚举或结构化输入，不能由 Operator、Agent 或环境变量替换。

### 5.2 revision、canonicalization 与历史冻结

1. Batch 4 从 `resolveScenarioContract(definition)` 读取完整 resolved contract 与 `evidence` plan。
2. 按 Phase 3 的 canonicalization 对 Evidence plan 自身计算 `contractHash`；Recipes 按 `id`、`effectRule.recipeIds` 按稳定 ID 排序。
3. 不由 Batch 4 重算 `contractRevision`。使用 Phase 3 计算的完整 ResolvedScenarioContract revision 原值；Evidence 之外字段变化也可能改变它。
4. 仅当 capture flag 开启时，在 Fault Run 创建事务中保存 Evidence plan 的 canonical JSON、`contractHash` 与同一 `contractRevision` 引用；验证该引用与 `fault_runs.contract_revision`、`CREATED.contractRevision` 相同。
5. Manifest 用 `contractHash + safe timeline projection + resolved windows + rendered recipe plan` 生成独立 `manifestHash`。

`catalogRevision` 仍为完整 Catalog 的 64-hex hash；`contractRevision` 是 Phase 3 的完整 per-run Resolved Contract hash；`contractHash` 是 Batch 4 Evidence snapshot 的 content hash；`manifestHash` 是带 lifecycle timeline/windows 的 Manifest hash。四者用途不同，不可互相赋值或重算替代。

`renderedPlanHash` 另行覆盖冻结的 query/check plan、renderer/evaluation 版本、baseline 派生映射和窗口硬上限；它不替代上述四个 hash。Manifest 的 hash 输入也包含 `renderedPlanHash`、Manifest schema version 和 frozen plan metadata。

Catalog 后续变更只影响新 capture snapshot。已有 snapshot 的运行始终使用自己的冻结 Evidence plan；在 capture flag 关闭时创建的 Run 没有 snapshot，即使有 `contractRevision` 也不得用当前 Catalog 重建其历史 Evidence plan，必须得到 `CONTRACT_SNAPSHOT_UNAVAILABLE`。

### 5.3 Recipe DSL 与查询渲染

每个外部 recipe 由受限模板渲染，而不是将 free-form query 直接写入 HTTP route：

| Source | 允许模板示例 | 受限 scope | 返回摘要 |
| --- | --- | --- | --- |
| Prometheus | `HTTP_P99`、`HTTP_ERROR_RATIO`、`HTTP_RATE`、`HIKARI_UTILIZATION`、`JVM_HEAP_RATIO`、`MYSQL_SLOW_QUERY_RATE`、`PAYMENT_FAILURE_RATIO`、`PAYMENT_TIMEOUT_RATE`、`REDIS_MEMORY_RATIO`、`NODE_FILESYSTEM_RATIO`、`NODE_FILESYSTEM_GROWTH_RATE` | 已验证 service、固定 route、固定 metric label | sample 数、min/max/latest、predicate outcome |
| Loki | `SERVICE_EVENT_COUNT`、`SERVICE_ERROR_COUNT` | 已验证 `service`、允许的 `log_level` | bucket/series 数与 count summary |
| Tempo | `SERVICE_REQUESTS`、`SERVICE_ERRORS`、`SERVICE_SLOW_REQUESTS`、`SERVICE_ROUTE_REQUESTS` | 已验证 `resource.service.name`、固定 route、阈值 | trace/error count 与 duration bucket |
| Business check | `CATALOG_PRODUCT_LIST`、`CATALOG_BROWSE_REPORT` | 固定的正常业务 GET 和静态 query 参数 | `PASS`、`FAIL`、`NO_DATA` 或受限 scalar |
| Run event | `RUN_TIMELINE` | Manifest 内安全时间线 | anchor 是否存在和限制码 |

三个新增 Prometheus templates 都绑定当前部署已存在的 metrics：`PAYMENT_FAILURE_RATIO` 使用 `payment_charge_fail_count_total` 与 `payment_charge_success_count_total` 的 5 分钟失败比例；`PAYMENT_TIMEOUT_RATE` 使用 `payment_charge_timeout_count_total` 的 5 分钟速率；`NODE_FILESYSTEM_GROWTH_RATE` 使用 `/data`、`ext4` 的 `node_filesystem_avail_bytes` 15 分钟导数，Catalog predicate `< -2097152` 表示可用空间下降快于 2 MiB/s。服务、文件系统标签、窗口和阈值只能来自受控 Catalog scope/predicate，renderer 不接受 query text。

渲染器只能替换已验证的服务名、静态 route 和常量阈值，绝不能替换 Fault Run 参数、Operator 输入、URL、label matcher、业务 ID 或 trace ID。每个模板输出在写入 snapshot 前都必须通过静态验证：

- recipe ID 在同一 contract 内唯一；
- source、window 和 projection 的组合受支持；
- 所有时间窗口均在全局硬上限内；
- rendered query 不包含未解析占位符、URL、credential、用户输入或不允许的 label；
- Gateway read-check ID 有唯一固定实现；
- effect rule 引用的 recipe ID 均存在且可产生 predicate outcome。

`runbook.ts` 的 Tempo 展示信息应改为从 Catalog Evidence Contract 派生。runbook 可以继续拥有文章文件名、影响范围、解释文本和 Mermaid 内容，但不能同时维护 service/route/query 事实。

### 5.4 12 个场景的最小 Evidence 覆盖

每个场景至少有 `RUN_TIMELINE`、一个 Prometheus、一个 aggregate LogQL 和一个 TraceQL recipe。业务 read-check 是可选项，只能使用既有的、固定的正常读取路径，并在 UI 中与历史窗口 evidence 分开呈现。

| 场景 | Prometheus 重点 | Loki/Tempo scope | 初始 Gateway read-check |
| --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | Catalog report HTTP latency、Hikari utilization、MySQL slow-query rate | `catalog-service`、`/api/reports/product-browse` | `CATALOG_BROWSE_REPORT`（当前恢复检查） |
| `ORDER_REPORT_SQL` | Order report HTTP latency、Hikari utilization、MySQL slow-query rate | `order-service`、`/api/reports/order-query` | 无 |
| `BROWSE_SURGE` | Gateway/Catalog request rate、HTTP latency/error ratio | `gateway-service` 与 `catalog-service`、`/api/products` | `CATALOG_PRODUCT_LIST`（当前恢复检查） |
| `ORDER_QUERY_SURGE` | Gateway/Order request rate、HTTP latency/error ratio | `gateway-service` 与 `order-service`、`/api/orders` | 无 |
| `CATALOG_REDIS_LARGE_VALUE` | Catalog HTTP latency/error ratio、Redis memory ratio | `catalog-service`、产品详情 route | `CATALOG_PRODUCT_LIST`（当前恢复检查；不使用 run-scoped key/SKU） |
| `CART_CATALOG_DEPENDENCY` | Cart/Catalog HTTP error/latency | `cart-service`、`catalog-service`、固定业务路径 | 无；加购是写路径，不可作为 Batch 4 read-check |
| `NOTIFICATION_HEAP_PRESSURE` | JVM heap ratio、major GC rate、notification error ratio | `notification-service` | 无；通知投递是写路径 |
| `NOTIFICATION_STORAGE_APPEND` | filesystem available/growth metric、notification error rate | `notification-service` | 无；现有 storage append 入口会写文件，明确排除 |
| `PROMOTION_LOCK_CONTENTION` | Hikari pending/utilization、HTTP error/latency | `promotion-service` | 无；现有 consistency endpoint 依赖 active run，不适用于终态报告 |
| `INVENTORY_TABLE_EXCLUSIVE` | Hikari pending/utilization、availability report latency | `inventory-service`、availability report route | 无；现有 report endpoint 依赖 active table lock context |
| `INVENTORY_ROW_LOCK` | Hikari pending/utilization、reservation summary latency | `inventory-service`、reservation summary route | 无；现有 summary endpoint 依赖 active row-lock context |
| `PSP_PROVIDER_OUTCOME` | payment failure/timeout rate、payment HTTP latency | `payment-service`、`psp-simulator`、authorization route | 无；授权属于写路径 |

表中 metric 和 route 是 contract authoring 的目标范围，不是生产数据必然存在的承诺。每个 recipe 在 pilot 环境中都要用真实已部署 label/metric 验证。没有实际数据时使用 `NO_DATA` 或 `EVIDENCE_UNAVAILABLE`，不补零。

### 5.4.1 baseline 派生查询与对照

从每条 `window=active`、`observationMode=WINDOWED`、source 为 Prometheus/Loki/Tempo 的 recipe 派生一条 baseline execution item。执行 key 使用 `(originRecipeId, baseline)`，不改 Phase 3 recipe ID/DSL，也不另建 Catalog 场景 map。

- baseline 使用同一冻结 query、scope、单位、step 和 lookback，替换的只有已固定的执行窗口；CURRENT business check、Run Event 和 cleanup recipe 不派生。
- baseline 是可选对照证据：没有 baseline 不阻止已有 active effectRule 判断，但报告须显示 `BASELINE_UNAVAILABLE` 或对应限制。
- 仅当 baseline 与 active 都有完整覆盖且具有兼容数值投影时，当前响应展示同单位摘要及差值；基线为零时不算百分比，非有限值或不同投影不比较。
- NUMERIC 对照使用同名归约字段（例如 max 对 max、latest 对 latest），不比较 max 与 latest。COUNT 的窗口长度可能不同，默认并列显示计数与各自范围，不把未归一化的计数差称为增长率；不额外增加 Catalog 规则。
- baseline item 的 `predicate_outcome=INCONCLUSIVE`，它不进入 effectRule，不新增相对阈值，不将基线已有异常表述为本次运行造成。
- 数值、差值和对照只留在当前响应，DB 仅保存执行状态、覆盖、时间和限制。

### 5.4.2 冻结的执行协议

`rendered_plan_json` 保存有限模板派生的 query/check ID、固定 scope、单位、lookback、投影、predicate 解释、归约规则、baseline origin 映射，以及 `rendererRevision`、`evaluationRevision`。计划不得含 endpoint、凭据或遥测结果。

创建时一并冻结窗口硬上限：baseline 900s、active 为当次 Catalog `maxDurationSec + 60s`、recovery 2100s、cleanup 600s。它们是历史 materialization，不是第二个可编辑 Catalog；源 Run 被删除后也不得查当前 Catalog 重算。

Manifest 首次或再次物化都只使用冻结计划，不运行最新 renderer。执行时验证 DSL hash、plan hash、schema/version 和 query allowlist；无法解释的旧执行协议返回 `EVIDENCE_UNAVAILABLE / EXECUTION_PROTOCOL_UNSUPPORTED`，损坏或不安全计划返回 `INVALID_QUERY`，绝不重新渲染后假装使用原配方。持久 query 不能绕过固定 endpoint/check dispatch。

### 5.5 Gateway business read-check 边界

当前 Gateway 的下列固定内部观测路径不能纳入批次 4 的终态报告：

| 既有路径 | 原因 | 批次 4 处理 |
| --- | --- | --- |
| `/internal/gateway/inventory/availability` | 下游 `report()` 要求当前 active run、fencing token 和接受中的 run guard；release 后必然失效 | 仅保留原有运行期间诊断语义，不作为终态 evidence check |
| `/internal/gateway/inventory/reservations/summary` | 下游 `summary()` 要求当前 active row-lock context；release 后必然失效 | 同上 |
| `/internal/gateway/promotion/consistency` | 下游 consistency 检查要求 active prepared reservation；release 后必然失效 | 同上 |
| `/internal/gateway/notification/storage/append` | 真实写路径，会追加文件 | 永久排除 |

首版只使用两个不要求 Fault Run context 的既有正常业务路径：

| Read-check ID | 固定 Gateway 请求 | 允许场景 | 当前检查语义 |
| --- | --- | --- | --- |
| `CATALOG_PRODUCT_LIST` | `GET /api/products?sort=latest&page=0&size=1` | `BROWSE_SURGE`、`CATALOG_REDIS_LARGE_VALUE` | 证明报告发起时普通产品读取路径可达；不能证明历史 cache 影响 |
| `CATALOG_BROWSE_REPORT` | `GET /api/reports/product-browse` | `BROWSE_REPORT_SQL` | 证明报告发起时真实报表读取路径的当前结果；不能替代历史 latency evidence |

这些 GET 已通过 Gateway 路由到真实 Catalog 业务路径，且不需要转发 Operator 身份、Fault Run context、场景 ID、Catalog revision、Manifest 或查询窗口。响应在控制面内立即投影为 `PASS`、`FAIL`、`NO_DATA` 或受限 scalar，绝不回传业务行、SKU、订单、支付或原始 body。新增检查时必须先单独证明它是业务语义明确、固定、只读的操作；不能引入“按 ID/URL 转发”的通用检查接口。

## 6. Manifest、时间线与窗口

### 6.1 安全时间线投影

Manifest 只能包含窗口所需的受限事实：

```ts
type EvidenceTimeline = {
  createdAt: string;
  prepareStartedAt: string | null;
  activeAt: string | null;
  stopRequestedAt: string | null;
  recoveryStartedAt: string | null;
  recoveredAt: string | null;
  cleanupFinishedAt: string | null;
  terminalAt: string | null;
  terminalState: 'RECOVERED' | 'STOPPED' | 'FAILED' | 'SERVICE_UNAVAILABLE' | null;
};
```

时间点选择规则如下：

| 时间点 | 权威来源 | 说明 |
| --- | --- | --- |
| `createdAt` | `fault_runs.created_at` | 数据库服务器写入时间 |
| `prepareStartedAt` | 实际PREPARE action `dispatch_started_at`；如已有显式PREPARE_STARTED可复用 | 当前无通用event；没有可确认dispatch则null，不为展示补造事件 |
| `activeAt` | `TARGET_CONFIRMED` 与 `ACTIVE` 状态转换 | 事务中的状态转换时间；不使用第一笔流量时间 |
| `stopRequestedAt` | 既有 `STOP_REQUESTED` | stop命令受理事实，不能写重复事件 |
| `recoveryStartedAt` | safe-runtime对应attempt第一条实际DRAIN_STARTED；明确legacy路径可用既有RECOVERY_STARTED | 不从stopRequestedAt或202推导，缺失为null |
| `recoveredAt` | 匹配成功projection/attempt的RECOVERY_COMPLETED，或明确legacy SERVICE_RECOVERED | 不能只按event名称推导；失败/partial/VERIFY_UNAVAILABLE保留null |
| `cleanupFinishedAt` | `MANUAL_CLEANUP_COMPLETED` | 不能由终态或 release 推导 |
| `terminalAt` | `fault_runs.stopped_at` 与对应终态 event | 用于解释 failed/unavailable 的 active 终点 |

所有事件按 `(created_at, id)` 读取；同一毫秒内按递增 `id` 决定先后。所有外部 DTO 以 UTC ISO-8601 输出。窗口计算从数据库持久化时钟读取，不能用浏览器时钟、Node `Date.now()` 或解析失败的本地日期补齐历史 anchor。

`TARGET_CONFIRMED`、`PREPARE_STARTED`、`SCENARIO_WORKER_STARTED`、成功 API 返回或 `traceId` 都不能填充 `effectObservedAt`。阶段 4 将效果表达为报告中的一次 predicate assessment，而不是改写 Fault Run 生命周期。

### 6.2 确定性窗口算法

默认 policy 保持产品规格的语义，并为 Catalog override 设置硬上限：

| 窗口 | 默认 start | 默认 end | 硬上限 | 缺失时的行为 |
| --- | --- | --- | --- | --- |
| `baseline` | `activeAt - 5m` | `activeAt` | 15m | `NOT_READY: ACTIVE_BOUNDARY_MISSING` |
| `active` | `activeAt - 30s` | `recoveryStartedAt + 30s` | capture 时冻结的 max duration + 60s | 若无 recovery start，使用 `terminalAt + 30s` 并附限制；若无 terminal，`NOT_READY` |
| `recovery` | `recoveryStartedAt - 30s` | `recoveredAt + 5m` | 35m | `NOT_READY: RECOVERY_BOUNDARY_MISSING` |
| `cleanup` | `cleanupFinishedAt - 5m` | `cleanupFinishedAt` | 10m | 无适用 cleanup 为 `NOT_APPLICABLE`；适用但缺失为 `NOT_READY` |

窗口 resolver 必须：

1. 使用 frozen contract 的 policy，不能使用当前 Catalog policy。
2. 对 start/end 进行全局硬上限校验；违反时不查询后端，返回 `INVALID_QUERY`。
3. 保留 canonical start/end，不能为“方便重试”把历史窗口滑动到现在。
4. 对每个窗口单独标识 `READY`、`NOT_READY` 或 `NOT_APPLICABLE`；一个缺失 anchor 不能使其余窗口失效。
5. 在 Manifest 中记录 `clockSkewToleranceSec=60` 作为解释性信息，但不静默移动控制面窗口以适配 scrape/ingestion 时间。

### 6.3 Manifest revision

`EvidenceQueryManifest` 是不可变的。物化前先构建 canonical `timelineProjection`，再计算 `timelineHash`：

- `(sourceFaultRunId, timelineHash)` 已存在时返回原 Manifest。
- 任何可安全投影的生命周期事实新增或变化时生成递增 `manifestRevision`。
- 新 revision 只影响以后的 live report；旧 attempt 永远指向创建时的 `manifestId`。
- Manual cleanup 后产生的 revision 只增加 cleanup 相关窗口，不会篡改前一个 revision 对未清理事实的描述。
- 运行进入现有控制面 retention 前，Worker 在删除前调用同一 materializer 确保至少有最新 Manifest；该维护操作不查询外部观测后端。

`source_run_retained` 是可更新的来源存在性元数据，明确排除在 immutable Manifest core/hash 外；删除源行不能改写时间线、窗口、query plan 或旧 attempt。源运行尚存时，物化与 cleanup/retention 使用共同的数据库锁顺序，避免读取半新时间线。

旧 Fault Run 没有 frozen contract snapshot 时，接口返回：

```json
{
  "evidenceStatus": "EVIDENCE_UNAVAILABLE",
  "reasonCode": "CONTRACT_SNAPSHOT_UNAVAILABLE",
  "snapshotState": "LEGACY_UNVERSIONED"
}
```

禁止把当前 Catalog snapshot 绑定到旧运行后称为“历史 Manifest”。

## 7. 数据模型与迁移

### 7.1 持久化边界

Evidence 数据库只保存查询协议、受控生命周期投影、执行元数据和 Operator note；不保存遥测结果。`fault_runs` 仍由现有 7 天 retention 管理，但 Manifest 不能对它设置 `ON DELETE CASCADE`，以便在运行行被清理后仍可解释曾使用的安全查询协议与窗口。

新增表必须同时写入：

- `traffic-control-plane/src/lib/fault-run-schema.ts` 的 schema creation statements；
- `traffic-control-plane/src/lib/migrations/00N-evidence-query.sql`，其中 `00N` 是下一个未使用顺序号，仅供 clean-slate reset 后的空数据库执行 `db:migrate` 时创建 Evidence schema；
- `infra/mysql/init/0N-evidence-query-schema.sql`，其中 `0N` 是 fresh-install script 的下一个未使用顺序号，仅用于空数据库初始化。

本批次只支持 clean-database bootstrap，不支持已有 volume/schema 的升级。migration SQL 与 init SQL 是两条 fresh-install 路径，不是对既有数据的 expand/upgrade migration；实现和验收不得承诺旧 volume 兼容。`db:migrate` 路径与 MySQL init 路径都必须从空数据库得到等价 schema。

### 7.2 `evidence_contract_snapshots`

每个带 capture 的新运行一条 frozen 合同。它是 Catalog 的历史 materialization，不是第二份可编辑 Catalog。

```sql
CREATE TABLE evidence_contract_snapshots (
  snapshot_id CHAR(36) NOT NULL PRIMARY KEY,
  source_fault_run_id CHAR(36) NOT NULL,
  scenario VARCHAR(64) NOT NULL,
  contract_schema_version VARCHAR(64) NOT NULL,
  contract_revision VARCHAR(128) NOT NULL,
  contract_hash CHAR(64) NOT NULL,
  contract_json JSON NOT NULL,
  renderer_revision VARCHAR(64) NOT NULL,
  evaluation_revision VARCHAR(64) NOT NULL,
  rendered_plan_hash CHAR(64) NOT NULL,
  rendered_plan_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_evidence_contract_source_run (source_fault_run_id),
  INDEX idx_evidence_contract_scenario_revision (scenario, contract_revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`contract_json` 只含 validated template、scope、predicate、窗口 policy、required 标记和固定 Gateway check ID。它不得包含 endpoint URL、credential、Operator 输入、业务请求 payload 或遥测数据。

`rendered_plan_json` 按第 5.4.2 节保存实际查询协议和窗口硬上限；其 canonical hash 与 `rendered_plan_hash` 一致。已有 `evidence-contract-snapshot.ts` 的 DSL record/seam 保持职责，新的 capture record 组合该 record 与冻结计划，不把 plan 混入 Phase 3 DSL hash。

### 7.3 `evidence_query_manifests`

每个终态时间线 revision 一条不可变 Manifest：

```sql
CREATE TABLE evidence_query_manifests (
  manifest_id CHAR(36) NOT NULL PRIMARY KEY,
  snapshot_id CHAR(36) NOT NULL,
  source_fault_run_id CHAR(36) NOT NULL,
  scenario VARCHAR(64) NOT NULL,
  manifest_schema_version VARCHAR(64) NOT NULL,
  contract_revision VARCHAR(128) NOT NULL,
  manifest_revision INT UNSIGNED NOT NULL,
  timeline_hash CHAR(64) NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  timeline_json JSON NOT NULL,
  windows_json JSON NOT NULL,
  recipes_json JSON NOT NULL,
  limitations_json JSON NOT NULL,
  source_run_retained TINYINT NOT NULL DEFAULT 1,
  materialized_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_evidence_manifest_source_timeline (source_fault_run_id, timeline_hash),
  UNIQUE KEY uq_evidence_manifest_source_revision (source_fault_run_id, manifest_revision),
  INDEX idx_evidence_manifest_source (source_fault_run_id, manifest_revision),
  INDEX idx_evidence_manifest_contract (contract_revision, materialized_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`timeline_json` 是第 6.1 节的严格 schema，不复制原始 `fault_run_events.payload`。`windows_json` 和 `recipes_json` 是 copyable query protocol；它们不包含 provider response。`source_run_retained` 在现有 Fault Run retention 删除源行之前切换为 `0`，使 UI 能解释数据来源仍是冻结 Manifest 而非仍存在的 Fault Run。

当前版本刻意不对 `snapshot_id` 或 `source_fault_run_id` 添加会随着 Fault Run 删除而级联删除的 foreign key。未来阶段 5 若要关联 incident/case，必须作为独立 schema 变更并保留现有 Manifest 不可变；在当前 clean-slate 部署策略下，新字段需进入两条 fresh-bootstrap 路径。若未来改为保留数据库部署，需另行决策并验证升级策略，不能把当前设计视为已有 volume migration 承诺。

### 7.4 Attempt、单项状态和 Note

```sql
CREATE TABLE evidence_query_attempts (
  attempt_id CHAR(36) NOT NULL PRIMARY KEY,
  manifest_id CHAR(36) NOT NULL,
  source_fault_run_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  state VARCHAR(32) NOT NULL,
  evidence_status VARCHAR(32) NULL,
  operator_audit_id BIGINT NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deadline_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  total_duration_ms INT UNSIGNED NULL,
  failure_code VARCHAR(64) NULL,
  UNIQUE KEY uq_evidence_attempt_idempotency (source_fault_run_id, idempotency_key),
  INDEX idx_evidence_attempt_manifest_time (manifest_id, requested_at),
  INDEX idx_evidence_attempt_run_deadline (source_fault_run_id, state, deadline_at),
  CHECK (state IN ('RUNNING', 'COMPLETED', 'EVIDENCE_UNAVAILABLE', 'FAILED')),
  CHECK (evidence_status IS NULL OR evidence_status IN
    ('AVAILABLE', 'PARTIAL', 'EVIDENCE_UNAVAILABLE', 'INVALID_QUERY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE evidence_query_attempt_items (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  attempt_id CHAR(36) NOT NULL,
  recipe_id VARCHAR(96) NOT NULL,
  source VARCHAR(24) NOT NULL,
  window_name VARCHAR(24) NOT NULL,
  availability VARCHAR(32) NOT NULL,
  coverage VARCHAR(16) NOT NULL,
  predicate_outcome VARCHAR(16) NOT NULL,
  reason_code VARCHAR(64) NULL,
  duration_ms INT UNSIGNED NULL,
  queried_at DATETIME(3) NULL,
  executed_start_at DATETIME(3) NULL,
  executed_end_at DATETIME(3) NULL,
  UNIQUE KEY uq_evidence_attempt_recipe_window (attempt_id, recipe_id, window_name),
  INDEX idx_evidence_attempt_item_attempt (attempt_id),
  CHECK (source IN ('RUN_EVENT', 'PROMETHEUS', 'LOKI', 'TEMPO',
                    'BUSINESS_CHECK', 'RESOURCE_CHECK')),
  CHECK (availability IN ('AVAILABLE', 'NO_DATA', 'EVIDENCE_UNAVAILABLE',
                           'INVALID_QUERY', 'NOT_APPLICABLE')),
  CHECK (coverage IN ('FULL', 'PARTIAL', 'NONE', 'NOT_APPLICABLE')),
  CHECK (predicate_outcome IN ('MET', 'NOT_MET', 'INCONCLUSIVE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE evidence_operator_notes (
  note_id CHAR(36) NOT NULL PRIMARY KEY,
  manifest_id CHAR(36) NOT NULL,
  source_fault_run_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  operator_audit_id BIGINT NOT NULL,
  note_text VARCHAR(2048) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_evidence_note_audit (operator_audit_id),
  UNIQUE KEY uq_evidence_note_idempotency (source_fault_run_id, idempotency_key),
  INDEX idx_evidence_note_manifest_time (manifest_id, created_at, note_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

这些表刻意没有 `result_json`、`summary_json`、`raw_error`、endpoint 或 credential 字段。查询过程中的数值摘要只存在于内存和当前 `Cache-Control: no-store` HTTP 响应中。`predicate_outcome` 是允许保存的判断记录，不是遥测快照。

### 7.5 retention 与历史行为

| 数据 | 本批次策略 |
| --- | --- |
| `fault_runs` / `fault_run_events` | 保持现有 7 天控制面 retention |
| Contract snapshot / Manifest / metadata-only attempt / note | 独立于 Fault Run 保留；Phase 4 不新增自动删除策略 |
| Prometheus / Loki / Tempo 数据 | 由各观测后端自身 retention 管理；不复制 |
| future Phase 5 case/report | 后续阶段定义显式审计 retention 前不得删除被引用 Manifest |

`deleteExpiredFaultRuns()` 在删除 eligible 运行之前必须：

1. 加载其已冻结 Contract snapshot；
2. 调用 idempotent materializer 写入最新终态 Manifest；
3. 将该运行现有 Manifest 的 `source_run_retained` 更新为 `0`；
4. 在同一事务中执行现有 event/run 删除；
5. 当没有 snapshot 的 legacy run 时维持当前删除行为。

源行被删除后，Manifest 仍可显示安全时间线和查询配方。Prometheus/Loki/Tempo recipe 仍可在各自 retention 覆盖时查询；首版 `CURRENT` Gateway read-check 不依赖 Fault Run context，因此仍可执行，但其输出必须保持为“报告当前时刻的恢复检查”，绝不回填为历史效果或清理事实。所有历史 window source 都不再可用时，live report 返回 `EVIDENCE_UNAVAILABLE` 而不是“无故障”。

## 8. API 设计

所有接口都是 Operator-only `/internal/**` API。GET 要求既有 Operator session；每个 POST 同时要求 session、CSRF、严格 JSON body 和 idempotency key。接口使用现有 `{ code, message, data }` envelope，并在响应上设置：

```text
Cache-Control: no-store
Pragma: no-cache
Referrer-Policy: no-referrer
```

### 8.1 Manifest 查询

```text
GET /internal/fault-runs/{faultRunId}/evidence
```

行为：

- UUID 格式非法返回 `400 INVALID_FAULT_RUN_ID`。
- 活跃运行返回 `409 RUN_NOT_TERMINAL`。
- 有 snapshot 的终态运行返回现有或新物化的最新 Manifest。
- legacy 运行返回 `200` 的结构化 `EVIDENCE_UNAVAILABLE / CONTRACT_SNAPSHOT_UNAVAILABLE`，使 UI 能明确区分“此运行不具备历史合同”与“未知 ID”。
- 源 Fault Run 已由 retention 删除但 Manifest 仍在时，返回冻结 Manifest 与 `sourceRunRetained: false`。
- 完全未知 ID 返回 `404 FAULT_RUN_NOT_FOUND`。
- 不调用 Prometheus、Loki、Tempo、Gateway、Coordinator 或任何业务服务。

简化返回形状如下：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "manifestId": "uuid",
    "manifestRevision": 2,
    "contractRevision": "sha256",
    "manifestHash": "sha256",
    "sourceRunRetained": true,
    "timeline": {},
    "windows": [],
    "recipes": [],
    "limitations": []
  }
}
```

### 8.2 实时报告

```text
POST /internal/fault-runs/{faultRunId}/evidence/reports
X-Idempotency-Key: evidence-{client-id}
X-CSRF-Token: {csrf-token}
Content-Type: application/json

{ "manifestId": "uuid", "manifestHash": "sha256", "confirmed": true }
```

`manifestId` 必须属于 URL 中的源运行，`manifestHash` 必须匹配该不可变 Manifest。使用明确选中的旧 revision 是合法的历史复查，不要求它是 latest；错误 ID/hash 返回 `409 MANIFEST_REVISION_MISMATCH`。请求体明确不允许 `promql`、`logql`、`traceql`、`source`、`url`、`window`、`route`、`operation`、`parameters` 或任何业务 ID。

| 情况 | HTTP | 结构化结果 |
| --- | ---: | --- |
| 适用查询完整可复查，required 控制事实齐全 | `200` | `AVAILABLE` |
| 部分项不可用/缺覆盖，但仍有历史遥测可解释 | `200` | `PARTIAL` |
| 历史遥测都不可用/未就绪，即使 timeline 可读 | `200` | `EVIDENCE_UNAVAILABLE` |
| frozen Manifest/recipe 不满足内部约束 | `422` | `INVALID_QUERY` |
| Manifest ID/hash 不匹配 | `409` | `MANIFEST_REVISION_MISMATCH` |
| 同一 key 的 request signature 不同 | `409` | `IDEMPOTENCY_KEY_REUSED` |
| 运行未终态 | `409` | `RUN_NOT_TERMINAL` |
| 当前并发额度已满 | `429` | `EVIDENCE_QUERY_BUSY` |
| 无 session/CSRF/格式非法 | 现有 `401`/`403`/`400` | 正常错误 envelope |

每次新 idempotency key 代表一次明确的实时重查。report key 的范围是 `(sourceFaultRunId, idempotencyKey)`，`requestHash` 覆盖选中 Manifest ID/hash 和规范化确认字段。同 key/same signature 在最新时间线判断之前查找已有 attempt，返回 metadata-only replay，不访问 source；同 key/different signature 返回 `409 IDEMPOTENCY_KEY_REUSED`。cleanup 创建新 revision 不改变旧请求的 replay；重查新 revision 要新 key。浏览器网络重试保留原 ID/hash/key，不自动换成 latest。无即时遥测摘要重放是有意的“无快照”取舍。

### 8.2.1 中断 attempt 惰性结算

创建 attempt 时用数据库当前时间固定 `deadline_at=requested_at + totalTimeout + 5s`，后者 5s 仅供取消及元数据收尾，不延长 source 查询 deadline。下一次该源运行的 report/history 请求，先将过期的 RUNNING attempt 以 CAS 转为 `FAILED / EXECUTION_INTERRUPTED`，写 `completed_at` 和安全审计。

正常完成、取消和惰性结算共享 `state=RUNNING` 的条件更新，过期完成写入还要校验 deadline；item/attempt/audit 终态事务同成同败。迟到进程不能覆盖已结算状态。相同 key 只回放 FAILED metadata，新查询必须由 Operator 用新 key 发起。这个有限、数据库本地的结算不查询 source、不执行 recovery、不新增 Worker timer/queue；没有后续请求时记录可保持 RUNNING，但 history 在展示前必须结算。

客户端主动取消在仍可写DB时记录 `FAILED / EXECUTION_CANCELLED`；控制面总查询预算耗尽但可形成结构化报告时，未执行完的项记录 `SOURCE_TIMEOUT` 或 `REPORT_DEADLINE_EXCEEDED`，按已有证据聚合为 PARTIAL/EVIDENCE_UNAVAILABLE，不误称进程中断。只有失去正常收尾事实的过期RUNNING才由惰性CAS写EXECUTION_INTERRUPTED。

### 8.2.2 历史 Manifest 入口

```text
GET /internal/fault-runs/{faultRunId}/evidence/manifests
GET /internal/fault-runs/{faultRunId}/evidence/manifests/{manifestId}
```

列表使用有界 limit/cursor，返回 revision/hash/物化时间和限制；详情返回指定 frozen core。所有读取检查 source ownership、Operator session 和 no-store，不执行 source 查询。源 Run 删除后仍通过 retained Manifest 查询。report history 明确关联 revision，UI 可选择旧 Manifest 并用其 ID/hash 发起显式重查；不自动替换旧窗口或显示过去的数值摘要。

### 8.3 历史与分析笔记

```text
GET  /internal/fault-runs/{faultRunId}/evidence/reports
GET  /internal/fault-runs/{faultRunId}/evidence/notes
POST /internal/fault-runs/{faultRunId}/evidence/notes
```

reports history 只返回 attempt ID、Manifest revision/hash、请求/结束时间、总状态、单项 availability/coverage/predicate outcome、reason code、时长和 audit ID；不返回数值摘要或 provider response。

notes 是 Operator 的辅助分析，不能替代任何控制、效果、恢复、清理或遥测事实。POST 的约束如下：

- plain text，最大 2,048 UTF-8 characters；
- 禁止 HTML、credential、token、cookie、Authorization、完整日志/trace 导出和业务 payload；
- 创建后 append-only；首版不支持编辑或删除，避免无法审计的改写；
- note 正文只保存在 note 表中，审计记录只 hash request metadata，不存正文。

Note body 必须提供选中 `manifestId`、`manifestHash` 和 plain-text `text`，header 提供 idempotency key。规范化只做换行统一，不静默删改正文。key 按 `(sourceFaultRunId, idempotencyKey)` 唯一，`requestHash` 对 ID/hash 与规范化正文计算哈希；同 key/same signature 回放 note metadata，同 key/different signature 返回 409。note、audit 和 idem record 同事务提交，网络重试不能生成重复正文或审计。

敏感内容校验采用有界、确定性的结构/显式凭据模式拒绝，显示固定 reason code，不回显被拒内容；HTML 和遥测/业务 JSON 导出不能作为 note。此校验不保证识别所有自然语言 secret，UI 必须提示勿粘贴敏感内容，默认 HTML escape，不新增外部检测服务或依赖。

### 8.4 Audit 行为

| 动作 | `operator_audit_logs.action` | `target` | parameters 中允许的字段 |
| --- | --- | --- | --- |
| 实时报告开始/结束 | `EVIDENCE_REPORT_EXECUTE` | `manifestId` | `faultRunId`、manifest revision/hash、idempotency key |
| 分析笔记创建 | `EVIDENCE_NOTE_CREATE` | `manifestId` | note ID、长度、manifest revision |

不能调用 `attachOperatorAudit()` 把这些动作覆盖进 `fault_runs.operator_audit_id`；该列目前只容纳一条关联审计。attempt/note 通过自己的 `operator_audit_id` 关联。

## 9. Query executor 设计

### 9.1 模块职责

| 模块 | 职责 |
| --- | --- |
| `evidence-types.ts` | 严格的 Contract、Manifest、窗口、状态、DTO 和 JSON guard |
| `evidence-contract-snapshot.ts`（已有）与 capture plan 模块 | 复用 Phase 3 DSL seam，组合冻结渲染计划/版本/上限，不镜像定义 |
| `evidence-manifest.ts` | 安全事件投影、时间线折叠、窗口解析、Manifest hash/revision |
| `evidence-repository.ts` | snapshot、Manifest、attempt、item、note 的参数化 SQL 与事务 |
| `evidence-query-clients.ts` | Prometheus、Loki、Tempo 的 typed bounded client |
| `evidence-business-checks.ts` | 固定 Gateway read-check ID 到既有 path 的唯一映射 |
| `evidence-report-service.ts` | retention preflight、并发、deadline、判定、response shaping |
| `evidence-view.ts` | UI 使用的防御性投影，绝不渲染原始 provider payload |

`FaultRunCoordinator` 只在capture开启时消费由Web入口提供的类型化capture输入；flag关闭不要求snapshot，不持有source executor。既有action、STOP_REQUESTED和Worker恢复事件复用，不为Phase 4重复写生命周期事件。Web route编排认证、请求校验、审计和service调用，不持有模板或业务路径。

创建、note 和 report audit 需要复用现有审计行为的 transaction-aware seam；不得用 broad catch 吞掉审计失败。诊断不可写入 note text、查询结果或原始错误。

### 9.2 调用限制

| 限制 | 默认 | 上限/规则 |
| --- | ---: | --- |
| 每个 source timeout | 5 秒 | 小于总 deadline，配置范围 100ms～8s |
| 单个 live report 总 deadline | 15 秒 | 配置范围 1s～20s |
| 单报告内并行 recipe | 4 | 最大 4；每 source 最多 2 |
| 单 Web 进程并行 report | 1 | 最大 2；满时 `429`，不排队 |
| 单响应体 | 1 MiB | 超限丢弃并标记 `QUERY_RESULT_TOO_LARGE` |
| Prometheus/Loki step | 最小 15 秒 | 结果点数每 series 最大 1,500 |
| Tempo search result | 最大 100 条 | 仅内存聚合后立刻释放 |
| 重试 | 最多 1 次 | 仅网络错误、timeout、429、502、503、504；保持在总 deadline 内 |

不重试 `400`/`401`/`403`、静态 recipe 校验失败、retention 过期或 manifest mismatch。所有 `fetch` 必须设置 `AbortSignal`、`redirect: 'error'`、response byte cap 和严格 content-type/JSON shape 校验。

上述网络/资源限制同样适用于 Gateway CURRENT GET，不只适用于观测后端。扩展或抽取 `GatewayClient` 的 bounded read seam，保留已有调用默认行为；检查使用限定 GET、signal、byte cap、redirect 拒绝和严格 envelope guard。不能先 `res.json()` 无界读入再投影；超限/非法/业务 envelope 非成功分别输出安全 unavailable/check-failure，不保存或回显响应正文。

### 9.3 Source-specific 查询与内存摘要

| Source | 调用方式 | 可返回给当前 Operator 的摘要 | 永不保存/显示 |
| --- | --- | --- | --- |
| Prometheus | `/api/v1/query_range`，服务端给定 start/end/step | finite sample count、min/max/latest、predicate outcome | labels、完整 sample array、exemplar、原始 body |
| Loki | `/loki/api/v1/query_range`，仅 aggregate metric LogQL | series/bucket count、count summary、predicate outcome | log line、stream label dump、stack trace |
| Tempo | 固定 TraceQL search endpoint，bounded limit | trace count、error count、duration bucket、predicate outcome | trace ID、span、attribute、raw result |
| Business check | 固定的正常业务 GET 和静态参数 | `PASS`/`FAIL`/`NO_DATA` 或已批准 scalar，附 `checkedAt` | 原始 envelope、业务行、SKU、order/payment/customer data |
| Run event | repository 读取 Manifest/time line | anchor/窗口状态 | 任意 event payload、恢复错误文本 |

Provider 失败统一映射为安全 reason code：`SOURCE_UNCONFIGURED`、`SOURCE_UNREACHABLE`、`SOURCE_TIMEOUT`、`SOURCE_RATE_LIMITED`、`SOURCE_UNAUTHORIZED`、`SOURCE_RESPONSE_INVALID`、`QUERY_RESULT_TOO_LARGE`、`RETENTION_EXPIRED`、`BUSINESS_CHECK_UNAVAILABLE`、`BUSINESS_CHECK_TIMEOUT`。不向 UI、审计或日志传递原始 exception message。

### 9.4 retention preflight 和 coverage

每个 source 有独立的已声明 retention duration。执行前以 MySQL `CURRENT_TIMESTAMP(3)` 取得一次控制面当前时间：

1. `window.end < now - retention`：窗口完全在已声明 retention 之外；不发出 provider 请求，结果为 `EVIDENCE_UNAVAILABLE / RETENTION_EXPIRED / NONE`。
2. `window.start < now - retention <= window.end`：保留 canonical 窗口，不向“当前”滑动。可以查询，但结果至少标记 `coverage=PARTIAL`，predicate 只能得到 `INCONCLUSIVE`。
3. 完全在已声明 retention 内：仅是 eligible-for-full，最终 coverage 还取决于未来尾部、lookback、实际结果完整性及后端状态，不能直接写 `FULL`。

`NO_DATA` 表示后端成功返回但没有匹配材料；它与 `EVIDENCE_UNAVAILABLE` 不同。只有 Manifest 明确给出可判断的 predicate 时，`NO_DATA` 才可能产生 `NOT_MET`；否则必须为 `INCONCLUSIVE`。

未来窗口尾部：保留 canonical start/end，以一次 DB query time 限定 `executedEnd=min(canonicalEnd, queriedAt)`。若 end 尚未到达，附 `WINDOW_NOT_SETTLED`、`coverage=PARTIAL`；尚无正长度范围则不查询。不得等待 5 分钟或滑动 Manifest。该 item predicate 为 INCONCLUSIVE；其他已闭合的 active item 仍独立判断，不让未来 recovery tail 推翻已完整的 active 事实。之后 Operator 新 key 重查。

range lookback：冻结计划记录每个 query 的输入依赖窗口，retention 要从 `canonicalStart-lookbackSec` 检查，而非只从输出 start 检查。返回样本的缺口、NaN/Inf、provider warning/partial metadata、缺 scrape 数据都降低 coverage 或导致 unavailable；不得按 HTTP 200 判定完整。记录 canonical/实际执行范围与安全 coverage reason，仅保存在 attempt 元数据/允许投影中。

Tempo limit 达到 100、后端 search 未完成或无法证明结果完整时输出 `SEARCH_INCOMPLETE / PARTIAL`，不分页扩为无限查询、不计算精确总体计数、不做否定效果判断。仅完整 search 的匹配 trace 集合可以按去重 trace count 判断；不是 span count。空集合只有可确认完整搜索时才可解释为零，不能把未完成搜索当 NO_DATA。

### 9.4.1 单位、归约与 predicate

冻结执行协议明确定义每个模板的 value unit 和 predicate interpretation。NUMERIC 模板使用 query 已有的固定聚合；仍返回多 series 时对每个合法 series/sample 判断，不额外把 ratio/p99 相加。active 的完整有效集合中任一采样满足 Catalog comparison 即 MET，全部不满足才 NOT_MET；recovery 则全部满足才 MET，存在不满足为 NOT_MET。baseline 仅计算 min/max/latest 对照，不产生效果 predicate。

COUNT 模板比较匹配数量与同单位 count 阈值。Loki 滚动 `count_over_time` bucket 按时序 predicate 处理，不能累加重叠 bucket 冒充总日志条数。`SERVICE_SLOW_REQUESTS` 的 Catalog comparison value 单位为秒，冻结为 TraceQL duration filter；输出为匹配慢请求的 trace count，presence 判断是 count > 0，而不是“trace 数 > 秒数”。其他 Tempo count 模板（例如 storage 的 `SERVICE_ROUTE_REQUESTS`）按 Catalog 的 count comparison 判断。未知单位/解释组合 capture 时阻断，不临时更改 DSL 字段或阈值。

NONE predicate 始终 INCONCLUSIVE；CURRENT `CATALOG_PRODUCT_LIST`/`CATALOG_BROWSE_REPORT` 可显示受控 check PASS/FAIL，但不能将列表可达宣称为 run-scoped cache、资源清理或整条业务恢复已证实。

### 9.5 总体状态与效果判断

```text
per item availability:
  AVAILABLE | NO_DATA | EVIDENCE_UNAVAILABLE | INVALID_QUERY | NOT_APPLICABLE

overall evidence status:
  AVAILABLE | PARTIAL | EVIDENCE_UNAVAILABLE | INVALID_QUERY

attempt state:
  RUNNING | COMPLETED | EVIDENCE_UNAVAILABLE | FAILED
```

- 分别计算 `controlFactsStatus`、`telemetryStatus`、`currentBusinessChecksStatus` 和最终 `evidenceStatus`。历史遥测指 source 为 Prometheus/Loki/Tempo 的 WINDOWED 项；Run Event 和 CURRENT 不得作为历史遥测可用的替代品。
- 全部 historical telemetry 均不可用/未就绪时，最终为 `EVIDENCE_UNAVAILABLE`，即使 timeline 或 CURRENT check 成功。完整 search 的 NO_DATA 可作为成功查询的结果保留，但不据此证明正常。
- 有可解释的历史遥测，但任一已声明 applicable recipe 缺失、部分覆盖或 required 控制事实缺失时，最终为 `PARTIAL`；optional baseline/log/trace 不可用也显示 PARTIAL，不将缺口藏为 AVAILABLE。
- 所有 applicable 项完整可复查且 required 控制事实齐全时才 `AVAILABLE`，predicate 为 NOT_MET 不影响查询可用性。NOT_APPLICABLE 项不降低状态。
- 违反 frozen Manifest 内部不变量时才是 `INVALID_QUERY`；不把 provider `400` 或 outage 错误伪装成 contract defect。
- `FAILED` 只代表本控制面自身无法创建/完成 attempt 元数据等编排或存储故障；provider timeout、不可达和 retention 过期都是结构化 evidence outcome。

报告另行给出：

```ts
type EffectAssessment = 'OBSERVED' | 'NOT_OBSERVED' | 'INCONCLUSIVE';
```

单项 partial/unavailable/未定义判断为 INCONCLUSIVE，组合严格使用冻结 Catalog 的 mode：

| Mode | OBSERVED | NOT_OBSERVED | INCONCLUSIVE |
| --- | --- | --- | --- |
| ALL | 所有成员都是完整覆盖的 MET | 至少一个完整覆盖的 NOT_MET | 无 NOT_MET 但至少一个成员未知 |
| ANY | 至少一个完整覆盖的 MET | 所有成员都是完整覆盖的 NOT_MET | 无 MET 但至少一个成员未知 |

这只是该 effectRule 的三态逻辑结果，不能把某个缺失 recipe 的状态改为完整。整体 report 可以 PARTIAL，而 ANY effect 是 OBSERVED；UI 必须同时显示两者。该结果不改变 Fault Run 状态，不写入 EFFECT_OBSERVED event，也不替代真实恢复或清理事实。

## 10. 安全、隐私和网络边界

### 10.1 输入与查询安全

1. Operator HTTP 请求永远不能携带 query、endpoint、scope 或业务操作。
2. Catalog contract 在 CI 和启动时做所有静态安全校验；不安全 contract 阻断对应运行的 snapshot capture。
3. query client 只连接显式配置的精确 origin，拒绝非 HTTP(S)、userinfo、redirect 和意外 content type。
4. 不暴露 Prometheus/Loki/Tempo proxy，也不把 source URL 返回到浏览器。
5. `GRAFANA_BASE_URL` 和当前 `TEMPO_BASE_URL` 保持 deep-link/展示用途，不能被复用为查询权限配置。
6. 业务检查始终通过 `GatewayClient` 和既有固定 Gateway route；首版只允许无 Fault Run context 的正常业务 GET，控制面不直接访问业务服务。
7. Evidence 模块不得导入或调用 Coordinator 的 stop/recover、target adapter、cleanup route 或 Worker 执行器。

### 10.2 脱敏与输出规则

- API response 只允许严格 DTO；不对 provider JSON、event payload 或 business envelope 做透传。
- query/error string 中可能出现的 bearer token、password、secret、API key、session ID、email、URL query value 和 URL credential 必须删除或映射为 reason code。
- Pino 日志最多记录 attempt/manifest ID、source enum、recipe ID、状态、时长和 reason code；不记录 query、source response、note、parameter、endpoint 或 raw exception。
- 新增 feature metrics 只使用低基数 `source`、`outcome`、`operation` 标签；严禁使用 Fault Run ID、Manifest ID、query、route、Operator ID、trace ID 或业务 ID。
- 浏览器把实时报告只放在 React memory，不使用 localStorage、sessionStorage、URL search params、download 或复制 raw provider response。

### 10.3 网络和凭据

Compose pilot 中 Web/API 使用内部 DNS：

```text
http://prometheus:9090
http://loki:3100
http://tempo:3200
http://gateway-service:8080
```

这些 endpoint 仅传入 `traffic-control-plane` Web/API 容器。Worker 不执行 live report，因此不需要 Prometheus/Loki/Tempo credential。Kubernetes/shared deployment 中：

- endpoint 通过 ConfigMap 提供，credential 仅通过专用 Secret 或 mTLS sidecar/gateway 提供；
- 不复用 `CONTROL_PLANE_SESSION_SECRET`、`CASTREL_INTERNAL_SERVICE_KEY`、数据库密码、Alertmanager receiver 凭据或开发 Basic Auth；
- 为 Web/API Pod 添加最小 egress NetworkPolicy，仅允许 MySQL、Redis、Gateway 和配置的观测服务端口；
- 不给 Shopfront、业务服务或 Agent 接入部署这些 query credential。

## 11. 配置、部署与可观测性

### 11.1 环境变量

配置放在独立 `traffic-control-plane/src/lib/evidence-web-config.ts`，由Web Node instrumentation启动校验，遵循现有strictBoolean/strictBoundedInteger风格：非法显式值失败，不静默clamp/fallback，不在错误中回显值。共享env.ts和Worker不导入/解析此配置。所有feature默认关闭，空source URL显式表示SOURCE_UNCONFIGURED，不回退公网、宿主机或Grafana。

execution开启必须query开启；capture与query独立，允许capture-only和只读既有Manifest模式。配置的三个endpoint须为无userinfo/query/fragment的HTTP(S)精确origin；credential必须完整配对，拒绝header控制字符，仅服务端使用。totalTimeout必须大于sourceTimeout，最大recipe/report并发按表限定，per-source上限固定2；正整数retention只作为声明，不保证数据存在。Worker retention从DB读取snapshot/plan，不需要capture flag或endpoint。

env配置变更需要应用新配置/进程重启后才对新请求生效，不能把修改部署环境变量本身声称为热更新kill switch；在途请求保持原deadline。后续入口每次读取当前Web配置以执行开关边界。

| 变量 | 默认 | 用途 |
| --- | ---: | --- |
| `EVIDENCE_MANIFEST_CAPTURE_ENABLED` | `false` | 新运行是否原子冻结 Contract snapshot |
| `EVIDENCE_QUERY_ENABLED` | `false` | 是否公开 Operator Manifest/历史 UI 与 API |
| `EVIDENCE_QUERY_EXECUTION_ENABLED` | `false` | 是否允许向外部观测 source 发 live query |
| `EVIDENCE_PROMETHEUS_BASE_URL` | 空 | 精确的内部 Prometheus origin |
| `EVIDENCE_LOKI_BASE_URL` | 空 | 精确的内部 Loki origin |
| `EVIDENCE_TEMPO_BASE_URL` | 空 | 精确的内部 Tempo origin |
| `EVIDENCE_OBS_USERNAME` / `EVIDENCE_OBS_PASSWORD` | 空 | 可选专用 source credential；仅 Secret 注入 |
| `EVIDENCE_SOURCE_TIMEOUT_MS` | `5000` | 单 source deadline |
| `EVIDENCE_REPORT_TOTAL_TIMEOUT_MS` | `15000` | 单 live report 总 deadline |
| `EVIDENCE_MAX_PARALLEL_RECIPES` | `4` | 单报告 recipe 并发 |
| `EVIDENCE_MAX_CONCURRENT_REPORTS` | `1` | 单 Web 进程 report 并发 |
| `EVIDENCE_MAX_RESPONSE_BYTES` | `1048576` | source response byte cap |
| `EVIDENCE_PROMETHEUS_RETENTION_SEC` | `604800` | Prometheus 已声明 retention |
| `EVIDENCE_LOKI_RETENTION_SEC` | `604800` | Loki 已声明 retention |
| `EVIDENCE_TEMPO_RETENTION_SEC` | `604800` | Tempo 已声明 retention |

`EVIDENCE_MANIFEST_CAPTURE_ENABLED=true` 且 Contract snapshot 写入失败时必须拒绝启动目标操作。`EVIDENCE_QUERY_EXECUTION_ENABLED=false` 是首要 kill switch：它立即阻止新的 source query，但不影响已有 Manifest、Fault Run、Worker、stop、release 或 cleanup。

### 11.2 Compose 与 Kubernetes 差异

| 环境 | 当前事实 | 批次 4 启用要求 |
| --- | --- | --- |
| Compose | Prometheus、Loki、Tempo 均以 `168h` 为配置目标；Promtail 已为容器日志配置 service label | 首个 pilot 环境；确认实际 metric/label/TraceQL 语法后才开启 execution |
| Kubernetes Prometheus/Tempo | 配置声明均以 `168h` 为目标，但当前使用 `emptyDir`；Pod 重启会提前丢失数据 | 可配置 endpoint，但 retention preflight 只能按声明解释；不承诺重启后的历史数据 |
| Kubernetes Loki | 当前 Loki 使用默认 local config，未挂载 Compose 的 168h retention 配置 | 不开启 Loki recipe execution，直到补齐明确 retention、持久存储/风险说明和 log shipping |
| Kubernetes log shipping | 当前 `kustomization.yaml` 未包含 Promtail 资源 | 在 Kubernetes pilot 前新增并验证受控 log shipping；否则 Loki source 必须显式 `SOURCE_UNCONFIGURED` |

部署配置变化必须同时覆盖 Compose、Web/API Deployment、Kubernetes ConfigMap/Secret、NetworkPolicy 和 README 的 Operator 指引。仅修改 Docker Compose 不能表示 Kubernetes 支持证据查询。

### 11.3 Evidence 功能自身的诊断

若接受新增控制面 metrics，使用低基数指标：

```text
castrel_evidence_manifest_materializations_total{outcome}
castrel_evidence_report_requests_total{outcome}
castrel_evidence_source_requests_total{source,outcome}
castrel_evidence_source_duration_seconds{source}
castrel_evidence_reports_in_flight
```

不接受新增依赖时，首版以结构化 Pino 事件、Operator audit 和 metadata-only attempt history 为诊断面。无论采用哪种方式，都不能把 report 内容暴露到 Prometheus metric、日志或告警 annotation。

## 12. Operator UX 设计

Evidence UI 直接嵌入现有 Fault Run detail dialog，不新增面向消费者的页面或通用查询控制台。

### 12.1 交互

1. 终态运行详情显示 **Evidence** 区块和 Manifest revision；活跃运行显示“运行尚未结束，无法固定查询窗口”。
2. Operator 打开 Evidence 区块时只获取 Manifest、attempt metadata 和 notes，不自动执行查询。
3. UI 显示 control action、effect assessment、business recovery、cleanup 与 evidence availability 五个独立字段。
4. Operator 点击“刷新实时证据”后看到提示：此操作会读取受控观测后端和固定 Gateway read-check，不会停止、恢复、清理或写业务数据。
5. 成功结果展示当前查询时刻、窗口、recipe、coverage、摘要、predicate outcome 和 limitation；`CURRENT` business check 单独显示 `checkedAt`，绝不显示为历史窗口证据；再次刷新生成新 idempotency key。
6. Operator 可以复制 frozen PromQL/LogQL/TraceQL recipe，但复制内容不包含 endpoint、credential 或任何 source result。
7. Operator 可以追加有界分析笔记；UI 显示其与遥测/生命周期事实的边界。

### 12.2 UI 状态

| 状态 | UI 表达 | 不得表达为 |
| --- | --- | --- |
| `AVAILABLE` | 可完整复查，显示当前查询时间 | 效果一定已发生 |
| `PARTIAL` | 部分 recipe 无法复查，列出安全 reason code | “没有问题” |
| `EVIDENCE_UNAVAILABLE` | 时间窗口、retention 或 source 阻止复查 | RCA/Operator 错误 |
| `INVALID_QUERY` | Contract/release defect，建议禁用 execution | provider 运行时故障 |
| `NO_DATA` | source 成功响应但未匹配材料 | source 不可用或系统正常 |
| `NOT_READY` | 缺少可靠生命周期 anchor | 使用现在时间补齐 |

新增 `buildEvidenceView()` 必须采用与现有 `buildFaultRunView()` 相同的防御性 type guard 和 allowlist 模式。所有中英文文案在 `test:i18n` 中保持完整性和语义一致；`Unknown`、`Not observed`、`Unavailable`、`No data` 不能翻译成同一个成功或失败状态。

## 13. 实施拆分与文件职责

### 13.1 已交付的 Phase 3 输入与必须复核的门禁

| 文件 | 变更 |
| --- | --- |
| `src/lib/fault-run-catalog.ts` | 消费已交付 `contract.evidence`，不建第二份场景 map |
| `src/lib/scenario-contract.ts` | 复用既有 DSL/schema/canonicalization，所有字段保持 Phase 3 所有权 |
| `src/lib/fault-run-catalog.test.ts` / `scenario-contract.test.ts` | 复核已交付 coverage/安全门禁，真实发布证据仍按 Phase 3 清单确认 |
| `src/lib/runbook.ts` | 复用同一 Contract 派生的展示，不把 prose 当查询权威 |

### 13.2 批次 4 新增文件

| 文件 | 责任 |
| --- | --- |
| `src/lib/evidence-types.ts` | 内部和 API 类型、有限状态、JSON guard |
| `src/lib/evidence-capture-plan.ts` | 组合既有 snapshot seam与冻结query/evaluation计划及窗口上限 |
| `src/lib/evidence-manifest.ts` | 时间线投影、窗口解析、Manifest revision/hash |
| `src/lib/evidence-repository.ts` | schema 数据访问、原子 snapshot、Manifest/attempt/note 持久化 |
| `src/lib/evidence-query-clients.ts` | Prometheus/Loki/Tempo bounded read client |
| `src/lib/evidence-business-checks.ts` | 固定的正常 Gateway GET read-check adapter |
| `src/lib/evidence-report-service.ts` | preflight、并发、deadline、摘要、状态聚合 |
| `src/lib/evidence-view.ts` | 安全 UI DTO 投影 |
| `src/lib/migrations/00N-evidence-query.sql` | 批次 3 之后的下一个 clean-database bootstrap DDL；不用于升级已有 volume |
| `infra/mysql/init/0N-evidence-query-schema.sql` | 批次 3 之后的 fresh-install DDL |
| `src/app/internal/fault-runs/[faultRunId]/evidence/route.ts` | Manifest GET |
| `src/app/internal/fault-runs/[faultRunId]/evidence/manifests/route.ts` | 历史 revision 有界列表 GET |
| `src/app/internal/fault-runs/[faultRunId]/evidence/manifests/[manifestId]/route.ts` | 指定历史 Manifest GET |
| `src/app/internal/fault-runs/[faultRunId]/evidence/reports/route.ts` | attempt history GET 与 live report POST |
| `src/app/internal/fault-runs/[faultRunId]/evidence/notes/route.ts` | note GET/POST |
| `src/components/scenarios/evidence-view.ts` | 前端安全视图模型和格式化 |
| `src/components/scenarios/EvidencePanel.tsx` | 详情 dialog 内的 Evidence 区块 |

### 13.3 修改现有文件

| 文件 | 变更 |
| --- | --- |
| `src/lib/fault-run-schema.ts` | 加入与 clean-bootstrap migration/init 等价的 DDL；运行时建表语句不代表支持升级已有 schema |
| `src/lib/evidence-contract-snapshot.ts` | 复用/增强既有 DSL snapshot校验，不混入渲染计划改变Evidence hash |
| `src/lib/evidence-query-prometheus-renderer.ts` | 扩展全部固定模板，接入冻结的单位/lookback/执行解释 |
| `src/lib/gateway-client.ts` | 为Evidence正常GET提供bounded read选项/seam，保持其他调用行为 |
| `src/lib/operator-audit.ts` | transaction-aware审计复用，note/attempt/item/audit原子提交，不吞失败 |
| `src/lib/fault-run-repository.ts` | 在 run create transaction 写 snapshot；retention 前 materialize latest Manifest；安全读取 evidence data |
| `src/lib/fault-run-coordinator.ts` | 消费显式capture输入；不重复写既有command/action事件，不推断effect observed |
| `src/app/internal/fault-runs/route.ts` | capture failure 使用正常错误 envelope；不泄露 contract 内容 |
| `src/app/page.tsx` | 把 Evidence data/action 传入现有 `RunDetails`，不在轮询中执行 report |
| `src/components/LocalizedScenarioControlSections.tsx` | 终态详情集成 `EvidencePanel` |
| `src/components/scenarios/types.ts` | 严格 Manifest/attempt/note UI types |
| `src/lib/evidence-web-config.ts`、`src/instrumentation.ts` | 本设计第11.1节的strict Web-only配置和启动校验；shared env不解析Evidence |
| `src/worker/index.ts` | 在现有 retention lock 中执行 Manifest materialization；不启动 query worker |
| `traffic-control-plane/package.json` | 将新增 evidence 测试归入现有 `test:runner` 或新增受控 `test:evidence` |
| `docker-compose.yml` | 仅 Web/API 注入 disabled-by-default flags 和内部 source endpoints |
| `k8s/services/traffic-control-plane/deployment.yaml` | Web/API flags、ConfigMap/Secret source config、资源预算 |
| `k8s/kustomization.yaml` 与新增 NetworkPolicy | 接入最小网络策略；Kubernetes Loki/Promtail parity 完成后才打开 execution |
| `README.md` | Operator 配置、状态解释、flag/rollback 与“无快照”限制 |

初始 `CATALOG_PRODUCT_LIST` 和 `CATALOG_BROWSE_REPORT` 复用已有正常 Gateway 路由，因此不需要新增 Java endpoint。现有三个 run-context-bound 内部观察 endpoint 不可复用。任何新增业务检查必须单独修改 Gateway/目标服务和对应 Java 测试，不能将路径或 operation 作为控制面请求输入。

### 13.4 建议实现顺序

1. 完成批次 3 Contract、revision 与 12 场景 blocking validation。
2. 添加 schema/repository/完整固定renderer和baseline派生，随后完成DSL与已渲染计划的原子capture；保持所有query/UI flag关闭。
3. 实现安全时间线、冻结上限窗口和Manifest；验证terminal、failed、cleanup、non-releasing、capture-off和历史revision。
4. 实现bounded source/Gateway clients、单位/coverage/三态聚合和同步attempt；使用mock验证lookback、future、Tempo截断和deadline CAS，不先接真实环境。
5. 添加 protected routes、audit、UI/i18n 和 no-store response。
6. 将 retention materialization 接入既有 Worker lease；确认不会修改 Fault Run 生命周期。
7. Compose 单场景 pilot 开启 capture，再开启 execution；Kubernetes 在观测 parity 前保持 execution 关闭。

## 14. 测试设计

### 14.1 单元测试

| 层 | 必测情形 |
| --- | --- |
| Catalog/Contract | 12 场景完整覆盖；recipe ID 唯一；包含支付失败/超时与文件系统增长 templates；未知 template/window/read-check；未解析占位符；超范围 window；Catalog 改动导致 revision 变化 |
| Snapshot/Manifest | key 排序不影响 hash；新运行原子 snapshot；旧 Catalog 变更不改旧 Manifest；相同时间线幂等；cleanup 产生新 revision |
| Timeline/window | `(created_at,id)` tie-break；每种 terminal state；缺 active/recovery/cleanup；`TARGET_CONFIRMED` 不产生 observed effect；UTC 边界；不使用 `Date.now()` 补历史时间 |
| Retention | 全部过期不调用 source；部分过期得到 `coverage=PARTIAL`；源 run 删除后仍读 Manifest；legacy run 安全失败 |
| Client | fixed request encoding；origin/redirect/content-type 拒绝；timeout/429/5xx 仅重试一次；401/403/400 不重试；response cap；malformed JSON |
| Report service | AVAILABLE/PARTIAL/EVIDENCE_UNAVAILABLE/INVALID_QUERY；effect rule all/any；report 不调用 coordinator/cleanup；attempt 只保存允许列 |
| Redaction | provider error、token、password、email、URL credential、raw log/trace/body 都不会进入 DTO、DB、audit/log fixture |
| UI | 不自动执行；清晰区分 unavailable/no-data/unknown；复制 recipe 不含 endpoint；中英文文案完整；未信任字段不渲染 |

新增必测闭环：

- baseline同配方不同窗口，派生key稳定，无相对predicate，数值不落库，零基线/不同单位不比较。
- capture后修改renderer、模板lookback或Catalog maxDuration，首次及再次物化都保持原query/硬上限；未知协议/坏hash不重建。
- 多series/sample、active任一/recovery全部、ALL/ANY含未知成员、slow请求秒filter与count结果不混单位。
- 遥测全过期但timeline/CURRENT成功仍unavailable；optional source缺失为partial。
- future tail、输入lookback不足、样本gap/NaN、Tempo100条或未完成，不产生伪FULL/否定判断。
- report在cleanup新增revision后重试仍指向原attempt；新signature复用key冲突；note/audit网络重试原子去重。
- 历史revision列表/详情/显式重查、源Run删除、错误归属和hash、mutable source-retained metadata不改变immutable core。
- Gateway body cap/redirect/timeout/envelope guard在解析前生效；中断deadline请求时CAS结算，late writer不能覆盖。

### 14.2 Repository 和路由集成测试

- 空数据库分别经 MySQL init 与 `db:migrate` bootstrap 后得到等价的 Evidence schema；不测试已有 volume upgrade，也不以重复执行 SQL 证明旧 schema 兼容。
- `fault_runs + CREATED event + evidence_contract_snapshot` 成功或同时回滚。
- 相同 timeline 只产生一条 Manifest；不同 cleanup timeline 产生递增 revision。
- run-scoped attempt/note idempotency在revision变化和并发重试中不重复query/note/audit，异signature409；deadline CAS与item/audit终态原子提交。
- 未登录、CSRF 缺失、非法 UUID、过大 body、错误manifest归属/hash、非终态运行与未知route参数使用安全envelope；明确选择旧revision合法。
- `GET` Manifest/history 和 `POST` report/note 都带 `Cache-Control: no-store`。
- retention materialization 发生在删除前；不会对没有 snapshot 的旧运行阻断当前删除流程。

### 14.3 Compose acceptance

在一次可丢弃的本地 Compose 环境中：

1. 开启 capture，创建并完成一个 pilot Fault Run。
2. 获取 Manifest，确认 revision、窗口、recipe hash 和复制文本稳定。
3. 开启 execution，分别验证 Prometheus、Loki、Tempo、Gateway read-check 的真实受控请求。
4. 再次执行同一 Manifest，确认窗口/recipe 不变、`queriedAt` 改变且数据库中没有 telemetry payload。
5. 单独让一个 source 超时、不可达或返回非法 JSON，确认整体为 `PARTIAL` 或 `EVIDENCE_UNAVAILABLE`，绝不变成 `NO_DATA` 或成功。
6. 使用超过声明 retention 的 fixture window，确认不请求对应 source 且返回 `RETENTION_EXPIRED`。
7. 停用 `EVIDENCE_QUERY_EXECUTION_ENABLED`，确认 Fault Run 的 create/stop/recovery/cleanup 仍可正常运行。

### 14.4 验证命令

实现阶段按最小范围执行：

```bash
(cd traffic-control-plane && pnpm test:runner && pnpm test:runbook && pnpm test:i18n && pnpm typecheck && pnpm lint)
mvn test -pl gateway-service -Dtest=OperationDispatchControllerTest
docker compose config --quiet
kubectl kustomize k8s >/dev/null
./scripts/check-runtime-terminology.sh
git diff --check
```

完整 Stack pilot 只在可丢弃环境进行；它会产生真实业务/资源影响，不能当作无副作用的健康检查。

## 15. 发布、灰度与回退

### 15.1 发布顺序

1. **Fresh schema bootstrap**：完成获批的 clean-slate reset；使用 MySQL init 或 `db:migrate` 的空库路径创建等价 schema，并运行独立 `db:verify`。不得把 migration 路径用于升级既有 volume；不打开任何 flag。
2. **Capture canary**：在隔离 Compose 环境开启 `EVIDENCE_MANIFEST_CAPTURE_ENABLED`；确认新运行有 frozen snapshot，现有运行不受影响。
3. **Manifest-only**：开启 `EVIDENCE_QUERY_ENABLED`、保持 execution 关闭；核验窗口、revision、UI 和 audit，不产生外部 source 查询。
4. **Execution pilot**：配置内部 source endpoint，单环境、单场景、单 Operator 开启 `EVIDENCE_QUERY_EXECUTION_ENABLED`。
5. **Failure drill**：依次验证 partial、timeout、retention、invalid contract 和 kill switch。
6. **Kubernetes readiness**：先完成 Loki/log-shipping/retention parity、Secret 和 NetworkPolicy，再在单环境 canary。
7. **扩大范围**：每个场景的实际 metric/label/TraceQL/read-check 都验证后才加入 enabled contract 集合。

### 15.2 回退

1. 先设定 `EVIDENCE_QUERY_EXECUTION_ENABLED=false`，使新 source query 立即停止；在途请求在总 deadline 内结束或取消。
2. 必要时设定 `EVIDENCE_QUERY_ENABLED=false`，隐藏 Operator Evidence UI/API。
3. 保留 schema、snapshot、Manifest 和 metadata-only attempt，禁止为回退删除表或改写状态。
4. Evidence 回退绝不停止 Worker、绝不改变 active Fault Run、绝不调用 release/cleanup，也不删除目标资源。
5. 确认旧代码可忽略新增独立表后再回滚应用版本。

### 15.3 运行故障处置

| 症状 | 处理 |
| --- | --- |
| source 查询导致观测后端压力 | 关闭 execution flag；不要循环重试；检查低基数统计与后端健康 |
| 所有报告不可用 | 检查内部 DNS、NetworkPolicy、Secret、endpoint 和声明 retention；不能据此判断场景无影响 |
| `INVALID_QUERY` | 关闭 execution；按 Contract/release defect 修复新 revision；不改写历史 Manifest |
| Manifest capture 失败 | 保持 capture/query flag 关闭；修复 schema/Contract 后再创建新的可报告运行 |
| source run 已被 retention 删除 | 使用 retained Manifest 解释协议；只根据每个 source 的实际 retention 判断可用性 |
| note 含敏感信息 | 限制 Operator 访问并遵循部署侧数据处理流程；不得复制到日志、告警或报告 |

## 16. 批次退出条件

批次 4 只有同时满足下列条件才能进入 5.0：

- 12/12 场景都具有通过批次 3 validation 的固定 Evidence Contract，且不含自由输入查询。
- capture flag 开启时，新运行对准确 contract revision 的 snapshot 写入与 Fault Run 创建原子完成；flag 关闭时明确没有 snapshot，不能用当前 Catalog 补造。
- Operator 能对终态运行获得确定性 Manifest，清楚看到 baseline/active/recovery/cleanup 的窗口或限制原因。
- 同一Manifest及选中的历史revision可在retention内多次执行，冻结query/单位/上限不漂移；baseline对照、CURRENT与历史遥测分离，响应带新查询时间。
- report/note跨revision重试安全幂等；future/lookback/Tempo截断与中断attempt都有明确coverage/终态，ALL/ANY不违背Catalog。
- 成功、部分失败、source timeout、retention 不足、legacy snapshot 缺失和 invalid contract 都有明确、非成功形状的状态。
- MySQL、审计、日志、metrics 和 UI 不保存或泄露 raw metrics、log、trace、credential、业务 payload 或 provider error。
- 所有业务检查经过 Gateway 固定 allowlist，且不会改变业务状态。
- execution kill switch 不影响 Fault Run 的启动、停止、恢复、清理、Worker 或现有消费者路径。
- Compose pilot 覆盖至少一个真实场景和所有 source failure class；Kubernetes 未满足 parity 时保持默认关闭。

阶段 5 只能复用 `EvidenceQueryManifest`、frozen contract 和只读 executor；不得在 alert intake、Agent RCA report 或 Evaluator 中重新发明一套 query contract、时间窗口或 source client。
