# ITBench 与 Castrel Chaos 整体架构对比及演进建议

> 分析日期：2026-09-09  
> 对比对象：本仓库 `castrel-chaos` 与附加目录 `/Users/raven/code/ITBench`  
> 结论基于两个项目当前工作树中的 README、架构文档、运行脚本、核心源码、部署清单和测试配置。本文是架构决策文档，不替代两个项目各自的运行手册。

### 阅读边界

- 文中标注“当前”或“已实现”的内容，指本次检查到的仓库工作树，不代表两个项目所有托管服务、外部 Agent 仓库或未来版本的能力。
- ITBench 工作树在检查时包含 README、`pyproject.toml` 的未提交修改，以及若干未跟踪的架构文档；因此 README 中的产品统计与源码资产数量不完全一致。本文同时记录两者，不把它们强行解释成同一个版本号。
- “Ground Truth”“Recorder”“Leaderboard”“Trial”在 ITBench 中并不都对应一个统一的本地持久化领域模型。SRE/FinOps 主要提供场景、Ground Truth、Recorder、状态/Bundle 和 AWX 执行流程；CISO 具有更明确的场景评估脚本；托管环境、外部 Agent 和部分排行榜能力位于仓库之外。
- Castrel 当前的 Runner 是用于产生正常客户流量的后台组件，不是 AI Agent 推理运行时。Castrel 的控制面面向 Operator；若未来开放 Agent，必须新增独立的 Agent Access 边界。

## 1. 结论摘要

ITBench 和 Castrel Chaos 不是同一类产品，因此不存在脱离目标的绝对优劣：

| 目标 | 更占优势的架构 | 原因 |
| --- | --- | --- |
| 评估 AI Agent 的诊断、修复和合规能力 | ITBench | 以 Scenario、Fault、Waiter、Ground Truth、Recorder 和外部/专用评估接入为中心，实验边界和结果归档边界更清晰。 |
| 演示真实业务系统中的故障传播 | Castrel Chaos | 故障嵌入真实电商业务路径，覆盖 HTTP、SQL、Redis、JVM、文件系统、数据库锁和 PSP。 |
| 单次本地演练的可控性和恢复闭环 | Castrel Chaos | Fault Run 有持久状态、fencing、lease、幂等、补偿、停止、恢复、审计和留存。 |
| 多场景、多 Trial、跨环境并行 | ITBench | AWX Head/Runner、独立集群和异步 workflow 更适合批量实验。 |
| 消费者路径安全和业务语义隔离 | Castrel Chaos | Shopfront、Gateway、业务服务和控制面边界明确，目标服务不解释 catalog 或生命周期语义。 |
| 场景组合和资源复用 | ITBench | Application、Tool、Fault、Waiter 与 Scenario 通过模板、索引和 Schema 组合。 |
| 生产化扩展基础 | 两者各有短板 | ITBench 的运行资源和权限较重；Castrel 当前受共享 MySQL、单副本 Worker、同步调用和有限迁移能力约束。 |

**总体判断：**

1. Castrel Chaos 的核心方向是正确的，不应为了“像 ITBench”而改造成 Ansible/AWX 驱动的 Kubernetes 基准平台。
2. Castrel 最值得吸收的是 ITBench 的**实验评估思想和资产组织方式**：标准化场景契约、Ground Truth/Evidence、Trial/Campaign、观测归档、评分和结果归档。ITBench 仓库中的通用 Agent 评分运行时和完整托管评估不能简单视为本地现成功能。
3. Castrel 最需要优先补强的是自己的**运行可靠性层**：Worker 所有权、停止 drain、状态重协调、失败传播、确定性和多运行隔离。
4. ITBench 的大规模集群编排、完整 Recorder 栈和宽权限 Agent 模型不应直接复制到 Castrel 默认部署；应作为可选的 benchmark profile 或外部适配器。

可以将两者的关系概括为：

```text
ITBench     = 可复现 IT 环境 + Agent 接口 + Ground Truth
              + Recorder/AWX 执行 + 托管或外部评估接入
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
    -> Ground Truth、状态和评估流程判定结果
    -> 清理环境并汇总 Trial/Leaderboard
```

SRE/FinOps 主要通过 Ansible Role、Makefile 和 AWX 执行；CISO 使用独立的 bundle、Makefile、Playbook 和专用评估器。

当前工作树的资源规模也需要和 README 的产品摘要分开看：

| 资产 | 当前源码/生成目录观察值 | 说明 |
| --- | ---: | --- |
| SRE 场景目录与 `scenario.yaml` | 67 | 位于 `scenarios/sre/project/roles/scenarios/files/scenario_*`。 |
| Fault library index | 31 | 位于 `scenarios/sre/library/indexes/faults`，不是 README 中“21 mechanisms”的同一统计口径。 |
| Waiter library index | 4 | 位于 `scenarios/sre/library/indexes/waiters`。 |
| Application library index | 2 | 位于 `scenarios/sre/library/indexes/applications`。 |
| CISO 场景包 | 4 | 位于 `scenarios/ciso`。 |

README 仍保留“6 SRE scenarios / 21 mechanisms / 1 FinOps scenario”的产品摘要；这可能是发布口径、历史版本或托管目录的统计，不能直接用来推断当前 checkout 的实际文件数量。对比时应同时记录**版本、生成物和托管服务边界**。

还有三点不能过度解读：

1. 仓库提供的是环境、协议、Recorder、Ground Truth/状态和评估接入，不是一个内置所有 LLM 推理逻辑的 Agent 服务；参考 Agent 位于外部仓库。
2. CISO 场景有明确的 `evaluation` Playbook/脚本；SRE/FinOps 更突出 Ground Truth、Recorder、状态和 Leaderboard bundle，不能把所有领域都描述成同一套本地自动评分器。
3. ITBench 具备 Kubernetes 对象/Topology snapshot 和 README 中提到的 Snapshot & Replay 方向，但本次仓库检查没有把它证明为一个覆盖所有业务状态的通用确定性回放引擎。Castrel 也不应把“观测快照”直接等同于“环境可恢复快照”。

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

这里的 `Runner` 指正常客户生命周期和受控流量执行器，不是 AI Agent。当前 Castrel 的实际参与者边界是：

```text
Operator
  -> traffic-control-plane
  -> Worker / Runner
  -> Gateway 固定 operation
  -> 真实业务服务

未来 Agent（可选）
  -> 独立 Agent Access / Task Adapter
  -> 受限业务或观测接口
  -> Evidence / Evaluator
```

因此，ITBench 的“外部 Agent 在环境中诊断和修复”与 Castrel 当前的“Worker 产生客户流量、Operator 控制 Fault Run”不是同一种运行模式，不能把两者的 Agent 成绩或 Runner 指标直接横向比较。

### 2.3 当前能力、外部能力与建议能力的区分

| 能力 | ITBench 当前仓库 | Castrel 当前仓库 | 本文建议 |
| --- | --- | --- | --- |
| 场景规格 | SRE/FinOps 模板、生成索引、JSON Schema、CISO bundle | TypeScript Catalog、目标映射和 Worker 分派 | 为 Castrel Catalog 增加可版本化 contract 和生成/合同测试。 |
| Agent 运行时 | 不在本仓库；参考 Agent 为外部仓库 | 没有通用 AI Agent 运行时；有客户生命周期 Runner | 增加独立 Agent Access，不复用 Operator 会话或客户 Runner。 |
| Ground Truth | SRE/FinOps 文件、CISO 场景评估输入 | 主要是场景恢复条件、runbook、业务检查和事件 | 增加控制面内部的症状、根因、允许动作和验证条件。 |
| 自动评分 | CISO 有专用评估器；SRE/FinOps 以状态、Ground Truth、Bundle 和托管流程接入为主 | 没有统一 Agent scorecard | 先做规则版 Evaluator，再考虑 Leaderboard。 |
| 观测归档 | Recorder 导出本地/S3，含指标、告警、日志、Trace、事件、对象/拓扑信息 | Prometheus、Loki、Tempo、事件、业务指标和 smoke 结果可查询 | 增加 Trial Evidence Manifest，不默认复制重型观测栈。 |
| 快照/回放 | 有对象/拓扑快照和 Snapshot & Replay 方向；通用回放能力需按版本验证 | 没有通用环境快照/回放层 | 先固定配置、数据 profile、seed 和证据窗口，再做状态回放。 |

## 3. 两种架构的本质差异

### 3.1 ITBench 是“评测平台优先”

ITBench 的第一类对象是实验和任务：

```text
Application + Tool + Fault + Waiter + Scenario + Ground Truth
        + AWX workflow / trial execution / evaluation bundle
```

它关心的问题是：

- Agent 是否发现异常；
- 是否定位根因；
- 是否采取正确修复；
- 修复是否使环境恢复；
- 不同 Agent 是否能在相同环境和相同任务上公平比较；
- 多次实验的观测和结果是否可导出、复现和汇总。

因此它把环境隔离、权限交接、数据录制、Ground Truth、评估接入和 Leaderboard 放在核心位置。这里的 `Trial` 更准确地说是 AWX/托管流程中的一次执行单元，不应理解为与 Castrel `Fault Run` 等价的统一数据库实体。

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

### 3.3 声明式编排与在线状态机的差异

两者的实现范式不同，这也是很多“谁更强”的争论不能直接成立的原因：

| 范式 | ITBench | Castrel Chaos |
| --- | --- | --- |
| 事实来源 | Scenario/Fault/Application/Tool 模板、生成索引和 Ansible 变量 | MySQL Fault Run/Run Event、Catalog、Redis lease 和目标服务运行状态 |
| 执行方式 | Makefile/Ansible/AWX 将声明转换为一次或一组环境操作 | Web/API 写入持久状态，Worker 扫描状态并持续执行 |
| 失败恢复 | 依赖 Playbook/AWX workflow 的 failure/always/cleanup 节点和人工兜底 | 依赖 Coordinator 状态转换、目标 release、compensation、过期恢复和 retention |
| 适合的时间尺度 | 一次实验、批量 Trial、环境销毁 | 分钟级或更长的受控运行、人工停止、进程重启和在线恢复 |
| 主要风险 | 生成物漂移、workflow 中断、异步失败未传递 | Worker 重复执行、共享资源污染、owner/drain/迁移能力不足 |

因此，Castrel 不应简单把在线 Fault Run 改写成 Ansible Playbook；更合适的吸收方式是把 ITBench 的声明式 Schema 用于**描述和验证**，把现有 Coordinator/Worker 用于**执行和恢复**。

### 3.4 结论

ITBench 解决的是“**如何公平、可重复地评估 Agent**”；Castrel 解决的是“**如何在真实业务系统中制造并控制可观察的运行行为**”。Castrel 后续应增加评估能力，但不应牺牲真实业务路径和控制面边界。

## 4. 关键架构对比

| 维度 | ITBench | Castrel Chaos | 对 Castrel 的启示 |
| --- | --- | --- | --- |
| 产品目标 | AI Agent 的企业 IT 任务基准 | 电商业务链路和 SRE/可观测性故障演练 | 保留 Castrel 的业务真实性，增加可重复评测层。 |
| 核心实体 | Application、Tool、Fault、Waiter、Scenario、Ground Truth；Trial 多由 AWX/托管流程表达 | Customer、业务资源、Fault Run、Run Event、Runner、Lease、Fencing Token | 在 Fault Run 之上增加 Trial/Evidence/Evaluation，不要重命名现有业务实体。 |
| 运行环境 | 每次场景通常有独立 Kubernetes/RHEL 环境 | Compose/Kubernetes 中的一套完整电商系统，共享 MySQL/Redis | 第一阶段继续单环境演练；需要并行时增加 Environment/Trial 隔离，而不是直接共享全局资源。 |
| 故障实现 | Ansible task、Chaos Mesh、配置/资源变更、合规策略 | 真实报表 SQL、Redis Hash、JVM 对象、文件追加、表锁/行锁、PSP HTTP | Castrel 真实资源路径更适合业务故障培训；ITBench 的 Fault 元数据和参数 Schema 值得借鉴。 |
| 场景组合 | 通过索引、模板和 Schema 组合 Application/Tool/Fault/Waiter | Catalog 绑定固定 service、operation、参数、时长和 recovery | Castrel 应把 prepare/active/release/evidence/evaluate 也纳入统一契约，并生成相关代码校验。 |
| 控制面 | Makefile、Ansible、AWX 和场景 bundle | Next.js 控制台、MySQL/Redis、独立 Worker、Gateway | Castrel 控制面更贴近在线服务；需要补充统一 Reconciler 和批量 Campaign。 |
| Agent 边界 | 临时 kubeconfig、Prometheus 和观测工具；权限偏宽但环境隔离 | 当前核心是 Operator 控制面和业务 Runner；业务服务不暴露 catalog 语义 | Castrel 若开放 Agent，应单独建 Agent Access Bundle，不应复用 Operator 权限。 |
| 生命周期 | deploy tools/app → recorder → fault → agent → record → evaluate/submit → cleanup | create → prepare → active → stop/expire → drain → release/recover → retention | ITBench 的 export/evaluation 接入值得加入；Castrel 的持久状态和恢复语义应保留。 |
| 状态持久化 | 状态文件、AWX 状态、Recorder 输出和场景目录 | Fault Run、Run Event、审计、fencing、幂等和恢复结果入 MySQL | Castrel 状态模型更适合长期运行，但需要启动后 reconciliation 和 owner lease。 |
| 观测 | Metrics、Alerts、Logs、Traces、K8s Events、Object Snapshot、Topology、Cost | Actuator/Micrometer、Prometheus、Alertmanager、JSON Logs、Loki、Tempo、业务指标 | Castrel 应增加按 Trial 的证据清单和快照，不宜默认引入全部 ITBench 重型组件。 |
| 评估 | SRE/FinOps 的 Ground Truth、Recorder/状态/Bundle 和外部或托管评估接入；CISO 有专用 evaluator | 主要记录运行状态、业务结果、告警和审计；没有统一 Agent 得分协议 | 这是 Castrel 最大的能力缺口，应作为 P1 建设。 |
| 多 Trial | AWX Head/Runner 可提交多个执行单元和异步 workflow，但不是统一的 Trial 数据库模型 | 当前单控制面/单 Worker 假设，活动运行全局唯一 | 先引入 Campaign/Trial 数据模型，再做 Worker 池和环境隔离。 |
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

### 5.1 评测资产和边界更完整

ITBench 的整体基准流程把以下资产组合在一起：

```text
问题环境
    + Agent 可用工具和权限
    + 故障前/中/后观测
    + Ground Truth
    + 领域评估器或外部/托管评估流程
    + 执行状态、结果 Bundle 和排行榜接入
```

ITBench 的优势是把这些边界明确串起来，而不是仓库内已经存在一套覆盖 SRE、FinOps、CISO 的相同评分实现。Castrel 当前已经有运行记录、事件、审计和告警，但这些数据主要回答“运行发生了什么”，还不能统一回答“Agent 做得是否正确、为什么得分、是否造成了额外副作用”。

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

ITBench 可用 Kind、Minikube、kOps 和 AWX Head/Runner 组织多个环境与执行单元，适合：

- 比较多个 Agent；
- 重复执行同一 Scenario；
- 分配不同 Runner；
- 导出同一格式的实验结果；
- 支持公开 Leaderboard。

Castrel 当前部署更接近单环境、单控制面、单 Worker 的演练平台。它适合交互式演练，但不适合在共享资源上直接进行大批量公平评测；即使接入 AWX，也不能绕过环境、数据库、Redis 和数据集隔离。

### 5.4 观测数据更接近“实验档案”

ITBench 的 Recorder 会在不同阶段采集告警、Trace、日志、Kubernetes 事件、对象快照、Topology 和成本信息，并按 Agent、Experiment、Scenario、Trial 等上下文导出。这里的 snapshot 主要是观测/对象/Topology 记录，不应自动理解为可以完整恢复业务环境的 checkpoint。

Castrel 已经有很强的实时观测基础，但仍缺少一个稳定的、按运行版本和证据 hash 归档的运行档案，例如：

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

这些机制更适合长期运行的在线控制面。这里不是说 ITBench 缺少清理或失败处理，而是两者的控制目标不同：ITBench 更偏批处理/AWX workflow 的环境生命周期，Castrel 更偏持久化、可重入的在线 Fault Run 生命周期。

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
3. **Agent 权限偏宽。** SRE Agent 的权限模型可能包含 Namespace `admin`、Node patch、PriorityClass 等 Cluster 级能力；这在独立 benchmark sandbox 中是可理解的取舍，但不适合直接迁移到生产集群。
4. **部分异步 Fault 失败传播需要加强。** 当前 `inject_scenario_faults.py` 的终态等待路径存在“记录失败状态但不一定向上游返回非零失败”的风险；应通过失败、超时、取消和清理失败的集成测试确认，而不要只依赖日志。
5. **等待和清理的兜底不足。** 某些等待缺少总超时；AWX 清理节点未执行时需要人工处理。
6. **观测数据生命周期不够完整。** 虽支持本地/S3，但保留周期、压缩、加密、脱敏、重试、幂等索引和跨 Trial 查询能力仍需加强。
7. **生成产物和文档存在漂移风险。** 当前 README 的“6/21/1”摘要与工作树中 67 个 SRE 场景目录、31 个 Fault index 等统计不一致；CISO bundle 操作名、模板条件判断和生成产物也需要持续校验。
8. **业务因果链与 Castrel 不同。** ITBench 的很多任务刻意作用于 Kubernetes 工作负载、平台资源、成本或合规策略；这不是“真实性不足”，而是它不以完整消费者业务状态机为主要目标。
9. **Snapshot 不等于完整 Replay。** 当前可以看到对象/Topology snapshot、Recorder 和 Snapshot & Replay 方向，但不能据此假设所有数据库、Redis、文件和外部依赖状态都能一键恢复并确定性重放。

### 7.2 Castrel Chaos 的局限

1. **缺少统一的 Agent 评估协议。** 当前更擅长运行和恢复，不擅长给多个 Agent 做可解释、可重复的横向评分。
2. **共享资源限制并行实验。** 服务逻辑分开，但物理上共享 MySQL、Redis、连接池和 I/O；活动运行全局唯一，无法直接安全扩展到多 Trial。
3. **Worker 多副本模型尚未完成。** 直接扩容可能造成 Runner、场景请求、补给、timer 或 recovery 重复执行。
4. **部分 Worker 的 Coordinator drain 接入不完整。** 当前 `ScenarioWorkers` 注册了 run-specific drain；`ReportScenarioWorker` 和 `TrafficSurgeExecutor` 主要依赖自身扫描/进程 stop 路径，未见同等的 Coordinator 注册。因此手工停止时可能出现 `registered: false`，或继续运行到下一次扫描/过期；这是明确的实现改进项，不是所有 Worker 都没有 drain。
5. **同步 HTTP 可能放大级联故障。** Checkout、支付、通知和履约之间没有消息队列或持久化 Outbox。
6. **Schema 演进仍偏向 clean install。** 仓库已有针对特定版本的手工 SQL migration，但 `00-schema-ddl.sql` 明确把 Version 1 作为 clean-install contract，尚未形成完整的版本化迁移、回滚和多版本服务升级体系。
7. **确定性仍不统一。** Notification/Risk 的随机失败率属于现有业务行为，不能直接当作严格的 Fault Run 结果；PSP timeout 使用固定 `Thread.sleep(60_000)`，与仓库声明的真实外部依赖原则存在张力，不利于严格复现实验。
8. **专用观测信号仍有空白。** 锁等待/deadlock、Redis 单 key 大小、报表扫描行数/查询计划、文件增长速率和运行级资源消耗还可以更明确。
9. **数据预热成本高。** 默认 `180 × 300000 = 54000000` 行的规模会明显竞争 MySQL CPU、磁盘、redo/undo、buffer pool 和连接。
10. **部署安全默认值偏开发。** Grafana、Prometheus、Loki、Tempo、OTLP、数据库和 Redis 的访问控制需要部署人员主动收紧。
11. **效果依赖运行资源。** OOM、磁盘耗尽、锁等待、告警和恢复耗时都不能被承诺为必然结果；评估器需要区分“控制动作完成”和“资源后果实际发生”。
12. **尚未形成 Agent 接入边界。** 当前 Operator、控制面 Worker 和正常客户 Runner 的协议已经存在，但没有与 ITBench 类似的、面向外部 Agent 的短时凭据、工具 allowlist、任务提交和结果回收协议。

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

- 为 Fault Run 执行 Worker 增加 owner lease、heartbeat、owner ID 和执行 fencing；这不是替代现有目标侧 `OperationRunGuard` 或数据预热 lease，而是补足“哪个 Worker 有权持续执行”的控制面所有权；
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

当前实现的差异应明确记录：`ScenarioWorkers` 已通过 `registerRunDrain` 接入 Coordinator；报表 Worker 和流量 Surge Executor 仍主要通过自身的扫描、过期判断或进程级 `stop()` 收敛，尚未形成同等的 run-specific Coordinator drain。

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

#### P1-1：增加 Environment/Experiment/Campaign/Trial 模型

不要把 `Fault Run` 直接改造成批量实验对象。建议保留 Fault Run 的在线控制语义，增加环境和实验层；`Trial` 是评估封装，单个 Trial 可以包含一个或多个受控 Fault Run，也可以只做基线/恢复验证：

```text
Environment
  -> Experiment
      -> Campaign
          -> Trial
              -> Fault Run (0..n)
```

推荐字段：

| 对象 | 关键字段 |
| --- | --- |
| Experiment | `experimentId`、名称、创建者、目标 Agent 集合、默认环境 profile |
| Campaign | `campaignId`、scenario、参数矩阵、并发上限、停止策略 |
| Trial | `trialId`、`agentVersion`、`environmentId`、`catalogRevision`、`seed`、镜像 digest、开始/结束时间、结果 |
| Fault Run | 现有 `faultRunId`、目标快照、fencing、状态和恢复结果 |
| Environment | `environmentId`、隔离方式、数据库/Redis 命名空间、镜像/配置版本、容量预算、销毁状态 |

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

#### P1-5：先定义 Agent Access，再开放 Agent

Castrel 如果要支持外部 Agent，建议单独提供一个按 Trial 创建的 Agent Access Bundle，而不是让 Agent 登录 Operator 控制台或直接调用 `/internal/**`：

```text
Task Descriptor
  - taskId / trialId
  - 可见业务入口和观测入口
  - 截止时间、预算和允许动作
  - 不含 Ground Truth、Fault Run ID 或内部密钥

Agent Access Broker
  - 短时凭据或一次性 token
  - read/write allowlist
  - 能力和资源范围
  - 请求审计、限流、撤销和过期

Result Gateway
  - Agent 诊断、动作和结论
  - 只接收结构化结果
  - 不允许 Agent 写入评分或证据
```

需要明确区分三种身份：

| 身份 | 目的 | 权限 |
| --- | --- | --- |
| Operator | 创建、停止、恢复和清理 Fault Run | 控制面管理权限 |
| Customer Runner | 产生正常客户生命周期流量 | 固定业务客户操作 |
| Agent | 观察、诊断和修复被测任务 | Trial 范围内的最小业务/运维能力 |

这一步完成前，不应把 Castrel 的客户 Runner 指标称为 Agent 成绩，也不应把 Operator API 直接包装成 Agent 工具。

### 8.3 P1：提供轻量、完整和评测等多类环境 Profile

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

### 8.7 建议实现落点

| 方向 | 首批代码/配置落点 | 关键交付 |
| --- | --- | --- |
| Worker owner、重协调和 drain | `traffic-control-plane/src/lib/fault-run-coordinator.ts`、`fault-run-repository.ts`、`src/worker/scenario-workers.ts`、`report-scenario-worker.ts`、`traffic-surge-executor.ts`；新增版本化 migration | owner lease、heartbeat、接管、统一 drain、失败/超时/取消结果和重启恢复测试 |
| Scenario Contract | `traffic-control-plane/src/lib/fault-run-catalog.ts`、`fault-run-targets.ts`、Gateway `OperationDispatchController`、各目标服务 `/internal/**` 合同测试 | 参数/时长/target/lifecycle/evidence/evaluation 的版本化校验，减少手工映射 |
| Trial/Evidence | `traffic-control-plane/src/lib` 的新仓储与 evaluator、Fault Run schema/migration、Prometheus/Loki/Tempo 查询适配器 | Trial 元数据、时间线、证据 URI/hash、规则版本、业务检查和清理证明 |
| Agent Access | 控制面新增 Trial-scoped access route/broker；Gateway 内部认证和 allowlist；独立结果提交接口 | 短时凭据、能力范围、审计、撤销、过期和 Agent trace/result 回收 |
| 环境 Profile | `docker-compose.yml`、`k8s/kustomization.yaml`、控制面 `env`/worker 配置和数据预热配置 | `lite/full/benchmark/isolated-trial` 的显式开关、资源预算和配置导出 |
| 确定性与真实超时 | `psp-simulator` 的 outcome/timeout 实现、Risk/Notification 失败率配置、Runner profile | seeded/序列化结果、非阻塞外部超时、正常业务随机性与 Fault Run 效果分离 |

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

Trial Planner
    -> Agent Access Broker (optional)
    -> scoped external Agent
    -> Result Gateway

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
| Agent access | Trial-scoped Access Broker | 不复用 Operator session、客户 Runner 或目标服务内部密钥。 |
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

这是按依赖关系排列的参考路线，不是对人力、版本周期或三个月内完成全部交付的承诺。若 P0 的 Worker 所有权、drain 和失败传播未完成，P1 的评分结果不应被当作可靠基准数据。

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

## 13. 证据索引与待验证事项

### 13.1 ITBench 证据索引

| 结论 | 主要证据 |
| --- | --- |
| 规格、索引、Schema 和生成流程 | `scenarios/sre/templates/`、`scenarios/sre/library/indexes/`、`scenarios/sre/scripts/generate_library_indexes.py`、`generate_library_index_schemas.py` |
| 场景执行和故障组并行 | `scenarios/sre/Makefile`、`scenarios/sre/project/manage_*.yaml`、`scenarios/sre/scripts/inject_scenario_faults.py` |
| Recorder 和阶段性数据导出 | `scenarios/sre/project/roles/recorders/`、`scenarios/sre/tools/`、`generate_agent_bundle.yaml`、`generate_leaderboard_bundle.yaml` |
| SRE Ground Truth | `scenarios/sre/project/roles/scenarios/files/scenario_*/groundtruth.yaml`、`groundtruth_v1.yaml` |
| CISO 专用评估 | `scenarios/ciso/*/playbooks/evaluate.yml`、`scenarios/ciso/*/evaluation*` |
| AWX 多 Runner/执行单元 | `documentation/getting-started/awx.md`、`scenarios/sre/project/roles/awx/` |
| Agent 不由该仓库内置 | `README.md` 的 Agents 链接、`scenarios/sre/project/generate_agent_bundle.yaml` |
| README 统计与当前资产口径不同 | `README.md` 的 6/21/1 摘要，与当前 `scenario_*`、library index 和 CISO bundle 目录 |

### 13.2 Castrel 证据索引

| 结论 | 主要证据 |
| --- | --- |
| 唯一 Catalog 和参数/时长边界 | `traffic-control-plane/src/lib/fault-run-catalog.ts` |
| Gateway 固定 operation 白名单 | `gateway-service/src/main/java/com/castrel/chaos/gateway/controller/OperationDispatchController.java` |
| Fault Run 状态、fencing、恢复和 drain | `traffic-control-plane/src/lib/fault-run-coordinator.ts`、`fault-run-repository.ts`、`common/src/main/java/com/castrel/chaos/common/coordination/OperationRunGuard.java` |
| 场景 Worker drain 已接入的范围 | `traffic-control-plane/src/worker/scenario-workers.ts` 的 `registerRunDrain` |
| 报表/流量 Worker 当前实现 | `traffic-control-plane/src/worker/report-scenario-worker.ts`、`traffic-surge-executor.ts` |
| 正常客户 Runner，不是 AI Agent | `traffic-control-plane/src/worker/runner-engine.ts`、`traffic-lifecycle-orchestrator.ts` |
| 单副本部署假设 | `k8s/services/traffic-control-plane/deployment.yaml`、`worker-deployment.yaml` |
| Schema 初始化与有限迁移 | `infra/mysql/init/00-schema-ddl.sql`、`infra/mysql/migrations/`、`common/src/main/java/com/castrel/chaos/common/management/SchemaVersionHealthIndicator.java` |
| 真实业务资源效果 | `catalog-service`、`inventory-service`、`promotion-service`、`notification-service`、`psp-simulator` |
| 观测和告警 | `infra/prometheus/`、`infra/promtail/`、`infra/tempo/`、`docker-compose.yml` |
| 数据预热约束 | `traffic-control-plane/src/worker/data-warmup.ts`、`infra/mysql/init/05-warmup-partitions.sql` |

### 13.3 仍应通过实现或集成测试确认的事项

1. ITBench 当前托管 Leaderboard 的评分、数据上传和本地开源仓库之间的确切边界；本文不把网页/托管能力当成仓库内置代码。
2. ITBench README 中 Snapshot & Replay 是否已覆盖完整环境重建，还是仅覆盖对象/Topology/观测数据；在没有端到端 replay 测试前不作强结论。
3. ITBench `inject_scenario_faults.py` 在 AWX/Makefile 上层对 failed、timeout、canceled 的最终退出码；应补一个失败注入的 CI 验证。
4. Castrel 报表和流量 Worker 在人工停止与 Worker 进程重启交错时的最终请求边界、状态落库和 cleanup 顺序。
5. Castrel 在两个 Worker 副本同时扫描相同 Fault Run 时，目标侧 fencing 能否覆盖所有业务操作，而不仅是部分 operation。
6. Castrel 的真实场景后果是否达到某个阈值，不能只通过“prepare 成功”判断；需要把目标效果、业务影响、恢复和清理分别记录。

## 14. 最终建议

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
