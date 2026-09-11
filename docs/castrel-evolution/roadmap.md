# Castrel Chaos 渐进式演化路线图

> 状态：规划中  
> 更新时间：2026-09-11 CST  
> 适用范围：Castrel Chaos 控制面、Worker、业务服务、观测、部署和后续 Agent 评测能力  
> 配套文档：[product.md](product.md)、[tech.md](tech.md)  
> 相关背景：[ITBench 与 Castrel Chaos 架构对比](../itbench-vs-castrel-chaos.md)、[宣讲材料](../itbench-castrel-chaos-briefing.md)

## 1. 路线图目标

Castrel Chaos 后续不采用“一次性重构”的方式，而采用**小步实现、独立发布、逐步扩大使用范围**的演化方式：

```text
当前真实业务故障演练平台
        |
        v
运行可靠性增强
        |
        v
场景契约和自动校验
        |
        v
证据归档和确定性基线
        |
        v
受控 Agent 接入和单场景评估
        |
        v
资源/数据隔离和 Trial
        |
        v
多环境、异步能力和领域扩展
```

路线图的最终目标是：

> 在不牺牲真实业务路径、控制面隔离和故障真实性的前提下，把 Castrel Chaos 演化为可复现、可解释、可评估、可逐步扩展的业务故障演练平台。

## 2. 不变的架构原则

后续所有阶段都必须遵守以下原则。

### 2.1 真实路径优先

- 故障效果继续来自真实 HTTP、SQL、Redis、JVM、文件系统、数据库锁、外部支付或业务依赖。
- 不用 Controller 直接返回伪造错误替代真实业务行为。
- 不用固定等待伪造延迟、超时或资源耗尽。
- “控制动作已执行”与“资源后果实际发生”必须分开记录。

### 2.2 控制面和业务面分离

- `traffic-control-plane` 继续是 Catalog、Fault Run 生命周期、审计、恢复和评估语义的唯一所有者。
- 所有控制面业务 HTTP 调用继续经过 Gateway 固定 operation。
- 目标服务只接收通用 operation、opaque run context、expiry、idempotency 和 fencing context。
- 业务服务、消费者接口、日志、指标和 Trace 不暴露场景身份、控制面状态或 Ground Truth。

### 2.3 向后兼容优先

- 新字段优先采用 additive migration，不直接删除旧字段。
- 新流程先以 shadow、observe-only 或 opt-in 方式运行。
- 现有 12 个场景的默认行为不能因为路线图功能自动改变。
- 新的 Trial、Evidence 和 Agent 能力必须叠加在 Fault Run 之上，不能破坏现有 Operator 演练。

### 2.4 先有证据，再做优化

- 先记录请求、状态、失败、恢复、清理和资源边界，再优化并发、异步和多副本。
- 没有可验证的 owner、drain 和证据，不扩大 Worker 副本数。
- 没有环境隔离，不开展公平的并行 Trial。
- 没有版本化证据，不发布跨 Agent 的排行榜结论。

### 2.5 每个阶段都可回退

每个阶段必须定义：

```text
启用条件
    -> 观测指标
    -> 灰度范围
    -> 停止条件
    -> 回退动作
```

数据库迁移、运行时开关和 Worker 协议都必须允许旧版本短期兼容，避免一次发布必须同时升级所有服务。

## 3. 当前基线与目标边界

### 3.1 当前基线

当前 Castrel 已经具备：

- 真实电商消费者链路：Shopfront、Gateway、User、Catalog、Cart、Order、Inventory、Promotion、Risk、Payment、Fulfillment、Notification 和 PSP Simulator。
- 受保护的控制面和独立 Worker。
- 机器可读的 Fault Run Catalog。
- Fault Run 状态、幂等键、expiresAt、fencing token、审计事件和恢复结果。
- Redis `OperationRunGuard`、数据预热 lease 和部分场景 Worker drain。
- Prometheus、Alertmanager、Loki、Tempo、Grafana、结构化日志和业务指标。
- Docker Compose、本地源码运行和 Kubernetes 部署路径。
- 12 个真实业务/资源级场景。

### 3.2 当前不能假设的能力

以下能力不应在当前版本中被默认假设为已经完成：

- Worker 多副本安全接管。
- 所有持续 Worker 都接入 Coordinator 的 run-specific drain。
- 共享 MySQL/Redis 上的多 Trial 公平并行。
- 面向外部 Agent 的短时凭据、工具 allowlist 和结果提交协议。
- 统一的 Agent scorecard、Evidence Query Manifest 和可重放 Trial。
- 全量数据库、Redis、文件和外部依赖的环境快照/恢复。
- 消息队列、Outbox 和异步最终一致性模型。

## 4. 发布方式

路线图使用“阶段 + 增量发布”而不是一次性版本号。每个阶段可以拆成多个 PR 或小版本。

| 发布类型 | 目的 | 是否改变默认运行行为 |
| --- | --- | --- |
| `foundation` | 监控、契约、测试、迁移和回滚准备 | 否 |
| `safe-runtime` | drain、超时、失败传播和重协调 | 先 opt-in，稳定后成为默认 |
| `contract` | Catalog 契约、合同测试和生成校验 | 否，先只校验和告警 |
| `evidence` | 运行证据、时间线和确定性基线 | 否，先旁路采集 |
| `agent-pilot` | 一个场景的 Agent 访问和评估 | 仅测试环境 |
| `profile` | lite/full/benchmark/isolated-trial 环境 | 新 Profile opt-in |
| `scale` | 多环境、Worker Pool、异步和领域扩展 | 按部署环境选择 |

**当前建议起点：阶段 0。** 在阶段 0 的基线、失败分类、回退手册和资源预算完成前，不进入 Worker 多副本、Agent Access 或消息队列阶段。

推荐每个增量都形成一个可回退的发布单元：

```text
代码/迁移
  + 单元/合同测试
  + 运维手册
  + 观测指标
  + 灰度开关
  + 回退步骤
  = 可上线增量
```

## 5. 分阶段路线图

### 阶段 0：建立基线和发布护栏

**目标**：在修改运行时之前，先知道系统当前的真实行为，并具备发现和回退能力。

**建议范围**：

1. 为当前 12 个场景建立基线清单：
   - prepare 成功率；
   - active 请求数、成功数、失败数和超时数；
   - 手工停止和 duration 到期的恢复时长；
   - release、cleanup 和 compensation 结果；
   - 目标服务健康状态；
   - 运行级资源是否残留。
2. 统一记录 Worker、Coordinator、Gateway 和目标服务的关键事件。
3. 为每个场景补充当前已知限制和回退操作。
4. 建立数据库 migration 的 expand/contract 规则。
5. 明确开发、完整演练和 benchmark 环境的资源预算。
6. 将数据预热、SkyWalking、重观测组件和危险场景全部标记为显式能力，不改变默认行为。

**首批交付物**：

- 当前场景运行基线表。
- 运行失败分类表：目标效果失败、控制面失败、Worker 失败、恢复失败、清理失败。
- 发布检查清单。
- 回退手册。
- 关键事件和指标的低基数命名约定。
- 场景运行前后的 smoke 验收脚本。

**验收门槛**：

- 每个场景都能回答“如何启动、如何停止、如何确认恢复、如何处理残留”。
- 运行失败不会只显示一个笼统的 `FAILED` 而没有最后阶段。
- 至少能通过 Run Event、业务日志、指标和 Trace 时间窗口关联一次运行。
- 新增基线能力不改变现有场景行为。

**上线方式**：旁路采集、只读页面、不开启新控制逻辑。

**回退方式**：停止旁路采集或回退控制面 Web/Worker 镜像；不需要回滚业务表数据。

### 阶段 1：修复安全停止和失败传播

**目标**：先让单 Worker、单环境下的 Fault Run 在停止、超时、重启和失败时可预测。

#### 1.1 统一 Worker 生命周期

统一所有持续执行器的语义：

```text
start(run)
  -> accept work
  -> stop accepting new work
  -> abort or finish in-flight requests
  -> await drain deadline
  -> release target
  -> cleanup
  -> verify
```

首批覆盖：

- `ReportScenarioWorker`；
- `TrafficSurgeExecutor`；
- `ScenarioWorkers`；
- 客户生命周期 Runner；
- 数据预热；
- 补给任务。

当前 `ScenarioWorkers` 已有 run-specific drain；报表和流量 Worker 需要补齐与 Coordinator 的统一注册和停止顺序。

#### 1.2 失败传播和总超时

统一区分：

| 结果 | 含义 |
| --- | --- |
| `SUCCEEDED` | 目标动作、恢复和验证均完成 |
| `TARGET_EFFECT_NOT_CONFIRMED` | 控制动作完成，但没有证明目标效果实际发生 |
| `WORKER_FAILED` | Worker 未能持续执行 |
| `DRAIN_TIMEOUT` | 停止时仍有请求或任务未收敛 |
| `RELEASE_FAILED` | 目标服务未成功释放 |
| `CLEANUP_FAILED` | 运行级资源未清理 |
| `SERVICE_UNAVAILABLE` | 目标服务或依赖不可用 |
| `PARTIAL_RECOVERY` | 部分恢复完成，仍需人工处理 |

所有等待都必须有总超时、最后状态和可诊断事件。Ansible、Gateway、Worker 和目标服务的失败不能只写日志后继续返回成功。

#### 1.3 首阶段不做的事

- 不扩容 Worker 副本。
- 不引入消息队列。
- 不把 Fault Run 改为批量 Trial。
- 不增加 Agent 权限。
- 不改变 12 个场景的目标 operation。

**验收门槛**：

1. 手工停止与到期恢复都能停止新请求。
2. in-flight 请求在 deadline 内收敛，超时会明确记录。
3. 报表、流量和专用场景 Worker 的 drain 结果都能在 Fault Run 中看到。
4. Worker 进程重启后，不会把已停止运行重新启动为 ACTIVE。
5. 故障注入、目标 release、清理任一步骤失败都能被上游感知。

**上线方式**：

1. 先为 drain、失败传播和新状态写测试。
2. 在测试环境启用新流程。
3. 在单个非生产演练环境 canary。
4. 连续完成多个手工停止、自动到期和 Worker 重启演练后，再成为默认路径。

**回退方式**：

- 保留旧状态字段和旧 release 路径。
- 新 drain 失败时保持 `RECOVERING`，禁止静默转为 `RECOVERED`。
- 关闭新 Worker 生命周期开关后仍可使用旧的单 Worker 执行方式。

### 阶段 2：增加 Worker 所有权和状态重协调

**目标**：为未来多副本和进程接管建立基础，但暂时仍只部署一个 Worker 副本。

#### 2.1 Owner Lease

为 Worker 执行增加独立的 owner 事实：

```text
fault_run_id
owner_id
owner_epoch / fencing_token
lease_expires_at
last_heartbeat_at
last_action
drain_state
```

该 owner lease 与目标服务的 `OperationRunGuard`、数据预热 lease 不是同一个概念：

- 目标侧 guard 防止旧运行继续影响目标服务。
- Worker owner lease 决定哪个 Worker 有权持续执行一个 Fault Run。
- 数据预热 lease 只负责预热写入所有权。

#### 2.2 Reconciler

Worker 启动时和周期扫描时，以数据库状态为事实来源：

```text
CREATING
  -> 检查 prepare 是否完成
  -> 继续 prepare 或进入 FAILED

ACTIVE
  -> 检查 owner lease
  -> 启动或接管 Worker

RECOVERING
  -> 停止新任务
  -> 继续 drain/release/cleanup

过期状态
  -> 进入 recovery
  -> 写入明确的恢复事件
```

timer 只能作为及时执行的加速机制，不能作为唯一状态来源。

**验收门槛**：

- 两个 Worker 同时扫描同一 Fault Run 时只有一个获得 owner。
- 旧 owner 的请求在 fencing 失效后被拒绝。
- Worker 失联后，新 Worker 能在 lease 过期后接管或将运行标记为需人工处理。
- 重启不会重复 prepare、重复 release 或跳过 cleanup。
- 现有单副本部署行为保持不变。

**上线方式**：

- 第一版只写 owner/heartbeat 和指标，不改变执行者。
- 第二版让 Reconciler 在 shadow mode 计算“应执行动作”，但不自动接管。
- 第三版只在测试环境启用自动接管。

**回退方式**：关闭自动接管，只保留旧的单 Worker 调度；owner 字段和 heartbeat 记录为 additive，不删除。

### 阶段 3：把 Catalog 演化为 Scenario Contract

**目标**：减少 Catalog、Gateway、Worker、目标服务、runbook 和测试之间的隐式漂移。

#### 3.1 Contract 内容

Contract 仅属于控制面和测试生成层，不直接暴露给业务服务：

```text
scenario
  - catalog revision
  - target service / operation
  - parameter schema
  - duration and resource budget
  - prepare / active / stop / release / cleanup
  - expected evidence
  - recovery checks
  - side-effect checks
  - isolation requirements
```

#### 3.2 先校验，后生成

采用两步演化：

1. **只读校验阶段**
   - 校验 Catalog 与 Gateway target map 一致。
   - 校验 Worker dispatch 覆盖所有需要 Worker 的场景。
   - 校验 recovery strategy 与 release/cleanup 实现存在。
   - 校验参数边界、duration、runbook 和 i18n 覆盖。
2. **生成辅助阶段**
   - 生成合同测试骨架。
   - 生成控制台表单元数据。
   - 生成 runbook checklist。
   - 生成 smoke test 场景清单。
   - 生成术语隔离检查输入。

第一版不自动生成生产代码，不删除现有人工映射，避免生成器成为新的单点风险。

**验收门槛**：

- 12 个当前场景全部通过 contract validation。
- 新增场景缺少 Gateway、Worker、release、cleanup 或证据定义时，CI 明确失败。
- Contract revision 可在运行事件中追踪。
- 业务服务仍只接收通用内部协议。

**上线方式**：CI blocking，运行时先 warning；所有历史场景通过后再将关键校验提升为发布阻断。

### 阶段 4：建立 Evidence Query Manifest 和确定性基线

**目标**：先让 Operator 和 Agent 能够按统一时间窗口直接查询现有 Prometheus、Loki、Tempo、业务检查和 Run Event，再引入 Agent 评分；本阶段不保存现场指标、日志、Trace 或完整资源快照。

#### 4.1 Evidence Query Manifest v0

第一版可以绑定一个 Fault Run，不必立即引入完整 Campaign。Manifest 只保存运行元数据、时间线、查询窗口、查询配方和检查定义，不保存观测结果副本：

```json
{
  "faultRunId": "…",
  "scenario": "BROWSE_REPORT_SQL",
  "catalogRevision": "…",
  "environmentProfile": "full",
  "timeline": {
    "createdAt": "…",
    "preparedAt": "…",
    "activeAt": "…",
    "recoveryStartedAt": "…",
    "recoveredAt": "…"
  },
  "queryWindows": {
    "baseline": { "from": "…", "to": "…" },
    "active": { "from": "…", "to": "…" },
    "recovery": { "from": "…", "to": "…" },
    "cleanup": { "from": "…", "to": "…" }
  },
  "queries": [
    {
      "kind": "trace",
      "service": "catalog-service",
      "query": "{ resource.service.name = \"catalog-service\" }"
    },
    {
      "kind": "metrics",
      "query": "Prometheus range query reference"
    },
    {
      "kind": "logs",
      "query": "Loki query reference"
    }
  ],
  "checks": {
    "controlActionCompleted": false,
    "targetEffectObserved": false,
    "businessRecovered": false,
    "cleanupCompleted": false
  }
}
```

必须区分：

```text
控制动作完成
目标效果实际发生
Agent/Operator 修复成功
业务恢复
资源清理完成
```

#### 4.2 Evidence 的定义：实时查询，不保存现场数据

Evidence v0 是一份**查询协议和判断记录**，不是离线数据集：

| 内容 | 是否保存 | 说明 |
| --- | --- | --- |
| Fault Run 元数据和控制面时间线 | 是 | 复用现有 MySQL Run Event、状态和审计记录 |
| baseline/active/recovery/cleanup 时间窗口 | 是 | 作为后续 Prometheus/Loki/Tempo 查询的边界 |
| PromQL/LogQL/TraceQL 和业务检查配方 | 是 | 保存如何查，不保存查询返回结果 |
| Agent RCA、证据引用、置信度和恢复建议 | 是 | 保存分析输出，不复制原始指标、日志或 Trace |
| Prometheus 指标结果 | 否 | 直接查询现有 Prometheus |
| Loki 日志结果 | 否 | 直接查询现有 Loki |
| Tempo Trace/Span 结果 | 否 | 直接查询现有 Tempo |
| MySQL/Redis/文件/JVM 现场快照 | 否 | 不保存 volume、heap、文件卷或外部 PSP checkpoint |

因此本阶段明确：

- 不做现场数据封存、artifact volume、S3 证据包、原始日志导出、Trace 导出或指标降采样副本。
- 不承诺数据过期后仍能离线复盘；Prometheus/Loki/Tempo 的 retention 是当前证据可用性的上限。
- Evidence 不是 Ground Truth；Ground Truth、评分规则和内部预期根因仍由控制面/评估器保护。
- 查询结果只在当前观测系统中查看；页面、Agent 和报告只保存查询条件、时间窗口和分析结论。
- 如果未来需要长期 benchmark 或离线 replay，再单独增加 `offline-evidence` 能力和存储设计，不作为本阶段隐式行为。

这里要区分两个概念：

```text
Agent Submission
  = Agent 提交的 RCA、证据引用、置信度、影响范围和恢复建议

Evidence Query
  = 根据 Manifest 直接查询 Prometheus、Loki、Tempo、业务只读接口和 Run Event

Evaluator
  = 独立读取 Agent Submission
    + Evidence Query 的实时结果
    + 控制面生命周期事实
    + Operator 实际恢复结果
    -> 生成评估报告
```

因此，**Evaluator 不是 Agent RCA 的另一个名称，也不是 Agent 自己给自己打分**。Agent Submission 是 Evaluator 的输入之一；Evaluator 需要重新检查证据引用是否成立，并判断 RCA、恢复建议和实际恢复结果是否一致。

#### 4.3 Evidence 时间线和查询窗口

Evidence 以控制面持久化时间点为主，不依赖单个 OTel trace ID。建议至少保存以下时间点：

```text
t_created
t_prepare_started
t_active
t_effect_observed        可选；不确定时为空
t_agent_started          可选
t_agent_submitted        可选
t_stop_requested
t_recovery_started
t_recovered              可选
t_cleanup_finished       可选
```

默认查询窗口采用“阶段窗口 + 安全边界”，而不是固定一个时间点：

| 窗口 | 默认范围 | 目的 |
| --- | --- | --- |
| `baseline` | `t_active - 5m` 到 `t_active` | 建立故障前服务、依赖和资源基线 |
| `active` | `t_active - 30s` 到 `t_recovery_started + 30s` | 覆盖故障传播、目标效果和 Agent 观察期 |
| `recovery` | `t_recovery_started - 30s` 到 `t_recovered + 5m` | 验证停止、释放、业务恢复和恢复后的稳定性 |
| `cleanup` | `t_cleanup_finished - 5m` 到结束 | 验证运行级 Redis marker、文件、锁、临时资源和清理结果 |

这些是默认值，不是所有场景的硬编码阈值。场景 Contract 可以覆盖窗口，例如：

- 慢 SQL 需要覆盖查询开始前的基线和完整执行时间；
- JVM 堆压力需要覆盖 GC/健康变化和进程退出前的最后可见窗口；
- 表锁/行锁需要覆盖锁建立、等待、超时和释放；
- PSP 场景需要覆盖 Payment、PSP、Order 后续状态传播；
- 存储追加需要覆盖文件增长前后和容量保护结果。

如果某个时间点不存在，例如目标效果未确认或服务在恢复前退出，Manifest 必须保留 `null` 和原因，不能用当前时间伪造完整窗口。

#### 4.4 按数据类型的实时查询

| 数据类型 | 查询方式 | Manifest 保存内容 |
| --- | --- | --- |
| Run Event/控制面状态 | Fault Run、状态转换、owner、drain、release、cleanup | 事件类型、时间窗口和查询入口；事件事实仍在控制面数据库 |
| Metrics | Prometheus range query，按 baseline/active/recovery 查询 | PromQL、service、窗口和判断标准 |
| Logs | Loki 按服务、级别、时间窗口和允许的关联字段查询 | LogQL、service、窗口和脱敏规则 |
| Traces | Tempo 按 `resource.service.name`、时间窗口、route、error、duration 查询 | TraceQL、service、业务路径和窗口 |
| 业务检查 | 商品、订单、库存、支付、通知等受控 read-only check | 检查类型、调用入口、预期判断和结果提交位置 |
| 资源/配置 | Catalog、镜像、配置 revision、运行级 marker、目标资源摘要 | 资源类型、检查命令/查询定义和脱敏规则 |
| 文件/Redis/锁 | 运行级文件大小、Redis marker、锁/事务诊断查询 | 检查项、时间窗口和判断标准，不保存现场副本 |

Trace 需要特别注意：

- `faultRunId`、`X-Trace-Id` 和数据库中的业务关联 ID 不自动等同于 OTel Trace ID。
- 所以 Evidence 必须保存 service、route/业务路径、时间窗口和查询条件，不能只保存一个自定义 trace ID。
- 服务进程退出前可能来不及导出最后一个 span；健康、容器状态、日志和缺失 trace 都应作为补充证据。

#### 4.5 Evidence 查询和使用边界

推荐生命周期：

```text
运行中
  -> Agent/Operator 查询 live observability
  -> 控制面记录事件和时间线
  -> Agent 提交 RCA、证据引用和恢复建议
  -> Operator 审核并通过现有控制面恢复
  -> Evaluator 根据实时查询结果和控制面记录生成报告
```

运行中的 Agent 只能看到允许的实时观测和任务范围；Agent 不可写入控制面状态、观测系统、Evidence 查询定义或评分。查询失败、数据过期或观测系统不可用时，报告标记 `evidence_unavailable`，不能伪装成目标效果未发生。

这使 Evidence v0 支持：

1. 运行中：Operator/Agent 直接查询当前 Prometheus、Loki、Tempo 和业务只读接口。
2. 运行后短窗口：在 retention 尚未过期时，按 Manifest 重复查询同一时间窗口。
3. RCA 评估：根据查询结果、控制面 Run Event、Agent RCA 和 Operator 实际恢复结果生成报告。

Evidence v0 不支持：

1. 观测数据过期后的离线复盘。
2. 没有数据库/Redis/文件现场数据时的完整 replay。
3. 仅凭 Manifest 还原当时的原始日志、指标和 Trace。

#### 4.6 确定性基线

- 记录 catalog revision、配置 revision、镜像 digest、schema version、数据 profile 和 seed。
- 受控随机行为改为显式 seed 或序列，正常业务随机性与 Fault Run 效果分开。
- PSP outcome 采用可重现的序列/规则；timeout 不使用业务线程固定 `sleep` 伪造。
- 记录观测窗口和数据预热状态。

#### 4.7 Evaluator v0

Evaluator v0 只生成 Operator 可读的验证报告，不对外发布 Agent 排名。它的输入和输出明确分开：

| 数据 | 来源 | Evaluator 的用途 |
| --- | --- | --- |
| `AgentSubmission` | Agent Result Gateway | 检查 RCA、证据引用、置信度、影响范围和恢复建议 |
| 实时观测结果 | Prometheus、Loki、Tempo、业务只读检查 | 验证 Agent 引用的现象是否真实存在，判断目标效果和业务影响 |
| 控制面事实 | Fault Run、Run Event、审计和状态 | 验证 prepare、active、stop、release、drain 和 cleanup 顺序 |
| Operator outcome | Operator 审核记录、实际恢复动作和验证结果 | 区分“建议已提交”“建议被采纳”“恢复已执行”“业务已恢复” |

输出为：

```text
Evaluation Report
  - rcaCorrectness
  - evidenceSufficiency
  - recommendationSafety
  - operatorExecutionStatus
  - businessRecoveryStatus
  - cleanupStatus
  - limitations / evidence_unavailable
```

Evaluator 不执行恢复动作，不替 Operator 调用 release/cleanup，也不把 Agent 的建议当作已经发生的事实。

| 结果维度 | 第一版判定 |
| --- | --- |
| Control | prepare、active、stop、release 是否按顺序完成 |
| Effect | 目标指标/日志/业务检查是否证明效果发生 |
| Recovery | 健康检查、业务请求和资源状态是否恢复 |
| Cleanup | 运行级 Redis/file/lock/marker 是否清理 |
| Safety | 是否出现越权、消费者泄露或无关资源变化 |

**上线方式**：旁路生成 manifest 和 report，不改变 Fault Run 状态机。

**验收门槛**：

- 一个场景可以生成完整时间线和可复制的 live query recipe。
- 一个场景可以在观测 retention 内按同一窗口重复查询关键指标、日志、Trace 和业务检查。
- 报告明确标记 `evidence_unavailable`、查询失败和数据过期，不把缺少观测数据误判成目标效果未发生。
- 重复执行同一 profile 时，差异可以解释。
- `prepare succeeded` 不再被当作 `target effect observed`。
- 查询配方生成失败、观测查询失败或数据过期会显示为 `evidence_unavailable`，不伪装成目标效果未发生。

### 阶段 5：Agent Access 和单场景评估试点

**目标**：在资源与数据隔离平台尚未通用化之前，先用一套专用、非生产、单运行环境验证 Agent 的只读观测、RCA（Root Cause Analysis，根因分析）、恢复建议、结果回收和评估闭环。

**重要边界**：

- 这是一次**单场景、单环境、单运行**的能力试点，不是多 Agent 横向 benchmark。
- 试点环境必须由运营人员单独准备，不与正常开发、客户流量或其他 Fault Run 共享数据。
- 试点不提供通用的并行 Trial、环境自动创建、跨环境比较或排行榜。
- Agent 只允许读取观测数据、生成 RCA 和给出恢复建议，不直接执行恢复、release、cleanup 或业务写操作。
- 实际恢复仍由 Operator 按建议审核后，通过现有控制面和受保护流程执行。
- 资源与数据隔离阶段将在本阶段验证成功后，把“专用手工环境”演化成可重复的 `Environment/Profile/Trial` 能力。

#### 5.1 身份分离

| 身份 | 能力 | 不能拥有 |
| --- | --- | --- |
| Operator | 创建、停止、恢复和清理 Fault Run | 不代表 Agent 任务身份 |
| Customer Runner | 产生正常客户生命周期流量 | 不代表 Agent 推理或评分 |
| Agent | 试点任务范围内只读观察、RCA 和恢复建议 | 任何恢复执行、release/cleanup、业务写操作、Operator session、内部 service key、Ground Truth、评分写权限 |

#### 5.2 Agent Access v0

```text
Task Descriptor
  - taskId / evaluationId
  - 可见业务入口和观测入口
  - 截止时间、预算和只读观测范围
  - 不包含 Ground Truth 和内部密钥

Agent Access Broker
  - 短时凭据
  - read-only tool allowlist
  - 资源和观测范围
  - 审计、限流、撤销和过期

Result Gateway
  - 接收 RCA、证据引用、置信度、影响范围和恢复建议
  - Agent 不能提交恢复已执行、修改 Evidence 或写入 score
```

#### 5.3 试点顺序

不要一次开放 12 个场景，也不要在共享环境中同时运行多个 Agent：

1. **观察试点**：只允许查询业务和观测数据，不允许调用任何恢复或写入 operation。
2. **RCA 试点**：要求 Agent 输出症状、疑似根因、证据引用、影响范围、置信度和不确定性。
3. **恢复建议试点**：要求 Agent 给出建议动作、前置条件、风险、验证步骤和回退方案；Operator 负责审核和实际执行。
4. **单运行重复试点**：在同一专用环境中按顺序重复运行，验证 RCA 一致性、证据归档和回退，不用于跨 Agent 排名。

首个场景应满足：

- 资源影响边界清晰；
- 不需要破坏性人工清理；
- 证据容易采集；
- 恢复路径明确；
- RCA 与恢复建议能够与实际 Operator 恢复动作分开验证；
- 不会因为评估失败而污染共享环境。

首个试点不要求先完成通用 `isolated-trial`，但必须使用一套明确隔离于其他使用者的专用环境。环境配置、镜像版本、数据规模、控制面版本和观测窗口必须写入 Evidence Query Manifest，方便后续迁移到正式隔离模型。

**验收门槛**：

- Agent 不能读取 Ground Truth、Operator secret 或其他运行/环境数据。
- Agent 所有请求都可审计并可撤销。
- Agent 不能调用恢复、release、cleanup 或业务写 operation。
- Agent 不能提交自己的分数、声称恢复已执行或修改原始证据。
- Operator 仍可独立停止、恢复和清理。
- 评估报告能够解释“未发现、RCA 错误、证据不足、建议不安全、Operator 未执行、业务未恢复、清理失败”的差异。

**上线方式**：

1. 只在专用测试环境启用。
2. 每次只允许一个 Agent 任务和一个 active Fault Run。
3. 只开放只读观测、RCA 提交和恢复建议提交。
4. Operator 审核后仍使用现有控制面执行恢复，不通过 Agent Access 代理恢复。
5. 试点结果只作为产品和技术验证，不发布排行榜或跨 Agent 结论。

**回退方式**：

- 撤销或让 Agent token 立即过期。
- 停止 Agent Access Broker 和 Result Gateway。
- 由 Operator 通过现有控制面停止、恢复和清理 Fault Run。
- RCA、恢复建议、Evidence 和评估表保留为审计材料，不回写业务数据或修改历史 Run Event。

### 阶段 6：引入 Environment Profile 和资源/数据隔离

**目标**：将阶段 5 的专用单环境试点扩展为可重复、可验证、可并行的 Trial 基础设施。

#### 6.1 Profile

| Profile | 默认用途 | 主要策略 |
| --- | --- | --- |
| `lite` | 前端、接口和控制面开发 | 核心服务、MySQL、Redis；关闭大规模预热和可选重观测 |
| `full` | 完整故障演练 | 保留当前完整服务和观测栈，维持现有行为 |
| `benchmark` | 可比较运行 | 固定镜像、配置、seed、数据 profile、证据采集和安全策略 |
| `isolated-trial` | 并行实验 | 独立 Compose project/namespace、数据库、Redis 前缀或完整 stack |
| `observability-heavy` | 深度诊断 | 按需启用额外 Recorder、SkyWalking 或高保真 Trace |

#### 6.2 隔离原则

- 共享数据库上的多个 Fault Run 不等于多个公平 Trial。
- 只有确认数据库、Redis、文件卷、端口、观测数据和控制面状态隔离后，才允许并行。
- 每个 Trial 必须拥有 `environmentId`、配置 revision、数据 profile 和销毁状态。
- 本地 `lite` 不应默认写入 5400 万行历史数据。
- `full` 的默认行为先保持不变，profile 切换通过显式配置完成。
- 阶段 5 的单环境试点结果只有在隔离边界可证明后，才可以用于跨 Agent 或跨版本比较。
- 阶段 5 的 Agent Access 即使迁移到隔离环境，默认仍保持只读 RCA 模式；是否增加受控恢复执行必须另立阶段和安全评审。

**第一版上线方式**：

1. 先提供 `lite`，只做开发体验优化。
2. 再提供 `benchmark`，只允许单 Trial。
3. 将阶段 5 的专用环境迁移到由 `Environment` 标识和管理的环境。
4. 再验证两个独立 `isolated-trial` 并行。
5. 验收通过后，才允许 Campaign 调度多个 Trial。

**验收门槛**：

- 两个相同场景在两个隔离环境运行时，Redis、MySQL、文件和事件互不污染。
- 一个环境销毁不会影响另一个环境。
- Trial 证据可以明确绑定环境和镜像/配置版本。
- 环境启动失败、容量不足和销毁失败均有明确状态。
- 阶段 5 的 Agent Access 在迁移到隔离环境后仍保持相同的权限和审计边界。

### 阶段 7：规模化、异步和领域扩展

**目标**：在前六个阶段稳定后，才进入更高风险的架构扩展。

#### 7.1 Worker Pool 和多副本

前置条件：

- owner lease、heartbeat 和 fencing 已稳定。
- Reconciler 已通过重启、接管、网络分区测试。
- isolated Trial 已能互不污染。
- drain 和失败传播已经覆盖所有持续 Worker。

扩展顺序：

1. 单 Worker 多任务但仍单副本。
2. 两个 Worker 副本，其中一个只做 standby。
3. 一个 active、一个 standby 的自动接管。
4. 按 Environment/Trial 分配 Worker。
5. 最后才考虑共享 Worker Pool。

#### 7.2 Outbox 和可选消息驱动

不直接把所有同步 HTTP 改成消息队列。建议：

1. 先为支付结果、通知和履约事件增加事务 Outbox spike。
2. 保留当前同步模式作为 `sync` profile。
3. 增加可选 broker profile。
4. 单独验证重试、重复投递、顺序、积压和最终一致性。
5. 将同步级联和异步积压作为不同类型的演练。

#### 7.3 FinOps 和 CISO

FinOps、CISO 复用：

```text
Environment Profile
  -> Scenario Contract
  -> Trial/Fault Run Lifecycle
  -> Evidence Query Manifest
  -> Evaluator
```

不要为 FinOps/CISO 再创建完全独立的生命周期协议。

## 6. 分阶段验收总表

| 阶段 | 能力结果 | 必须通过的门槛 | 默认上线范围 |
| --- | --- | --- | --- |
| 0 基线护栏 | 有基线、事件、回退和资源预算 | 12 个场景都可诊断和回退 | 所有开发/测试环境，旁路 |
| 1 安全停止 | drain、总超时、失败传播 | 停止、到期、重启、失败测试通过 | 单 Worker 测试环境 |
| 2 所有权与重协调 | owner lease、heartbeat、reconcile | 双 Worker 竞争、接管和旧 owner 拒绝通过 | 单副本默认，测试 opt-in |
| 3 Scenario Contract | Catalog/Gateway/Worker/测试不漂移 | 12 个场景 contract validation 通过 | CI blocking，运行时不改变 |
| 4 Evidence Query | 时间线、查询窗口/配方、效果/恢复/清理分离 | 一个场景生成 Query Manifest 并可在 retention 内复查 | Operator 旁路查询报告 |
| 5 Agent Pilot | Agent access、RCA、恢复建议和首个评估报告 | 凭据、Ground Truth、证据隔离，且无恢复写权限 | 专用单环境，单运行 |
| 6 Profile/Isolation | lite、benchmark、isolated-trial | 两个环境互不污染 | opt-in |
| 7 Scale/Domain | Worker Pool、Outbox、FinOps/CISO | 前置阶段全部稳定 | 按能力和环境逐项启用 |

## 7. 每阶段的发布门禁

### 7.1 可靠性门禁

- 单元测试、合同测试和必要的集成测试通过。
- 失败、超时、取消、重启、网络抖动和清理失败都有明确结果。
- 无静默成功、无 broad catch、无成功形状的 fallback。

### 7.2 真实性门禁

- 场景仍通过真实业务路径和真实资源产生效果。
- 不新增固定 sleep、伪造结果或脱离业务链路的故障接口。
- 目标效果、告警、恢复和清理没有被写成必然承诺。

### 7.3 安全门禁

- 消费者接口、日志、指标、Trace 不泄露控制面字段。
- Agent 不拥有 Operator session 或内部 service key。
- 内部 operation 仍使用固定 allowlist。
- Secret、token、kubeconfig、Evidence 和 Ground Truth 有明确的访问边界。

### 7.4 数据门禁

- migration 可重复执行或明确拒绝重复执行。
- 新旧版本短期兼容。
- Trial、Evidence、Run Event 的保留和清理策略明确。
- 失败证据不能覆盖原始证据。

### 7.5 运维门禁

- 有发布、灰度、停止和回退步骤。
- 有 dashboard、日志关键词和告警阈值。
- 有演练后残留资源检查。
- 有升级期间 active Fault Run 的处理策略。

## 8. 灰度、回退和数据库策略

### 8.1 Feature flag

新能力默认采用 opt-in：

```text
新代码部署
  -> 默认关闭新执行路径
  -> 旁路记录新路径结果
  -> 测试环境开启
  -> 单环境 canary
  -> 小范围默认开启
  -> 全量默认开启
```

建议为以下能力保留独立开关：

- 新 drain/stop 路径。
- Reconciler 自动接管。
- Evidence Query Manifest。
- benchmark profile。
- Agent Access。
- Outbox/broker。

开关不能绕过安全校验，也不能让消费者请求进入内部 operation。

### 8.2 Expand/contract migration

数据库变更采用：

```text
Expand
  -> 新增 nullable 字段/表/索引
  -> 新旧代码都能运行
  -> 双写或回填
  -> 读取新字段并观测
  -> 停止旧代码
  -> Contract 删除旧结构
```

禁止在一个发布中同时：

- 删除旧列；
- 修改所有服务读取逻辑；
- 切换 Worker 所有权；
- 更改 Fault Run 状态机；
- 启用多副本。

### 8.3 回退原则

- 代码回退不能依赖已经删除的数据库字段。
- 如果新状态已经写入，旧版本必须能安全忽略或读取兼容字段。
- active Fault Run 回退前必须先停止新 Worker，再确认旧 Worker 能识别状态。
- Agent Access 和 Evidence schema 不影响当前 Operator 停止/恢复路径。

## 9. 建议的首批增量

如果现在只准备开始三个小增量，建议按以下顺序：

### 增量 A：运行基线和失败测试

**不改变运行行为**，先补：

- 当前 12 个场景的 baseline 记录。
- Coordinator 状态转换和失败分类测试。
- 报表/流量 Worker 停止边界测试。
- `git diff --check`、控制面现有测试、类型检查和 lint。

### 增量 B：报表/流量 Worker 的 run-specific drain

**只改善停止行为**，不引入多副本：

- 注册 drain。
- 停止接收新请求。
- 等待 in-flight 请求。
- 写入 drain 结果。
- 失败时保持明确的 recovery 状态。

### 增量 C：Catalog/Target/Worker 合同校验

**只增加 CI 校验**，不生成生产代码：

- 校验 12 个 Catalog 场景与 Gateway target map。
- 校验 Worker dispatch 和 recovery strategy。
- 校验每个场景的参数、时长、runbook、证据和 i18n 覆盖。

完成这三个增量后，先完成 Evidence Query Manifest v0，再进入专用单环境的 Agent Access 和单场景评估试点；试点稳定后再开始通用 profile、资源/数据隔离和多 Trial。不要在此之前启动 Worker Pool 或消息队列。

## 10. 路线图与产品/技术文档的关系

| 文档 | 负责回答的问题 |
| --- | --- |
| `product.md` | 为什么做、服务谁、用户体验、范围、成功指标和验收标准 |
| `tech.md` | 怎么做、模块边界、数据模型、接口、迁移、测试和部署 |
| `roadmap.md` | 先做什么、后做什么、每阶段如何上线、何时可以进入下一阶段、如何回退 |

每个阶段开始前：

1. 在 `product.md` 增加或确认该阶段的用户目标和验收标准。
2. 在 `tech.md` 增加实现方案、兼容策略和测试计划。
3. 在本 roadmap 更新阶段状态、依赖和实际发布范围。
4. 只有当前阶段的门禁通过，才进入下一阶段。

## 11. 阶段状态记录模板

每次发布后在本文件对应阶段补充：

```markdown
### 状态记录

- 状态：未开始 / 设计中 / 开发中 / 测试中 / 灰度中 / 已发布 / 已回退
- 发布版本：
- 启用环境：
- 已完成能力：
- 未完成能力：
- 观测结果：
- 已知问题：
- 回退点：
- 下一阶段入口条件：
```

## 12. 最终路线判断

Castrel Chaos 的演化顺序不应是：

```text
先增加 Agent、消息队列、Leaderboard 和大量新场景
```

而应是：

```text
先把当前运行停得住、接得住、恢复得清楚
  -> 再把场景契约和测试固化
  -> 再把运行证据归档
  -> 再开放最小权限 Agent，完成单场景评估试点
  -> 再建设资源/数据隔离和可比较 Trial
  -> 最后扩展规模、异步和新领域
```

这样每一步都可以独立上线、独立验证、独立回退，并且不会因为演化平台本身而破坏 Castrel Chaos 最有价值的能力：**让故障真正经过业务系统和真实资源路径。**
