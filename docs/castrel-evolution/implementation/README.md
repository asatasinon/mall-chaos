# Castrel Chaos Implementation Batches

> 当前范围：阶段 0～5
> 阶段 6～7 不属于当前短期实施路线，相关批次不再保留。

本目录把路线图阶段拆成可以单独评审、开发、灰度和回退的实现批次。当前先落实产品规格；每个批次后续可以在同一目录中增加 `tech.md`、`task-list.md` 和测试记录。

## 批次地图

```text
batch-0-baseline
  -> batch-1-safe-runtime
  -> batch-2-reconciliation
  -> batch-3-scenario-contract
  -> batch-4-evidence-query
  -> batch-5-0-alert-intake
  -> batch-5-1-agent-rca-submission
  -> batch-5-2-evaluator
```

| 批次 | 产品文档 | 交付重点 | 依赖 |
| --- | --- | --- | --- |
| 0 | [product.md](./batch-0-baseline/product.md) / [tech.md](./batch-0-baseline/tech.md) / [task-list.md](./batch-0-baseline/task-list.md) | 12 个场景的运行基线、失败分类、回退和告警前置核验 | 当前系统 |
| 1 | [product.md](./batch-1-safe-runtime/product.md) / [tech.md](./batch-1-safe-runtime/tech.md) | 单个 Fault Run 的安全停止、drain、超时和恢复边界 | 批次 0 |
| 2 | [product.md](./batch-2-reconciliation/product.md) / [tech.md](./batch-2-reconciliation/tech.md) / [task-list.md](./batch-2-reconciliation/task-list.md) | Worker owner lease、heartbeat、接管和重协调 | 批次 1 |
| 3 | [product.md](./batch-3-scenario-contract/product.md) / [tech.md](./batch-3-scenario-contract/tech.md) | Catalog、Gateway、Worker、证据和告警合同的一致性校验 | 批次 2 |
| 4 | [product.md](./batch-4-evidence-query/product.md) / [tech.md](./batch-4-evidence-query/tech.md) | 可重复的实时 Evidence Query Manifest 和 Operator 报告 | 批次 3 |
| 5.0 | [product.md](./batch-5-0-alert-intake/product.md) / [tech.md](./batch-5-0-alert-intake/tech.md) | Alertmanager 告警接收、去重、关联和生命周期记录 | 批次 4 |
| 5.1 | [product.md](./batch-5-1-agent-rca-submission/product.md) / [tech.md](./batch-5-1-agent-rca-submission/tech.md) / [Schema](./batch-5-1-agent-rca-submission/agent-rca-report-schema.md) | 选定告警向外部 Agent 投递，以及 AgentRcaReport v1 | 批次 5.0 |
| 5.2 | [product.md](./batch-5-2-evaluator/product.md) / [tech.md](./batch-5-2-evaluator/tech.md) | 独立 Evaluator、证据复查和分项评估结果 | 批次 5.1 |

## 批次文档规则

1. `product.md` 只定义用户、问题、范围、行为、验收和成功指标，不提前固化代码结构。
2. 产品规格通过评审后，再在同一批次目录补充 `tech.md`，明确数据模型、接口、迁移、部署和测试。
3. 批次必须有明确的启用或生效边界、观测指标、回退方式和退出条件；纯 CI/文档批次不强制增加运行时开关。
4. 后续批次不能把前一批次尚未确认的运行事实当作前置假设。
5. 所有批次都遵守 [roadmap/operating-model.md](../roadmap/operating-model.md) 的真实性、权限和 Evidence 边界。

## 当前非目标

- 不做多环境、多 Trial、Worker Pool、Leaderboard、Outbox、FinOps/CISO 适配或自动修复。
- 不把 AgentRcaReport 的接收时间按固定 RCA 过期时间截断。
- 不保存 Prometheus、Loki、Tempo 的现场快照来替代实时查询。
