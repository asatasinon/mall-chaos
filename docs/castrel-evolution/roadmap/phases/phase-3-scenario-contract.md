# 阶段 3：Scenario Contract

> 状态：P3-00R 用户决策及复审决议已同步；Contract 实施待开始<br>
> 技术设计：[implementation/batch-3-scenario-contract/tech.md](../../implementation/batch-3-scenario-contract/tech.md)
> 实施任务：[implementation/batch-3-scenario-contract/task-list.md](../../implementation/batch-3-scenario-contract/task-list.md)

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
  - shared Batch 5.0 alert receipt policy reference and external Agent delivery readiness
  - recovery checks
  - side-effect checks
```

Contract 属于控制面和测试生成层，不原样暴露给业务服务。

`targetPrepare` / `recoveryPolicy` 是执行策略事实来源；Contract 从中派生适用的 release/drain。local Worker 可无 Gateway target release，但必须定义 stop/drain 与验证。资源预算可声明硬参数上限或受控的目标容量 guard；storage target 不承诺一定达到物理写入量。

已确认预算边界：两个 surge 场景的每 Run `concurrency.max=128`；`NOTIFICATION_STORAGE_APPEND.totalBytes` 无静态绝对上限，依赖目标 filesystem usable-space guard；`minFreeBytes` 范围为 `1 MiB`–`1 GiB`，Catalog 与目标服务须一致。`NOTIFICATION_HEAP_PRESSURE` 不设累计保留上限，必须作为 OOM/服务重启可能的 non-releasing 例外，只在 disposable 环境演练。

## 实施顺序

### 只读校验

- Catalog 与 Gateway target map 一致。
- Catalog 与 `fault-run-targets.ts` 等控制面 target/dispatch 辅助映射一致。
- Worker dispatch 覆盖需要 Worker 的场景。
- `recoveryStrategy` 与对应生命周期 hook 存在；`TARGET` 需要适用的 target release；`WORKER` 需要 Worker stop/drain，有 Gateway prepare 时按 Catalog policy release，local Worker 的 target release 可为 `NOT_APPLICABLE`；`MANUAL_CLEANUP` 需要清晰的人工清理合同；`NON_RELEASING` 不得伪造 release。
- 参数、时长、runbook、Evidence Query 和 i18n 完整。
- 需要告警驱动的场景必须声明允许的 alert name、service、severity、关联窗口和告警缺失处理方式。
- 场景合同引用 Batch 5.0 全局 receipt policy `alert-receipt.v1`，不重复定义 retention 和 webhook 状态机；实例按规范化 `(fingerprint, startsAt UTC millisecond)` 幂等 upsert，重复 firing/resolved 更新同一 receipt。receipt retention 由 `ALERT_RECEIPT_RETENTION_DAYS` 控制且不得短于 Fault Run retention。
- Phase 3 只定义 receipt/correlation 输入；Agent RCA report 的提交时效/拒绝条件由 [Batch 5.1](../../implementation/batch-5-1-agent-rca-submission/product.md) 负责，评估关闭/重试/放弃策略由 [Batch 5.2](../../implementation/batch-5-2-evaluator/product.md) 负责。
- 只有外部 Agent delivery readiness 明确为 `ENABLED` 时，才要求专用 Alertmanager child route、外部 receiver、Basic Auth 凭据来源和 `send_resolved` 规则；不能把内部 control-plane intake 当作 Agent receiver。
- Alert Contract 将 control-plane receipt/correlation 与外部 Agent delivery readiness 分开；`NOT_EXPECTED` 不做 Fault Run correlation，但平台通用 receipt 仍保留并标记为 `NOT_REQUIRED`。

### 辅助生成

- 合同测试骨架。
- 控制台表单元数据。
- runbook checklist。
- smoke test 清单。
- 术语隔离检查输入。

第一版不自动生成生产代码，也不删除现有人工映射。

Evidence Contract 使用受限的 template/scope/predicate/projection 与 run-relative 窗口；完整 Evidence snapshot 由阶段 4 在 capture flag 启用时冻结。本阶段仅记录 `catalogRevision` 和 per-run `contractRevision`。

## 验收

- 12 个场景全部通过结构化 Contract 与跨层发布 gate；告警 firing、live evidence 和业务恢复仍须独立以实际证据判断。
- 新场景缺少适用于自身 `recoveryStrategy` 的生命周期 hook、清理边界或证据定义时 CI 失败。
- Contract revision 可在 Run Event 中追踪。
- 业务服务仍只接收通用内部协议。
- 告警合同不能把“场景已开启”写成“告警一定 firing”；必须区分 alert receipt、effect observed 和 evidence unavailable。

## 发布

通过外部 CI 的根级 Contract gate（本仓库提供脚本，不新增 GitHub Actions workflow）；运行时 `warn` 仅检查当前 Web/API 进程内合同，`enforce` 仅 gate 新 Run admission；Web-only bootstrap 解析 mode/scope，Worker 不读取该变量。`SCENARIO_CONTRACT_DEPLOYMENT_SCOPE` 缺省 `retained`；heap-pressure 新 Run 在任何 validation mode 下仅 `disposable` scope 可建。跨 Gateway/目标服务一致性由 CI 与目标 Controller 测试证明。

Contract enforce canary 限定于单 Worker、可丢弃数据库和业务资源、`FAULT_RUN_RECONCILIATION_MODE=OFF` 的环境；完整 reset 是部署平台/运维流程的显式前置条件，必须停止 writers、清除 DB、Redis 和场景持久化资源，并保留可审计完成记录。本仓库不提供全量 wipe 工具；`mysql-reset.sh` 单独不满足该前置条件。不做旧 Run 迁移或 pre-reset Run gate。该 canary 不验证、不替代阶段 2 的多 Worker/TAKEOVER 退出。
