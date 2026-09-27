# 批次 3：Scenario Contract 技术设计

> 状态：技术设计 v1.3，按 2026-09-26 用户决策对齐；实施待开始<br>
> 配套产品规格：[product.md](./product.md)<br>
> 对应路线阶段：阶段 3<br>
> 前置条件：批次 0～2 的运行事实、drain、owner/reconcile 语义已可验证<br>
> 设计原则：Catalog 单一事实源、跨层显式校验、fresh-schema 部署、只读生成、业务协议零泄漏

## 1. 设计结论

批次 3 将当前散落在 Catalog、Gateway、Worker、runbook、i18n、告警配置和测试中的隐式约束，收敛为一个可解析、可哈希、可验证的 **Scenario Contract**。它不创建第二份可手工编辑的场景清单，也不向业务服务、消费者请求或响应传递 Contract。

实现采用以下结论：

1. `traffic-control-plane/src/lib/fault-run-catalog.ts` 继续是场景可变事实的唯一来源。Catalog 已有的 `targetPrepare`、`recoveryPolicy`、target 和 parameters 是权威字段；supplement 只增加参数消费者、预算/guard 说明、生命周期检查 ID、Evidence DSL 和 Alert Contract，不复制第二套 dispatch/recovery policy。
2. Gateway、Owned Worker drivers 和目标服务继续拥有自己的运行映射。用 Catalog 派生的临时 expectation 与各自代码测试比对；不使用 AST/prose 猜测，也不要求运行时 control-plane 镜像读取 Gateway Java map。
3. 跨层静态 gate 由外部 CI 调用根级脚本并设为阻断；本仓库不增加 GitHub Actions workflow。`SCENARIO_CONTRACT_VALIDATION_MODE=warn|enforce` 仅用于当前进程可验证的 Catalog/schema/new-run admission，且与 Phase 2 safe-runtime/reconciliation switches 分离。
4. 新 Fault Run 的非空 per-run `contractRevision` 与 `CREATED` event 在同一创建事务写入，并在 Operator 的受控事件投影中展示。它不进入 Gateway payload、`FaultRunContext` 或业务服务协议。
5. revision 同时保留全局 64-hex `catalogRevision` 和 per-run `sc.v1:sha256:` `contractRevision`；两者 canonical input 都包含新增 supplement，参数按名称排序，UI 顺序不影响 hash。
6. Phase 3 不保存完整 Contract JSON；Phase 4 capture 开启时保存冻结 Evidence snapshot。当前 clean-slate 部署会清空数据库和业务资源；`contract_revision` 在 fresh schema 中 `NOT NULL`，不提供旧行、旧 schema 或跨部署 idempotency-key 兼容。
7. Alert 合同区分控制动作、effect observation、控制面 receipt、外部 Agent delivery readiness、观测不可用和业务恢复；场景开启绝不表示告警一定 firing。
8. Contract 只生成表单元数据、runbook checklist、smoke matrix、术语输入、合同测试骨架和 CI artifact；v1 不自动生成/改写生产路由、Worker 代码或目标服务接口。

```text
Catalog + Contract supplement
              |
              v
     Resolved Scenario Contract -----> canonical manifest / revision
              |                                 |
              |                                 +--> CI artifact
              v
    static validators
      |       |       |       |
      |       |       |       +--> runbook / i18n / evidence / alert config
      |       |       +----------> Worker dispatch descriptors
      |       +------------------> Gateway operation registry test
      +--------------------------> parameter / lifecycle policy

Operator creates Fault Run
              |
              v
  validate at admission (warn | enforce)
              |
              v
 fault_runs.contract_revision + CREATED.contractRevision
              |
              +--> Gateway only receives generic operation context
```

## 2. 范围、非目标与完成边界

| 范围 | 本批次处理方式 |
| --- | --- |
| Catalog、Gateway target map、Worker dispatch 的一致性 | 通过跨语言和 TypeScript descriptor 进行静态、确定性校验。 |
| 参数、duration、预算和参数消费者 | 校验 Catalog schema、默认值、标准化、消费者、限制权威和专用不变量。 |
| prepare、active、stop、release、cleanup、recovery | 由 Catalog 既有 `targetPrepare` / `recoveryPolicy` 和 Phase 2 owner/action/recovery hooks 决定；Contract 仅校验其适用性，不复制或替代状态机。 |
| 证据和告警 | 为阶段 4、5 定义结构化声明与校验规则；不采集或保存 Prometheus、Loki、Tempo 的现场数据。 |
| runbook、i18n、术语隔离 | 扩展已有覆盖检查，并生成维护者辅助工件。 |
| Contract revision | 为新 Fault Run 持久化 revision，支持 Operator 时间线追踪。 |
| CI 和发布门禁 | 增加独立的静态命令、报告工件和阻断流程。 |

资源预算的已确认边界：`BROWSE_SURGE` / `ORDER_QUERY_SURGE` 的 `concurrency` 上限为 `128`；`NOTIFICATION_STORAGE_APPEND.totalBytes` 是可配置目标、无静态总量上限，实际 append 由文件系统 `usableSpace` guard 保护；`minFreeBytes` 约束为 `1 MiB`–`1 GiB`。Contract 要表达这是容量 guard，而不是物理空间使用量保证。

以下内容明确不属于批次 3：

- 不改变消费者 API、业务服务接口、目标侧通用内部协议或 Gateway 的外部可见行为。
- 不向目标服务发送 `scenario`、display name、`contractRevision`、恢复策略、告警规则、Evidence Query 或控制面生命周期状态。
- 不自动修复、自动 release、自动 cleanup，也不把 Contract 校验变成目标服务的 Controller 校验。
- 不把 Contract manifest 当作离线指标、日志、Trace、数据库、Redis、JVM heap、文件系统或 PSP 现场快照。
- 不重做现有 Alertmanager receipt intake；不实现专用外部 Agent 投递、RCA 提交或 Evaluator，这些仍分别属于批次 5.1 和 5.2。
- 不把 Phase 3 的 revision hash 当成完整历史 Contract archive；完整 Evidence snapshot 由 Batch 4 capture 功能在 flag 启用时冻结。当前部署 reset 会整体删除运行状态，不支持旧 Run 跨部署恢复；未来保留数据库时必须另行实现 migration 和 archive/retention。

## 3. 当前实现基线与阻断项

当前系统已有严格的 Catalog 参数校验、Gateway top-level payload 校验、`fault_runs` 全局 active-run guard、Cache target summary 校验、双语 runbook 覆盖与 i18n key parity。Phase 2 还已提供 Catalog `targetPrepare` / `recoveryPolicy`、`listRunnableFaultRuns()`、四类 `OwnedFaultRunDriver`、`FaultRunReconciler`、owner-fenced `FaultRunRecoveryExecutor` 和 migration runner。它们是本批次的复用基础，但尚未组成一个 Scenario Contract，也没有全仓静态 validator 或 contract revision 持久化。

| 发现 | 当前事实 | Contract 处理与上线条件 |
| --- | --- | --- |
| Catalog 与 Gateway 的关系 | Catalog 有 12 个场景；Gateway `OperationDispatchController.TARGETS` 有 10 个 target-backed operation；两种 surge operation 是本地 Worker bypass。 | 校验 target-backed operation 的 service/operation 一致性，并明确声明本地 Worker bypass。不能把“Gateway 找不到 operation”误判为所有场景错误。 |
| Worker dispatch | Phase 2 提供 `OwnedFaultRunDriver` 的 `supports(run)` / `drainOwner`，由 `getFaultRunDrivers()` 注册四类 driver；`WorkerRuntime` 在 safe-runtime + reconciliation mode 非 `OFF` 时启动 Reconciler 并跳过旧 report/surge/scenario scanners。 | Contract 补充 validator-facing capability metadata 并对实际 `supports()`、ACTIVE admission、drain participant 和 summary event 做覆盖测试；不新增第二套 scenario list 或 Worker dispatcher。 |
| `CART_CATALOG_DEPENDENCY` | `ScenarioWorkers.startOwned()` 已创建 customer session、选择商品，并通过 Gateway 调用真实 `POST /api/cart/items`；Catalog recovery policy 的 drain owner 是 `SCENARIO_WORKERS`。 | Contract 从已有 Catalog/driver 派生 owner/path；尚未完成的运行证据和 verification 保持 `UNKNOWN` / `NOT_CONFIGURED`，不能称为没有 dispatch。 |
| runnable state | Repository 提供 `listRunnableFaultRuns()`；Reconciler 可处理 `CREATING` 的 target prepare，但只在成功激活为 `ACTIVE` 后启动 driver。`RECOVERING` 不作为 effect driver 的 runnable state。 | Contract 检查必须确认所有效果只在 ACTIVE 生效，并覆盖 CREATING prepare 与 RECOVERING 禁止启动；这是对已交付行为的校验，不是重做 Phase 1/2 gate。 |
| worker drain | Owned drivers 声明 `drainOwner`，Reconciler 启动后把 owner participant 注册至 `FaultRunDrainRegistry`；每个 driver 通过受控 stop/handle 完成 bounded drain。 | Contract 将 Catalog `recoveryPolicy.workerDrain.owner` 与真实 driver、drain registry 和结果事件交叉验证；不另建 run drain Map 或 Coordinator hook。 |
| recovery strategy | Catalog 已定义 `recoveryPolicy`，`resolveFaultRunRecoveryPolicy()` 做组合校验；`FaultRunRecoveryExecutor` 使用该 policy 决定 drain、target release、manual cleanup 和结果记录。`WorkerRuntime` 在 legacy、safe-runtime 与 Reconciler mode 下采用不同接线。 | Contract 复用该 resolver 和 executor 行为；只补齐跨层静态 coverage。不得把 legacy `FaultRunCoordinator` 单独作为当前所有部署模式的 recovery 描述。 |
| manual cleanup | `cleanup-scenario` 路由当前明确拒绝 runless cleanup（`SCENARIO_CLEANUP_REQUIRES_RUN`）；允许的 cleanup 通过 per-run confirmed endpoint/action journal 执行。Catalog 的 `OPERATOR_CONFIRMED` 表示需 Operator 确认，不表示 scenario-wide cleanup。 | Contract 的 cleanup capability 使用 `NONE`、`OPTIONAL_PER_RUN`、`OPERATOR_CONFIRMED`；校验 run id/operation/fence 和 action owner，不再设计 `SCENARIO_WIDE` 路径或修复已删除的旧路由。 |
| cleanup wire compatibility | Gateway cleanup 只发送 `runId`、`operation`、`fencingToken`，而 target cleanup handler 的上下文校验并不完全一致。 | Gateway registry test 和 target endpoint test 必须证明声明的 cleanup mode 与实际 wire contract 兼容。 |
| evidence | runbook 有展示用 Tempo recipe，但没有 run-relative PromQL/LogQL/TraceQL、业务检查或 `evidence_unavailable` 声明。 | 所有场景必须增加结构化 evidence recipe；不可将 `now-1h to now` 的 UI 提示冒充阶段 4 Manifest。 |
| alert delivery | P0-13 已补齐内部 webhook route、service-key credentials file 和低基数 receipt；当前仍为 generic receiver，尚无阶段 5 专用 child route、告警关联和外部 Agent receiver。 | 每个场景必须有完整 alert declaration；当 delivery 为 `NOT_ENABLED_YET` 或尚未完成真实 receipt 时静态 Contract 可通过，但 readiness 报告必须说明未可投递/未核验。 |
| Contract revision | `fault_runs`、`fault_run_events` 和 API record 中没有 per-run revision；已有 `getCatalogRevision()` 是 global Catalog revision。 | clean schema 增加 `contract_revision NOT NULL`；部署不保留旧 Run 或跨部署幂等 key。 |
| Schema rollout | 部署会清空数据库及业务资源，不保留旧 migration history 或运行数据。 | 本批次不新增 `006` / init `10`，不做 upgrade migration；同步更新 runtime create schema、`001` 和 init `04` 并加 fresh-schema parity/verification。以后改为保留数据部署时另立 migration 设计。 |

这些发现不是本设计中的默认豁免。`warn` 阶段可以把它们作为有结构的诊断保留；任何被标为 required 的能力在 `enforce` 或 CI strict gate 中均必须失败。

## 4. 事实来源、所有权与依赖方向

### 4.1 单一事实源规则

`fault-run-catalog.ts` 是每个场景的唯一可变 Contract 来源。现有 `FaultRunScenarioDefinition` 增加一个 `contract` 字段，而不是新增一个平行的 `Record<FaultRunScenario, ...>`：

```ts
export interface FaultRunScenarioDefinition {
  scenario: FaultRunScenario;
  targetService: string;
  targetOperation: string;
  maxDurationSec: number;
  recoveryStrategy: FaultRunRecoveryStrategy;
  allowManualCleanup: boolean;
  parameters: readonly FaultRunParameterDefinition[];
  contract: ScenarioContractSupplement;
}
```

`ScenarioContractSupplement` 不重复 `scenario`、`targetService`、`targetOperation`、`maxDurationSec`、`recoveryStrategy`、`allowManualCleanup` 或完整参数定义。`resolveScenarioContract(definition)` 在内存中将这些 Catalog 事实与 `contract` supplement 合成为 `ResolvedScenarioContract`。

| 工件 | 所有者 | 在 Contract 中的角色 | 不允许的做法 |
| --- | --- | --- | --- |
| `fault-run-catalog.ts` | traffic-control-plane | 场景、固定 target、参数、duration、恢复分类和新增的补充语义。 | 在 Validator、API route、SQL 或业务服务复制场景属性。 |
| Gateway `OperationTargetRegistry` | gateway-service | operation 到 service/prepare/release/cleanup path 的运行路由。 | 用 TypeScript 重新实现 Gateway target map。 |
| Worker descriptor exports | 对应 Worker | 运行 owner、支持的场景、ACTIVE gate、drain/summary capability。 | 从 Worker 源码文本或日志推断 dispatch。 |
| `RUNBOOK_METADATA` 与 Markdown | runbook | 文档文件 allowlist、文章展示和影响解释；Tempo service/route/query 从 Evidence Contract 派生。 | 以自由文本作为 target/recovery/evidence 的权威来源。 |
| `SCENARIO_META`、messages | 控制台 UI/i18n | 场景分组、标签、说明和参数翻译。 | 用 UI fallback 掩盖缺失 Catalog 场景。 |
| Prometheus/Alertmanager YAML | 部署配置 | 可用 rule、severity、route、receiver 和 `send_resolved` 的部署意图。 | 用运行时告警或 prose 推断静态声明。 |
| `docs/runbooks/alert-scenario-matrix.md` | 维护者文档 | 对真实信号强弱、阈值和限制的解释。 | 解析表格来生成机器 Contract。 |

### 4.2 依赖图

```text
FaultRunScenarioDefinition.contract
     |                    |
     |                    +--> evidence / alert / lifecycle supplement
     v
resolveScenarioContract()
     |             |                |
     |             |                +--> Contract revision
     |             +-------------------> derived form/checklist/smoke/term inputs
     v
validateScenarioContracts()
     |              |                |
     |              |                +--> runbook, i18n, alert configuration readers
     |              +-------------------> Worker descriptor imports
     +----------------------------------> Gateway contract test input

FaultRunCoordinator.create()
     |
     +--> resolve current Contract -> contractRevision -> transactional create
     +--> generic Gateway payload only
```

Catalog 只依赖 control-plane 内部类型。Gateway Java 代码不导入 TypeScript，也不读取 Catalog；跨语言一致性由测试边界证明，避免把 build-time Contract 变成业务运行时耦合。

## 5. Contract 模型与规范化

### 5.1 核心类型

以下是 v1 的目标模型。命名应表达业务执行能力，不向消费者、目标服务或外部 Agent 暴露。

```ts
export const SCENARIO_CONTRACT_SCHEMA_VERSION = 'scenario-contract.v1' as const;

export type ParameterConsumer = 'ADMISSION' | 'TARGET_PREPARE' | 'WORKER_EXECUTION';
export type EvidenceSource =
  | 'RUN_EVENT'
  | 'PROMETHEUS'
  | 'LOKI'
  | 'TEMPO'
  | 'BUSINESS_CHECK'
  | 'RESOURCE_CHECK';
export type EvidenceWindow = 'baseline' | 'active' | 'recovery' | 'cleanup';
export type EvidenceProjection = 'NUMERIC' | 'COUNT' | 'BOOLEAN' | 'TIMELINE';
export type EvidenceTemplateId =
  | 'HTTP_P99' | 'HTTP_ERROR_RATIO' | 'HTTP_RATE' | 'HIKARI_UTILIZATION'
  | 'JVM_HEAP_RATIO' | 'MYSQL_SLOW_QUERY_RATE' | 'REDIS_MEMORY_RATIO'
  | 'NODE_FILESYSTEM_RATIO' | 'SERVICE_EVENT_COUNT' | 'SERVICE_ERROR_COUNT'
  | 'SERVICE_REQUESTS' | 'SERVICE_ERRORS' | 'SERVICE_SLOW_REQUESTS'
  | 'SERVICE_ROUTE_REQUESTS' | 'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT'
  | 'RUN_TIMELINE';

export interface EvidenceScope {
  service: string;
  route?: string;
  fixedLabels?: Readonly<Record<string, string>>;
}

export type EvidencePredicate =
  | { kind: 'NONE' }
  | { kind: 'BOOLEAN_EQUALS'; expected: boolean }
  | {
      kind: 'COMPARISON';
      operator: 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
      value: number;
    };

export interface EvidenceWindowPolicy {
  baselineBeforeActiveSec: number;
  activeLeadSec: number;
  activeTailSec: number;
  recoveryLeadSec: number;
  recoveryTailSec: number;
  cleanupLeadSec: number;
}

export interface EvidenceRecipeDefinition {
  id: string;
  source: EvidenceSource;
  window: EvidenceWindow;
  observationMode: 'WINDOWED' | 'CURRENT';
  required: boolean;
  template: EvidenceTemplateId;
  scope: EvidenceScope;
  predicate: EvidencePredicate;
  projection: EvidenceProjection;
}

export interface EvidenceContractPlan {
  schemaVersion: 'evidence-contract.v1';
  windows: EvidenceWindowPolicy;
  recipes: readonly EvidenceRecipeDefinition[];
  effectRule: {
    mode: 'ALL' | 'ANY';
    recipeIds: readonly string[];
  };
}

export type BudgetBoundary =
  | {
      kind: 'PARAMETER_BOUNDS';
      parameterNames: readonly string[];
    }
  | {
      kind: 'CATALOG_RULE';
      ruleId: 'CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES';
      parameterNames: readonly string[];
    }
  | {
      kind: 'TARGET_CAPACITY_GUARD';
      guardId: 'FILESYSTEM_USABLE_SPACE_RESERVE';
      targetBytesParameter: 'totalBytes';
      reserveBytesParameter: 'minFreeBytes';
      hardTargetMaximum: 'UNBOUNDED_BY_DESIGN';
    };

export interface ScenarioResourceBudget {
  resource: 'REQUEST_CONCURRENCY' | 'REDIS_LOGICAL_BYTES' | 'JVM_RETAINED_BYTES' | 'STORAGE_FILE_BYTES';
  boundary: BudgetBoundary;
}

export interface ScenarioContractSupplement {
  parameterConsumers: Readonly<Record<string, readonly ParameterConsumer[]>>;
  budgets: readonly ScenarioResourceBudget[];
  lifecycle: {
    prepareAssertionIds: readonly string[];
    recoveryCheckIds: readonly string[];
    sideEffectCheckIds: readonly string[];
    nonReleasingReason?: string;
  };
  evidence: EvidenceContractPlan;
  alert: ScenarioAlertContract;
}

export interface ResolvedScenarioContract extends ScenarioContractSupplement {
  schemaVersion: typeof SCENARIO_CONTRACT_SCHEMA_VERSION;
  scenario: FaultRunScenario;
  targetService: string;
  targetOperation: string;
  maxDurationSec: number;
  recoveryStrategy: FaultRunRecoveryStrategy;
  targetPrepare: 'REQUIRED' | 'NOT_APPLICABLE';
  recoveryPolicy: FaultRunRecoveryPolicy;
  allowManualCleanup: boolean;
  parameters: readonly FaultRunParameterDefinition[];
  dispatchOwner: FaultRunWorkerDrainOwner | null;
  targetLifecycleMode: 'GATEWAY' | 'LOCAL_WORKER';
}
```

`ScenarioResourceBudget` 是预算权威来源声明，而不是第二份数值限制表：

- `PARAMETER_BOUNDS` 要求列出的 Catalog 参数存在相应边界；例如 surge `concurrency` 的 `max=128`。
- `CATALOG_RULE` 指向已有组合校验；例如 Redis logical bytes 的固定总量预算。
- `TARGET_CAPACITY_GUARD` 描述目标服务实时检查的资源边界。通知存储的 `totalBytes` 是期望目标、按决策不设绝对上限；目标服务必须按 `FileStore.getUsableSpace()` 检查写入后仍保留 `minFreeBytes`，Catalog 的 `minFreeBytes.min` 为 1 MiB。

所有场景的 `durationSec` 和普通参数范围仍直接读取 Catalog。Contract budget assertion 说明哪些资源边界由参数、组合规则或目标容量 guard 负责；无固定上限必须显式记录为已批准例外，不得伪装成数值上界。

限制规则：

- `durationSec` 必须存在于每个场景的参数中，并在 `parameterConsumers` 中至少有 `ADMISSION`；实际执行方需要 expiry 时必须声明 `WORKER_EXECUTION` 或 `TARGET_PREPARE`。
- `parameterConsumers` 的 key 集合必须和 Catalog `parameters[].name` 完全相等。缺少、额外或空消费者均为 `invalidParameters`。
- `targetLifecycleMode` 从既有 `targetPrepare` 派生；`dispatchOwner` 从既有 `recoveryPolicy.workerDrain` 派生；target release/cleanup 从既有 recovery policy 派生。Resolved view 可携带这些计算结果供校验，但 Catalog supplement 不得再编辑同一事实。
- 所有要求 worker 执行的场景必须对应一个 `getFaultRunDrivers()` driver，其 `name` 与派生 owner 一致，并在 runtime fixture 下恰好一个 `supports(run)` 命中。
- `TARGET` 必须有 Catalog 声明的 target release；`WORKER` 必须有适用的 Worker stop/drain/verification，不要求不存在的 Gateway release；local Worker target release 可为 `NOT_APPLICABLE`。
- `OPTIONAL_PER_RUN` 和 `OPERATOR_CONFIRMED` 直接使用 `recoveryPolicy.cleanup` 语义；所有 cleanup 均绑定 Run 身份、operation、fencing token 和现有 action journal，不声明 scenario-wide cleanup。
- `NON_RELEASING` 必须给出 `nonReleasingReason`、停止后的 side-effect check 和适用 recovery check；目标释放由 Catalog policy 决定。
- 每个 resource-bound parameter 均由其 Catalog `min/max` 或已验证 Catalog invariant 决定；surge 的 `concurrency.max=128` 必须进入参数验证与 worker 测试。storage 的 `totalBytes` 使用明确的 runtime guard exception：不加绝对最大值，validator 确认 `minFreeBytes.min >= 1 MiB`、Catalog/max 与 Java target 一致，且目标服务实施 filesystem capacity guard。

### 5.2 证据声明

`EvidenceContractPlan` 直接采用 Batch 4 已定义的 `EvidenceWindowPolicy`、`EvidenceRecipe` 和 `effectRule` 结构，不再使用自由形式 `queryTemplateOrOperation`。`EvidenceTemplateId`、`EvidenceScope` 和 `EvidencePredicate` 在 Phase 3 代码中定义为有限 union/结构化输入，供 Batch 4 renderer 消费。

每个 recipe 必须满足：

- `id` 采用稳定 lower-kebab 命名并在当前 Evidence plan 内唯一，例如 `browse-surge.prometheus.active-rate`。
- `template` 必须来自阶段 4 的有限模板清单；`scope` 只包含合同内固定的 service、route 和低敏静态 label；`predicate` 只能使用有限比较/布尔运算符和 typed operand，不得存自由 PromQL、LogQL、TraceQL、SQL、URL 或 shell。
- Prometheus、Loki、Tempo、Run Event 使用 `WINDOWED`；固定业务 read-check 使用 `CURRENT`，只能证明执行时的当前可用性，不能作为过去 effect window 的 evidence 或 `effectRule` 输入。
- 每个场景至少有 Run Event、适用的观测 source，以及 recovery/cleanup 适用性说明。`MANUAL_CLEANUP` 有 cleanup check；`NON_RELEASING` 有 residual/service recovery check。
- `effectRule.recipeIds` 必须引用能输出 predicate outcome 的 Evidence recipe；结构规则不可把 prepare/receipt/release 自动映射为效果或业务恢复。
- 任何查询失败、权限不足、retention 超期或数据不存在均由 Batch 4 表示为 `EVIDENCE_UNAVAILABLE` / `INCONCLUSIVE`，不能转换成“效果未发生”或“已恢复”。

Catalog Evidence Contract 是 service/route/query 的唯一机器事实源。`runbook.ts` 的 Tempo service/route/query展示字段应从同一合同派生；`RUNBOOK_METADATA` 只保留文章文件名、影响范围、解释路径等文档元数据，不能另存可变 query 映射。自由 prose 仍可解释限制，但不作为 renderer 输入。

### 5.3 告警声明

每个场景必须显式声明 alert 边界，包括没有合理告警预期的场景。相关 selector 的字段直接复用 Batch 5.0 `AlertCorrelationContract`，避免在 intake route 维护第二份 correlation schema：

```ts
export interface AlertCorrelationContract {
  alertName: string;
  service: string;
  severity: 'warning' | 'critical';
  requiredLabels: Readonly<Record<string, string>>;
  incidentKeyLabels: readonly string[];
  correlationWindowSec: number;
  activeGraceBeforeSec: number;
  recentGraceAfterSec: number;
  sendResolvedToControlPlane: boolean;
  faultRunCorrelation: 'required' | 'optional' | 'not_required';
}

export type ScenarioAlertContract =
  | {
      expectation: 'NOT_EXPECTED';
      reason: string;
      faultRunCorrelation: 'not_required';
      missingAlertTreatment: 'EFFECT_CAN_STILL_BE_OBSERVED';
      receiptPolicyId: 'alert-receipt.v1';
    }
  | {
      expectation: 'CONDITIONAL' | 'REQUIRED_FOR_PILOT';
      allowedAlerts: readonly AlertCorrelationContract[];
      missingAlertTreatment: 'EFFECT_CAN_STILL_BE_OBSERVED' | 'EVIDENCE_UNAVAILABLE';
      receiptPolicyId: 'alert-receipt.v1';
    };

export type AgentDeliveryReadiness =
  | { state: 'NOT_ENABLED_YET' }
  | {
      state: 'ENABLED';
      childRouteName: string;
      externalReceiverName: string;
      credentialSource: 'DEPLOYMENT_MANAGED_SECRET';
      sendResolved: true;
    };
```

`allowedAlerts` 表示允许用于关联或 pilot 的真实信号，不表示触发保证。对于 Prometheus rule 仅以 runtime series 产生 `service` label 的场景，静态校验可证明 rule name、severity 和静态 selector 合法，但不能承诺某个 service/URI 一定产生 series 或达到阈值。

`AlertCorrelationContract.severity` 复用 Batch 5.0 的 `'warning' | 'critical'` 范围；Prometheus 中与场景无关的 `info` rules 不能被静态 validator 自动升级为可关联告警。

`receiptPolicyId` 引用 Batch 5.0 的全局 `alert-receipt.v1` policy，不在每个场景重复定义保留期或 webhook 状态机。该 policy 以规范化 `(fingerprint, startsAt UTC millisecond)` 标识告警实例；重复 webhook 幂等更新已有实例，不创建新的 receipt/incident/correlation，resolved 通知更新已有实例。`NOT_EXPECTED` 不做 Fault Run 关联，但同样保留通用 receipt 并使用 `NOT_REQUIRED` correlation status。内部 `sendResolvedToControlPlane` 与外部 Agent receiver 的 `AgentDeliveryReadiness.sendResolved` 是不同事实，不能混用。

`AgentDeliveryReadiness` 是外部部署配置的 validator input，不是 Catalog per-scenario 字段，也不进入 `contractRevision`。`state = NOT_ENABLED_YET` 只输出 readiness note，不要求填未来 route/receiver 占位值；只有显式 `ENABLED` 才校验专用 child route、external receiver、部署凭据来源和 `send_resolved: true`。无论哪个状态都不表示 alert 一定 firing。

`NOT_EXPECTED.reason` 必须是非空维护者说明；`CONDITIONAL`/`REQUIRED_FOR_PILOT` 的 `allowedAlerts` 必须非空，且每条告警必须满足 Batch 5.0 字段和静态部署规则。

### 5.4 revision

Contract 需要两个可读的稳定身份：

| 字段 | 输入 | 用途 |
| --- | --- | --- |
| `catalogRevision` | 已有 `getCatalogRevision()` 对完整 Catalog canonical JSON 计算的 SHA-256 | 保持现有 64 字符小写 hex 格式，供 baseline 和现有测试继续使用；canonical input 扩展时必须纳入 Contract supplement。 |
| `contractRevision` | 单个 Fault Run 所选 `ResolvedScenarioContract` | Run/Event 追踪、Operator 时间线和后续 Evidence Query 关联。 |

`contractRevision` 使用新 schema 版本格式 `sc.v1:sha256:<lowercase-hex>`；不得将此格式套到既有 `catalogRevision`，以免破坏 batch-0 baseline、现有 `getCatalogRevision()` 调用者和 `^[a-f0-9]{64}$` 格式约定。两种 hash 可共用稳定 JSON canonicalization helper，但分别固定其 canonical input 与序列化兼容要求。

canonicalization 的规则如下：

1. 排序 object key，保留缺失字段与显式 `null` 的差异；
2. Catalog scenario 按 `scenario` 排序；
3. parameters 始终按 parameter name 排序（与既有 `getCatalogRevision()` canonicalization 一致），不得将字段显示顺序计入 revision；Evidence recipes 按 recipe ID、Alert correlations 按 alert name/service、无序检查 ID 集合按稳定值排序；
4. label map key 排序，数字保留 JSON 数字语义；
5. 不纳入请求参数实际值、`faultRunId`、fencing token、时间戳、运行环境 URL、密码、token、文件绝对路径、观测结果或显示文案；
6. 对 canonical JSON 使用 Node `crypto.createHash('sha256')`。

这样，场景 Contract 的实际结构变更会改变对应 `contractRevision`，并在全 Catalog canonical input 中反映为 `catalogRevision` 变化；同一 Contract 的无序输入变化不会产生伪 revision。运行请求的规范化参数仍独立记录在 `fault_runs.parameters_json`。

## 6. 执行、目标与生命周期 capability

### 6.1 预期 ownership matrix

下表展示从现有 Catalog `recoveryPolicy.workerDrain.owner` / `targetPrepare` 派生的 driver owner 与 target mode，不构成第二份手工映射。

| 场景 | 预期 dispatch owner | target lifecycle | cleanup mode | 当前状态 |
| --- | --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | `REPORT_SCENARIO_WORKER` | `GATEWAY` | `NONE` | Driver `name` 与 Catalog drain owner 一致。 |
| `ORDER_REPORT_SQL` | `REPORT_SCENARIO_WORKER` | `GATEWAY` | `NONE` | 同上。 |
| `BROWSE_SURGE` | `TRAFFIC_SURGE_EXECUTOR` | `LOCAL_WORKER` | `NONE` | 每 Run `concurrency` 上限 128；Worker stop/drain 满足 applicable release。 |
| `ORDER_QUERY_SURGE` | `TRAFFIC_SURGE_EXECUTOR` | `LOCAL_WORKER` | `NONE` | 同上。 |
| `CATALOG_REDIS_LARGE_VALUE` | `SCENARIO_WORKERS` | `GATEWAY` | `OPTIONAL_PER_RUN` | Owned driver 由 Reconciler 启动并接入 drain registry；cleanup 仍需校验 target summary 和 per-run action contract。 |
| `CART_CATALOG_DEPENDENCY` | `SCENARIO_WORKERS` | `GATEWAY` | `NONE` | 已有 customer-session 和真实 Cart add-item Gateway path；verification 仍未配置。 |
| `NOTIFICATION_HEAP_PRESSURE` | `RUNNER_ENGINE` | `GATEWAY` | `NONE` | Catalog 声明 `targetRelease: FORBIDDEN`；Contract 校验需证明 recovery executor 尊重 non-releasing policy。 |
| `NOTIFICATION_STORAGE_APPEND` | `RUNNER_ENGINE` | `GATEWAY` | `OPERATOR_CONFIRMED` | Confirmed cleanup 是带 Run context 的独立 action；停止 append 与删除运行文件保持分离。 |
| `PROMOTION_LOCK_CONTENTION` | `SCENARIO_WORKERS` | `GATEWAY` | `NONE` | 有 Worker；需通过 recovery/endpoint capability 校验。 |
| `INVENTORY_TABLE_EXCLUSIVE` | `SCENARIO_WORKERS` | `GATEWAY` | `NONE` | 有 Worker；需通过 recovery/endpoint capability 校验。 |
| `INVENTORY_ROW_LOCK` | `SCENARIO_WORKERS` | `GATEWAY` | `NONE` | 有 Worker；需通过 recovery/endpoint capability 校验。 |
| `PSP_PROVIDER_OUTCOME` | `RUNNER_ENGINE` | `GATEWAY` | `NONE` | 有 Runner path；需注册对应 run drain 和 summary。 |

### 6.2 Worker descriptor

Contract 复用现有 `OwnedFaultRunDriver` registry，而不是再建立一个静态场景数组。每个 driver 已有 `name`、`drainOwner`、`supports(run)` 和 `start()`；Contract validator 对 Catalog 生成的只读 Run fixture 求值 `supports()`，并从 driver capability 与测试结果获取 drain/terminal-summary 事实。可增加 descriptor 字段，但不得以第二份 `scenario -> owner` 表替换现有注册关系：

```ts
export interface ScenarioDispatchDescriptor extends OwnedFaultRunDriver {
  executionState: 'ACTIVE_ONLY';
  terminalSummaryEvent: string;
}
```

descriptor 应附着在既有 driver 实例或其纯 capability projection 上；`name` 和 `drainOwner` 均使用现有真实 owner id，且后者与 `recoveryPolicy.workerDrain.owner` 相同；owner 不在 Contract supplement 中重新存储。现有 owner 和 coverage 分布如下：

| 现有 driver | 真实 `supports(run)` 场景覆盖 |
| --- | --- |
| `ReportScenarioFaultRunDriver` | 两个 report 场景；owner id 为 `REPORT_SCENARIO_WORKER`。 |
| `TrafficSurgeFaultRunDriver` | 两个 surge 场景。 |
| `ScenarioFaultRunDriver` | Cache、Cart、promotion、两个 inventory 场景。 |
| `RunnerBackedFaultRunDriver` | notification heap/storage 和 PSP 场景。 |

Validator 需断言：

- 对每个 Catalog 场景以 fixture 调用全部 driver 的 `supports()`，结果必须恰好一个；不从 descriptor 复制场景集合。
- driver `name` 与 Contract dispatch owner 相符，`drainOwner` 与 Catalog `recoveryPolicy.workerDrain.owner` 相符，且 Reconciler 将同一 drain owner 注册到 `FaultRunDrainRegistry`。
- `FaultRunReconciler` 对 CREATING 可执行 PREPARE，但必须完成 owner-fenced activation 后才 `driver.start()`；RECOVERING/终态 Run 不得启动效果 driver。
- 终态 summary event 由 driver contract test 对照实际 event normalizer 检查；缺失事实按 INCOMPLETE 处理。
- `TrafficSurgeFaultRunDriver` 仍调用 `TRAFFIC_SCENARIO_TARGETS`，其映射只用于确认两个 local Worker path；不要求把它们加入 Gateway target registry。
- descriptor 只声明执行能力，不复制 Catalog 的 service、operation、参数或 duration。

`listRunnableFaultRuns()` 和 owned-driver ACTIVE admission 已由 Phase 2 提供，批次 3 负责覆盖测试和 Contract validation，不重新修改旧 scanner 或替代 `FaultRunReconciler`。

### 6.3 Gateway 跨语言校验

Gateway 的 `TARGETS` 不能被 TypeScript 直接导入，也不应新增一个运行时 JSON map。实现采用一个不改变生产协议的测试边界：

1. 将 Java controller 的手工 map 抽取为 `OperationTargetRegistry`；Controller 继续从该 registry 路由，registry 是 Gateway operation/path 的唯一代码来源。
2. `validate:contract` 从 resolved Catalog 输出只包含 target-backed operation、预期 service、lifecycle/cleanup mode 的临时 JSON 输入。
3. `gateway-service` 的 `OperationDispatchContractTest` 读取该输入，并断言 registry 中 operation 存在、service 一致、prepare/release/cleanup path 与声明 capability 兼容。
4. Java test 同时通过 Spring mapping 或 controller-level test 验证 registry 指向的 target endpoint contract；它不能仅比较两个手工字符串表。
5. 本地 Worker scenario 不写入 Gateway expectation 输入；Java test 必须拒绝“标为 Gateway 但无 registry entry”的 scenario。

根级脚本负责先生成临时输入，再运行 Maven 测试。临时文件位于忽略的 `tmp/scenario-contract/`，不能提交为另一份 source of truth。

### 6.4 recovery 与 cleanup policy

`recoveryStrategy` 仍用于兼容/UI；执行 policy 已由 Catalog `recoveryPolicy` 和 `resolveFaultRunRecoveryPolicy()` 明确表达，并由 Phase 2 `FaultRunRecoveryExecutor` 执行。Contract 不新增 policy resolver，而是验证 Catalog strategy/policy 组合及其 drain/release/cleanup hook 覆盖：

| Catalog `recoveryStrategy` | Contract 必须具备 |
| --- | --- |
| `TARGET` | target release/recovery capability；至少一个 recovery check；若 Worker 仍持续观测，则明确其 drain 需求。 |
| `WORKER` | 每个真实流量 Worker 的 drain、终态 summary 和停止后验证；若场景也有 Gateway prepare，则 release policy 必须显式声明。 |
| `MANUAL_CLEANUP` | Catalog `cleanup: OPERATOR_CONFIRMED`；stop/release 与 destructive cleanup 分离，per-run cleanup 使用 Operator confirmed action、责任边界、completion check 和重试/幂等语义。 |
| `NON_RELEASING` | release 被禁止；必须声明为什么不释放、停止后残留如何观察、何时转入 service recovery/人工处置。 |

Contract 必须校验 `FaultRunRecoveryExecutor` 通过 `resolveFaultRunRecoveryPolicy()` 分别处理 worker drain、target release、manual cleanup、终态事件与特殊 service recovery；不能以通用“所有场景 drain 后 release”作为实现。`NOTIFICATION_STORAGE_APPEND` 的 release 只停止受控 append 生命周期，运行文件删除仍是独立、需 Operator 确认的 per-run cleanup。`NOTIFICATION_HEAP_PRESSURE` 的 Catalog policy 已禁止 target release，Contract 测试须确保其不被标为正常 release。

## 7. Validator 设计

### 7.1 模块边界

建议在 `traffic-control-plane` 新增以下模块：

| 模块 | 职责 |
| --- | --- |
| `src/lib/scenario-contract.ts` | Contract 类型、Catalog supplement 的解析与 resolved Contract 构建；没有 per-scenario 平行数据。 |
| `src/lib/scenario-contract-revision.ts` | canonical JSON、SHA-256、`catalogRevision`/`contractRevision` 生成。 |
| `src/lib/scenario-contract-validator.ts` | 纯校验器，接收显式 inputs，返回稳定、排序后的诊断。 |
| `src/lib/scenario-contract-artifacts.ts` | 从 resolved Contract 投影表单、runbook checklist、smoke matrix、术语输入和 manifest。 |
| `src/lib/scenario-contract-runtime.ts` | Web/API 当前进程内的 Contract 检查与 warn/enforce admission；不读取 Markdown、root infra、Gateway Java map、数据库旧 Run 或网络。 |
| `scripts/validate-scenario-contract.ts` | 仅供本地/CI 使用的全量静态输入装配、report 输出与 exit code。 |
| `scripts/test-scenario-contract.sh` | 根级分阶段编排 TypeScript 预检、Gateway/目标服务 Maven 测试、最终 report、runbook/i18n/terminology 检查；供外部 CI 调用。 |

Validator 输入必须以依赖注入形式传入，以便负向 fixture 不修改真实 Catalog 或生产文件：

```ts
export interface ScenarioContractValidationIssue {
  category:
    | 'missingTarget'
    | 'missingDispatch'
    | 'invalidParameters'
    | 'invalidRecoveryHook'
    | 'missingEvidenceQuery'
    | 'missingRunbook'
    | 'missingI18n'
    | 'invalidAlertContract';
  code: string;
  scenario?: FaultRunScenario;
  artifact?: string;
  fieldPath?: string;
  expected?: string;
  actual?: string;
  remediation: string;
}

export interface ScenarioContractValidationReport {
  schemaVersion: 'scenario-contract-report.v1';
  catalogRevision: string;
  valid: boolean;
  issues: readonly ScenarioContractValidationIssue[];
}
```

所有 issue 以 `category`、`scenario`、`artifact`、`fieldPath`、`code` 排序；同一错误每次执行产生相同顺序和 exit code。报告中不得包含密码、Authorization、Cookie、原始 SQL、原始 webhook、完整 HTTP response、运行时 customer data 或绝对路径。

### 7.2 八类阻断诊断

| 分类 | 输入 | 必须验证的条件 |
| --- | --- | --- |
| `missingTarget` | resolved Contract、Gateway registry result、各目标服务 controller-mapping test result、`TRAFFIC_SCENARIO_TARGETS` | Gateway operation/service/path 一致；path 在目标服务中有实际 controller mapping；本地 Worker bypass 不误入 Gateway；任一 Java result 缺失时最终 report 不 valid。 |
| `missingDispatch` | 四类 Worker descriptor | 每场景恰好一个 owner，owner/lifecycle 一致，ACTIVE gate 与真实 drain capability 满足声明。 |
| `invalidParameters` | Catalog 参数 schema、`validateScenarioParameters()`、consumer map | `durationSec`、default、min/max、option、unit、maxDuration、专用预算和参数消费者完整；没有未知或无消费者参数。 |
| `invalidRecoveryHook` | lifecycle supplement、Worker/Gateway capability、cleanup route test | release、drain、recovery check、manual cleanup/confirmation、non-releasing residual check 与 Catalog 策略一致。 |
| `missingEvidenceQuery` | evidence recipes | ID 唯一、source/window/timeout/judgment 合法，必需 Run Event/效果/recovery/cleanup 证据齐全，且失败语义为 `EVIDENCE_UNAVAILABLE`。 |
| `missingRunbook` | `RUNBOOK_METADATA`、双语 Markdown | Catalog 覆盖一对一、allowlisted 文件存在、必要标题和 alert section 齐全、固定 target service/operation 可由 Catalog 验证。 |
| `missingI18n` | locale message indexes、`SCENARIO_META`、`SCENARIO_GROUPS` | 每个场景 label/description、参数 label/description、recovery label、分组与双语 leaf key 完整；每场景恰好属于一个显示分组。 |
| `invalidAlertContract` | alert supplement、Prometheus/Alertmanager Compose/Kubernetes YAML、deployment-level `AgentDeliveryReadiness` | 规则的 name/service/severity/静态 label 与每个 `AlertCorrelationContract` 一致；internal intake 的 `sendResolvedToControlPlane` 和全局 receipt policy 独立校验；只有 external Agent delivery 明确 `ENABLED` 时才要求专用 Agent child route/receiver/credential source/`send_resolved` 一致。 |

`missingTarget` 与 `missingDispatch` 不得合并。一个场景可以正确映射到 Gateway、却没有 Worker effect path；也可以有 Worker、却错误选择了 target service。错误分类应让维护者直接知道要修哪一层。

### 7.3 静态配置读取

全量 validator 使用已有 `js-yaml` 依赖读取版本控制中的 Compose/Kubernetes Prometheus 与 Alertmanager 文件。它不能调用 `loadAlertConfig()`，因为该 API 会初始化数据库、尝试导入/回写配置，且生产镜像不保证包含仓库根目录的 `infra/`。

配置比较遵循语义规范化而非原始 YAML 文本比较：

- Prometheus：比较 rule name、severity、显式静态 labels、`for`、group interval 与表达式的稳定摘要；
- Alertmanager：分别校验 control-plane intake route/receiver 的 `send_resolved` 和可选 external Agent child route/receiver，按规范化 route tree 比较 receiver/match/group/repeat 语义；
- Compose/Kubernetes 允许 YAML 层级不同，只要有效 route/receiver 语义一致；
- `NOT_ENABLED_YET` 的专用 delivery 只输出 readiness note；若 `ENABLED` 却缺 route、receiver、Basic Auth source 或 `send_resolved: true`，则输出 `invalidAlertContract`。

Markdown 只用于文件存在、标题、固定 token 和安全格式检查；不得从 prose 推导告警名、恢复策略或证据判断。维护者应根据 generated checklist 同步解释性文档。

## 8. 运行时 admission 与 revision 持久化

### 8.1 两种运行时检查范围

| 检查 | 执行位置 | 输入 | 行为 |
| --- | --- | --- | --- |
| `validate:contract` | 外部 CI 调用的仓库根级脚本 | Catalog、descriptor、双语内容、部署 YAML、Gateway/target Java test results | 所有必需阶段完成且无 error 才输出最终 `valid`；TS 预检不是 release report。 |
| `validateRuntimeContract` | traffic-control-plane Web/API 的新 Run admission | 当前进程编译进去的 Catalog/supplement 与 normalized request | 仅校验进程内事实；不读取 Gateway Java map、目标服务代码、仓库部署文件或旧 Run revision。 |

生产 Docker image 只复制 control-plane 运行所需内容，不能把 CI 依赖的根目录 `infra/`、Kubernetes 配置或文档树视为运行时文件。因此，不应将全量静态 validator 挂到 `pnpm build` 或 Web 请求路径。

新增严格枚举配置；它只对 Web/API 的新 Run admission 生效，与 Phase 2 Reconciliation mode、safe-runtime 开关分离，不控制 Worker owner claim 或 scanner 接线：

```text
SCENARIO_CONTRACT_VALIDATION_MODE=warn|enforce
```

- 缺失值默认为 `warn`，以保持现有运行行为。
- 非法值必须在 `env.ts` 中导致启动失败，不能悄悄降级为 `warn` 或 `enforce`。
- 配置仅由创建 Run 的 Web/API 进程读取；Worker 不运行跨部署 Contract drift scan。
- `warn` 记录低基数的控制面结构化日志（category、scenario、revision），允许新 Run 按当前逻辑创建。
- `enforce` 仅在**当前 Catalog 已通过请求校验的同一版本新 Run**创建、持久化及 target invocation 前拒绝进程内 Contract 错误，返回正常 Operator error envelope `SCENARIO_CONTRACT_INVALID`；不做跨服务校验。

不实现 Worker 持久化 revision drift scan：部署会整体清空数据库和业务资源，运行期间 Catalog 随应用镜像固定。升级/回滚中途若没有执行 clean-slate reset，不属于本批次支持的保留数据部署模式。

### 8.2 `fault_runs` 和事件

最小持久化字段为：

```sql
contract_revision VARCHAR(128) NOT NULL
```

`VARCHAR(128)` 容纳 `sc.v1:sha256:<digest>`。完整 Evidence snapshot 不写入 `fault_runs`，由 Batch 4 在其 capture 开启时按自己的设计持久化；不写入告警 receiver、凭据或现场观测结果。

变更点如下：

1. `FaultRunRecord` 增加必填 `contractRevision: string`；当前 clean schema 不存在旧 Run/null projection。
2. `CreateFaultRunInput` 要求由 Coordinator 传入 server-derived 的非空 `contractRevision`。
3. `FaultRunCoordinator.create()` 在当前 Catalog lookup 和参数标准化后计算 revision。相同部署的幂等 replay 先返回同 signature 的既有 Run；只有没有既有 Run 的新 admission 才执行 `warn|enforce` Contract 检查，因而 replay 不受 mode 切换影响，也不重发 prepare/action。
4. `createFaultRun()` 在同一个 transaction 内将 revision 插入 `fault_runs`，并扩展既有 `CREATED` event payload：

   ```json
   {
     "scenario": "BROWSE_SURGE",
     "targetService": "catalog-service",
     "targetOperation": "browse-api-worker",
     "expiresAt": "2026-01-01T00:00:00.000Z",
     "fencingToken": 42,
     "contractRevision": "sc.v1:sha256:...",
     "catalogRevision": "<64-character lowercase SHA-256 hex>"
   }
   ```

5. `contract_revision` 在 fresh DDL 中为 `NOT NULL`；`transitionFaultRun()`、`appendFaultRunEvent()`、`attachOperatorAudit()` 均不得更新它。
6. 同一部署版本的幂等键以当前 Catalog 校验/标准化后的 `(scenario, normalized parameters)` 判重并返回原 revision；异 signature 返回冲突。部署 reset 清除 key，不保留跨部署 key/replay 语义。并发 create 的唯一约束/现有 repository 事务仍负责避免重复创建。
7. Operator-only run projection 和受控 `CREATED` event projection 返回该字段；消费者、Gateway 和目标服务路径保持不变。

现有 `toGatewayPayload()` 与 `createFaultRunContext()` 应保持显式白名单。Operator timeline 的 `CREATED` sanitizer 仅投影格式有效的 revision，不透传原始事件 payload。新增字段后必须有负向测试，证明它们没有通过对象展开意外进入出站 header/body。

### 8.3 Fresh schema、部署 reset 与 retention

用户确认的当前部署策略是清空数据库和业务资源后 fresh rebuild，不需旧库/旧行兼容。因此 Phase 3 不新增 `006` migration 或 `infra/mysql/init/10`，不在运行时做 `ALTER`。

更新并保持 parity 的三份 fresh schema：

- `traffic-control-plane/src/lib/fault-run-schema.ts` 的 `fault_runs` create statement；
- `traffic-control-plane/src/lib/migrations/001-fault-runs.sql`；
- `infra/mysql/init/04-fault-run-schema.sql`。

`pnpm db:migrate` 在全新数据库上运行既有 `001`–`005`；本批次不新增 migration file、修改 migration registry 或提供从已有 volume 的 upgrade path。fresh MySQL init、runtime schema creation 与 `001` 必须都创建 `contract_revision NOT NULL`。`db:verify` 增加该列存在/类型/非空属性检查，但遇到非 clean schema 应 fail fast、不隐式 `ALTER`。

部署前停止旧 Web/API 与 Worker，再对确认可丢弃的整套环境同时重置数据库和业务资源；不要求按 Run 逐条 stop/release/cleanup，也不允许新旧二进制混跑。reset 会销毁 Fault Runs、events、idempotency keys、alert receipts、baselines、存储文件及其他业务资源；它不是 per-Run cleanup。Contract revision 与 Run/event 使用现有 retention，不是长期归档。未来切换到保留数据的部署前，必须另行完成 schema migration、active Run 处置和历史合同/archive 设计。

## 9. 辅助生成与命令接口

### 9.1 确定性产物

`scenario-contract-artifacts.ts` 从 `ResolvedScenarioContract` 生成以下只读产物：

| 产物 | 内容 | 使用边界 |
| --- | --- | --- |
| canonical manifest | schema version、catalog revision、每个 scenario contract revision、无 secret 的结构摘要。 | CI upload 或本地 `tmp/`；不作为 production source。 |
| validation report | 有序 issue、分类、field path、修复提示。 | CI annotation/审查；失败时仍上传。 |
| console form metadata | 参数类型、单位、默认值、范围、选项、必填性。 | 为未来表单重构提供输入；当前 UI 仍读取 Catalog。 |
| runbook checklist | 每场景所需 lifecycle/evidence/alert/cleanup section。 | 指导维护者；不自动覆盖 Markdown。 |
| smoke matrix | 场景、启动前提、最小 lifecycle/evidence assertion、是否适合 live smoke。 | 未来 smoke harness 输入；不是已执行测试结果。 |
| terminology input | Catalog scenario ID 加经过审查的固定控制面术语。 | 驱动 runtime terminology 检查，避免 shell 正则遗漏新场景。 |

所有生成文件包含 schema version，不包含 `generatedAt` 等非确定性字段；输出目录使用 `tmp/scenario-contract/`。若将 manifest 提交供发布审查，必须用显式 `--check` 模式验证其和当前 Catalog 一致，运行时不得读取该提交副本。

### 9.2 package 与根级命令

建议新增：

```json
{
  "scripts": {
    "test:contract": "tsx --test src/lib/scenario-contract.test.ts",
    "validate:contract:preflight": "tsx scripts/validate-scenario-contract.ts --stage=preflight",
    "validate:contract:finalize": "tsx scripts/validate-scenario-contract.ts --stage=finalize"
  }
}
```

根级 `scripts/test-scenario-contract.sh` 由外部 CI 调用，分阶段执行并汇总：

```text
pnpm --dir traffic-control-plane test:contract
pnpm --dir traffic-control-plane validate:contract:preflight -- --output "$TMP/scenario-contract/expected.json"
Maven tests for gateway-service + catalog/order/notification/promotion/inventory/psp target modules
pnpm --dir traffic-control-plane validate:contract:finalize -- --checks "$TMP/scenario-contract/checks/"
pnpm --dir traffic-control-plane test:runbook
pnpm --dir traffic-control-plane test:i18n
./scripts/check-runtime-terminology.sh
pnpm --dir traffic-control-plane typecheck
pnpm --dir traffic-control-plane lint
```

预检阶段可以报告 TypeScript/文档/部署声明的结果，但不能输出最终 12/12 `valid`。gateway 和目标服务测试读取同一 revision 的生成期望，分别证明 Operation registry 路由和真实 controller mapping/wire contract；最终阶段收集这些结构化结果，缺少任一 required target result 即非零并标 `missingTarget`。不能以 Gateway map 字符串对比替代目标服务 endpoint test。

仓库目前没有 GitHub Actions workflow；按用户决策，本批次不新建 GitHub workflow。外部 CI 必须调用根脚本并将它设为 blocking/required，成功或失败都上传去敏 manifest、预检和最终报告；任务证据要确认 pipeline 已实际接线，不能只以脚本存在代表阻断已启用。MySQL 与 live scenario smoke 只在可丢弃环境独立执行。

## 10. runbook、i18n、告警配置与术语检查

### 10.1 Runbook

现有 `runbook.test.ts` 已校验 12 个 Catalog 场景与 `RUNBOOK_METADATA` 一对一、双语文件集合、八个通用标题和 Mermaid 安全边界。批次 3 在此基础上：

1. 为中英文文章都要求 `Alert mapping` / `告警关联` 标题；
2. 验证文章有 scenario ID、Catalog target service 和 target operation 的受控引用；
3. 使用 checklist 验证 prepare/active/stop/release/cleanup/recovery/evidence 的必要说明存在；
4. 保持 `getRunbookEntry()` 从 Catalog 合并 target/duration/recovery；Tempo service/route/query 展示数据从 Evidence Contract 派生，`RUNBOOK_METADATA` 只保留文档与影响解释元数据；
5. 不从自由文本解析 alert name、threshold 或 recovery policy；这些值以 Contract supplement 为准，Markdown 解释由审查与 checklist 保持同步。

### 10.2 i18n 和展示 metadata

`messages.test.ts` 继续负责英中文件的 leaf-key/ICU placeholder parity。新增 Catalog-driven 检查：

- `Scenarios.scenarioMeta.<SCENARIO>.label` 和 `.description`；
- `Scenarios.parameters.<parameter>.label` 和 `.description`；
- 每个 `FaultRunRecoveryStrategy` 的 label；
- `SCENARIO_META` 与 Catalog 精确覆盖；
- `SCENARIO_GROUPS` 的并集等于 Catalog，且每个场景只出现一次；
- 新 Catalog 场景不得依靠 unknown fallback 通过测试。

场景 label/description 不进入 revision hash；它们属于可本地化展示文案而非运行 Contract。但缺失 i18n 仍是 `missingI18n`，以避免 Operator 创建不可理解的 Run。

### 10.3 术语隔离

现有 `scripts/check-runtime-terminology.sh` 将 12 个 scenario ID 硬编码在正则中，新增场景时容易失效。生成器应输出经过正则安全转义的 scenario ID 输入；shell checker 读取它和一个受审查的静态基础术语列表。

检查范围保持不变：仅扫描控制面目录之外的 `**/src/**`，并排除构建产物。生成逻辑、Catalog ID 和任何控制面术语仍只允许留在 `traffic-control-plane/**` 与 operator 文档中。fixture 测试必须证明新增 Catalog scenario 会自动使外部 runtime source 中的该 ID 失败。

### 10.4 Alert configuration

Contract validator 读取 `infra/prometheus/rules/alert-rules.yml`、`infra/alertmanager/alertmanager.yml` 和 Kubernetes 对应配置。它只检查版本控制的部署意图，不通过 Alertmanager HTTP API、数据库编辑器或外部 receiver 发送请求。

`alert-config.ts` 当前可以读取/渲染可编辑 YAML，但其 source import 和数据库初始化不适合作为 CI Contract 输入；尤其不能将 runtime DB 中的 receiver 密码、fallback receiver 或临时编辑状态写入报告。阶段 5 启用专用 intake receiver 前，需要按其技术设计将 credential 设为部署管理、不可经 Operator 配置编辑器回写。

## 11. 配置、发布、回退与可观测性

### 11.1 配置位置

新增 admission-only `SCENARIO_CONTRACT_VALIDATION_MODE` 后，以下位置必须同一变更更新：

| 位置 | 处理 |
| --- | --- |
| `traffic-control-plane/src/lib/env.ts` | 严格解析 `warn`/`enforce`，非法值启动失败。 |
| `docker-compose.yml` 的 traffic-control-plane Web/API | 显式设为 `warn`；Worker 不读取该 mode。 |
| `k8s/services/traffic-control-plane/deployment.yaml` | 通过 `app-config` 或明确 env 设为 `warn`。 |
| 外部 CI / 部署说明 | 外部 CI 调用根级脚本并设为 blocking；部署说明记录 clean-slate reset、模式切换和 rollback。 |

本批次不新增密码、token、service key 或 Agent credential。Alert delivery 的凭据来源仅作为 Contract 声明，真实 Secret 由阶段 5 部署管理。

### 11.2 灰度顺序

```text
实现 typed Contract + unit fixtures
  -> 补齐 Catalog supplement 和 derived capability checks
  -> static CI gate 通过
  -> 清空 disposable DB 与业务资源并 fresh initialize
  -> Web/API 以 warn 部署并写 non-null revision
  -> 验证新 Run/Event revision 一致、无业务协议泄漏
  -> 单 Worker disposable 环境 enforce canary (Reconciliation=OFF)
```

`enforce` 仅用于用户确认的单 Worker disposable canary，不自动推广到保留数据或多 Worker 部署。canary 前至少需确认：

- 静态 report 对 12 个场景无 error；
- `CART_CATALOG_DEPENDENCY` 有真实 dispatch，不是文档占位；
- 实际 driver 仅在 `ACTIVE` 执行，并按 Catalog policy 注册可等待的 drain；
- `NON_RELEASING` 与 `MANUAL_CLEANUP` 的 coordinator policy 已与实际 target 行为一致；
- Gateway cleanup 与 target cleanup wire contract 已经过真实 controller/integration test；
- 新建 Run 的 table 字段、`CREATED` event 与 Operator 事件投影 revision 相同，且 Gateway/context payload 仍无该字段；
- Alert contract 与 Batch 5.0 receipt schema 对齐；`NOT_ENABLED_YET` 只表示 Agent delivery 未启用，不影响通用 receipt。

### 11.3 回退

回退优先将 mode 从 `enforce` 改为 `warn`。本批次 canary 只在可丢弃环境；整库/业务资源 reset 是显式的破坏性重建，不是保留数据环境的一般 rollback。具体规则：

1. disposable canary 终止后可整体重建 DB 与业务资源；记录被清除数据范围，不能声称保留 Run 证据或完成 per-Run cleanup；
2. `contract_revision` 是 required fresh-schema 字段；回退代码时须同时 clean rebuild，不支持旧二进制读写新旧 schema 混跑；
3. 静态 CI gate 若因真实 drift 失败，应修复 source；不能通过关闭运行时 mode 绕过发布门禁；
4. 转为保留数据库部署前必须先另行实现并演练 migration/active-run 处置策略；
5. Alertmanager receiver 的启停不属于批次 3 回退；其顺序遵循批次 5.0 设计。

### 11.4 控制面可观测性

V1 只使用控制面结构化日志和 CI report 记录校验结果；本批次不新增 Node metrics exporter、Prometheus counter 或 revision drift metric。允许的日志字段为 `scenario`、`contractRevision`、`category`、`mode` 和稳定错误 code。不得记录完整 Contract、参数值、告警 label 集合、用户会话、凭据、目标 response 或原始观测结果。revision hash 和场景 ID 留在控制面日志/Operator API 内；它们不能传播到消费者/业务服务 trace、metric 或 response。

## 12. 测试设计

### 12.1 TypeScript 单元与 fixture 测试

1. canonicalization 在 object key、参数声明顺序变化和无序集合重排时稳定；任一实际 Contract 字段变化时相应 revision 改变，UI 字段排序不影响 hash。
2. 12 个真实 Catalog 场景生成唯一 resolved Contract、64-hex `catalogRevision` 和 `sc.v1:sha256:` per-run `contractRevision`。
3. 每个八类诊断至少有一个独立的 fixture：
   - target service/operation 缺失或不匹配；
   - scenario 没有或有多个 dispatch owner；
   - 参数 default、duration、consumer、预算或 unit 非法；
   - drain/release/manual/non-releasing lifecycle hook 不合法；
   - evidence recipe 缺失、ID 重复、window/source 不合法；
   - 双语 runbook 文件/标题/固定 operation 缺失；
   - i18n key、metadata 或分组缺失；
   - alert rule/severity/label/window/delivery route 不一致。
4. `NOT_ENABLED_YET` 的完整 alert declaration 在静态 Contract 中可通过，同时产生 readiness note；将它错误标为 `ENABLED` 后必须失败。
5. 不把 `prepare succeeded`、alert receipt、effect observed、business recovered 和 cleanup completed 互相自动推导。
6. generated manifest/report/form/checklist/smoke/term 输出稳定，且不含 secrets 或绝对路径。

### 12.2 控制面、Worker 与 Gateway 测试

1. `FaultRunCoordinator.create()` 是 API 的统一创建入口：当前 Catalog 先校验/标准化，之后创建同一版本内幂等对照；`executionMode` 未设置时走 legacy create + adapter prepare，设置时在事务中创建 execution/PREPARE intent 后由 Reconciler dispatch。Contract admission/revision 在 Run 写入和 target action 前执行。
2. `createFaultRun()` transaction 同时写 table revision 和 `CREATED` payload；两者相同。
3. 同一 Catalog/schema 版本内，使用标准化参数的 replay 返回原 revision 且不重派发；不提供跨部署 replay。
4. `FaultRunRecord.contractRevision` 在 fresh schema/API 中为必填 string；state transition 不能更改 revision，无旧行 null fallback 测试。
5. `toGatewayPayload()`、`FaultRunContext`、owner-fenced action/cleanup payload 均没有 `contractRevision`。
6. 每个 owned driver capability 与实际 Reconciler 的 ACTIVE gate、drain registration、summary event 一致；CREATING 只可执行已声明 prepare，RECOVERING/终态不得启动 effect driver。
7. `OperationDispatchContractTest` 验证 target-backed Catalog input 与 Gateway registry、target endpoint path 和 cleanup payload 的兼容性。
8. runless scenario cleanup 被明确拒绝；Cache 与 Notification Storage 的 confirmed per-run cleanup 均绑定原 Run operation/fence，不会跨 operation 路由。

### 12.3 数据库、部署与端到端验证

1. 空数据库分别经 MySQL init 和现有 `db:migrate` path 初始化后都含同一 `contract_revision NOT NULL` 定义；runtime schema、`001` 与 init `04` 的 fresh schema parity test 通过。不做旧库升级测试。
2. `db:verify` 对 fresh schema 检查 revision column/type/NOT NULL；未清库的不兼容 DB 应 fail fast，不得隐式 ALTER。
3. Compose 与 Kubernetes Alert/Prometheus YAML 语义规范化后匹配；只有外部 Agent delivery 标为 `ENABLED` 时才要求专用 route/receiver。
4. 在单 Worker disposable、`FAULT_RUN_RECONCILIATION_MODE=OFF` 环境创建一个有效 Run，检查 Operator `CREATED` event revision 投影、table/event revision 一致和 Gateway/consumer 协议边界；按用户部署模式整体 reset 数据库与业务资源。
5. 现有 `catalog-product-detail-smoke.sh` 仍只代表一个场景 smoke，不能被报告为 12 个场景 Contract 验证；运行未覆盖的场景必须报告 limited。
6. 外部 CI 执行根脚本并配置为 blocking status；本仓库不创建 GitHub Actions workflow。`git diff --check`、terminology、control-plane typecheck/lint/build 均通过。

## 13. 实施顺序与任务拆分

| 顺序 | 交付 | 依赖 | 完成标准 |
| --- | --- | --- | --- |
| 1 | Contract 类型、resolver、canonicalizer 和 fixture test | 无 | 不重复 Catalog 策略；revision 稳定且参数顺序无关。 |
| 2 | 在 Catalog 补齐 12 个 supplement | 1 | 每项含 dispatch/lifecycle/parameter/evidence/alert 声明。 |
| 3 | Owned driver capability projection 与 ACTIVE/drain coverage tests | 1、2、批次 1/2 | 复用 P2 drivers/registry/recovery；没有 `missingDispatch` 或虚报 drain，不重建 Worker 执行器。 |
| 4 | Gateway registry 抽取和跨语言 test input | 1、2 | target-backed operation/service/path 可被 Maven gate 验证。 |
| 5 | runbook/i18n/alert/terminology validator inputs | 1、2 | 现有文档和 locale 与 Catalog 精确覆盖。 |
| 6 | full validator、report、辅助生成和根级 static script | 3～5 | 八类负向 fixture 和真实 12 场景 report 可重复执行。 |
| 7 | fresh schema revision persistence 与 Operator serialization | 1、6 | clean schema 中 revision NOT NULL；row/CREATED/Operator event 一致；无 legacy fallback/upgrade migration。 |
| 8 | warn/enforce 配置、外部 CI 接入和 fresh-image validation | 6、7 | 外部 CI 阻断；runtime 只检查本进程新 Run admission。 |
| 9 | 单 Worker disposable enforce canary | 3～8 | `FAULT_RUN_RECONCILIATION_MODE=OFF`；完整 reset DB 和业务资源；有可复核 rollback。 |

步骤 3 与 4 主要是现有 Phase 2 capability 的投影与跨语言验证，不代表必须重新实现 Worker/Reconciler。若测试发现真实 Phase 2 行为不满足 Contract，先在任务清单登记差异、更新本设计和对应 Phase 2 gate，再决定是否新增代码；strict gate 不得将未验证的 capability 标为通过。P3 enforce canary 只验证单 Worker、legacy Reconciliation OFF 的创建门禁，不宣称 Phase 2 TAKEOVER 已验证。

## 14. 验收与退出条件

批次 3 完成需要同时满足以下条件：

1. 12 个 Catalog 场景均能解析为唯一、版本化的 `ResolvedScenarioContract`，真实静态 report 无 error。
2. Catalog、Gateway、Worker、recovery/cleanup、runbook、i18n、evidence 和 alert 声明通过八类校验；新场景缺项会在 CI 中失败。
3. `contract_revision` 在 clean schema 中 NOT NULL，新建 Fault Run 的数据库行、`CREATED` event 与 Operator 投影一致；不支持旧数据/nullable fallback。
4. 消费者和业务服务的请求、响应、日志、metric、trace 和通用内部 operation context 均不包含 Contract/Catalog/Fault Run 生命周期语义。
5. `NOT_ENABLED_YET`、`EVIDENCE_UNAVAILABLE`、`UNMATCHED`/`AMBIGUOUS` 等不确定性被显式表示；没有“场景已启动，所以告警一定 firing”或“prepare 成功，所以效果已观察到”的推论。
6. 所有 generated artifact 可重复生成，未成为手工维护的第二数据源，也未自动覆盖 runbook/生产代码。
7. 外部 CI 根级 static gate 阻断；运行时默认 `warn`，只在本进程新 Run admission 事实完整并通过单 Worker disposable canary 后启用 `enforce`。跨层校验只由 CI 声称。
8. clean-slate schema 与 disposable reset/canary 有复核证据；该方案不声明为保留数据环境的 migration/rollback 方案。

满足退出条件后，阶段 4 可以消费 resolved Contract 的 evidence recipe 和 revision，而不再从 Catalog、runbook、Worker 条件或告警 prose 中猜测场景边界。
