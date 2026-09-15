# 批次 5.1：Agent 告警投递与 RCA 提交产品规格

> 状态：产品规格 v1
> 对应路线阶段：阶段 5 Agent RCA
> 依赖：批次 5.0
> 下一步：技术设计、AgentSubmission v1 Schema 和 pilot receiver 配置

## 1. 产品目标

让外部 Agent 在收到真实 firing alert 后，能够只读查询观测数据，提交结构化 RCA、证据引用和解决实际场景所需的 remediation 建议。

Agent 不需要知道 Castrel 的 Fault Run 控制模型，也不能控制 Fault Run 或直接修改业务系统。

## 2. 服务对象与问题

| 服务对象 | 当前问题 | 本批次价值 |
| --- | --- | --- |
| 外部 Agent | 一个问题可能对应多个告警，单一告警无法覆盖完整证据范围 | 获得包含一个或多个告警实例引用的告警 envelope 和只读查询入口 |
| Operator | Agent 输出格式不一致，无法进入统一评估 | 获得标准化 AgentSubmission v1 |
| 业务/平台负责人 | Agent 可能误把演练控制动作当作业务修复 | 明确 remediation 只描述真实场景的修复动作 |

## 3. 产品范围

### 3.1 包含

- 为 pilot alert 配置专用 Alertmanager child route。
- Alertmanager 通过外部 receiver webhook 向 Agent 投递 firing alert。
- 外部 HTTP 入口由统一 Nginx Basic Auth 保护。
- Agent 使用部署侧 Basic Auth 访问现有 Prometheus、Loki、Tempo 或业务只读入口。
- 接收 `schemaVersion = agent-submission.v1` 的结构化提交。
- 使用 `submissionId` 做幂等和审计。
- 使用 `alertRefs[]` 关联批次 5.0 的一个或多个告警接收事实；如控制面已完成聚合，同时关联内部 `incidentRef`。
- 校验 diagnosis、evidenceRefs、`remediationRecommendation`、limitations 和 extensions。
- 自动排队后续 Evaluator。

### 3.2 不包含

- 不向 Agent 暴露 `taskId`、`evaluationId`、`faultRunId`、Ground Truth 或内部数据库 ID。
- 不允许 Agent 执行 stop、release、cleanup、恢复或业务写操作。
- 不把 `remediationRecommendation` 写成 Fault Run 控制建议。
- 不接受密码、token、service key、kubeconfig、可执行 SQL/shell/URL 或自动修复脚本。
- 不设置固定 RCA 提交过期时间。
- 不实现多 Agent benchmark、排行榜或自动 remediation。

## 4. 关键用户流程

```text
Alertmanager 发送 pilot firing alert
  -> Agent 收到包含一个或多个告警实例的 alert envelope
  -> Agent 只读查询指标、日志、Trace 和业务状态
  -> Agent 生成 AgentSubmission v1
  -> 控制面校验并按 submissionId 幂等接收
  -> 合法提交进入 Evaluator 队列
  -> Operator 查看 RCA、证据、remediation 建议和限制
```

告警从 firing 变为 resolved 不会使已接收的提交失效。提交是否还能被评估由服务端/Operator 的评估关闭状态决定，而不是由固定时间窗口决定。

## 5. 产品行为

`remediationRecommendation` 必须回答真实场景问题，例如检查配置、恢复依赖、修复连接池、处理数据或验证业务恢复；不得回答“停止 Fault Run”“释放 Fault Run 资源”或“清理演练状态”。

推荐的提交结构包括：

```text
schemaVersion
submissionId
alertRefs
agent
diagnosis
evidenceRefs
remediationRecommendation
limitations
extensions
```

提交结果至少区分：

| 结果 | 含义 |
| --- | --- |
| `ACCEPTED` | 格式、关联和幂等校验通过，等待 Evaluator |
| `REJECTED` | 缺少必需字段、关联无效或包含禁止内容 |
| `DUPLICATE` | 相同 submissionId 已处理，返回原处理事实 |
| `EVALUATION_CLOSED` | 服务端或 Operator 已显式关闭该告警评估 |

观测 retention 不足时，提交仍可接收；后续评估应记录 `EVIDENCE_UNAVAILABLE`，不能直接判定 RCA 错误。

一个 `alertRef` 只代表一个告警实例；同一问题产生多个告警时，AgentSubmission 使用 `alertRefs[]` 一次引用多个实例。Alertmanager 的 `groupKey` 只是通知分组，不能直接证明这些告警属于同一根因；是否形成 `incidentRef` 由控制面根据告警合同、时间窗口、服务/资源关联和 active Fault Run 事实判断。

`incidentRef` 是控制面内部的聚合引用，不要求 Agent 生成，也不作为 `AgentSubmission.json` 的必填字段；服务端根据 `alertRefs[]` 在接收和评估时解析或确认它。

`alertRefs[]` 表示 Agent 实际收到并用于分析的告警，不要求覆盖该 `incidentRef` 下控制面已知的全部告警。比如控制面已知 5 个告警而 Agent 只提交其中 2 个，只要这 2 个引用有效且可关联，提交仍然可以进入 Evaluator；覆盖不足由 Evaluator 记录为 `PARTIAL`，再影响证据充分性或诊断完整性判断。

## 6. 产品验收

- 只有 pilot alert 会进入外部 Agent receiver，默认告警不会全量投递。
- Agent 可以完成只读观测查询并提交合法 `AgentSubmission v1`。
- 非法、重复和评估关闭后的提交均有明确结果。
- Agent 无法通过提交内容获得 Fault Run 控制字段或内部权限。
- AgentSubmission 可以覆盖一个问题对应的多个告警实例，并能区分主要告警和补充告警。
- AgentSubmission 只引用部分有效告警时仍可进入 Evaluator，不因为未列出全部告警而自动拒绝。
- 控制面只接收建议，不执行实际 remediation。
- Agent 的建议能够被后续 Evaluator 独立读取和复查。

## 7. 成功指标与退出条件

- pilot alert 的端到端投递、Basic Auth、提交、重试和幂等测试通过。
- 至少有一份真实场景 RCA 提交包含可复查证据引用和实际 remediation 建议。
- 提交内容不包含禁止字段和可直接执行的写操作。
- 合法提交能够稳定进入批次 5.2 的 Evaluator 队列。

满足退出条件后，进入批次 5.2。

## 8. ITBench 参考范围与有意差异

本规格参考 ITBench 的**实验评估思想和资产边界**，但 `AgentSubmission.json` 不是从 ITBench 复制的现成跨领域标准。ITBench 当前不同领域主要由 Scenario、Fault、Waiter、Ground Truth、Recorder、状态/Bundle 和外部评估流程组合而成，并不存在一个可以直接复用到 Castrel 的统一 `AgentSubmission` 本地模型。

| ITBench 关注点 | Castrel 的对应设计 | 是否直接复用 |
| --- | --- | --- |
| Scenario / Fault / Waiter | Fault Run Catalog、目标 operation、生命周期和恢复检查 | 否，沿用 Castrel 现有控制面模型 |
| Ground Truth | Catalog 内部的预期信号、恢复条件、业务检查和安全边界 | 否，不向 Agent 暴露 |
| Recorder | Prometheus、Loki、Tempo、业务检查和 Evidence Query Manifest | 否，Castrel v0 只保存查询协议和摘要，不保存现场快照 |
| 状态、Bundle、评估输入 | `alertRefs[]`、内部 `incidentRef`、告警接收记录、AgentSubmission、Evaluator Report | 否，按告警驱动重新设计 |
| 外部 Agent 接入 | Alertmanager 外部 receiver + Nginx Basic Auth + Submission endpoint | 否，不引入 AWX 或额外 Agent Gateway |
| Agent remediation | `remediationRecommendation` | 仅借鉴“诊断后给出修复方向”，不允许 Agent 自动执行 |

Castrel 有意保留以下差异：

- 不向 Agent 提供 `taskId`、`evaluationId`、`faultRunId`、Ground Truth 或内部数据库 ID；Agent 只使用一个或多个 opaque `alertRef`，内部 `incidentRef` 不暴露为控制面 ID。
- 不把 Fault Run 控制动作当成业务 remediation；建议必须针对真实业务或基础设施问题。
- 不设置固定的 Agent RCA 提交过期时间；评估关闭由服务端或 Operator 显式决定，观测 retention 只影响证据复查。
- 当前只支持单环境、单场景、单运行的 pilot，不实现 ITBench 风格的多 Trial、跨 Agent benchmark、Leaderboard 或自动修复。
