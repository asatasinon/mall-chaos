# 批次 0：运行基线与发布护栏实施任务清单

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | P0-14 已完成（有 limitation；Kubernetes runtime 与真实观测 adapter 阻塞）；P0-01 至 P0-14 已处理 |
| 版本 | 1.4 |
| 更新时间 | 2026-09-17 16:28 CST（远端 Compose 真实验收与回退核验） |
| 路线阶段 | [阶段 0：基线和发布护栏](../../roadmap/phases/phase-0-baseline.md) |
| 产品规格 | [product.md](./product.md) |
| 技术设计 | [tech.md](./tech.md) |
| 场景事实来源 | `traffic-control-plane/src/lib/fault-run-catalog.ts` |

## 任务规则

1. 开始任务时将 `- [ ]` 改为 `- [-]`；完成本任务定义的验证并记录执行情况后，才改为 `- [x]`。被阻塞的任务使用 `- [!]`，并关联“问题跟踪”中的 ID。
2. 每完成、阻塞、恢复或取消一个子任务，立即同步更新：对应复选框、任务组状态和进度、总体进度、更新时间，以及“执行更新记录”中的一行事实记录。
3. 每发现或解决一个问题，立即在“问题跟踪”中保留问题、影响、方案和状态。问题解决后不得删除历史；方案影响产品范围、数据边界、权限、状态语义或发布方式时，先更新 [product.md](./product.md) 和 [tech.md](./tech.md)。
4. 场景、目标 operation、参数、时长和 `recoveryStrategy` 只从 Catalog 读取。本清单不复制场景定义，也不以固定数量作为覆盖完成依据；运行覆盖以采集时的 `catalogRevision` 和 Catalog 派生矩阵为准。
5. 缺失事实必须记录为 `NULL`、`UNKNOWN`、`INCOMPLETE` 或明确 limitation，禁止以 `0`、空数组或成功状态补齐。旁路采集不得改变 Fault Run、Worker、Gateway 或目标服务的业务效果。
6. 所有写入接口沿用 Operator session、CSRF、审计和现有错误 envelope；观测核验只保存摘要、查询引用和判断结果，不保存原始指标、日志、Trace、告警 envelope、凭据或可执行命令。
7. 默认保持 `BASELINE_CAPTURE_ENABLED=false`。未完成迁移、自动化验证和可回退验证前，不得在共享环境启用采集路径。
8. 任务组进度按组内子任务统计；总体进度同时展示任务组数和子任务数。文档建立、状态更新和问题登记不计入实施任务组。

## 总体进度

- **总体状态：** Phase 0 已完成（有 limitation，暂不进入 Batch 1）；P0-01 至 P0-14 均已处理。Compose 真实运行、Data Warmup、baseline、Alertmanager receipt、回退和 Pilot review 已有证据；Kubernetes runtime 与真实 Prometheus/Loki/Tempo adapter 仍未具备。
- **总体进度：** 14 / 14 个任务组（73 / 74 个子任务完成，1 个子任务阻塞）。
- **当前任务：** P0-14：真实环境基线、验收与阶段退出（已完成；P0-14-3 因无授权 Kubernetes namespace/runtime 标记阻塞）。
- **当前问题：** P0-ISSUE-001、P0-ISSUE-002、P0-ISSUE-004、P0-ISSUE-006、P0-ISSUE-009、P0-ISSUE-011 已完成 Compose 运行核验但保留各自 limitation；P0-ISSUE-003 仍受 Kubernetes runtime 限制；P0-ISSUE-010 的个别业务 failure code 仍需复核；P0-ISSUE-016 的真实观测 adapter 尚未实现；P0-ISSUE-017 的镜像/源码漂移已修复。
- **下一步：** 若要进入 Batch 1，先提供可复查的 Kubernetes namespace/owner/window，实现并接入真实观测 adapter，再对当前 `a9f117...` Catalog revision 重新评审；当前保持 `BASELINE_CAPTURE_ENABLED=false`、`DATA_WARMUP_ENABLED=true`、零个 `SELECTED`，不删除历史 baseline 或数据卷。

| 任务组 | 目标 | 状态 | 进度 | 前置依赖 |
| --- | --- | --- | --- | --- |
| P0-01 | 范围锁定与执行前检查 | 已完成（有 limitation） | 4 / 4 | 无 |
| P0-02 | 事实来源、事件和失败分类盘点 | 已完成（有 limitation） | 4 / 4 | P0-01 |
| P0-03 | 持久化 schema、迁移与受控类型 | 已完成 | 5 / 5 | P0-02 |
| P0-04 | Catalog、发布、部署和预热元数据 | 已完成（有 limitation） | 6 / 6 | P0-03 |
| P0-05 | 事件折叠、时间线和完整性判断 | 已完成（有 limitation） | 6 / 6 | P0-02、P0-03、P0-04 |
| P0-06 | Worker 结束汇总事件补齐 | 已完成（有 limitation） | 4 / 4 | P0-02、P0-05 |
| P0-07 | Baseline capture 服务与幂等 repository | 已完成（有 limitation） | 5 / 5 | P0-03 至 P0-06 |
| P0-08 | Operator API、鉴权、CSRF 与审计 | 已完成（有 limitation） | 5 / 5 | P0-07 |
| P0-09 | 只读观测、retention 与告警接入核验 | 已完成（有 limitation） | 5 / 5 | P0-04、P0-07 |
| P0-10 | 阶段 5 pilot review | 已完成（无合格候选） | 5 / 5 | P0-09 |
| P0-11 | 配置、资源预算、运行手册与回退护栏 | 已完成（有 limitation） | 6 / 6 | P0-03、P0-04、P0-08 至 P0-10 |
| P0-12 | 单元测试与 fixture 覆盖 | 已完成（有 limitation） | 6 / 6 | P0-03 至 P0-10 |
| P0-13 | 集成、安全边界与回退测试 | 已完成（有 limitation） | 6 / 6 | P0-08 至 P0-12 |
| P0-14 | 真实环境基线、验收与阶段退出 | 已完成（有 limitation） | 7 / 7（6 完成，1 阻塞） | P0-11 至 P0-13 |

## 执行依赖

```mermaid
graph TD
    P001[P0-01: 范围与前检查] --> P002[P0-02: 事实与事件盘点]
    P002 --> P003[P0-03: Schema 与类型]
    P003 --> P004[P0-04: 元数据]
    P002 --> P005[P0-05: 事件折叠]
    P003 --> P005
    P004 --> P005
    P005 --> P006[P0-06: Worker 汇总]
    P003 --> P007[P0-07: Capture 与 Repository]
    P004 --> P007
    P005 --> P007
    P006 --> P007
    P007 --> P008[P0-08: Operator API]
    P004 --> P009[P0-09: 观测与告警核验]
    P007 --> P009
    P009 --> P010[P0-10: Pilot Review]
    P008 --> P011[P0-11: 发布护栏]
    P009 --> P011
    P010 --> P011
    P007 --> P012[P0-12: 单元测试]
    P010 --> P012
    P011 --> P013[P0-13: 集成与回退测试]
    P012 --> P013
    P011 --> P014[P0-14: 环境验收]
    P013 --> P014
```

---

## P0-01：范围锁定与执行前检查

**目标：** 在不改动运行时行为的前提下，锁定批次边界、可用环境和本次采集所依据的事实。

**状态：** 已完成（有 limitation）；**进度：** 4 / 4；**关联问题：** P0-ISSUE-001、P0-ISSUE-003、P0-ISSUE-004、P0-ISSUE-006、P0-ISSUE-007

- [x] 复核路线阶段、产品规格、技术设计和共用运行规则，确认本批次只增加旁路采集、只读查询和发布护栏，不新增目标服务行为、自动恢复或 Agent 写权限。
- [x] 从 `listScenarioDefinitions()` 生成本次覆盖矩阵，并记录生成时间、`catalogRevision`、目标 operation、`recoveryStrategy` 和待核验 dispatch；矩阵只作为带 revision 的执行证据，不成为第二份 Catalog。
- [x] 确认 disposable Compose 运行和 Kubernetes 配置核验的责任环境、访问边界、观测入口与停止窗口；本次执行由用户明确授权当前工作区作为 disposable Compose 环境，核验结束后停止容器但保留数据卷；Kubernetes 仍仅完成 manifest/context 核验，未部署 `castrel` namespace。初始阻塞及解除记录见 P0-ISSUE-005。
- [x] 在任何代码改动前记录控制面、Gateway、MySQL、Redis 和观测组件的健康检查结果，以及当前 active Fault Run、预热状态和已有残留资源摘要；不可用和未知事实按 limitation 记录，不视为健康或清理完成。

### P0-01 环境与状态快照

初始检查时间：`2026-09-16 14:50:39 CST`（`2026-09-16T06:50:39Z`）；完整栈稳定复核：`2026-09-16 15:29 CST`。以下是当前工作区的观察结果，不代表 Kubernetes 专用环境已就绪。

| 范围 | 声明入口与访问边界 | 本次观察 | 停止/限制 |
| --- | --- | --- | --- |
| Compose | `docker compose`；控制面、Gateway、Shopfront 和观测入口使用 README 中声明的宿主机端口；MySQL/Redis 端口也对宿主机发布 | `docker compose config --quiet` 通过；用户确认启动边界后，完整栈已运行；控制面/Gateway/Shopfront、业务服务健康检查和带认证的 Prometheus/Alertmanager/Loki/Tempo 入口最终可达。预热显式关闭。Order 默认 JVM 首次启动 OOM，使用本次核验专用的 512MB `JAVA_TOOL_OPTIONS` 临时容器后健康 | 核验结束只停止/移除容器并保留数据卷；本地 ARM64 通过 linux/amd64 模拟，资源预算不代表专用环境性能基线；不执行场景 Fault Run |
| Kubernetes | Kustomize 默认 namespace 为 `castrel`；业务与观测服务为集群内 Service，控制面按 README 通过 `kubectl port-forward` 访问 | `kubectl kustomize k8s` 通过；当前 context 可执行目标 namespace 的只读权限检查，但 `kubectl get namespace castrel` 返回 `NotFound`，namespace 下没有可核验对象 | 未执行部署或 teardown；`scripts/k8s-teardown.sh` 会移除整套资源，`--delete-pvc` 还会删除 MySQL 数据，未经批准不得执行 |
| 责任与窗口 | 本次执行边界由用户确认：当前工作区作为 disposable Compose，结束后停止容器并保留数据卷；Kubernetes 仍为配置核验环境 | 本次 Compose 授权和停止边界已确认；专用共享环境 owner、Kubernetes namespace 和长期窗口仍为 `UNKNOWN` | P0-ISSUE-005 在本次执行范围解除；不能把本地 Compose 资源预算外推到共享环境 |

### P0-01-4 运行状态摘要

- **健康检查：** MySQL、Redis、全部带 healthcheck 的业务服务、Gateway、Shopfront 和控制面最终为 `healthy`；控制面根路由跟随重定向返回 `200`，Gateway actuator 返回 `200`，带配置认证的 Prometheus、Alertmanager、Loki 和 Tempo 入口最终返回 `200`。Worker 无 healthcheck，但容器为 `running`；本次仅确认进程存活，不能把它当作业务循环完成。
- **Fault Run：** `fault_runs` 当前仅观察到 `FAILED=16`、`RECOVERED=1`、`STOPPED=7`；查询非终态集合无结果，因此当前没有可确认的 active/non-terminal Fault Run。该结论只覆盖当前 MySQL 数据，不替代完整控制面 API 核验。
- **预热：** `DATA_WARMUP_ENABLED=false`，因此本次 Worker 没有取得预热写入租约；`data_warmup_progress` 仍有 `user_behavior_log` 和 `product_price_history` 两行，均为 `BACKFILLING`，`target_rows=90000000`、`actual_rows=0`、`current_date_value=2026-08-27`、`day_completed_rows=0`、`lease_owner=NULL`、`last_success_at=NULL`；没有 manual job，manual exclusion 数为 `0`。这与当前支持的 180 天 × 300000 行/天约束和当前检查日期不一致，不能判定为就绪，详见 P0-ISSUE-006。
- **残留资源：** 本地目录观察到 `data/mysql=154M`、`data/loki=124K`；`data/redis`、`data/prometheus`、`data/notification-service`、`data/catalog-service`、`data/promotion-service`、`data/inventory-service` 为 `0B`，控制面/Worker/Tempo/Alertmanager 目录不存在。Redis 中按 `traffic-control-plane:*`、`fault-run:*`、`fault:*` 和 `*warmup*` 扫描未发现 key 名称；应用目标资源因目标服务未运行而为 `UNKNOWN`，不能据此宣称已清理。

## P0-02：事实来源、事件和失败分类盘点

**目标：** 将已有运行事实映射为可复查的 baseline 输入，并明确缺失信息的处理方式。

**状态：** 已完成（有 limitation）；**进度：** 4 / 4；**关联问题：** P0-ISSUE-001、P0-ISSUE-006、P0-ISSUE-007、P0-ISSUE-008、P0-ISSUE-009、P0-ISSUE-010、P0-ISSUE-011

- [x] 盘点 `fault_runs`、`fault_run_events`、`operator_audit_logs`、预热进度和现有 Worker 汇总事件的字段、保留期、关联键和可信边界；实际 schema、代码 retention 和当前数据窗口已记录如下。
- [x] 为 Catalog 派生覆盖矩阵逐项核验 Catalog target map、Worker/Runner dispatch、实际受控请求和终态汇总事件，特别记录缺少 dispatch 或汇总事实的条目；当前 MySQL 证据与静态路径差异已记录如下。
- [x] 定义并评审五类稳定失败分类：目标效果、控制面、Worker、恢复和清理；区分控制动作、效果观察、业务恢复和资源清理四种事实，禁止退化为笼统的 `FAILED`；规则如下。
- [x] 形成低基数事件命名、必填字段、payload 限长和脱敏约定，列出可复用事件、待补齐汇总事件及无法可靠采集的字段；约定如下。

### P0-02-1 事实来源盘点

| 事实来源 | 关键字段与关联键 | 保留/生命周期 | 可信边界 |
| --- | --- | --- | --- |
| `fault_runs` | `fault_run_id` 主键；`scenario`、`target_service`、`target_operation`、`state`、`parameters_json`、`fencing_token`、`started_at`、`expires_at`、`stopped_at`、`stop_reason`、`recovery_result`、`recovery_error`、`operator_audit_id`、`trace_id`、`created_at`、`updated_at` | Worker 每 24 小时尝试一次 retention；仅删除 `stopped_at`、`recovery_result` 非空且状态为 `RECOVERED/STOPPED/FAILED`、停止时间超过 7 天的记录，每次最多 100 条 | 状态/时间/恢复结果是控制面事实；参数和错误来自控制面输入或目标返回，不能单独证明目标效果或业务恢复 |
| `fault_run_events` | `id` 主键；`fault_run_id` 关联来源 run；`event_type`、可空 JSON `payload`、`created_at`；查询按 `(fault_run_id, created_at, id)` | 与 eligible Fault Run 一起被显式删除；DDL 对 `fault_runs` 是 `ON DELETE CASCADE`，但 retention 代码仍显式删除事件 | 事件是控制面/Worker 写入的运行证据；事件类型为字符串、payload 无统一 schema/长度约束，不能把任意事件当作可信汇总 |
| `operator_audit_logs` | `id` 主键；`operator_id`、`action`、`target`、`parameter_hash`、`result`、`correlation_id`、`created_at`；Fault Run 通过可空 `operator_audit_id` 左连接 | Fault Run retention 仅按已关联的 audit id 删除；未关联的审计没有在当前 retention 函数中被清理 | 记录 Operator 控制动作和参数哈希，不是目标效果或观测证据；DDL 未声明到 Fault Run 的外键，关联完整性依赖应用写入 |
| `data_warmup_progress` | `table_name` 主键；status、目标/实际行数、当前日期、每日进度、速率、时间范围、表大小、过期分区数、`lease_owner`、`guard_reason`、`last_success_at`、`updated_at` | Worker 负责创建/更新，分区窗口由 init SQL 和 Worker rollover 维护；无 Fault Run retention | 是 Worker 预热进度快照；`DATA_WARMUP_ENABLED=false` 时本次不刷新；历史行可能过期或与当前配置不一致，必须标记 `STALE/UNKNOWN` |
| `data_warmup_manual_jobs` / exclusions | job `id` 主键；operation/table/dates/rows/status/progress/error/heartbeat/claim owner；exclusion 以 `(table_name, date_value)` 复合主键 | Worker 通过 lease、heartbeat 和 120 秒 stale 判断接管；manual exclusion 没有自动 retention | 是受控预热人工作业事实；不应读取为 Fault Run 结果，也不能用手工 SQL 改写租约或进度 |
| Worker 汇总事件 | 报表：`REPORT_WORKER_STARTED`、`REPORT_WORKER_STOPPED`；受控 Worker：`SCENARIO_WORKER_STARTED`、`SCENARIO_WORKER_TARGET`、`SCENARIO_WORKER_STOPPED`、`SCENARIO_WORKER_DRAINED`；Runner：`RUNNER_LIFECYCLE_SUMMARY` | 事件跟随 Fault Run 保存/删除；Report 和受控 Worker 只在生命周期边界写低基数汇总；历史 `REPORT_REQUEST*`/`SCENARIO_REQUEST_FAILED` 仅作兼容折叠输入 | 只有结束汇总或明确累计事件可提供请求统计；缺失 dispatch、缺失终态汇总、事件写入失败或 worker 未运行时必须保留 `NULL`/`INCOMPLETE` |

当前 MySQL 只读快照（检查时间：`2026-09-16 15:29 CST`）：`fault_runs=24`、`fault_run_events=105`、`operator_audit_logs=39`；三者可见数据窗口均为 `2026-08-27` 至 `2026-09-03`。事件最大 payload 长度按类型观察为 `25`～`593` 字符，但这是当前数据结果，不是 schema 上限。事件表历史上没有 payload 长度约束，且旧版 Report/Scenario Worker 存在按请求或按失败写事件的路径，已登记 P0-ISSUE-008；当前应用写入口和 Worker 路径已按 P0-ISSUE-008 follow-up 收紧。

### P0-02-2 Catalog dispatch 与运行证据核验

| Catalog 条目 | 静态 dispatch / target map | 当前 MySQL 可复查运行证据 | 结论 |
| --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | `ReportScenarioWorker` 存在；Gateway target map 有对应 operation | 12 条历史记录均为 `FAILED`，仅有 create/compensation 事件，无 `REPORT_WORKER_*` | 无法证明受控请求已执行，`INCOMPLETE` |
| `ORDER_REPORT_SQL` | `ReportScenarioWorker` 存在；Gateway target map 有对应 operation | 没有当前库记录 | 运行证据 `UNKNOWN`，`INCOMPLETE` |
| `BROWSE_SURGE` | `TrafficSurgeExecutor` + `ControlledScenarioWorker`；不走 Gateway prepare/release | 没有当前库记录 | 运行证据 `UNKNOWN`，`INCOMPLETE` |
| `ORDER_QUERY_SURGE` | `TrafficSurgeExecutor` + `ControlledScenarioWorker`；不走 Gateway prepare/release | 没有当前库记录 | 运行证据 `UNKNOWN`，`INCOMPLETE` |
| `CART_CATALOG_DEPENDENCY` | Gateway target map、目标 endpoint 和 P0-13 新增 Scenario Worker dispatch 存在 | 没有当前库记录 | 代码路径已补齐；运行请求/终态证据仍为 `UNKNOWN`，P0-ISSUE-001 运行 limitation |
| `CATALOG_REDIS_LARGE_VALUE` | `ScenarioWorkers` + `ControlledScenarioWorker`；Gateway target map 有对应 operation | 8 条 `TARGET_CONFIRMED` 后进入 `RECOVERED/STOPPED`，但仅见旧 `EXERCISE_WORKER_*`，没有当前 `SCENARIO_WORKER_*` 终态汇总 | 旧证据不能代表当前 Worker 合同，`INCOMPLETE` |
| `NOTIFICATION_HEAP_PRESSURE` | `RunnerEngine` + `TrafficActionOrchestrator`；Gateway target map 有对应 operation | 没有当前库记录 | 运行证据 `UNKNOWN`，`INCOMPLETE` |
| `NOTIFICATION_STORAGE_APPEND` | `RunnerEngine` + `TrafficActionOrchestrator`；Gateway target map 有对应 operation | 2 条历史记录均为 `FAILED`，无 `RUNNER_LIFECYCLE_SUMMARY` | 无法证明 append 请求或终态摘要，`INCOMPLETE` |
| `PROMOTION_LOCK_CONTENTION` | `ScenarioWorkers` + `ControlledScenarioWorker`；Gateway observation path 存在 | 没有当前库记录 | 运行证据 `UNKNOWN`，`INCOMPLETE` |
| `INVENTORY_TABLE_EXCLUSIVE` | `ScenarioWorkers` + `ControlledScenarioWorker`；Gateway observation path 存在 | 没有当前库记录 | 运行证据 `UNKNOWN`，`INCOMPLETE` |
| `INVENTORY_ROW_LOCK` | `ScenarioWorkers` + `ControlledScenarioWorker`；Gateway observation path 存在 | 没有当前库记录 | 运行证据 `UNKNOWN`，`INCOMPLETE` |
| `PSP_PROVIDER_OUTCOME` | `RunnerEngine` + `TrafficActionOrchestrator`；Gateway target map 有对应 operation | 1 条历史记录为 `FAILED`，无 `RUNNER_LIFECYCLE_SUMMARY` | 无法证明 PSP 请求或终态摘要，`INCOMPLETE` |

核验方法：静态路径来自 Catalog、`OperationDispatchController.TARGETS`、`FaultRunCoordinator`、三个 Worker 和 Runner；运行证据来自当前 MySQL 按 `scenario/state/event_type` 的只读聚合，不执行新的 Catalog Fault Run。当前事件集合没有 `REPORT_WORKER_STOPPED`、`SCENARIO_WORKER_STOPPED`、`SCENARIO_WORKER_DRAINED` 或 `RUNNER_LIFECYCLE_SUMMARY`；`EXERCISE_WORKER_STARTED/STOPPED` 被视为历史不兼容事件。静态“已核验”不升级为运行时 complete，11 个有代码路径的条目仍需在 P0-14 受控环境运行后才能形成真实请求和终态汇总证据。

### P0-02-3 五类失败分类与事实边界

分类在 baseline 折叠层派生，不修改既有 Fault Run 状态、事件名或目标服务契约。一个运行可以同时有多个 `failureClass`；每个分类必须保留来源事件、时间和稳定 `failureCode`，不能把所有事实压缩为 `FAILED`。

| `failureClass` | 定义 | 可信来源 | 不得据此推断 |
| --- | --- | --- | --- |
| `TARGET_EFFECT_FAILURE` | 目标 operation 被拒绝、目标返回明确失败，或目标效果在有明确观测契约时未达成 | 目标 prepare/release/cleanup 返回的受控结果；结构化 Worker/Runner 业务结果；明确的 target observation | `TARGET_CONFIRMED` 只说明控制动作被接受；HTTP 502、Worker 异常或缺少事件不能单独证明目标效果失败 |
| `CONTROL_PLANE_FAILURE` | 控制面请求校验、幂等、数据库 schema/读回、状态转换、fencing 或调度自身失败 | Operator audit、`CREATED`/`CREATE_FAILED`、状态转换结果、持久化异常和稳定 API error code | 目标业务失败、目标健康异常或目标效果未观察到 |
| `WORKER_FAILURE` | Worker 未启动、setup 失败、请求执行器失败、汇总事件写入失败或 drain 未完成，导致受控请求事实不完整 | `*_WORKER_STARTED`、`*_WORKER_STOPPED`、`*_WORKER_SETUP_FAILED`、`SCENARIO_WORKER_DRAINED` snapshot 及 worker 生命周期；历史 `SCENARIO_REQUEST_FAILED` 仅作兼容来源 | 单个业务请求失败一定是 Worker 故障；只有有结构化目标响应时才可另记目标效果失败 |
| `RECOVERY_FAILURE` | 到期/停止后的 release、worker drain、补偿或服务恢复未完成/明确失败 | `RECOVERY_STARTED`、`RECOVERY_COMPLETED`、`RECOVERY_FAILED`、`CREATE_RECOVERY_FAILED`、`COMPENSATION_*`、`SERVICE_UNAVAILABLE`/`SERVICE_RECOVERED` | `RECOVERY_COMPLETED` 只证明控制动作完成；`SERVICE_UNAVAILABLE` 本身是健康/效果事实，不能自动等同于恢复动作失败 |
| `CLEANUP_FAILURE` | Catalog 要求的手工或资源清理未执行、明确失败或结果无法验证 | `MANUAL_CLEANUP_COMPLETED`、`MANUAL_CLEANUP_FAILED`、目标 cleanup 返回值和资源核验 | release 成功或手工 endpoint 返回成功不自动证明所有 run-scoped 资源已删除；`NON_RELEASING` 不应被标为清理失败 |

稳定 `failureCode` 首批约定为 `TARGET_EFFECT_REJECTED`、`TARGET_EFFECT_UNOBSERVED`、`CONTROL_PLANE_VALIDATION_FAILED`、`CONTROL_PLANE_STORAGE_FAILED`、`WORKER_SETUP_FAILED`、`WORKER_REQUEST_FAILED`、`WORKER_SUMMARY_MISSING`、`WORKER_DRAIN_INCOMPLETE`、`RECOVERY_RELEASE_FAILED`、`RECOVERY_COMPENSATION_FAILED`、`BUSINESS_RECOVERY_UNCONFIRMED`、`CLEANUP_REQUIRED`、`CLEANUP_FAILED` 和 `CLEANUP_UNVERIFIED`。原始异常只作为受控、脱敏后的诊断字段；不得把异常文本当作稳定 code。

四种事实分别填充，不互相替代：

| 事实 | 允许的来源 | 缺失时 |
| --- | --- | --- |
| `controlAction` | Operator audit、Fault Run 状态转换和 coordinator 事件 | `UNKNOWN`，不能用目标请求成功代替 |
| `effectObserved` | target summary、结构化 Worker/Runner 结果或明确观测查询 | `UNKNOWN`，不能用 `TARGET_CONFIRMED`/HTTP 成功代替 |
| `businessRecovered` | `SERVICE_RECOVERED` 或独立、受控的业务健康恢复证据 | `UNKNOWN`；没有恢复事件不写 `true` |
| `resourceCleanup` | Catalog recovery strategy、release/cleanup 事件和 run-scoped 资源核验 | `NOT_REQUIRED`、`MANUAL_REQUIRED`、`COMPLETED`、`FAILED` 或 `UNKNOWN`；不能将清理请求 accepted 直接当作物理删除完成 |

完整性规则：非终态统一为 `RUN_NOT_TERMINAL`；没有 dispatch 为 `DISPATCH_UNVERIFIED`；缺少必需 Worker/Runner 汇总为 `MISSING_RUNTIME_EVENT` 并保持 `INCOMPLETE`；计数不一致为 `COUNTER_INCONSISTENT`，保留可信原值而不修正。`SERVICE_UNAVAILABLE` 只设置健康/业务恢复未知边界，只有明确恢复动作失败才增加 `RECOVERY_FAILURE`。

### P0-02-4 低基数事件与 payload 约定

**命名与通用字段：**

- 新增或补齐的事件使用固定大写 snake case 白名单，`event_type` 不得拼接 run ID、SKU、URL、错误文本或时间；数据库列的 64 字符上限是硬上限。
- 新汇总事件 payload 必须带 `schemaVersion=1`、固定 `source`（`coordinator`、`report-worker`、`scenario-worker`、`runner`、`cleanup` 之一）、固定 `phase`（`control`、`effect`、`worker`、`recovery`、`cleanup` 之一）和固定 `status`（`STARTED`、`COMPLETED`、`FAILED`、`DRAINED`、`UNKNOWN` 之一）。`faultRunId`、创建时间和事件自增 id 以事件行字段为准，不在 payload 重复保存。
- Worker/Runner 汇总保留非负计数、超时计数、延迟摘要、稳定 `stopReason`/`failureCode` 和受控 drain 信息；`REPORT_WORKER_STOPPED` 至少需要 requests/successes/failures/averageLatencyMs/reason，`SCENARIO_WORKER_STOPPED` 需要完整 `ScenarioWorkerStats`，`SCENARIO_WORKER_DRAINED` 需要最终 snapshot，`RUNNER_LIFECYCLE_SUMMARY` 需要 status/success/latency/errorCode。
- `TARGET_CONFIRMED` 只允许 bounded target summary；recovery 事件只记录动作状态和 worker drain；cleanup 事件只记录 scope、稳定结果 code 和核验状态，不内嵌目标原始响应。

**体积、值域和脱敏：**

- 新/补齐事件的 UTF-8 JSON serialized payload 最大 8 KiB；字符串默认最大 256 字符，稳定 code 最大 64 字符，opaque id/trace 最大 128 字符；数组最大 64 项；计数和延迟必须为有限非负安全整数。超过上限必须拒绝写入并记录稳定 `EVENT_PAYLOAD_INVALID`，不能静默截断事实。
- payload 禁止 Authorization、Cookie、密码、token、secret、service key、session credential、完整请求/响应 headers、原始 SQL、shell/命令、堆栈、告警 envelope 和完整日志。错误只写白名单 `failureCode`；如确有必要保留诊断 message，先脱敏且不超过 256 字符。
- 现有历史事件不因本约定重写；折叠器发现旧 payload 超限、字段不合规或无法识别时，保留来源并写 limitation/`UNKNOWN`，不能把样本长度当作 schema 安全上限。

**可复用、禁止新增和待补齐：**

| 类型 | 事件 | 约束 |
| --- | --- | --- |
| 可复用低基数 | `CREATED`、`TARGET_CONFIRMED`、`RECOVERY_STARTED`、`RECOVERY_COMPLETED`、`RECOVERY_FAILED`、`CREATE_RECOVERY_FAILED`、`COMPENSATION_*`、`REPORT_WORKER_STARTED/STOPPED`、`SCENARIO_WORKER_STARTED/STOPPED/DRAINED`、`RUNNER_LIFECYCLE_SUMMARY`、`MANUAL_CLEANUP_COMPLETED/FAILED` | 固定类型和 bounded payload；按来源折叠，不按事件名猜测效果或业务恢复 |
| 仅折叠历史，不再新增逐请求写库 | `REPORT_REQUEST`、`REPORT_REQUEST_FAILED`、`SCENARIO_REQUEST_FAILED` | 这些事件仅保留历史兼容折叠；新代码拒绝再次写入，改为只写终态累计摘要，历史缺失时保持 `UNKNOWN`/`INCOMPLETE` |
| 待补齐或必须运行核验 | surge 的 `SCENARIO_WORKER_DRAINED` 运行落库、setup 中断时的终态边界、各 Worker/Runner 在 stop/expiry/restart 的最终摘要、`CART_CATALOG_DEPENDENCY` 的真实请求/summary | P0-06/P0-13 已补齐 dispatch、drain 和低基数事件代码路径；P0-14 仍需实际运行核验，不能用代码路径替代运行事实 |

**无法可靠采集的字段：** 不能从 Prometheus 百分比推导请求总数/成功数，不能从 `TARGET_CONFIRMED` 推导目标效果，不能从 release 成功推导业务恢复，不能从 cleanup endpoint accepted 推导物理资源删除，不能从历史 `EXERCISE_WORKER_*` 改名推导当前 Worker drain；Runner 没有可靠总请求数时 `requests` 保持 `null`，预热历史进度与当前合同不一致时保持 `STALE/UNKNOWN`。

## P0-03：持久化 schema、迁移与受控类型

**目标：** 以 expand-only 迁移保存长期可查的 baseline 和 pilot review 摘要，同时保持现有 Fault Run schema 不变。

**状态：** 已完成；**进度：** 5 / 5；**关联问题：** P0-ISSUE-008、P0-ISSUE-010、P0-ISSUE-011

- [x] 定义 `scenario_baselines` 和 `baseline_pilot_reviews` 的显式 TypeScript schema、受控 JSON 字段、枚举和值域；拒绝 secret、原始响应、超长 payload 和可执行内容。类型和值域已集中在 `traffic-control-plane/src/lib/baseline-schema.ts`；写入侧的深度校验和拒绝测试留在 P0-07/P0-12。
- [x] 新增 `traffic-control-plane/src/lib/migrations/002-fault-run-baseline.sql`，仅创建新表、索引和约束，不修改既有 `fault_runs` 或 `fault_run_events` 状态约束；DDL 不建立来源外键，避免 Fault Run retention 级联删除 baseline。
- [x] 新增 `infra/mysql/init/06-fault-run-baseline.sql`，与应用迁移在表结构、索引、约束和 schema revision 上一致，支持 fresh install；已通过两文件字节级比较。
- [x] 新增幂等应用 schema 初始化逻辑，验证已有 MySQL volume 无需重置且初始化失败不会影响既有 Fault Run 路径；`ensureBaselineSchema()` 独立于 `ensureFaultRunSchema()`，现有 Fault Run repository 不依赖新表初始化。
- [x] 确认 baseline 不对来源 Fault Run 使用级联删除；保留基线摘要与低频 pilot review，不把它们当作观测现场数据或现有 retention 的替代品；实际 `information_schema.referential_constraints` 查询无新表外键。

## P0-04：Catalog、发布、部署和预热元数据

**目标：** 以确定性、可核验的元数据标识每份 baseline 的输入版本和部署事实。

**状态：** 已完成（有 limitation）；**进度：** 6 / 6；**关联问题：** P0-ISSUE-004、P0-ISSUE-006、P0-ISSUE-012

- [x] 实现从 `listScenarioDefinitions()` 派生的 canonical Catalog 序列化和 SHA-256 `catalogRevision`；排序、参数和 options 重排测试通过，Catalog 事实变化会改变 revision；历史矩阵 revision 为 `000ccc36e4a77ef27d22636bdbc4643ff79ddb0c205b21830967bc40b7abd7dc`，Redis 合同修订后的当前运行 revision 为 `a9f117905993ed8898c0276c5c40267c4a434fc89b6254be8cb1725a7f15702b`。
- [x] 增加并校验 `CASTREL_RELEASE_REVISION`，由 Compose/Kubernetes 配置提供注入入口；缺失或不合法时记录 `UNKNOWN` 和 limitation，不能从 `NODE_ENV` 推测版本。
- [x] 增加并校验 `CASTREL_DEPLOYMENT_MODE`，只接受 `local`、`compose`、`kubernetes` 和 `unknown`；Web/Worker 均读取显式配置，不依据 hostname、端口或容器特征猜测。
- [x] 将 `BASELINE_SCHEMA_REVISION=baseline.v1` 作为单一应用常量，并在应用 migration、fresh-install SQL 和 baseline metadata 中保持一致；两份 baseline DDL 已通过 `cmp`。
- [x] 新增 `loadBaselineWarmupMetadata()`，从数据库配置和 Worker progress 读取 `dataWarmupEnabled`、完整配置和受控进度摘要；查询不可用时返回显式 limitation，不复制 Web/Worker 环境配置。P0-07 仍需将该 metadata 接入最终 capture service。
- [x] 将 Data Warmup 配置迁移为数据库唯一运行时来源：首次启动严格校验环境默认值且只在配置行缺失时初始化；新增版本/CAS、CSRF、审计、影响确认的 Operator API/页面编辑；Worker 启动服务后按租约和批次动态读取启停、窗口、目标、批量和并发配置。

验证证据：`pnpm exec tsx --test src/lib/fault-run-catalog-revision.test.ts src/lib/baseline-metadata.test.ts src/lib/data-warmup-config.test.ts`、`pnpm typecheck`、`pnpm lint`、`pnpm test:i18n`、`pnpm test:runner` 均通过；`docker compose config --quiet`、`kubectl kustomize k8s` 和两份 Data Warmup DDL/两份 baseline DDL 的一致性检查通过。未启动 Worker 预热写入，历史 progress stale 问题仍由 P0-ISSUE-006 跟踪。

## P0-05：事件折叠、时间线和完整性判断

**目标：** 从终态 Fault Run 与受控汇总事件生成确定性事实，清晰表达未知、限制和失败。

**状态：** 已完成（有 limitation）；**进度：** 6 / 6；**关联问题：** P0-ISSUE-001、P0-ISSUE-009、P0-ISSUE-010、P0-ISSUE-011

- [x] 实现按 `created_at, id` 的稳定事件折叠器，保留事件来源和缺失字段，不依赖隐式到达顺序或百分比反推请求数。
- [x] 按 [tech.md 第 7.2 节](./tech.md#72-事实折叠)的来源策略处理报告 Worker、受控场景 Worker 和正常 lifecycle 汇总；仅在可信事件存在时写入请求、成功、失败、超时和延迟。
- [x] 按既定优先级生成 prepare、active、stop、recovery、cleanup 和 health check 时间线；`activeAt` 只能来源于状态转换的确认事实，不能用首次业务请求替代。
- [x] 按 Catalog `recoveryStrategy` 判断 `TARGET`、`WORKER`、`MANUAL_CLEANUP` 与 `NON_RELEASING` 的 release、cleanup 和残留边界，不得把手工清理或非释放效果标为自动成功。
- [x] 校验请求计数的一致性；存在矛盾时保留可信原始值，记录 `COUNTER_INCONSISTENT`，并输出 `COMPLETE_WITH_LIMITATIONS` 或 `INCOMPLETE`。
- [x] 落实 `RUN_NOT_TERMINAL`、`SOURCE_RUN_NOT_FOUND`、`DISPATCH_UNVERIFIED`、`MISSING_RUNTIME_EVENT`、`OBSERVATION_UNAVAILABLE` 和 `CATALOG_REVISION_FAILED` 的稳定错误、状态和审计语义；实际 Operator audit 写入留给 P0-07/P0-08，折叠层保留来源与 limitation。

实现证据：新增 `baseline-event-folding.ts`、`baseline-capture-errors.ts` 及 6 个 fixture 测试。折叠器按 `created_at,id` 排序，分别处理 Report/Scenario/Runner 来源，输出生命周期、四类 outcome、失败分类/code、可信请求摘要、事件来源和 limitation；`TARGET_CONFIRMED` 不被当作 effect，`RECOVERY_COMPLETED` 不被当作业务恢复或物理清理完成，`CART_CATALOG_DEPENDENCY` 无运行 dispatch 时输出 `DISPATCH_UNVERIFIED`/`INCOMPLETE`。Stable capture error 含 HTTP status 映射，非终态统一 `RUN_NOT_TERMINAL`。

## P0-06：Worker 结束汇总事件补齐

**目标：** 仅为可可靠采集的终态事实补充低基数汇总事件，不引入每请求写库或改变业务路径。

**状态：** 已完成（有 limitation）；**进度：** 4 / 4；**关联问题：** P0-ISSUE-001、P0-ISSUE-009、P0-ISSUE-011

- [x] 核验报告 Worker、受控场景 Worker 和 Runner lifecycle 在停止、到期、失败及重启边界均能产生可用终态汇总。
- [x] 仅在缺失处补齐 `REPORT_WORKER_STOPPED`、`SCENARIO_WORKER_STOPPED` 或既定 lifecycle 汇总的结束事实；不增加每个请求的数据库事件。
- [x] 确认新增或调整的事件只包含低基数计数、稳定错误代码、状态和 drain 摘要，并实施长度限制与敏感字段排除。
- [x] 对没有可确认 dispatch 或可信汇总的条目生成 `DISPATCH_UNVERIFIED`/`INCOMPLETE`，阻止其被标记为 complete 或被选择为 pilot。

实现证据：新增 `fault-run-event-contract.ts` 与 3 个契约 fixture；报告 Worker 将 started 写入纳入 try/finally，保证 setup/stop 边界尝试 `REPORT_WORKER_STOPPED`；受控 Worker 在 start event 失败、到期和 stop 仍尝试终态 STOPPED，Scenario Workers 和 Traffic Surge 均写入规范化 `SCENARIO_WORKER_DRAINED`；Runner lifecycle summary 去除 traffic/lifecycle ID，仅保留结果状态、成功标记、延迟和受控 failure code。统一 payload 包含 `schemaVersion/source/phase/status`，只复制白名单计数/延迟/cache/drain 字段，8 KiB 上限由规范化函数保证。现有每请求事件未新增，CART 无 dispatch 仍由 P0-05 输出 `DISPATCH_UNVERIFIED`。

## P0-07：Baseline capture 服务与幂等 repository

**目标：** 将终态运行事实安全、幂等地保存为可长期复查的摘要。

**状态：** 已完成（有 limitation）；**进度：** 5 / 5；**关联问题：** P0-ISSUE-001、P0-ISSUE-004、P0-ISSUE-006、P0-ISSUE-009、P0-ISSUE-010

- [x] 实现 baseline repository，以 `source_fault_run_id` 为唯一来源键；重复 capture 返回既有记录，不重复写入摘要、审计或事件。
- [x] 实现 capture service，加载 Fault Run、Catalog、事件和 Operator audit，并仅允许设计规定的终态运行生成最终 baseline。
- [x] 在 capture 过程中组合 lifecycle、outcome、request summary、资源预算、观测摘要、告警摘要、limitations、残留资源和回退步骤；缺失事实使用显式未知或限制。
- [x] 写入 `BASELINE_CAPTURE_REQUESTED`、`BASELINE_RUNTIME_SUMMARY_RECORDED`、`BASELINE_OBSERVATION_CHECK_RECORDED`、完成/不完整/失败事件，并保证 payload 受控且脱敏。
- [x] 验证 Fault Run 进入现有清理周期后，baseline 仍可独立读取；capture 失败或 schema 初始化失败时，现有 Fault Run 生命周期继续运行。

实现证据：新增 `baseline-repository.ts` 和 `baseline-capture.ts`；repository 以 `source_fault_run_id` 唯一键查询/保存，并在 duplicate insert 时返回已有记录；capture service 读取终态 Fault Run、事件、audit、Catalog revision、release/deployment metadata 和数据库 warmup metadata，使用 P0-05 折叠结果构造 limitation-aware baseline。新增 capture lifecycle 事件，统一使用受控、脱敏、8 KiB payload；默认 `BASELINE_CAPTURE_ENABLED=false`，重复 capture 先返回已有摘要，不重复写入事件。`baseline-capture.test.ts`、`fault-run-event-contract.test.ts`、typecheck、lint、`git diff --check` 和应用/init DDL 一致性核验通过。为既有数据卷增加幂等 `ALTER TABLE ... MODIFY data_warmup_enabled TINYINT NULL`，避免 warmup metadata 不可用时被错误写为 `false`。

限制：baseline capture 仍未接入 Operator API；观测和 Alertmanager 摘要当前明确为 `UNKNOWN`/limitation，真实运行终态事件、CART dispatch 和历史 warmup stale progress 尚未现场核验；未启动新的 Fault Run 或 warmup 写入。

## P0-08：Operator API、鉴权、CSRF 与审计

**目标：** 暴露仅供 Operator 使用的 baseline 和 pilot review 接口，不让控制面语义进入消费者路径。

**状态：** 已完成（有 limitation）；**进度：** 5 / 5；**关联问题：** P0-ISSUE-001、P0-ISSUE-002、P0-ISSUE-003、P0-ISSUE-004、P0-ISSUE-009、P0-ISSUE-010、P0-ISSUE-013、P0-ISSUE-014

- [x] 实现单次运行 baseline 的创建和查询接口，保持终态校验、幂等语义、稳定错误 code 和现有错误 envelope。
- [x] 实现按场景、capture status 和 revision 查询 baseline 摘要的只读接口，避免返回原始事件、敏感字段或观测现场内容。
- [x] 实现 pilot review 查询及写入接口；写操作要求 Operator session 与 CSRF，读取接口不出现在 Shopfront/Gateway 消费者路径。
- [x] 为所有成功和失败写操作写入 `operator_audit_logs` 并保存 audit 引用；重复 baseline 请求不得产生重复 audit。
- [x] 在 `BASELINE_CAPTURE_ENABLED=false` 时关闭新增 API/采集入口，同时确认现有 Fault Run API、Worker 和业务流量不受影响。

实现证据：新增 `/internal/fault-runs/{faultRunId}/baseline`、`/internal/baselines`、`/internal/baselines/pilot` 和 `/internal/baselines/pilot/{scenario}` Operator 路由；复用 middleware Operator session、CSRF、`jsonOk/jsonError` 和 `recordOperatorAudit()`。repository 增加 baseline 查询、audit 引用回写、pilot review 查询/upsert；baseline capture 使用来源级 MySQL advisory lock，Operator 路由在锁内先建立 FAILURE audit reservation，再将 audit id 传入 capture，成功后更新 SUCCESS；并发重复请求只返回已有记录，不重复事件或审计。Catalog revision 不一致返回 `PILOT_REVIEW_CONFLICT`，`SELECTED` 使用全局 selection lock 且仅在完整 baseline、观测 retention、三类观测、业务恢复/清理和告警规则均有可用事实时允许。新增 `baseline-pilot.test.ts`，覆盖输入边界、revision conflict、命令/敏感内容、Catalog 原型属性和未知观测阻断；build、typecheck、lint、capture/pilot fixture 均通过。

限制：Operator API 尚未在 live disposable 栈上调用；默认 `BASELINE_CAPTURE_ENABLED=false`，因此本次未生成真实 baseline 或 pilot review，实际 session/CSRF/audit/advisory lock 落库仍需 P0-13/P0-14 核验。audit reservation 在 baseline/pilot 写入前先以 FAILURE 创建，成功后更新为 SUCCESS，进程中断时保守保留 FAILURE。

## P0-09：只读观测、retention 与告警接入核验

**目标：** 以实际环境读取和查询确认观测、告警与接收链路的可用边界，而不保存现场数据。

**状态：** 已完成（有 limitation）；**进度：** 5 / 5；**关联问题：** P0-ISSUE-002、P0-ISSUE-003、P0-ISSUE-015

- [x] 从实际加载的 Compose/Kubernetes、Prometheus 和 Alertmanager 配置读取规则、receiver、`send_resolved` 与声明 retention，记录来源和配置 revision。
- [x] 对 Prometheus、Loki 和 Tempo 执行有总超时的只读健康与时间窗口查询，保存 `declared`、`observed`、`checkedAt`、状态、查询引用和 limitation，不保存查询结果。
- [x] 使用既有内网或 Nginx Basic Auth 边界完成核验，确保凭据仅在部署访问路径中使用，绝不写入环境记录、日志或 baseline JSON。
- [x] 核验 Alertmanager webhook route、认证、控制面接收端点、`send_resolved` 和 external receiver 是否真实存在；配置中的 URL 不能作为接收能力已实现的证据。
- [x] 对不可用、超时、权限不足或 retention 不足显式输出 `UNKNOWN`、`UNAVAILABLE` 或 limitation，并阻止未完成关键核验的候选进入 `SELECTED`。

证据：[`observability-verification.md`](./observability-verification.md)。此前 Compose 只读核验为 Prometheus/Loki/Tempo/Alertmanager readiness HTTP 200，Prometheus/Loki 查询 API 成功，Tempo search 返回有效 JSON；Alertmanager active config 有 3 个 receiver 且均 `send_resolved=true`。P0-13 已补齐控制面 webhook route、service-key 机器认证和低基数 receipt schema，并完成静态 `amtool check-config`；本次未发送真实 firing/resolved webhook，故 receipt 仍为运行 limitation。Kubernetes runtime 未核验；Tempo effective config 的两个 retention 语义仍需专用环境拆解，P0-10 继续不得选择 pilot。

## P0-10：阶段 5 pilot review

**目标：** 以真实告警、清晰证据窗口和只读 remediation 边界，选择至多一个可进入阶段 5 的候选。

**状态：** 已完成（无合格候选）；**进度：** 5 / 5；**关联问题：** P0-ISSUE-001、P0-ISSUE-002、P0-ISSUE-003、P0-ISSUE-007、P0-ISSUE-009、P0-ISSUE-011

- [x] 复核 `CANDIDATE`、`SELECTED`、`REJECTED` 的受控 review 模型与 `(scenario, catalogRevision)` 幂等约束；`baseline-pilot.ts` 已实现 Catalog revision conflict、全局 selection lock 和 eligibility gate，schema 以唯一键保证同 revision 幂等。
- [x] 逐项记录 Catalog 派生覆盖矩阵中每个条目的告警规则、实际 firing 核验、目标服务/operation 映射、查询窗口、retention、共享资源风险和排除理由；详见 [`pilot-review-matrix.md`](./pilot-review-matrix.md)。
- [x] 按真实证据门槛评估 `SELECTED`；P0-14 已产生真实 Fault Run、baseline 和 Alertmanager route receipt，但真实 Prometheus/Loki/Tempo 场景窗口、Kubernetes runtime、资源边界和部分 remediation 证据仍不足，因此没有条目满足选择条件。
- [x] 对 12 个条目记录当前窗口的不具备选择资格、具体 limitation 和问题关联；P0-14 已通过 Operator API 持久化 12 条当前 revision 的 `REJECTED` review，`SELECTED=0`，没有用推荐名称或已创建 Fault Run 代替场景告警事实。
- [x] 将每个条目的 `remediation` 限制在正常业务/基础设施修复、验证和数据处理边界；矩阵没有授予 Agent 写权限，也没有把控制面生命周期动作写入 remediation。

证据与限制：`pilot-review-matrix.md` 固定历史 Catalog revision、当前 revision 和 12 条 runbook alert mapping；P0-09 的 Compose retention/查询和 Alertmanager active config 不能升级为场景 firing，但 P0-14 已独立验证 route receipt 幂等。P0-14 的 baseline 开关最终关闭，历史 baseline 仍可读；Kubernetes retention/runtime、真实 observation adapter、场景级 query window 和资源/remediation 边界仍待后续环境。

## P0-11：配置、资源预算、运行手册与回退护栏

**目标：** 让旁路采集具备默认关闭、可灰度、可观察和可安全回退的发布条件。

**状态：** 已完成（有 limitation）；**进度：** 6 / 6；**关联问题：** P0-ISSUE-003、P0-ISSUE-004、P0-ISSUE-007

- [x] 在环境校验和部署值中接入 `BASELINE_CAPTURE_ENABLED`、`CASTREL_RELEASE_REVISION`、`CASTREL_DEPLOYMENT_MODE`、观测核验超时与窗口配置，保持默认关闭且不新增凭据。
- [x] 为开发、full 演练和专用 pilot 环境编制资源预算，分别记录声明预算、实际观察摘要、容量限制、危险场景隔离条件和停止标准，不把预算写成资源耗尽承诺。
- [x] 编制场景运行前后 smoke 检查、baseline 生成步骤、时间线阅读、失败分类、残留资源检查和手工清理指引。
- [x] 编制发布检查清单与回退手册，覆盖开关关闭、Web/Worker 镜像回退、active Fault Run 处理、schema 初始化失败和已写 baseline 保留规则。
- [x] 固化关键事件和低基数指标命名约定，明确禁止记录 Cookie、Authorization、密码、token、原始 SQL/shell、告警 envelope 与完整观测载荷。
- [x] 记录 rollout 路径：代码部署但关闭、测试环境旁路启用、单环境核验和关闭回退；任何阶段均不改变目标服务或消费者契约。

执行文档：[`release-guardrails.md`](./release-guardrails.md)。配置项已在
`traffic-control-plane/src/lib/env.ts`、`docker-compose.yml` 和
`k8s/configmap/app-config.yaml` 接入。`docker compose config --quiet`、
`kubectl kustomize k8s`、`cd traffic-control-plane && pnpm typecheck` 和
`pnpm lint --quiet` 均通过。

限制：当前没有 Kubernetes runtime、专用 pilot 资源使用量或 immutable image
digest 的实际部署证据；Compose 没有统一容器资源上限，Order 的 Apple Silicon
资源问题仍不能作为性能基线。P0-ISSUE-003、P0-ISSUE-004 和 P0-ISSUE-007 的
代码/配置边界已完成，但 runtime/resource limitation 不因静态检查消失。

## P0-12：单元测试与 fixture 覆盖

**目标：** 用可重复的纯测试验证 revision、折叠、状态语义、脱敏和幂等，不依赖现场观测数据。

**状态：** 已完成（有 limitation）；**进度：** 6 / 6；**关联问题：** P0-ISSUE-008、P0-ISSUE-010、P0-ISSUE-011

- [x] 覆盖 Catalog canonicalization：顺序或参数排列变化保持 revision，场景事实变化更新 revision，且测试不维护第二份 Catalog 定义。
- [x] 以 Catalog 派生矩阵为基准覆盖每类事件来源的折叠、时间线和请求计数；缺失字段必须保留未知或 limitation。
- [x] 覆盖 `TARGET`、`WORKER`、`MANUAL_CLEANUP`、`NON_RELEASING` 的恢复/清理完整性判断，以及终态和非终态运行分支。
- [x] 覆盖计数矛盾、缺失事件、未核验 dispatch、观测不可用、Catalog revision 失败和稳定错误 code，确认不会生成伪造成功。
- [x] 覆盖 baseline/pilot JSON schema 的敏感字段、原始响应、可执行内容和超长 payload 拒绝路径。
- [x] 覆盖 source run 幂等、pilot revision 冲突、摘要 retention 独立性和 Worker 汇总事件的低基数约束。

实现与验证：新增 `baseline-schema.test.ts`，确认 baseline/pilot DDL 不依赖
Fault Run/audit 外键级联、保留 source-run 唯一键和独立 retention snapshot。
`baseline-capture.test.ts` 已覆盖 source-run 幂等，`baseline-pilot.test.ts` 覆盖
revision conflict，`fault-run-event-contract.test.ts` 覆盖 Worker/Runner 低基数
payload。P0-12 相关 fixture 共 24 项通过。

限制：这些是纯函数、内存 repository 和静态 DDL fixture；真实 MySQL 并发锁、
Operator audit、路由鉴权、Worker 事件落库和 retention runtime 仍留给 P0-13/P0-14，
不把测试 fixture 当作现场证据。历史 `fault_run_events` 高频记录不重写，仅由兼容
折叠器读取。

## P0-13：集成、安全边界与回退测试

**目标：** 验证迁移、Operator 边界、配置开关和回退不会破坏既有运行。

**状态：** 已完成（有 limitation）；**进度：** 6 / 6；**关联问题：** P0-ISSUE-001、P0-ISSUE-002、P0-ISSUE-003、P0-ISSUE-004、P0-ISSUE-007、P0-ISSUE-008、P0-ISSUE-010、P0-ISSUE-011、P0-ISSUE-016

- [x] 在 fresh MySQL 和保留既有 Fault Run 的 MySQL volume 上验证迁移与幂等初始化，确认无重置、无破坏性 schema 变更。
- [x] 验证 baseline API 的 Operator session、CSRF、审计、错误 envelope、终态限制、幂等和安全输出；未经认证或消费者路径不能访问。
- [x] 验证 `BASELINE_CAPTURE_ENABLED=false` 时新增入口不可用，但现有 Fault Run API、Worker、Gateway 路由和业务接口保持原行为。
- [x] 实现并验证 Alertmanager 控制面接收 route、service-key 机器认证、firing/resolved receipt、重复投递幂等和低基数持久化；未执行真实 Alertmanager 投递，现场 receipt 仍为 limitation。
- [x] 实现 observation executor interface、allowlist reference、窗口校验、timeout/network/authentication/expired 状态归一化、capture 接入和低基数审计事件；默认无适配器返回 `UNKNOWN`，真实 Prometheus/Loki/Tempo adapter 尚未实现。
- [x] 执行与变更范围匹配的 TypeScript、lint、迁移、控制面测试、部署配置和运行时术语检查；将命令、版本和结果写入执行记录。

**P0-13 限制（该任务组完成时的历史边界）：** Alertmanager receipt、观测
executor 和 Kubernetes retention 当时只完成代码/配置及纯测试验证；P0-14
随后在远端 Compose 补充了真实 Fault Run、Data Warmup、Alertmanager 投递和
回退证据。真实 Prometheus/Loki/Tempo adapter、Kubernetes runtime 和场景级
observation window 仍不能标记为现场已验证。P0-ISSUE-008 的新写入路径已完成，
但历史 schema/事件仍按兼容 retention 边界保留。

## P0-14：真实环境基线、验收与阶段退出

**目标：** 在受控环境中完成真实运行基线、告警前置核验和可回退验收，决定是否进入批次 1。

**状态：** 已完成（有 limitation；P0-14-3 阻塞）；**进度：** 7 / 7（6 完成，1 阻塞）；**关联问题：** P0-ISSUE-001、P0-ISSUE-002、P0-ISSUE-003、P0-ISSUE-006、P0-ISSUE-007、P0-ISSUE-009、P0-ISSUE-010、P0-ISSUE-011、P0-ISSUE-016、P0-ISSUE-017

- [x] 在远端 disposable Compose 环境以合适时长运行 Catalog 派生覆盖矩阵中的 12 个条目；每次运行执行 smoke、Fault Run、baseline、事件/汇总/audit、恢复和残留资源核对。另对 Redis 合同修订后的 `memberSizeBytes=1024` 运行了重跑。
- [x] 对本轮 13 个运行集合核对 `catalogRevision`、发布/部署/预热元数据、关键时间窗口、失败分类、回退步骤和 limitations；`scenario_baselines` 总体为 15 条 `COMPLETE_WITH_LIMITATIONS`、4 条 `INCOMPLETE`，不完整记录未当作完整基线。
- [!] 在 Kubernetes 配置和可用专用环境中核验观测/告警实际配置、retention 与查询可用性：`kubectl kustomize k8s` 通过，但当前没有获批 namespace/owner/window，未执行 Kubernetes runtime；Compose retention/查询历史证据单独保留。关联 P0-ISSUE-003。
- [x] 完成 pilot review：以当前 Catalog revision 持久化 12 条 `REJECTED` review，`SELECTED=0`；没有合格候选及阻塞方案，不以全部条目均支持作为退出条件。
- [x] 检查 baseline、事件、审计和文档安全输出：本轮选定运行集合的 secret、Authorization、Cookie、password、SQL、shell、docker、kubectl 等敏感匹配均为 0；不保存原始观测载荷或凭据。
- [x] 关闭 baseline 开关并执行回退 smoke：既有 Fault Run/baseline 仍可读，新增 baseline 写入返回 `BASELINE_CAPTURE_DISABLED`，Gateway 商品接口、Runner status 和 Alertmanager route 保持可用；未删除业务数据或数据卷。
- [x] 汇总 Compose 证据、未解决问题、灰度范围和回退结果；Phase 0 标记为“有 limitation 完成”，但在 Kubernetes runtime 和真实观测 adapter 补齐前不进入 Batch 1、不选择 pilot。

### P0-14 远端 Compose 验收记录（2026-09-17）

远端仓库为 `/home/raven/code/castrel-chaos`，最终源码 `HEAD=a2df62984548625e10588e5de9948e71c4059ea2`，工作区已恢复干净。控制面/Catalog/Worker 从该提交的干净内容重建并部署；Catalog 镜像 digest 为 `sha256:f4cd1e9cbf18093ec5f7fc11d4e7bb0cce8e4b76c19512605515c08dc0ced03d`，控制面与 Worker 共用 `sha256:f9e5fd0ce3ebfcc51e97a83019a60f90fcb59cabfff554a791529602a173c8a5`。最终 `BASELINE_CAPTURE_ENABLED=false`、`DATA_WARMUP_ENABLED=true`、`CASTREL_RELEASE_REVISION=1.4.0`、`CASTREL_DEPLOYMENT_MODE=compose`，Compose 服务均为 running，带 healthcheck 的服务为 healthy。

| Scenario | Run ID | 终态与运行摘要 |
| --- | --- | --- |
| `BROWSE_REPORT_SQL` | `a1f064ac-cd31-4a35-b198-09c4d412337b` | `RECOVERED`；约 60 秒报表请求，1 次/0 成功/1 失败；baseline 有慢 SQL 与观测 limitation |
| `ORDER_REPORT_SQL` | `14450128-9a3c-467e-ac6a-05aadf69774f` | `RECOVERED`；约 60 秒报表请求，1 次/0 成功/1 失败；baseline 有慢 SQL 与观测 limitation |
| `BROWSE_SURGE` | `7fffdf75-b6a3-4983-8ab7-ebf61b07fdd9` | `RECOVERED`；110/110 成功；有 `SCENARIO_WORKER_DRAINED` |
| `ORDER_QUERY_SURGE` | `0fcb640c-5655-4373-9bc6-ff694bf3f9c1` | `RECOVERED`；80/80 成功；有 `SCENARIO_WORKER_DRAINED` |
| `CATALOG_REDIS_LARGE_VALUE` | `6b8e8d21-f9e8-4f9a-98df-9986f1922d68` | `RECOVERED`；1024B 运行，92/92 cache hit，cleanup HTTP 200 |
| `CATALOG_REDIS_LARGE_VALUE`（合同修订重跑） | `d4bfa872-c48b-44c1-b425-1df59df5765f` | `RECOVERED`；修订后 1024B 合同，含 Worker drain、recovery 和 baseline 事件 |
| `CART_CATALOG_DEPENDENCY` | `0ac60702-0c11-4c62-849b-861f3af733bf` | `RECOVERED`；91 次请求/0 成功/91 失败；真实依赖失败可见，但 failure code 仍需业务复核 |
| `NOTIFICATION_STORAGE_APPEND` | `09a819ba-d1df-4bec-a9f7-018e786bcd0d` | `RECOVERED`；Runner summary 成功；人工 cleanup HTTP 200 |
| `PROMOTION_LOCK_CONTENTION` | `19c75f1c-4c83-43e0-9b8a-a92527046ee4` | `RECOVERED`；160 次请求/0 成功；记录锁竞争效果 |
| `INVENTORY_TABLE_EXCLUSIVE` | `5c4b5858-2ea1-4dd9-a8a2-4233c129dfd5` | `RECOVERED`；1 次请求，约 10.9 秒延迟 |
| `INVENTORY_ROW_LOCK` | `c647bf0b-8995-493a-a9e1-b7327c9f3735` | `RECOVERED`；4 次请求/2 成功/2 失败；有延迟分布 |
| `PSP_PROVIDER_OUTCOME` | `5707b05d-774e-43ba-9fd0-3a112cf46aae` | `RECOVERED`；Runner summary 成功；`TARGET_EFFECT_FAILURE` |
| `NOTIFICATION_HEAP_PRESSURE` | `4bb51b52-3879-473b-b09d-e1fe7dd1bc06` | `RECOVERED`；3 个 Runner summary；`NON_RELEASING`，cleanup `NOT_REQUIRED` |

运行集合的 baseline 元数据：本轮 12 个条目使用历史 revision `000ccc36e4a77ef27d22636bdbc4643ff79ddb0c205b21830967bc40b7abd7dc`，Redis 合同重跑使用当前 revision `a9f117905993ed8898c0276c5c40267c4a434fc89b6254be8cb1725a7f15702b`。数据库 baseline 总体按 revision 分组为旧 revision 18 条、新 revision 1 条；全部核对 baseline 的 release/deployment metadata 为 `1.4.0`/`compose`。Data Warmup 配置为 `180 days × 300000 rows/day = 54000000`，`user_behavior_log` 与 `product_price_history` 均为 `APPENDING`、54000000/54000000 行、持有 lease 且有成功时间。Alertmanager 真实 route 已验证 firing/resolved 与重复投递：首次 `accepted=1, duplicates=0`，重复 `accepted=0, duplicates=1`；receipt 表共 6 条（3 firing、3 resolved）。

回退 smoke 结果：既有 run `d4bfa872-c48b-44c1-b425-1df59df5765f` GET 200/`RECOVERED`，baseline GET 200/`COMPLETE_WITH_LIMITATIONS`，baseline POST 404/`BASELINE_CAPTURE_DISABLED`，Gateway 商品接口 200，Runner status 200，Alertmanager route 200。256B Redis 参数在干净重部署后稳定返回 400/`INVALID_PARAMETER:memberSizeBytes`，不再出现目标启动 502。该次漂移已登记为 P0-ISSUE-017 并关闭。

---

## 问题跟踪

问题状态使用 `待核验`、`待处理`、`处理中`、`已解决` 或 `已阻塞`。发现新问题时分配下一个 `P0-ISSUE-xxx`，并在任务和执行更新记录中交叉引用。

| ID | 发现阶段/任务 | 问题 | 影响 | 可能的解决方案/下一步 | 状态 |
| --- | --- | --- | --- | --- | --- |
| P0-ISSUE-001 | 设计基线 / P0-01、P0-02、P0-05、P0-06、P0-13、P0-14 | 静态代码核验确认 Catalog 中的 `CART_CATALOG_DEPENDENCY` 有 Gateway target map 和目标服务 endpoint，但此前没有真实受控流量 dispatch 或场景专属终态汇总事件。 | 在没有 Worker/运行证据时该条目只能生成 `DISPATCH_UNVERIFIED`/`INCOMPLETE`，不得伪造请求统计或被选择为 pilot。 | 已补齐 Scenario Worker 的 Gateway customer session、产品/购物车读取、可售 SKU 选择、购物车写入、setup failure/stop/drain 生命周期事件，并加入低基数 normalization 与单测；P0-14 远端运行已记录 91 次请求、0 成功、91 失败和完整 Worker drain/recovery 事件。 | 已解决（代码与 Compose 运行；failure code 仍需业务复核） |
| P0-ISSUE-002 | 设计基线 / P0-09、P0-13、P0-14 | Alertmanager 配置中的控制面 webhook URL 不等于接收端点、认证和 `send_resolved` 已真实可用。 | 没有机器认证和 receipt 幂等时，告警 receipt 无法作为 pilot 前置事实。 | 已新增精确 `/internal/alertmanager/webhook` route、`CASTREL_INTERNAL_SERVICE_KEY` Bearer/受保护 header 校验、firing/resolved 解析、重复投递 key、低基数 `alert_receipts` 表及 Compose/Kubernetes credentials file；远端已验证首次 firing/resolved accepted、重复投递 duplicates，receipt 表为 3 firing/3 resolved。 | 已解决（代码与 Compose 投递；场景级 firing/观测窗口仍未满足 pilot） |
| P0-ISSUE-003 | 设计基线 / P0-01、P0-09、P0-13、P0-14 | Prometheus、Loki、Tempo 的 retention 和查询可用性可能与部署声明不一致。 | 关键证据窗口不明确时不得选择 pilot；Kubernetes runtime 仍不能由静态 manifest 代替。 | Prometheus Compose/Kubernetes 均改为显式 `168h`；Kubernetes 新增 Loki 3.6.10 ConfigMap、retention 配置挂载并保留 `emptyDir`；Tempo 保持 `168h`。Compose readiness/query 与配置已核验，Kubernetes 仅完成 kustomize，因无 namespace/owner/window 未执行 runtime。 | 部分解决（Compose/config；Kubernetes runtime 已阻塞） |
| P0-ISSUE-004 | 设计基线 / P0-01、P0-04、P0-07、P0-11、P0-13、P0-14 | Web/Worker 需要统一的 release revision 与显式 deployment mode 采集事实。 | baseline 可能无法完整关联发布版本或部署模式，但不得阻断既有 Fault Run。 | `getBaselineMetadata()` 已接入 capture；远端 Compose baseline 均记录 `1.4.0`/`compose`，并额外记录控制面/Catalog/Worker immutable image digest；Kubernetes 仍无 runtime 核验。 | 已解决（Compose 证据；Kubernetes runtime limitation 保留） |
| P0-ISSUE-005 | P0-01-3 | 初始检查时当前工作区没有完整 disposable Compose 栈；当前 Kubernetes context 中不存在 `castrel` namespace；也没有登记本次运行的环境 owner、观测访问责任人和批准的停止窗口。 | 初始状态无法安全执行完整 Catalog 运行、目标效果/恢复/告警核验或回退；本地 MySQL/Redis 不能替代完整环境。 | 用户已确认本次执行可使用当前工作区作为 disposable Compose，停止窗口为本次核验结束，边界为停止/移除容器但保留数据卷；完整栈已启动并完成核心健康核验。Kubernetes 仍只作为配置核验，后续共享环境仍需单独 owner 和窗口。 | 已解决（本次执行范围） |
| P0-ISSUE-006 | P0-01-4、P0-04、P0-14 | 初始 MySQL 的两条预热进度曾停留在历史 `BACKFILLING`：`target_rows=90000000`、`actual_rows=0`、无 lease owner 和成功时间，且目标与当前支持元组不一致。 | 在没有重新取得租约并核对目标前，不能证明预热配置、进度或历史数据处于可用状态；不得手工改表伪造完成。 | 远端 Worker 按数据库配置、租约、heartbeat 和 rollover 运行后，配置已为 `180×300000=54000000`；`user_behavior_log` 与 `product_price_history` 均达到 54000000/54000000，状态 `APPENDING`、持有 lease 且有成功时间。`APPENDING` 是持续维护状态，不等同于失败。 | 已解决（Compose 运行；持续维护状态保留） |
| P0-ISSUE-007 | P0-01-3、P0-01-4、P0-13 | 在 Apple Silicon 本地以 Compose 默认 Order JVM 上限启动时，`order-service` 因资源不足以退出码 `137`/OOM，导致第一次完整栈启动不完整。 | 本地环境不能用默认资源预算证明 Order 场景的性能或稳定性；若不处理，Gateway 依赖链虽可启动但 Order 业务路径不完整。 | Compose 增加可覆盖的 `ORDER_JAVA_XMS`/`ORDER_JAVA_XMX`，Kubernetes entrypoint 现在把显式 `JAVA_OPTS` 合并到共享 `JAVA_TOOL_OPTIONS`，避免 Order heap 设置静默失效；本地资源仅为启动调优，仍不是性能基线。 | 已解决（配置/脚本，资源基线 limitation 保留） |
| P0-ISSUE-008 | P0-02-1、P0-02-4、P0-06、P0-07、P0-13 follow-up | `fault_run_events.payload` 的历史 schema 仍是可空 JSON，旧数据中存在按请求/按失败写入的高频事件；如果新代码继续沿用，会造成高写入量并扩大原始错误内容进入事件的风险。 | 长期摘要难以保证低基数；baseline 不能把任意历史 payload 当作可信汇总，历史数据也不能通过重写来伪造新合同。 | 新代码已停止产生 `REPORT_REQUEST`、`REPORT_REQUEST_FAILED` 和 `SCENARIO_REQUEST_FAILED`；报表/受控 Worker 只写生命周期汇总。事件写入口现在拒绝动态 event type、退役高频事件、不可序列化 payload，并对当前写入施加 8 KiB UTF-8 上限；历史事件保留七天 retention、只作兼容折叠，不重写。 | 已解决（新写入路径；历史 schema/运行数据 limitation 保留） |
| P0-ISSUE-009 | P0-02-2、P0-05、P0-06、P0-10、P0-14 | 11 个条目虽有静态 Worker/Runner dispatch，但当前 MySQL 没有对应的当前终态汇总；历史 `EXERCISE_WORKER_*` 与当前 `SCENARIO_WORKER_*` 合同不一致，多个条目只有 create failure 或完全没有运行记录。 | 不能证明真实受控请求、目标效果、请求计数、成功/失败、延迟或终态 drain；任何静态“已核验”条目都不能直接生成完整 baseline 或被选择为 pilot。 | P0-14 已在远端 Compose 对 12 个条目完成运行；报告/ surge/Scenario/Runner 终态事件和 recovery/cleanup 已落库，13 个本轮运行集合均形成 baseline 或显式 limitation。真实 observation query、专用资源边界和 pilot eligibility 仍未满足。 | 已解决（Compose 运行；观测/资源/pilot limitation 保留） |
| P0-ISSUE-010 | P0-02-3、P0-05、P0-07、P0-12、P0-14 | 当前 Fault Run state 只有通用 `FAILED`，现有事件也没有统一的五类失败分类和稳定 failure code；直接按 state 或异常文本分类会混淆目标效果、控制动作、Worker、恢复和清理。 | baseline 无法可靠解释“失败发生在哪里”及四种事实边界，可能把目标未观察、控制面失败或资源清理失败误报为同一结果。 | P0-05 已在折叠层派生五类 `failureClass`/稳定 `failureCode`，P0-14 已将其写入运行集合 baseline；`CART_CATALOG_DEPENDENCY` 的真实失败数量已记录，但其业务 failure code 仍需单独复核，不从数量推导分类。 | 已解决（代码与运行折叠；个别业务 code limitation） |
| P0-ISSUE-011 | P0-02-4、P0-06、P0-12、P0-14 | `TrafficSurgeExecutor` 直接使用 `ControlledScenarioWorker`，原先只产生 `SCENARIO_WORKER_STARTED`、请求失败和 `SCENARIO_WORKER_STOPPED`，没有 `SCENARIO_WORKER_DRAINED`；Catalog 矩阵不能把 stopped 统计当 drain/资源释放证据。 | surge 运行结束前无法证明 worker drain snapshot 已写入；baseline 不能把 stopped 统计误当 drain/资源释放证据。 | P0-06 已为 surge 注册 Coordinator drain，并在 promise finally 写入规范化 `SCENARIO_WORKER_DRAINED`；P0-14 的 `BROWSE_SURGE`、`ORDER_QUERY_SURGE` 和其他 Scenario Worker 运行均已核对 drain 事件。 | 已解决（代码、fixture 与 Compose 落库） |
| P0-ISSUE-012 | 用户决策 / P0-04 | Data Warmup 配置原先只来自 Worker 环境变量，Web/API 可能展示与 Worker 不一致的默认值，且无法通过页面启停或调整参数。 | 配置事实不可审计，页面修改无法跨独立进程生效；baseline 不能可靠关联采集时的实际预热配置。 | 已新增 `data_warmup_config` 单行表；首次启动严格校验且仅在无行时使用环境默认值，之后数据库为唯一来源；Operator 更新使用版本 CAS、CSRF、二次确认和审计，Worker 每批次重读配置；Web/Worker 的 bootstrap 环境已统一。 | 已解决（运行时配置范围） |
| P0-ISSUE-013 | P0-08 review | baseline API 原先在 baseline 持久化后才创建 capture audit，且并发请求可重复写 capture lifecycle events；audit 写入失败后已有 baseline 也无法可靠补关联。 | 违反重复 capture 不重复审计/事件的幂等要求，且摘要可能缺少本次 Operator capture 引用。 | P0-08 已在来源级 advisory lock 内建立 audit reservation，再传入 capture；capture event 和 baseline 均使用该 audit id，成功后更新 audit 为 SUCCESS；已有记录在锁内直接返回。仍需 P0-13/P0-14 运行时落库核验。 | 已解决（代码，运行待核验） |
| P0-ISSUE-014 | P0-08 review | pilot review 原先未限制全局多个 `SELECTED`、未覆盖 recovery/cleanup 未知边界，且 free text 可能包含命令或敏感内容。 | 可能把不安全或不可复查的条目标记为 pilot，或同时存在多个 active selected。 | P0-08 已增加全局 selection advisory lock、Catalog revision conflict、业务恢复/清理和观测/告警 eligibility gate；review text 使用长度、primitive、命令/SQL/凭据过滤，Catalog scenario 使用 own-property 校验。实际 review 写入仍待专用环境核验。 | 已解决（代码，运行待核验） |
| P0-ISSUE-015 | P0-09 | 维护文档曾把观测 Basic Auth 写成固定开发密码，但当前 `infra/nginx/.htpasswd` 使用了不同的本地开发凭据；首次探针因此返回 401。 | Operator 可能使用错误凭据，把认证失败误判为观测服务不可用；凭据来源不一致也可能导致不安全复制。 | 已将 `CLAUDE.md` 改为只引用 `infra/nginx/.htpasswd` 作为开发 Compose 的凭据来源，不在台账和证据文件写入密码；后续部署文档继续避免复制具体凭据。 | 已解决（文档来源） |
| P0-ISSUE-016 | P0-13-5、P0-13、P0-14 | 当前 checkout 没有独立的 baseline observation executor；原有配置项只有读取逻辑，capture 只生成固定 `UNKNOWN`。 | 未有真实 adapter 时无法分别从 Prometheus/Loki/Tempo 查询场景窗口，也不能把真实 timeout、网络、认证和过期结果作为 pilot 前置事实。 | 已新增 `ObservationExecutor` interface/allowlist reference、窗口 future/expired/invalid 校验、timeout/network/authentication 归一化、capture 接入、低基数 `BASELINE_OBSERVATION_CHECK_RECORDED` 状态/窗口字段和纯测试；默认无 adapter 仍返回 `UNKNOWN`，远端 baseline 因此保留 observation limitation。 | 已阻塞（接口边界完成，真实适配器未实现） |
| P0-ISSUE-017 | P0-14 远端发布验收 | 控制面镜像、Catalog 镜像和远端工作区曾不对应同一提交；在该漂移状态下，256B Redis 参数实际到达目标并返回 502，不能作为参数合同验收证据。 | 运行证据可能来自不同源码/镜像版本，Catalog revision、目标校验和回退结论不可复查。 | 保留远端未提交差异，临时从干净 `a2df629` 构建 Catalog/控制面/Worker，重新部署并确认 256B 返回 400 `INVALID_PARAMETER:memberSizeBytes`；随后将远端工作区恢复为干净 HEAD，并记录两个镜像 digest。 | 已解决（Compose 发布一致性） |

## 执行更新记录

每个任务状态变化后追加一行，保留历史，不覆盖此前事实。验证证据写命令、环境、输出摘要、Run/Event/Audit 引用或文档链接；不得写入 credential、token、原始观测载荷或敏感业务数据。

| 日期 | 阶段/任务 | 总体进度 | 任务组进度 | 执行情况与证据 | 问题/方案 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-16 | P0-PLAN：建立任务清单 | 0 / 14（0 / 73 子任务） | 全部未开始 | 已基于阶段 0、批次 0 产品规格和技术设计建立实施顺序、依赖、验收与更新规则。 | 预置 P0-ISSUE-001 至 P0-ISSUE-004，均需以代码或实际环境核验。 | 开始 P0-01，生成带 `catalogRevision` 的覆盖矩阵并确认环境前置。 |
| 2026-09-16 | P0-01-1：范围锁定与执行前检查 | 0 / 14（1 / 73 子任务） | P0-01：1 / 4 | 已复核阶段 0、批次 0 产品规格、技术设计和共用运行规则；确认本批次只做旁路采集、只读核验、增量 schema 和发布护栏，不改变 Fault Run 效果、业务接口、自动恢复或 Agent 写权限。 | 无新增问题；P0-ISSUE-001 至 P0-ISSUE-004 按原状态保留，待后续代码/环境核验。 | 生成 Catalog 派生覆盖矩阵，并核验每个条目的 dispatch 与终态汇总来源。 |
| 2026-09-16 | P0-01-2：Catalog 覆盖矩阵 | 0 / 14（2 / 73 子任务） | P0-01：2 / 4 | 使用 `listScenarioDefinitions()` 生成 12 条目矩阵；稳定 canonical JSON 的 SHA-256 为 `daec0e1acd902e39c2a6a716e014113199f295f45799ed3fe6df66e0dcdab453`。矩阵记录 target service/operation、时长、recovery strategy、cleanup capability、dispatch owner 和终态事件来源，详见 `catalog-coverage-matrix.md`。 | 静态核验确认 `CART_CATALOG_DEPENDENCY` 缺少控制面 Worker/Runner dispatch，P0-ISSUE-001 更新为处理中；其余 11 条目只代表代码路径存在，仍需环境运行确认。 | 核验 Compose/Kubernetes 责任环境、观测入口、认证边界和停止窗口。 |
| 2026-09-16 14:50 | P0-01-3：环境责任与停止边界 | 0 / 14（2 / 73 子任务） | P0-01：2 / 4（1 个阻塞） | `docker compose config --quiet` 和 `kubectl kustomize k8s` 均通过；Compose 仅有健康的 MySQL/Redis，控制面、Gateway、Shopfront 和观测入口不可达；Kubernetes `castrel` namespace 不存在。依据 README、Compose 和 K8s manifest 记录了访问边界及安全停止方式，但没有发现本次 disposable 环境 owner、观测访问责任人或批准停止窗口。 | 新增 P0-ISSUE-005 并标记已阻塞；在责任环境和窗口明确前不启动完整栈或执行 teardown。 | 等待明确责任环境、访问路径和停止窗口；其余可独立完成的基线记录继续保留。 |
| 2026-09-16 14:50 | P0-01-4：健康、运行与残留快照 | 0 / 14（3 / 73 子任务） | P0-01：3 / 4（1 个阻塞） | 只读记录：MySQL/Redis 为 `healthy`；控制面、Gateway、Shopfront、Prometheus、Alertmanager、Loki、Tempo 探针为 `UNAVAILABLE`；Fault Run 只有 `FAILED=16`、`RECOVERED=1`、`STOPPED=7`，无非终态记录；预热两表为历史 `BACKFILLING` 且实际行数为 `0`，无 lease owner/成功时间；记录本地目录大小和 Redis key 名称扫描，未把未知目标资源标为已清理。 | 新增 P0-ISSUE-006，指出预热进度过期且与当前支持元组不一致；P0-ISSUE-003 仍待实际观测核验。 | 先解决 P0-ISSUE-005；获批环境可用后再执行真实 smoke、Worker/预热和观测核验。 |
| 2026-09-16 15:29 | P0-01-3：解除环境阻塞 | 1 / 14（4 / 73 子任务） | P0-01：4 / 4 | 用户确认当前工作区作为 disposable Compose，允许启动完整栈并在本次核验结束后停止/移除容器、保留数据卷。补齐缺失观测镜像后，完整栈启动成功；Kubernetes 仍完成 kustomize 和 namespace 配置核验但未部署。 | P0-ISSUE-005 更新为“已解决（本次执行范围）”；共享 Kubernetes 环境 owner 和长期窗口仍不由本次本地授权覆盖。 | 完成健康稳定性复核后，进入 P0-02。 |
| 2026-09-16 15:29 | P0-01-4：完整栈健康复核 | 1 / 14（4 / 73 子任务） | P0-01：4 / 4 | 经过依赖等待：控制面、Gateway、Shopfront、业务 healthcheck 最终可用；带认证的 Prometheus、Alertmanager、Loki、Tempo readiness 最终返回 `200`；Worker 进程为 `running`；Order 默认 JVM 曾 OOM，临时 512MB JVM 容器恢复为 `healthy`。`DATA_WARMUP_ENABLED=false`，未修改历史预热进度。 | P0-ISSUE-007 更新为处理中；P0-ISSUE-006 仍待在专用窗口按当前预热合同核验；观测 retention、查询内容和告警接收仍留给 P0-09。 | 开始 P0-02，盘点字段、事件来源、保留期和失败分类。 |
| 2026-09-16 15:29 | P0-02：事实来源、事件和失败分类盘点启动 | 1 / 14（4 / 73 子任务） | P0-02：0 / 4 | P0-01 退出条件已满足；P0-02 开始，先以代码迁移、实际 MySQL schema、Catalog 派生矩阵和 Worker 事件定义为事实来源，不改变运行时路径。 | 保留 P0-ISSUE-001、P0-ISSUE-006、P0-ISSUE-007 的 limitation；尚未对字段和保留期完成盘点。 | 盘点 Fault Run/审计/预热表结构、事件来源、关联键和可信边界。 |
| 2026-09-16 15:29 | P0-02-1：事实来源、事件和失败分类盘点 | 1 / 14（5 / 73 子任务） | P0-02：1 / 4 | 依据 `001-fault-runs.sql`、`04-fault-run-schema.sql`、`fault-run-schema.ts`、`fault-run-repository.ts`、`operator-audit.ts`、`worker/index.ts`、`data-warmup.ts` 和当前 MySQL 只读统计，记录字段、关联键、retention、可信边界及事件来源。当前数据：24 runs、105 events、39 audits；事件/审计窗口为 2026-08-27～2026-09-03。 | 发现 `fault_run_events` payload 无 schema/长度约束且存在按请求/失败写事件，新增 P0-ISSUE-008；不把当前 payload 长度样本视为安全上限。 | 逐项核验 Catalog dispatch、实际受控请求和终态汇总，特别处理 `CART_CATALOG_DEPENDENCY`。 |
| 2026-09-16 15:29 | P0-02-2：Catalog dispatch 与运行证据核验 | 1 / 14（6 / 73 子任务） | P0-02：2 / 4 | 对 12 个 Catalog 条目逐项比对 `OperationDispatchController.TARGETS`、surge/Scenario/Report Worker、Runner dispatch 和当前 MySQL 事件聚合。Gateway target map 覆盖 10 个非 surge operation；surge 有专用 Worker；`CART_CATALOG_DEPENDENCY` 无控制面 dispatch。当前库没有任何当前命名的终态汇总事件，唯一 `EXERCISE_WORKER_*` 为旧事件名；11 个静态路径条目均保留运行时 `UNKNOWN/INCOMPLETE`。 | 新增 P0-ISSUE-009，记录静态路径不等于真实受控请求和终态证据；P0-ISSUE-001 继续处理中。未执行新的 Catalog Fault Run。 | 定义五类失败分类，区分控制动作、效果观察、业务恢复和资源清理。 |
| 2026-09-16 15:29 | P0-02-3：五类失败分类与事实边界 | 1 / 14（7 / 73 子任务） | P0-02：3 / 4 | 依据 `tech.md` 第 7、8、9 节、`fault-run-coordinator.ts`、`fault-run-repository.ts`、Operator stop/cleanup routes 和现有 Worker 事件，定义 `TARGET_EFFECT_FAILURE`、`CONTROL_PLANE_FAILURE`、`WORKER_FAILURE`、`RECOVERY_FAILURE`、`CLEANUP_FAILURE`，并分别约束 `controlAction`、`effectObserved`、`businessRecovered`、`resourceCleanup`。 | 新增 P0-ISSUE-010：当前 state/event 没有统一分类；解决方案是在 baseline 折叠层派生稳定 code，保留未知，不修改现有 Fault Run state。 | 定义低基数事件白名单、必填字段、payload 限长、脱敏和不可可靠采集字段。 |
| 2026-09-16 15:29 | P0-02-4：低基数事件与 payload 约定 | 2 / 14（8 / 73 子任务） | P0-02：4 / 4 | 将新/补齐事件限定为固定白名单和 `schemaVersion=1`，定义 source/phase/status 必填字段、8 KiB UTF-8 JSON 上限、字符串/数组/计数值域、敏感字段禁止项和超限错误；区分可复用终态摘要、历史高频事件与待补齐 surge drain/运行时摘要。 | P0-ISSUE-008 保留：既有事件不重写，baseline 对旧 payload 做限制判断；P0-ISSUE-011 记录 surge drain 缺失；P0-ISSUE-009/001 继续阻塞真实运行证据。 | 停止本次 disposable Compose 容器并保留数据卷；开始 P0-03 expand-only schema、迁移和受控类型设计。 |
| 2026-09-16 15:29 | P0-01 环境收尾：停止 disposable Compose | 2 / 14（8 / 73 子任务） | P0-01：4 / 4；P0-02：4 / 4 | 按用户确认的停止边界执行 `docker compose down --remove-orphans`；`docker compose ps -a` 无残留容器，网络已移除；未使用 `--volumes`，`data/mysql` 约 155M、`data/redis` 目录仍保留。未执行 Catalog Fault Run、预热写入或数据清理。 | P0-ISSUE-005 保持“已解决（本次执行范围）”；P0-ISSUE-006/007/009/011 等 limitation 不因停止动作改变。 | 开始 P0-03：核对技术设计、现有 migration runner 和 fresh/既有 volume 的 expand-only 约束。 |
| 2026-09-16 15:29 | P0-03-1：baseline/pilot TypeScript schema | 2 / 14（9 / 73 子任务） | P0-03：1 / 5 | 新增 `traffic-control-plane/src/lib/baseline-schema.ts`，集中定义 `BASELINE_SCHEMA_REVISION`、capture/review/deployment/observation/failure 枚举、lifecycle/outcome/request/observation/alert/residual/rollback 等受控结构；未建立到 Fault Run 的级联引用。 | 运行时深度校验、secret/原始响应/超长 payload 拒绝由后续 repository/service 和测试实现；保留 P0-ISSUE-008、P0-ISSUE-010、P0-ISSUE-011。 | 新增 `002-fault-run-baseline.sql` 与 `infra/mysql/init/06-fault-run-baseline.sql`，保持两份 DDL 一致且 expand-only。 |
| 2026-09-16 15:29 | P0-03-2：应用 baseline migration | 2 / 14（10 / 73 子任务） | P0-03：2 / 5 | 新增 `traffic-control-plane/src/lib/migrations/002-fault-run-baseline.sql`，仅创建 `scenario_baselines`、`baseline_pilot_reviews`、索引、enum CHECK 和 data warmup/deployment 值域约束；未修改既有 Fault Run 表。 | 保留 P0-ISSUE-008/010/011；应用初始化入口尚未接入。 | 添加 fresh-install init SQL，并做两份 DDL 一致性核验。 |
| 2026-09-16 15:29 | P0-03-3：fresh-install baseline init SQL | 2 / 14（11 / 73 子任务） | P0-03：3 / 5 | 新增 `infra/mysql/init/06-fault-run-baseline.sql`；与应用 migration 文件通过 `cmp` 字节级一致；两张表均无 Fault Run/audit 外键，来源运行 retention 后 baseline/pilot review 不被级联删除。 | 未启动 MySQL 做实际 DDL 执行；该验证留在 P0-03-4 的既有 volume/fresh install 检查。 | 实现独立幂等应用 schema 初始化，确保新表失败不阻断既有 Fault Run。 |
| 2026-09-16 15:29 | P0-03-4：幂等应用 schema 初始化 | 3 / 14（12 / 73 子任务） | P0-03：4 / 5 | `ensureBaselineSchema()` 在保留的 `castrel` MySQL volume 中连续调用两次成功；应用初始化仅串行执行新表 DDL，失败重置自身 promise 并向调用方抛错；`ensureFaultRunSchema()` 和既有 repository 未引入 baseline 初始化依赖。现有 `fault_runs` 仍为 24 条。 | 未通过故障注入模拟数据库不可用；以独立 promise/static import 边界证明新初始化失败不会阻断既有 Fault Run，专门失败注入留给 P0-12/P0-13。 | 核验来源 Fault Run retention 与 baseline/pilot review 的级联独立性。 |
| 2026-09-16 15:29 | P0-03-5：baseline retention 独立性 | 3 / 14（13 / 73 子任务） | P0-03：5 / 5 | 既有库执行 `information_schema.referential_constraints` 只读查询，新表无任何 foreign key；`scenario_baselines` 与 `baseline_pilot_reviews` 已存在且为空，未对历史 Fault Run 做删除或重置。DDL 与技术设计均不声明来源级联。 | baseline 不复用 Fault Run 7 天 retention；后续若新增摘要 retention 必须单独设计。 | 停止 schema 验证 MySQL 容器并保留 `data/mysql`，开始 P0-04 元数据实现。 |
| 2026-09-16 17:04 | P0-04-1：Data Warmup 配置边界确认 | 3 / 14（13 / 74 子任务） | P0-04：0 / 6（1 个进行中） | 用户确认数据库作为 Data Warmup 运行时唯一来源；首次启动只用严格校验后的环境默认值初始化，后续环境变量不覆盖数据库。用户确认所有 `DATA_WARMUP_*` 均可编辑，但强制 `windowDays × rowsPerDay = targetRows`；窗口/目标变更需二次确认、审计并由 Worker 按租约逐步执行。 | 新增 P0-ISSUE-012；产品与技术设计已同步更新。P0-04-1 进入实现，P0-04-6 待实现。 | 完成 Catalog revision，再实现 release/deployment metadata 和数据库驱动预热配置。 |
| 2026-09-16 17:26 | P0-04-1：Catalog revision 实现与矩阵同步 | 4 / 14（14 / 74 子任务） | P0-04：1 / 6 | 新增 canonical Catalog 序列化、稳定对象/参数/options 排序和 SHA-256 revision；`fault-run-catalog-revision.test.ts` 通过，当前 revision 为 `000ccc36e4a77ef27d22636bdbc4643ff79ddb0c205b21830967bc40b7abd7dc`，已同步 `catalog-coverage-matrix.md`。 | 原矩阵 revision 因排序算法更新而变化，已记录新值；静态 dispatch 仍不等于运行证据，P0-ISSUE-001/009 不变。 | 完成 release/deployment/schema/warmup metadata 接入并验证。 |
| 2026-09-16 17:26 | P0-04-2/3：release revision 与 deployment mode | 4 / 14（16 / 74 子任务） | P0-04：3 / 6 | 新增 `CASTREL_RELEASE_REVISION`/`CASTREL_DEPLOYMENT_MODE` 的规范化校验、UNKNOWN limitation 和 `getBaselineMetadata()`；Compose Web/Worker 提供注入入口，Kubernetes ConfigMap 明确 `kubernetes` 模式，未依据运行时特征猜测。`baseline-metadata.test.ts`、typecheck、lint 通过。 | P0-ISSUE-004 从待处理转为处理中：最终 baseline capture service 接入需等 P0-07，缺失 release 仍诚实记录 UNKNOWN。 | 验证 `BASELINE_SCHEMA_REVISION` 与两份 DDL，并实现 warmup metadata 读取。 |
| 2026-09-16 17:26 | P0-04-4/5：schema revision 与 warmup metadata | 4 / 14（18 / 74 子任务） | P0-04：5 / 6 | `BASELINE_SCHEMA_REVISION=baseline.v1` 已在 TypeScript、应用 migration、fresh-install SQL 和 metadata 类型中统一；应用/fresh baseline DDL `cmp` 一致。新增 `loadBaselineWarmupMetadata()`，读取数据库配置和 Worker progress 并在不可用时返回明确 limitation。 | 历史 warmup progress 仍 stale，未执行写入或手工修复，保留 P0-ISSUE-006；capture service 的最终写入接入留给 P0-07。 | 完成数据库驱动配置、Operator API/UI、Worker 动态读取和部署配置验证。 |
| 2026-09-16 17:26 | P0-04-6：数据库驱动 Data Warmup 配置闭环 | 4 / 14（19 / 74 子任务） | P0-04：6 / 6 | 新增 `data_warmup_config` migration/init SQL；配置只在行缺失时从严格环境默认初始化，后续 DB 唯一来源。新增 GET/PUT config API（version/CAS、CSRF、影响确认、审计）、progress 返回 DB config、Operations 编辑表单/启停/中英文提示；Worker 启动 service 后按 lease 和 batch 动态读取并安全停止。`pnpm test:i18n`、`pnpm test:runner`、配置/metadata 单测、typecheck、lint、Compose/Kustomize 校验均通过；未启动预热写入。 | P0-ISSUE-012 已解决（运行时配置范围）；P0-ISSUE-006 仍待获批 disposable 窗口用新配置处理历史 stale progress。 | 进入 P0-05 事件折叠；P0-07 将 metadata 接入 baseline capture。 |
| 2026-09-16 17:45 | P0-05-1/2：稳定事件折叠和来源策略 | 5 / 14（21 / 74 子任务） | P0-05：2 / 6 | 新增 `baseline-event-folding.ts`，按 `created_at,id` 稳定排序并保留已消费事件来源；报告 Worker 读取最后 `REPORT_REQUEST` 并由 `REPORT_WORKER_STOPPED` 补充结束摘要，Scenario Worker 优先读取 `SCENARIO_WORKER_STOPPED`、仅在必要时回退 `DRAINED`，Runner 统计 lifecycle 成功/失败和 latency 但不伪造请求数。 | 当前数据库没有这些当前命名的终态汇总，真实条目仍 `MISSING_RUNTIME_EVENT`/`INCOMPLETE`；P0-ISSUE-009/011 保留。 | 生成生命周期和 recovery/cleanup 边界，并补齐 fixture。 |
| 2026-09-16 17:45 | P0-05-3/4：时间线与 recovery strategy 边界 | 5 / 14（23 / 74 子任务） | P0-05：4 / 6 | 输出 prepare/active/stop/recovered/cleanup 时间线；`activeAt` 只使用 `started_at` 或 `TARGET_CONFIRMED`，不以首次业务请求替代。`MANUAL_CLEANUP` 输出 `MANUAL_REQUIRED`，`NON_RELEASING` 输出 `NOT_REQUIRED` 与残留边界，普通 release 未有物理资源核验时输出 `UNKNOWN/CLEANUP_UNVERIFIED`，不把 `RECOVERY_COMPLETED` 当成业务恢复。 | 观测健康时间点和实际资源核验仍由 P0-09/P0-07 负责；P0-ISSUE-006/009 保留。 | 校验计数一致性、五类失败派生和稳定 capture 错误。 |
| 2026-09-16 17:45 | P0-05-5/6：计数完整性和稳定错误语义 | 5 / 14（25 / 74 子任务） | P0-05：6 / 6 | 对 requests/successes/failures/timeouts/inFlight 做一致性校验，矛盾时保留原始可信数值并输出 `COUNTER_INCONSISTENT`；新增五类 failure class、首批稳定 failure code、事件 source 和 limitation；新增 `baseline-capture-errors.ts`，统一 `SOURCE_RUN_NOT_FOUND=404`、`RUN_NOT_TERMINAL=409` 等稳定错误状态。6 个 fixture 覆盖完整 Worker、报告汇总缺失、计数矛盾、CART dispatch 未核验、NON_RELEASING 和 source run error。 | P0-ISSUE-010 从待核验更新为处理中：折叠层已实现，但真实终态事件、capture/audit 接入和更广泛分类 fixture 仍待 P0-06/P0-07/P0-12；Operator audit 写入不在纯函数层伪造。 | 进入 P0-06，核验 Worker 终态汇总事件及 surge drain 边界。 |
| 2026-09-16 17:55 | P0-06-1/2：终态汇总与 stop/failure 边界 | 6 / 14（27 / 74 子任务） | P0-06：2 / 4 | 调整 Report Worker 的 started/finally 结构，setup 失败、停止、到期都尝试 `REPORT_WORKER_STOPPED`；ControlledScenarioWorker 将 started event 纳入 try/finally，停止和 start 写失败仍尝试 STOPPED；Traffic Surge/Scenario Workers 保留 setup failure 并补齐 promise finally 的 drain snapshot。未增加每请求写库。 | 事件实际落库仍需 P0-14 disposable run 验证；数据库当前没有新的运行记录，不把代码路径当作 runtime evidence。 | 统一终态 payload 合同并测试敏感字段/长度边界。 |
| 2026-09-16 17:55 | P0-06-3：低基数终态事件合同 | 6 / 14（28 / 74 子任务） | P0-06：3 / 4 | 新增 `fault-run-event-contract.ts`，为 STOPPED/DRAINED/RUNNER summary/setup failure 生成固定 `schemaVersion=1`、`source`、`phase`、`status`，只保留白名单计数、延迟、cache/drain 摘要和稳定 failure code；丢弃 raw error、run/lifecycle ID 和未知字段，严格限制 8 KiB UTF-8 payload。 | 既有 `REPORT_REQUEST`/`SCENARIO_REQUEST_FAILED` 高频事件仍保留历史兼容，P0-ISSUE-008 继续处理中；新增 contract 的落库 failure logging 仍需后续完善。 | 确认 dispatch 缺失时 baseline 状态阻断。 |
| 2026-09-16 17:55 | P0-06-4：dispatch 与完整性阻断 | 6 / 14（29 / 74 子任务） | P0-06：4 / 4 | P0-05 折叠器对 `CART_CATALOG_DEPENDENCY` 无 Worker/Runner 汇总时输出 `DISPATCH_UNVERIFIED`/`INCOMPLETE`；缺少当前命名终态汇总统一输出 `MISSING_RUNTIME_EVENT`/`INCOMPLETE`，不会被标为 complete/pilot。`fault-run-event-contract.test.ts`、Worker/Scenario tests、typecheck、lint 均通过。 | P0-ISSUE-001/009 仍阻塞真实 runtime baseline；P0-ISSUE-011 代码已补 drain，需 P0-12/P0-14 实际验证。 | 进入 P0-07，接入 capture service、metadata、folded facts 和幂等 repository。 |
| 2026-09-16 18:07 | P0-07-1：幂等 baseline repository | 7 / 14（30 / 74 子任务） | P0-07：1 / 5 | 新增 `baseline-repository.ts` 和 `SqlBaselineRepository`；以 `source_fault_run_id` 唯一键读取/保存，duplicate insert 返回已有摘要，避免重复数据。baseline 表不引用 Fault Run/audit 外键，retention 独立。 | 已有 MySQL volume 可能保留旧的 `NOT NULL` warmup 列；新增 expand-only `ALTER TABLE ... MODIFY data_warmup_enabled TINYINT NULL`，并同步 application/init DDL。 | 验证 capture service 的终态、事件和 metadata 组合。 |
| 2026-09-16 18:07 | P0-07-2/3：capture service 与 limitation-aware baseline | 7 / 14（32 / 74 子任务） | P0-07：3 / 5 | 新增 `baseline-capture.ts`；读取终态 Fault Run、events、audit、Catalog revision、release/deployment 和数据库 warmup metadata，调用 `foldBaselineEvents()`，构建 lifecycle/outcome/request/resource/observation/alert/limitation/residual/rollback 摘要。非终态和未启用均返回稳定错误；缺失观测保持 `UNKNOWN`，不伪造 effect、请求或恢复结果。 | P0-ISSUE-004 由“等待 capture 接入”更新为“capture 已接入但发布 revision 可能 UNKNOWN”；P0-ISSUE-001/006/009/010 仍保留。 | 写入受控 capture lifecycle events，并补齐 feature flag 部署默认值。 |
| 2026-09-16 18:07 | P0-07-4：capture lifecycle 事件与默认关闭 | 7 / 14（33 / 74 子任务） | P0-07：4 / 5 | 写入 `BASELINE_CAPTURE_REQUESTED`、`BASELINE_RUNTIME_SUMMARY_RECORDED`、`BASELINE_OBSERVATION_CHECK_RECORDED` 和完成/不完整/失败事件；事件 contract 过滤 raw error、run/lifecycle ID、未知字段，限制 8 KiB UTF-8。Compose Web/Worker 与 Kubernetes ConfigMap 显式注入 `BASELINE_CAPTURE_ENABLED=false`。 | 真实事件落库仍需 P0-14 disposable run 验证；当前观测摘要仅为 limitation，未启动新的 Fault Run。 | 验证 service fixture、typecheck、lint、DDL parity 和 schema init 边界。 |
| 2026-09-16 18:07 | P0-07-5：capture 验证与独立生命周期边界 | 7 / 14（34 / 74 子任务） | P0-07：5 / 5 | `pnpm exec tsx --test src/lib/baseline-capture.test.ts src/lib/baseline-event-folding.test.ts src/lib/fault-run-event-contract.test.ts`：11 passing；`pnpm typecheck`、`pnpm lint --quiet`、`git diff --check` 通过；application migration 与 fresh-install baseline DDL `cmp` 一致。capture 只写 baseline/event，Fault Run 生命周期未被改变；schema 初始化 promise 独立失败并向调用方抛错。 | P0-ISSUE-002/003 观测与告警仍待核验；P0-ISSUE-011 仍待真实 drain 落库；未执行现场 capture。 | 进入 P0-08，实现 Operator-only baseline API、CSRF、审计和查询边界。 |
| 2026-09-16 18:07 | P0-08：Operator API、鉴权、CSRF 与审计启动 | 7 / 14（34 / 74 子任务） | P0-08：0 / 5 | 已将 P0-08 标记为进行中；实现前先复用现有 Operator session、CSRF、`jsonOk/jsonError`、audit 和 route 查询模式，不新增消费者路径或凭据。 | 需要确定 pilot review 的 revision conflict、写审计和 capture disabled 语义；保持默认关闭和现有 Fault Run 行为不变。 | 盘点现有 Operator route、审计 helper、baseline repository 和错误 envelope。 |
| 2026-09-16 18:32 | P0-08-1：单次 baseline 创建与查询 API | 8 / 14（35 / 74 子任务） | P0-08：1 / 5 | 新增 `/internal/fault-runs/{faultRunId}/baseline` GET/POST；POST 复用终态校验、幂等 capture 和稳定错误 code，GET 只返回已保存摘要；未改变 Fault Run、Worker、Gateway 或消费者路径。 | `BASELINE_CAPTURE_ENABLED=false` 时新增采集入口返回 `BASELINE_CAPTURE_DISABLED=404`；已存在 baseline 的 GET 仍可读。 | 增加按 scenario/status/revision 的 baseline 摘要查询。 |
| 2026-09-16 18:32 | P0-08-2：baseline 摘要查询边界 | 8 / 14（36 / 74 子任务） | P0-08：2 / 5 | 新增 `/internal/baselines`，支持 `scenario`、`captureStatus`、`catalogRevision`、`limit` 过滤；repository 使用参数化查询和 1–100 上限，只返回 baseline 受控 JSON，不返回 fault event、raw observation 或凭据。 | 数据库不可用返回 503，不将存储故障伪装为查询参数错误。 | 增加 pilot review 查询和 revision conflict 处理。 |
| 2026-09-16 18:32 | P0-08-3：pilot review 查询、写入和选择护栏 | 8 / 14（37 / 74 子任务） | P0-08：3 / 5 | 新增 `/internal/baselines/pilot` GET 和 `/internal/baselines/pilot/{scenario}` PUT；review 输入受限长、低基数字段和 primitive retention 摘要，Catalog revision 必须等于当前 revision；`SELECTED` 需要完整 baseline、retention、Prometheus/Loki/Tempo 和 alert rule 事实，未知/未核验时稳定拒绝。 | 当前 P0-07 baseline 的观测和告警均为 UNKNOWN/limitation，故本地不能选择 pilot；不以 review 写入代替真实观测事实。 | 补齐所有写操作 audit 引用和重复 capture 审计边界。 |
| 2026-09-16 18:32 | P0-08-4：Operator session、CSRF 和审计 | 8 / 14（38 / 74 子任务） | P0-08：4 / 5 | 所有写路由沿用 middleware Operator session 和 `isCsrfRequest()`；baseline 路由在来源级 advisory lock 内先写 `BASELINE_CAPTURE` FAILURE audit reservation，再将 audit id 传给 capture，成功后更新 SUCCESS；pilot review 使用全局 selection lock 和相同 reservation 语义。重复 baseline 已有记录直接返回，不再写审计、摘要或 capture events。 | 未启动栈验证 audit/lock 落库；P0-13/P0-14 负责 live CSRF/session/audit 证据。 | 验证默认关闭回退与全量构建。 |
| 2026-09-16 18:32 | P0-08-5：默认关闭、回退与实现验证 | 8 / 14（39 / 74 子任务） | P0-08：5 / 5 | `baseline-pilot.test.ts`、`baseline-capture.test.ts`、`fault-run-catalog.test.ts`、`fault-run-event-contract.test.ts` 共 15 passing；`pnpm test:runner` 72 passing；`pnpm typecheck`、`pnpm lint --quiet`、`pnpm build`、`git diff --check` 通过；Next build 明确生成 4 个 baseline/pilot internal routes，Compose/Kubernetes 默认关闭值已接入。 | 未在真实环境调用新增路由；运行时 audit、CSRF、DB schema、advisory lock 和真实 capture 仍待 P0-13/P0-14。 | 进入 P0-09，执行只读观测、retention 和告警接入核验。 |
| 2026-09-16 18:45 | P0-08 post-review hardening：并发、审计和输入安全修复 | 8 / 14（39 / 74 子任务） | P0-08：5 / 5 | 根据独立代码审查结果补齐来源级 baseline advisory lock、全局 pilot selection lock、capture/pilot audit reservation、malformed JSON 400、invalid run audit、Catalog own-property lookup、review 命令/SQL/secret/token/shell 过滤和 recovery/cleanup safety gate；修复后重新通过 baseline/pilot/catalog/event fixture（15 passing）、runner（72 passing）、typecheck、lint、build、Compose/Kustomize 和 diff check。 | 新增 P0-ISSUE-013、P0-ISSUE-014，均已解决代码缺陷但真实 audit/lock 落库仍待 P0-13/P0-14；没有启动 Fault Run 或 baseline capture。 | 进入 P0-09，只读核验观测、retention 和 Alertmanager 接收边界。 |
| 2026-09-16 18:58 | P0-09：只读观测、retention 与告警接入核验 | 9 / 14（44 / 74 子任务） | P0-09：5 / 5 | 详见 [`observability-verification.md`](./observability-verification.md)。只启动观测组件；通过 Nginx Basic Auth 以 10 秒超时执行 readiness、Prometheus/Loki/Tempo 时间窗口查询和 Alertmanager API/config 校验。Compose 最终 Prometheus/Loki/Tempo/Alertmanager readiness 为 HTTP 200；Prometheus/Loki 查询成功，Tempo search 返回有效 JSON；Prometheus observed `1w`、Loki limits observed `1w`、Tempo observed root `168h` 但另有 `336h` backend scheduler 字段；3 个 Alertmanager receiver 均 `send_resolved=true`。 | P0-ISSUE-002 更新为已阻塞：控制面 webhook route 不存在且 receiver 无机器认证；P0-ISSUE-003 更新为处理中：Kubernetes runtime 未核验、Kubernetes Loki 未挂载 retention 配置、Tempo retention 语义待拆解；新增并解决 P0-ISSUE-015（文档 Basic Auth 来源不一致）。未保存原始观测结果、凭据或告警 payload，未启动 Fault Run/warmup。 | 保持零个 `SELECTED`，进入 P0-10 逐项记录 Catalog 告警事实和排除理由。 |
| 2026-09-16 | P0-10-1：Pilot review 模型和 revision 幂等复核 | 9 / 14（45 / 74 子任务） | P0-10：1 / 5 | 复核 `baseline-schema.ts`、`baseline-repository.ts`、`baseline-pilot.ts` 和 pilot route：三态 decision、`(scenario,catalog_revision)` 唯一键、revision conflict、全局 selection advisory lock、审计 reservation 和 recovery/cleanup/observation eligibility gate 已存在；相关 fixture 通过。 | 没有新增问题；代码模型已完成，但实际 review 写入和并发落库仍留给 P0-13/P0-14。 | 固定当前 Catalog revision，逐项整理 runbook 告警映射和共享资源风险。 |
| 2026-09-16 | P0-10-2：12 场景告警与证据矩阵 | 9 / 14（46 / 74 子任务） | P0-10：2 / 5 | 新增 [`pilot-review-matrix.md`](./pilot-review-matrix.md)，以 Catalog revision `000ccc36e4a77ef27d22636bdbc4643ff79ddb0c205b21830967bc40b7abd7dc` 覆盖 12 个条目的 target service/operation、runbook 候选告警、actual firing、查询窗口、retention、共享资源风险和排除理由。 | 候选规则不等于 firing；没有执行新的 Fault Run，所有 actual firing/query window/receipt 保持 `UNKNOWN`/`UNVERIFIED`。P0-ISSUE-002、003、009、011 保持原状态。 | 逐项套用 `SELECTED` eligibility gate，不把组件 readiness 当场景 baseline。 |
| 2026-09-16 | P0-10-3：Pilot 选择门槛评估 | 9 / 14（47 / 74 子任务） | P0-10：3 / 5 | 以 P0-09 观测证据和矩阵逐项检查真实 baseline、Alertmanager receipt、Prometheus/Loki/Tempo 窗口、retention、业务恢复、资源边界和 remediation；当前没有条目满足 `SELECTED` 的全部条件。 | Alertmanager route/机器认证缺失；Compose Tempo retention 语义未拆解；Kubernetes runtime 未核验；场景 firing 和 baseline 均缺失。不得把“不满足条件”写成未触发。 | 保持零个 `SELECTED`，记录每个条目的明确限制和关联问题。 |
| 2026-09-16 | P0-10-4：零个 selected 与持久化状态核验 | 9 / 14（48 / 74 子任务） | P0-10：4 / 5 | 在 disposable MySQL 中执行只读聚合核验：`baseline_pilot_reviews` 无 decision 行，`scenario_baselines` 行数为 `0`；`BASELINE_CAPTURE_ENABLED=false`，未调用写路由。矩阵将 12 条记录为当前窗口“不具备选择资格（相当于本轮 REJECTED，未持久化）”。 | 没有新增独立问题；这不是永久拒绝，也不是证明告警未触发。继续跟踪 P0-ISSUE-001、002、003、009、011。 | 记录实际 remediation/data boundary，并完成 P0-10 关闭条件。 |
| 2026-09-16 | P0-10-5：Remediation boundary 与任务收尾 | 10 / 14（49 / 74 子任务） | P0-10：5 / 5 | `pilot-review-matrix.md` 为 12 个条目分别记录正常业务/基础设施修复、验证和数据处理边界；明确没有执行 remediation，不记录 Fault Run 生命周期动作、Agent 调用或写权限。P0-10 结论为零个 `SELECTED`、无新增 P0-ISSUE-016。 | 当时的 P0-ISSUE-002 route/认证实现缺口已由 P0-13 补齐；真实 receipt 仍待核验，P0-ISSUE-003/009/011 继续待后续 runtime；没有伪造 baseline、请求、延迟、告警或恢复结果。 | 进入 P0-11：配置、资源预算、运行手册与回退护栏。 |
| 2026-09-16 19:20 | P0-11-1：发布和观测配置接入 | 10 / 14（50 / 74 子任务） | P0-11：1 / 6 | 在 `env.ts` 增加 `BASELINE_OBSERVATION_CHECK_TIMEOUT_MS`（默认 5000，范围 1000–60000）和 `BASELINE_OBSERVATION_WINDOW_SEC`（默认 900，范围 60–86400）；Compose Web/Worker 与 Kubernetes ConfigMap 注入 `BASELINE_CAPTURE_ENABLED`、release/deployment 和观测配置，默认保持关闭；README 补充部署变量说明。`docker compose config --quiet`、`kubectl kustomize k8s`、typecheck 和 lint 通过。 | 没有新增问题；专用环境的实际 revision、runtime resource 使用量和观测能力仍为 limitation。 | 记录开发、full disposable Compose 和专用 Kubernetes pilot 资源边界。 |
| 2026-09-16 19:20 | P0-11-2：资源预算和危险场景隔离 | 10 / 14（51 / 74 子任务） | P0-11：2 / 6 | `release-guardrails.md` 记录 Compose 无统一容器上限、Kubernetes request/limit、notification `12Gi` emptyDir、Order 本地退出码 137 观察、危险场景共享资源风险和通用停止标准；明确声明预算不等于资源耗尽承诺。 | P0-ISSUE-003、P0-ISSUE-007 保持处理中；Kubernetes runtime 和专用资源使用量未核验。 | 编制运行前后 smoke、baseline、时间线、失败分类和残留资源检查。 |
| 2026-09-16 19:20 | P0-11-3：运行前后 smoke 与 baseline 操作指引 | 10 / 14（52 / 74 子任务） | P0-11：3 / 6 | `release-guardrails.md` 固化运行前 Catalog/revision、健康、warmup、观测、资源和停止窗口检查；运行后按 Worker/Runner 终态、Catalog recovery strategy、时间线、五类失败、观测/告警 limitation 和残留资源复核；明确 `MANUAL_CLEANUP` 与 `NON_RELEASING` 边界。 | 未执行新的 Fault Run、baseline capture 或手工数据处理；缺失事实继续记为 `UNKNOWN`/`INCOMPLETE`。 | 编制发布检查和 Web/Worker/schema 回退。 |
| 2026-09-16 19:20 | P0-11-4：发布检查与回退手册 | 10 / 14（53 / 74 子任务） | P0-11：4 / 6 | 文档覆盖默认关闭、关闭旁路、Web/Worker immutable revision 回退、active Fault Run 保留、schema 初始化失败隔离、已写 baseline 保留和回退 smoke；不删除 Fault Run、业务数据或历史摘要。 | 回退步骤仍需 P0-13/P0-14 在 live session、Worker graceful stop 和审计边界中验证；未宣称回退已在生产环境执行。 | 固化事件和低基数指标的脱敏与限长约定。 |
| 2026-09-16 19:20 | P0-11-5：事件和低基数指标约定 | 10 / 14（54 / 74 子任务） | P0-11：5 / 6 | `release-guardrails.md` 复用现有终态事件白名单、`schemaVersion/source/phase/status` 和 8 KiB UTF-8 限制；定义固定标签边界，禁止 run/lifecycle ID、traceId、Cookie、Authorization、密码、token、原始 SQL/shell、告警 envelope 和完整观测载荷。 | 未新增运行时指标或事件；这是发布/审计约定，真实落库和历史高频事件下线仍由 P0-12/P0-13 验证。 | 记录代码部署但关闭、测试旁路、单环境 pilot 和关闭回退 rollout。 |
| 2026-09-16 19:20 | P0-11-6：Rollout 路径与任务收尾 | 11 / 14（55 / 74 子任务） | P0-11：6 / 6 | `release-guardrails.md` 定义四阶段 rollout：代码部署但关闭、disposable 联调、测试环境单 Operator 旁路、单环境 pilot 与关闭回退；所有阶段保持消费者契约不变、不向目标服务传递控制面语义、不授予 Agent 写权限。无新增 P0-ISSUE-016。 | P0-ISSUE-003/004/007 的 runtime/resource/revision limitation 保留；P0-ISSUE-002 告警接收阻塞和 P0-ISSUE-001/009/011 runtime limitation 不变。 | 进入 P0-12：单元测试与 fixture 覆盖。 |
| 2026-09-16 19:34 | P0-12-1：Catalog canonicalization fixture | 11 / 14（56 / 74 子任务） | P0-12：1 / 6 | `fault-run-catalog-revision.test.ts` 直接读取 `listScenarioDefinitions()`；验证场景、参数和 options 重排保持 canonical serialization/revision，修改 `maxDurationSec` 会改变 SHA-256 revision。基线测试通过。 | 无新增问题；不复制 Catalog 定义。 | 覆盖 Report、Scenario Worker、Runner 三类 runtime summary 的折叠和缺失字段边界。 |
| 2026-09-16 19:34 | P0-12-2：Catalog 派生 runtime source matrix | 11 / 14（57 / 74 子任务） | P0-12：2 / 6 | `baseline-event-folding.test.ts` 新增直接遍历 `listScenarioDefinitions()` 的矩阵 fixture；为全部 12 个场景提供候选 Report/Scenario Worker/Runner 事件，验证折叠器选择、生命周期时间线、请求计数、业务恢复，以及 `NON_RELEASING`/`MANUAL_CLEANUP` 清理边界。测试通过。 | 无新增问题；fixture 不复制 Catalog 参数或目标事实。 | 覆盖 `TARGET`、`WORKER`、`MANUAL_CLEANUP`、`NON_RELEASING` 的终态/非终态完整性判断。 |
| 2026-09-16 19:34 | P0-12-3：Recovery/cleanup 与终态分支 fixture | 11 / 14（58 / 74 子任务） | P0-12：3 / 6 | `baseline-event-folding.test.ts` 新增按 Catalog recovery strategy 派生的 target/worker/manual/non-releasing fixture，覆盖 manual cleanup 缺失、完成、失败和 FAILED recovery；`baseline-capture.test.ts` 覆盖 CREATING、ACTIVE、RECOVERING 三类非终态拒绝。测试通过。 | 无新增问题；`NON_RELEASING` 的 cleanup timestamp 保持空值，避免把 recovery 完成误报为资源释放。 | 覆盖计数矛盾、缺失事件、未核验 dispatch、观测不可用、revision 失败和稳定错误 code。 |
| 2026-09-16 19:34 | P0-12-4：失败、缺失和未知事实 fixture | 11 / 14（59 / 74 子任务） | P0-12：4 / 6 | 新增 drained-without-stopped、worker failure code fallback 和 Catalog metadata/revision failure fixture；结合既有 counter inconsistency、CART `DISPATCH_UNVERIFIED`、pilot observation unknown、source run stable error coverage，确认失败/未知状态不会生成伪造成功。测试通过。 | 无新增问题；请求已发生但 worker 失败仍按事实记录 `OBSERVED`，不把失败请求伪造成成功请求。 | 覆盖 baseline/pilot JSON schema 的敏感字段、原始响应、可执行内容和超长 payload 拒绝路径。 |
| 2026-09-16 19:34 | P0-12-5：Baseline/Pilot 安全输入拒绝 fixture | 11 / 14（60 / 74 子任务） | P0-12：5 / 6 | `baseline-pilot.ts` 增加显式允许字段、嵌套未知字段拒绝、retention 敏感键/字符串校验和 8 KiB UTF-8 总体 payload 上限；`baseline-pilot.test.ts` 覆盖 raw response、Authorization/password、命令内容和超长 evidence 输入。pilot 与事件契约测试及 typecheck 通过。 | 无新增问题；P0-ISSUE-008 的历史高频事件仍不重写，新增输入边界只约束 baseline/pilot 写入口。 | 覆盖 source-run 幂等、pilot revision 冲突、摘要 retention 独立性和 Worker 低基数汇总。 |
| 2026-09-16 19:34 | P0-12-6：幂等、revision、retention 与低基数收尾 | 12 / 14（61 / 74 子任务） | P0-12：6 / 6 | 新增 `baseline-schema.test.ts`，验证 baseline/pilot DDL 不依赖 Fault Run/audit 外键级联，保留 source-run 唯一键和独立 retention snapshot；现有 capture/pilot/event fixture 分别覆盖 source-run 幂等、Catalog revision conflict 和 Worker/Runner 低基数 payload。P0-12 纯 fixture 套件共 24 项通过。 | P0-ISSUE-008/010/011 保持处理中：历史高频事件、真实 failure classification 和 Worker 事件落库仍需集成/runtime 证据；无新的独立问题。 | 进入 P0-13：集成、安全边界与回退测试。 |
| 2026-09-16 19:59 | P0-13-1：保留 volume 与 fresh schema 初始化 | 12 / 14（62 / 74 子任务） | P0-13：1 / 6 | `002-fault-run-baseline.sql` 与 `infra/mysql/init/06-fault-run-baseline.sql` 字节级一致；保留 MySQL volume 中执行 migration 前后 `fault_runs=24`、`fault_run_events=105`、baseline/pilot 均为 0，重复执行成功；临时 `p0_13_fresh` database 成功创建两张 baseline 表后清理。 | 无新增问题；未 reset、未删除既有数据卷、未创建 Fault Run 或写入 Warmup。 | 验证 baseline API 的 Operator session、CSRF、审计、错误 envelope、终态限制、幂等和安全输出。 |
| 2026-09-16 20:06 | P0-13-2：Operator session、CSRF、API 错误边界与安全输出 | 12 / 14（63 / 74 子任务） | P0-13：2 / 6 | 通过实际 Next middleware/API 验证：未认证 `/internal/baselines` 返回 401；错误凭据返回 401；登录成功取得 session/CSRF；缺失或错误 CSRF 返回 403；关闭时 baseline/pilot 写入口返回 404 `BASELINE_CAPTURE_DISABLED`；临时启用时不存在 source run 返回 404、`SELECTED` 无 baseline 返回 422 `PILOT_BASELINE_REQUIRED`、未知 `rawResponse` 字段返回 400；审计行从 43 增至 46，baseline/pilot 行仍为 0，响应不包含原始观测或凭据。 | 未创建 Fault Run、未发送 Gateway/业务请求。保留 volume 没有 CREATING/ACTIVE/RECOVERING 运行，故未用真实运行验证非终态正向拒绝；没有既有 baseline 可做真实成功幂等读回，相关状态/幂等逻辑由 P0-12 fixture 覆盖。Alertmanager/Kubernetes limitation 仍保持原状态。 | 继续验证默认关闭回退，同时核对既有 Fault Run/Worker/Gateway/业务接口不受旁路采集影响。 |
| 2026-09-16 20:28 | P0-13-3：默认关闭与既有业务路径回归 | 12 / 14（64 / 74 子任务） | P0-13：3 / 6 | 保持 `BASELINE_CAPTURE_ENABLED=false`，实际调用 Fault Run 列表、Runner status、baseline 查询以及 baseline/pilot 写入口；既有 Fault Run API、Runner status 和新入口行为正常。临时启动 `catalog-service`、`cart-service`、`gateway-service`（关闭可选代理）后，`/actuator/health` 返回 `{"status":"UP"}`，真实 `GET /api/products?size=1&page=0` 返回 200/业务 envelope；回归后 Fault Run/Event/baseline/pilot 行数仍为 `24/105/0/0`。临时业务容器已停止，MySQL/Redis volume 保留。 | 未启动独立 Worker 进程：其启动会立即执行 replenishment，并要求真实非空生命周期账号；为避免无批准的业务写入和请求，不用伪造账号替代。Worker 的 Operator status route 已返回 200，`workerOnline=false` 是本次显式关闭进程的真实状态；P0-ISSUE-007 的 Apple Silicon/amd64 资源 limitation 仍不作为性能证据。 | 继续做 Alertmanager limitation、观测失败边界和收尾静态验证。 |
| 2026-09-16 20:32 | P0-13-4：Alertmanager receipt limitation | 12 / 14（65 / 74 子任务） | P0-13：4 / 6 | Compose 与 Kubernetes 配置均有 3 个 `send_resolved: true` receiver；用 Alertmanager `amtool check-config` 验证 Compose 配置语法成功。当前控制面源码只有 webhook URL 常量，没有对应 `/internal/alertmanager/webhook` route；baseline 表中 verified alert summary 行数为 0。 | P0-ISSUE-002 继续保持“已阻塞”：未执行 firing/resolved receipt，不写 `ALERT_RECEIPT_VERIFIED`，不创建 pilot receipt，也不把 Agent 前置条件报告为满足。配置声明不等于投递事实，待后续实现 route、机器认证和投递/重复/resolved 集成测试。 | 继续验证 observation timeout、网络/认证失败和过期窗口的可见 limitation 边界。 |
| 2026-09-16 20:36 | P0-13-5：观测失败边界核验 | 12 / 14（65 / 74 子任务） | P0-13：4 / 6（该项阻塞） | 代码盘点确认没有独立 observation executor；观测配置只在 `env.ts` 做有界读取，capture 使用固定 `UNKNOWN` 检查、`OBSERVATION_UNAVAILABLE` limitation 和 `BASELINE_OBSERVATION_CHECK_RECORDED` 低基数事件。`baseline-capture.test.ts` 与 `baseline-pilot.test.ts` 共 7 项通过，确认未知观测不能满足 `SELECTED`，且 pilot 输入不接受 raw response、凭据、命令或超长内容。 | 新增 P0-ISSUE-016 并标记已阻塞：本次不能诚实声称 timeout、网络失败、认证失败和过期窗口已经逐类执行；不伪造查询结果、receipt 或审计现场。方案是实现受控 observation executor 后再补 runtime/fixture 验证。 | 保持所有 baseline observation/retention 为 UNKNOWN，继续 P0-13-6 静态收尾；P0-14 不得选择 pilot。 |
| 2026-09-16 20:42 | P0-13-6：TypeScript、测试、构建与部署静态收尾 | 12 / 14（66 / 74 子任务） | P0-13：5 / 6（P0-13-5 阻塞） | `cd traffic-control-plane && pnpm exec tsx --test ...` 聚焦套件 20 项通过；`pnpm lint --quiet` 通过；`pnpm build` 成功；build 完成后单独重跑 `pnpm typecheck` 通过；`docker compose config --quiet`、`kubectl kustomize k8s`、`./scripts/check-runtime-terminology.sh`、`git diff --check` 和 migration `cmp` parity 通过。并发先跑 typecheck 曾因 `.next/types` 尚未由 build 生成而失败，重排顺序后通过，未发现代码错误。 | P0-ISSUE-002、P0-ISSUE-003、P0-ISSUE-007、P0-ISSUE-009、P0-ISSUE-011、P0-ISSUE-016 仍按原状态；P0-13-5 未被静态检查结果掩盖。 | 只有在 observation executor/receipt/Kubernetes runtime 等阻塞项有真实证据后，才能完成 P0-13 并进入 P0-14；当前不得选择 pilot。 |
| 2026-09-17 10:48 | P0-13-5：observation executor 接口、状态归一化与审计边界 | 13 / 14（67 / 74 子任务） | P0-13：6 / 6 | 新增 `observation-executor.ts`，以固定 Prometheus/Loki/Tempo/retention reference 建立 adapter interface；校验 invalid/future/expired window，统一 timeout/network/authentication 状态，默认无 adapter 保持 `UNKNOWN`。capture 现在使用 run-scoped window 保存 observation summary，并通过 `BASELINE_OBSERVATION_CHECK_RECORDED` 仅记录状态、窗口和 limitation，不保存 query/response/credentials。`observation-executor.test.ts`、`baseline-capture.test.ts`、event contract fixture 通过。 | P0-ISSUE-016 更新为“已解决（接口/状态/审计边界，真实适配器待实现）”；没有执行 Prometheus/Loki/Tempo runtime query，也未启动 Worker 或 Fault Run。 | 后续可在单独获批任务中实现真实 adapter；本阶段保持 default `UNKNOWN` 和零个 `SELECTED`。 |
| 2026-09-17 10:48 | P0-13-4：Alertmanager route、机器认证与 receipt 边界 | 13 / 14（67 / 74 子任务） | P0-13：6 / 6 | 新增精确 `/internal/alertmanager/webhook` route，以 `CASTREL_INTERNAL_SERVICE_KEY` 支持 Bearer 和 `X-Internal-Service-Key`，限制 payload/labels/timestamps，解析 firing/resolved 并写入低基数 `alert_receipts`，重复投递使用确定性 key；migration/init SQL parity 通过。`alert-receipt.test.ts` 覆盖 auth、malformed/oversized、firing/resolved、timestamp 和 raw-field 丢弃；配置使用 credentials file，`amtool check-config` 成功。 | P0-ISSUE-002 更新为“已解决（代码/静态，投递运行待核验）”；未发送真实 Alertmanager webhook，不生成 `ALERT_RECEIPT_VERIFIED`，不把配置声明当作 receipt。 | 后续在获批 disposable/专用环境执行 firing/resolved/duplicate delivery 和数据库落库核验。 |
| 2026-09-17 10:48 | P0-13-1/6：retention、release revision 与 Order JVM 配置修复 | 13 / 14（67 / 74 子任务） | P0-13：6 / 6 | Prometheus Compose/Kubernetes retention 统一为 `168h`；Kubernetes Loki 新增 ConfigMap、完整 retention 配置和 `/etc/loki/local-config.yaml` 挂载，保留 `emptyDir`；Compose/Kubernetes release revision 默认设为 `1.4.0`；Compose 增加 `ORDER_JAVA_XMS/XMX` 覆盖项，Java entrypoint 合并显式 `JAVA_OPTS` 与共享 `JAVA_TOOL_OPTIONS`。`docker compose config --quiet`、`kubectl kustomize k8s`、`git diff --check` 通过。 | P0-ISSUE-003、P0-ISSUE-004、P0-ISSUE-007 更新为配置/代码完成，但 Kubernetes runtime、immutable image digest 和资源性能基线仍未核验。 | 保持 `emptyDir` 和 default-off；后续由专用环境核验 runtime retention、release metadata 和资源行为。 |
| 2026-09-17 10:48 | P0-13-6：确认代码实现范围与 Phase 0 暂停点 | 13 / 14（67 / 74 子任务） | P0-13：6 / 6 | Alert receipt、observation executor、CART dispatch/Worker lifecycle、release/JVM/retention 配置的聚焦测试：16 项通过；`pnpm typecheck`、`pnpm lint`、`pnpm build`、Compose/Kustomize、Alertmanager `amtool check-config`、migration parity 和 diff check 均通过。全量运行限制保持：未启动 real Worker、Data Warmup、Catalog Fault Run、Alertmanager 投递或 Kubernetes runtime。 | P0-ISSUE-006、009、010、011 仍为真实运行待核验；P0-ISSUE-008 历史高频事件仍处理中。没有把纯测试或静态配置升级为现场证据。 | P0-14 等待用户明确批准真实环境执行；当前不选择 pilot，不修改业务数据或启动后台写入。 |
| 2026-09-17 11:16 | P0-13 文档一致性同步 | 13 / 14（67 / 74 子任务） | P0-13：6 / 6 | 按已完成的代码/配置边界同步 batch-0 产品/技术设计、Catalog/pilot/observability 证据台账，以及 batch-1/3/4/5.0 和阶段 5 的前置说明：明确 CART dispatch、Alertmanager route/receipt、`168h` retention 和 observation executor 已具备代码/静态边界，但真实运行证据仍未生成。`git diff --check` 通过。 | 没有改变任务完成数，也没有把文档同步误记为 runtime evidence；P0-ISSUE-001、002、003、016 仍分别保留运行/适配器 limitation。 | P0-14 继续等待用户批准真实 Worker、Catalog Fault Run、Data Warmup、Alertmanager 投递和 Kubernetes runtime 核验。 |
| 2026-09-17 11:32 | P0-13 follow-up：退役高频事件与事件写入护栏 | 13 / 14（67 / 74 子任务） | P0-13：6 / 6 | `ReportScenarioWorker` 不再写 `REPORT_REQUEST`/`REPORT_REQUEST_FAILED`，`ControlledScenarioWorker` 不再按失败写 `SCENARIO_REQUEST_FAILED`；两类 Worker 仅保留 started/stopped/drained 低基数汇总。新增 `fault-run-event-policy.ts`：动态 event type、不可序列化 payload、超过 8 KiB UTF-8 的当前写入和退役高频事件均显式拒绝；兼容折叠仍读取历史事件。新增策略与 Worker 测试覆盖通过静态验证。 | P0-ISSUE-008 更新为“已解决（新写入路径；历史 schema/运行数据 limitation 保留）”；P0-ISSUE-010/011 更新为代码/fixture 已解决，但真实分类和事件落库仍待授权运行。未重写历史事件，未启动 Worker、Fault Run 或 Data Warmup。 | 保持 P0-14 未开始、`BASELINE_CAPTURE_ENABLED=false` 和零个 `SELECTED`；后续只在获得运行授权后补现场证据。 |
| 2026-09-17 13:04 | P0-13 follow-up 验证完成 | 13 / 14（67 / 74 子任务） | P0-13：6 / 6 | 事件策略、事件合同、Worker、baseline folding 聚焦测试 20 / 20 通过；`pnpm test:runner` 73 / 73 通过；`pnpm typecheck`、`pnpm lint`、`pnpm test:i18n` 和 `git diff --check` 通过。CART 缺失 runtime dispatch 的回归断言已恢复为 `DISPATCH_UNVERIFIED`，不改变真实运行边界。 | 代码/fixture 和文档一致性已完成；仍未执行真实 Worker、Catalog Fault Run、Data Warmup、Alertmanager 投递或 Kubernetes runtime，因此 P0-14 以及相关现场证据保持未开始/待核验。 | 保持 `BASELINE_CAPTURE_ENABLED=false`、零个 `SELECTED` 和历史事件只读兼容策略；只有获得明确运行授权后才补现场证据。 |
| 2026-09-17 13:09 | P0-13 follow-up 构建验证 | 13 / 14（67 / 74 子任务） | P0-13：6 / 6 | `pnpm build` 成功，Next.js route/module 校验通过；事件策略新模块和 repository 写入口已进入生产构建。 | 构建成功不增加 runtime evidence；真实 Worker、Catalog Fault Run、Data Warmup、Alertmanager 投递和 Kubernetes runtime 仍未执行。 | 继续保持 P0-14 未开始、`BASELINE_CAPTURE_ENABLED=false` 和零个 `SELECTED`。 |
| 2026-09-17 16:28 | P0-14-1/2：远端 Compose 场景与 baseline 验收 | 14 / 14（69 / 74 子任务） | P0-14：2 / 7 | 在远端 Compose 完成 12 个 Catalog 场景的真实 Fault Run，并对修订后的 Redis 合同追加重跑；共形成 13 个本轮运行集合，核对终态事件、recovery/cleanup、audit、baseline 和 warmup metadata。数据库总体为 15 条 `COMPLETE_WITH_LIMITATIONS`、4 条 `INCOMPLETE`；其中数据库按 revision 为旧 revision 18 条、新 revision 1 条，本轮运行集合实际使用 12 条旧 revision 与 1 条新 revision。 | P0-ISSUE-001、009、010、011 更新为 Compose runtime 已核验但保留各自 limitation；慢 SQL、CART failure code、Runner drain 时序和无真实 observation adapter 不被伪造为 complete。 | 完成 Kubernetes/runtime limitation、Pilot review、安全扫描和 default-off 回退 smoke。 |
| 2026-09-17 16:28 | P0-14-3：Kubernetes runtime 核验 | 14 / 14（69 / 74 子任务） | P0-14：3 / 7（阻塞） | `kubectl kustomize k8s` 通过；当前无获批 Kubernetes namespace、owner 和运行窗口，未执行部署、查询或 teardown，因此不把 Compose 观测事实复制为 Kubernetes runtime 事实。 | P0-ISSUE-003 保留为 Kubernetes runtime limitation；没有足够环境信息时不执行破坏性部署。 | 等待专用 namespace/owner/window 后补 retention、查询和告警 runtime 核验。 |
| 2026-09-17 16:28 | P0-14-4/5：Pilot review 与安全输出扫描 | 14 / 14（71 / 74 子任务） | P0-14：5 / 7 | 通过 Operator API 为 12 个场景写入当前 revision `a9f117...` 的 `REJECTED` review，`SELECTED=0`；选定运行集合的敏感关键词扫描为 0 命中，未发现 secret、Authorization、Cookie、password、SQL、shell、docker 或 kubectl 内容。 | 无合格 pilot 是正确结果：真实观测窗口/adapter、Kubernetes runtime 和部分资源边界仍不满足 eligibility；不把 receipt route 可用等同于场景告警 firing。 | 执行 default-off rollback smoke，并保留 0 selected。 |
| 2026-09-17 16:28 | P0-14-6/7：回退与阶段退出收尾 | 14 / 14（73 / 74 子任务） | P0-14：7 / 7（6 完成，1 阻塞） | `BASELINE_CAPTURE_ENABLED=false` 下既有 run/baseline 可读，baseline 写入返回 404，Gateway/Runner/Alertmanager route 仍返回成功；Data Warmup 维持 `180×300000=54M`、两表满目标并持有 lease。远端镜像从干净 `a2df629` 重建，源码工作区恢复 clean。 | P0-ISSUE-017 已解决；P0-ISSUE-016 真实 adapter 未实现、P0-ISSUE-003 Kubernetes runtime 未核验，因此 Phase 0 为“有 limitation 完成”，不进入 Batch 1。 | 提供 Kubernetes runtime 与真实观测 adapter 后，基于当前 revision 重新评审 pilot。 |
| 2026-09-17 16:45 | P0-14 文档证据同步与一致性收尾 | 14 / 14（73 / 74 子任务） | P0-14：7 / 7（6 完成，1 阻塞） | 将远端 Compose 的 release revision、源码/镜像 digest、Alertmanager 首次/重复 receipt、default-off rollback 和当前 Catalog revision 追加到 `observability-verification.md`；将 release guardrail 的当前 revision、历史 revision 边界和 P0-14 运行集合链接同步；修正 task list 中数据库历史 baseline 与本轮 13 个运行集合的表述。`git diff --check` 通过。 | 不改变现场结论：真实 Prometheus/Loki/Tempo adapter 和 Kubernetes runtime 仍为 limitation；`SELECTED=0` 保持。 | 等待 Kubernetes namespace/owner/window 或真实 observation adapter 实现后再继续 Phase 0。 |

## Phase 0 退出标准

阶段退出时必须同时满足以下事实：

- Catalog 派生覆盖矩阵中的每个条目都有可复查 baseline，或有明确的 `INCOMPLETE`/limitation、残留资源和回退方案；没有未解释的伪造成功。
- 五类失败分类、关键时间线、恢复策略边界、Operator audit 和低基数事件均可追溯。
- baseline schema 在 fresh install 与已有数据卷上可用，默认关闭和回退不影响既有 Fault Run 或业务路径。
- 观测 retention、查询可用性、Alertmanager 接收边界和 `send_resolved` 都以实际核验结果记录；未实现能力明确标为 limitation。
- 至多一个 pilot 被选中，且其真实告警、证据窗口、只读观测入口和实际 remediation 边界都已核验；无合格候选时有明确阻塞记录和方案。
- 完成 Compose 实际运行与 Kubernetes 配置/环境核验，保留执行证据、问题状态、发布检查与回退结果。
