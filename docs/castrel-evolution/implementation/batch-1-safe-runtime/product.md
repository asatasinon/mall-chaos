# 批次 1：Fault Run 安全停止产品规格

> 状态：产品规格 v1
> 对应路线阶段：阶段 1
> 依赖：批次 0
> 配套技术设计：[tech.md](./tech.md)
> 下一步：技术设计评审和 Worker drain/超时测试

## 1. 产品目标

让 Operator 能够停止一个 Fault Run，而不会误停正常客户流量、数据预热、补给或其他独立运行。停止过程必须可观察、有总超时，并明确说明恢复和清理是否完成。

## 2. 服务对象与问题

| 服务对象 | 当前问题 | 本批次价值 |
| --- | --- | --- |
| Operator | 点击停止后不知道 Worker 是否仍在发请求 | 能看到停止请求、drain、超时和最终边界 |
| 维护者 | 不同 Worker 的停止行为不一致 | 统一 run-specific drain 和失败传播语义 |
| 业务服务负责人 | 公开业务请求不一定携带内部 fencing context | 不依赖目标服务“自动拒绝”来假设运行已停止 |

## 3. 产品范围

### 3.1 包含

- 对单个 Fault Run 停止接收新任务。
- 等待或取消 in-flight 请求，并设置总 drain 超时。
- 覆盖报表、流量突增、专用场景 Worker，以及 `RunnerEngine` 中仅关联 Fault Run 的受控 lifecycle 分支。
- 区分人工停止、到期停止、Worker 失败、目标服务不可用和恢复失败。
- 按 Catalog 的 `recoveryStrategy` 执行 release、人工清理边界或非释放记录。
- 将停止、drain、release、cleanup 和 verification 结果写入运行时间线。

### 3.2 不包含

- 不停止正常客户 Runner、数据预热或补给任务；`RunnerEngine` 的接入只关闭被停止 Run 的受控分支。
- 不把 `OperationRunGuard` 当作 Worker owner lease。
- 不保证所有已经发出的公开业务请求瞬时中断。
- 不实现多副本自动接管；该能力属于批次 2。
- 不执行 Agent 提交的 remediation。

## 4. 关键用户流程

```text
Operator 点击停止或运行到期
  -> 运行进入 STOP_REQUESTED
  -> Worker 停止接受新任务
  -> 中止或等待 in-flight 请求
  -> 到达 drain deadline
  -> 按 recoveryStrategy 处理 release/人工清理/非释放边界
  -> 执行允许的 cleanup
  -> 运行 health check 和结果确认
  -> 展示最终状态、残留资源和下一步操作
```

## 5. 状态和错误语义

至少支持以下可区分结果：

| 状态 | 含义 |
| --- | --- |
| `STOP_REQUESTED` | 已接受停止请求，尚未完成 drain |
| `DRAINING` | 不再接收新任务，正在收敛 in-flight 请求 |
| `DRAIN_TIMEOUT` | 到达总超时，仍有任务未收敛 |
| `RELEASE_FAILED` | 允许 release，但目标资源未成功释放 |
| `CLEANUP_FAILED` | 允许清理，但运行级资源未成功清理 |
| `MANUAL_CLEANUP_REQUIRED` | 需要 Operator 确认或执行人工清理 |
| `CLEANING` | 已接受带确认的运行级 cleanup command，Worker 正在执行受控清理 |
| `NON_RELEASING_ACTIVE` | 场景按设计不释放已产生的效果，只记录停止边界和残留 |
| `PARTIAL_RECOVERY` | 部分恢复完成，仍需人工处理 |

`SUCCEEDED` 只能表示该场景允许的停止、恢复和验证条件均满足，不能把“停止请求已发送”直接当成成功。

## 6. 产品验收

- 停止一个 Fault Run 不会停止其他 Fault Run 或正常生命周期任务。
- Worker 停止接收新任务后，in-flight 请求的收敛结果可查。
- 所有等待都有总超时，超时不会静默成功。
- Operator 能看到是自动恢复完成、人工清理必需、非释放场景还是部分恢复。
- Worker、Coordinator、Gateway 和目标服务的失败不会被压扁为同一个 `FAILED`。
- 重启和取消路径不会遗留无法解释的 active 状态。

## 7. 成功指标与退出条件

- 报表、流量突增、专用场景 Worker 和 Runner 的受控分支都有 run-specific drain。
- 具备停止、到期、取消、超时、重启和目标不可用测试。
- 现有正常客户流量、数据预热和补给路径不受单个 Fault Run 停止影响。
- 所有恢复策略都有与产品语义一致的最终状态。

满足退出条件后，进入批次 2。
