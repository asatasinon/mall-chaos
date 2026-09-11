# 阶段 5：告警驱动的 Agent RCA 试点

## 目标

在资源与数据隔离平台通用化之前，用专用、非生产、单运行环境验证：

```text
告警 -> 外部 Agent 只读观测 -> RCA/建议提交 -> 自动评估
```

恢复执行不属于本阶段 Agent 能力。

## 触发链路

```text
控制面开启 Fault Run
  -> 真实业务行为产生影响
  -> Alertmanager 产生 allowlisted firing alert
  -> traffic-control-plane 接收并关联告警
  -> Alert Delivery Gateway 发送受控告警 envelope
  -> Agent 查询允许的观测入口
  -> Agent 提交 AgentSubmission.json
  -> Result Gateway 校验并自动排队 Evaluator
```

### AlertRef

外部 Agent 不获取 `taskId`、`evaluationId`、`faultRunId` 或内部数据库 ID，只接收 opaque `alertRef`：

```json
{
  "fingerprint": "alert-fp-01J8EXAMPLE",
  "startsAt": "2026-09-11T08:20:00Z"
}
```

控制面在告警到达时做一次 admission：

- 校验 Alertmanager/Alert Delivery 来源、签名或 mTLS。
- 校验告警 allowlist、目标服务、时间和 active Fault Run。
- 生成并保存最小告警接收记录。

Evaluator 后续只校验 `alertRef` 是否来自受信任接入、是否属于该运行；不要求告警当前仍为 firing。`firing -> resolved` 是正常恢复过程。

## AgentSubmission v1

JSON 是唯一机器输入，Markdown 只能由 JSON 派生或用于人工查看。

规范最小结构：

```json
{
  "schemaVersion": "agent-submission.v1",
  "submissionId": "sub-01J8EXAMPLE",
  "alertRef": {
    "fingerprint": "alert-fp-01J8EXAMPLE",
    "startsAt": "2026-09-11T08:20:00Z"
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
  "recoveryRecommendation": {
    "summary": "Request Operator review and verify latency after the controlled run recovers.",
    "actions": [
      {
        "order": 1,
        "action": "Request Operator review of the active controlled run.",
        "target": "Fault Run control",
        "preconditions": ["Confirm the active window and affected operation."],
        "risks": ["Stopping the run changes the observation window."],
        "verification": ["Check report latency after recovery."],
        "rollback": ["Leave the run unchanged if the recommendation is rejected."]
      }
    ]
  },
  "limitations": ["This report does not prove that recovery has been executed."],
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
- `recoveryRecommendation`
- `limitations`

`submissionId` 用于幂等、重试和审计；同一个 `alertRef` 可以有多次提交。Agent 不获得 `taskId`、`evaluationId`、`faultRunId` 或内部数据库 ID。

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

恢复建议至少包含：

- 建议动作。
- 前置条件。
- 风险。
- 验证步骤。
- 回退方案。

禁止 Agent 提交：

- `recoveryExecuted`、`cleanupExecuted`、`score`、`passed`。
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
- 不执行恢复，不替 Operator 调用 release/cleanup。
- 告警从 `firing` 变为 `resolved` 仍然可以评估；Evaluator 校验告警接收记录和 `alertRef`，不要求当前仍为 firing。
- 查询失败或观测 retention 过期时返回 `evidence_unavailable`，不直接判定 RCA 错误。

## 验收

- 没有 firing alert，不向 Agent 发送 RCA 任务。
- 告警接收记录缺失或无法关联时返回 `UNMATCHED_ALERT` / `ALERT_RECEIPT_UNAVAILABLE`，不直接判 RCA 错误。
- Agent 不能访问 Operator 权限、Ground Truth 或其他运行数据。
- Agent 只能只读查询并提交 RCA/建议。
- AgentSubmission 必须通过版本化 JSON Schema。
- Operator 不执行恢复是合法结果，报告使用 `NOT_EXECUTED`。
- Evaluator 状态区分 `PENDING`、`RUNNING`、`COMPLETED`、`EVIDENCE_UNAVAILABLE`、`FAILED`。
- 不发布跨 Agent 排行榜。

## 回退

撤销 Agent 接入、停止 Alert Delivery、保留 RCA/评估记录，并继续使用现有 Operator 控制面完成停止、恢复和清理。
