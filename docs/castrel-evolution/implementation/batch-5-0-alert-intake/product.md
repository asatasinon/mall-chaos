# 批次 5.0：Alertmanager 告警接收产品规格

> 状态：产品规格 v1
> 对应路线阶段：阶段 5.0
> 依赖：批次 4
> 下一步：技术设计和控制面 webhook 接收任务

## 1. 产品目标

把 Alertmanager 的 firing/resolved 通知变成控制面可审计、可去重、可关联的告警接收事实，为后续 Agent RCA 提供可靠的 `alertRef`。

本批次只处理告警接收和关联，不向 Agent 投递，不执行 Fault Run 控制动作，也不保存指标、日志或 Trace。

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
- 为关联到 active Fault Run 的告警生成 opaque `alertRef`。
- 支持 `UNMATCHED_ALERT` 和 `AMBIGUOUS_ALERT`。
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
  -> 关联 active Fault Run
  -> 生成 alertRef 或记录 UNMATCHED/AMBIGUOUS
  -> 后续 Operator/Evaluator 查询接收事实
```

`resolved` 只表示告警生命周期变化，不会自动使已经收到的告警或后续评估失效。

## 5. 产品行为

告警接收记录至少包括：

```text
alertRef
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
```

控制面内部可以保存 Fault Run 关联，但向外部 Agent 暴露的只有 opaque `alertRef`，不暴露 `faultRunId`、数据库 ID、Operator session 或控制语义。

## 6. 产品验收

- 当前配置指向的 webhook 接收端点真实存在，并能通过代码或集成测试确认。
- Alertmanager 重试不会产生重复告警接收记录或重复 `alertRef`。
- grouped alert 可以逐条处理并保留原始分组关联。
- firing、resolved、未匹配和多重匹配均有可查询状态。
- 控制面 webhook 不承担观测数据存储和 Fault Run 控制职责。
- 告警接收记录可以被后续 Evidence Query 和 Evaluator 读取。

## 7. 成功指标与退出条件

- pilot alert 的 firing、retry、resolved 和 grouped 路径均有测试。
- 告警关联失败不会静默丢弃，也不会错误绑定到任意运行。
- `alertRef` 可作为后续 Agent 投递和 AgentSubmission 的唯一外部关联键。
- 内部告警接收链路与外部 Agent 投递链路职责清晰分离。

满足退出条件后，进入批次 5.1。
