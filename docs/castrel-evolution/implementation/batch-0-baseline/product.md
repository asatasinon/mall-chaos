# 批次 0：运行基线与发布护栏产品规格

> 状态：产品规格 v1
> 对应路线阶段：阶段 0
> 依赖：当前可运行的 Castrel Chaos 环境
> 配套技术设计：[tech.md](./tech.md)
> 实施任务：[task-list.md](./task-list.md)

## 1. 产品目标

让 Operator 和维护者能够用同一套事实回答以下问题：

- 一次 Fault Run 实际做了什么；
- 目标效果、控制动作、恢复和清理分别是否完成；
- 失败发生在目标服务、控制面、Worker、恢复还是清理；
- 运行是否可以安全回退；
- 哪些场景适合成为后续 Agent RCA 的首个试点。

本批次是观测和发布护栏建设，不改变任何场景的故障效果。

## 2. 服务对象与问题

| 服务对象 | 当前问题 | 本批次价值 |
| --- | --- | --- |
| Operator | 运行记录只有粗粒度成功/失败，难以判断下一步 | 获得可诊断的时间线、失败分类和残留边界 |
| 维护者 | 不清楚不同场景的停止、恢复和清理差异 | 获得统一的基线表和回退检查项 |
| 发布负责人 | 无法证明新版本没有扩大风险 | 在上线前具备可比较的运行基线 |
| 后续 RCA 试点负责人 | 不知道哪个告警稳定、证据清晰 | 选择一个真实告警和实际 remediation 边界明确的场景 |

## 3. 产品范围

### 3.1 包含

- 覆盖当前 Catalog 中的 12 个场景。
- 记录 prepare、active、stop、recovery、cleanup 和 health check 时间线。
- 记录请求数、成功数、失败数、超时数、恢复时长和残留资源。
- 区分目标效果失败、控制面失败、Worker 失败、恢复失败和清理失败。
- 记录部署模式、镜像版本、Catalog revision、数据预热配置和观测 retention。
- 核对 Alertmanager 当前 webhook 接收端点、`send_resolved`、pilot alert 和外部 receiver 前置条件。
- 为阶段 5 选择候选场景，并记录不选择其他场景的原因。

### 3.2 不包含

- 不修改故障注入效果、业务接口或目标服务行为。
- 不引入 Agent、Evaluator、自动 remediation 或自动恢复。
- 不保存 Prometheus、Loki、Tempo 的现场数据快照。
- 不承诺告警一定 firing，也不把一次运行成功写成业务恢复必然成功。
- 不做多环境、多 Trial 或并行运行能力。

## 4. 关键用户流程

```text
Operator 选择场景
  -> 运行前检查
  -> 执行一次 Fault Run
  -> 查看 prepare/active/stop/recovery/cleanup 时间线
  -> 查看失败分类和残留资源
  -> 按回退手册处理
  -> 记录该场景是否适合作为 Agent RCA pilot
```

每次运行都必须能区分：

1. 控制动作是否完成；
2. 目标效果是否观察到；
3. 业务是否恢复；
4. 资源是否清理；
5. 证据是否仍可查询。

## 5. 产品行为与输出

基线记录至少包含：

```text
scenario
targetService / targetOperation
catalogRevision / imageRevision / schemaVersion
deploymentMode / dataWarmupEnabled / warmupConfig
prepareStartedAt / activeAt / stopRequestedAt / recoveredAt / cleanupFinishedAt
requests / successes / failures / timeouts
workerDrain / release / cleanup / healthCheck
alertName / alertSeverity / alertStartsAt / alertResolvedAt / alertReceiptStatus
knownLimitations / residualResources / rollbackProcedure
```

`release`、`cleanup` 和 `recovery` 必须服从 Catalog 的 `recoveryStrategy`。`MANUAL_CLEANUP` 不得被记录成自动清理成功，`NON_RELEASING` 必须明确记录保留效果和残留资源边界。

## 6. 产品验收

- 12 个场景均有一份可复查的运行基线。
- 每份基线都能定位运行的关键时间窗口和失败类别。
- Operator 可以根据记录判断是继续等待、执行回退、人工清理还是停止后续动作。
- 配置文件中的 Alertmanager webhook URL 不会被误认为接收能力已实现。
- 至少确定一个真实告警稳定、证据清晰、remediation 边界明确的阶段 5 pilot。
- 基线采集旁路运行时行为，不改变场景结果。

## 7. 成功指标与退出条件

- 12/12 场景完成基线。
- 失败分类不再只落为笼统的 `FAILED`。
- 每个场景都有明确的残留资源和回退说明。
- 阶段 5 pilot 的告警、观测 retention 和接收链路前置条件已确认。

满足退出条件后，进入批次 1；不要求在本批次实现任何新的自动控制能力。
