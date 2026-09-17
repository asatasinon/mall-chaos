# 批次 3：Scenario Contract 技术设计

> 状态：技术设计 v1，待实施评审<br>
> 配套产品规格：[product.md](./product.md)<br>
> 对应路线阶段：阶段 3<br>
> 前置条件：批次 0～2 的运行事实、drain、owner/reconcile 语义已可验证<br>
> 设计原则：Catalog 单一事实源、跨层显式校验、只读生成、增量迁移、业务协议零泄漏

## 1. 设计结论

批次 3 将当前散落在 Catalog、Gateway、Worker、runbook、i18n、告警配置和测试中的隐式约束，收敛为一个可解析、可哈希、可验证的 **Scenario Contract**。它不创建第二份可手工编辑的场景清单，也不向业务服务、消费者请求或响应传递 Contract。

实现采用以下结论：

1. `traffic-control-plane/src/lib/fault-run-catalog.ts` 继续是所有场景可变事实的唯一来源。每个场景所需的执行、恢复、证据和告警补充语义直接附着在该 Catalog 项上；新模块只提供类型、规范化、校验和投影，不保存第二份 `scenario -> contract` 表。
2. Gateway、各 Worker 和目标服务继续拥有自己的手工运行映射。它们必须导出最小的、只用于校验的 capability descriptor；Contract validator 比较这些 descriptor 与 Catalog，而不通过 AST、正则或 Markdown prose 猜测运行行为。
3. 静态校验在 CI 中为阻断门禁；运行时默认 `warn`，只记录控制面诊断，不改变已存在 Fault Run 的执行、停止或恢复。所有 12 个场景稳定通过后，才在测试环境和 canary 中将**创建新 Run**提升为 `enforce`。
4. 新建 Fault Run 在同一个 MySQL 创建事务内写入 server-derived `contractRevision`，并将相同值写进既有 `CREATED` 事件。该字段只出现在 Operator 内部读模型，不能进入 Gateway payload、`FaultRunContext` 或业务服务协议。
5. Contract 的 alert 声明必须区分“控制动作完成”“目标效果被观察到”“告警 receipt 已接收”和“证据不可用”。场景开启绝不表示告警一定 firing；阶段 5 的 receiver 尚未部署时使用显式的 `NOT_ENABLED_YET` 状态，而不是伪造已就绪。
6. Contract 只生成表单元数据、runbook checklist、smoke matrix、术语检查输入和 CI artifact；v1 不自动生成或改写生产路由、Worker 代码、目标服务接口或 Markdown 正文。

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
| prepare、active、stop、release、cleanup、recovery | 在 Contract 中声明可验证的 capability 和检查项；校验现有实现是否有相应 hook。 |
| 证据和告警 | 为阶段 4、5 定义结构化声明与校验规则；不采集或保存 Prometheus、Loki、Tempo 的现场数据。 |
| runbook、i18n、术语隔离 | 扩展已有覆盖检查，并生成维护者辅助工件。 |
| Contract revision | 为新 Fault Run 持久化 revision，支持 Operator 时间线追踪。 |
| CI 和发布门禁 | 增加独立的静态命令、报告工件和阻断流程。 |

以下内容明确不属于批次 3：

- 不改变消费者 API、业务服务接口、目标侧通用内部协议或 Gateway 的外部可见行为。
- 不向目标服务发送 `scenario`、display name、`contractRevision`、恢复策略、告警规则、Evidence Query 或控制面生命周期状态。
- 不自动修复、自动 release、自动 cleanup，也不把 Contract 校验变成目标服务的 Controller 校验。
- 不把 Contract manifest 当作离线指标、日志、Trace、数据库、Redis、JVM heap、文件系统或 PSP 现场快照。
- 不实现 Alertmanager receipt 接收、外部 Agent 投递、RCA 提交或 Evaluator；这些分别属于批次 5.0、5.1 和 5.2。
- 不把一次 Contract revision 当作历史场景内容归档。Fault Run 仍遵循现有七天 retention；长期可重放的 Contract archive 如有需要，应作为后续独立的、无级联删除设计。

## 3. 当前实现基线与阻断项

当前系统已有严格的 Catalog 参数校验、Gateway top-level payload 校验、`fault_runs` 全局 active-run guard、Cache target summary 校验、双语 runbook 覆盖与 i18n key parity。它们是本批次的复用基础，但尚未组成一个 Contract。

| 发现 | 当前事实 | Contract 处理与上线条件 |
| --- | --- | --- |
| Catalog 与 Gateway 的关系 | Catalog 有 12 个场景；Gateway `OperationDispatchController.TARGETS` 有 10 个 target-backed operation；两种 surge operation 是本地 Worker bypass。 | 校验 target-backed operation 的 service/operation 一致性，并明确声明本地 Worker bypass。不能把“Gateway 找不到 operation”误判为所有场景错误。 |
| Worker dispatch 分散 | 报表、surge、受控场景和 Runner 分别用硬编码条件筛选场景。 | 每个 owner 导出 descriptor；每个 Catalog 场景必须恰好匹配一个 owner。 |
| `CART_CATALOG_DEPENDENCY` | P0-13 已在 `ScenarioWorkers` 中补齐该 ID 的 Gateway customer-session dispatch 和生命周期事件；真实请求/终态事件仍未运行核验。 | Contract 仍必须导出并校验唯一 dispatch owner、业务流量入口和 drain/summary capability；没有运行事实时继续保留 `UNKNOWN`/`INCOMPLETE`，不能用 `TARGET_ONLY` 占位。 |
| runnable state | `listActiveFaultRuns()` 返回 `CREATING`、`ACTIVE`、`RECOVERING`；只有 `ScenarioWorkers` 额外限定 `ACTIVE`。 | 批次 1/2 前置修复：所有执行器必须只消费 `ACTIVE` Run。Contract descriptor 的 `requiresActiveState` 必须为真。 |
| worker drain | `ScenarioWorkers` 已注册 coordinator drain；报表、surge 和 Runner 尚未对每个 Run 注册 drain。 | `WORKER` 或实际产生流量的 Contract 必须要求真实 drain registration、停止接收新请求和最终 drain 事件。缺失时为 `invalidRecoveryHook`。 |
| recovery strategy | `FaultRunCoordinator.recover()` 当前总是 drain 后调用 adapter stop，未读取 `recoveryStrategy`。 | Contract 不能把现有字符串当作已执行事实。Phase 1/2 必须提供显式 recovery policy resolver 后，才可对所有场景开启严格检查。 |
| manual cleanup | scenario-wide cleanup route 对所有允许清理的场景固定发送 `notification-storage`；per-run route 使用保存的 target operation。 | `CATALOG_REDIS_LARGE_VALUE` 目前会被错误路由。`MANUAL_CLEANUP`/`PER_RUN` capability 未修复前不得通过严格校验。 |
| cleanup wire compatibility | Gateway cleanup 只发送 `runId`、`operation`、`fencingToken`，而 target cleanup handler 的上下文校验并不完全一致。 | Gateway registry test 和 target endpoint test 必须证明声明的 cleanup mode 与实际 wire contract 兼容。 |
| evidence | runbook 有展示用 Tempo recipe，但没有 run-relative PromQL/LogQL/TraceQL、业务检查或 `evidence_unavailable` 声明。 | 所有场景必须增加结构化 evidence recipe；不可将 `now-1h to now` 的 UI 提示冒充阶段 4 Manifest。 |
| alert delivery | P0-13 已补齐内部 webhook route、service-key credentials file 和低基数 receipt；当前仍为 generic receiver，尚无阶段 5 专用 child route、告警关联和外部 Agent receiver。 | 每个场景必须有完整 alert declaration；当 delivery 为 `NOT_ENABLED_YET` 或尚未完成真实 receipt 时静态 Contract 可通过，但 readiness 报告必须说明未可投递/未核验。 |
| Contract revision | `fault_runs`、`fault_run_events` 和 API record 中均没有 revision。 | 通过 nullable additive column 和既有 `CREATED` event 写入；不回填旧 Run。 |
| 迁移 | `CREATE TABLE IF NOT EXISTS` 无法为既有 volume 加列；`infra/mysql/init` 只在新 volume 执行；当前没有通用 migration runner。 | 必须先交付显式、可审计的 control-plane migration 命令/Job，再依赖新列。不能通过重置数据库或启动时静默 `ALTER` 升级。 |

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
| `RUNBOOK_METADATA` 与 Markdown | runbook | 文档文件 allowlist、展示用业务路径和 Tempo 提示。 | 以自由文本作为 target/recovery/evidence 的权威来源。 |
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

export type ScenarioDispatchOwner =
  | 'REPORT_WORKER'
  | 'TRAFFIC_SURGE_EXECUTOR'
  | 'SCENARIO_WORKERS'
  | 'RUNNER_ENGINE';

export type TargetLifecycleMode = 'GATEWAY' | 'LOCAL_WORKER';
export type CleanupMode = 'NONE' | 'PER_RUN' | 'SCENARIO_WIDE';
export type ParameterConsumer = 'ADMISSION' | 'TARGET_PREPARE' | 'WORKER_EXECUTION';
export type EvidenceSource =
  | 'RUN_EVENT'
  | 'PROMETHEUS'
  | 'LOKI'
  | 'TEMPO'
  | 'BUSINESS_CHECK'
  | 'RESOURCE_CHECK';
export type EvidenceWindow = 'BASELINE' | 'ACTIVE' | 'RECOVERY' | 'CLEANUP';

export interface ScenarioContractSupplement {
  dispatch: {
    owner: ScenarioDispatchOwner;
    requiresActiveState: true;
    requiresDrain: boolean;
    terminalSummaryEvent: string;
  };
  targetLifecycle: {
    mode: TargetLifecycleMode;
    prepareRequired: boolean;
    release: 'REQUIRED' | 'FORBIDDEN' | 'NOT_APPLICABLE';
    cleanup: {
      mode: CleanupMode;
      trigger?: 'OPERATOR_CONFIRMED';
      owner?: 'OPERATOR';
      completionCheckIds: readonly string[];
    };
    prepareAssertionIds: readonly string[];
  };
  parameterConsumers: Readonly<Record<string, readonly ParameterConsumer[]>>;
  lifecycle: {
    recoveryCheckIds: readonly string[];
    sideEffectCheckIds: readonly string[];
    nonReleasingReason?: string;
  };
  evidence: readonly EvidenceRecipeDefinition[];
  alert: ScenarioAlertContract;
}

export interface ResolvedScenarioContract extends ScenarioContractSupplement {
  schemaVersion: typeof SCENARIO_CONTRACT_SCHEMA_VERSION;
  scenario: FaultRunScenario;
  targetService: string;
  targetOperation: string;
  maxDurationSec: number;
  recoveryStrategy: FaultRunRecoveryStrategy;
  allowManualCleanup: boolean;
  parameters: readonly FaultRunParameterDefinition[];
}
```

限制规则：

- `durationSec` 必须存在于每个场景的参数中，并在 `parameterConsumers` 中至少有 `ADMISSION`；实际执行方需要 expiry 时必须声明 `WORKER_EXECUTION` 或 `TARGET_PREPARE`。
- `parameterConsumers` 的 key 集合必须和 Catalog `parameters[].name` 完全相等。缺少、额外或空消费者均为 `invalidParameters`。
- `TargetLifecycleMode.LOCAL_WORKER` 仅允许本地 Worker target bypass，`prepareRequired` 必须为 `false`、`release` 为 `NOT_APPLICABLE`，且不能要求 Gateway `TARGETS` entry。
- `TargetLifecycleMode.GATEWAY` 要求 Catalog target operation 存在于 Gateway registry；除明确 `NON_RELEASING` 策略外，release 必须为 `REQUIRED`。
- `CleanupMode.PER_RUN` 要求使用保存在 Fault Run 中的 `runId`、operation 和 fencing token；`SCENARIO_WIDE` 只能用于 Gateway 明确支持的无 Run cleanup endpoint，且需要 Operator confirmed trigger。
- `NON_RELEASING` 场景必须给出 `nonReleasingReason`、停止后的 side-effect check 和恢复检查，且 `release` 不能写为 `REQUIRED`。这会暴露当前 notification heap 行为与 Catalog 的不一致，不能以“已有 release route”为通过条件。

### 5.2 证据声明

`EvidenceRecipeDefinition` 是阶段 4 可复用的结构化输入，不是现场数据，也不是可由用户请求指定的查询文本：

```ts
export interface EvidenceRecipeDefinition {
  recipeId: string;
  source: EvidenceSource;
  window: EvidenceWindow;
  required: boolean;
  subject: string;
  queryTemplateOrOperation: string;
  judgmentRuleId: string;
  timeoutMs: number;
  unavailableOutcome: 'EVIDENCE_UNAVAILABLE';
}
```

所有 recipe 必须满足：

- `recipeId` 采用稳定 lower-kebab 命名并全局唯一，例如 `browse-surge.prometheus.active-rate`。
- 查询模板、业务只读 operation、判断规则均为可信静态字符串；不得接受 Operator、消费者或 Agent 提供的 PromQL、LogQL、TraceQL、URL、SQL 或 shell。
- 每个场景至少有一个 `RUN_EVENT` recipe、一个与效果相符的观测 recipe，以及一个与 recovery/cleanup 语义相符的 recipe。
- `MANUAL_CLEANUP` 必须有 `CLEANUP` window 的 completion recipe；`NON_RELEASING` 必须有停止后 residual-effect 或 service-recovery recipe。
- 任何查询失败、权限不足、retention 超期或数据不存在均返回 `EVIDENCE_UNAVAILABLE`，不能转换成“效果未发生”或“已恢复”。

现有 `RUNBOOK_METADATA.tempo` 保留为展示用途。阶段 3 可以校验其 service/route 与 Contract evidence subject 不冲突，但不能把 `now-1h to now` 或 Tempo 页面链接视为 run-relative Evidence Query Manifest。

### 5.3 告警声明

每个场景必须显式声明 alert 边界，包括没有合理告警预期的场景：

```ts
export type ScenarioAlertContract =
  | {
      expectation: 'NOT_EXPECTED';
      reason: string;
      missingAlertTreatment: 'EFFECT_CAN_STILL_BE_OBSERVED';
    }
  | {
      expectation: 'CONDITIONAL' | 'REQUIRED_FOR_PILOT';
      allowedAlerts: readonly AlertSelector[];
      correlation: {
        activeGraceBeforeSec: number;
        recentGraceAfterSec: number;
        incidentKeyLabels: readonly string[];
      };
      missingAlertTreatment: 'EFFECT_CAN_STILL_BE_OBSERVED' | 'EVIDENCE_UNAVAILABLE';
      receiptPolicy: {
        retainAtLeastThrough: 'FAULT_RUN_RETENTION_END';
        close: 'EXPLICIT_OR_TERMINAL_FLOW_ONLY';
        fingerprintDedup: true;
        resolvedHandled: true;
      };
      delivery: {
        state: 'NOT_ENABLED_YET' | 'ENABLED';
        childRouteName: string;
        externalReceiverName: string;
        basicAuthCredentialSource: 'DEPLOYMENT_MANAGED_SECRET';
        sendResolved: boolean;
      };
    };

export interface AlertSelector {
  alertName: string;
  service: string;
  severity: 'info' | 'warning' | 'critical';
  requiredLabels: Readonly<Record<string, string>>;
}
```

`allowedAlerts` 表示允许用于关联或 pilot 的真实信号，不表示触发保证。对于 Prometheus rule 仅以 runtime series 产生 `service` label 的场景，静态校验可证明 rule name、severity 和静态 selector 合法，但不能承诺某个 service/URI 一定产生 series 或达到阈值。

`delivery.state = NOT_ENABLED_YET` 仍要求写出未来专用 child route、外部 receiver、凭据来源和 `sendResolved` 策略；它表示阶段 5 基础设施尚未启用，而不是少填字段。只有 `ENABLED` 才要求 Compose 与 Kubernetes 真实存在对应 child route、receiver、机器认证来源和一致的 `send_resolved`。

### 5.4 revision

Contract 需要两个可读的稳定身份：

| 字段 | 输入 | 用途 |
| --- | --- | --- |
| `catalogRevision` | 按 scenario 排序后的全部 resolved Contract 集合 | CI report、发布审查和全局 Catalog 变化比较。 |
| `contractRevision` | 单个 Fault Run 所选 `ResolvedScenarioContract` | Run/Event 追踪、Operator 时间线和后续 Evidence Query 关联。 |

二者使用同一 canonicalization 算法，格式为 `sc.v1:sha256:<lowercase-hex>`。canonicalization 的规则如下：

1. 排序 object key，保留缺失字段与显式 `null` 的差异；
2. Catalog scenario 按 `scenario` 排序；
3. 参数数组保留 Catalog 声明顺序，因为该顺序影响表单展示；无顺序语义的 evidence、alert selector、检查 ID 集合按稳定 ID 排序；
4. label map key 排序，数字保留 JSON 数字语义；
5. 不纳入请求参数实际值、`faultRunId`、fencing token、时间戳、运行环境 URL、密码、token、文件绝对路径、观测结果或显示文案；
6. 对 canonical JSON 使用 Node `crypto.createHash('sha256')`。

这样，场景 Contract 的实际结构变更会改变 `contractRevision`；同一 Contract 的输入顺序变化不会产生伪 revision。运行请求的规范化参数仍独立记录在 `fault_runs.parameters_json`。

## 6. 执行、目标与生命周期 capability

### 6.1 预期 ownership matrix

下表是 Contract 必须表达的运行 owner。表中“当前状态”是设计评审时的事实，不是临时豁免。

| 场景 | 预期 dispatch owner | target lifecycle | cleanup mode | 当前状态 |
| --- | --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | `REPORT_WORKER` | `GATEWAY` | `NONE` | 有报表 Worker；需要 ACTIVE-only gate 和实际 drain 注册。 |
| `ORDER_REPORT_SQL` | `REPORT_WORKER` | `GATEWAY` | `NONE` | 同上。 |
| `BROWSE_SURGE` | `TRAFFIC_SURGE_EXECUTOR` | `LOCAL_WORKER` | `NONE` | 有本地 target map；需要 ACTIVE-only gate 和 drain 注册。 |
| `ORDER_QUERY_SURGE` | `TRAFFIC_SURGE_EXECUTOR` | `LOCAL_WORKER` | `NONE` | 同上。 |
| `CATALOG_REDIS_LARGE_VALUE` | `SCENARIO_WORKERS` | `GATEWAY` | `PER_RUN` | 已有 ACTIVE gate 和 drain；仍需验证 target summary/cleanup contract。 |
| `CART_CATALOG_DEPENDENCY` | `RUNNER_ENGINE` | `GATEWAY` | `NONE` | 当前缺失真实 dispatch，必须先补齐。 |
| `NOTIFICATION_HEAP_PRESSURE` | `RUNNER_ENGINE` | `GATEWAY` | `NONE` | 当前 `NON_RELEASING` 与无条件 release 不一致，必须通过 recovery policy 修复。 |
| `NOTIFICATION_STORAGE_APPEND` | `RUNNER_ENGINE` | `GATEWAY` | `SCENARIO_WIDE` | 必须保持“停止 append”与“确认后删除运行文件”分离。 |
| `PROMOTION_LOCK_CONTENTION` | `SCENARIO_WORKERS` | `GATEWAY` | `NONE` | 有 Worker；需通过 recovery/endpoint capability 校验。 |
| `INVENTORY_TABLE_EXCLUSIVE` | `SCENARIO_WORKERS` | `GATEWAY` | `NONE` | 有 Worker；需通过 recovery/endpoint capability 校验。 |
| `INVENTORY_ROW_LOCK` | `SCENARIO_WORKERS` | `GATEWAY` | `NONE` | 有 Worker；需通过 recovery/endpoint capability 校验。 |
| `PSP_PROVIDER_OUTCOME` | `RUNNER_ENGINE` | `GATEWAY` | `NONE` | 有 Runner path；需注册对应 run drain 和 summary。 |

### 6.2 Worker descriptor

每个 Worker 在其现有模块中导出只读 descriptor，不将运行控制逻辑集中到 validator。例如：

```ts
export interface ScenarioDispatchDescriptor {
  owner: ScenarioDispatchOwner;
  scenarios: readonly FaultRunScenario[];
  requiresActiveState: true;
  supportsRunDrain: boolean;
  terminalSummaryEvent: string;
}
```

建议导出位置：

| 模块 | 新 export | 覆盖场景 |
| --- | --- | --- |
| `report-scenario-worker.ts` | `REPORT_WORKER_DISPATCH` | 两个 report 场景。 |
| `traffic-surge-executor.ts` | `TRAFFIC_SURGE_DISPATCH` | 两个 surge 场景。 |
| `scenario-workers.ts` | `SCENARIO_WORKER_DISPATCH` | Cache、promotion、两个 inventory 场景。 |
| `runner-engine.ts` | `RUNNER_ENGINE_DISPATCH` | Cart、notification、PSP 场景；当前 Cart 缺失时 descriptor 不得虚报。 |

Validator 需断言：

- 每个 Catalog 场景恰好被一个 descriptor 覆盖；
- descriptor 不得覆盖 Catalog 不存在的场景；
- descriptor owner 等于 resolved Contract owner；
- `requiresActiveState`、`supportsRunDrain` 和 terminal event 满足 Contract；
- `TRAFFIC_SURGE_EXECUTOR` 的每个场景恰好存在于 `TRAFFIC_SCENARIO_TARGETS`，且其公开请求路径/客户来源仅用于本地执行；
- Worker capability 仅声明场景 ID 与行为能力，不复制 Catalog 的 target service、operation、参数或 duration。

为消除 `CREATING`/`RECOVERING` 时提前产生效果的竞态，批次 1/2 必须提供 `listRunnableFaultRuns()` 或等效共享 predicate，语义固定为 `state === 'ACTIVE'`。所有四类 scanner 复用它；`listActiveFaultRuns()` 可继续供 recovery 使用，但不得再用作 effect execution 的权限判断。

### 6.3 Gateway 跨语言校验

Gateway 的 `TARGETS` 不能被 TypeScript 直接导入，也不应新增一个运行时 JSON map。实现采用一个不改变生产协议的测试边界：

1. 将 Java controller 的手工 map 抽取为 `OperationTargetRegistry`；Controller 继续从该 registry 路由，registry 是 Gateway operation/path 的唯一代码来源。
2. `validate:contract` 从 resolved Catalog 输出只包含 target-backed operation、预期 service、lifecycle/cleanup mode 的临时 JSON 输入。
3. `gateway-service` 的 `OperationDispatchContractTest` 读取该输入，并断言 registry 中 operation 存在、service 一致、prepare/release/cleanup path 与声明 capability 兼容。
4. Java test 同时通过 Spring mapping 或 controller-level test 验证 registry 指向的 target endpoint contract；它不能仅比较两个手工字符串表。
5. 本地 Worker scenario 不写入 Gateway expectation 输入；Java test 必须拒绝“标为 Gateway 但无 registry entry”的 scenario。

根级脚本负责先生成临时输入，再运行 Maven 测试。临时文件位于忽略的 `tmp/scenario-contract/`，不能提交为另一份 source of truth。

### 6.4 recovery 与 cleanup policy

`recoveryStrategy` 仍可作为 UI/兼容字段，但不能独自决定 Coordinator 行为。`resolveScenarioContract()` 必须将它映射到可验证的 policy：

| Catalog `recoveryStrategy` | Contract 必须具备 |
| --- | --- |
| `TARGET` | target release/recovery capability；至少一个 recovery check；若 Worker 仍持续观测，则明确其 drain 需求。 |
| `WORKER` | 每个真实流量 Worker 的 drain、终态 summary 和停止后验证；若场景也有 Gateway prepare，则 release policy 必须显式声明。 |
| `MANUAL_CLEANUP` | stop/release 与 destructive cleanup 分离；必须声明 Operator confirmed trigger、责任边界、completion check 和重试/幂等语义。 |
| `NON_RELEASING` | release 被禁止；必须声明为什么不释放、停止后残留如何观察、何时转入 service recovery/人工处置。 |

Coordinator 的未来 policy resolver 必须分别决定 worker drain、target release、manual cleanup 可用性、终态事件与特殊 service recovery，不能通过“所有场景先 drain 再 release”的通用路径伪造合规。`NOTIFICATION_STORAGE_APPEND` 的 release 仅停止 append 生命周期；运行文件的确认删除仍属于独立的 `SCENARIO_WIDE` cleanup。`NOTIFICATION_HEAP_PRESSURE` 不能在 Contract 中同时宣称 `NON_RELEASING` 和 normal release。

## 7. Validator 设计

### 7.1 模块边界

建议在 `traffic-control-plane` 新增以下模块：

| 模块 | 职责 |
| --- | --- |
| `src/lib/scenario-contract.ts` | Contract 类型、Catalog supplement 的解析与 resolved Contract 构建；没有 per-scenario 平行数据。 |
| `src/lib/scenario-contract-revision.ts` | canonical JSON、SHA-256、`catalogRevision`/`contractRevision` 生成。 |
| `src/lib/scenario-contract-validator.ts` | 纯校验器，接收显式 inputs，返回稳定、排序后的诊断。 |
| `src/lib/scenario-contract-artifacts.ts` | 从 resolved Contract 投影表单、runbook checklist、smoke matrix、术语输入和 manifest。 |
| `src/lib/scenario-contract-runtime.ts` | 运行时最小 capability 检查与 warn/enforce admission policy；不读取 Markdown、根目录 infra 或数据库。 |
| `scripts/validate-scenario-contract.ts` | 仅供本地/CI 使用的全量静态输入装配、report 输出与 exit code。 |
| `scripts/test-scenario-contract.sh` | 根级编排 TypeScript、Gateway Maven、runbook/i18n/terminology 静态门禁。 |

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
| `missingTarget` | resolved Contract、Gateway test result、`TRAFFIC_SCENARIO_TARGETS` | Gateway 场景有 operation/service/path capability；本地 Worker bypass 有精确 target descriptor；无孤立 target map。 |
| `missingDispatch` | 四类 Worker descriptor | 每场景恰好一个 owner，owner/lifecycle 一致，ACTIVE gate 与真实 drain capability 满足声明。 |
| `invalidParameters` | Catalog 参数 schema、`validateScenarioParameters()`、consumer map | `durationSec`、default、min/max、option、unit、maxDuration、专用预算和参数消费者完整；没有未知或无消费者参数。 |
| `invalidRecoveryHook` | lifecycle supplement、Worker/Gateway capability、cleanup route test | release、drain、recovery check、manual cleanup/confirmation、non-releasing residual check 与 Catalog 策略一致。 |
| `missingEvidenceQuery` | evidence recipes | ID 唯一、source/window/timeout/judgment 合法，必需 Run Event/效果/recovery/cleanup 证据齐全，且失败语义为 `EVIDENCE_UNAVAILABLE`。 |
| `missingRunbook` | `RUNBOOK_METADATA`、双语 Markdown | Catalog 覆盖一对一、allowlisted 文件存在、必要标题和 alert section 齐全、固定 target service/operation 可由 Catalog 验证。 |
| `missingI18n` | locale message indexes、`SCENARIO_META`、`SCENARIO_GROUPS` | 每个场景 label/description、参数 label/description、recovery label、分组与双语 leaf key 完整；每场景恰好属于一个显示分组。 |
| `invalidAlertContract` | alert supplement、Prometheus/Alertmanager Compose/Kubernetes YAML | alert name/severity/静态 label 约束有效，窗口和 receipt policy 合法；仅在 delivery `ENABLED` 时要求真实 child route、receiver、凭据来源和 `send_resolved` 匹配。 |

`missingTarget` 与 `missingDispatch` 不得合并。一个场景可以正确映射到 Gateway、却没有 Worker effect path；也可以有 Worker、却错误选择了 target service。错误分类应让维护者直接知道要修哪一层。

### 7.3 静态配置读取

全量 validator 使用已有 `js-yaml` 依赖读取版本控制中的 Compose/Kubernetes Prometheus 与 Alertmanager 文件。它不能调用 `loadAlertConfig()`，因为该 API 会初始化数据库、尝试导入/回写配置，且生产镜像不保证包含仓库根目录的 `infra/`。

配置比较遵循语义规范化而非原始 YAML 文本比较：

- Prometheus：比较 rule name、severity、显式静态 labels、`for`、group interval 与表达式的稳定摘要；
- Alertmanager：比较 route tree 的 receiver/match/group/repeat 语义和各 webhook 的 `send_resolved`；
- Compose/Kubernetes 允许 YAML 层级不同，只要有效 route/receiver 语义一致；
- `NOT_ENABLED_YET` 的专用 delivery 只输出 readiness note；若 `ENABLED` 却缺 route、receiver、Basic Auth source 或 `send_resolved: true`，则输出 `invalidAlertContract`。

Markdown 只用于文件存在、标题、固定 token 和安全格式检查；不得从 prose 推导告警名、恢复策略或证据判断。维护者应根据 generated checklist 同步解释性文档。

## 8. 运行时 admission 与 revision 持久化

### 8.1 两种运行时检查范围

| 检查 | 执行位置 | 输入 | 行为 |
| --- | --- | --- | --- |
| `validate:contract` | 本地仓库与 CI | 全部 Catalog、descriptor、双语内容、根目录 YAML、术语脚本输入 | 严格；发现 error 返回非零。 |
| `validateRuntimeContract` | Web/API 与 Worker 进程 | 已编译 Catalog、Worker/Gateway capability、环境 mode | 不访问仓库根目录或 Markdown；默认仅结构化 warn。 |

生产 Docker image 只复制 control-plane 运行所需内容，不能把 CI 依赖的根目录 `infra/`、Kubernetes 配置或文档树视为运行时文件。因此，不应将全量静态 validator 挂到 `pnpm build` 或 Web 请求路径。

新增严格枚举配置：

```text
SCENARIO_CONTRACT_VALIDATION_MODE=warn|enforce
```

- 缺失值默认为 `warn`，以保持现有运行行为。
- 非法值必须在 `env.ts` 中导致启动失败，不能悄悄降级为 `warn` 或 `enforce`。
- Web 与 Worker 必须使用同一个部署值；Compose 和 Kubernetes 分别显式配置。
- `warn` 记录低基数的控制面结构化日志/指标（category、scenario、revision），允许新 Run 按当前逻辑创建。
- `enforce` 仅在 **新 Run 创建、持久化和 target invocation 之前**拒绝不合法 Contract，返回正常 Operator error envelope `SCENARIO_CONTRACT_INVALID`；不对已存在 Run 重新判错、不停止 Worker、不修改 recovery 状态。

Worker 发现存储 revision 与当前 Catalog revision 不一致时，在 `warn`/`enforce` 都只记录一次受控的 drift 诊断并继续处理既有生命周期；运行中的资源不能因 Catalog 编辑被突然遗弃。严格模式的真正安全边界是 admission。

### 8.2 `fault_runs` 和事件

最小、充分的持久化变更为：

```sql
ALTER TABLE fault_runs
  ADD COLUMN contract_revision VARCHAR(128) NULL
  AFTER trace_id;
```

`VARCHAR(128)` 容纳带 schema/算法前缀的 revision，并为未来算法演进留下空间。无须把完整 Contract JSON、告警 receiver、证据模板或任何 secret 写入 `fault_runs`。

变更点如下：

1. `FaultRunRecord` 增加 `contractRevision: string | null`；`null` 专门表示 Phase 3 前的历史记录。
2. `CreateFaultRunInput` 要求由 Coordinator 传入 server-derived 的非空 `contractRevision`。
3. `FaultRunCoordinator.create()` 在 Catalog lookup 和参数标准化后、`store.create()` 前计算 resolved Contract revision。
4. `createFaultRun()` 在同一个 transaction 内将 revision 插入 `fault_runs`，并扩展既有 `CREATED` event payload：

   ```json
   {
     "scenario": "BROWSE_SURGE",
     "targetService": "catalog-service",
     "targetOperation": "browse-api-worker",
     "expiresAt": "2026-01-01T00:00:00.000Z",
     "fencingToken": 42,
     "contractRevision": "sc.v1:sha256:...",
     "catalogRevision": "sc.v1:sha256:..."
   }
   ```

5. `transitionFaultRun()`、`appendFaultRunEvent()`、`attachOperatorAudit()` 均不得更新 `contract_revision`。
6. 幂等重试必须返回初始已存 Run 的 revision；即使当前 Catalog 已修改，也不得重新计算并覆盖旧值。
7. Operator-only `GET /internal/fault-runs` 与 run detail 读模型可返回该字段；消费者、Gateway 和目标服务路径保持不变。

现有 `toGatewayPayload()` 与 `createFaultRunContext()` 应保持显式白名单。新增字段后必须有负向测试，证明它们没有通过对象展开意外进入出站 header/body。

### 8.3 迁移、历史记录与 retention

本仓库当前的 schema bootstrap 只创建不存在的表，不能为既有 volume 增加列；`infra/mysql/init` 也只在全新 MySQL data directory 初始化时运行。Phase 3 必须采用以下 expand 方案：

1. 新增顺序迁移 `traffic-control-plane/src/lib/migrations/002-fault-run-contract-revision.sql` 与 `infra/mysql/migrations/002-fault-run-contract-revision.sql`。
2. 新增 control-plane migration runner，例如 `pnpm db:migrate`，使用专用 migration-history 表和 MySQL advisory lock。DDL 前检查已应用 migration；成功/失败必须可见、可重试且不吞掉错误。
3. 更新 fresh-install 的 `fault-run-schema.ts`、`src/lib/migrations/001-fault-runs.sql` 与 `infra/mysql/init/04-fault-run-schema.sql`，使新库直接拥有列。
4. Compose 增加一次性 migration service 或明确的发布前命令；Kubernetes 增加在 Web/Worker deployment 前完成的 Job。runtime application 启动不负责未受控的 schema `ALTER`。
5. 先部署可读 nullable column 的代码和 migration，再部署写 revision 的代码；最后才切换 `enforce`。

旧 Run **不得**用当前 Catalog revision 回填。当前数据库不保存历史 Catalog/release snapshot，回填会伪造过去的运行事实。旧行和旧 `CREATED` event 保持无 revision，Operator API 返回 `contractRevision: null`，后续查询将其标识为 `LEGACY_UNVERSIONED`。

Contract revision 与 Fault Run/Event 使用相同的现有 retention：符合当前删除条件的 Run 七天后连同事件删除。这满足“在 Run Event 中可追踪”的 Phase 3 范围；它不构成长期归档，也不应以 `ON DELETE CASCADE` 外溢到未来独立的 Evidence/receipt/evaluation 存储。

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
    "validate:contract": "tsx scripts/validate-scenario-contract.ts --format=text",
    "validate:contract:json": "tsx scripts/validate-scenario-contract.ts --format=json --output=../tmp/scenario-contract/report.json"
  }
}
```

根级 `scripts/test-scenario-contract.sh` 按以下顺序执行：

```text
pnpm --dir traffic-control-plane test:contract
pnpm --dir traffic-control-plane validate:contract -- --gateway-input "$TMP/gateway-input.json"
mvn -pl gateway-service -am -Dtest=OperationDispatchContractTest test
pnpm --dir traffic-control-plane test:runbook
pnpm --dir traffic-control-plane test:i18n
./scripts/check-runtime-terminology.sh
pnpm --dir traffic-control-plane typecheck
pnpm --dir traffic-control-plane lint
```

静态 Contract gate 需要在仓库根目录执行，因为它读取 `infra/`、`k8s/`、`docs/` 与 Gateway 模块。`traffic-control-plane/Dockerfile` 的 build context 仅为该子目录，不能替代这一步；CI 在 static gate 成功后再构建 control-plane image，验证双语 runbook content 的 image copy 仍然存在。

仓库目前没有 GitHub Actions workflow。实施时应新增一个 CI workflow，将上述 static gate 作为 pull-request blocking job，缓存 pnpm/Maven 依赖，并在成功或失败时上传 manifest 和 report。需要 MySQL/Redis/full Compose 的 smoke 放在独立 job 或手动触发，不与纯静态门禁混为一谈。

## 10. runbook、i18n、告警配置与术语检查

### 10.1 Runbook

现有 `runbook.test.ts` 已校验 12 个 Catalog 场景与 `RUNBOOK_METADATA` 一对一、双语文件集合、八个通用标题和 Mermaid 安全边界。批次 3 在此基础上：

1. 为中英文文章都要求 `Alert mapping` / `告警关联` 标题；
2. 验证文章有 scenario ID、Catalog target service 和 target operation 的受控引用；
3. 使用 checklist 验证 prepare/active/stop/release/cleanup/recovery/evidence 的必要说明存在；
4. 保持 `getRunbookEntry()` 从 Catalog 合并 target/duration/recovery，禁止在 `RUNBOOK_METADATA` 重复这些字段；
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

新增 `SCENARIO_CONTRACT_VALIDATION_MODE` 后，以下位置必须同一变更更新：

| 位置 | 处理 |
| --- | --- |
| `traffic-control-plane/src/lib/env.ts` | 严格解析 `warn`/`enforce`，非法值启动失败。 |
| `docker-compose.yml` 的 Web 和 Worker | 显式设为 `warn`；避免两个进程读取不同行为。 |
| `k8s/services/traffic-control-plane/deployment.yaml` | 通过 `app-config` 或明确 env 设为 `warn`。 |
| `k8s/services/traffic-control-plane/worker-deployment.yaml` | 使用同一值。 |
| README/发布 runbook | 记录 static gate、migration、模式切换和 rollback 顺序。 |

本批次不新增密码、token、service key 或 Agent credential。Alert delivery 的凭据来源仅作为 Contract 声明，真实 Secret 由阶段 5 部署管理。

### 11.2 灰度顺序

```text
实现 typed Contract + unit fixtures
  -> 补齐 12 个 Catalog 声明和 descriptor
  -> static CI gate 通过
  -> 执行 expand migration
  -> Web/Worker 以 warn 部署并写 revision
  -> 验证新 Run/Event revision 一致、无业务协议泄漏
  -> 修复所有 required lifecycle/dispatch blocker
  -> 测试环境 enforce
  -> 单环境 canary enforce
  -> 扩大 enforce
```

进入 `enforce` 前至少需确认：

- 静态 report 对 12 个场景无 error；
- `CART_CATALOG_DEPENDENCY` 有真实 dispatch，不是文档占位；
- 所有 Worker 仅在 `ACTIVE` 执行，并按 Contract 注册可等待的 drain；
- `NON_RELEASING` 与 `MANUAL_CLEANUP` 的 coordinator policy 已与实际 target 行为一致；
- Gateway cleanup 与 target cleanup wire contract 已经过真实 controller/integration test；
- 新建 Run 的 table 字段和 `CREATED` event revision 相同，且 Gateway/context payload 仍无该字段；
- alert 声明中的 `NOT_ENABLED_YET` 与实际阶段 5 readiness 状态一致，没有将 generic receiver 误报为专用 delivery。

### 11.3 回退

回退优先将 mode 从 `enforce` 改为 `warn`，而不是删除数据库列、重置 MySQL volume 或停止 active Fault Run。具体规则：

1. 已运行 Fault Run 继续使用既有 stop/recovery 路径，不能因 Contract mode 变化中断；
2. `contract_revision` 保持可读，旧代码应忽略未知 nullable column；
3. 静态 CI gate 若因真实 drift 失败，应修复 source；不能通过关闭运行时 mode 绕过发布门禁；
4. 只有在迁移未成功写入任何新数据且经过独立评审时才讨论 contract 阶段删除，不能与首次上线同发布进行；
5. Alertmanager receiver 的启停不属于批次 3 回退；其顺序遵循批次 5.0 设计。

### 11.4 控制面可观测性

运行时仅记录低基数、可审计的控制面信息：

- `scenario_contract_validation_total{result,category,mode}`；
- `scenario_contract_revision_bound_total`；
- `scenario_contract_revision_drift_total`；
- 日志字段：`scenario`、`contractRevision`、`category`、`mode`、稳定错误 code。

不得记录完整 Contract、参数值、告警 label 集合、用户会话、凭据、目标 response 或原始观测结果。revision hash 和场景 ID 留在控制面日志/Operator API 内；它们不能传播到消费者/业务服务 trace、metric 或 response。

## 12. 测试设计

### 12.1 TypeScript 单元与 fixture 测试

1. canonicalization 在 object key、无顺序集合重排时稳定；任一实际 Contract 字段变化时 revision 改变。
2. 12 个真实 Catalog 场景生成唯一 resolved Contract、catalog revision 和 scenario revision。
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

1. `FaultRunCoordinator` 在创建前计算 revision；`warn` 允许创建，`enforce` 在 target adapter 调用前拒绝非法 Contract。
2. `createFaultRun()` transaction 同时写 table revision 和 `CREATED` payload；两者相同。
3. idempotency replay 返回原 revision；Catalog 变更后不覆盖已存 revision。
4. `FaultRunRecord` 对 legacy null revision 安全序列化；state transition 不能更改 revision。
5. `toGatewayPayload()`、`FaultRunContext`、manual cleanup payload 均没有 `contractRevision`。
6. 每个 Worker descriptor 与实际 scanner 的 `ACTIVE` gate、drain registration、summary event 一致；`CREATING` 和 `RECOVERING` fixture 均不得发起 effect request。
7. `OperationDispatchContractTest` 验证 target-backed Catalog input 与 Gateway registry、target endpoint path 和 cleanup payload 的兼容性。
8. scenario-wide cleanup 对 storage 以外 operation 被拒绝；cache 的 per-run cleanup 永远不被路由到 notification storage。

### 12.3 数据库、部署与端到端验证

1. fresh schema 和已有 pre-column schema 都能完成迁移；重复执行不丢数据。
2. migration lock 下并发 Web/Worker/Job 不会重复记录 migration；失败不会假报已应用。
3. Compose 与 Kubernetes YAML 语义规范化后匹配；delivery `ENABLED` 时用 `amtool check-config` 检查实际 Alertmanager 文件。
4. 在 disposable 环境创建一个有效 Run，检查 Operator response/Run detail 的 revision、Gateway request 和 target request header/body 边界。
5. 现有 `catalog-product-detail-smoke.sh` 仍只代表一个场景 smoke，不能被报告为 12 个场景 Contract 验证；12 场景 live matrix 需在对应真实路径可用后单独执行。
6. `git diff --check`、`./scripts/check-runtime-terminology.sh`、control-plane typecheck/lint/build 均通过。

## 13. 实施顺序与任务拆分

| 顺序 | 交付 | 依赖 | 完成标准 |
| --- | --- | --- | --- |
| 1 | Contract 类型、resolver、canonicalizer 和 fixture test | 无 | 不含平行场景 registry，revision 稳定。 |
| 2 | 在 Catalog 补齐 12 个 supplement | 1 | 每项含 dispatch/lifecycle/parameter/evidence/alert 声明。 |
| 3 | Worker descriptor 与 ACTIVE/drain 前置修复 | 1、2、批次 1/2 | 没有 `missingDispatch` 或虚报 drain。 |
| 4 | Gateway registry 抽取和跨语言 test input | 1、2 | target-backed operation/service/path 可被 Maven gate 验证。 |
| 5 | runbook/i18n/alert/terminology validator inputs | 1、2 | 现有文档和 locale 与 Catalog 精确覆盖。 |
| 6 | full validator、report、辅助生成和根级 static script | 3～5 | 八类负向 fixture 和真实 12 场景 report 可重复执行。 |
| 7 | revision persistence、migration runner 与 Operator serialization | 1、6 | 新 Run 的 revision 原子写入；legacy null 安全。 |
| 8 | warn 部署、CI workflow、image validation | 6、7 | CI 阻断，运行时不改变既有 Run。 |
| 9 | 修复 report 中 required blocker 后的 enforce canary | 3～8 | 满足第 11.2 节的进入条件并有明确 rollback。 |

步骤 3 与 4 是运行行为相关的前置修复，不能因为它们位于 Contract 批次的任务清单中就绕过阶段 1/2 的安全、owner、drain 和 recovery 验收。步骤 5～8 可以在这些修复并行准备，但 strict gate 不得将未验证的 capability 标为通过。

## 14. 验收与退出条件

批次 3 完成需要同时满足以下条件：

1. 12 个 Catalog 场景均能解析为唯一、版本化的 `ResolvedScenarioContract`，真实静态 report 无 error。
2. Catalog、Gateway、Worker、recovery/cleanup、runbook、i18n、evidence 和 alert 声明通过八类校验；新场景缺项会在 CI 中失败。
3. `contractRevision` 在新建 Fault Run 的数据库行与 `CREATED` event 中一致，并只在 Operator 控制面可见。
4. 消费者和业务服务的请求、响应、日志、metric、trace 和通用内部 operation context 均不包含 Contract/Catalog/Fault Run 生命周期语义。
5. `NOT_ENABLED_YET`、`EVIDENCE_UNAVAILABLE`、`UNMATCHED`/`AMBIGUOUS` 等不确定性被显式表示；没有“场景已启动，所以告警一定 firing”或“prepare 成功，所以效果已观察到”的推论。
6. 所有 generated artifact 可重复生成，未成为手工维护的第二数据源，也未自动覆盖 runbook/生产代码。
7. static gate 在 CI 中阻断；运行时默认 `warn`，只在完整前置条件和 canary 证明后才允许 `enforce`。
8. migration、rollout、active Run 处理和 rollback 已按 expand/contract 方式演练；没有通过删除数据、重置 MySQL volume 或关闭校验绕过问题。

满足退出条件后，阶段 4 可以消费 resolved Contract 的 evidence recipe 和 revision，而不再从 Catalog、runbook、Worker 条件或告警 prose 中猜测场景边界。
