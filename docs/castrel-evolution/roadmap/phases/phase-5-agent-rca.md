# 阶段 5：告警驱动的 Agent RCA 试点

> 状态：当前优先级；依赖阶段 0～4；本阶段完成后再评估是否启动阶段 6

## 目标

在资源与数据隔离平台通用化之前，用专用、非生产、单运行环境验证：

```text
告警 -> 外部 Agent 只读观测 -> RCA/建议提交 -> 自动评估
```

实际场景 remediation 执行不属于本阶段 Agent 能力。

本阶段必须先选择一个通过阶段 0 告警基线的场景。不要为了触发 Agent 而新增伪造告警或把所有通用告警强行映射到场景。

## 触发链路

```text
控制面开启 Fault Run
  -> 真实业务行为产生影响
  -> Alertmanager 产生 allowlisted firing alert
  -> traffic-control-plane 接收并关联告警
  -> Alert Delivery Gateway 发送受控告警 envelope
  -> Agent 通过只读观测入口查询允许的 Prometheus/Loki/Tempo/业务检查
  -> Agent 提交 AgentSubmission.json
  -> Result Gateway 校验并自动排队 Evaluator
```

## 进入本阶段前必须核对的告警接入

当前部署配置已经使用类似 `/internal/alertmanager/webhook` 的内部 webhook 配置；这不等于控制面已有完整告警接收能力。阶段 0/5 必须通过代码和集成测试确认：

- 控制面 webhook route 是否真实存在并受保护。
- Alertmanager payload 的 `firing`/`resolved`、grouped alerts 和 `send_resolved` 是否正确处理。
- webhook 来源认证是否使用 mTLS、受限网络或签名校验。
- alert allowlist、目标服务、严重级别和 active Fault Run 关联是否正确。
- fingerprint 去重、重复投递、告警接收记录、`startsAt`、`resolvedAt`、`expiresAt` 和过期提交是否正确。
- Alert Delivery Gateway 和 Result Gateway 是否真实可用。
- Alert Delivery Gateway 向外部 Agent 发送受控 envelope。
- Result Gateway 接收 `AgentSubmission.json` 并自动排队 Evaluator。

阶段 5 不应把配置文件中的 webhook URL 当作现成实现；缺失部分属于本阶段的实现范围。

### AlertRef

外部 Agent 不获取 `taskId`、`evaluationId`、`faultRunId` 或内部数据库 ID，只接收 opaque `alertRef`：

```json
{
  "fingerprint": "alert-fp-01J8EXAMPLE",
  "startsAt": "2026-09-11T08:20:00Z",
  "receivedAt": "2026-09-11T08:20:30Z",
  "expiresAt": "2026-09-11T08:35:30Z"
}
```

控制面在告警到达时做一次 admission：

- 校验 Alertmanager/Alert Delivery 来源、签名或 mTLS。
- 校验告警 allowlist、目标服务、时间和 active Fault Run。
- 生成并保存最小告警接收记录。
- 记录告警到达时间、startsAt、resolvedAt（如有）、receivedAt、expiresAt、关联状态和去重结果。

Evaluator 后续只校验 `alertRef` 是否来自受信任接入、是否属于该运行；不要求告警当前仍为 firing。`firing -> resolved` 是正常恢复过程。

### Submission window

`expiresAt` 是**Agent RCA 提交窗口**的结束时间，不是 Fault Run 的 `expiresAt`，也不是 Alertmanager 当前 firing 状态的截止时间：

```text
receivedAt = 服务端第一次接受该告警实例的时间
submissionWindowSec = 告警合同配置，默认 900 秒（15 分钟）
expiresAt = receivedAt + submissionWindowSec
```

规则：

- 默认窗口为 15 分钟；告警合同允许在 5～30 分钟内按场景配置。
- `startsAt` 是 Prometheus/Alertmanager 观察到告警开始的时间，不用它单独计算 Agent 窗口；Agent 可能在 Alertmanager group wait 后才收到告警。
- `receivedAt` 和 `expiresAt` 由服务端生成并签名/绑定到 `alertRef`，Agent 不能修改；Agent 的 `submittedAt` 只用于记录，不用于判断是否过期。
- Alertmanager 的重复通知不会延长窗口；同一 fingerprint 和 startsAt 仍使用原始 `expiresAt`。
- 告警恢复为 `resolved` 不会提前使提交失效；只要服务端在 `expiresAt` 前收到提交，仍可进入评估。
- 服务端在 Result Gateway 收到请求时判断 `serverReceivedAt <= expiresAt`。已经在窗口内接收的提交，即使队列稍后执行，也可以继续评估。
- 超过窗口的新提交返回 `SUBMISSION_WINDOW_EXPIRED`，不进入自动评估。
- 新一轮重新 firing 且 `startsAt` 改变时，生成新的 alertRef 和新的 submission window。

这几个时间必须分开：

| 时间 | 作用 |
| --- | --- |
| Fault Run `expiresAt` | 控制故障活动或租约何时到期 |
| Alert `startsAt` | 观测系统认为告警开始的时间 |
| Alert `receivedAt` | 控制面第一次接受告警的服务端时间 |
| Agent submission `submittedAt` | Agent 报告中的自报时间，仅作审计信息 |
| Alert `expiresAt` | Result Gateway 接受该告警 RCA 提交的截止时间 |

`alertRef` 只是关联键，不是观测权限。Agent 需要通过 Alert Delivery Gateway 获得独立的短时、只读观测访问凭据或 mTLS 身份，凭据至少限定：

- 允许的观测入口：Prometheus、Loki、Tempo 和指定业务只读检查。
- 允许的服务、租户/环境和时间范围。
- 过期时间、限流、审计和撤销方式。
- 禁止访问控制面写 API、业务写 API、内部 operation 和其他运行数据。

这些访问凭据不得写入 `AgentSubmission.json`，也不得出现在 RCA、日志或 Markdown 展示文件中。

## AgentSubmission v1

JSON 是唯一机器输入，Markdown 只能由 JSON 派生或用于人工查看。

规范最小结构：

```json
{
  "schemaVersion": "agent-submission.v1",
  "submissionId": "sub-01J8EXAMPLE",
  "alertRef": {
    "fingerprint": "alert-fp-01J8EXAMPLE",
    "startsAt": "2026-09-11T08:20:00Z",
    "receivedAt": "2026-09-11T08:20:30Z",
    "expiresAt": "2026-09-11T08:35:30Z"
  },
  "submittedAt": "2026-09-11T08:30:00Z",
  "agent": {
    "name": "example-rca-agent",
    "version": "0.1.0"
  },
  "diagnosis": {
    "summary": "商品浏览报表出现持续高延迟。",
    "symptoms": ["catalog-service report latency increased"],
    "rootCause": {
      "category": "DATABASE_QUERY",
      "service": "catalog-service",
      "resource": "product browse report",
      "explanation": "The report query is consuming increased database capacity."
    },
    "affectedServices": ["catalog-service"],
    "affectedResources": ["product browse report"],
    "confidence": 0.82,
    "uncertainties": ["The exact query plan was not available."]
  },
  "evidenceRefs": [
    {
      "evidenceId": "e-1",
      "kind": "trace",
      "source": "tempo",
      "service": "catalog-service",
      "window": {
        "from": "2026-09-11T08:20:00Z",
        "to": "2026-09-11T08:30:00Z"
      },
      "agentQuery": "{ resource.service.name = \"catalog-service\" }",
      "observation": "JDBC duration increased during the active window.",
      "supports": ["symptom", "root_cause"]
    }
  ],
  "remediationRecommendation": {
    "summary": "Review the product browse report query plan and apply an approved query/index optimization, then verify report latency returns toward baseline.",
    "actions": [
      {
        "order": 1,
        "action": "Review the report query plan and apply the approved catalog report query/index change through the normal change process.",
        "target": "catalog-service product browse report / MySQL",
        "preconditions": ["Confirm the query plan and affected table/index.", "Confirm the change is safe for current traffic."],
        "risks": ["A query or index change can increase write cost or affect other catalog reads."],
        "verification": ["Check report latency and error rate against the baseline window.", "Check catalog-service and MySQL health after the change."],
        "rollback": ["Revert the query/index change through the normal deployment or database change procedure."]
      }
    ]
  },
  "limitations": ["This report does not prove that the recommended remediation has been executed."],
  "extensions": {}
}
```

必填字段：

- `schemaVersion = "agent-submission.v1"`
- `submissionId`
- `alertRef`
- `submittedAt`
- `agent.name/version`
- `diagnosis`
- `evidenceRefs`
- `remediationRecommendation`
- `limitations`

`submissionId` 用于幂等、重试和审计；同一个 `alertRef` 可以有多次提交。Result Gateway 需要定义：

- 相同 `submissionId` 重复提交返回同一接收结果，不重复排队评估。
- 新 `submissionId` 在同一 `alertRef` 下提交时，只有在前一次评估尚未开始时才允许替换；评估已开始后必须由 Operator 显式重试或选择新提交。
- 超过 `expiresAt` 的提交返回 `SUBMISSION_WINDOW_EXPIRED`，不进入自动评估。
- Agent 不获得 `taskId`、`evaluationId`、`faultRunId` 或内部数据库 ID。

RCA 至少包含：

- 症状。
- `rootCause.category`：`DATABASE_QUERY`、`CACHE`、`DEPENDENCY`、`LOCK`、`JVM`、`STORAGE`、`EXTERNAL_PROVIDER`、`TRAFFIC`、`CONFIGURATION`、`UNKNOWN`。
- 受影响服务和资源。
- `confidence` 与不确定性。

Evidence 引用至少包含：

- `evidenceId`。
- 数据源和服务。
- 查询时间窗口。
- Agent 使用的查询文本。
- 观察结果。
- 支持的结论。

实际场景修复建议至少包含：

- 建议动作。
- 目标业务服务、资源或依赖。
- 前置条件。
- 风险。
- 验证步骤。
- 回退方案。

该字段描述的是**修复 RCA 所识别的实际业务/基础设施问题**，不是 Fault Run 的控制动作。Agent 不知道也不需要知道 Fault Run；以下内容不属于 Agent 的建议：

- 停止或延长 Fault Run。
- 调用 Fault Run `release` 或 `cleanup`。
- 修改控制面状态。
- 操作 Alertmanager、Evaluator 或内部 Worker。

禁止 Agent 提交：

- `remediationExecuted`、`cleanupExecuted`、`score`、`passed`。
- 密码、token、service key、kubeconfig 和 Authorization Header。
- 可直接执行的 shell、SQL、任意 URL 或内部 operation payload。
- Ground Truth、`taskId`、`evaluationId` 或控制面内部 ID。

Result Gateway 在保存提交前必须执行：

```text
AgentSubmission.json
  -> JSON Schema validation
  -> alertRef / permission / size / secret checks
  -> immutable submission record
  -> automatically queued Evaluator
```

Markdown 只能用于人工查看或由 JSON 派生生成；只提交 Markdown 的内容不能进入自动评估。

## Evaluator 触发和职责

Result Gateway 校验 JSON Schema 后自动排队 Evaluator。Operator 可以通过受保护 API 查看、重试或放弃一次评估。

Evaluator：

- 重新查询实时观测数据。
- 检查 Agent 证据引用是否成立。
- 判断 RCA 正确性、证据充分性和建议安全性。
- 判断告警接收、Fault Run 控制面状态和目标效果。
- 不执行实际场景 remediation，不替 Operator 调用 release/cleanup。
- 告警从 `firing` 变为 `resolved` 仍然可以评估；Evaluator 校验告警接收记录和 `alertRef`，不要求当前仍为 firing。
- 查询失败或观测 retention 过期时返回 `evidence_unavailable`，不直接判定 RCA 错误。
- Evaluator 只能使用服务端 allowlisted 查询配方，不执行 Agent 提交的任意查询、URL、shell 或 SQL。

## 验收

- 没有 firing alert，不向 Agent 发送 RCA 任务。
- 告警接收记录缺失或无法关联时返回 `UNMATCHED_ALERT` / `ALERT_RECEIPT_UNAVAILABLE`，不直接判 RCA 错误。
- Agent 不能访问 Operator 权限、Ground Truth 或其他运行数据。
- Agent 只能只读查询并提交 RCA/建议。
- AgentSubmission 必须通过版本化 JSON Schema。
- 同一 `submissionId` 重试幂等；过期告警提交不进入自动评估。
- Operator 不执行实际场景 remediation 是合法结果，报告使用 `remediationExecutionStatus = NOT_EXECUTED`。
- Evaluator 状态区分 `PENDING`、`RUNNING`、`COMPLETED`、`EVIDENCE_UNAVAILABLE`、`FAILED`。
- 不发布跨 Agent 排行榜。
- 试点场景的 alert receipt、AgentSubmission、Evaluator report 和 `remediationExecutionStatus` 可以通过同一 `alertRef` 关联；Fault Run 的内部 stop/release/cleanup 状态仍只由控制面记录。

## 回退

撤销 Agent 接入、停止 Alert Delivery、保留 RCA/评估记录，并继续使用现有 Operator 控制面完成停止、恢复和清理。
