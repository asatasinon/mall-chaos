# 阶段 0：基线和发布护栏

> 状态：当前优先级最高

## 目标

在修改运行时之前，先知道当前系统真实行为，并具备发现、停止和回退能力。

## 范围

- 为 12 个场景记录 prepare、active、stop、release、cleanup 基线。
- 记录请求数、成功数、失败数、超时数、恢复时长和残留资源。
- 统一 Worker、Coordinator、Gateway 和目标服务关键事件。
- 建立失败分类：目标效果失败、控制面失败、Worker 失败、恢复失败、清理失败。
- 建立开发、full 演练和 benchmark 环境资源预算。
- 明确数据预热、SkyWalking、重观测组件和危险场景为显式能力。

## 交付物

- 场景运行基线表。
- 发布检查清单和回退手册。
- 关键事件与低基数指标命名约定。
- 场景运行前后 smoke 检查。

基线表至少包含：

```text
scenario
targetService / targetOperation
catalogRevision / imageRevision / schemaVersion
environmentProfile / dataProfile
prepareStartedAt / activeAt / stopRequestedAt / recoveredAt / cleanupFinishedAt
requests / successes / failures / timeouts
workerDrain / release / cleanup / healthCheck
alertName / alertSeverity / alertStartsAt / alertResolvedAt / alertReceiptStatus
knownLimitations / residualResources / rollbackProcedure
```
- 阶段 5 候选告警基线：每个候选场景的 alert name、service、severity、阈值、startsAt/receivedAt/resolvedAt、submission window 和是否能关联 Fault Run。
- 告警接入基线：确认 Alertmanager 当前 webhook 路由、`send_resolved`、认证和控制面接收端点真实存在；配置文件中的 webhook URL 不能视为接收能力已经实现。

## 验收

- 每个场景都能回答如何启动、停止、确认恢复和处理残留。
- 失败不会只显示笼统的 `FAILED`。
- 能通过 Run Event、业务日志、指标和时间窗口关联一次运行。
- 基线能力不改变场景行为。
- 至少选出一个告警可稳定触发、证据窗口清晰、恢复边界明确的阶段 5 候选场景；不要求所有 12 个场景都具备 Agent RCA 告警。
- 明确当前 Alertmanager webhook 的可用性、缺失实现、认证方式和需要在阶段 5 补齐的组件。

## 上线与回退

- 旁路采集、只读页面、不开启新控制逻辑。
- 回退旁路采集或 Web/Worker 镜像，不需要回滚业务数据。
