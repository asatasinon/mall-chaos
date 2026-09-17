# 批次 0 Catalog 覆盖矩阵

## 生成信息

| 项目 | 内容 |
| --- | --- |
| 生成时间 | 2026-09-16 16:12 CST（本次实现验证） |
| Catalog 来源 | `traffic-control-plane/src/lib/fault-run-catalog.ts` 的 `listScenarioDefinitions()` |
| Catalog revision | `000ccc36e4a77ef27d22636bdbc4643ff79ddb0c205b21830967bc40b7abd7dc` |
| 场景数量 | 12 |
| revision 算法 | 取每个 Catalog definition 的稳定字段，按 `scenario` 排序；对象键、参数、参数 options 均按字典序稳定序列化；对 canonical JSON 做 SHA-256 |
| dispatch 核验方式 | 代码静态核验；P0-14 仍需在 disposable Compose 和 Kubernetes/专用环境执行真实运行确认 |
| 记录用途 | 带 revision 的执行证据，不是第二份 Catalog；场景事实、参数和 recovery strategy 始终以 Catalog 为准 |
| 后续代码修订 | 2026-09-17：P0-13 已补齐 CART dispatch、Worker lifecycle/drain 代码路径；本矩阵的运行证据仍保持原快照，不把代码路径升级为实际请求或终态事件 |

## 覆盖结果

| Scenario | Target service | Target operation | Max duration | Recovery strategy | Manual cleanup | Dispatch / traffic owner | Terminal summary evidence | Static status |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | `catalog-service` | `products-browse-report` | 3600s | `WORKER` | 否 | `ReportScenarioWorker` | `REPORT_WORKER_STARTED` / `REPORT_REQUEST` / `REPORT_REQUEST_FAILED` / `REPORT_WORKER_STOPPED` | 已核验 |
| `BROWSE_SURGE` | `catalog-service` | `browse-api-worker` | 1800s | `WORKER` | 否 | `TrafficSurgeExecutor` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_REQUEST_FAILED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED` | 代码已补齐，运行待核验 |
| `CART_CATALOG_DEPENDENCY` | `catalog-service` | `cart-product-validation` | 900s | `TARGET` | 否 | `ScenarioWorkers` customer session + Gateway products/cart dispatch；Gateway target map 和目标服务 endpoint 存在 | `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_TARGET` / `SCENARIO_REQUEST_FAILED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED` | 代码已补齐，运行待核验（无运行事件时 `DISPATCH_UNVERIFIED`） |
| `CATALOG_REDIS_LARGE_VALUE` | `catalog-service` | `product-detail-cache` | 1800s | `TARGET` | 是 | `ScenarioWorkers` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_TARGET` / `SCENARIO_REQUEST_FAILED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED` | 已核验 |
| `INVENTORY_ROW_LOCK` | `inventory-service` | `inventory-reservation-summary` | 1800s | `TARGET` | 否 | `ScenarioWorkers` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_REQUEST_FAILED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED` | 已核验 |
| `INVENTORY_TABLE_EXCLUSIVE` | `inventory-service` | `inventory-availability-report` | 1800s | `TARGET` | 否 | `ScenarioWorkers` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_REQUEST_FAILED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED` | 已核验 |
| `NOTIFICATION_HEAP_PRESSURE` | `notification-service` | `notification-retention` | 3600s | `NON_RELEASING` | 否 | `RunnerEngine` + `TrafficActionOrchestrator` | `RUNNER_LIFECYCLE_SUMMARY`；失败时可转 `SERVICE_UNAVAILABLE` | 已核验 |
| `NOTIFICATION_STORAGE_APPEND` | `notification-service` | `notification-storage` | 3600s | `MANUAL_CLEANUP` | 是 | `RunnerEngine` + `TrafficActionOrchestrator` | `RUNNER_LIFECYCLE_SUMMARY`；存储 append 完成状态由 lifecycle result 标记 | 已核验 |
| `ORDER_QUERY_SURGE` | `order-service` | `order-query-worker` | 1800s | `WORKER` | 否 | `TrafficSurgeExecutor` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_REQUEST_FAILED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED` | 代码已补齐，运行待核验 |
| `ORDER_REPORT_SQL` | `order-service` | `orders-query-report` | 3600s | `WORKER` | 否 | `ReportScenarioWorker` | `REPORT_WORKER_STARTED` / `REPORT_REQUEST` / `REPORT_REQUEST_FAILED` / `REPORT_WORKER_STOPPED` | 已核验 |
| `PROMOTION_LOCK_CONTENTION` | `promotion-service` | `coupon-reservation-consistency` | 1800s | `TARGET` | 否 | `ScenarioWorkers` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_REQUEST_FAILED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED` | 已核验 |
| `PSP_PROVIDER_OUTCOME` | `psp-simulator` | `provider-outcome` | 1800s | `TARGET` | 否 | `RunnerEngine` + `TrafficActionOrchestrator` | `RUNNER_LIFECYCLE_SUMMARY` | 已核验 |

## 核验结论

- 当前 Catalog 共 12 个条目；P0-13 代码修订后，静态代码核验确认 12 个条目存在控制面 Worker/Runner dispatch 或对应 lifecycle owner，但真实终态事件仍需运行核验。
- `CART_CATALOG_DEPENDENCY` 的 Gateway target map、Catalog target controller、runbook 和 Scenario Worker dispatch 均存在；该条目仍不能生成伪造请求统计、完整 baseline 或 pilot 选择。
- `BROWSE_SURGE` 和 `ORDER_QUERY_SURGE` 的 surge Worker 已补齐 `SCENARIO_WORKER_DRAINED` 代码路径；没有实际落库的终态 drain 事实时，baseline 必须保留 `MISSING_RUNTIME_EVENT`/`INCOMPLETE`。
- `BROWSE_SURGE` 和 `ORDER_QUERY_SURGE` 不经过 Gateway operation prepare/release，而由控制面 Worker 直接拥有受控流量生命周期；其 target operation 是 Catalog 中的稳定业务语义，不能据此推断 Gateway target map 缺失。
- “已核验”只表示代码路径存在，不表示目标效果、恢复、观测或告警一定在运行时发生；实际运行事实由后续 baseline capture 和 P0-14 环境验收记录。

## P0-02-2 运行证据核验

本次只读核验未执行新的 Catalog Fault Run。当前 MySQL 按 `scenario/state/event_type` 聚合的结果为：`BROWSE_REPORT_SQL` 有 12 条历史 `FAILED` 记录但没有 `REPORT_WORKER_*`；`CATALOG_REDIS_LARGE_VALUE` 有 8 条 `TARGET_CONFIRMED` 后进入 `RECOVERED/STOPPED` 的记录，但只出现旧 `EXERCISE_WORKER_STARTED/STOPPED`；`NOTIFICATION_STORAGE_APPEND` 有 2 条 `FAILED` 记录；`PSP_PROVIDER_OUTCOME` 有 1 条 `FAILED` 记录；其余 8 个条目没有当前库记录。当前库没有 `REPORT_WORKER_STOPPED`、`SCENARIO_WORKER_STOPPED`、`SCENARIO_WORKER_DRAINED` 或 `RUNNER_LIFECYCLE_SUMMARY`。

因此，本矩阵的 `已核验` 仍只表示静态 dispatch 路径存在，不能升级为运行时 complete；当前真实受控请求、终态统计和效果证据均需保留为 `UNKNOWN`/`INCOMPLETE`，由 P0-14 在获批环境中按当前 `catalogRevision` 运行后补齐。`CART_CATALOG_DEPENDENCY` 在没有运行时 Worker 事件时仍由折叠器标记 `DISPATCH_UNVERIFIED`。

## 代码证据

| 事实 | 代码来源 |
| --- | --- |
| Catalog definitions 和 `listScenarioDefinitions()` | `traffic-control-plane/src/lib/fault-run-catalog.ts` |
| 通用 target prepare/release 和 surge worker 特例 | `traffic-control-plane/src/lib/fault-run-coordinator.ts`、`traffic-control-plane/src/lib/fault-run-targets.ts` |
| 报表 Worker 和报告汇总事件 | `traffic-control-plane/src/worker/report-scenario-worker.ts` |
| Browse/order surge Worker | `traffic-control-plane/src/worker/traffic-surge-executor.ts` |
| Redis/cache、promotion、inventory Worker | `traffic-control-plane/src/worker/scenario-workers.ts`、`controlled-scenario-worker.ts` |
| Notification、storage、PSP lifecycle | `traffic-control-plane/src/worker/runner-engine.ts`、`traffic-action-orchestrator.ts` |
| Gateway operation target map | `gateway-service/src/main/java/com/castrel/chaos/gateway/controller/OperationDispatchController.java` |
| Worker 启动与调度入口 | `traffic-control-plane/src/worker/index.ts` |
