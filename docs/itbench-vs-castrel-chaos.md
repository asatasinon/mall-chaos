# ITBench 与 Castrel Chaos 整体架构对比及演进建议

> 分析日期：2026-09-09  
> 对比对象：本仓库 `castrel-chaos` 与附加目录 `/Users/raven/code/ITBench`  
> 结论基于两个项目当前工作树中的 README、架构文档、运行脚本、核心源码、部署清单和测试配置。本文是架构决策文档，不替代两个项目各自的运行手册。

## 1. 结论摘要

ITBench 和 Castrel Chaos 不是同一类产品，因此不存在脱离目标的绝对优劣：

| 目标 | 更占优势的架构 | 原因 |
| --- | --- | --- |
| 评估 AI Agent 的诊断、修复和合规能力 | ITBench | 以 Scenario、Fault、Waiter、Ground Truth、Recorder、Evaluator 和 Trial 为中心，实验边界和评分边界更清晰。 |
| 演示真实业务系统中的故障传播 | Castrel Chaos | 故障嵌入真实电商业务路径，覆盖 HTTP、SQL、Redis、JVM、文件系统、数据库锁和 PSP。 |
| 单次本地演练的可控性和恢复闭环 | Castrel Chaos | Fault Run 有持久状态、fencing、lease、幂等、补偿、停止、恢复、审计和留存。 |
| 多场景、多 Trial、跨环境并行 | ITBench | AWX Head/Runner、独立集群和异步 workflow 更适合批量实验。 |
| 消费者路径安全和业务语义隔离 | Castrel Chaos | Shopfront、Gateway、业务服务和控制面边界明确，目标服务不解释 catalog 或生命周期语义。 |
| 场景组合和资源复用 | ITBench | Application、Tool、Fault、Waiter 与 Scenario 通过模板、索引和 Schema 组合。 |
| 生产化扩展基础 | 两者各有短板 | ITBench 的运行资源和权限较重；Castrel 当前受共享 MySQL、单副本 Worker、同步调用和有限迁移能力约束。 |

**总体判断：**

1. Castrel Chaos 的核心方向是正确的，不应为了“像 ITBench”而改造成 Ansible/AWX 驱动的 Kubernetes 基准平台。
2. Castrel 最值得吸收的是 ITBench 的**实验评估层**：标准化场景契约、Ground Truth/Evidence、Trial/Campaign、快照与回放、评分和结果归档。
3. Castrel 最需要优先补强的是自己的**运行可靠性层**：Worker 所有权、停止 drain、状态重协调、失败传播、确定性和多运行隔离。
4. ITBench 的大规模集群编排、完整 Recorder 栈和宽权限 Agent 模型不应直接复制到 Castrel 默认部署；应作为可选的 benchmark profile 或外部适配器。

可以将两者的关系概括为：

```text
ITBench     = 可复现 IT 环境 + Agent 接口 + Ground Truth + 批量评估
Castrel     = 真实电商数据面 + Fault Run 控制面 + 资源级故障 + 恢复闭环

推荐目标：
Castrel     = 真实业务故障平台
              + 可复现 Trial/Artifact
              + 可解释 Evidence/Evaluator
              + 可选多环境编排
```

## 2. 对比范围和分析方法

### 2.1 ITBench 侧重点

ITBench 的主要证据位于：

- `/Users/raven/code/ITBench/README.md`
- `/Users/raven/code/ITBench/documentation/architecture.md`
- `scenarios/sre/templates`、`scenarios/sre/project`、`scenarios/sre/tools`
- `scenarios/ciso`
- `schemas/json`
- `.github/workflows`

其主线是：

```text
Scenario/模板
    -> 生成索引、Schema、文档和运行资源
    -> 创建或选择隔离集群
    -> 部署 Application 和 Tool
    -> 启动 Recorder
    -> 注入 Fault
    -> 授予 Agent 受限访问
    -> Agent 诊断和修复
    -> 导出观测数据
    -> Ground Truth/Evaluator 判定结果
    -> 清理环境并汇总 Trial/Leaderboard
```

SRE/FinOps 主要通过 Ansible Role、Makefile 和 AWX 执行；CISO 使用独立的 bundle、Makefile、Playbook 和专用评估器。

### 2.2 Castrel Chaos 侧重点

Castrel 的主要证据位于：

- `docs/architecture-overview.md`
- `docs/microservice-topology.md`
- `traffic-control-plane/src/lib/fault-run-catalog.ts`
- `traffic-control-plane/src/lib/fault-run-coordinator.ts`
- `traffic-control-plane/src/worker`
- `gateway-service`、`common` 以及各业务服务
- `infra/mysql/init`、`infra/prometheus`、`docker-compose.yml`、`k8s`

其主线是：

```text
运营者创建 Fault Run
    -> Catalog 校验目标、参数和时长
    -> MySQL 持久化 CREATING 和 fencingToken
    -> Gateway prepare 固定业务 operation
    -> 目标服务建立运行级资源或状态
    -> Worker 持续产生真实业务请求/资源竞争
    -> Prometheus、日志、Trace 和业务指标记录影响
    -> 手工停止或到期
    -> Worker drain
    -> Gateway release/cleanup
    -> STOPPED/RECOVERED/FAILED
    -> 审计、事件和 retention
```

Castrel 的消费者链路是：

```text
Browser -> Shopfront -> Gateway
        -> User / Catalog / Cart / Order / Payment
        -> Promotion / Risk / Inventory / Fulfillment / Notification
        -> PSP Simulator
```

控制面不应成为消费者业务异常的替代入口；它只负责选择固定目标、协调生命周期、限时、审计和恢复。

## 3. 两种架构的本质差异

### 3.1 ITBench 是“评测平台优先”

ITBench 的第一类对象是实验和任务：

```text
Application + Tool + Fault + Waiter + Scenario + Ground Truth + Trial
```

它关心的问题是：

- Agent 是否发现异常；
- 是否定位根因；
- 是否采取正确修复；
- 修复是否使环境恢复；
- 不同 Agent 是否能在相同环境和相同任务上公平比较；
- 多次实验的观测和结果是否可导出、复现和汇总。

因此它把环境隔离、权限交接、数据录制、Ground Truth、评估器和 Leaderboard 放在核心位置。

### 3.2 Castrel 是“真实业务与恢复优先”

Castrel 的第一类对象是业务系统和运行控制：

```text
Customer Flow + Business Services + Resource Effect + Fault Run + Recovery
```

它关心的问题是：

- 商品、购物车、Checkout、支付和通知是否走真实业务链路；
- SQL、Redis、JVM、文件系统、数据库锁和外部支付依赖是否真实承受影响；
- 控制面是否不能绕过 Gateway 任意触达服务；
- 场景是否可停止、可恢复、可审计；
- 消费者是否只看到正常业务语义，而不会看到演练字段。

因此它把 Gateway 固定 operation、服务间认证、fencing、lease、补偿、审计和恢复状态放在核心位置。

### 3.3 结论

ITBench 解决的是“**如何公平、可重复地评估 Agent**”；Castrel 解决的是“**如何在真实业务系统中制造并控制可观察的运行行为**”。Castrel 后续应增加评估能力，但不应牺牲真实业务路径和控制面边界。

## 4. 关键架构对比

| 维度 | ITBench | Castrel Chaos | 对 Castrel 的启示 |
| --- | --- | --- | --- |
| 产品目标 | AI Agent 的企业 IT 任务基准 | 电商业务链路和 SRE/可观测性故障演练 | 保留 Castrel 的业务真实性，增加可重复评测层。 |
| 核心实体 | Application、Tool、Fault、Waiter、Scenario、Ground Truth、Trial | Customer、业务资源、Fault Run、Run Event、Runner、Lease、Fencing Token | 可在 Fault Run 上补充 Trial、Evidence 和 Evaluation，而不是重命名现有业务实体。 |
| 运行环境 | 每次场景通常有独立 Kubernetes/RHEL 环境 | Compose/Kubernetes 中的一套完整电商系统，共享 MySQL/Redis | 第一阶段继续单环境演练；需要并行时增加 Environment/Trial 隔离，而不是直接共享全局资源。 |
| 故障实现 | Ansible task、Chaos Mesh、配置/资源变更、合规策略 | 真实报表 SQL、Redis Hash、JVM 对象、文件追加、表锁/行锁、PSP HTTP | Castrel 真实资源路径更适合业务故障培训；ITBench 的 Fault 元数据和参数 Schema 值得借鉴。 |
| 场景组合 | 通过索引、模板和 Schema 组合 Application/Tool/Fault/Waiter | Catalog 绑定固定 service、operation、参数、时长和 recovery | Castrel 应把 prepare/active/release/evidence/evaluate 也纳入统一契约，并生成相关代码校验。 |
| 控制面 | Makefile、Ansible、AWX 和场景 bundle | Next.js 控制台、MySQL/Redis、独立 Worker、Gateway | Castrel 控制面更贴近在线服务；需要补充统一 Reconciler 和批量 Campaign。 |
| Agent 边界 | 临时 kubeconfig、Prometheus 和观测工具；权限偏宽但环境隔离 | 当前核心是 Operator 控制面和业务 Runner；业务服务不暴露 catalog 语义 | Castrel 若开放 Agent，应单独建 Agent Access Bundle，不应复用 Operator 权限。 |
| 生命周期 | deploy tools/app → recorder → fault → agent → record → evaluate → cleanup | create → prepare → active → stop/expire → drain → release/recover → retention | ITBench 的 evaluation/export 阶段值得加入；Castrel 的持久状态和恢复语义应保留。 |
| 状态持久化 | 状态文件、AWX 状态、Recorder 输出和场景目录 | Fault Run、Run Event、审计、fencing、幂等和恢复结果入 MySQL | Castrel 状态模型更适合长期运行，但需要启动后 reconciliation 和 owner lease。 |
| 观测 | Metrics、Alerts、Logs、Traces、K8s Events、Object Snapshot、Topology、Cost | Actuator/Micrometer、Prometheus、Alertmanager、JSON Logs、Loki、Tempo、业务指标 | Castrel 应增加按 Trial 的证据清单和快照，不宜默认引入全部 ITBench 重型组件。 |
| 评估 | Ground Truth、solution、策略报告、专用 evaluator、Leaderboard | 主要记录运行状态、业务结果、告警和审计；没有统一 Agent 得分协议 | 这是 Castrel 最大的能力缺口，应作为 P1 建设。 |
| 多 Trial | AWX Head/Runner，多个集群和异步 workflow | 当前单控制面/单 Worker 假设，活动运行全局唯一 | 先引入 Campaign/Trial 数据模型，再做 Worker 池和环境隔离。 |
| 并发隔离 | 集群或 Runner 隔离，适合并行实验 | 共享 MySQL/Redis/端口/资源，当前 active run 只有一个 | 不应在共享数据库上直接并行；需要环境级 fencing 或独立 Compose/K8s stack。 |
| 清理和恢复 | 依赖 AWX workflow 完整走到清理节点；部分失败可能只记日志 | 有 compensation、release、cleanup、retention 和服务不可用状态 | Castrel 生命周期更完整，但需修复未注册 drain 和失败传播。 |
| 可重复性 | 场景文件、应用版本、Recorder 和 Ground Truth 可归档 | 结果受 MySQL、Redis、JVM、磁盘、镜像和数据预热规模影响 | 增加 seed、镜像 digest、配置 revision、数据 profile 和 Evidence bundle。 |
| 扩展代价 | 新 Fault/Scenario 有模板、索引、Schema、文档和测试流程 | 新场景通常跨 Catalog、Gateway、目标服务、Worker、runbook 和测试 | Castrel 需要生成式 contract/test scaffolding，减少跨层遗漏。 |
| 运行资源 | Prometheus、ClickHouse、OpenSearch、OTel、Jaeger、Istio、Gateway、OpenCost 等较重 | 业务服务多，但默认观测栈和预热也有较高资源成本 | 两者都需要 `lite/full/benchmark` profile；不要把最重配置作为默认开发路径。 |
| 安全边界 | Sandbox 内 Agent 权限可较宽，kubeconfig/Token 管理要求高 | 消费者、Operator、Gateway、内部服务密钥和业务服务边界更细 | Castrel 的公开路径安全设计更强；Agent 能力要使用短时、最小权限和独立审计。 |
| 领域覆盖 | SRE、FinOps、CISO | 电商 SRE、依赖、资源竞争和恢复 | Castrel 可在同一运行协议上增加 FinOps/CISO 业务任务，但不要复制 CISO 的双协议问题。 |
| 部署模型 | 本地 Kind/Minikube、AWS/kOps、AWX、多 Runner | Docker Compose、源码进程、Kubernetes | Castrel 默认部署更容易上手；规模化编排可作为外部 Runner/平台适配器。 |
| 测试 | Python/Go 单测、Molecule、E2E、Schema/文档校验 | Java 单测、控制面测试、Shopfront E2E、smoke、baseline、静态术语检查 | 增加场景契约测试、状态机属性测试、故障注入失败测试和 Trial 结果一致性测试。 |

## 5. ITBench 相对 Castrel 的优势

### 5.1 评测边界更完整

ITBench 明确把以下内容作为同一个任务协议的一部分：

```text
问题环境
    + Agent 可用工具和权限
    + 故障前/中/后观测
    + Ground Truth
    + 评估器
    + Trial 结果和排行榜
```

Castrel 当前已经有运行记录、事件、审计和告警，但这些数据主要回答“运行发生了什么”，还不能统一回答“Agent 做得是否正确、为什么得分、是否造成了额外副作用”。

### 5.2 场景组合和复用更强

ITBench 的 SRE/FinOps 场景不是每个都复制一套 Playbook，而是把 Application、Tool、Fault、Waiter 和 Scenario 组合起来。模板、索引、JSON Schema 和自动生成文档形成了相对完整的资源库工作流。

Castrel 当前新增一个场景通常需要同时修改：

1. `fault-run-catalog.ts`；
2. Gateway 固定 operation；
3. 目标服务的内部 operation；
4. 一个或多个 Worker；
5. prepare/release/cleanup；
6. runbook、国际化、测试和 smoke；
7. 术语隔离和消费者可见错误检查。

这种方式安全边界更强，但容易出现 catalog、Gateway、Worker 和目标服务之间的契约漂移。ITBench 的 Schema/生成/校验思路可以降低这种风险。

### 5.3 隔离和批量试验能力更成熟

ITBench 可用 Kind、Minikube、kOps 和 AWX Head/Runner 组织多个环境与 Trial，适合：

- 比较多个 Agent；
- 重复执行同一 Scenario；
- 分配不同 Runner；
- 导出同一格式的实验结果；
- 支持公开 Leaderboard。

Castrel 当前部署更接近单环境、单控制面、单 Worker 的训练平台。它适合交互式演练，但不适合在共享资源上直接进行大批量公平评测。

### 5.4 观测数据更接近“实验档案”

ITBench 的 Recorder 会在不同阶段采集告警、Trace、日志、Kubernetes 事件、对象快照、Topology 和成本信息，并把数据按 Agent、Experiment、Scenario、Trial 分层导出。

Castrel 已经有很强的实时观测基础，但仍缺少一个稳定的：

```text
trial/
  metadata.json
  timeline.json
  pre-state/
  active-evidence/
  post-state/
  traces/
  metrics/
  logs/
  evaluation.json
```

式的运行档案。

### 5.5 跨 SRE、FinOps、CISO 的任务表达更宽

ITBench 直接把 SRE、FinOps 和 CISO 纳入同一产品定位，虽然 CISO 当前仍是独立协议。Castrel 若要从业务故障演练扩展到 Agent 评测，可以借鉴其领域划分和 Leaderboard 组织方式。

## 6. Castrel Chaos 相对 ITBench 的优势

### 6.1 真实业务链路更深

Castrel 的异常不是独立的演示接口，而是经过正常业务路径：

```text
浏览器
  -> Shopfront
  -> Gateway
  -> Cart/Catalog/Order/Inventory/Promotion/Risk/Payment
  -> Fulfillment/Notification
  -> PSP
```

这使得一次故障可能自然地影响：

- 业务延迟和错误率；
- 连接池、事务和锁等待；
- Redis 命中和回源；
- 支付状态和订单状态；
- 履约和通知；
- 日志、Trace、指标和告警。

ITBench 的 SRE 应用更适合制造 Kubernetes/基础设施故障；Castrel 对“业务异常如何传播到平台信号”的展示更有说服力。

### 6.2 运行控制的 fencing、lease 和补偿更系统

Castrel 在控制面和目标服务之间使用：

- MySQL active-run 唯一约束；
- 幂等键；
- 单调 fencing token；
- Redis `OperationRunGuard`；
- 数据预热 lease 和心跳；
- 过期恢复；
- release/cleanup；
- 审计事件和 retention。

这些机制比“执行一组 Playbook 后删除资源”更适合长期运行的在线控制面。

### 6.3 控制面与消费者语义隔离更严格

Castrel 明确要求：

- 控制面业务调用必须经 Gateway；
- Gateway 只接受固定 operation；
- 目标服务不接受 catalog 身份；
- `/internal/**` 只承载通用 operation、opaque runId、expiry、idempotency 和 fencing；
- 消费者不能看到 Fault Run、场景 ID、控制状态或原始堆栈；
- 运行时业务服务不使用演练术语。

这比直接把 Agent 暴露为拥有较宽 Kubernetes 权限的运维主体更适合展示真实产品的安全边界。

### 6.4 本地开发路径更直接

Castrel 通过 Docker Compose、脚本、固定端口、控制台和 Shopfront 提供一套完整本地环境。ITBench 要管理集群、Ansible Collections、应用、工具栈、Recorder 和可能的 AWX，能力更宽，但首次运行成本更高。

### 6.5 运行效果的业务真实性边界更清楚

Castrel 明确区分：

- 真实文件追加不等于磁盘必然写满；
- JVM 对象保留不等于必然 OOM；
- 锁竞争不等于必然死锁；
- 场景启动不等于告警必然触发；
- `durationSec` 结束受控活动，不承诺删除所有资源；
- PSP outcome 必须经过独立 HTTP 客户端。

这种“只承诺可控行为，不承诺偶然资源结果”的表达，有助于避免演练平台把环境相关结果误说成确定性测试结论。

## 7. 两个项目的主要局限

### 7.1 ITBench 的局限

1. **三种领域没有统一的运行协议。** SRE/FinOps 使用通用 Scenario Runner，CISO 使用独立 bundle、Makefile 和评估器，导致入口、状态、Ground Truth 和 CI 不一致。
2. **资源和外部依赖较重。** Prometheus、ClickHouse、OpenSearch、OTel、Jaeger、Istio、Gateway、Chaos Mesh、OpenCost 和多个 Recorder 使本地运行成本高。
3. **Agent 权限偏宽。** Namespace 内可能绑定 `admin`，并有 Node patch、PriorityClass 等 Cluster 级权限，更适合隔离 benchmark sandbox，不适合直接用于生产集群。
4. **异步 Fault 失败传播不够严格。** 当前 Fault Runner 的失败/超时可能只记录日志而不向上游传递非零失败状态。
5. **等待和清理的兜底不足。** 某些等待缺少总超时；AWX 清理节点未执行时需要人工处理。
6. **观测数据生命周期不够完整。** 虽支持本地/S3，但保留周期、压缩、加密、脱敏、重试、幂等索引和跨 Trial 查询能力仍需加强。
7. **生成产物和文档存在漂移风险。** README 统计、CISO bundle 操作名和个别模板条件判断都需要持续校验。
8. **业务真实性有限。** 许多故障作用于 Kubernetes 工作负载或平台资源，不一定经过完整的消费者业务状态机。

### 7.2 Castrel Chaos 的局限

1. **缺少统一的 Agent 评估协议。** 当前更擅长运行和恢复，不擅长给多个 Agent 做可解释、可重复的横向评分。
2. **共享资源限制并行实验。** 服务逻辑分开，但物理上共享 MySQL、Redis、连接池和 I/O；活动运行全局唯一，无法直接安全扩展到多 Trial。
3. **Worker 多副本模型尚未完成。** 直接扩容可能造成 Runner、场景请求、补给、timer 或 recovery 重复执行。
4. **部分 Worker 的 drain 接入不完整。** 报表和流量执行器需要确认是否注册并响应 Coordinator 的 drain，否则停止时可能继续运行到下一次扫描或过期。
5. **同步 HTTP 可能放大级联故障。** Checkout、支付、通知和履约之间没有消息队列或持久化 Outbox。
6. **Schema 演进偏向 clean install。** 现有初始化 DDL 适合新环境，不足以支持长期多版本升级和回滚。
7. **确定性仍不统一。** Notification/Risk 存在随机业务结果，PSP timeout 使用固定 `Thread.sleep(60_000)`，不利于严格复现实验。
8. **专用观测信号仍有空白。** 锁等待/deadlock、Redis 单 key 大小、报表扫描行数/查询计划、文件增长速率和运行级资源消耗还可以更明确。
9. **数据预热成本高。** 默认 `180 × 300000 = 54000000` 行的规模会明显竞争 MySQL CPU、磁盘、redo/undo、buffer pool 和连接。
10. **部署安全默认值偏开发。** Grafana、Prometheus、Loki、Tempo、OTLP、数据库和 Redis 的访问控制需要部署人员主动收紧。
11. **效果依赖运行资源。** OOM、磁盘耗尽、锁等待、告警和恢复耗时都不能被承诺为必然结果；评估器需要区分“控制动作完成”和“资源后果实际发生”。

## 8. Castrel 后续改进方向

### 8.1 P0：先补运行可靠性，不先扩展场景数量

#### P0-1：建立统一状态重协调器和 Worker 所有权

建议在控制面中形成明确的 Reconciler：

```text
数据库中的事实状态
        |
        v
Reconciler
  - 发现 CREATING/ACTIVE/RECOVERING
  - 检查 owner lease 和 fencing
  - 启动、恢复或停止对应 Worker
  - 处理过期、孤儿资源和重复执行
  - 写入结果和事件
```

具体建议：

- 为 Worker 实例增加 owner lease、heartbeat、owner ID 和 fencing；
- 将内存 timer 视为加速机制，不把它作为唯一状态来源；
- Worker 启动、重启、失联和接管都必须通过数据库状态重建；
- 只有当前 owner 能执行 prepare、active、release 和 cleanup；
- 对每个运行保存最后心跳、最后动作、in-flight 请求数和 drain 状态。

验收标准：

- Worker 在任意阶段重启后不会重复 prepare 或重复 release；
- 两个 Worker 同时启动时只有一个能够持有执行权；
- 旧 Worker 的请求在 fencing 失效后被目标服务拒绝；
- 到期运行在重启后仍能被发现并进入 recovery。

#### P0-2：修复停止 drain 和失败传播

每类持续执行器都应实现同一接口：

```text
start(run)
  -> registerDrain(run)
  -> stopAcceptingNewWork(run)
  -> awaitInFlight(run, deadline)
  -> reportDrainResult(run)
  -> release(run)
```

必须特别覆盖：

- 报表 Worker；
- 流量 Surge Executor；
- Redis/锁/存储等专用 Scenario Worker；
- 客户生命周期 Runner；
- 数据预热和补给。

同时规定：

- Ansible、Gateway、目标服务和 Worker 的失败必须向上游传播；
- 超时、取消、部分成功和清理失败使用不同结果；
- 任何“记录失败但进程返回成功”的路径都应增加测试；
- 所有等待都必须有总超时和可诊断的最后状态。

#### P0-3：把 Catalog 变成真正的单一运行契约

当前 Catalog 已经是场景事实来源，但 Gateway operation 映射、目标服务协议、Worker 分派和 runbook 仍存在多处人工维护。建议将每个场景扩展为如下契约：

```ts
type ScenarioDefinition = {
  id: string
  target: {
    service: string
    operation: string
  }
  parameters: JsonSchema
  duration: { minSec: number; maxSec: number }
  lifecycle: {
    prepare: string
    start?: string
    stop?: string
    release: string
    cleanup?: string
  }
  evidence: {
    metrics: string[]
    logs: string[]
    traces: string[]
    businessChecks: string[]
  }
  evaluation: {
    expectedSignals: string[]
    recoveryChecks: string[]
    sideEffectChecks: string[]
  }
  isolation: {
    redisPrefix: string
    dataScope: string
  }
}
```

不应把上面的类型原样暴露给业务服务；它属于控制面和测试生成层。目标服务仍只接收通用内部 operation、opaque run context 和业务参数。

建议由该契约生成或校验：

- Gateway 固定 operation 映射；
- 控制面参数校验；
- Worker dispatch 表；
- prepare/release 合同测试；
- runbook 必需章节；
- 中英文显示信息；
- smoke test 所需的证据查询；
- 术语隔离清单。

### 8.2 P1：引入 ITBench 风格的 Trial、Evidence 和 Evaluator

#### P1-1：增加 Experiment/Campaign/Trial 三层模型

不要把 `Fault Run` 直接改造成批量实验对象。建议保留 Fault Run 的在线控制语义，新增上层实验对象：

```text
Experiment
  -> Campaign
      -> Trial
          -> Fault Run
```

推荐字段：

| 对象 | 关键字段 |
| --- | --- |
| Experiment | `experimentId`、名称、创建者、目标 Agent 集合、默认环境 profile |
| Campaign | `campaignId`、scenario、参数矩阵、并发上限、停止策略 |
| Trial | `trialId`、`agentVersion`、`environmentId`、`catalogRevision`、`seed`、镜像 digest、开始/结束时间、结果 |
| Fault Run | 现有 `faultRunId`、目标快照、fencing、状态和恢复结果 |

这样可以同时支持：

- 交互式单次演练：只创建一个 Fault Run；
- 重复实验：一个 Campaign 生成多个 Trial；
- Agent 对比：同一 Scenario 和环境 profile 绑定不同 Agent 版本；
- 后续 Leaderboard：按 Trial 结果聚合，而不污染在线控制状态。

#### P1-2：定义 Evidence Manifest

每个 Trial 结束后生成控制面可读、Agent 不可写的证据清单：

```json
{
  "trialId": "…",
  "scenarioId": "…",
  "catalogRevision": "…",
  "environmentProfile": "benchmark",
  "seed": 12345,
  "timeline": {
    "createdAt": "…",
    "preparedAt": "…",
    "activeAt": "…",
    "agentStartedAt": "…",
    "agentFinishedAt": "…",
    "recoveredAt": "…"
  },
  "artifacts": [
    { "kind": "metrics", "uri": "…", "sha256": "…" },
    { "kind": "logs", "uri": "…", "sha256": "…" },
    { "kind": "traces", "uri": "…", "sha256": "…" }
  ],
  "businessChecks": {
    "consumerPathAvailable": true,
    "targetEffectObserved": false,
    "cleanupCompleted": true
  }
}
```

证据采集应在控制面/观测面完成，不要把 Fault Run 字段注入消费者响应、业务服务日志或公开业务 Trace 属性。

#### P1-3：定义可解释评分，而不是只返回 pass/fail

建议至少拆分为：

| 维度 | 示例判断 |
| --- | --- |
| Detection | Agent 是否在限定窗口内发现异常 |
| Diagnosis | 是否识别正确的服务、资源或依赖边界 |
| Remediation | 是否采取允许的修复动作 |
| Recovery | 业务 SLO、健康检查和资源状态是否恢复 |
| Safety | 是否越权、破坏无关数据或泄露内部信息 |
| Efficiency | 发现时间、修复时间、请求数和资源成本 |
| Reproducibility | 同一 seed/profile 下结果是否可解释 |

评分应同时保留原始证据和规则版本，避免以后修改评分器后无法解释历史结果。

#### P1-4：加入确定性控制

建议：

- 为每个 Trial 保存 seed；
- 将 Risk、Notification 等随机行为改为可配置的 seeded PRNG，或在 benchmark profile 中关闭非目标随机性；
- PSP outcome 使用明确的序列/seed，而不是隐式随机；
- 记录配置 revision、镜像 digest、数据库 schema version 和数据 profile；
- 将“资源后果未发生”与“控制动作未执行”区分开；
- 继续遵守真实路径原则，不用固定等待伪造业务结果。

PSP timeout 需要优先重构：应避免业务线程直接 `Thread.sleep(60_000)`，改为连接级、非阻塞或可配置的外部依赖超时模型，并让客户端真实经历连接/读超时。

### 8.3 P1：提供轻量、完整和评测三类环境 Profile

建议将当前完整部署拆成可声明的 profile：

| Profile | 用途 | 典型内容 |
| --- | --- | --- |
| `lite` | 前端、接口和控制面开发 | 核心业务服务、MySQL、Redis；关闭大规模预热和可选观测组件 |
| `full` | 完整故障演练 | 当前 Compose/Kubernetes 主要服务、Prometheus、Grafana、Loki、Tempo |
| `benchmark` | Agent Trial | 固定 seed、数据 profile、完整证据采集、短时租约、严格安全策略 |
| `isolated-trial` | 并行实验 | 每个 Trial 独立 stack 或独立 namespace/数据库/Redis 前缀 |
| `observability-heavy` | 深度诊断培训 | 按需启用额外 Recorder、SkyWalking 或高保真 Trace |

规则：

- 默认开发不自动写入 5400 万行历史数据；
- benchmark profile 的环境变量、镜像 digest、数据库版本和观测配置必须可导出；
- 只有 `isolated-trial` 才允许真正并行；
- 不把 AWX、ClickHouse、OpenSearch 等 ITBench 重组件加入默认本地路径。

### 8.4 P1：加强运行级观测和证据关联

建议增加以下观测能力：

- lock wait duration、deadlock victim、transaction retry；
- Redis key logical bytes、member count、hit/miss、eviction；
- 报表扫描行数、执行时间、query digest 和数据库计划摘要；
- 文件追加速率、已用空间、剩余空间和 run-scoped 文件大小；
- JVM retained bytes、GC pause、allocation rate 和健康状态；
- PSP request outcome、connect timeout、read timeout 和 retry；
- Worker accepted/in-flight/drained/rejected 请求；
- prepare/release/cleanup idempotency 和 fencing rejection。

不要把高基数 `runId` 大量作为 Prometheus label。推荐：

```text
低基数指标 + Trace exemplar
              + Run Event
              + Evidence Manifest
```

这样既能聚合性能，也能按 Trial 追踪细节。

### 8.5 P2：改善数据和服务边界

#### 数据库

- 引入 Flyway、Liquibase 或等价迁移机制；
- 逐步为业务服务划分 schema/账号/权限边界；
- 报表读取使用专用 read model、分区或只读副本，减少对 Checkout 的影响；
- 数据预热支持按 profile、日期窗口、行数预算和租户/Trial 范围运行；
- 预热和正常业务使用可观测的 DB budget，避免“预热成功但业务被饿死”。

#### 异步边界

不建议立即把所有同步 HTTP 改成消息队列。可分阶段：

1. 先为支付结果、通知和履约事件增加事务 Outbox；
2. 保留当前同步模式作为 `sync` profile；
3. 增加可选 broker profile，验证重试、重复投递、顺序和最终一致性；
4. 让演练既能覆盖同步级联，也能覆盖异步积压和消费者恢复。

#### 事件和审计

- 统一 Run Event、业务 Event 和 Evidence Event 的 envelope；
- 事件包含 schema version、event ID、occurredAt、producer、trace correlation 和 idempotency key；
- 事件的控制面字段只在控制面/评估存储可见；
- 业务事件仍使用业务语义，不复制 Fault Run 展示名。

### 8.6 P2：补充 FinOps 和 CISO 能力，但共用运行底座

可以借鉴 ITBench 的领域覆盖，但不要复制其 SRE/CISO 双运行协议。建议共用：

```text
Environment Profile
  -> Scenario Contract
  -> Run/Trial Lifecycle
  -> Evidence Manifest
  -> Evaluator
```

再按能力增加 adapter：

#### FinOps

- 将 CPU、内存、数据库、Redis、磁盘和外部调用成本映射为业务/环境成本；
- 增加预算超支、资源浪费、预热成本、缓存成本和高峰流量成本任务；
- 评估 Agent 是否降低成本而不破坏业务 SLO；
- 保留成本估算版本和价格表版本，保证历史结果可解释。

#### CISO

- 检查 Gateway allowlist、内部 Header 清理、服务间密钥、JWT audience/issuer、Secret 配置和观测端点暴露；
- 增加“发现配置风险—提交修复—验证消费者不可见内部信息”的任务；
- 将策略评估结果作为 Evidence，而不是把安全规则复制到每个服务 Controller；
- 对 Operator、Worker、Agent 和业务服务分别评估最小权限。

## 9. 推荐目标架构

### 9.1 目标分层

```text
                    ┌─────────────────────────────┐
                    │  Experiment / Campaign API   │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────v──────────────┐
                    │ Scenario Contract Registry   │
                    │ catalog + schema + evaluator  │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────v──────────────┐
                    │ Trial Planner / Reconciler    │
                    │ lease + owner + retry + drain │
                    └───────┬──────────┬───────────┘
                            │          │
             ┌──────────────v───┐  ┌───v────────────────┐
             │ Fault Run Control │  │ Environment Runner │
             │ fencing/recovery  │  │ profile/isolation  │
             └──────────────┬───┘  └───┬────────────────┘
                            │          │
                            v          v
                     Gateway fixed operations
                            │
        ┌───────────────────┼────────────────────┐
        v                   v                    v
   Business data path   Resource effects     Optional PSP/broker

        ┌────────────────────────────────────────┐
        │ Evidence Collector / Artifact Manifest │
        │ metrics + logs + traces + business     │
        │ checks + timeline + cleanup evidence   │
        └──────────────────┬─────────────────────┘
                           v
                    Evaluator / Leaderboard
```

### 9.2 所有权边界

| 能力 | 所有者 | 不应做的事 |
| --- | --- | --- |
| Scenario Contract | `traffic-control-plane` | 不在业务服务复制场景事实。 |
| Trial/Campaign | `traffic-control-plane` | 不把批量实验状态塞进单个 Fault Run。 |
| Worker ownership | Reconciler/Worker | 不依赖进程内 timer 或单副本假设。 |
| Business operation | Gateway + 目标服务 | 不接受任意 URL、任意目标或场景身份。 |
| Evidence/Evaluator | 控制面/观测面 | 不把 Ground Truth 写入 Agent 可见响应。 |
| Consumer semantics | Shopfront/Gateway/业务服务 | 不泄露 Fault Run、内部 Header、原始堆栈或演练名称。 |
| Data warmup | 专用 Worker | 不绕过 lease，也不允许 ad hoc SQL 修复所有权问题。 |

## 10. 建议的 90 天路线图

| 阶段 | 重点交付 | 完成标准 |
| --- | --- | --- |
| 第 1-2 周 | Worker owner lease、Reconciler、报表/流量 drain、严格失败传播 | Worker 重启、重复启动、超时、取消和部分 cleanup 均有稳定状态；失败不再伪装成功。 |
| 第 3-4 周 | Catalog contract 扩展和自动合同测试 | 每个场景都能自动验证 target、prepare/release、参数边界、时长、cleanup 和 evidence 定义。 |
| 第 5-6 周 | Trial、seed、environment profile、Evidence Manifest | 一次运行可导出完整 metadata、时间线、配置 revision、镜像 digest、证据 URI 和 hash。 |
| 第 7-8 周 | Evaluator v1 | 至少支持 Detection、Diagnosis、Remediation、Recovery、Safety、Efficiency 六个维度，保留规则版本和原始证据。 |
| 第 9-10 周 | `lite/full/benchmark` profile 和受控预热 | 本地接口联调不再默认承受大规模预热；benchmark 环境可稳定复现。 |
| 第 11-12 周 | isolated-trial 设计验证、Outbox spike、FinOps/CISO 一个试点 | 能明确证明共享环境不会被误用于并行 Trial；至少一个新领域复用同一 Trial/Evidence 生命周期。 |

不建议在 P0/P1 完成前继续快速增加大量场景。没有可靠的 owner、drain、evidence 和 evaluator，场景数量越多，越难判断失败来自目标效果、控制面、清理还是评估器。

## 11. 哪些 ITBench 能力应当吸收，哪些不应照搬

### 11.1 建议吸收

| 能力 | 采用方式 |
| --- | --- |
| Scenario/Fault/Waiter 的结构化元数据 | 扩展现有 Catalog，增加生命周期、Evidence 和 Evaluation 字段。 |
| Ground Truth | 作为控制面内部的原因图、预期信号、恢复条件和安全边界，不暴露给 Agent。 |
| Trial/Experiment | 在 Fault Run 之上增加，不改变单次运行状态机。 |
| Recorder/Artifact | 用 Evidence Manifest 组织现有 Prometheus、Loki、Tempo、业务事件和 smoke 结果。 |
| 环境 profile | 用 Compose/Kubernetes profile 和 seed/config export 实现。 |
| Schema、生成和合同测试 | 从 Catalog 生成 Gateway、Worker、runbook 和 smoke 校验。 |
| Leaderboard/结果聚合 | 在 Evidence/Evaluator 稳定后增加，先支持本地 JSON/数据库结果。 |
| 最小权限 Agent bundle | 单独的短时、按 Trial、按能力授权，不复用 Operator session。 |

### 11.2 有条件吸收

| 能力 | 使用边界 |
| --- | --- |
| AWX/多 Runner | 作为外部批量编排适配器；不要替代 Castrel 的 Fault Run 状态机。 |
| ClickHouse/OpenSearch 等重观测栈 | 只在 `observability-heavy` 或 benchmark profile 启用。 |
| 多集群隔离 | 需要真正并行 Trial 时采用；单次本地演练不需要。 |
| 成本和合规评估 | 先复用 Evidence/Evaluator，再逐领域增加 adapter。 |

### 11.3 不建议直接照搬

1. 不把 Ansible Playbook 作为所有业务故障的唯一执行方式；数据库锁、PSP、JVM、Redis 和业务补偿应继续由业务服务真实实现。
2. 不把宽 Kubernetes RBAC 当作默认 Agent 权限；Castrel 应按固定 operation、Trial 和目标能力最小化授权。
3. 不将 CISO 继续拆成完全独立的第二套生命周期；应共用 Run/Trial/Evidence 底座。
4. 不把 `runId`、场景 ID 或 Ground Truth 作为业务服务和消费者接口的公开字段。
5. 不以更多 Recorder、更多组件和更多场景数量替代状态机、隔离、失败传播和评估质量。

## 12. 关键决策原则

后续每项架构变更都建议用以下问题进行评审：

1. 这个改动是否仍然通过真实业务 HTTP、SQL、Redis、JVM、存储、锁或 PSP 路径产生效果？
2. 是否把新的控制面语义泄露到了消费者、业务服务日志、指标、Trace 或错误响应？
3. 单个 Worker、多个 Worker、重启、超时和网络分区时，谁拥有这次运行？
4. 是否能区分“目标效果未发生”“Agent 未修复”“控制面未执行”和“清理失败”？
5. 同一个 Trial 是否能重建环境、配置、seed、镜像、数据规模和观测窗口？
6. 是否会把共享 MySQL/Redis 上的资源竞争误当成 Agent 能力差异？
7. 新增能力是否可以复用 Scenario Contract、Trial、Evidence 和 Evaluator，而不是再开一套协议？
8. 失败、取消、过期和部分成功是否都会持久化，并能在重启后重协调？

## 13. 最终建议

Castrel Chaos 不需要变成 ITBench；它应成为一个**业务真实性更强、运行控制更可靠、评估协议更完整的故障演练和 Agent 评测平台**。

推荐的演进顺序是：

```text
先修复 Worker 所有权、drain、失败传播和重协调
    -> 再统一 Scenario Contract 和合同测试
    -> 再增加 Trial、Evidence Manifest、seed 和 Evaluator
    -> 再提供 lite/full/benchmark/isolated-trial profile
    -> 最后扩展多 Trial、Outbox、FinOps、CISO 和 Leaderboard
```

这样既能吸收 ITBench 在可组合、可复现和可评估方面的优点，又能保留 Castrel Chaos 在真实电商路径、控制面隔离、资源级故障和恢复闭环方面的核心竞争力。

