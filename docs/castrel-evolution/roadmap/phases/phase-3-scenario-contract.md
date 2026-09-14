# 阶段 3：Scenario Contract

> 状态：当前优先级；依赖阶段 0～2

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
  - submission window policy
  - recovery checks
  - side-effect checks
  - isolation requirements
```

Contract 属于控制面和测试生成层，不原样暴露给业务服务。

## 实施顺序

### 只读校验

- Catalog 与 Gateway target map 一致。
- Catalog 与 `fault-run-targets.ts` 等控制面 target/dispatch 辅助映射一致。
- Worker dispatch 覆盖需要 Worker 的场景。
- recovery strategy 与 release/cleanup 实现存在。
- 参数、时长、runbook、Evidence Query 和 i18n 完整。
- 需要告警驱动的场景必须声明允许的 alert name、service、severity、关联窗口和告警缺失处理方式。
- 告警合同必须声明 RCA submission window：默认 15 分钟，允许按场景在 5～30 分钟内配置。
- 告警合同必须声明 fingerprint 去重、重复通知、resolved 通知和过期提交处理。

### 辅助生成

- 合同测试骨架。
- 控制台表单元数据。
- runbook checklist。
- smoke test 清单。
- 术语隔离检查输入。

第一版不自动生成生产代码，也不删除现有人工映射。

## 验收

- 12 个场景全部通过 contract validation。
- 新场景缺少 Gateway、Worker、release、cleanup 或证据定义时 CI 失败。
- Contract revision 可在 Run Event 中追踪。
- 业务服务仍只接收通用内部协议。
- 告警合同不能把“场景已开启”写成“告警一定 firing”；必须区分 alert receipt、effect observed 和 evidence unavailable。

## 发布

先作为 CI blocking、运行时 warning；历史场景全部通过后，才提升关键校验为发布阻断。
