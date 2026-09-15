# 批次 5.0：Alertmanager 告警接收产品规格

> 状态：产品规格 v1
> 对应路线阶段：阶段 5.0
> 依赖：批次 4
> 配套技术设计：[tech.md](./tech.md)
> 下一步：控制面 webhook 接收任务

## 1. 产品目标

把 Alertmanager 的 firing/resolved 通知变成控制面可审计、可去重、可关联的告警接收事实。单个告警实例生成一个 `alertRef`；同一实际问题产生的多个告警通过控制面内部的 `incidentRef` 聚合，为后续 Agent RCA 提供完整告警集合。

本批次只处理告警接收和关联，不实现外部 Agent 投递，不执行 Fault Run 控制动作，也不保存指标、日志或 Trace。

## 2. 服务对象与问题

| 服务对象 | 当前问题 | 本批次价值 |
| --- | --- | --- |
| Operator | 无法确认控制面是否真正收到告警 | 能查看接收时间、fingerprint、生命周期和处理结果 |
| Evaluator | 缺少告警来源事实 | 可判断 Agent 分析对应哪一次告警 |
| 控制面维护者 | webhook 重试可能制造重复事件 | 具备幂等、分组拆分和关联失败语义 |

## 3. 产品范围

### 3.1 包含

- 实现并验证 Alertmanager 到控制面的内部 webhook 接收端点。
- 记录最小告警 envelope、fingerprint、接收时间、状态和来源。
- 处理 firing、resolved、grouped alerts 和 Alertmanager 重试。
- 用 fingerprint 和稳定字段去重。
- 为每个告警实例形成/确认 opaque `alertRef`，并为可确认属于同一问题的多个告警维护 `incidentRef`。
- 明确区分 Alertmanager `groupKey`、单告警 `alertRef` 和问题聚合 `incidentRef`；`groupKey` 只是通知分组，不等于根因事件。
- 支持 `faultRunCorrelationStatus` 的 `UNMATCHED` 和 `AMBIGUOUS`。
- 让后续 Evaluator 可以读取告警接收记录。

### 3.2 不包含

- 不把“Fault Run 已开启”当作告警一定 firing。
- 不保存 Prometheus/Loki/Tempo 原始数据。
- 不执行 stop、release、cleanup、恢复或 remediation。
- 不在本批次把所有默认告警发送给外部 Agent。
- 不新增 Observation Gateway、Alert Delivery Gateway、mTLS 或应用层细粒度授权。

## 4. 关键用户流程

```text
Alertmanager 发送 firing/resolved webhook
  -> 控制面校验并保存最小接收记录
  -> 按 fingerprint 幂等处理
  -> 拆分 grouped alerts
  -> 每个告警实例生成 alertRef
  -> 按关联规则把多个 alertRef 聚合为 incidentRef
  -> 可选关联 active Fault Run，记录 faultRunCorrelationStatus
  -> 后续 Operator/Evaluator 查询接收事实
```

`resolved` 只表示告警生命周期变化，不会自动使已经收到的告警或后续评估失效。

## 5. 产品行为

告警接收记录至少包括：

```text
alertRef
incidentRef
fingerprint
status
alertName
service
severity
startsAt
receivedAt
resolvedAt
matchedFaultRunRef
correlationStatus
deduplicationStatus
faultRunCorrelationStatus
matchedFaultRunRef
```

语义约束：

- 一个 `alertRef` 只对应一个 `fingerprint + startsAt` 告警实例。
- 一个 `incidentRef` 可以包含多个 `alertRef`，但只有满足明确关联条件时才聚合。
- Alertmanager `groupKey` 只记录原始通知分组，不能直接当作 `incidentRef`。
- 第一个告警可以创建 `incidentRef`，后续在关联窗口内到达的相关告警可以加入该 incident；不能因为 Agent 先收到一个告警就认定问题只有一个告警。
- 在 Alertmanager 直接投递模式下，是否发送由 Alertmanager 的 pilot child route 决定；控制面产生的 `UNMATCHED_ALERT`/`AMBIGUOUS_ALERT` 不会追回或阻断已经配置的外部投递，只影响评估报告是否具备确定的 Fault Run 上下文。
- `faultRunCorrelationStatus` 只是控制面内部上下文，允许为 `NOT_REQUIRED`、`MATCHED`、`UNMATCHED` 或 `AMBIGUOUS`；它不决定告警是否发送给 Agent。
- 控制面内部可以保存 Fault Run 和 incident 关联；向外部 Agent 暴露的只能是告警引用集合，不暴露 `faultRunId`、数据库 ID、Operator session 或控制语义。

## 6. 产品验收

- 当前配置指向的 webhook 接收端点真实存在，并能通过代码或集成测试确认。
- Alertmanager 重试不会产生重复告警接收记录、重复 `alertRef` 或重复 `incidentRef`。
- grouped alert 可以逐条处理并保留原始分组关联。
- 一个问题产生多个告警时，多个 `alertRef` 可以关联到同一个 `incidentRef`。
- firing、resolved、未匹配和多重匹配均有可查询状态。
- 未匹配或多重匹配的告警仍能保留接收事实，并记录 `faultRunCorrelationStatus=UNMATCHED` 或 `AMBIGUOUS`，而不是伪装成投递失败。
- 控制面 webhook 不承担观测数据存储和 Fault Run 控制职责。
- 告警接收记录可以被后续 Evidence Query 和 Evaluator 读取。

## 7. 成功指标与退出条件

- pilot alert 的 firing、retry、resolved 和 grouped 路径均有测试。
- 告警关联失败不会静默丢弃，也不会错误绑定到任意运行。
- `alertRef` 可作为单个告警实例的外部关联键，`alertRefs[]` 和内部 `incidentRef` 可共同关联一次 RCA。
- 内部告警接收链路与外部 Agent 投递链路职责清晰分离。

满足退出条件后，进入批次 5.1。
