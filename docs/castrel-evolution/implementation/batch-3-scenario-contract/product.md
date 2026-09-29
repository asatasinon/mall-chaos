# 批次 3：Scenario Contract 产品规格

> 状态：产品规格 v1.5，按 2026-09-28 复审决议及 P3-01 告警关联窗口/Evidence 模板决议对齐
> 对应路线阶段：阶段 3
> 依赖：批次 2
> 技术设计：[tech.md](./tech.md)
> 实施进度：[task-list.md](./task-list.md)
> 下一步：按任务清单实施 Catalog Contract supplement、Evidence/Alert 互操作校验与 Contract validator

## 1. 产品目标

让一个场景不能只在 Catalog 中声明，却没有对应的 Gateway target、Worker dispatch、恢复边界、Evidence Query、runbook、i18n 或告警合同。

本批次的用户主要是维护者和发布流水线，不向消费者暴露新的业务协议。

## 2. 服务对象与问题

| 服务对象 | 当前问题 | 本批次价值 |
| --- | --- | --- |
| 场景维护者 | 改了 Catalog 后容易遗漏 Worker、Gateway 或 runbook | 在提交和 CI 阶段提前发现漂移 |
| 发布负责人 | 无法确认场景是否具备完整停止和证据链 | 获得可阻断发布的合同校验 |
| Operator | 文案和实际行为可能不一致 | 获得与当前运行事实一致的场景说明 |

## 3. 产品范围

### 3.1 包含

Contract 至少覆盖：

- Catalog revision、目标服务和固定 operation。
- 参数 schema、duration、资源预算和边界校验。
- prepare、active、stop、release、cleanup 和 verification。
- 与 `recoveryStrategy` 匹配的生命周期 hook。
- Evidence Query、时间窗口和判断规则。
- Evidence template 是有限的 typed DSL；支付失败率、支付超时率与节点 `/data` 文件系统增长只通过绑定既有 Prometheus metrics 的固定模板表达，不接受任意 query text 或新增业务端点。
- runbook、i18n、可见错误和告警合同。
- Batch 5.0 全局 Alert receipt policy 引用、fingerprint 去重、重复通知、resolved 和关联失败处理；不重复定义 receipt 生命周期。
- 适用于各场景的资源预算、目标侧容量 guard 和显式预算例外。

本批次按当前 clean-slate 部署工作：部署平台/运维流程负责停写入者、清空 MySQL/Redis/场景持久化资源并保存执行记录，再使用 fresh schema；本仓库不新增全量 wipe 脚本。现有 `scripts/mysql-reset.sh` 只重置 MySQL，不足以单独满足此策略。本批次不提供旧数据库升级或旧 Run 兼容；转入保留历史数据的部署前，必须另行评审 schema migration、Run snapshot 和 retention 策略。

### 3.2 不包含

- 不让业务服务接收 Catalog identity、Fault Run 生命周期或控制面 display name。
- 不改变目标服务的业务接口。
- 不引入多 Trial、环境隔离或新的评分系统。
- 不保证场景开启后一定产生 firing alert。

## 4. 关键用户流程

```text
维护者修改 Catalog
  -> Contract validation 检查所有映射和生命周期 hook
  -> CI 展示缺失项和冲突项
  -> 修复后生成 Contract revision
  -> 发布时记录 revision
  -> Operator 按同一合同查看运行和告警边界
```

校验失败必须阻断进入下一阶段或发布，不允许通过静默默认值补齐缺失能力。

## 5. 产品行为

对不同恢复策略采用不同要求：

| `recoveryStrategy` | 产品要求 |
| --- | --- |
| `TARGET` | 必须声明 target release 和 recovery 检查。 |
| `WORKER` | 必须声明适用的受控 stop/drain 和 recovery 检查；本地 Worker 场景可将 target release 声明为 `NOT_APPLICABLE`。 |
| `MANUAL_CLEANUP` | 必须声明人工清理触发条件、责任边界和完成确认 |
| `NON_RELEASING` | 必须声明不释放的原因、残留效果和停止后的验证方式 |

资源预算的已确认边界：

- `BROWSE_SURGE` 与 `ORDER_QUERY_SURGE` 的每 Run `concurrency` 上限为 `128`。
- 该上限同时由 Catalog/API admission 与 Worker execution enforce；Worker 对 persisted 参数二次校验。超限或非法值必须 fail closed，不 clamp，不创建 worker/session，也不发 Gateway 请求。
- `NOTIFICATION_STORAGE_APPEND.totalBytes` 保持为可配置目标，不设静态绝对上限；真实写入继续受目标服务 filesystem usable-space guard 约束，`minFreeBytes` 范围为 `1 MiB`–`1 GiB`。
- `NOTIFICATION_HEAP_PRESSURE` 不设每 Run 累计 heap cap；虽保留单次分配、请求间隔和 duration 参数边界，仍接受 OOM/服务重启可能，作为明确的 non-releasing 预算例外，仅在 disposable 环境演练。
- Web/API 通过 `SCENARIO_CONTRACT_DEPLOYMENT_SCOPE=disposable|retained` 明确环境范围，缺失默认为 `retained`；heap pressure 新 Run 在任何 validation mode 下仅 `disposable` 可创建。
- 合同校验 budget/guard 的声明与实际 Catalog/目标服务行为一致，不承诺一定达到 storage target 或消耗全部预算。

Contract validation 至少输出：

```text
missingTarget
missingDispatch
invalidParameters
invalidRecoveryHook
missingEvidenceQuery
missingRunbook
missingI18n
invalidAlertContract
```

`NOT_EXPECTED` 表示不要求场景专属告警或 Fault Run 关联（`faultRunCorrelation=not_required`），不关闭平台通用 Alertmanager receipt 接收；所有场景引用 Batch 5.0 的全局 `alert-receipt.v1` policy。内部 `sendResolvedToControlPlane` 与外部 Agent receiver 的 readiness/`send_resolved` 属于不同配置事实。Phase 3 不定义 RCA submission 或 Evaluator close/expiry rules：提交拒绝语义归 Batch 5.1，评估关闭归 Batch 5.2。

V1 所有允许告警采用统一关联时序：15 分钟 correlation window、Run active 前 15 分钟 grace、Run 结束后 15 分钟 recent grace。具体字段随 Catalog Alert Contract 提供给 Batch 5.0，不能由接收端另设不同默认值。

新 Run 准入拒绝使用具名错误和固定安全 Operator 响应：`SCENARIO_CONTRACT_INVALID` 返回 HTTP/envelope 503，`SCENARIO_CONTRACT_DEPLOYMENT_SCOPE_RESTRICTED` 返回 409。不得回显原始 validator details 或 stack；拒绝不得持久化 Run/action 或调用 prepare。

## 6. 产品验收

- 当前 12 个场景全部通过 Contract validation。
- Catalog 与 Gateway target map、Worker dispatch 和 recovery strategy 不漂移。
- 新场景缺少适用的生命周期 hook、证据定义或告警合同时 CI 失败。
- Contract 报告区分 `VALID`、`BLOCKED`、`LIMITED`；`LIMITED` 不能被报告为完整 live/canary 验收或作为 release gate 的 `VALID`。
- Contract revision 可在 Run Event 和后续 Evidence Query 中追踪。
- 保留 global 64-hex `catalogRevision` 并使其 canonical input 包含 Contract supplement；每个新 Run 另写完整 `ResolvedScenarioContract` 的 `sc.v1:sha256:` `contractRevision`。Batch 4 原样引用 `contractRevision`，另用 `contractHash` 校验 Evidence snapshot。哈希参数按名称排序，UI 展示顺序不影响 revision。
- Operator 事件时间线通过受控 `CREATED` event 投影显示经验证的 revision。
- 消费者和业务服务的公开响应不出现控制面内部字段。

## 7. 成功指标与退出条件

- 12/12 场景通过阻断式合同检查。
- 至少覆盖一次参数缺失、目标映射缺失、Worker dispatch 缺失和告警合同缺失的失败测试。
- 合同校验在运行时行为之外提供早期失败反馈。
- 阶段 4 可以只依赖合同生成的查询定义，不再手工猜测场景边界。
- 外部 CI 执行仓库根级 Contract gate 并将其设为阻断检查；本仓库不新增 GitHub Actions workflow。
- runtime `warn/enforce` 只覆盖当前进程内合同和新 Run admission，不声称验证跨服务映射；enforce canary 仅在可丢弃单 Worker 环境、Reconciliation mode `OFF` 下执行。
- 精确同部署幂等 replay 先返回既有 Run，跳过新 Run `warn/enforce` Contract admission；不同 scenario/normalized-parameter signature 冲突，不支持跨部署 replay。

满足退出条件后，进入批次 4。
