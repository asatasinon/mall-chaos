# 阶段 3：Scenario Contract

> 状态：技术设计 v1 已完成，待实施评审；依赖阶段 0～2<br>
> 技术设计：[implementation/batch-3-scenario-contract/tech.md](../../implementation/batch-3-scenario-contract/tech.md)

## 目标

减少 Catalog、Gateway、Worker、目标服务、runbook 和测试之间的隐式漂移。

## Contract 内容

```text
scenario
  - catalog revision
  - target service / operation
  - parameter schema
  - duration and resource budget
  - prepare / active / stop / release / cleanup
  - expected evidence
  - alert contract
  - alert receipt retention and evaluation closure policy
  - recovery checks
  - side-effect checks
```

Contract 属于控制面和测试生成层，不原样暴露给业务服务。

## 实施顺序

### 只读校验

- Catalog 与 Gateway target map 一致。
- Catalog 与 `fault-run-targets.ts` 等控制面 target/dispatch 辅助映射一致。
- Worker dispatch 覆盖需要 Worker 的场景。
- `recoveryStrategy` 与对应生命周期 hook 存在；`TARGET`/`WORKER` 需要 release，`MANUAL_CLEANUP` 需要清晰的人工清理合同，`NON_RELEASING` 不得伪造 release。
- 参数、时长、runbook、Evidence Query 和 i18n 完整。
- 需要告警驱动的场景必须声明允许的 alert name、service、severity、关联窗口和告警缺失处理方式。
- 告警合同必须声明告警接收记录保留、评估关闭条件、fingerprint 去重、重复通知和 resolved 通知处理。
- v0 不设置时间驱动的评估过期；告警接收记录至少保留到关联 Fault Run 的 retention 结束，评估只有在显式关闭或完成明确的终态流程后才关闭。
- v0 不设置固定的 Agent RCA 提交窗口；只有显式关闭、告警引用无效或告警集合互相冲突时才拒绝提交；Fault Run 暂时无法唯一关联时记录 `faultRunCorrelationStatus=UNMATCHED/AMBIGUOUS`，不阻止基于告警和观测证据的 RCA 评估，观测 retention 只决定能否完成证据复查。
- 告警合同必须声明阶段 5 的专用 Alertmanager child route、外部 receiver、Basic Auth 凭据来源和 `send_resolved` 规则；不得复用默认全量 receiver。

### 辅助生成

- 合同测试骨架。
- 控制台表单元数据。
- runbook checklist。
- smoke test 清单。
- 术语隔离检查输入。

第一版不自动生成生产代码，也不删除现有人工映射。

## 验收

- 12 个场景全部通过 contract validation。
- 新场景缺少适用于自身 `recoveryStrategy` 的生命周期 hook、清理边界或证据定义时 CI 失败。
- Contract revision 可在 Run Event 中追踪。
- 业务服务仍只接收通用内部协议。
- 告警合同不能把“场景已开启”写成“告警一定 firing”；必须区分 alert receipt、effect observed 和 evidence unavailable。

## 发布

先作为 CI blocking、运行时 warning；历史场景全部通过后，才提升关键校验为发布阻断。
