# 批次 5.2：RCA Evaluator 产品规格

> 状态：产品规格 v1
> 对应路线阶段：阶段 5 Evaluator
> 依赖：批次 5.1
> 下一步：技术设计、规则定义和评估队列任务

## 1. 产品目标

让系统能够独立判断 Agent 的 RCA 是否有足够证据、建议是否安全且适合解决真实场景问题，同时保留“无法复查证据”和“业务结果未知”等限制。

Evaluator 不是 Agent 的 RCA，也不执行恢复或 remediation。

## 2. 服务对象与问题

| 服务对象 | 当前问题 | 本批次价值 |
| --- | --- | --- |
| Operator | 只能人工阅读 Agent 输出，无法统一判断质量 | 获得结构化、可解释的评估结果 |
| Agent/集成方 | 不知道提交为什么被接受或不足 | 获得证据、诊断和建议分项反馈 |
| 维护者 | 容易把控制动作完成误判为业务恢复 | 将控制面、业务恢复、建议执行和证据状态分开 |

## 3. 产品范围

### 3.1 包含

- 合法 AgentSubmission 自动进入评估队列。
- 重新读取 AgentSubmission、alert receipt、Run Event、实时观测和 Contract revision。
- 对比 Agent 提交的 `alertRefs[]` 与该 `incidentRef` 下控制面已知的告警集合，计算告警覆盖度。
- 使用确定性规则检查 RCA 分类、证据引用和 remediation 建议。
- 输出 RCA 正确性、证据充分性、建议安全性和限制。
- 支持 Operator 查看、重试、放弃或显式关闭评估。
- 可选记录 Operator 或外部系统提供的实际 remediation outcome。

### 3.2 不包含

- 不执行 stop、release、cleanup、恢复或任何业务写操作。
- 不把 Agent 建议当作已经执行的修复。
- 不因 alert resolved 自动关闭评估。
- 不因 retention 过期自动判定 RCA 错误。
- 不实现统一排行榜、多 Agent 对比或跨环境评测。

## 4. 关键用户流程

```text
AgentSubmission 被接受
  -> Evaluator 自动排队
  -> 读取告警接收事实、运行时间线和实时证据
  -> 应用 RCA/证据/remediation 规则
  -> 输出分项结果和限制
  -> Operator 查看、重试、放弃或关闭
  -> 如有外部实际修复结果，单独记录 outcome
```

评估关闭是服务端或 Operator 的显式状态；没有固定的 RCA 提交过期时间。

## 5. 产品输出

评估结果至少分开记录：

| 字段 | 含义 |
| --- | --- |
| `diagnosisAssessment` | RCA 正确、部分正确、错误或无法确定 |
| `evidenceAssessment` | 证据充分、不足或 `EVIDENCE_UNAVAILABLE` |
| `alertCoverageStatus` | Agent 引用的告警覆盖度：`COMPLETE`、`PARTIAL` 或 `UNKNOWN` |
| `alertCoverage` | 已引用告警数、控制面已知告警数以及未引用告警的限制说明 |
| `remediationReviewStatus` | 建议安全、可执行、不完整或不安全 |
| `remediationExecutionStatus` | 是否观察到实际建议执行；默认不是 Agent 已执行 |
| `businessRecoveryStatus` | 业务是否恢复、部分恢复或未知 |
| `faultRunControlStatus` | Fault Run 控制状态，仅作为外部事实读取 |
| `limitations` | retention、查询失败、告警关联或业务结果限制 |

`faultRunControlStatus` 和 `remediationExecutionStatus` 必须分开，不能以控制面已停止来证明实际业务问题已修复。

## 6. 产品验收

- 合法提交可以自动进入队列并产生可查询评估状态。
- Agent 只提交 5 个已知告警中的 2 个时，提交仍可进入 Evaluator，并输出 `alertCoverageStatus=PARTIAL`。
- Evaluator 重新查询证据，不只相信 Agent 自己的结论。
- 评估结果能区分 RCA 错误、证据不可用、建议不安全和业务恢复未知。
- Alertmanager 的 resolved 通知不会使评估自动失效。
- retention 过期只产生 `EVIDENCE_UNAVAILABLE` 限制。
- Operator 能够查看、重试、放弃和显式关闭评估。
- Evaluator 不执行任何 Fault Run 控制或实际 remediation。

## 7. 成功指标与退出条件

- pilot 场景完成一次 AgentSubmission 到 Evaluator 报告的闭环。
- 至少覆盖合法提交、部分告警引用、重复提交、证据不足、证据过期、告警 resolved 和评估关闭。
- 评估报告可以解释每个结论依赖的证据和限制。
- 控制面状态、业务恢复状态和 remediation 执行状态没有混用。

满足退出条件后，阶段 0～5 的当前路线闭环完成；后续能力不在本路线范围内。
