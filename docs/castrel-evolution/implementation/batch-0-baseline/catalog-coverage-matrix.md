# 批次 0 Catalog 覆盖矩阵

## 生成信息

| 项目 | 内容 |
| --- | --- |
| 生成时间 | 2026-09-16 16:12 CST（本次实现验证） |
| Catalog 来源 | `traffic-control-plane/src/lib/fault-run-catalog.ts` 的 `listScenarioDefinitions()` |
| 历史 Catalog revision | `000ccc36e4a77ef27d22636bdbc4643ff79ddb0c205b21830967bc40b7abd7dc` |
| 当前运行窗口 Catalog revision | `a9f117905993ed8898c0276c5c40267c4a434fc89b6254be8cb1725a7f15702b`（Redis `memberSizeBytes` 最小值由 256B 收紧为 1024B 后生成） |
| 场景数量 | 12 |
| revision 算法 | 取每个 Catalog definition 的稳定字段，按 `scenario` 排序；对象键、参数、参数 options 均按字典序稳定序列化；对 canonical JSON 做 SHA-256 |
| dispatch 核验方式 | 历史表格保留静态核验；P0-14 远端 Compose 运行证据见文末，Kubernetes runtime/专用环境仍未执行 |
| 记录用途 | 带 revision 的执行证据，不是第二份 Catalog；场景事实、参数和 recovery strategy 始终以 Catalog 为准 |
| 后续代码修订 | 2026-09-17：P0-13 已补齐 CART dispatch、Worker lifecycle/drain 代码路径；P0-14 追加远端 Compose 运行证据，不覆盖历史静态快照 |

## 覆盖结果

| Scenario | Target service | Target operation | Max duration | Recovery strategy | Manual cleanup | Dispatch / traffic owner | Terminal summary evidence | Static status |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | `catalog-service` | `products-browse-report` | 3600s | `WORKER` | 否 | `ReportScenarioWorker` | `REPORT_WORKER_STARTED` / `REPORT_WORKER_STOPPED`（历史兼容 `REPORT_REQUEST*`） | 已核验 |
| `BROWSE_SURGE` | `catalog-service` | `browse-api-worker` | 1800s | `WORKER` | 否 | `TrafficSurgeExecutor` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED`（历史兼容 `SCENARIO_REQUEST_FAILED`） | 代码已补齐，运行待核验 |
| `CART_CATALOG_DEPENDENCY` | `catalog-service` | `cart-product-validation` | 900s | `TARGET` | 否 | `ScenarioWorkers` customer session + Gateway products/cart dispatch；Gateway target map 和目标服务 endpoint 存在 | `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_TARGET` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED`（历史兼容 `SCENARIO_REQUEST_FAILED`） | 代码已补齐，运行待核验（无运行事件时 `DISPATCH_UNVERIFIED`） |
| `CATALOG_REDIS_LARGE_VALUE` | `catalog-service` | `product-detail-cache` | 1800s | `TARGET` | 是 | `ScenarioWorkers` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_TARGET` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED`（历史兼容 `SCENARIO_REQUEST_FAILED`） | 已核验 |
| `INVENTORY_ROW_LOCK` | `inventory-service` | `inventory-reservation-summary` | 1800s | `TARGET` | 否 | `ScenarioWorkers` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED`（历史兼容 `SCENARIO_REQUEST_FAILED`） | 已核验 |
| `INVENTORY_TABLE_EXCLUSIVE` | `inventory-service` | `inventory-availability-report` | 1800s | `TARGET` | 否 | `ScenarioWorkers` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED`（历史兼容 `SCENARIO_REQUEST_FAILED`） | 已核验 |
| `NOTIFICATION_HEAP_PRESSURE` | `notification-service` | `notification-retention` | 3600s | `NON_RELEASING` | 否 | `RunnerEngine` + `TrafficActionOrchestrator` | `RUNNER_LIFECYCLE_SUMMARY`；失败时可转 `SERVICE_UNAVAILABLE` | 已核验 |
| `NOTIFICATION_STORAGE_APPEND` | `notification-service` | `notification-storage` | 3600s | `MANUAL_CLEANUP` | 是 | `RunnerEngine` + `TrafficActionOrchestrator` | `RUNNER_LIFECYCLE_SUMMARY`；存储 append 完成状态由 lifecycle result 标记 | 已核验 |
| `ORDER_QUERY_SURGE` | `order-service` | `order-query-worker` | 1800s | `WORKER` | 否 | `TrafficSurgeExecutor` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED`（历史兼容 `SCENARIO_REQUEST_FAILED`） | 代码已补齐，运行待核验 |
| `ORDER_REPORT_SQL` | `order-service` | `orders-query-report` | 3600s | `WORKER` | 否 | `ReportScenarioWorker` | `REPORT_WORKER_STARTED` / `REPORT_WORKER_STOPPED`（历史兼容 `REPORT_REQUEST*`） | 已核验 |
| `PROMOTION_LOCK_CONTENTION` | `promotion-service` | `coupon-reservation-consistency` | 1800s | `TARGET` | 否 | `ScenarioWorkers` + `ControlledScenarioWorker` | `SCENARIO_WORKER_STARTED` / `SCENARIO_WORKER_STOPPED` / `SCENARIO_WORKER_DRAINED`（历史兼容 `SCENARIO_REQUEST_FAILED`） | 已核验 |
| `PSP_PROVIDER_OUTCOME` | `psp-simulator` | `provider-outcome` | 1800s | `TARGET` | 否 | `RunnerEngine` + `TrafficActionOrchestrator` | `RUNNER_LIFECYCLE_SUMMARY` | 已核验 |

## 核验结论

- 当前 Catalog 共 12 个条目；P0-13 代码修订后，静态代码核验确认 12 个条目存在控制面 Worker/Runner dispatch 或对应 lifecycle owner，但真实终态事件仍需运行核验。
- `CART_CATALOG_DEPENDENCY` 的 Gateway target map、Catalog target controller、runbook 和 Scenario Worker dispatch 均存在；该条目仍不能生成伪造请求统计、完整 baseline 或 pilot 选择。
- `BROWSE_SURGE` 和 `ORDER_QUERY_SURGE` 的 surge Worker 已补齐 `SCENARIO_WORKER_DRAINED` 代码路径；没有实际落库的终态 drain 事实时，baseline 必须保留 `MISSING_RUNTIME_EVENT`/`INCOMPLETE`。
- `BROWSE_SURGE` 和 `ORDER_QUERY_SURGE` 不经过 Gateway operation prepare/release，而由控制面 Worker 直接拥有受控流量生命周期；其 target operation 是 Catalog 中的稳定业务语义，不能据此推断 Gateway target map 缺失。
- “已核验”只表示代码路径存在，不表示目标效果、恢复、观测或告警一定在运行时发生；实际运行事实由后续 baseline capture 和 P0-14 环境验收记录。

## P0-02-2 历史运行证据核验（截至 2026-09-16）

本节只读核验未执行新的 Catalog Fault Run，保留为 P0-14 之前的历史快照。此前 MySQL 按 `scenario/state/event_type` 聚合的结果为：`BROWSE_REPORT_SQL` 有 12 条历史 `FAILED` 记录但没有 `REPORT_WORKER_*`；`CATALOG_REDIS_LARGE_VALUE` 有 8 条 `TARGET_CONFIRMED` 后进入 `RECOVERED/STOPPED` 的记录，但只出现旧 `EXERCISE_WORKER_STARTED/STOPPED`；`NOTIFICATION_STORAGE_APPEND` 有 2 条 `FAILED` 记录；`PSP_PROVIDER_OUTCOME` 有 1 条 `FAILED` 记录；其余 8 个条目没有当前库记录。当前库没有 `REPORT_WORKER_STOPPED`、`SCENARIO_WORKER_STOPPED`、`SCENARIO_WORKER_DRAINED` 或 `RUNNER_LIFECYCLE_SUMMARY`。

因此，本历史小节的 `已核验` 仍只表示静态 dispatch 路径存在；P0-14 的实际运行事实不覆盖本段，而记录在下方运行窗口中。`CART_CATALOG_DEPENDENCY` 在本历史快照没有运行时 Worker 事件时仍由折叠器标记 `DISPATCH_UNVERIFIED`。

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

## P0-14 远端 Compose 运行证据（2026-09-17）

本节是当前运行窗口的补充证据，不改变上方 Catalog 派生定义，也不把运行结果写回 Catalog。远端源码 `HEAD=a2df62984548625e10588e5de9948e71c4059ea2`，控制面/Catalog/Worker 从干净提交重建；`BASELINE_CAPTURE_ENABLED=false`、`DATA_WARMUP_ENABLED=true`、release `1.4.0`、deployment mode `compose`。每个条目均为 `RECOVERED`，但 baseline 仍按真实观测、资源和 cleanup 事实保留 limitation。

| Scenario | Run ID | Catalog revision | Runtime summary | Recovery/cleanup | Baseline |
| --- | --- | --- | --- | --- | --- |
| `BROWSE_REPORT_SQL` | `a1f064ac-cd31-4a35-b198-09c4d412337b` | `000ccc...` | 约 60 秒；1 request / 0 success / 1 failure；`REPORT_WORKER_*` | Worker recovery；无手工 cleanup | `COMPLETE_WITH_LIMITATIONS` |
| `ORDER_REPORT_SQL` | `14450128-9a3c-467e-ac6a-05aadf69774f` | `000ccc...` | 约 60 秒；1 request / 0 success / 1 failure；`REPORT_WORKER_*` | Worker recovery；无手工 cleanup | `COMPLETE_WITH_LIMITATIONS` |
| `BROWSE_SURGE` | `7fffdf75-b6a3-4983-8ab7-ebf61b07fdd9` | `000ccc...` | 110/110 success；started/stopped/drained | Worker recovery | `COMPLETE_WITH_LIMITATIONS` |
| `ORDER_QUERY_SURGE` | `0fcb640c-5655-4373-9bc6-ff694bf3f9c1` | `000ccc...` | 80/80 success；started/stopped/drained | Worker recovery | `COMPLETE_WITH_LIMITATIONS` |
| `CATALOG_REDIS_LARGE_VALUE` | `6b8e8d21-f9e8-4f9a-98df-9986f1922d68` | `000ccc...` | 1024B；92/92 cache hit | Target recovery；cleanup HTTP 200 | `COMPLETE_WITH_LIMITATIONS` |
| `CATALOG_REDIS_LARGE_VALUE`（合同修订重跑） | `d4bfa872-c48b-44c1-b425-1df59df5765f` | `a9f117...` | 1024B；Worker target/stopped/drained | Target recovery；cleanup HTTP 200 | `COMPLETE_WITH_LIMITATIONS` |
| `CART_CATALOG_DEPENDENCY` | `0ac60702-0c11-4c62-849b-861f3af733bf` | `000ccc...` | 91 request / 0 success / 91 failure；Worker drain | Target recovery；无手工 cleanup | `COMPLETE_WITH_LIMITATIONS` |
| `NOTIFICATION_STORAGE_APPEND` | `09a819ba-d1df-4bec-a9f7-018e786bcd0d` | `000ccc...` | Runner lifecycle summary；append 结果可见 | Manual cleanup HTTP 200 | `COMPLETE_WITH_LIMITATIONS` |
| `PROMOTION_LOCK_CONTENTION` | `19c75f1c-4c83-43e0-9b8a-a92527046ee4` | `000ccc...` | 160 request / 0 success；Worker drain | Target recovery | `COMPLETE_WITH_LIMITATIONS` |
| `INVENTORY_TABLE_EXCLUSIVE` | `5c4b5858-2ea1-4dd9-a8a2-4233c129dfd5` | `000ccc...` | 1 request；约 10.9 秒延迟；Worker drain | Target recovery | `COMPLETE_WITH_LIMITATIONS` |
| `INVENTORY_ROW_LOCK` | `c647bf0b-8995-493a-a9e1-b7327c9f3735` | `000ccc...` | 4 request / 2 success / 2 failure；延迟分布 | Target recovery | `COMPLETE_WITH_LIMITATIONS` |
| `PSP_PROVIDER_OUTCOME` | `5707b05d-774e-43ba-9fd0-3a112cf46aae` | `000ccc...` | Runner lifecycle summary；`TARGET_EFFECT_FAILURE` | Target recovery | `COMPLETE_WITH_LIMITATIONS` |
| `NOTIFICATION_HEAP_PRESSURE` | `4bb51b52-3879-473b-b09d-e1fe7dd1bc06` | `000ccc...` | 3 个 Runner summary；保留效果 | `NON_RELEASING`；cleanup `NOT_REQUIRED` | `COMPLETE_WITH_LIMITATIONS` |

说明：表中 `000ccc...` 为完整历史 revision `000ccc36e4a77ef27d22636bdbc4643ff79ddb0c205b21830967bc40b7abd7dc` 的缩写，`a9f117...` 为完整当前 revision `a9f117905993ed8898c0276c5c40267c4a434fc89b6254be8cb1725a7f15702b` 的缩写。数据库总计为 15 条 `COMPLETE_WITH_LIMITATIONS`、4 条 `INCOMPLETE`；本表对应 13 个本轮运行集合，不把其他历史 baseline 混入运行结果。Prometheus/Loki/Tempo 的真实场景 adapter 尚未实现，故所有 baseline 的 observation limitation 必须保留；Kubernetes runtime 不从 Compose 借用。
