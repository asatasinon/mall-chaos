# Castrel Chaos — 存储突增场景设计

**状态**：Draft / 待审批  
**版本**：v0.1.0  
**日期**：2026-08-08  
**关联任务**：[Task 23：存储突增场景](../tasks/task-23-storage-growth.md)

## 1. 设计目标

新增一个可控、可观测、可回收的存储突增演练场景，用于模拟以下故障表现：

1. MySQL 数据目录持续增长，观察数据库写入、磁盘空间、IO、连接池和业务延迟变化。
2. 指定业务服务容器的可写文件系统持续增长，观察容器/挂载卷/节点磁盘水位变化。
3. 在达到容量、速率、持续时间或剩余空间保护线时自动停止。
4. 停止和清理操作只作用于本场景创建的数据，不影响业务数据和其他演练。

本设计不把“存储突增”实现为 JVM 内存泄漏，也不复用现有的大表预热任务。大表预热用于制造慢 SQL 数据规模，存储突增用于直接观察持久化存储水位变化，两者生命周期必须独立。

## 2. 背景与现状

当前系统已经具备：

- traffic-control-plane worker 和 MySQL 连接池；
- gateway 到业务服务的统一分发和服务白名单；
- common 模块自动装配的统一控制端点；
- 业务服务已有 `/service-data` 可写目录；
- Prometheus、Node Exporter、MySQL Exporter、Loki 和 Grafana 观测链路。

当前缺口是没有一个专门的持久化写入器：

- `DataWarmupService` 是启动后持续填充两张大表的长期任务，不能随意停止和按 run 清理；
- 现有 memory leak 只增长 JVM 堆，不反映数据盘增长；
- 直接写任意文件路径会造成误删业务文件或写满错误磁盘的风险。

因此，本场景采用“专用 MySQL 表 + 固定目录文件写入”的双通道设计。

## 3. 设计原则

### 3.1 隔离

MySQL 只写 `storage_growth_records` 专用表；文件只写固定根目录下的 `<runId>` 子目录。禁止修改订单、支付、库存、行为日志和价格历史等业务数据。

### 3.2 可逆

`disable` 只停止写入，不删除数据；`cleanup` 独立负责删除当前 run 的数据。所有操作幂等，服务重启后残留 run 不能阻止新 run 运行。

### 3.3 限制爆炸半径

服务端强制校验容量、速率、持续时间、并发目标和剩余空间阈值。控制台校验只用于改善交互，不能替代后端校验。

### 3.4 控制面单一出口

traffic-control-plane 不直接访问业务服务；MySQL 增长和文件增长请求都必须经 gateway 分发到指定业务服务。业务服务使用自身的数据库连接执行写入，保证写入来源与真实服务一致。

### 3.5 可选目标服务

本场景只支持以下 3 个业务服务，控制台和 gateway 必须使用同一份固定白名单：

| 服务 | 选择理由 | 主要观测点 |
| --- | --- | --- |
| `catalog-service` | 商品和 SKU 数据写入服务 | 商品查询延迟、MySQL 写入和服务挂载盘 |
| `risk-service` | 风控事件写入服务 | 风控链路延迟、事件写入和服务挂载盘 |
| `notification-service` | 通知日志写入服务 | 通知写入吞吐、日志存储和服务挂载盘 |

约束：

1. 每次 run 只能选择一个 `targetService`。
2. 控制台只展示上述 3 个选项，不提供“全部服务”选项。
3. gateway 的 `storage-growth` 白名单只包含上述 3 个服务。
4. 其他业务服务不支持本场景，即使它们支持其他 common 故障能力。
5. 如需同时观察多个服务，必须创建多个独立 run，并分别记录各自的 `runId` 和 `source_service`。

### 3.5 可观测

每个 run 使用唯一 `runId`，日志、状态响应、指标和清理操作都携带该标识。验收同时观察逻辑写入量和物理磁盘水位，不把两者混为一个指标。

## 4. 目标架构

```text
                    +----------------------------+
                    | traffic-control-plane      |
                    | console + BFF + worker      |
                    +-------------+--------------+
                                  |
                 +----------------+----------------+
                 |                                 |
          gateway storage route
             |
          gateway-service
             |
       selected business service
         |                 |
       MySQL writer     file writer
         |
       storage_growth_records
```

### 4.1 MySQL 增长器

MySQL 增长器由被选中的业务服务执行，而不是由 traffic-control-plane 直接写入：

1. control-plane 提交 `targetService`，且值必须是 `catalog-service`、`risk-service` 或 `notification-service`；gateway 只向这 3 个服务分发。
2. 目标服务使用自身的 `DataSource` 连接共享 MySQL。
3. 服务端从 `spring.application.name` 得到 `source_service`，客户端不能覆盖该字段。
4. 创建或确认专用表存在，并按批次插入固定大小 `VARBINARY` payload。
5. 根据 `rateBytesPerSec` 控制批次间隔，每批写入前检查目标容量和数据库可用空间。
6. 达到目标、超时、收到 disable、触发空间保护或发生错误时停止。

因此，`targetService` 表示请求分发目标，`source_service` 表示实际建立数据库连接并执行写入的服务。两者正常情况下必须一致，状态和日志中同时保留这两个字段。

### 4.2 文件系统增长器

文件系统增长器由目标业务服务内的 common 组件执行：

1. 只接受受限格式的 `runId`，不接受根目录或任意路径。
2. 将文件写入 `${storage.root}/<runId>/`，默认 root 为 `/service-data/storage-growth`。
3. 使用固定大小块写入，并按速率进行节流。
4. 写入前检查 `FileStore.getUsableSpace()`。
5. 到达目标、超时、收到 disable、触发空间保护或发生错误时停止。
6. cleanup 只删除对应 run 目录，不触碰 `/service-data` 其他内容。

## 5. 数据模型

### 5.1 MySQL 专用表

```sql
CREATE TABLE IF NOT EXISTS storage_growth_records (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id VARCHAR(64) NOT NULL,
  source_service VARCHAR(64) NOT NULL,
    payload VARBINARY(65535) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_storage_growth_run_id (run_id),
  INDEX idx_storage_growth_source_service (source_service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

说明：

- `payload` 使用固定大小，便于估算写入量；
- `run_id` 用于按运行批次清理；
- `source_service` 由服务端生成，用于按服务归因和清理校验；
- 不参与正常业务查询，仅保留 run 和来源服务索引用于控制、观测和清理；
- 物理空间是否立即归还操作系统取决于 MySQL 表空间和部署方式。

### 5.2 文件目录

```text
/service-data/storage-growth/<runId>/part-000001.bin
/service-data/storage-growth/<runId>/part-000002.bin
```

`runId` 只允许 ASCII 字母、数字、`.`、`_`、`-`，长度限制为 1 到 64 个字符。禁止 `..`、路径分隔符、绝对路径和符号链接逃逸。

## 5.3 Prometheus 存储突增检测

存储突增场景复用现有 `node-exporter` 和 `mysqld-exporter`，不新增 exporter 或业务指标：

- `NodeDataFilesystemUsageHigh`：使用 `node_filesystem_avail_bytes{mountpoint="/data",fstype="ext4"}` 与 `node_filesystem_size_bytes{mountpoint="/data",fstype="ext4"}` 检测数据文件系统使用率超过 85%。
- `NodeDataFilesystemGrowthRateHigh`：使用 `deriv(node_filesystem_avail_bytes{mountpoint="/data",fstype="ext4"}[15m])` 检测数据文件系统可用空间持续以超过 10 MiB/s 的速率下降。
- `MySQLInnoDBDataWriteRateHigh`：使用已部署的 `mysql_global_status_innodb_data_written` 累计字节指标，通过 `rate(...[5m])` 检测 InnoDB 数据文件写入速率超过 1 MiB/s。

其中节点规则用于观测实际 `/data` 物理磁盘水位，MySQL 规则用于确认数据库正在产生数据文件写入。当前部署未暴露 `mysql_info_schema_table_size_bytes`，因此不使用表级大小指标。MySQL 删除演练记录后，InnoDB 表空间不一定立即归还操作系统，因此清理后的物理水位应以 node-exporter 指标为准。

## 6. 统一状态模型

两个增长器都返回以下状态：

| 状态 | 含义 |
| --- | --- |
| `IDLE` | 没有活动运行 |
| `RUNNING` | 正在写入 |
| `STOPPED` | 收到 disable 或服务关闭信号 |
| `COMPLETED` | 达到目标容量 |
| `SPACE_GUARD` | 触发剩余空间保护 |
| `ERROR` | 发生写入或依赖错误 |

状态对象至少包含：

```json
{
  "runId": "storage-demo-001",
  "status": "RUNNING",
  "targetBytes": 3221225472,
  "writtenBytes": 5242880,
  "writtenRows": 80,
  "rateBytesPerSec": 10485760,
  "startedAt": "2026-08-08T10:00:00Z",
  "stoppedAt": null,
  "autoStopAt": "2026-08-08T10:05:08Z",
  "stopReason": null,
  "freeSpaceBytes": 4294967296,
  "target": "mysql",
  "targetService": "catalog-service",
  "sourceService": "catalog-service"
}
```

状态更新必须保证：

- `writtenBytes` 单调不减；
- 同一个目标最多一个 `RUNNING` run；
- stop reason 只在终态写入；
- status 查询失败不能触发新的写入。

## 7. 控制协议

### 7.1 MySQL 控制面接口

```text
POST /internal/traffic/storage-growth/mysql/enable
POST /internal/traffic/storage-growth/mysql/disable
POST /internal/traffic/storage-growth/mysql/cleanup
GET  /internal/traffic/storage-growth/mysql/status
```

请求示例：

```json
{
  "targetService": "catalog-service",
  "storageType": "mysql",
  "targetBytes": 3221225472,
  "rateBytesPerSec": 10485760,
  "durationSec": 308,
  "minFreeBytes": 1073741824,
  "runId": "storage-demo-001"
}
```

control-plane 的 MySQL route 不直接执行 SQL，而是调用 gateway 的 MySQL storage dispatch；只有目标业务服务的 endpoint 执行实际写入。

### 7.2 业务服务接口

```text
POST /internal/chaos/storage-growth/enable
POST /internal/chaos/storage-growth/disable
POST /internal/chaos/storage-growth/cleanup
GET  /internal/chaos/storage-growth/status
```

请求示例：

```json
{
  "runId": "storage-demo-001",
  "storageType": "filesystem",
  "targetBytes": 3221225472,
  "rateBytesPerSec": 10485760,
  "durationSec": 308,
  "minFreeBytes": 1073741824,
  "minFreePercent": 10
}
```

业务服务不得接受 `sourceService` 作为请求字段。它必须使用自身的 `spring.application.name` 写入 `source_service`，并在响应中回显服务端计算的来源。

### 7.3 Gateway 接口

  "targetBytes": 3221225472,
  "rateBytesPerSec": 10485760,
```text
POST /internal/gateway/chaos/storage-growth/enable
POST /internal/gateway/chaos/storage-growth/disable
POST /internal/gateway/chaos/storage-growth/cleanup
GET  /internal/gateway/chaos/storage-growth/status
```

gateway 必须通过已有服务 URL 映射和固定的 `storage-growth` 白名单分发，禁止客户端提供 URL。gateway 自身、MySQL、Redis 和其他业务服务不在白名单内。MySQL 和文件系统两类请求都使用 `targetService` 选择上述 3 个目标服务之一。

## 8. 资源保护策略

### 8.1 服务端硬限制

初始实现建议使用以下默认硬上限，最终值在实现前评审确认：

| 参数 | 默认值 | 建议最大值 |
| --- | ---: | ---: |
| `targetBytes` | 3 GiB | 10 GiB |
| `rateBytesPerSec` | 10 MiB/s | 100 MiB/s |
| `durationSec` | 60 s | 3600 s |
| `minFreeBytes` | 1 GiB | 必须大于 0 |
| `minFreePercent` | 10% | 99% |
| 单目标活动 run | 1 | 1 |

默认 smoke test 不得超过 16 MiB。GB 级演练必须在 disposable 环境显式执行。

### 8.2 停止条件

任意一个条件满足即停止：

1. `writtenBytes >= targetBytes`，状态为 `COMPLETED`；
2. 当前时间达到 `autoStopAt`，状态为 `STOPPED`，原因 `DURATION_EXPIRED`；
3. 可用空间低于 `minFreeBytes` 或低于 `minFreePercent`，状态为 `SPACE_GUARD`；
4. 收到 disable，状态为 `STOPPED`，原因 `MANUAL_DISABLE`；
5. 写入异常或依赖不可用，状态为 `ERROR`。

## 9. 清理和恢复

### 9.1 MySQL 清理

- 默认要求提供 `runId`，执行 `DELETE FROM storage_growth_records WHERE run_id = ?`；
- 不允许通过接口清理其他业务表；
- “清空专用表”只能作为受保护的显式运维操作，不作为控制台默认按钮；
- 清理后验证专用表记录数下降；物理数据目录可能不会立即 shrink。

### 9.2 文件清理

- 默认要求提供 `runId`；
- 解析并校验路径后，只删除 `${root}/<runId>`；
- 不递归删除 `${root}` 的其他 run；
- 遇到不存在目录视为幂等成功；
- 清理前后记录文件数和总字节数。

### 9.3 服务重启

服务重启后：

- 不自动恢复旧 run 的写入线程；
- 将本地残留 run 标记为 `STOPPED` 或 `ORPHANED`；
- cleanup 仍可按 runId 执行；
- 不扫描或删除非本场景目录。

## 10. 观测与验收

### 10.1 业务指标

- MySQL：按 `source_service` 聚合的记录数、表大小、写入吞吐、锁等待、连接池使用率；
- 文件系统：目标服务挂载目录大小、可用空间、写入 IO、容器文件系统水位；
- 应用：写入成功/失败次数、当前 run、写入速率、停止原因；
- 业务链路：订单/支付延迟、错误率和超时率。

### 10.2 日志字段

每次 enable、disable、cleanup、自动停止和异常至少记录：

```text
runId, targetType, targetService, targetBytes, writtenBytes,
rateBytesPerSec, status, stopReason, freeSpaceBytes
```

### 10.3 验收场景

1. MySQL 目标 4 MiB，低速写入，确认专用表增长且业务表不变。
2. 文件目标 4 MiB，确认目标服务固定目录增长且其他 `/service-data` 内容不变。
3. disable 后连续查询两次 status，确认 `writtenBytes` 不再增长。
4. duration 到期后确认自动停止。
5. 设置高保护线，确认状态变为 `SPACE_GUARD`。
6. 重复 enable、disable、cleanup，确认行为幂等。
7. 使用路径穿越、绝对路径、未知服务和非法参数，确认请求被拒绝。
8. 选择非白名单服务，确认 gateway 拒绝请求；选择 `catalog-service`、`risk-service` 或 `notification-service` 时确认目标服务执行写入。
9. cleanup 后确认对应 run 数据被删除，并区分逻辑清理和物理空间回收结果。

## 11. 实现边界

### 11.1 需要修改

- `common/src/main/java/com/castrel/chaos/common/storage/`：MySQL 和文件增长组件，使用目标服务自身的 `DataSource`；
- `traffic-control-plane/src/worker/`：场景状态编排和生命周期，不直接写 MySQL；
- `traffic-control-plane/src/app/internal/traffic/`：MySQL route handlers；
- `traffic-control-plane/src/app/chaos/page.tsx`：Storage Growth 控制面板；
- `common/src/main/java/com/castrel/chaos/common/storage/`：文件增长组件和状态模型；
- `common/src/main/java/com/castrel/chaos/common/config/`：自动配置；
- `gateway-service/src/main/java/com/castrel/chaos/gateway/`：分发 DTO 和 Controller；
- `gateway-service/src/main/resources/application.yml`：服务白名单；
- `infra/mysql/init/`：专用表 DDL；
- `docker-compose.yml`、`k8s/services/`：写入目录和卷策略；
- `scripts/chaos/`：小容量验证脚本。

### 11.2 明确不修改

- 不修改 `DataWarmupService`；
- 不改订单、支付、库存等正常业务流程；
- 不新增 Redis BigKey 或 JVM 内存泄漏逻辑；
- 不开放任意 URL 或任意文件路径写入；
- 不把 MySQL 增长任务伪装成业务流量；写入必须能通过 `source_service` 归因到目标服务。

## 12. 实施顺序

```text
协议与边界冻结
  ├── MySQL 专用表 + worker
  └── common 文件增长组件
          ↓
统一服务端点
          ↓
gateway 白名单与分发
          ↓
control-plane routes + worker 生命周期
          ↓
控制台面板
          ↓
Compose/Kubernetes 配置
          ↓
单元测试、协议测试、小容量端到端验收
```

具体执行拆解见 [Task 23](../tasks/task-23-storage-growth.md)。

## 13. 未决设计

1. GB 级演练的最终硬上限和默认保留空间阈值；
2. Kubernetes 中使用 `emptyDir` 还是独立 PVC，以及是否设置 `sizeLimit`；
3. MySQL 专用表的物理空间回收策略，是接受逻辑清理还是在 disposable 环境重建表；
4. 是否为 storage-growth 增加独立 Grafana 面板，还是先复用现有 Node/MySQL 面板。
