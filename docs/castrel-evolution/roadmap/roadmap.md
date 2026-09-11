# Castrel Chaos 渐进式演化路线图

> 状态：规划中  
> 更新时间：2026-09-11 CST  
> 阶段细节见 `phases/`；所有阶段共用规则见 [operating-model.md](./operating-model.md)。

## 1. 总体目标

在不牺牲真实业务路径、控制面隔离和故障真实性的前提下，把 Castrel Chaos 演化为：

```text
可真实演练
  -> 可安全停止和恢复
  -> 可验证地描述场景
  -> 可按时间窗口查询证据
  -> 可接收告警并进行 Agent RCA
  -> 可隔离地运行 Trial
  -> 可逐步扩展到规模化和新领域
```

## 2. 阶段地图

| 阶段 | 详细文档 | 目标 | 默认上线范围 |
| --- | --- | --- | --- |
| 0 | [phase-0-baseline.md](./phases/phase-0-baseline.md) | 基线、失败分类、回退和资源预算 | 所有开发/测试环境，旁路 |
| 1 | [phase-1-safe-runtime.md](./phases/phase-1-safe-runtime.md) | drain、总超时、失败传播和安全停止 | 单 Worker 测试环境，先 opt-in |
| 2 | [phase-2-reconciliation.md](./phases/phase-2-reconciliation.md) | owner lease、heartbeat、fencing 和 Reconciler | 单副本默认，测试 opt-in |
| 3 | [phase-3-scenario-contract.md](./phases/phase-3-scenario-contract.md) | Catalog、Gateway、Worker 和测试合同 | CI blocking，运行时先不改变 |
| 4 | [phase-4-evidence-query.md](./phases/phase-4-evidence-query.md) | 实时 Evidence Query Manifest 和确定性基线 | Operator 旁路查询报告 |
| 5 | [phase-5-agent-rca.md](./phases/phase-5-agent-rca.md) | 告警驱动、只读观测、RCA 和恢复建议 | 专用单环境、单场景、单运行 |
| 6 | [phase-6-isolation-trials.md](./phases/phase-6-isolation-trials.md) | Profile、Environment、资源/数据隔离和 Trial | opt-in |
| 7 | [phase-7-scale-domain.md](./phases/phase-7-scale-domain.md) | Worker Pool、Outbox、FinOps 和 CISO | 按环境和能力逐项启用 |

## 3. 必须遵守的顺序

阶段 5 有意先于阶段 6，但边界必须严格：

- 阶段 5 是单场景、单环境、单运行的 RCA 试点，不是多 Agent benchmark。
- 外部 Agent 不获取 `taskId`、`evaluationId`、`faultRunId` 或内部数据库 ID。
- Agent 由 Alertmanager firing alert 触发，只接收告警 envelope 和 opaque `alertRef`。
- Agent 只读查询观测数据，提交标准化 `AgentSubmission.json`，不执行恢复。
- Evaluator 在合法提交后自动排队，重新查询当前观测数据并生成报告。
- 阶段 6 完成资源和数据隔离后，才开放可比较的多 Trial。

## 4. 当前建议起点

当前从阶段 0 开始。建议前三个增量：

1. **运行基线和失败测试**
   - 记录 12 个场景的 prepare、active、stop、release、cleanup 基线。
   - 补 Coordinator 状态转换、失败分类和 Worker 停止边界测试。
2. **报表/流量 Worker 的 run-specific drain**
   - 停止接收新请求。
   - 等待 in-flight 请求。
   - 写入 drain 结果。
   - 失败时保持明确 recovery 状态。
3. **Catalog/Target/Worker 合同校验**
   - 校验 Catalog 与 Gateway target map。
   - 校验 Worker dispatch、recovery strategy、参数、时长、runbook、Evidence Query 和 i18n。

完成这三个增量后，先完成阶段 4，再进入阶段 5。不要同时启动 Worker Pool、消息队列或 Agent 自动恢复。

## 5. 阶段依赖与验收总表

| 阶段 | 进入条件 | 完成门槛 |
| --- | --- | --- |
| 0 | 当前系统可运行 | 12 个场景可诊断、可回退 |
| 1 | 阶段 0 基线可用 | 停止、到期、重启和失败测试通过 |
| 2 | 阶段 1 drain 稳定 | 双 Worker 竞争、接管和旧 owner fencing 通过 |
| 3 | 阶段 2 状态事实稳定 | 12 个场景 Contract validation 通过 |
| 4 | 阶段 3 有稳定场景定义 | retention 内可重复查询关键证据 |
| 5 | 阶段 4 有 Query Manifest 和告警合同 | AgentSubmission、RCA 和 Evaluator 闭环完成 |
| 6 | 阶段 5 单运行试点稳定 | 两个环境互不污染 |
| 7 | 阶段 0～6 全部稳定 | Worker Pool、异步或领域扩展逐项通过门禁 |

## 6. 共用规则

所有阶段必须遵守 [operating-model.md](./operating-model.md)：

- 真实业务/资源路径优先。
- 控制面和业务面分离。
- Agent 最小权限和只读 RCA。
- Evidence v0 只保存查询协议和判断记录，不保存现场数据。
- 新能力 opt-in、可观测、可回退。
- 数据库使用 expand/contract migration。

## 7. 文档导航与职责

| 文档 | 内容 |
| --- | --- |
| `roadmap.md` | 总体目标、阶段顺序、依赖关系和当前执行建议 |
| `operating-model.md` | 所有阶段共用的真实性、安全、发布、回退和数据规则 |
| `phases/phase-0-baseline.md` | 基线、失败分类、资源预算和发布护栏 |
| `phases/phase-1-safe-runtime.md` | drain、总超时、失败传播和停止语义 |
| `phases/phase-2-reconciliation.md` | owner lease、heartbeat、fencing 和 Reconciler |
| `phases/phase-3-scenario-contract.md` | Catalog、Gateway、Worker 和测试合同 |
| `phases/phase-4-evidence-query.md` | 实时 Evidence Query Manifest 和确定性基线 |
| `phases/phase-5-agent-rca.md` | Alertmanager 驱动的只读 Agent RCA 试点 |
| `phases/phase-6-isolation-trials.md` | Profile、Environment、资源/数据隔离和 Trial |
| `phases/phase-7-scale-domain.md` | Worker Pool、Outbox、FinOps 和 CISO 扩展 |

产品规格和技术设计如果存在，作为阶段文档的配套输入：

| 文档 | 负责回答的问题 |
| --- | --- |
| `product.md` | 为什么做、服务谁、用户体验、范围、成功指标和产品验收 |
| `tech.md` | 怎么做、模块边界、数据模型、接口、迁移、测试和部署 |

## 8. 文档更新规则

每个阶段开始前：

1. 在产品规格中确认用户目标和验收标准。
2. 在技术设计中确认模块边界、数据模型、接口、迁移和测试。
3. 在对应阶段文档记录状态、发布版本、灰度范围和回退点。
4. 只有当前阶段门禁通过，才进入下一阶段。
