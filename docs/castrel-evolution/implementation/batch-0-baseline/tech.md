# 批次 0：运行基线与发布护栏技术设计

> 状态：技术设计 v1
> 配套产品规格：[product.md](./product.md)
> 实施任务：[task-list.md](./task-list.md)
> 对应路线阶段：阶段 0
> 设计原则：旁路采集、只读观测、增量迁移、不改变 Fault Run 效果

## 1. 设计结论

批次 0 不改造目标服务，也不改变既有 Fault Run 状态转换；P0-13 仅补齐 Catalog 已声明但缺失的 `CART_CATALOG_DEPENDENCY` 受控 dispatch 和必要 Worker 生命周期事件。技术实现分成三部分：

1. **控制面运行事实**：从现有 `fault_runs`、`fault_run_events`、Operator audit 和 Worker 汇总事件生成基线记录。
2. **部署与观测事实**：记录部署 revision、数据预热配置、Prometheus/Loki/Tempo retention 和告警规则的声明值与核验结果。
3. **人工发布护栏**：Operator 对运行前检查、残留资源、回退步骤和阶段 5 pilot 做确认；只保存摘要、查询引用和判断结果，不保存观测现场快照。

运行时缺少数据时必须写入 `NULL`、`UNKNOWN` 或限制原因，不能用 `0`、空数组或 `SUCCESS` 伪造完整结果。

## 2. 当前实现基线

### 2.1 已存在并复用的事实来源

| 事实 | 当前来源 | 复用方式 |
| --- | --- | --- |
| 场景、目标服务、operation、duration、恢复策略 | `traffic-control-plane/src/lib/fault-run-catalog.ts` | 只从 Catalog 读取，不在基线模块复制场景事实 |
| Fault Run 状态和时间 | `fault_runs` | 读取 `state`、`started_at`、`expires_at`、`stopped_at`、恢复结果和错误 |
| 运行时间线 | `fault_run_events` | 按 `created_at, id` 顺序折叠事件 |
| Operator 操作 | `operator_audit_logs` | 通过 `operator_audit_id` 和 audit 查询关联 |
| 报表请求统计 | `REPORT_WORKER_STOPPED`（历史兼容读取 `REPORT_REQUEST`） | 新代码只读取终态汇总；历史累计事件仅在旧 Run 折叠时作为回退 |
| 受控场景 Worker 统计 | `SCENARIO_WORKER_STOPPED` | 读取 requests、successes、failures、timeouts、延迟和 drain 信息 |
| 正常生命周期/存储增长摘要 | `RUNNER_LIFECYCLE_SUMMARY` | 统计可确认的 lifecycle 结果，不推断缺失的业务请求数 |
| 目标确认信息 | `TARGET_CONFIRMED` | 只保存已通过目标摘要校验的低基数摘要 |
| 告警规则和 Alertmanager 配置 | `infra/prometheus/rules/alert-rules.yml`、`infra/alertmanager/alertmanager.yml`、Kubernetes ConfigMap | 读取实际配置内容，检查 webhook 和 `send_resolved` |
| 数据预热配置与状态 | `data_warmup_config`、`data_warmup_progress`、Worker 环境配置 | 首次启动校验环境默认值并初始化配置；之后 Web/Worker 只读取数据库配置，记录配置版本和采集时的进度摘要 |

### 2.2 当前缺口

- 没有独立的 baseline 持久化表。
- Catalog 没有显式 revision，需要从规范化后的 Catalog 内容派生。
- Web/Worker 没有统一的 image/release revision 字段。
- `fault_run_events` 对不同场景的汇总字段不完全一致；历史记录仍可能包含高频逐请求事件，但新 Worker 路径只写生命周期汇总。
- 当前 `ReportScenarioWorker`、`ScenarioWorkers` 和 `RunnerEngine` 的事件可提供不同粒度的统计；未知字段不能被强行补齐。
- `CART_CATALOG_DEPENDENCY` 已由 Scenario Worker 通过 Gateway customer session 读取产品/购物车并写入购物车；真实请求、终态事件和业务效果仍必须通过获批运行核验，不能把代码路径计为完整基线。
- Alertmanager 控制面 route 已实现精确路径、`CASTREL_INTERNAL_SERVICE_KEY` 机器认证和低基数 receipt 持久化；真实 firing/resolved 投递仍是运行前置条件，配置 URL 不能替代 receipt 证据。
- 当前 Compose 和 Kubernetes 的观测 retention 主要存在于部署配置中，运行时实际值需要单独核验。
- 事件写入入口对当前写入执行固定 event type、退役高频事件和 8 KiB UTF-8 payload 护栏；历史可空 JSON 不重写，继续由既有 Fault Run retention 清理。
- 数据预热配置当前只来自 Worker 环境变量，Web/API 展示的配置可能与 Worker 不一致；本批次将配置迁移到数据库并通过 Operator API 管理。

## 3. 总体架构

```text
Operator / 发布检查
        |
        v
Baseline API
        |
        v
BaselineCaptureService
  |        |             |
  |        |             +--> DeploymentMetadata
  |        +----------------> FaultRunRepository / EventFold
  +-------------------------> ObservationCheckRecord
                              |
                              v
                    scenario_baselines
                    baseline_pilot_reviews

Fault Run Worker / Coordinator
        |
        +--> 现有 fault_run_events（只增加必要的汇总事件）

Prometheus / Loki / Tempo / Alertmanager
        |
        +--> Operator 只读核验或独立 baseline verifier
              （只保存摘要、查询引用和状态）
```

基线采集不进入 Gateway 业务调用链，不向业务服务增加基线专用接口，也不将 Prometheus、Loki 或 Tempo 的原始返回内容写入控制面数据库。

## 4. 模块边界

### 4.1 控制面模块

建议新增以下模块：

| 模块 | 职责 |
| --- | --- |
| `src/lib/baseline-schema.ts` | 幂等创建批次 0 表结构 |
| `src/lib/baseline-repository.ts` | baseline、pilot review 的读写和幂等 |
| `src/lib/baseline-capture.ts` | 终态运行的事实折叠、完整性判断和摘要生成 |
| `src/lib/baseline-metadata.ts` | Catalog、release、部署模式、schema 和 warmup 元数据 |
| `src/lib/observation-executor.ts` | allowlist observation adapter、窗口/超时/失败状态归一化和低基数检查摘要 |
| `src/lib/baseline-pilot.ts` | 阶段 5 候选场景的选择记录 |

### 4.2 HTTP 路由

路由属于控制面内部 Operator API，必须沿用现有 Operator session、CSRF 和错误 envelope：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/internal/fault-runs/{faultRunId}/baseline` | 对一个已结束运行生成或幂等重建 baseline |
| `GET` | `/internal/fault-runs/{faultRunId}/baseline` | 查询该运行的 baseline |
| `GET` | `/internal/baselines` | 按 scenario、status、revision 查询基线摘要 |
| `GET` | `/internal/baselines/pilot` | 查询阶段 5 pilot review |
| `PUT` | `/internal/baselines/pilot/{scenario}` | Operator 确认候选、选择或拒绝 pilot |

`POST` 和 `PUT` 必须要求 CSRF。写操作都要写入 `operator_audit_logs`，并保存 audit id；查询接口不能出现在消费者路径。

### 4.3 Worker 事件补齐

批次 0 只补齐**汇总事件**，不增加每次请求都写数据库的要求：

- 报表场景在结束时保证存在 `REPORT_WORKER_STOPPED`。
- 受控场景 Worker 在结束时保证存在 `SCENARIO_WORKER_STOPPED`。
- 正常生命周期和存储增长继续使用 `RUNNER_LIFECYCLE_SUMMARY`。
- 如果某场景没有可靠的汇总事件，baseline 标记为 `INCOMPLETE`，并记录缺失事件类型；不能从 Prometheus 百分比反推请求总数。

补齐事件只记录低基数数值、错误代码和状态，不记录密码、session token、service key、原始响应、SQL、shell 或完整日志。

## 5. 数据模型

### 5.1 `scenario_baselines`

该表保存可长期复查的运行摘要，不与 `fault_runs` 建立级联删除关系。`source_fault_run_id` 只作为内部来源引用，Fault Run 进入现有 7 天控制面 retention 后，baseline 摘要仍可保留。

```sql
CREATE TABLE scenario_baselines (
  baseline_id CHAR(36) NOT NULL PRIMARY KEY,
  scenario VARCHAR(64) NOT NULL,
  source_fault_run_id CHAR(36) NOT NULL,
  capture_status VARCHAR(32) NOT NULL,
  catalog_revision VARCHAR(128) NOT NULL,
  release_revision VARCHAR(128) NULL,
  deployment_mode VARCHAR(32) NOT NULL,
  schema_revision VARCHAR(64) NOT NULL,
  data_warmup_enabled TINYINT NOT NULL,
  warmup_config JSON NULL,
  lifecycle_json JSON NOT NULL,
  outcome_json JSON NOT NULL,
  request_summary_json JSON NULL,
  resource_budget_json JSON NULL,
  resource_observation_json JSON NULL,
  observation_summary_json JSON NOT NULL,
  alert_summary_json JSON NOT NULL,
  known_limitations JSON NOT NULL,
  residual_resources JSON NOT NULL,
  rollback_procedure JSON NOT NULL,
  created_by_operator_audit_id BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_baseline_source_run (source_fault_run_id),
  INDEX idx_baseline_scenario_revision (scenario, catalog_revision, created_at),
  INDEX idx_baseline_status (capture_status, created_at),
  CHECK (capture_status IN ('COMPLETE', 'COMPLETE_WITH_LIMITATIONS', 'INCOMPLETE', 'CAPTURE_FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

说明：

- `lifecycle_json` 保存 prepare、active、stop、recovery、cleanup 和 health check 时间点及状态。
- `outcome_json` 保存目标效果是否观察到、业务是否恢复和判断来源；无法判断时使用 `UNKNOWN`。
- `request_summary_json` 保存请求、成功、失败、超时和延迟汇总；未知字段为 `null`。
- `resource_budget_json` 保存 Catalog/部署声明的预算；`resource_observation_json` 保存实际观察到的摘要，二者不能混为“已耗尽”。
- `observation_summary_json` 只保存检查类型、时间窗口、查询引用、结果状态和核验时间，不保存原始 series、log line、trace span 或文件内容。
- `alert_summary_json` 保存告警规则、阈值、`for`、声明值和核验状态，不表示场景一定会 firing。
- `known_limitations`、`residual_resources` 和 `rollback_procedure` 必须是受控 JSON 结构，禁止写入 secret 或可执行命令。

### 5.2 `baseline_pilot_reviews`

该表记录 12 个场景是否适合作为阶段 5 pilot。它保存候选评审事实；Alertmanager 接收记录由独立的 `alert_receipts` 表保存，字段限制为 fingerprint、状态、receiver、告警名、severity、service 和时间，不保存原始 envelope。

```sql
CREATE TABLE baseline_pilot_reviews (
  review_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scenario VARCHAR(64) NOT NULL,
  catalog_revision VARCHAR(128) NOT NULL,
  decision VARCHAR(16) NOT NULL,
  alert_rules JSON NOT NULL,
  evidence_requirements JSON NOT NULL,
  retention_snapshot JSON NOT NULL,
  remediation_boundary TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  operator_audit_id BIGINT NOT NULL,
  reviewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pilot_review (scenario, catalog_revision),
  CHECK (decision IN ('CANDIDATE', 'SELECTED', 'REJECTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`remediation_boundary` 只能描述真实业务或基础设施问题的修复范围，例如依赖恢复、配置检查、连接池处理、数据修复和业务恢复验证；不得描述 Fault Run stop、release 或 cleanup。

### 5.3 Baseline 事件

沿用 `fault_run_events`，新增以下受控事件类型：

| 事件 | 写入时机 | 必要 payload |
| --- | --- | --- |
| `BASELINE_CAPTURE_REQUESTED` | 开始生成 baseline | operator audit id、baseline id |
| `BASELINE_RUNTIME_SUMMARY_RECORDED` | 事实折叠完成 | 事件来源、计数完整性 |
| `BASELINE_OBSERVATION_CHECK_RECORDED` | 观测核验完成 | source、status、checkedAt、window |
| `BASELINE_COMPLETED` | 生成完成 | capture status、limitation count |
| `BASELINE_INCOMPLETE` | 必要事实缺失 | missing fields/events |
| `BASELINE_CAPTURE_FAILED` | 持久化或校验失败 | 稳定错误代码 |

事件 payload 必须限长，并且不包含原始告警 envelope、Authorization、Cookie、密码、token、完整 SQL 或 shell。

## 6. 元数据和 revision 规则

### 6.1 Catalog revision

`catalog_revision` 不手工填写，也不在 baseline 模块复制 12 个场景。实现从 `listScenarioDefinitions()` 得到 Catalog 的规范化 JSON：

1. 按场景名排序；
2. 对参数名、默认值、范围、目标 operation、duration 和 `recoveryStrategy` 做稳定序列化；
3. 使用 SHA-256 生成 revision；
4. 在 baseline 和 Run Event 中记录该 revision。

这样 Catalog 仍只有 `fault-run-catalog.ts` 一个事实来源。

### 6.2 Release revision

新增可选环境变量 `CASTREL_RELEASE_REVISION`，由镜像构建或部署流水线注入：

- Compose：使用 `IMAGE_TAG` 对应的 immutable digest 或发布 revision；
- Kubernetes：使用镜像 digest 或 Deployment revision；
- 本地开发：没有注入时记录 `UNKNOWN`，不能把 `NODE_ENV=production` 当作镜像版本。

Web 和 Worker 必须使用同一值；值为空或格式不合法时只影响基线完整性，不阻断 Fault Run。

### 6.3 Deployment mode

新增可选环境变量 `CASTREL_DEPLOYMENT_MODE`，允许值为 `local`、`compose`、`kubernetes` 或 `unknown`。禁止通过 hostname、端口或运行时猜测部署模式。

### 6.4 Schema revision

新增 `BASELINE_SCHEMA_REVISION` 常量，例如 `baseline.v1`。该值同时写入：

- `src/lib/baseline-schema.ts`；
- `traffic-control-plane/src/lib/migrations/002-fault-run-baseline.sql`；
- `infra/mysql/init/06-fault-run-baseline.sql`；
- baseline 记录的 `schema_revision`。

新增表必须同时更新应用幂等 schema 和 fresh-install init SQL，避免现有 MySQL volume 与新安装行为不一致。

### 6.5 Data warmup metadata

`data_warmup_config` 是运行时唯一配置来源。首次应用启动时先严格校验环境变量；配置行不存在时才使用环境变量写入默认值，已有配置行不再被后续环境变量覆盖。配置至少包含：

```text
enabled
windowDays
rowsPerDay
targetRows
batchSize
batchIntervalMs
maxConcurrency
dbConcurrency
version
updatedByOperatorId
updatedAt
```

`windowDays * rowsPerDay` 必须等于 `targetRows`。为避免无限制写入，应用层和数据库共同限制窗口、每日行数、批大小、批间隔和并发范围；缩小窗口或目标需要 API 请求中的显式确认，Worker 不在配置更新事务中直接删除数据，而是在持有预热租约的 rollover 阶段逐步执行。

基线优先从数据库配置和 Worker warmup progress 读取：

```text
dataWarmupEnabled
windowDays
rowsPerDay
targetRows
batchSize
observedProgress
```

Web 不再复制 Worker 环境变量；配置缺失或 progress 无法查询时标记 `UNKNOWN`/`UNAVAILABLE`。环境变量只承担首次初始化，不得覆盖已存在的数据库配置。

配置写入使用 `(version)` 乐观锁；成功后版本递增并写入 Operator audit。Worker 每个批次重新读取配置，因此启停和参数更新无需重启 Worker；禁用只停止后续自动写入，不删除已有数据。

## 7. 基线采集流程

### 7.1 前置校验

`POST /internal/fault-runs/{faultRunId}/baseline` 执行以下校验：

1. 校验 Operator session、CSRF 和请求体。
2. 加载 Fault Run、Catalog definition、Run Event 和 Operator audit。
3. 只允许 `RECOVERED`、`STOPPED`、`FAILED`、`SERVICE_UNAVAILABLE` 进入最终 baseline。
4. `CREATING`、`ACTIVE`、`RECOVERING` 只能返回 `RUN_NOT_TERMINAL`，不能生成“当前基线”。
5. 根据 `recoveryStrategy` 检查 release、manual cleanup 或 non-releasing 边界。
6. 使用 `(source_fault_run_id)` 幂等；重复提交返回原 baseline，不重复写入摘要。

### 7.2 事实折叠

事件折叠器不依赖事件到达顺序之外的隐式状态，按 `created_at, id` 顺序处理：

| 场景/来源 | 统计策略 |
| --- | --- |
| `BROWSE_REPORT_SQL`、`ORDER_REPORT_SQL` | 优先读取 `REPORT_WORKER_STOPPED` 的终态累计值；为兼容旧 Run，缺少 stopped 时回退到最后一个 `REPORT_REQUEST`，但新 Worker 不再写入该高频事件 |
| `BROWSE_SURGE`、`ORDER_QUERY_SURGE` | 读取 `SCENARIO_WORKER_STOPPED` 的完整统计 |
| `CATALOG_REDIS_LARGE_VALUE`、`PROMOTION_LOCK_CONTENTION`、`INVENTORY_TABLE_EXCLUSIVE`、`INVENTORY_ROW_LOCK` | 读取受控 Worker 的最终 snapshot 和 setup/target 事件 |
| `NOTIFICATION_HEAP_PRESSURE`、`NOTIFICATION_STORAGE_APPEND`、`PSP_PROVIDER_OUTCOME` | 统计 `RUNNER_LIFECYCLE_SUMMARY` 的成功/失败/中断和 latency；没有可靠总请求数时保留 `null` |
| `CART_CATALOG_DEPENDENCY` | 先验证 Worker/Runner dispatch 和受控流量是否存在；只有存在对应生命周期汇总事件时才填充计数，否则生成 `DISPATCH_UNVERIFIED` 并阻断 `COMPLETE` |

`requests`、`successes`、`failures` 和 `timeouts` 必须满足基本一致性检查；不一致时保留原始可信字段，记录 `COUNTER_INCONSISTENT`，不自动修正。

### 7.3 运行阶段时间线

时间点来源优先级：

1. `fault_runs.started_at`、`stopped_at`、`expires_at`；
2. `fault_run_events` 中的 `CREATED`、`TARGET_CONFIRMED`、`RECOVERY_STARTED`、`RECOVERY_COMPLETED`、`RECOVERY_FAILED`；
3. Worker 的 started/stopped 汇总事件；
4. 缺失时为 `null` 并写入限制。

`activeAt` 使用 `ACTIVE` 状态转换对应的 `TARGET_CONFIRMED`/`started_at`，不能使用第一次业务请求时间替代。

### 7.4 观测和 retention 核验

批次 0 不实现阶段 4 的通用 Evidence Query。观测核验只做以下工作：

- 从实际加载的 Prometheus/Alertmanager 配置读取声明的规则、receiver、`send_resolved` 和 retention 相关参数。
- 对 Prometheus、Loki、Tempo 运行只读健康和时间窗口查询，记录是否能查询，不保存返回数据。
- 使用 Nginx Basic Auth 或部署内网入口完成访问，凭据不进入控制面数据库和 baseline JSON。
- 分别保存 `declared`、`observed`、`checkedAt`、`status` 和 limitation。

当前部署配置目标为 Prometheus 168h、Loki 168h、Tempo 168h，但设计不把这个目标写成运行时事实；实际核验失败时必须是 `UNKNOWN` 或 `UNAVAILABLE`。

### 7.5 Pilot 选择

Operator 根据以下维度为 12 个场景生成 `CANDIDATE` 或 `REJECTED` 记录，并最终选择一个 `SELECTED`：

- 告警规则是否真实存在且可稳定触发；
- 告警是否能映射到目标服务和业务 operation；
- baseline/active/recovery 查询窗口是否清晰；
- 关键证据是否在观测 retention 内可复查；
- 实际业务 remediation 是否可描述、可验证且不需要 Agent 写权限；
- 是否存在无法隔离的共享资源副作用。

`SELECTED` 只表示适合作为阶段 5 试点，不表示告警一定 firing，也不表示 remediation 已执行。

## 8. Baseline JSON 逻辑结构

数据库使用 JSON 列保存分组字段，但应用层必须使用显式 TypeScript schema 校验：

```json
{
  "baselineId": "uuid",
  "scenario": "BROWSE_REPORT_SQL",
  "sourceFaultRunId": "uuid",
  "captureStatus": "COMPLETE_WITH_LIMITATIONS",
  "revisions": {
    "catalog": "sha256",
    "release": "image-digest-or-UNKNOWN",
    "schema": "baseline.v1"
  },
  "deployment": {
    "mode": "compose",
    "dataWarmupEnabled": true,
    "warmupConfig": {
      "windowDays": 180,
      "rowsPerDay": 300000,
      "targetRows": 54000000
    }
  },
  "lifecycle": {
    "prepareStartedAt": "timestamp-or-null",
    "activeAt": "timestamp-or-null",
    "stopRequestedAt": "timestamp-or-null",
    "recoveredAt": "timestamp-or-null",
    "cleanupFinishedAt": "timestamp-or-null"
  },
  "outcome": {
    "controlAction": "COMPLETED",
    "effectObserved": "UNKNOWN",
    "businessRecovered": "UNKNOWN",
    "resourceCleanup": "NOT_REQUIRED"
  },
  "requestSummary": {
    "requests": 12,
    "successes": 12,
    "failures": 0,
    "timeouts": null,
    "averageLatencyMs": 830
  },
  "observation": {
    "prometheus": "AVAILABLE",
    "loki": "AVAILABLE",
    "tempo": "PARTIAL",
    "retention": "CHECKED"
  },
  "knownLimitations": [
    "No scenario-specific alert exists"
  ]
}
```

示例中的 `effectObserved`、`businessRecovered` 和 `timeouts` 只是结构示例，实际值必须来自事件或核验结果；不能按示例默认填充。

## 9. 错误和完整性语义

| 错误/状态 | 处理 |
| --- | --- |
| `RUN_NOT_TERMINAL` | 返回 409，不写最终 baseline |
| `SOURCE_RUN_NOT_FOUND` | 返回 404，不创建空记录 |
| `DISPATCH_UNVERIFIED` | 场景定义存在但没有确认实际执行入口，baseline 保持 `INCOMPLETE`，pilot 不得选择 |
| `CATALOG_REVISION_FAILED` | 返回 500，记录 `BASELINE_CAPTURE_FAILED` |
| `MISSING_RUNTIME_EVENT` | 创建 `INCOMPLETE`，列出缺失事件 |
| `COUNTER_INCONSISTENT` | 创建 `COMPLETE_WITH_LIMITATIONS` 或 `INCOMPLETE`，不修正数字 |
| `OBSERVATION_UNAVAILABLE` | 保留运行摘要，观测字段标记不可用 |
| `PILOT_REVIEW_CONFLICT` | 返回 409，要求基于最新 Catalog revision 重审 |
| 重复 baseline 请求 | 返回原记录，不重复产生 audit 或数据 |

`COMPLETE` 的最低条件：

- Catalog revision、scenario、target 和 lifecycle 基本事实存在；
- source run 是终态；
- 与 recovery strategy 匹配的恢复边界可判断；
- 必须的 Worker/Runner 汇总事件存在；
- 没有未解释的计数矛盾。

观测暂时不可用可以使用 `COMPLETE_WITH_LIMITATIONS`，但 pilot 不能在 retention 和关键查询未核验时进入 `SELECTED`。

## 10. 迁移、Retention 和回退

### 10.1 迁移

新增：

- `traffic-control-plane/src/lib/migrations/002-fault-run-baseline.sql`
- `infra/mysql/init/06-fault-run-baseline.sql`
- `traffic-control-plane/src/lib/baseline-schema.ts`

迁移只新增表、索引和约束，不修改 `fault_runs`、`fault_run_events` 的既有字段和状态约束。应用启动时使用幂等 `CREATE TABLE IF NOT EXISTS`，现有 MySQL volume 无需重置。

### 10.2 Retention

- baseline 是控制面摘要，不是 Prometheus/Loki/Tempo retention 的替代物。
- baseline 不随 `deleteExpiredFaultRuns()` 的 7 天 Fault Run 删除级联删除。
- 批次 0 不自动删除 baseline；后续若增加控制面摘要 retention，必须单独增加配置、审计和迁移，不得复用观测 retention 或 Agent 评估关闭时间。
- pilot review 作为低频审计记录保留，不保存原始观测内容。

### 10.3 回退

- 通过 `BASELINE_CAPTURE_ENABLED=false` 关闭新 API 和旁路采集。
- 关闭后不停止 Worker、不改变 Fault Run 状态、不删除业务数据。
- 已写入的 baseline 摘要保持可读；不能因为回退而删除历史运行事实。
- 若新表初始化失败，控制面继续按现有 Fault Run 逻辑运行，但批次 0 不得标记为完成。

## 11. 配置项

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `BASELINE_CAPTURE_ENABLED` | `false` | 开启 Operator baseline API 和旁路采集 |
| `CASTREL_RELEASE_REVISION` | `UNKNOWN` | 记录镜像/发布 revision |
| `CASTREL_DEPLOYMENT_MODE` | `unknown` | 记录 local/compose/kubernetes |
| `BASELINE_OBSERVATION_CHECK_TIMEOUT_MS` | `5000` | 单项只读观测核验超时 |
| `BASELINE_OBSERVATION_WINDOW_SEC` | `900` | 默认核验窗口；必须受场景 duration 和 retention 限制 |

不新增任何密码、token 或 service key 配置。观测查询若需要外部 Basic Auth，使用现有部署侧认证方式，不把凭据复制到 baseline 配置。

## 12. 测试设计

### 12.1 单元测试

- Catalog canonicalization 在参数顺序变化时保持稳定，在 Catalog 事实变化时 revision 变化。
- 每个场景组的事件折叠和计数一致性。
- `TARGET`、`WORKER`、`MANUAL_CLEANUP`、`NON_RELEASING` 的完整性判断。
- 缺失事件、未知字段、计数矛盾和观测不可用不会生成伪造成功。
- baseline JSON schema 拒绝 secret、完整响应和超长 payload。
- 相同 source run 的重复请求保持幂等。

### 12.2 集成测试

- fresh MySQL 和已有 Fault Run volume 都能创建新表。
- baseline 读取不依赖 Fault Run 仍然存在。
- Operator session、CSRF、audit 和错误 envelope 正常工作。
- `BASELINE_CAPTURE_ENABLED=false` 时新路由不可用但现有 Fault Run API 正常。
- Alertmanager 配置缺少控制面接收 route 时记录 limitation，不误报“接收已实现”。

### 12.3 环境验收

在一次 disposable Compose 和一次 Kubernetes 配置核验中：

1. 对 12 个场景分别执行一次合适时长的 Fault Run；
2. 先核对每个场景的 Catalog、target map、Worker/Runner dispatch 和实际请求；
3. 生成 baseline 并核对 Run Event、Worker 汇总和 operator audit；
4. 读取 Prometheus/Loki/Tempo/Alertmanager 的实际 retention 和加载配置；
5. 检查 baseline 中没有原始日志、指标序列、Trace span、secret 或可执行命令；
6. 记录一个 pilot candidate 和其排除理由；
7. 关闭 baseline 开关，确认业务运行和已有 Fault Run 路径不变。

## 13. 实施顺序

1. 增加 baseline schema、类型和 repository，不接入 UI。
2. 增加 Catalog/release/deployment/warmup metadata provider。
3. 增加事件折叠器和完整性校验，先用 fixture 覆盖 12 个场景。
4. 在缺失汇总事件的 Worker 补齐结束汇总，不增加每请求写库。
5. 增加 Operator API、audit 和幂等。
6. 增加只读观测/retention verifier 和 pilot review。
7. 在 Compose disposable 环境完成 12 场景基线，再决定是否进入批次 1。

批次 0 完成的标志是“基线事实可复查且缺失被明确记录”，不是“所有场景都触发告警”或“所有指标都可永久查询”。
