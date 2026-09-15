# 批次 5.2：RCA Evaluator 技术设计

> 状态：技术设计 v1
> 配套产品规格：[product.md](./product.md)
> 对应路线阶段：阶段 5.2
> 前置条件：批次 5.0 receipt/incident 已稳定，批次 5.1 report/queue handoff 已验收，阶段 4 已提供受控 Evidence Query Manifest 与只读 executor
> 设计原则：MySQL 持久队列、服务端受控重查、Ground Truth 不出服务端、报告不可变、控制/修复/业务状态严格分离

## 1. 设计结论

Evaluator 是控制面内的独立 worker 能力，不是 Agent 的代理、不是自动 remediation，也不是 Fault Run lifecycle 的另一个入口。它重新执行服务端定义的只读证据配方，并把结果与 AgentRcaReport 的诊断、证据引用和 remediation 建议进行确定性比对。

实现采用下列架构：

```text
accepted AgentRcaReport
  -> MySQL evaluation case + queued job
  -> standalone traffic-control-plane worker
       -> lease-safe claim / heartbeat / stale reclaim
       -> Alert receipt + incident + optional matched Fault Run facts
       -> Phase 4 Evidence Query Manifest + fixed executor
       -> deterministic rule engine
       -> immutable EvaluationReport
  -> Operator-only report / retry / abandon / close / outcome APIs
```

四个事实层必须保持独立：

| 事实层 | 维护者 | 不能推导为 |
| --- | --- | --- |
| Fault Run control | 现有 Coordinator/Repository | 业务已经恢复或 Agent 已修复问题。 |
| Agent recommendation review/execution | Operator 和 outcome 记录 | Agent 自动执行过 remediation。 |
| 业务恢复 | 阶段 4 固定 business/resource checks | Alert 已 resolved 或 Fault Run 已 stopped。 |
| RCA/evidence assessment | Evaluator | 完整 Ground Truth、内部 run ID 或可执行修复指令。 |

## 2. 当前缺口与强前置契约

当前 checkout 有 Fault Run、Run Event、runbook Tempo 模板和观测基础设施，但尚没有下列可执行能力：

- `ScenarioEvidenceContract`、Catalog revision、确定性时间窗口或 immutable `EvidenceQueryManifest`；
- Prometheus、Loki、Tempo 或 Gateway business read-only query executor；
- Operator evidence report；
- alert receipt、AgentRcaReport、evaluation queue、Evaluator 或 EvaluationReport。

因此批次 5.2 不得绕开阶段 4 在自身内临时实现一套查询逻辑，也不得执行 Agent 的 `agentQuery`。批次 5.2 的开始门槛是阶段 4 提供以下稳定接口：

```ts
type EvidenceQueryManifestService = {
  getOrCreateForIncident(input: {
    incidentId: number;
    matchedFaultRunId: string | null;
    contractRevision: string | null;
  }): Promise<EvidenceQueryManifest>;
};

type EvidenceQueryExecutor = {
  execute(recipe: ResolvedEvidenceRecipe): Promise<EvidenceQueryResult>;
};
```

`EvidenceQueryManifest` 冻结安全的 contract revision、服务端计算的窗口、recipe ID/hash、required 标记和缺失边界；`EvidenceQueryResult` 只提供有界摘要、可用性、查询时间和错误码。两者都不能接收 Agent 提供的 URL、PromQL、LogQL、TraceQL、SQL、shell 或业务 operation。

业务只读检查继续通过 Gateway 的固定 allowlist operation；Prometheus/Loki/Tempo 查询由阶段 4 的 observability adapter 管理。任何控制面业务 HTTP 调用仍保持经过 Gateway 的架构规则。

## 3. 内部模型与非泄露边界

Evaluator 依赖三种不同模型，不能把它们压缩为一个“证据 JSON”：

| 模型 | 所有者与可见性 | 内容 |
| --- | --- | --- |
| `ScenarioEvidenceContract` | 控制面服务端代码 | 场景的固定 recipe、窗口 policy、alert contract 和 evaluator ruleset revision。 |
| `EvidenceQueryManifest` | Operator/Evaluator 内部 | 某个 incident/run 的已解析时间线、窗口、recipe ID/hash、缺失边界；不保存查询原始结果。 |
| `EvaluatorGroundTruth` | Evaluator 进程与授权 Operator 工具 | 允许的 root-cause 分类/服务、evidence predicate ID、建议安全 policy。 |

Ground Truth 可以用规则 ID、枚举和受控 predicate 体现，但不得出现在：

- Alertmanager receiver payload；
- AgentRcaReport 接收响应；
- Agent-facing ingress、前端 bundle、Markdown 导出或日志；
- `EvaluationReport` 的隐藏期望值、候选 Fault Run 详情或可反推的完整规则文本。

报告只返回 assessment、已执行 recipe 的安全摘要、限制和 remediation review；即使诊断不正确，也不得向 Agent 返回“正确答案”。

## 4. 持久化模型

所有表与 `fault_runs` 独立，不能设置 `ON DELETE CASCADE` 到 Fault Run。新 schema 由 `src/lib/rca-evaluation-schema.ts` 初始化，并同时写入下一顺序号的 runtime migration 和 `infra/mysql/init`。

### 4.1 Evidence Query Manifest

```sql
CREATE TABLE evidence_query_manifests (
  manifest_id CHAR(36) NOT NULL PRIMARY KEY,
  incident_id BIGINT NOT NULL,
  matched_fault_run_id CHAR(36) NULL,
  scenario VARCHAR(64) NULL,
  contract_revision VARCHAR(128) NOT NULL,
  evaluator_ruleset_revision VARCHAR(128) NOT NULL,
  timeline_json JSON NOT NULL,
  windows_json JSON NOT NULL,
  recipes_json JSON NOT NULL,
  limitations_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_evidence_manifest_incident_revision
    (incident_id, contract_revision, evaluator_ruleset_revision),
  INDEX idx_evidence_manifest_run (matched_fault_run_id),
  CONSTRAINT fk_evidence_manifest_incident FOREIGN KEY (incident_id)
    REFERENCES alert_incidents(incident_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`timeline_json` 只保留查询窗口所需的安全时间点和状态，不复制全部 `fault_run_events` payload。未能解析的边界必须显式写为 `null` 加 limitation；不能用当前时间填补。`recipes_json` 保存 recipe ID/hash/source/window/required，不保存 Prometheus series、Loki line、Tempo span 或业务响应 body。

在第一条 report 或第一份 case 创建时生成 manifest 的初始快照。随后仅允许创建一个新的 revision，不能就地改写已经被报告引用的 manifest。这样即使现有七天 Fault Run retention 清除原始 run/events，Evaluator 仍能解释当时使用的安全窗口与 contract revision。

### 4.2 Case、job 与 lease

```sql
CREATE TABLE rca_evaluation_cases (
  case_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT NOT NULL,
  selected_report_id VARCHAR(128) NULL,
  current_status VARCHAR(32) NOT NULL,
  evaluation_closed_at DATETIME(3) NULL,
  closed_reason VARCHAR(256) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_rca_evaluation_case_incident (incident_id),
  INDEX idx_rca_evaluation_case_status (current_status, updated_at),
  CONSTRAINT fk_rca_evaluation_case_incident FOREIGN KEY (incident_id)
    REFERENCES alert_incidents(incident_id) ON DELETE RESTRICT,
  CONSTRAINT fk_rca_evaluation_case_report FOREIGN KEY (selected_report_id)
    REFERENCES agent_rca_reports(report_id) ON DELETE RESTRICT,
  CHECK (current_status IN
    ('OPEN', 'QUEUED', 'RUNNING', 'COMPLETED', 'EVIDENCE_UNAVAILABLE',
     'FAILED', 'ABANDONED', 'CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rca_evaluation_jobs (
  job_id CHAR(36) NOT NULL PRIMARY KEY,
  case_id BIGINT NOT NULL,
  report_id VARCHAR(128) NOT NULL,
  manifest_id CHAR(36) NOT NULL,
  attempt_no INT UNSIGNED NOT NULL,
  state VARCHAR(32) NOT NULL,
  available_at DATETIME(3) NOT NULL,
  lease_owner VARCHAR(128) NULL,
  lease_token CHAR(36) NULL,
  lease_expires_at DATETIME(3) NULL,
  heartbeat_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  error_code VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_rca_evaluation_job_attempt (case_id, attempt_no),
  INDEX idx_rca_evaluation_job_claim (state, available_at, job_id),
  INDEX idx_rca_evaluation_job_lease (state, lease_expires_at),
  CONSTRAINT fk_rca_evaluation_job_case FOREIGN KEY (case_id)
    REFERENCES rca_evaluation_cases(case_id) ON DELETE RESTRICT,
  CONSTRAINT fk_rca_evaluation_job_report FOREIGN KEY (report_id)
    REFERENCES agent_rca_reports(report_id) ON DELETE RESTRICT,
  CONSTRAINT fk_rca_evaluation_job_manifest FOREIGN KEY (manifest_id)
    REFERENCES evidence_query_manifests(manifest_id) ON DELETE RESTRICT,
  CHECK (state IN
    ('QUEUED', 'LEASED', 'SUCCEEDED', 'EVIDENCE_UNAVAILABLE',
     'RETRYABLE_FAILED', 'ABANDONED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

只有一个 active job 可以由同一 case 产生。实现以锁定 `rca_evaluation_cases` 行加 version 条件更新保证，而不是假设单 Worker 永远不会重复运行。batch 5.1 的 report transaction 使用这些相同表定义和约束写入初始 `QUEUED` job。

### 4.3 报告、recipe 摘要与 remediation outcome

```sql
CREATE TABLE rca_evaluation_reports (
  evaluation_report_id CHAR(36) NOT NULL PRIMARY KEY,
  job_id CHAR(36) NOT NULL,
  report_schema_version VARCHAR(64) NOT NULL,
  report_json JSON NOT NULL,
  report_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_rca_evaluation_report_job (job_id),
  CONSTRAINT fk_rca_evaluation_report_job FOREIGN KEY (job_id)
    REFERENCES rca_evaluation_jobs(job_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rca_evaluation_recipe_results (
  recipe_result_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  evaluation_report_id CHAR(36) NOT NULL,
  recipe_id VARCHAR(128) NOT NULL,
  source_name VARCHAR(64) NOT NULL,
  window_name VARCHAR(32) NOT NULL,
  availability VARCHAR(32) NOT NULL,
  predicate_status VARCHAR(32) NOT NULL,
  result_summary_json JSON NULL,
  error_code VARCHAR(128) NULL,
  queried_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_rca_recipe_result_report FOREIGN KEY (evaluation_report_id)
    REFERENCES rca_evaluation_reports(evaluation_report_id) ON DELETE RESTRICT,
  INDEX idx_rca_recipe_result_report (evaluation_report_id, recipe_id),
  CHECK (availability IN ('AVAILABLE', 'PARTIAL', 'EVIDENCE_UNAVAILABLE', 'INVALID_QUERY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`result_summary_json` 是 recipe 定义的低容量聚合，例如判断通过/失败、计数区间、时间范围和安全 hash；不能包含日志行、trace/span、metric series、HTTP response body、SQL 或凭据。

`agent_rca_reports.report_id` 标识 Agent 的输入报告；`rca_evaluation_reports.evaluation_report_id` 标识服务端对某个 job 的评估产物。两者必须同时出现在关联读模型时，使用完整名称，不能以泛化的 `reportId` 混用。

可选 remediation outcome 使用独立表，只有 Operator 能写入：

```sql
CREATE TABLE rca_remediation_outcomes (
  outcome_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT NOT NULL,
  execution_status VARCHAR(32) NOT NULL,
  business_recovery_status VARCHAR(32) NOT NULL,
  note VARCHAR(2048) NULL,
  operator_audit_id BIGINT NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_rca_outcome_case FOREIGN KEY (case_id)
    REFERENCES rca_evaluation_cases(case_id) ON DELETE RESTRICT,
  INDEX idx_rca_outcome_case_time (case_id, recorded_at),
  CHECK (execution_status IN
    ('NOT_REVIEWED', 'REJECTED', 'ACCEPTED_NOT_EXECUTED',
     'EXECUTED', 'VERIFIED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

记录 outcome 不调用 remediation、Gateway 写 operation、Fault Run stop/release/cleanup 或任何业务写 API。

## 5. 状态机与队列语义

### 5.1 分离状态

| 维度 | 值 | 语义 |
| --- | --- | --- |
| Case | `OPEN`、`QUEUED`、`RUNNING`、`COMPLETED`、`EVIDENCE_UNAVAILABLE`、`FAILED`、`ABANDONED`、`CLOSED` | Operator 可见的总体生命周期。 |
| Job | `QUEUED`、`LEASED`、`SUCCEEDED`、`EVIDENCE_UNAVAILABLE`、`RETRYABLE_FAILED`、`ABANDONED` | 单个不可变尝试的执行状态。 |
| Evidence | `AVAILABLE`、`PARTIAL`、`EVIDENCE_UNAVAILABLE`、`INVALID_QUERY` | 每个 recipe 和聚合证据状态。 |
| Diagnosis | `CORRECT`、`PARTIALLY_CORRECT`、`INCORRECT`、`UNDETERMINABLE` | 诊断评估，不等同于 job 成败。 |
| Coverage | `COMPLETE`、`PARTIAL`、`UNKNOWN` | Agent 引用的 receipt 相对 incident 已知集合。 |
| Remediation review | `SAFE_EXECUTABLE`、`INCOMPLETE`、`UNSAFE` | 建议质量，不表示执行。 |
| Remediation execution | 产品规格定义的六个值 | Operator/外部结果事实。 |

`EVIDENCE_UNAVAILABLE` 必须生成包含 limitation 的 immutable report，而非简单失败或把 diagnosis 标为 `INCORRECT`。case 可保持可重试的开放状态，直到 Operator retry、abandon 或 close。

### 5.2 Claim、heartbeat 与恢复

`RcaEvaluatorWorker` 加入现有 `traffic-control-plane/src/worker/index.ts` 的单独生命周期。Redis 只用于避免多个 worker 无谓扫描；MySQL job row 是队列真相。

1. Worker startup 和周期任务先 reclaim `LEASED` 且 `lease_expires_at < NOW(3)` 的 job，条件更新回 `QUEUED`。
2. Claim 在 MySQL transaction 中选择一个到期 `QUEUED` job（部署 MySQL 支持时使用 `FOR UPDATE SKIP LOCKED`），生成随机 `lease_owner` 和 `lease_token`，更新为 `LEASED`，并以 case `version` 预期值更新 case 为 `RUNNING`。
3. worker 每三分之一 lease 时长执行 `WHERE job_id=? AND state='LEASED' AND lease_token=?` heartbeat。失去更新权立即停止执行和写报告。
4. 完成时，插入 report、写 recipe 摘要、转换 job/case 的操作必须在一个 transaction 中，并带相同 lease token 条件。
5. 仅网络/临时 source 故障可采用有上限的指数退避并写 `RETRYABLE_FAILED`。Schema、policy、manifest、非法 recipe 等确定性错误绝不自动重试。
6. `SIGINT`/`SIGTERM` 时 worker 停止 claim，等待正在执行的受控查询到总超时；无法完成的 job 仅由 owner 条件 requeue 或由 lease 过期回收，不能由旧 worker 覆盖后继结果。

`RCA_EVALUATOR_ENABLED=false` 时不得 claim job，已接受的 queue row 保持可见和可恢复。

## 6. 受控证据复查与规则评估

### 6.1 评估流程

```text
claim job
  -> load immutable report and alert references
  -> load receipt / incident / coverage
  -> use Fault Run facts only when correlation=MATCHED
  -> load or create frozen Evidence Query Manifest
  -> execute fixed recipes with bounded window and timeout
  -> aggregate source availability and predicates
  -> evaluate diagnosis, evidence, recommendation policy
  -> persist report, limitations, recipe summaries
```

对 `UNMATCHED` 或 `AMBIGUOUS` receipt：

- 仍读取 alert receipt、incident 和阶段 4 的 alert/observability recipes；
- 不读取任一候选 Fault Run 的 timeline、target、operation 或 Ground Truth 作为确定事实；
- `faultRunCorrelationStatus` 写入报告 limitation；
- diagnosis 若只能依赖不可确定运行上下文，必须为 `UNDETERMINABLE`，而非 `INCORRECT`。

### 6.2 固定 query 与窗口

Evaluator 只允许执行 manifest 里的 `recipeId`。每个 recipe 必须有 source、允许窗口、最大 timeout、结果摘要规则和 required 标记。以下内容绝不能影响实际执行：

- Agent `evidenceRefs[].agentQuery`；
- Agent 文本中的 URL、TraceQL、PromQL、LogQL、SQL 或 shell；
- Agent 对时间窗口、服务、operation 或数据源的任意替换；
- 当前时刻作为缺失 lifecycle 时间的默认值。

发生 retention 过期、source timeout、授权失败或窗口无法解析时，写入对应 recipe 的 `EVIDENCE_UNAVAILABLE`/`INVALID_QUERY` 和安全错误码。不能把“空结果”与“查询失败”混为正常或把二者都作为 Agent 诊断错误。

### 6.3 确定性评估规则

规则引擎输出至少包含：

| 输出 | 计算依据 |
| --- | --- |
| `alertCoverageStatus` | report 引用数量、incident 已知 receipt 集合和其可用性。 |
| `faultRunCorrelationStatus` | 批次 5.0 的最新 receipt correlation；多 receipt 不一致时保留限制。 |
| `diagnosisAssessment` | Agent category/service/component/instances 与后端 Ground Truth predicate 和受控 query 摘要的匹配程度。 |
| `evidenceAssessment` | required recipe 可用性、Agent evidence 的 source/window/support 覆盖与独立重查结果。 |
| `remediationReviewStatus` | 声明性建议的目标、前置条件、风险、验证、回退及禁止控制面主题检查。 |
| `remediationExecutionStatus` | 最新 Operator outcome；初始为 `NOT_REVIEWED`。 |
| `businessRecoveryStatus` | 固定 business/resource recipe 的独立结果；不可用时为 `UNKNOWN`。 |
| `faultRunControlStatus` | 只在 `MATCHED` 时读取的控制面状态，否则 `UNAVAILABLE` 或 `NOT_APPLICABLE`。 |

没有任何单项可以替代另一个：例如 `faultRunControlStatus=RECOVERED` 既不表示 `businessRecoveryStatus=RECOVERED`，也不表示 `remediationExecutionStatus=VERIFIED`。

## 7. EvaluationReport 和 Operator API

### 7.1 报告结构

报告以版本化 JSON 保存，并可以安全派生 Operator Markdown 展示：

```json
{
  "schemaVersion": "evaluation-report.v1",
  "status": "COMPLETED",
  "diagnosisAssessment": "PARTIALLY_CORRECT",
  "evidenceAssessment": "SUFFICIENT",
  "alertCoverageStatus": "PARTIAL",
  "faultRunCorrelationStatus": "MATCHED",
  "remediationReviewStatus": "SAFE_EXECUTABLE",
  "remediationExecutionStatus": "NOT_REVIEWED",
  "businessRecoveryStatus": "UNKNOWN",
  "faultRunControlStatus": "RECOVERED",
  "recipeSummaries": [],
  "limitations": []
}
```

JSON 内的 `recipeSummaries` 只能包含安全的 recipe ID、source、窗口、availability、predicate 结果和说明码。Markdown 必须由已验证 JSON 生成并 HTML escape，不能渲染 Agent 提供的 HTML、链接、脚本或原始查询。

### 7.2 Operator-only 路由

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/internal/agent-rca/evaluations` | 分页查询 case 摘要、当前状态和限制计数。 |
| `GET` | `/internal/agent-rca/evaluations/{caseRef}` | 查询 case、选中 report、jobs、报告和 outcome；不向 Agent 暴露。 |
| `POST` | `/internal/agent-rca/evaluations/{caseRef}/retry` | 以指定已接受 report 创建新的 job/attempt，写 Operator audit。 |
| `POST` | `/internal/agent-rca/evaluations/{caseRef}/abandon` | 终止尚未完成的 job，保留历史，写 audit。 |
| `POST` | `/internal/agent-rca/evaluations/{caseRef}/close` | 写 `evaluation_closed_at` 与原因，阻止新的 AgentRcaReport。 |
| `PUT` | `/internal/agent-rca/evaluations/{caseRef}/outcome` | 记录实际 remediation/outcome 事实；不执行动作。 |

所有写路由要求 Operator session、CSRF、请求体限制、乐观 version 和 `operator_audit_logs`。retry、abandon、close 与 outcome 只能影响本 case/evaluation 数据，绝不能调用 Fault Run Coordinator 或业务写接口。

## 8. 保留、发布与回退

### 8.1 保留

| 数据 | 策略 |
| --- | --- |
| Fault Run/event | 保持现有独立 retention；Evaluator 不依赖其永久存在。 |
| Manifest | 独立于 Fault Run，保留到关联 case/report 的审计保留期结束。 |
| Receipt/report | 保留到显式控制面评估审计策略结束；不得与 telemetry retention 等同。 |
| 原始观测数据 | 继续由 Prometheus/Loki/Tempo 自己的 retention 管理，Evaluator 不复制。 |
| Ground Truth revision | 保留被 report 引用的 revision/hash 或受控不可变归档。 |

在 Phase 5 v1 中不自动删除含有开放 case、queued job 或 report 的数据。新增删除任务前必须先实现依赖检查、明确 retention 配置、审计和恢复测试。

### 8.2 灰度和回退

1. 先部署 schema、rule engine 和 worker，但 `RCA_EVALUATOR_ENABLED=false`。
2. 使用历史/fixture report 验证 manifest 和 report，不碰业务写路径。
3. 单环境、单 pilot、单 worker 开启 queue claim，观察 lease、source availability、报告和 secret-redaction 信号。
4. 只在实际 RCA 闭环完成且 Operator 能解释所有限制后扩大范围。

回退时先停止 evaluator worker claim，再关闭开关；保留 queued job、lease-safe attempt、manifest 和 report。不得删除队列或将失败报告改写为成功。关闭 Evaluator 不影响 Alertmanager intake、Operator 对 Fault Run 的停止/恢复/清理能力或已记录的 remediation outcome。

## 9. 测试设计

### 9.1 单元测试

- manifest 的窗口计算、缺失边界和 revision/hash 稳定性；缺失时间绝不回退到 `now`。
- Agent query 永不进入 executor；executor 只接受 manifest recipe ID。
- `MATCHED`/`UNMATCHED`/`AMBIGUOUS` 对可读上下文与 diagnosis assessment 的影响。
- coverage 的 `COMPLETE`、`PARTIAL`、`UNKNOWN`，包括 Agent 只提交部分有效 receipt。
- 可选 `instances: string[]` 的服务归属、root cause subset、格式限制和缺失实例；无法可靠定位实例时省略必须得到允许。
- evidence unavailable、query failure、empty result 和 invalid recipe 的分离。
- Ground Truth 规则只输出 assessment，测试输出中不包含期望类别、内部 run ID 或 predicate 文本。
- 建议安全性、业务恢复、Fault Run control 和 remediation execution 的状态永不混用。

### 9.2 队列与数据库测试

- 同一 report/case 不能双重入队或被两个 worker 成功 claim。
- lease heartbeat、lease loss、stale reclaim、worker crash、retry backoff 和 shutdown 的 owner 条件。
- 旧 worker 在失去 lease 后不能写 report 或覆盖新 worker 的结果。
- report/job/case 的原子终态转换；`EVIDENCE_UNAVAILABLE` 生成 immutable report 而非裸失败。
- retry 创建新 attempt/report，不覆盖旧报告；close 后新 report 被拒绝。
- Fault Run retention 后 manifest 和 report 仍可解释且不发生级联删除。

### 9.3 环境验收

在一个 disposable、非生产、单 pilot 环境中：

1. 使用真实 firing alert 接受一份完整 AgentRcaReport。
2. 确认 Evaluator 重新查询已配置的真实观察入口，而不是相信 Agent 文字。
3. 覆盖合法输入、重复输入、partial alert refs、`UNMATCHED`、`AMBIGUOUS`、resolved、证据过期、source timeout、close/retry/abandon 和 outcome 记录。
4. 对比 report 中的 Fault Run control、业务恢复和 remediation execution，确认没有相互推断。
5. 审查网络、数据库、日志和报告，确认不存在 Agent 凭据、Operator cookie、内部 service key、Ground Truth、完整原始观测或可执行修复内容。

## 10. 实施顺序

1. 确认阶段 4 Manifest、executor 和查询结果摘要接口在独立测试中可用。
2. 实现 evaluation schema、repository、case/job state machine 与 lease-safe worker，不连接真实 sources。
3. 实现 manifest snapshot、Ground Truth rule boundary 和 deterministic rule engine，使用 fixture adapter。
4. 接入阶段 4 executor，并为 source 不可用、retention 和固定业务 read checks 增加集成测试。
5. 添加 Operator report/retry/abandon/close/outcome API 与安全 UI。
6. 将 worker 注册到独立控制面 worker 进程，开关默认关闭。
7. 在单一 pilot 闭环验证后才开启默认处理。

批次 5.2 的完成标准是“服务端能独立、可解释地评估一份安全提交并保留限制”，不是“Agent 已自动恢复业务”或“所有 RCA 都可以被永久复查”。
