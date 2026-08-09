# Task 23 — 存储突增场景

> 文档编号：T23
> 状态：草案
> 版本号：v0.4.0
> 最后更新时间：2026-08-08
> 审核人：待定
> 生效日期：待定
> 负责人：待定

## 变更记录

| 版本号 | 日期 | 变更人 | 变更说明 |
| --- | --- | --- | --- |
| v0.1.0 | 2026-08-08 | Codex | 创建存储突增场景设计与执行计划。 |
| v0.2.0 | 2026-08-08 | Codex | 开始实现 MySQL 增长链路、固定目标服务白名单和控制台入口。 |
| v0.3.0 | 2026-08-08 | Codex | 完成业务服务 filesystem 模式、模式选择和 run 级文件清理。 |
| v0.4.0 | 2026-08-08 | Codex | 增加三个目标服务的 Kubernetes 存储卷和小容量 smoke test。 |

## 文档目的

为 Castrel Chaos 增加一个可从 traffic-control-plane 控制台操作的存储突增演练场景，覆盖 MySQL 数据盘增长和指定业务服务容器文件系统增长。场景只开放 `catalog-service`、`risk-service`、`notification-service` 3 个目标服务。

本任务强调可控、可观测、可回收：所有写入必须有容量上限、速率上限、持续时间上限和剩余空间保护；停止与清理必须幂等，并且只能作用于本场景创建的数据。

## 目标读者

- common、gateway-service 和 traffic-control-plane 的实现人员
- Docker Compose / Kubernetes 运维人员
- 场景验收和混沌演练人员

## 关联文档

- [任务总览](README.md)
- [Task 14：v2 公共模块](task-14-v2-common-components.md)
- [Task 15：v2 大表数据填充](task-15-v2-data-warmup.md)
- [Task 16：v2 各服务场景接入](task-16-v2-service-integration.md)
- [Task 20：traffic control plane 脚手架](task-20-traffic-control-plane-scaffold.md)
- [Task 21：gateway chaos dispatch](task-21-gateway-chaos-dispatch.md)
- [Task 22：chaos protocol 统一化](task-22-chaos-protocol-unification.md)
- [架构设计](../plans/chaos-v2.md)
- [存储突增场景设计](../plans/storage-growth-scenario.md)

## 任务背景

当前仓库已有以下能力：

- `DataWarmupService` 持续填充两张 MySQL 大表，用于慢 SQL 场景；
- common 模块提供统一的业务服务控制端点；
- gateway 提供目标服务白名单和统一分发；
- 每个业务服务已有 `/service-data` 可写挂载目录。

这些能力还不能直接表达“存储水位快速上涨”的可逆演练：大表预热是启动后长期任务，内存压力不会占用数据盘，任意文件写入又存在误删业务数据和真正写满磁盘的风险。因此本任务新增专用、限速、可清理的持久化写入器，并保持与现有预热和内存压力场景独立。

## 任务范围

### 负责范围

1. 由指定业务服务执行的 MySQL 专用演练表批量增长，并记录服务来源。
2. 指定业务服务容器的受控文件增长。
3. gateway 白名单分发和 traffic-control-plane 控制台入口，MySQL 与文件增长均选择目标业务服务。
4. 启停、自动停止、状态查询、空间保护和清理。
5. Docker Compose / Kubernetes 下的可写目录和观测说明。
6. 单元测试、协议测试和小容量端到端验证脚本。

### 不负责范围

1. 不修改 `orders`、`payments`、`user_behavior_log`、`product_price_history` 等现有业务表。
2. 不修改现有 `DataWarmupService` 的目标行数和生命周期。
3. 不把 Redis BigKey、JVM 内存压力或网络故障合并到本场景。
4. 不支持宿主机任意目录写入，不允许客户端传入任意绝对路径。
5. 不承诺 MySQL 删除记录后立即将物理空间归还操作系统。
6. 不改变现有业务接口的正常读写逻辑。
7. 不允许 control-plane 直接写 MySQL；实际写入必须由被选中的业务服务完成。
8. 本场景不提供“全部服务”选项，每次 run 只能选择一个固定白名单服务。

## 执行状态

- 当前状态：进行中
- 当前里程碑：MySQL 与 filesystem 增长链路已完成首版，端到端验证待完成
- 当前阻塞：待补充自动化测试、部署配置和真实环境 smoke test

## 执行 owner

- owner 角色：混沌场景负责人
- 当前执行 owner：`backend-chaos-agent`
- 备援 owner：`qa-agent`
- 协作角色：`frontend-agent`、`gateway-agent`、`ops-agent`
- owner 变更要求：切换执行人时同步更新本节和交接记录。

## 执行排期

- 优先级：P1
- ETA：待排期
- 实际完成时间：待完成
- 排期维护要求：依赖或验收范围变化时同步更新本节和任务总览。

## 预计输入

- Task 14 的 common 自动配置和 Redis/组件约定
- Task 15 的 traffic-control-plane worker、MySQL 连接池和批量写入模式
- Task 21 的 gateway 分发和服务白名单
- Task 22 的统一 `enable / disable / cleanup / status` 协议
- Docker Compose 中各业务服务的 `/service-data` 挂载
- Kubernetes 中各服务的存储卷配置
- 固定目标服务白名单：`catalog-service`、`risk-service`、`notification-service`

## 预计输出

- MySQL 专用表和独立增长 worker
- common 文件系统增长组件及统一服务端点
- gateway 分发端点和白名单
- traffic-control-plane route handlers、控制台面板和状态轮询
- Compose/Kubernetes 存储配置说明
- 自动化测试与小容量验证脚本

## 任务拆解

| 子任务编号 | 子状态 | 子任务 | 执行 owner | 预计输入 | 预计输出 | Done Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| T23-01 | 已完成 | 冻结协议、数据模型和参数边界 | `backend-chaos-agent` | Task 21、Task 22 | 请求/响应模型、状态机、上限表 | enable、disable、cleanup、status 的字段、错误和幂等语义评审通过。 |
| T23-02 | 已完成 | 新增带来源服务字段的 MySQL 专用演练表 | `backend-chaos-agent` | Task 15、现有 DDL | `storage_growth_records`、`source_service` | 表包含 `run_id`、`source_service` 和 payload；按 run 与来源服务可查询、可清理，业务表不被修改。 |
| T23-03 | 已完成 | 实现业务服务侧 MySQL 增长组件 | `backend-chaos-agent` | common 自动配置、业务 `DataSource` | MySQL growth service/controller | 由目标服务自身连接 MySQL 写入，`source_service` 服务端生成且不可被请求覆盖。 |
| T23-04 | 已完成 | 实现业务容器文件增长组件和统一端点 | `backend-chaos-agent` | Task 14、Task 22、`/service-data` | MySQL/文件 endpoint 和状态 DTO | 两类写入都支持启停、清理、自动停止、空间保护和 run 级状态。 |
| T23-05 | 已完成 | 扩展 gateway 分发及固定服务白名单 | `gateway-agent` | Task 21、业务服务映射 | gateway controller、DTO、配置 | `storage-growth` 只允许 `catalog-service`、`risk-service`、`notification-service`，未知服务、其他业务服务、gateway、MySQL、Redis 和任意 URL 均被拒绝。 |
| T23-06 | 已完成 | 增加 MySQL control-plane route handlers | `backend-chaos-agent` | T23-03、T23-05 | Next.js MySQL routes | MySQL 请求经 gateway 分发到 `targetService`，control-plane 不直接执行 SQL；文件请求待 T23-04 完成后接入。 |
| T23-07 | 已完成 | 增加控制台 Storage Growth 面板 | `frontend-agent` | T23-03、T23-06 | chaos 页面面板 | 可在 3 个固定目标服务中选择一个，并切换 MySQL/filesystem 模式，配置容量、速率、时长和 runId。 |
| T23-08 | 已完成 | 更新 Compose/Kubernetes 存储配置 | `ops-agent` | 现有 `/service-data` 卷 | 部署配置和运行说明 | Compose 复用 bind mount，Kubernetes 三个目标服务挂载 10Gi `emptyDir`。 |
| T23-09 | 进行中 | 单元、协议和端到端验收 | `qa-agent` | T23-01 至 T23-08 | 测试、验证脚本、验收记录 | 脚本语法和构建验证通过；待在服务运行环境执行 4MiB MySQL/filesystem smoke test。 |

## 接口设计

### MySQL 增长器

```text
POST /internal/traffic/storage-growth/mysql/enable
POST /internal/traffic/storage-growth/mysql/disable
POST /internal/traffic/storage-growth/mysql/cleanup
GET  /internal/traffic/storage-growth/mysql/status
```

`enable` 请求建议字段：

```json
{
  "targetService": "catalog-service",
  "storageType": "mysql",
  "targetBytes": 16777216,
  "rateBytesPerSec": 1048576,
  "durationSec": 60,
  "minFreeBytes": 1073741824,
  "runId": "optional-client-run-id"
}
```

MySQL 增长器必须写入专用表 `storage_growth_records`。建议字段：

```sql
CREATE TABLE IF NOT EXISTS storage_growth_records (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id VARCHAR(64) NOT NULL,
  source_service VARCHAR(64) NOT NULL,
    payload MEDIUMBLOB NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_storage_growth_run_id (run_id),
  INDEX idx_storage_growth_source_service (source_service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`targetService` 只能是 `catalog-service`、`risk-service` 或 `notification-service`，由控制面选择并由 gateway 固定白名单校验；`source_service` 由目标业务服务从 `spring.application.name` 服务端生成，客户端不能传入或覆盖。正常情况下两者必须一致。

### 文件系统增长器

```text
POST /internal/chaos/storage-growth/enable
POST /internal/chaos/storage-growth/disable
POST /internal/chaos/storage-growth/cleanup
GET  /internal/chaos/storage-growth/status
```

`enable` 请求建议字段：

```json
{
  "runId": "storage-demo-001",
  "storageType": "filesystem",
  "targetBytes": 16777216,
  "rateBytesPerSec": 1048576,
  "durationSec": 60,
  "minFreeBytes": 1073741824,
  "minFreePercent": 10
}
```

文件必须写入：

```text
/service-data/storage-growth/<runId>/part-000001.bin
```

客户端只能提供 `runId`，不能提供根目录、绝对路径或路径片段。`runId` 必须经过字符白名单校验并限制长度。

### 状态模型

所有增长器统一返回以下状态之一：

- `IDLE`：没有活动任务。
- `RUNNING`：正在写入。
- `STOPPED`：收到 disable 或服务关闭信号。
- `COMPLETED`：达到目标容量。
- `SPACE_GUARD`：触发剩余空间保护。
- `ERROR`：写入或依赖异常。

状态至少包含：

```json
{
  "runId": "storage-demo-001",
  "status": "RUNNING",
  "targetBytes": 16777216,
  "writtenBytes": 5242880,
  "writtenRows": 80,
  "rateBytesPerSec": 1048576,
  "startedAt": "2026-08-08T10:00:00Z",
  "stoppedAt": "",
  "autoStopAt": "2026-08-08T10:01:00Z",
  "stopReason": "",
  "freeSpaceBytes": 4294967296
}
```

## 安全与资源保护

1. 容量、速率、持续时间必须进行服务端校验，不能只依赖前端校验。
2. 默认使用 MB 级参数；生产或共享环境必须显式提高上限。
3. 每次批量写入前检查数据库或文件系统可用空间。
4. 达到 `minFreeBytes` 或 `minFreePercent` 时立即停止，并返回 `SPACE_GUARD`。
5. 同一个目标默认只允许一个活动 run；重复 enable 应返回当前活动 run 或明确拒绝。
6. disable 必须停止后台任务，不删除数据。
7. cleanup 只删除当前 run 产生的数据；MySQL 清理按 `run_id` 删除，文件清理只删除对应 run 目录。
8. cleanup 需要处理重复执行、部分文件不存在和服务重启后的残留状态。
9. 所有日志包含 `runId`、目标类型、目标服务、写入字节数和停止原因。
10. 不允许通过该能力写入宿主机任意路径、MySQL 系统表、Redis 数据目录或其他服务挂载目录。

## 允许修改的代码目录

| 路径 | 状态 | 允许范围 |
| --- | --- | --- |
| `common/src/main/java/com/castrel/chaos/common/storage/` | 待创建 | 文件增长 service、DTO、状态模型和测试 |
| `common/src/main/java/com/castrel/chaos/common/config/` | 已存在 | 自动配置注册 |
| `common/src/main/java/com/castrel/chaos/common/chaos/` | 已存在 | 统一 endpoint 接入；不得改动其他故障语义 |
| `traffic-control-plane/src/worker/` | 已存在 | MySQL 增长 worker 和生命周期接入 |
| `traffic-control-plane/src/app/internal/traffic/` | 已存在 | storage-growth route handlers |
| `traffic-control-plane/src/app/chaos/` | 已存在 | 控制台面板 |
| `traffic-control-plane/src/lib/` | 已存在 | 请求封装和状态类型 |
| `gateway-service/src/main/java/com/castrel/chaos/gateway/` | 已存在 | DTO、controller、dispatch 配置 |
| `gateway-service/src/main/resources/application.yml` | 已存在 | storage-growth 白名单 |
| `infra/mysql/init/` | 已存在 | 专用表 DDL |
| `docker-compose.yml`、`k8s/services/` | 已存在 | 可写卷和容量说明 |
| `scripts/chaos/` | 已存在 | 小容量 smoke test |

禁止越界修改业务下单、支付、库存等正常流程，禁止复用或修改 `DataWarmupService` 的预热目标。

## 外部依赖登记表

| 依赖项 | 依赖方 | 当前状态 | 处理方式 |
| --- | --- | --- | --- |
| MySQL 可写连接和数据目录 | T23-02 | 待确认 | 使用现有 runner 连接池，先用 MB 级验证。 |
| common 自动配置加载 | T23-03、T23-04 | 已有基础 | 增加组件注册并执行各服务编译。 |
| gateway 服务白名单 | T23-05 | 已有基础 | 增加 storage-growth 类型，不开放任意 URL。 |
| `/service-data` 写权限 | T23-03、T23-08 | 待验证 | Compose/K8s 启动后以目标服务身份验证。 |
| Node Exporter / MySQL 指标 | T23-09 | 已有基础 | 增加运行观测项，不依赖新增监控系统。 |
| 物理空间回收语义 | T23-09 | 环境相关 | 区分记录清理完成和文件系统 shrink。 |

## 风险与阻塞

| 风险或阻塞 | 影响 | 处理方式 | 负责人 |
| --- | --- | --- | --- |
| MySQL 删除记录后空间不立即回收 | 数据盘指标可能不下降 | 验收分离逻辑清理和物理回收；必要时在一次性环境重建专用表 | `ops-agent` |
| 目标容器使用 PVC 或 emptyDir | 不同环境磁盘观测口径不同 | 在部署文档中明确卷类型和容量限制 | `ops-agent` |
| 写入速度过高影响业务 | 业务 RT、连接池和 IO 被拖慢 | 默认限速、独立 worker、批量大小上限和空间保护 | `backend-chaos-agent` |
| 服务重启留下活动 run | 状态与实际文件不一致 | 启动扫描本地 run 元数据并将孤儿 run 标记为 stopped | `backend-chaos-agent` |
| 多目标服务部分失败 | 控制台状态不完整 | 返回逐目标结果，不能把部分成功伪装成全成功 | `gateway-agent` |
| 现有文档和实现存在协议漂移 | 验证脚本可能误报 | T23 只使用 Task 22 的新协议，并补充专用 smoke test | `qa-agent` |

## agent 接手说明

接手实现前必须先阅读 Task 14、Task 15、Task 21、Task 22 及本任务的“接口设计”和“安全与资源保护”章节。

实现顺序建议为：

```text
T23-01
  ├── T23-02 → T23-06
  └── T23-03 → T23-04 → T23-05
T23-06 → T23-07
T23-02/T23-04/T23-05 → T23-08
T23-02 至 T23-08 → T23-09
```

每个实现子任务完成后必须先执行自身范围内最窄的编译、类型检查或单元测试，再交给下游。大容量测试只能在明确的 disposable 环境执行，默认 smoke test 不得超过 16 MB。

## 交接记录

| 日期 | 交接人 | 接收人 | 交接内容 | 未决事项 |
| --- | --- | --- | --- | --- |
| 2026-08-08 | Codex | `backend-chaos-agent` | 完成场景边界、接口草案和执行拆分。 | 容量/速率硬上限、默认目标服务、Compose/K8s 卷策略待评审。 |

## 完成标准

### 功能完成

- [ ] 指定业务服务可按 run 批量增长 MySQL 专用表，且写入记录包含不可伪造的 `source_service`。
- [ ] 指定业务服务可在固定目录内按速率写入文件。
- [ ] 两类增长器均支持 `enable / disable / cleanup / status`。
- [ ] `durationSec` 到期自动停止。
- [ ] 达到容量目标后自动停止并返回 `COMPLETED`。
- [ ] 剩余空间保护触发后停止并返回 `SPACE_GUARD`。
- [ ] 重复 enable、disable、cleanup 均具有明确且幂等的行为。
- [ ] gateway 只向 3 个固定白名单服务分发：`catalog-service`、`risk-service`、`notification-service`。
- [ ] MySQL 和文件增长均支持从 3 个固定服务中选择一个 `targetService`，且 control-plane 不直接写 MySQL。
- [ ] 可按 `source_service` 聚合、查询和清理 MySQL 增长记录。
- [ ] 控制台可配置、启停、清理并展示状态。

### 安全完成

- [ ] 不接受任意文件路径、未知服务或任意 URL。
- [ ] 所有容量、速率和持续时间有服务端上限。
- [ ] cleanup 不删除其他 run、业务数据或已有 `/service-data` 文件。
- [ ] MySQL 表名、runId 和 SQL 参数均不通过字符串拼接形成注入风险。

### 验收完成

- [ ] `mvn -pl common,gateway-service -am test` 或仓库等价测试通过。
- [ ] `traffic-control-plane` 的 `pnpm lint` 和 `pnpm build` 通过。
- [ ] 4 至 16 MB 小容量 smoke test 通过。
- [ ] `scripts/chaos/storage-growth-smoke.sh` 的脚本语法检查通过。
- [ ] disable 后写入量不再增长。
- [ ] cleanup 后专用记录和对应 run 目录被清理，重复清理不报错。
- [ ] 路径穿越、非白名单服务、非法参数和空间保护测试通过。
- [ ] MySQL 数据目录、目标服务挂载目录、磁盘 IO 和业务延迟均可观测。
- [ ] 文档已补充 Compose/Kubernetes 卷语义和物理空间回收限制。
