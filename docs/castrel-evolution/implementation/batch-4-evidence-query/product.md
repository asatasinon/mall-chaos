# 批次 4：实时 Evidence Query 产品规格

> 状态：产品规格 v1
> 对应路线阶段：阶段 4
> 依赖：批次 3
> 配套技术设计：[tech.md](./tech.md)
> 下一步：完成批次 0～3 门禁后实施 Manifest 与 Operator 查询报告

## 1. 产品目标

让 Operator 能够基于一次运行的时间线和查询协议，重复检查指标、日志、Trace 和业务结果，而不是依赖手工截图或保存一份可能过期的现场快照。

本批次先提供 Operator 现场验证报告，不能把 AgentRcaReport 作为前置依赖。

## 2. 服务对象与问题

| 服务对象 | 当前问题 | 本批次价值 |
| --- | --- | --- |
| Operator | 运行结束后难以复现当时的证据查询 | 获得带窗口和查询配方的报告 |
| RCA 调查者 | 指标、日志和 Trace 的时间范围不一致 | 使用同一套 baseline/active/recovery/cleanup 窗口 |
| 后续 Evaluator | 没有统一的证据输入边界 | 可在相同协议上重新查询，而不是读取人为整理的结论 |

## 3. 产品范围

### 3.1 包含

- 保存 Run Event 时间线和查询窗口。
- 支持 PromQL、LogQL、TraceQL 和受控业务检查配方。
- 支持 baseline、active、recovery、cleanup 四类窗口。
- 展示查询结果摘要、判断规则、查询时间和证据状态。
- 查询失败、超时或 retention 不足时返回 `evidence_unavailable`。
- 支持没有 AgentRcaReport 的 Operator-only 验证。

### 3.2 不包含

- 不保存 Prometheus 指标结果、Loki 日志、Tempo Trace、数据库/Redis volume、JVM heap 或文件快照。
- 不把证据过期判定为 RCA 错误。
- 不提供离线 replay 或历史数据搬运。
- 不执行 Fault Run stop、release、cleanup 或业务 remediation。
- 不要求阶段 5 的 Agent 才能生成第一版报告。

## 4. 关键用户流程

```text
Operator 选择 Fault Run 或告警接收记录
  -> 系统读取 Run Event 和 Contract revision
  -> 生成 baseline/active/recovery/cleanup 查询窗口
  -> 执行只读观测查询和业务检查
  -> 应用预先声明的判断规则
  -> 输出 evidence status、结果摘要和限制
  -> Operator 补充分析笔记或进入后续评估
```

## 5. 产品行为

Evidence 状态至少区分：

| 状态 | 含义 |
| --- | --- |
| `AVAILABLE` | 关键查询已返回，可复查 |
| `PARTIAL` | 部分查询可用，部分查询失败或缺数据 |
| `EVIDENCE_UNAVAILABLE` | 查询超时、数据 retention 已过或观测入口不可用 |
| `INVALID_QUERY` | 查询配方或窗口不符合 Contract |

观测数据 retention 只决定能否复查证据，不决定 AgentRcaReport 是否还能提交，也不因为数据过期自动关闭评估。

## 6. 产品验收

- Operator 可以从一次 Run Event 生成完整的查询窗口。
- 同一窗口和查询配方可重复执行，结果带有明确查询时间。
- 查询失败和 retention 不足不会伪装成“没有故障”或“RCA 错误”。
- 报告能区分控制动作、效果观察、业务恢复和证据可用性。
- Evidence Query 全部为只读操作，不修改业务状态。

## 7. 成功指标与退出条件

- 选定 pilot 场景能够在 retention 内重复得到关键指标、日志、Trace 和业务检查结果。
- 至少覆盖查询成功、部分失败、超时和 retention 不足。
- Operator 不依赖 AgentRcaReport 就能完成一次现场验证。
- Evidence Query Manifest 的 revision 可随运行和 Contract revision 追踪。

满足退出条件后，进入批次 5.0。
