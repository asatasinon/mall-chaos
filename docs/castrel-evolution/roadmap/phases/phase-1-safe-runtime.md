# 阶段 1：安全停止和失败传播

## 目标

让单 Worker、单环境下的 Fault Run 在停止、超时、重启和失败时可预测。

## 统一生命周期

```text
start
  -> accept work
  -> stop accepting new work
  -> abort or finish in-flight requests
  -> await drain deadline
  -> release target
  -> cleanup
  -> verify
```

首批覆盖：

- `ReportScenarioWorker`
- `TrafficSurgeExecutor`
- `ScenarioWorkers`
- 客户生命周期 Runner
- 数据预热和补给任务

`ScenarioWorkers` 已有 run-specific drain；报表和流量 Worker 需要补齐与 Coordinator 的注册和停止顺序。

## 统一结果

| 结果 | 含义 |
| --- | --- |
| `SUCCEEDED` | 目标动作、恢复和验证完成 |
| `TARGET_EFFECT_NOT_CONFIRMED` | 控制动作完成，但没有证明目标效果发生 |
| `WORKER_FAILED` | Worker 未能持续执行 |
| `DRAIN_TIMEOUT` | 停止时任务未收敛 |
| `RELEASE_FAILED` | 目标服务未成功释放 |
| `CLEANUP_FAILED` | 运行级资源未清理 |
| `SERVICE_UNAVAILABLE` | 目标服务或依赖不可用 |
| `PARTIAL_RECOVERY` | 部分恢复完成，仍需人工处理 |

## 验收

- 手工停止与到期恢复都能停止新请求。
- in-flight 请求在 deadline 内收敛，超时明确记录。
- 报表、流量和专用 Worker 的 drain 结果可见。
- Worker 重启不会把已停止运行重新启动为 ACTIVE。
- 注入、release、cleanup 任一步失败都向上游传播。

## 发布

先测试，再在单个非生产环境 canary，连续完成停止、到期和 Worker 重启演练后成为默认路径。回退时保留旧状态和旧 release 路径；新 drain 失败保持 `RECOVERING`，不静默转为 `RECOVERED`。
