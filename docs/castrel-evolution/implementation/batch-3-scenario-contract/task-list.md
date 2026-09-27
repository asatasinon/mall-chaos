# 批次 3：Scenario Contract 实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | P3-00R 决策已同步并完成一致性复核；Phase 3 Contract 实施尚未开始 |
| 版本 | 1.4 |
| 更新时间 | 2026-09-26 CST |
| 路线阶段 | [阶段 3：Scenario Contract](../../roadmap/phases/phase-3-scenario-contract.md) |
| 产品规格 | [product.md](./product.md) |
| 技术设计 | [tech.md](./tech.md) |
| 前置任务 | [批次 2：Worker 所有权与状态重协调](../batch-2-reconciliation/task-list.md) |
| 场景事实来源 | `traffic-control-plane/src/lib/fault-run-catalog.ts` |

## 1. 复核结论

### 1.1 已有基础与实施原则

实施不从空白开始，但也不能把已有底座误报为 Phase 3 Contract 已完成：

- Catalog 已包含 `targetPrepare`、`recoveryPolicy`、恢复策略和完整参数约束；`fault-run-catalog-revision.ts` 已生成被 batch-0 baseline 与现有测试使用的 64 字符 SHA-256 `catalogRevision`。
- Phase 2 已引入 owner-fenced `OwnedFaultRunDriver`、四类 driver registry、runnable Run 查询、recovery policy resolver、action journal、migration runner 和 deployment migration Job。
- `CART_CATALOG_DEPENDENCY` 已有 `ScenarioWorkers` 真实 customer-session / Gateway 路径；仍需由 Contract coverage 验证实际 dispatch、drain 和运行终态证据。
- runbook 已有 12 场景双语文章、静态 Tempo 展示 recipe 和覆盖测试；这些内容还不是结构化、run-relative Evidence Query Contract。
- 告警 intake 已有内部 webhook route、service credential 文件配置和受限 receipt；Compose/Kubernetes 仍是 generic receiver，尚不能宣称阶段 5 专用 Agent delivery 已就绪。
- 当前已有批次 2 的 implementation，不代表产品/技术文档中的所有旧基线陈述仍准确。实施前应先校正设计与代码边界，再新增 Contract 层。

### 1.2 用户已确认的设计选择（2026-09-26）

1. **数据库 schema：** 部署清空数据库并重建；不增加旧库 upgrade migration。`contract_revision` 在三份 fresh schema 中 `NOT NULL`，不设计旧行 null/legacy compatibility；`db:verify` 检查该列，非 clean schema fail fast。
2. **合同快照：** Phase 3 只保存全局 `catalogRevision` 与 per-run `contractRevision`，不保存完整 Contract JSON；Batch 4 仅在自己的 capture flag 启用时冻结 Evidence Contract snapshot。
3. **事实来源：** `targetPrepare`、`recoveryPolicy`、dispatch/drain owner 继续从 Catalog 和现有 driver registry 派生；supplement 只存新增的参数消费者、预算/guard、检查 ID、Evidence 与 Alert 语义。
4. **Evidence/Alert 接口：** Evidence 复用 Batch 4 受限 DSL，runbook Tempo 配方从同一 Contract 派生。Alert 字段对齐 Batch 5.0；receipt 使用其全局 `alert-receipt.v1` policy。`NOT_EXPECTED` 不做 Fault Run correlation，但保留通用 receipt；外部 Agent receiver readiness 独立表达。
5. **资源预算：** surge `concurrency` 上限为 `128`；storage `totalBytes` 不设静态绝对上限，使用目标服务 filesystem usable-space guard；`minFreeBytes` 范围为 `1 MiB`–`1 GiB`，Catalog 与目标服务同步限制。
6. **运行时/CI：** `SCENARIO_CONTRACT_VALIDATION_MODE=warn|enforce` 仅校验当前进程合同和新 Run admission；跨服务检查由外部 CI 调用根级脚本并设为阻断，本仓库不新增 GitHub Actions workflow。保留全局 64-hex `catalogRevision` 与 per-run `sc.v1:sha256:` `contractRevision`；hash 按参数名排序，展示顺序不参与。
7. **部署/canary：** canary 只在数据库与业务资源均可丢弃的单 Worker 环境，`FAULT_RUN_RECONCILIATION_MODE=OFF`；不要求 pre-reset Run 级 cleanup gate，也不声称 Phase 2 多 Worker/TAKEOVER 已验证或以 P2-10 作为本 canary 前置条件。
8. **恢复策略：** local Worker 的 stop/drain/verification 满足 `WORKER` 适用的 recovery action；不存在 Gateway target 时 `targetRelease=NOT_APPLICABLE` 合法。
9. **幂等：** 仅保证同一部署内按当前 Catalog 校验/标准化参数的 replay；环境重建清除旧 key/Run，不支持跨部署 replay。

### 1.3 设计复审结论（2026-09-24，按 2026-09-26 决策收敛）

总体方向合理：Catalog 单一事实源、跨层只读校验、运行时 warning 优先、revision 原子写入和业务协议隔离均应保留。以下差异已在本清单落实为设计决策门禁、实施任务及完成证据；**任务覆盖不代表设计已定稿或能力已实现**：

| 设计范围 | 已有任务 | 复审结果 |
| --- | --- | --- |
| Catalog / Contract model、revision | P3-01 | 方案已定：supplement 不重复既有策略；参数名排序保留；owner 从实际 driver 派生；`catalogRevision` 保持 64-hex，见 P3-ISSUE-007。 |
| Evidence Query 合同与历史解释 | P3-01、P3-04、P3-05 | 方案已定：复用 Batch 4 DSL；Phase 3 只持久化 revision，Batch 4 capture flag 决定是否冻结快照，见 P3-ISSUE-008/009。 |
| Gateway、Worker 与恢复策略 | P3-02、P3-07 | 方案已定：本地 Worker stop/drain 合法替代不存在的 target release；目标服务 Controller 需独立测试，见 P3-ISSUE-010/011。 |
| Validator、CLI 和 CI 门禁 | P3-03、P3-06 | 方案已定：TS 预检与 Gateway/target Java results 汇总后才 valid；运行时只验证进程内事实；外部 CI 调根脚本，本仓库不新建 GHA，见 P3-ISSUE-010/015。 |
| Run revision、fresh schema、Operator 读面 | P3-05 | 方案已定：三份 fresh DDL 使用 `NOT NULL`，无旧库 migration/legacy null/cross-deploy replay；`CREATED` revision 受控投影仍待实现，见 P3-ISSUE-002/006/008/012/016。 |
| 告警、资源预算和灰度退出 | P3-01、P3-04、P3-06、P3-07 | 方案已定：Alert 对齐 Batch 5.0、共享 receipt policy、独立 Agent readiness；预算和 disposable single-worker canary 已有明确界限，见 P3-ISSUE-011/013/014。 |

### 1.4 不可绕过的决策

1. Catalog 是唯一可变场景事实来源；不新建平行的手工 `scenario -> contract` registry。
2. Gateway target mapping 和 Worker drivers 保留各自所有权；用显式 descriptor / registry test 交叉校验，不解析源码 AST 或 prose。
3. Contract 校验错误必须带稳定 category、code、scenario 和 field path；严格 CI gate 不得以 warning 或缺省值代替。
4. 运行时 Contract validation mode 与 `FAULT_RUN_RECONCILIATION_MODE`、`FAULT_RUN_SAFE_RUNTIME_ENABLED` 分离；不能改变当前 owner、recovery 或 normal-task 隔离语义。
5. Contract revision 由服务端计算，在创建 Run 的事务中写入 Fault Run 行和 `CREATED` 事件；旧 Run 不回填当前 revision。
6. 场景启动、target prepare、真实效果、告警 receipt、观测证据、业务恢复和 cleanup 是不同事实，禁止相互推导。
7. Evidence/alert 声明只定义可信查询和关联边界；不保存现场观测结果，不承诺一定 firing，也不启用尚未部署的专用 Agent receiver。
8. P3-00R 已收到本清单 1.2 的选择；正式 design/task 文档对齐前，不开始 P3-01/P3-05/P3-06 代码实现。
9. 当前 clean-slate 部署无旧数据兼容要求；`contract_revision` 必须由 fresh schema 保证非空，不添加为了 legacy rows 的 null fallback、upgrade migration 或跨部署 idempotency replay。
10. 每次任务完成、阻塞、恢复或取消后立即更新本文件的复选框、任务组进度、总体状态、问题表和执行更新记录。

## 2. 任务状态规则

- `- [ ]`：未开始。
- `- [-]`：进行中；开始前先更新文件。
- `- [x]`：实现完成，且该任务声明的验证证据已记录。
- `- [!]`：阻塞；必须关联 `P3-ISSUE-nnn`，写清影响和下一步方案。
- `- [~]`：取消或由其他任务取代；必须解释原因和替代项。
- 只完成代码但没有完成该任务要求的验证，不得标记 `[x]`；标记 `[!]` 并说明缺少的证据。
- 一个任务完成后，立即同步修改本文件，不能等到整个任务组或批次结束再补记；记录变更范围、验证命令/结果、适用运行模式、限制与对应 issue。静态声明通过不等于实时效果、告警 firing 或业务恢复已验证。
- 新发现若改变数据所有权、状态语义、权限、外部协议、schema 或回退，先修订 `product.md`/`tech.md`，再继续实现。
- 仅可在明确 disposable canary/deployment 中按部署方案整体 reset 数据库与业务资源；不得对共享/保留数据环境这么做，也不能把 reset 说成 Run recovery、migration 通过或 per-Run cleanup。

## 3. 总体进度

- **总体状态：** 用户决策已同步至 Product、Tech、Phase 3 roadmap、Batch 4/5 handoff 与任务清单；Phase 3 implementation 尚未开始。
- **当前任务：** P3-00R 文档对齐已完成。
- **下一步：** 完成后按 P3-01 实施；Contract enforce/canary 仅在数据库和业务资源可丢弃的单 Worker 环境中运行，保持 Reconciliation `OFF`，不声称 P2 takeover 已验证。
- **进度口径：** 仅按 `[x]` 子任务统计；代码存在但当前任务未验证的能力不能提前计入完成。

| 任务组 | 目标 | 状态 | 进度 | 前置依赖 |
| --- | --- | --- | --- | --- |
| P3-00 | 现状基线与技术设计对齐 | 已完成（1 项被用户决策替代） | 6 / 7 | 当前仓库 |
| P3-00R | 设计复审整改与跨阶段接口定稿 | 已完成 | 12 / 12 | P3-00 |
| P3-01 | Catalog Contract supplement 与 revision | 未开始 | 0 / 7 | P3-00R |
| P3-02 | Gateway/Worker capability 对照与 recovery coverage | 未开始 | 1 / 8 | P3-00R、P3-01 |
| P3-03 | 纯函数 Contract validator 与稳定诊断 | 未开始 | 0 / 7 | P3-01、P3-02 |
| P3-04 | Runbook、i18n、evidence、alert、术语工件 | 未开始 | 0 / 8 | P3-01、P3-03 |
| P3-05 | Fresh schema、revision 事务持久化与 Operator 读面 | 未开始 | 0 / 8 | P3-00R、P3-01、P3-03 |
| P3-06 | CLI、外部 CI 接入、配置与回退 | 未开始 | 0 / 9 | P3-00R、P3-02 至 P3-05 |
| P3-07 | 集成验证、single-worker canary 与阶段退出 | 未开始 | 0 / 9 | P3-02 至 P3-06；可丢弃环境 |

## 4. 执行依赖

```mermaid
graph TD
    P300[P3-00: 基线和技术设计对齐] --> P300R[P3-00R: 设计复审整改]
    P300R --> P301[P3-01: Contract model / revision]
    P301 --> P302[P3-02: Gateway / Worker capability]
    P301 --> P303[P3-03: Validator core]
    P302 --> P303
    P303 --> P304[P3-04: runbook / i18n / evidence / alert]
    P301 --> P305[P3-05: Fresh schema revision persistence]
    P303 --> P305
    P304 --> P306[P3-06: CLI / CI / rollout]
    P305 --> P306
    P302 --> P307[P3-07: integration / exit]
    P306 --> P307
```

Phase 3 的 Contract 单 Worker canary 不启用 Reconciler，故不声称 P2-10 已完成；P2-10 仍是 Phase 2 自身退出/TAKEOVER 的独立门禁，但不是 P3 canary 的前置条件。

### 4.1 审查问题闭环映射

P3-00R 已定稿 `P3-ISSUE-007`～`016` 的处理方案。实现仍须按下表完成并登记验证；“设计已解决”不等于“运行时代码已完成”。

| 问题 | 设计定稿 | 实施任务 | 最低关闭证据 |
| --- | --- | --- | --- |
| P3-ISSUE-007 | Catalog 唯一策略源、revision 参数顺序/owner 名称 | P3-01、P3-03 | 无重复可变策略；driver owner 使用实际 `name`；参数重排不改变旧 hash，语义变更改变 per-run revision。 |
| P3-ISSUE-008 | Phase 3 revision 与 Batch 4 capture snapshot 的边界 | P3-05、P3-07 | Phase 3 不存完整 Contract；Batch 4 capture flag 决定是否冻结 Evidence snapshot；clean reset 销毁旧运行与业务资源，不测试旧 Run compatibility。 |
| P3-ISSUE-009 | 阶段 4 可消费的受限 Evidence DSL | P3-01、P3-04、P3-07 | 窗口 policy、受控模板、scope/predicate/projection、effectRule 与 CURRENT read-check 可直接消费；非法输入失败。 |
| P3-ISSUE-010 | TS/Java/目标服务分阶段门禁 | P3-02、P3-06、P3-07 | 任一 Gateway/target endpoint Java test 缺失/失败时 final report 非 valid；runtime 只验证本进程事实；外部 CI 真正调用根脚本并设 blocking。 |
| P3-ISSUE-011 | 本地 Worker release 与独立 canary | P3-02、P3-07 | surge target release=N/A 仍满足 stop/drain/verification；单 Worker disposable canary 保持 Reconciliation OFF，不依赖也不证明 P2-10。 |
| P3-ISSUE-012 | 同部署幂等 replay 范围 | P3-05、P3-06、P3-07 | 当前 Catalog normalize 后同 key/same signature replay 返回原 revision、不重派发；异输入冲突；无跨部署 key compatibility。 |
| P3-ISSUE-013 | 阶段 5.0 的关联和 receipt 合同 | P3-01、P3-04、P3-07 | 关联窗口/状态、去重/重复/resolved、内外 receiver 分离、NOT_EXPECTED 边界可由阶段 5.0 消费。 |
| P3-ISSUE-014 | 每场景资源预算及例外 | P3-01、P3-03、P3-07 | surge max=128 与拒绝 129 可测；storage totalBytes 无静态 max、目标 free-space guard 有效，minFreeBytes=1 MiB–1 GiB。 |
| P3-ISSUE-015 | 不实施 persisted revision drift scan | P3-00R、P3-06 | clean-slate 部署不保留旧 Run；实现中无 global/per-run revision 混比、legacy null drift 或 drift metric。 |
| P3-ISSUE-016 | Operator `CREATED` 事件投影 | P3-05、P3-07 | 创建事件 revision 经 allowlist 出现在 Operator timeline；非法 revision 被省略/拒绝，未透传其他 payload；不测试 legacy null。 |

## 5. 实施任务

### P3-00：现状基线与技术设计对齐

**目标：** 以当前 Phase 2 和告警 intake 实现修正 Phase 3 技术设计中的过期假设，明确实现前置项和 clean-schema 方案。

- [x] 复核 Phase 3 product/tech/phase 与当前 Catalog、Catalog revision、recovery policy、Owned driver registry、migration runner、runbook、Alertmanager 配置和 alert-intake route；源文件在本清单第 1.1 节列明。
- [x] 修订 `tech.md` 的当前基线：`CART_CATALOG_DEPENDENCY` 已有真实 driver path；Phase 2 的 non-`OFF` runtime 由 Reconciler/owned drivers 执行；legacy `OFF` 与新模式分开说明。
- [x] 修订技术设计中的实现建议，使其复用 `getFaultRunDrivers()`、`listRunnableFaultRuns()`、`resolveFaultRunRecoveryPolicy()`、`FaultRunRecoveryExecutor`、`FaultRunDrainRegistry` 和现有 migration runner，不再要求已由 Phase 2 实现的平行机制。
- [~] 原 revision migration `006` / fresh init `10` 的 expand 方案已由用户确认的 clean-slate 策略取代；改为维护 `fault-run-schema.ts`、`001` 与 init `04` 三处 fresh DDL，不扩展旧库迁移。
- [x] 校准 cleanup 与告警现状：scenario-wide cleanup route 当前拒绝 runless cleanup；Alertmanager intake 已有内部接收，但没有专用外部 Agent child route/receiver。
- [x] 将 `NOT_CONFIGURED` recovery verification 和无阶段 4 查询执行器作为显式限制；Contract 结构校验不等于实际恢复验证或 Evidence Query 已运行。
- [x] 保留现有 `getCatalogRevision()` 的 64 字符 SHA-256 格式和消费者；只对新 per-run `contractRevision` 使用 `sc.v1:sha256:` 前缀，并让 Catalog revision canonical input 纳入新 Contract supplement。

### P3-00R：设计复审整改与跨阶段接口定稿

**目标：** 根据用户选择统一产品、技术、任务与 Batch 4/5 交接并关闭设计歧义；不代表 Phase 3 runtime implementation 已开始。

- [x] 核对 Phase 3 设计/任务与当前 Phase 2 代码、批次 4 Evidence 和批次 5.0 Alert 技术设计，记录 P3-ISSUE-007～014 的证据、影响和建议方案；二次复审补记 P3-ISSUE-015/016。
- [x] 将 schema 决策定为 clean-slate only：`contract_revision VARCHAR(128) NOT NULL` 写入 runtime schema、migration `001` 与 init `04`；不新增 `006`/init `10`、旧 volume upgrade、legacy null 或历史 revision 回填（P3-ISSUE-002/006）。
- [x] 将历史合同边界定为 Phase 3 只保存 `catalogRevision` 与 per-run `contractRevision`；不保存完整 Contract JSON，Batch 4 capture flag 启用时才冻结 Evidence snapshot（P3-ISSUE-008/009）。
- [x] 确认 Catalog 为唯一可变事实源：supplement 不重复 target/prepare/release/cleanup/worker owner；真实 driver owner 派生；保留 global 64-hex 与 per-run `sc.v1:sha256:` revision，参数按名称排序且 UI 顺序不影响 hash；不做 Worker drift scan（P3-ISSUE-007/015）。
- [x] 定稿 lifecycle 与 canary 边界：local Worker stop/drain/verification 满足 `WORKER` recovery；无 Gateway target 时 release 可为 `NOT_APPLICABLE`；允许单 Worker disposable canary、`FAULT_RUN_RECONCILIATION_MODE=OFF`，不等待 P2-10，也不声称验证 TAKEOVER（P3-ISSUE-011）。
- [x] 定稿资源预算：surge `concurrency.max=128`；storage `totalBytes` 无静态 absolute max，依赖真实 filesystem free-space guard；`minFreeBytes` 为 `1 MiB`–`1 GiB` 并需同步 Catalog/目标服务（P3-ISSUE-014）。
- [x] 将 Batch 4 受限 window/template/scope/predicate/projection/`effectRule` DSL 定为唯一 Evidence schema；runbook Tempo 数据由 Contract 派生；snapshot 只由 Batch 4 capture flag 控制（P3-ISSUE-009）。
- [x] 将 Alert 与 Batch 5.0 `AlertCorrelationContract` 对齐，场景引用全局 `alert-receipt.v1`；`NOT_EXPECTED` 使用 `faultRunCorrelation=not_required` 但保留 generic receipt；internal receipt 与外部 Agent delivery/readiness 分离（P3-ISSUE-013）。
- [x] 定稿 runtime/CI 边界：`warn|enforce` 只处理本进程新 Run admission；TS preflight 与 Gateway/target Java results 汇总后才可 valid；外部 CI 调根脚本并设 blocking，本仓库不新增 GitHub Actions workflow（P3-ISSUE-010）。
- [x] 定稿同部署幂等：先按当前 Catalog 校验/标准化，匹配同 key/same signature 时返回已有 revision、不重派发；不同输入冲突；部署 reset 清理 keys，不支持跨部署 replay（P3-ISSUE-012）。
- [x] 定稿 Operator 事件读面：revision 与新 Run 行及 `CREATED` event 同事务写入；Operator timeline 通过严格 allowlist 展示格式合法的 revision；clean schema 无 null/legacy branch（P3-ISSUE-016）。
- [x] 将上述决策同步到 `product.md`、`tech.md`、Phase 3 roadmap、Batch 4/5 handoff 与本清单；复核任务/验收/issue 状态一致，P3-01～07 尚未标为已实施。

### P3-01：Catalog Contract supplement 与确定性 revision

**目标：** 在现有 Catalog 与 Catalog revision 机制上补充 Phase 3 语义，不复制场景基本事实。

- [ ] 按 P3-00R 定稿定义版本化 `ScenarioContractSupplement` / `ResolvedScenarioContract`，仅在 Catalog 的 `FaultRunScenarioDefinition` 挂载新增语义；从已有 `targetPrepare`、`recoveryPolicy.workerDrain` / `targetRelease` / `cleanup` 派生 dispatch 和 target lifecycle，不再另写可变 owner、prepare、release、cleanup 声明（P3-ISSUE-007）。
- [ ] 为全部 Catalog 场景补全参数消费者、可验证的 prepare/stop/recovery/side-effect/cleanup 检查 ID，校验消费者集合与 `parameters[]` 一致；driver owner 从现有 policy 与运行注册表求得，不以 `TARGET_ONLY` 或未实施 hook 占位（P3-ISSUE-007）。
- [ ] 按已确认的产品预算策略为全部场景声明并校验 duration、并发、字节/内存/存储等预算或运行保护；把两个 surge Catalog `concurrency.max` 设为 `128`、拒绝 129；`NOTIFICATION_STORAGE_APPEND.totalBytes` 不设绝对 max，以 filesystem usable-space guard 保留 `minFreeBytes`，并同步 Catalog/Java target 的 `minFreeBytes` 范围 `1 MiB`–`1 GiB`（P3-ISSUE-014）。
- [ ] 为每个场景补齐阶段 4 可直接消费的 Evidence Contract：稳定 recipe ID、窗口 policy 与硬上限、受限 template ID/scope/predicate/projection、required、`effectRule`、`WINDOWED`/`CURRENT` 区分、固定只读 Gateway check 和 unavailable 语义；拒绝任意 PromQL/LogQL/TraceQL/URL/SQL 或 Operator 输入。业务 CURRENT check 不得证明历史效果（P3-ISSUE-009）。
- [ ] 为每个场景补齐阶段 5.0 可直接消费的 Alert Contract：`NOT_EXPECTED` / `CONDITIONAL` / `REQUIRED_FOR_PILOT`、允许的 name/service/severity/低敏标签、关联窗口和 `faultRunCorrelation`；引用全局 `alert-receipt.v1`，不在各场景重复 fingerprint/upsert/retention policy。`NOT_EXPECTED` 仍保留通用 receipt 并设为 `NOT_REQUIRED`；内部 `sendResolvedToControlPlane` 与外部 Agent readiness/`send_resolved` 分开声明，不承诺 firing（P3-ISSUE-013）。
- [ ] 复用既有 canonicalization 规则解析 Contract：object key、parameters（按参数名）、无序 recipe/alert 集合稳定；原 Catalog revision 保持 64 位 hex，表单展示顺序不进入 hash；新 per-run revision 用 schema 前缀，排除请求实际值、时间戳、翻译文案、URL、secret 与遥测结果，不实现旧 Run drift scan（P3-ISSUE-007/015）。
- [ ] 用 12 场景 fixture 和变更 fixture 验证旧 `getCatalogRevision()` 调用者/参数重排兼容、Contract 语义变更引起相应 hash 变化、两种 revision 格式各自稳定，并证明 Stage 4/5 消费同一份 Catalog 派生数据而非第二份手写场景 map（P3-ISSUE-007/009/013）。

### P3-02：Gateway/Worker capability 对照与 recovery coverage

**目标：** 验证 Catalog 声明与真实执行者、固定目标、生命周期动作的覆盖关系；不建立新的运行时调度器。

- [x] 复核 Phase 2 已有四类 `OwnedFaultRunDriver`、`getFaultRunDrivers()`、owner fence 和 Catalog `recoveryPolicy`；其现状由批次 2 P2-05/P2-09 和 `fault-run-driver-registry.test.ts` 覆盖。
- [ ] 从现有 `getFaultRunDrivers()` / `OwnedFaultRunDriver` 及实际事件 writer 投影 owner/name、ACTIVE-only、drain owner 和终态 summary capability；使用真实 `supports(run)` 对 Catalog fixture 求覆盖，不建立第二份 `scenario -> owner` 数组。
- [ ] 用 12 场景矩阵证明恰好一个真实 driver 匹配；缺失、重复、孤儿 owner 均报 `missingDispatch`；Cart 的 `ScenarioWorkers` customer-session / Gateway 路径必须覆盖，不得标为 Runner/no-op。
- [ ] 对 legacy `OFF` 与 Reconciler 非 `OFF` 两种执行路径分别证明 effect driver 仅对 `ACTIVE` 发请求：`CREATING` 可执行已声明 PREPARE，`RECOVERING`/终态禁止新请求；owner 丢失后停止接收、取消并 bounded drain，不把公开请求当作可被 target fence 撤回。
- [ ] 逐场景对照 `recoveryPolicy.workerDrain.owner`、driver `drainOwner`、`FaultRunDrainRegistry` participant 和终态事件；缺席、超时或 `OUTCOME_UNKNOWN` 不得标成已 drained 或已恢复。
- [ ] 复用 `resolveFaultRunRecoveryPolicy()` 验证 PREPARE、RELEASE、`OPTIONAL_PER_RUN` / `OPERATOR_CONFIRMED` cleanup 与 `NON_RELEASING`；两个 local surge 的 target release 应为 `NOT_APPLICABLE`，但须有可验证 stop/drain 边界；不新增平行 resolver（P3-ISSUE-011）。
- [ ] 从 Gateway 真实 operation registry 建立只读测试 seam：十个 target-backed operation 的 service/prepare/release/cleanup 固定路径与 Catalog 对齐，两个 local surge 仅校验自己的 Worker target map；不能只比较两份手写字符串。
- [ ] 对十个 target-backed operation 的各目标服务添加/复用独立 controller mapping 与 wire-contract 测试，至少覆盖适用 prepare/release/cleanup 的请求字段、上下文校验及 `accepted`/业务 envelope；普通消费接口不得接收场景身份，Gateway 模块测试不能冒充跨服务验证（P3-ISSUE-010）。

### P3-03：纯函数 Contract validator 与稳定诊断

**目标：** 产出可单测、确定性、可解释的校验报告；CI 可以阻断缺项，运行代码不依赖仓库根目录。

- [ ] 实现 dependency-injected pure validator；输入为 resolved Catalog、capability descriptors 与预解析的 runbook/i18n/alert/config inputs，不直接访问 DB、网络、Gateway 或文件系统。
- [ ] 实现八类固定 issue category：`missingTarget`、`missingDispatch`、`invalidParameters`、`invalidRecoveryHook`、`missingEvidenceQuery`、`missingRunbook`、`missingI18n`、`invalidAlertContract`。
- [ ] issue schema 固定为 category/code/scenario/artifact/fieldPath/expected/actual/remediation；按稳定字段排序，避免任意原文、absolute path、secret 或 HTTP payload。
- [ ] 校验 Catalog 参数定义：唯一 name、kind/unit/default/options/min/max/maxLength、duration、缓存预算与消费者集合；资源上界或获批例外必须有对应保护/测试，不能因为现有 schema 未设 `max` 就自动通过 `invalidParameters`（P3-ISSUE-014）。
- [ ] 校验 Contract 声明与判断规则必须区分控制动作、effect observed、alert receipt、`EVIDENCE_UNAVAILABLE`、业务恢复和 cleanup；仅验证声明/适用性，不把静态通过当作现场效果。
- [ ] 为八类 issue 各提供至少一项负向 fixture，并包含重复/孤儿 driver、参数/预算缺失、无效窗口或任意查询、release 例外错配、告警关联字段缺失及 `ENABLED` 但 receiver 未就绪（P3-ISSUE-007/009/011/013/014）。
- [ ] 固定报告 schema、排序、错误码与 readiness 分离语义：TS 静态预检只表示本地部分通过；外部 Java/目标服务检查缺失、失败或版本不匹配时最终结果不得为 `valid`，不得以 `NOT_ENABLED_YET` 伪报已交付（P3-ISSUE-010）。

### P3-04：Runbook、i18n、evidence、alert 与术语工件

**目标：** 复用已有双语资料与告警 intake 输入，确保新增/变更场景不会在维护者和部署资料中漂移。

- [ ] 扩展 `runbook.test.ts` 为 Catalog-driven required headings / operation assertion；确保 12 个双语 allowlisted 文件逐个覆盖，生成 checklist 供人工核对，禁止靠解析 prose 推断机器语义。
- [ ] 扩展 i18n tests：Catalog 场景 label/description、参数 label/description、recovery label 均存在；`SCENARIO_META` 精确覆盖，每场景在且仅在一个 group。
- [ ] 用共享类型/fixture 对照阶段 4 技术设计的窗口 policy 与受控模板输入，校验固定只读检查、`WINDOWED` 与 `CURRENT` 的适用性、effect predicate 与 unavailable 规则；阶段 4 的窗口 resolver/查询执行器尚未实施，Phase 3 不执行遥测查询、不把 UI Tempo 提示当作历史证据（P3-ISSUE-009）。
- [ ] 将 `runbook.ts` 中重叠的 Tempo service/route/query 展示数据按定稿边界从 Catalog Evidence Contract 派生，保留 Markdown 解释与文件 allowlist；中英文文章仍可维护解释，但不能作为第二份机器查询定义（P3-ISSUE-009）。
- [ ] 从同一 Alert Contract 校验 Prometheus alert name/severity/静态 labels 与 Batch 5.0 correlation contract；校验所有场景引用全局 `alert-receipt.v1`，并用 fixture 覆盖 fingerprint upsert、重复/resolved 及 `NOT_EXPECTED` 通用 receipt 适用性；不把后续 Agent delivery 当作本批次已交付（P3-ISSUE-013）。
- [ ] 读取并规范化 Compose 与 Kubernetes Prometheus/Alertmanager YAML；只比较部署语义与内部 receipt/专用外部 receiver 的各自规则，不读取运行时 DB 中的可编辑 secret；`NOT_ENABLED_YET` 只表明未启用。
- [ ] 扩展术语检查输入，使 scenario ID 从 Catalog 生成；保留控制面外 `src/**` 扫描范围，新增 Catalog ID 不再要求人工改写硬编码正则。
- [ ] 从 resolved Contract 生成确定性 manifest、预检报告、表单元数据、runbook checklist、smoke matrix、术语输入和**合同测试骨架**；在临时/CI artifact 中保存并校验 schema、无 secret 与重复生成一致，不覆盖生产代码或 Markdown。最终报告须等待 P3-06 的 Java 验证。

### P3-05：Fresh schema revision 持久化与 Operator 读面

**目标：** 让新 Fault Run 绑定创建时的合同 revision，保证同一部署内幂等 replay、Operator 可见性和协议隔离；Phase 3 不保存历史 snapshot。

- [ ] 在 `fault-run-schema.ts`、`migrations/001-fault-runs.sql`、`infra/mysql/init/04-fault-run-schema.sql` 同步添加 `contract_revision VARCHAR(128) NOT NULL`；不新增 `006`、init `10` 或已有 volume upgrade path，并对三份 fresh DDL 做 parity test。
- [ ] 扩展 `db:verify` 检查 `contract_revision` 列存在、类型为 `VARCHAR(128)` 且 `NOT NULL`；部署要求 clean rebuild，不兼容旧 schema 必须 fail fast，不能隐式 `ALTER` 或吞错。
- [ ] 在 `FaultRunRecord`、`CreateFaultRunInput` 和 row mapper 中加入 required `contractRevision: string`；不设计 nullable/legacy row fallback。
- [ ] `FaultRunCoordinator.create()` 从当前已校验/标准化的 Catalog definition 计算 server-side revision；create transaction 同时写行与 `CREATED` event 中的 `contractRevision`/`catalogRevision`，失败整体回滚且不 dispatch prepare；legacy 与 Reconciler 创建路径一致。
- [ ] 同部署幂等先用当前 Catalog 校验/标准化，再按 `(idempotencyKey, scenario, normalized parameters)` 返回同 signature 的既有 Run/revision，不重派发；异 signature 冲突。Contract `enforce` 仅作用于新 admission；部署 reset 清除旧 key，不支持跨部署 replay（P3-ISSUE-012）。
- [ ] 明确 revision 只是识别符，不冻结执行 policy 或 Evidence DSL；状态迁移、audit attachment、stop/release/cleanup 均不得改写 revision。Batch 4 只在 capture flag 启用时保存自己的 Evidence snapshot（P3-ISSUE-008）。
- [ ] Operator list/detail 与 `CREATED` timeline 通过 allowlist 展示格式合法的 revision；扩展 `buildFaultRunOperatorEvent()` / `sanitizeFaultRunEventPayload()`，拒绝非法 payload，不展示合同全文、密钥、任意 alert labels 或客户数据（P3-ISSUE-016）。
- [ ] 添加 boundary tests：`toGatewayPayload()`、owned driver context、`FaultRunContext`、Gateway headers/body、cleanup action payload 和 consumer response 均不出现 contract/catalog/run lifecycle identity。

### P3-06：CLI、根级 gate、CI、配置与回退

**目标：** 把 contract validation 变成必需静态发布门禁；运行时从 warn 安全灰度到 enforce。

- [ ] 增加 `test:contract`、`validate:contract:preflight`、`validate:contract:finalize` 与 JSON/text 报告 CLI，确定性生成受控 Catalog/Gateway 期望与 issue；CLI 不建立 DB 连接、不请求环境、不触发 smoke，也不能在跨语言结果未到时输出“12/12 valid”。
- [ ] 增加根级 `scripts/test-scenario-contract.sh` 的分阶段编排：先生成预检/临时期望，再运行 Contract fixtures、runbook/i18n、术语、typecheck/lint，最后等待 Java 检查完成；临时文件带 schema/revision 并清理，不当作新的运行时映射。
- [ ] 用既有 Maven 工具执行 Gateway registry、目标服务 controller/wire contract 的针对性测试；产出可验证的结构化结果，覆盖十个 target-backed operation，结果必须与同一次 Catalog revision 匹配，缺失/失败不可被默认成功（P3-ISSUE-010）。
- [ ] 最终汇总 TS 预检与 Java/目标服务结果后再生成 `valid` 和八类 issue 报告；缺测试结果、revision 不匹配、执行中断或任一必需 endpoint 不通过均返回非零并标明限制，不允许以仅 TS 或仅 Gateway 测试冒充 12/12（P3-ISSUE-010）。
- [ ] CI 中接入完整静态门禁，成功/失败均上传去敏的 manifest/preflight/final report；确认外部 CI 将根脚本配置为 blocking/required。本仓库不新增 GitHub Actions workflow；如 pipeline 尚未接入，不能报告发布 gate 已启用。
- [ ] 在 `env.ts` 严格解析 admission-only `SCENARIO_CONTRACT_VALIDATION_MODE=warn|enforce`，非法值 fail-fast；只配置 Web/API，Worker 不读取该 mode；它不影响 Phase 2 owner/reconciliation 开关。
- [ ] `warn` 记录当前进程的 Contract 诊断；不实现 Worker persisted revision drift scan。`enforce` 只对当前进程新 Run admission 生效，跨层 Gateway/target mapping 由 CI 证明；同部署匹配的 idempotent replay 返回既有 Run，不触发新 admission/action（P3-ISSUE-010/012/015）。
- [ ] 更新 Compose traffic-control-plane Web/API、Kubernetes Web/API 和部署文档；Worker Deployment 与 migration Job 不增加此 mode。clean-slate 发布需先停旧 Web/Worker，再整体 reset disposable DB 与业务资源，fresh init 后再启动单版本应用，不做 active Run 逐条 reset gate。
- [ ] 记录并验证 disposable canary rollback：新 Run admission 从 `enforce` 切回 `warn`，随后按批准策略停止服务并整体重建 DB/业务资源；不得将该破坏性步骤用于共享/保留数据环境，也不得声称旧应用可读取新 schema。

### P3-07：集成验证、canary 准入与阶段退出

**目标：** 以目标行为证据验证 Contract，而不是只凭类型、manifest 或测试 fixture 宣称跨层闭环。

- [ ] 跑受影响的 targeted 单元测试：12 场景 derived policy/revision（含真实 driver owner 名称）、八类负向 fixture、预算/例外、Evidence/Alert 合同、ACTIVE/drain/recovery、同部署幂等 replay、Operator `CREATED` 事件投影和缺少 Java 结果；不测试跨部署 drift、legacy null 或升级迁移（P3-ISSUE-007～016）。
- [ ] 跑已有 `pnpm test:runner`、`pnpm test:runbook`、`pnpm test:i18n`、typecheck、lint、build 与 `check-runtime-terminology.sh`，失败逐项登记；静态通过不得宣称告警已 firing 或业务已恢复。
- [ ] 运行 Gateway registry 及所有适用 target controller/wire Maven tests，检查真实 endpoint、Generic DTO、可见错误和消费者信息隔离；仅比较手写字符串或只跑 Gateway 不满足门禁（P3-ISSUE-010）。
- [ ] 在 disposable MySQL 验证 MySQL init 和 `db:migrate` 从空库均创建三份一致的 `contract_revision NOT NULL` schema，`db:verify` 正确检查列定义；验证 create transaction 回滚和同部署幂等，不做 `005 -> 006`、旧 volume 或 nullable fallback 测试。
- [ ] 在单 Worker、`FAULT_RUN_RECONCILIATION_MODE=OFF` 的 disposable 环境创建/重放/停止至少一个有效 Run；检查行与 `CREATED`/Operator timeline revision 一致、`warn/enforce` 新 Run admission、Gateway/consumer header/body 无控制面信息。结束后按部署方案整体 reset DB 与业务资源。
- [ ] 按 generated smoke matrix 为 12 场景逐个审查实际目标业务路径、准备/停止/清理边界和运行前提；只能在适用的可丢弃环境演练高风险场景，未运行的必须写明限制，不把一场景 smoke 或 TS 12/12 当作全场景现场验收。
- [ ] 确认外部 CI 在同一 Catalog revision 上运行根脚本并设为 blocking/required；缺少 Gateway 或任一目标服务 Java result、报告 revision 不匹配或 pipeline 未实际接线时不得标记最终报告 valid。
- [ ] 用 TS + Gateway/target 全部验证结果生成最终逐场景 `valid` / `blocked` / `limited` 报告；缺少任何必需结果不得计入 12/12。告警 delivery `NOT_ENABLED_YET`、观测不可用、验证未配置与不匹配只能表述为能力限制，不等于合同静态校验通过后现场效果已发生。
- [ ] canary 前确认 DB 和业务资源均可丢弃、单 Worker、`FAULT_RUN_RECONCILIATION_MODE=OFF`、旧 Web/Worker 已停止；无需 pre-reset Run 级 cleanup gate。记录被 reset 的数据/资源，演练 enforce -> warn 与整套重建；将 P2-10 作为 Phase 2 独立状态，不作为 P3 canary 前置或通过证据（P3-ISSUE-011）。

## 6. 阶段 3 退出标准

- 12 个 Catalog 场景都解析成唯一、版本化的 resolved Contract；每个场景恰有一个真实 dispatch owner。
- `targetPrepare`、release/drain/cleanup 以 Catalog 既有字段为事实源；Catalog 旧 revision 格式与参数重排语义保持兼容，Contract per-run revision 独立版本化；全部场景的预算或获批例外有校验及运行保护证据。
- 八类固定校验均有负向测试；缺 target/dispatch、预算/参数消费者、recovery hook、受限 Evidence Query、runbook、i18n 或阶段 5 可消费的 alert contract 时 strict gate 失败。
- 目标路径、Worker driver、owner/recovery policy、runbook/i18n、Evidence recipe 与 alert 声明无未解释漂移；Gateway 和对应目标服务 Controller 均由真实代码测试，而非第二份手工映射。
- 新 Fault Run 的 revision 在数据库行、`CREATED` event 和受控 Operator 事件投影一致；clean schema 中 `contract_revision` 为 `NOT NULL`。Phase 3 不保存完整 snapshot、不提供旧 Run/旧 schema 或跨部署 key 兼容；Batch 4 capture flag 启用时冻结 Evidence snapshot。
- contract metadata 不进入 consumer、Gateway、target service 或外部 Agent payload；外部系统只接收其业务允许的通用协议。
- 告警未 firing、receipt 未到达、观测数据不可用、无法唯一关联和业务恢复未验证均可显式表达；`NOT_ENABLED_YET` 不等于阶段 5 receiver 已上线，静态配方不等于现场已查询。
- TS 预检和 Gateway/目标服务测试汇总后才能产生最终 12/12 报告；外部 CI 根脚本设为 blocking/required，缺少/失败的跨语言结果必须阻断；运行时默认 `warn`，`enforce` 只作用于当前进程的新 Run admission，不冒充跨服务实时验证。
- clean schema 的两条 fresh-install 路径与三处 DDL parity 有可复核证据；单 Worker disposable canary 的 Reconciliation 为 `OFF`，reset 与 rollback 明确记录数据/资源损失。P2-10 仍独立验收，但不是 P3 canary/退出的依赖。

## 7. 问题跟踪

| ID | 发现阶段/任务 | 问题 | 影响 | 处理方案 | 状态 |
| --- | --- | --- | --- | --- | --- |
| P3-ISSUE-001 | P3-00 | 现有 tech 描述与 Phase 2 交付存在漂移，尤其是 driver/recovery owner、`CART_CATALOG_DEPENDENCY` coverage 和旧 scanner 描述。 | 若照旧设计直接执行，可能重复建设执行器或错误宣称场景 dispatch 缺失。 | P3-00 已依据 `WorkerRuntime`、Reconciler、Owned drivers、Catalog recovery policy 和 task evidence 校准；Contract validator 复用这些 seams。 | 已解决（设计修订） |
| P3-ISSUE-002 | P3-00/P3-05 | 早期方案曾要求通过 `006` 升级现有数据库。 | 与用户确认的“部署清库重建、不兼容旧数据”策略冲突，并增加不需要的 migration/nullable 分支。 | 关闭 `006`/init `10` 方案；更新 runtime create schema、`001` 与 init `04` 的 fresh DDL 并做 parity/verification。旧 volume 不受支持，`db:verify` fail fast。 | 已关闭（clean-slate 决策替代） |
| P3-ISSUE-003 | P3-03/P3-04 | 当前有 UI Tempo recipe 和 alert receipt intake，但没有全场景 run-relative Evidence Query Manifest，也没有专用外部 Agent delivery。 | 不能将文档提示或 intake route 误称为查询执行和 Agent 投递已完成。 | Phase 3 定义/校验受限 Evidence/Alert Contract；Batch 4 capture flag 控制 snapshot 和查询执行；外部 Agent route/readiness 独立报告。 | 设计边界已定；实现待 P3-01/04 与后续批次 |
| P3-ISSUE-004 | P3-02/P3-07 | Catalog verification 当前为 `NOT_CONFIGURED`，没有所有场景共用的 live recovery verification adapter。 | 不能因 worker drain/release 成功就把业务恢复判为已验证。 | Contract 只校验声明和适用性；报告继续表示 `UNKNOWN`/`VERIFY_UNAVAILABLE`，不将此限制隐藏为 success。 | 已接受限制（后续 verification/evidence 批次处理） |
| P3-ISSUE-006 | P3-00/P3-05 | 早期方案中 MySQL init `10` 与 migration `006` 会重复增加 revision 列。 | 可能导致重复 DDL；但此升级路径不再受支持。 | 不创建 `10`/`006`；把 required column 直接写入三份 fresh DDL，验证 DDL parity 与 clean `db:verify`。 | 已关闭（clean-slate 决策替代） |
| P3-ISSUE-005 | P3-00/P3-01 | 已有 `getCatalogRevision()` 返回 64 字符小写 SHA-256，且 baseline/tests 依赖此格式；若按早期设计统一改为 `sc.v1:sha256:` 会破坏兼容性。 | baseline、revision 格式校验和既有调用方可能同时漂移。 | 保留 `catalogRevision` 原格式；Contract 单 Run revision 新增带 schema prefix 的 `contractRevision`，并测试参数排序及新旧 revision 格式。 | 已解决（设计修订；实现待 P3-01） |
| P3-ISSUE-007 | 设计复审 / P3-01 | supplement 的 `dispatch.owner`、`requiresDrain`、`targetLifecycle.prepareRequired/release/cleanup` 重复 Catalog 的 `targetPrepare` 和 `recoveryPolicy`；示例 `REPORT_WORKER` 与实际 driver `REPORT_SCENARIO_WORKER` 不同；canonicalization 不可受参数显示顺序影响。 | 产生第二份可变策略；两个报表场景可能误报缺失 owner，UI 排序变化使 Catalog revision 漂移。 | supplement 只保留新增检查、证据、告警和消费者信息；owner 从 Catalog/driver name 派生；global Catalog hash 保持既有按参数名排序语义，UI 顺序不参与任何 revision。 | 已解决（设计修订；实现待 P3-01/03） |
| P3-ISSUE-008 | 设计复审 / P3-05 | Phase 3 revision hash 不能还原旧 Contract；早期技术设计曾要求在创建时冻结完整 Evidence snapshot。 | 容易误把 hash 当 archive，或在 Phase 3/4 重复保存 snapshot；但当前部署整体 reset、不保留 Run。 | Phase 3 只写两种 revision；Batch 4 仅在 capture flag 启用时冻结 Evidence snapshot。部署前停止旧进程并整体 reset DB/业务资源，不做旧 Run per-run gate 或跨部署恢复。未来保留数据另行设计。 | 已解决（用户决策与 Batch 4 对齐） |
| P3-ISSUE-009 | 设计复审 / P3-01/P3-04 | 旧 Evidence 字段未能满足 Batch 4 对窗口、受限模板/scope/predicate/projection、`CURRENT` read-check 和 `effectRule` 的要求。 | Batch 4 若另建 schema 会形成第二份查询事实源。 | Phase 3 Catalog supplement 采用 Batch 4 DSL；`runbook.ts` Tempo 服务/路由/查询数据从同一 Contract 派生，不允许任意 query string。 | 已解决（接口定稿；实现待 P3-01/04） |
| P3-ISSUE-010 | 设计复审 / P3-02/P3-06 | 最终 report 依赖 Gateway 和 10 个 target-backed operation 的 Java endpoint tests；control-plane runtime 不含 Gateway Java map。 | 只跑 TS 或 Gateway 测试会假报 12/12；runtime enforce 无法校验跨服务映射。 | TS preflight 与 Gateway/target-service test 分阶段产出同 revision 结果，finalize 缺任一 required result 即 fail；外部 CI 调脚本并设 blocking，runtime 仅校验本进程 admission。 | 设计已解决；pipeline 接入待 P3-06 |
| P3-ISSUE-011 | 设计复审 / P3-07 | 本地 surge 没有 Gateway target release；P2-10 多 Worker/TAKEOVER 尚有独立验收。 | 强制 target release 会拒绝合法 Worker-only 运行；把 P2-10 作为本 canary 条件会造成无关阻塞。 | `WORKER` 用 stop/drain/verification 满足适用 recovery；target release 可 `NOT_APPLICABLE`。P3 canary 允许在 disposable 单 Worker、Reconciliation OFF 下独立执行，不替代 P2-10。 | 已解决（用户决策与设计已同步） |
| P3-ISSUE-012 | 设计复审 / P3-05/P3-06 | 当前 API/Coordinator 先按当前 Catalog 校验、标准化，再用幂等 key 查重。 | 跨部署 schema 变化会改变请求等价性；用户明确不要求兼容跨部署 replay。 | 只支持同部署：先按当前 Catalog normalize，匹配同 key/same signature 返回原 revision，不重派发；不同输入冲突；clean reset 清除 key。Contract enforce 只用于新 admission。 | 已解决（范围限定；测试待 P3-05） |
| P3-ISSUE-013 | 设计复审 / P3-01/P3-04 | Phase 3 旧 alert type 缺少 Batch 5.0 correlation fields，且将场景 receipt policy 与平台 webhook 状态机混在一起。 | 两阶段会重复或不兼容维护 receipt semantics；`NOT_EXPECTED` 容易被误解为不接收通用 receipt。 | 复用 `AlertCorrelationContract`，用全局 `alert-receipt.v1` 引用 Batch 5.0 retention/upsert/resolved 语义；`NOT_EXPECTED`=`NOT_REQUIRED` correlation 但保留 generic receipt，外部 Agent readiness 独立。 | 已解决（接口定稿；实现待 P3-01/04） |
| P3-ISSUE-014 | 设计复审 / P3-01/P3-03 | surge `concurrency` 与 storage `totalBytes` 需要预算上界或运行时 guard。 | 静态 gate 可能漏掉没有明确保护的资源使用。 | 固定 surge `concurrency.max=128`；storage `totalBytes` 不设绝对 max，目标 free-space guard 强制写后保留 `minFreeBytes`；该范围为 `1 MiB`–`1 GiB` 并同步 Catalog/Java。 | 已解决（边界定稿；实现与测试待 P3-01/07） |
| P3-ISSUE-015 | 二次复审 / P3-00R/P3-06 | per-run Contract revision 与 global Catalog revision 格式/作用域不同，不能互作 drift 对照。 | 同一场景未变或仅别的场景变化会被错误报告 drift。 | 根据 clean-slate reset 不保留跨部署 Run，不实施 Worker revision drift scan/metric；保留两种 revision 各自用途与格式。 | 已解决（用户决策与设计已同步） |
| P3-ISSUE-016 | 二次复审 / P3-05 | 现有 `sanitizeFaultRunEventPayload()` 未处理 `CREATED`，Operator timeline 看不到新 revision。 | 仅落库不能满足 Operator 追踪，直接透传 payload 会扩大数据暴露。 | P3-05 扩展 `CREATED` 的严格 schema/allowlist projection，仅输出格式合法的 `contractRevision`/`catalogRevision`；fresh schema 无 null/legacy branch，非法 payload 不伪造字段。 | 设计已解决；实现与读面测试待 P3-05 |

## 8. 执行更新记录

| 时间 | 任务 | 事实与证据 | 限制/下一步 |
| --- | --- | --- | --- |
| 2026-09-24 CST | P3-00：现状复核与任务拆分 | 对照 Catalog/revision/recovery policy、四类 owned drivers、Scenario/Reconciler、migration runner、cleanup route、runbook/i18n 和 Alertmanager intake；确定 `CART_CATALOG_DEPENDENCY` 的 ScenarioWorkers owner、`FAULT_RUN_RECONCILIATION_MODE` 接线、cleanup 只能 per-run confirmed、已有 `001`–`005` migration foundation。 | 任务清单建立；Contract supplement、validator、per-run `contractRevision`、静态 gate 均仍待实施。 |
| 2026-09-24 CST | P3-00：技术设计与 Phase 2 实现对齐 | 修订 `tech.md`：分别描述 legacy、safe-runtime 和 non-`OFF` Reconciler；改正 Cart owner；复用现有 driver registry/ACTIVE admission/drain registry/recovery policy executor；将 notification storage cleanup 定为 Operator-confirmed per-run，runless route 为拒绝；确认 migration `006` 与 fresh init `10` 复用现有 CLI/Job，并处理 init 与 `db:migrate` 重复 ALTER；保留 `NOT_CONFIGURED` verification 与 generic alert receiver 限制；区分兼容的 catalog hash 与新增 contract hash。 | P3-00 关闭。P3-ISSUE-001 已解决；P3-ISSUE-002/006 方案已确认、代码待 P3-05；P3-ISSUE-005 格式决策已解决、兼容测试待 P3-01。下一步 P3-01。 |
| 2026-09-24 CST | P3-00R：Phase 3 技术设计/任务覆盖复审 | 对照 Phase 3 产品、路线、技术设计、P3-00～07 任务，核实 Phase 2 Catalog/recovery/driver/migration 代码与 P2-10 状态，并检查批次 4 Evidence、批次 5.0 Alert 的交接合同。任务分组覆盖主要设计范围，但 P3-ISSUE-007～014 尚未闭环。 | 本次只记录审查发现与解决建议，未实施或批准运行时/数据模型变更；P3-00R 为 1/6。先修订相应设计与任务，再启动受影响的 P3-01/P3-05/P3-06。P3-07 保留批次 2 退出门禁。 |
| 2026-09-24 CST | P3-00R：审查方案落实到任务清单 | 将 P3-ISSUE-007～014 逐项映射至设计定稿、P3-01～07 实施和最低完成证据；细化参数预算、Stage 4 Evidence DSL/历史策略、Stage 5 告警关联、Java target endpoint、TS+Java 最终门禁、幂等 replay 与 P2-10 退出前提，并更新任务组计数与退出标准。 | 仅编辑本清单，Product/tech 和历史合同归属等设计仍待 P3-00R 定稿；P3-00R 保持 1/10，P3-01～07 未新增已完成项，Phase 3 未实施。 |
| 2026-09-24 CST | P3-00R：二次设计/任务覆盖复审 | 再核对当前 `product.md`、`tech.md`、P3-00R/P3-01～07 与 API、Coordinator、Repository 和 Operator 事件投影，登记 P3-ISSUE-015/016；补充 P3-ISSUE-007/008/010/012 的 owner 名称、旧 Run 安全停止、跨服务 runtime 能力和当前 schema 校验前幂等回放边界，并分别映射到 P3-00R、P3-05～07 的完成证据。 | 仅更新任务记录，未修改未定稿设计或业务代码；P3-00R 仍为 1/10。P3-ISSUE-008/012/014 等需方案决定，设计未达到直接实施条件。 |
| 2026-09-26 CST | P3-00R：用户决策同步与跨文档对齐 | 将 clean-slate/NOT NULL、Phase 3 revision vs Batch 4 capture snapshot、Catalog 派生策略、Batch 4 Evidence DSL、Batch 5.0 Alert/receipt reference、预算边界、同部署幂等、API-only warn/enforce、外部 CI 和 disposable Reconciliation-OFF canary 同步到 Product、Tech、Phase 3 roadmap、Batch 4/5 Tech 与任务清单；将 P3-00R 更新为 12/12，并收敛 P3-ISSUE-002/006/007～016。 | 文档范围完成；无运行时代码、旧库 migration 或 GitHub Actions workflow 变更。`git diff --check` 通过。P3-01～07 仍未实施；下一步按任务清单开始 P3-01。 |

## 9. 每次任务更新模板

每完成、阻塞、恢复或取消一个子任务，紧接着追加一行到“执行更新记录”，并同步更新“总体进度”、任务组计数和“问题跟踪”：

| 时间 | 任务 | 事实与证据 | 限制/下一步 |
| --- | --- | --- | --- |
| YYYY-MM-DD CST | P3-nn / 子任务 | 变更文件、命令及通过/失败摘要；若是设计任务，写明校准的事实。 | 尚存问题、明确阻塞/方案或下一个可执行任务。 |
