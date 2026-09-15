# 批次 3：Scenario Contract 产品规格

> 状态：产品规格 v1
> 对应路线阶段：阶段 3
> 依赖：批次 2
> 下一步：技术设计和 Contract validation 任务

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
- runbook、i18n、可见错误和告警合同。
- Alert receipt、fingerprint 去重、重复通知、resolved 和关联失败处理。

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
| `TARGET` / `WORKER` | 必须声明可验证的 release 和 recovery 检查 |
| `MANUAL_CLEANUP` | 必须声明人工清理触发条件、责任边界和完成确认 |
| `NON_RELEASING` | 必须声明不释放的原因、残留效果和停止后的验证方式 |

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

## 6. 产品验收

- 当前 12 个场景全部通过 Contract validation。
- Catalog 与 Gateway target map、Worker dispatch 和 recovery strategy 不漂移。
- 新场景缺少适用的生命周期 hook、证据定义或告警合同时 CI 失败。
- Contract revision 可在 Run Event 和后续 Evidence Query 中追踪。
- 消费者和业务服务的公开响应不出现控制面内部字段。

## 7. 成功指标与退出条件

- 12/12 场景通过阻断式合同检查。
- 至少覆盖一次参数缺失、目标映射缺失、Worker dispatch 缺失和告警合同缺失的失败测试。
- 合同校验在运行时行为之外提供早期失败反馈。
- 阶段 4 可以只依赖合同生成的查询定义，不再手工猜测场景边界。

满足退出条件后，进入批次 4。
