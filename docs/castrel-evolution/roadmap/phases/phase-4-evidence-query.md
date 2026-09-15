# 阶段 4：Evidence Query Manifest 和确定性基线

> 状态：当前优先级；依赖阶段 0～3

## 目标

让 Operator（以及阶段 5 之后的 Agent）能按统一时间窗口直接查询现有 Prometheus、Loki、Tempo、业务只读接口和 Run Event。本阶段不保存现场指标、日志、Trace 或完整资源快照。

## Evidence Query Manifest

Manifest 保存：

- Fault Run 元数据和控制面时间线。
- `baseline`、`active`、`recovery`、`cleanup` 时间窗口。
- PromQL、LogQL、TraceQL 和业务检查配方。
- 可选的 Operator 分析笔记；阶段 5 之后才接入 Agent RCA、证据引用、置信度和实际场景 remediation 建议。
- `evidence_unavailable`、查询失败和数据过期状态。

不保存：

- Prometheus 指标结果。
- Loki 日志。
- Tempo Trace/Span。
- MySQL/Redis volume、JVM heap、文件卷和 PSP checkpoint。
- 原始日志、Trace 导出、指标降采样副本或 S3 证据包。

建议保存的时间点：

```text
t_created
t_prepare_started
t_active
t_effect_observed        可选；不确定时为空
t_agent_started          可选
t_agent_submitted        可选
t_stop_requested
t_recovery_started
t_recovered              可选
t_cleanup_finished       可选
```

## 时间窗口

| 窗口 | 默认范围 | 用途 |
| --- | --- | --- |
| `baseline` | `t_active - 5m` 到 `t_active` | 故障前基线 |
| `active` | `t_active - 30s` 到 `t_recovery_started + 30s` | 故障传播和 Agent 观察 |
| `recovery` | `t_recovery_started - 30s` 到 `t_recovered + 5m` | 恢复验证 |
| `cleanup` | `t_cleanup_finished - 5m` 到结束 | 清理验证 |

场景 Contract 可以覆盖默认窗口。数据过期后不能离线复盘，Manifest 不能还原原始观测数据。

## 实时查询范围

| 数据类型 | 查询方式 | Manifest 保存内容 |
| --- | --- | --- |
| Run Event/控制面状态 | Fault Run、状态转换、owner、drain、release、cleanup | 事件类型、窗口和查询入口 |
| Metrics | Prometheus range query | PromQL、service、窗口和判断标准 |
| Logs | Loki 按服务、级别和窗口查询 | LogQL、service、窗口和脱敏规则 |
| Traces | Tempo 按 service、route、error、duration 查询 | TraceQL、service、业务路径和窗口 |
| 业务检查 | 商品、订单、库存、支付、通知等 read-only check | 检查类型、入口、预期判断和提交位置 |
| 资源检查 | Catalog、镜像、配置 revision、Redis marker、文件大小和锁诊断 | 检查定义、窗口和判断标准 |

`faultRunId`、`X-Trace-Id` 和数据库业务关联 ID 不自动等同于 OTel Trace ID，不能只保存自定义 trace ID 作为查询依据。

## Evaluator v0

Evaluator v0 可以在没有外部 Agent 的情况下运行，先生成 Operator 现场验证报告。Operator 选择 Fault Run 或 alert receipt 后显式触发验证；阶段 5 之后再把 `AgentSubmission` 作为可选输入，并可由合法提交自动排队。

Evaluator 读取：

- 可选的 AgentSubmission。
- 阶段 5 告警驱动模式下的告警接收记录；阶段 4 Operator 模式可只使用 Fault Run 和 Run Event。
- 当前 Prometheus/Loki/Tempo 和业务只读查询结果。
- Fault Run、Run Event 和审计事实。
- 可选的实际场景 remediation outcome；Fault Run 的 stop/release/cleanup 状态仍单独来自控制面。

Evaluator 不执行恢复、不调用 release/cleanup。告警从 `firing` 变为 `resolved` 是正常现象；评估不要求当前仍 firing。

Evaluator 状态至少包括：

```text
PENDING
RUNNING
COMPLETED
EVIDENCE_UNAVAILABLE
FAILED
```

如果告警接收记录缺失或 `alertRefs[]` 无法关联，返回 `UNMATCHED_ALERT` 或 `ALERT_RECEIPT_UNAVAILABLE`，不直接判定 RCA 错误。

## 验收

- 能生成 Query Manifest 和可复制查询配方。
- 在 retention 内可以重复查询同一时间窗口。
- 查询失败或数据过期标记 `evidence_unavailable`。
- `prepare succeeded` 不等于 `target_effect_observed`。
- 目标效果、证据、Operator 执行和业务恢复能分别表示。
- 阶段 5 接入 Agent 后，AgentSubmission 使用版本化 JSON Schema；Markdown 只用于展示。
