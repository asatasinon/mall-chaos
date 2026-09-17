# 批次 5.0：Alertmanager 告警接收与关联技术设计

> 状态：技术设计 v1
> 配套产品规格：[product.md](./product.md)
> 对应路线阶段：阶段 5.0
> 前置条件：阶段 3 的告警合同和阶段 4 的证据窗口合同已落地；已由阶段 0 选择并核验一个 pilot 候选
> 设计原则：内部机器认证、最小告警事实、数据库幂等、关联不确定性显式保留、不改变 Fault Run 控制路径

## 1. 设计结论

批次 5.0 在 `traffic-control-plane` 中实现一个独立的告警接收域。它接收 Alertmanager 的原生 grouped webhook，将每个告警实例持久化为可审计的 receipt，并根据 Catalog 的受控告警合同形成内部 incident 和可选 Fault Run 关联。

实现必须遵守以下结论：

1. P0-13 已实现 `POST /internal/alertmanager/webhook` 的最小 Route Handler、精确 middleware 例外、`CASTREL_INTERNAL_SERVICE_KEY` 机器认证和低基数 receipt。批次 5.0 必须在该边界上扩展 grouped alert、关联和 Operator 读模型，不能重复创建第二个 intake route。
2. Alertmanager 的一次通知可包含多个 `alerts[]` 项。每项必须独立规范化、去重和记录；顶层 `groupKey` 只能作为通知来源元数据，不能作为 incident 或根因身份。
3. 告警实例的稳定业务身份是规范化的 `(fingerprint, startsAt)`。数据库唯一约束而非进程内 Map 承担重试幂等。
4. `MATCHED`、`UNMATCHED`、`AMBIGUOUS` 和 `NOT_REQUIRED` 是关联事实，不是接收结果。没有唯一 Fault Run 上下文的 receipt 仍必须保留，供后续 Agent RCA 和 Evaluator 使用。
5. 控制面只保存最小、受控的告警字段、状态变化和关联理由代码；不保存完整 webhook body、任意 labels/annotations、Authorization、Cookie、指标、日志或 Trace。
6. receipt 成功不等于外部 Agent 已收到 Alertmanager 的另一条 webhook。批次 5.0 只记录本控制面接收事实；外部投递事实在批次 5.1 以 Alertmanager 的配置和后续 report 事实分别表达。

## 2. 当前实现基线与进入门槛

| 事实 | 当前来源 | 本批次的处理 |
| --- | --- | --- |
| Alertmanager 内部 webhook URL | `infra/alertmanager/alertmanager.yml`、`k8s/infra/alertmanager.yaml` | 保持现有路径；P0-13 已接入 credentials-file 和真实 route，批次 5.0 在其上补齐完整接收域。 |
| 全局认证 | `traffic-control-plane/src/middleware.ts`、`src/lib/alertmanager-webhook.ts` | 仅为精确路径 `/internal/alertmanager/webhook` 建立例外；route 使用 `CASTREL_INTERNAL_SERVICE_KEY`，绝不放开整个 `/internal/**`。 |
| Fault Run 生命周期 | `fault_runs`、`fault_run_events`、`fault-run-repository.ts` | 只读加载候选、事件和时间线；不得调用 Coordinator、stop、release 或 cleanup。 |
| Catalog | `src/lib/fault-run-catalog.ts` | 扩展受控的 alert contract；不在 receiver 或 route 中复制场景、服务、规则和时间窗口。 |
| 告警配置编辑器 | `src/lib/alert-config.ts` | 现有编辑器会将 Basic Auth 明文写入 MySQL 和渲染 YAML；P0-13 的内部 receiver 使用 credentials-file，不使用该编辑器管理 service key。 |
| 数据库模式 | `fault-run-schema.ts`、`infra/mysql/init/04-fault-run-schema.sql` | 使用运行时幂等建表加 fresh-install init SQL 的双轨方式。 |

进入代码开发前，必须满足：

- 阶段 3 的 `Scenario Alert Contract` 能为 pilot 候选给出允许的 alert name、service、severity、关联标签、关联窗口、`send_resolved` 策略和 contract revision。
- 阶段 0 的 pilot review 证明候选告警可在专用非生产环境中真实 firing；不能以 Fault Run 已创建代替告警事实。
- P0-13 的内部接收边界使用 `CASTREL_INTERNAL_SERVICE_KEY`，由 Compose tmpfs/Kubernetes Secret 通过 credentials-file 注入；不得复用 Operator session secret、JWT 或业务服务凭据。若阶段 5 未来拆分专用 intake credential，必须同步更新部署和回退设计。

如果任一门槛未满足，`ALERT_INTAKE_ENABLED` 必须保持 `false`，Alertmanager receiver 也不得指向新 handler。

## 3. 拓扑与信任边界

```text
Prometheus
  -> Alertmanager
       -> control-plane-alert-intake receiver
            -> POST traffic-control-plane:3086/internal/alertmanager/webhook
                 -> 精确 middleware 例外
                 -> route 内 service-key / 固定时间比较
                 -> AlertIntakeService
                      -> alert receipts / incident / correlation
                      -> Operator 只读查询

Fault Run Repository ----只读候选/事件----^
Catalog Alert Contract --只读匹配规则----^
```

此路径是 Alertmanager 到控制面的内部服务调用，不经过宿主机 `19093` 的 Alertmanager UI/API 代理。Nginx Basic Auth 对外保护 Alertmanager UI/API 的现有行为不能替代此路径的机器认证。

| 边界 | 允许的调用方 | 认证与约束 | 明确禁止 |
| --- | --- | --- | --- |
| Alertmanager intake route | Alertmanager Pod/container | `CASTREL_INTERNAL_SERVICE_KEY` Bearer/header、内部网络与 NetworkPolicy/网络隔离 | Operator cookie 作为服务凭据、匿名访问、外部 Agent 调用。 |
| Fault Run correlation | 控制面进程 | 仅读取既有 Repository 和 Catalog 合同 | 调用 Coordinator、修改 Fault Run、猜测最近运行。 |
| Operator receipt 查询 | 已登录 Operator | 既有 session、CSRF 规则和审计 | 从 consumer path 或 Agent endpoint 返回内部关联。 |
| 数据库存储 | 控制面 Web/Worker | MySQL 参数化 SQL、事务和最小字段 | 保存原始观测数据、凭据、完整 webhook payload。 |

Compose 的 `traffic-control-plane` 目前发布了宿主机端口 `13086`，因此“同一 Docker network”不是充分的源身份。共享环境必须同时启用 handler 内机器认证和网络边界；pilot Compose 配置应将控制面宿主机端口限制为 loopback，或由专用 ingress 代替。

## 4. 模块边界

建议新增以下控制面模块，全部位于 `traffic-control-plane`：

P0-13 已先提供 `alertmanager-webhook.ts`、`alert-receipt.ts` 和对应 route/migration，
负责 bounded parser、service-key 认证和最小 receipt。批次 5.0 应复用这些边界并扩展
group/incident/correlation 能力，不覆盖或复制已有的最小安全投影。

| 模块 | 职责 |
| --- | --- |
| `src/lib/alert-receipt-schema.ts` | 幂等初始化 receipt、incident、membership、receipt event 和 correlation 表。 |
| `src/lib/alertmanager-payload.ts` | 严格解析 Alertmanager v4 webhook、时间规范化、允许字段投影和 payload 大小限制。 |
| `src/lib/alert-receipt-repository.ts` | 事务化 receipt upsert、状态事件、incident membership、查询和受控读模型。 |
| `src/lib/fault-run-correlation.ts` | 使用 Catalog alert contract 与只读 Fault Run 事实计算关联结果；不持有控制动作。 |
| `src/lib/alert-intake-service.ts` | 协调验证、逐条 grouped alert 处理、审计摘要和统一错误语义。 |
| `src/lib/alertmanager-auth.ts` | 验证专用 intake Basic Auth；不引用 Operator 认证代码。 |
| `src/app/internal/alertmanager/webhook/route.ts` | 唯一的 Alertmanager HTTP 入口。 |
| `src/app/internal/alerts/receipts/route.ts` | Operator receipt 列表和筛选读接口。 |
| `src/app/internal/alerts/receipts/[alertRef]/route.ts` | Operator 查看单条 receipt、关联和最小事件历史。 |

`FaultRunCoordinator`、`GatewayClient`、业务服务路由和消费者接口都不属于本批次。告警接收不经过 Gateway，因为它不是控制面向业务服务发起的业务 HTTP 调用。

## 5. Catalog 告警合同

告警关联规则必须附着在 Catalog/阶段 3 Contract 层，而不是散落在 webhook route、Alertmanager YAML 或 SQL 中。建议为每个可告警场景扩展内部 `alertContract`，并由 Catalog canonicalization 将其纳入 contract revision。

```ts
type AlertCorrelationContract = {
  alertName: string;
  service: string;
  severity: "warning" | "critical";
  requiredLabels: Readonly<Record<string, string>>;
  incidentKeyLabels: readonly string[];
  correlationWindowSec: number;
  activeGraceBeforeSec: number;
  recentGraceAfterSec: number;
  sendResolvedToControlPlane: boolean;
  faultRunCorrelation: "required" | "optional" | "not_required";
};
```

约束如下：

- `requiredLabels` 只列出 correlation 真正需要的低敏感度标签，例如 `service`、`uri`、受控资源键或部署环境；不得复制任意 Alertmanager labels。
- `incidentKeyLabels` 为空时，incident 只能按 `alertName + service + environment + window` 聚合。不能退化为按告警文本、`groupKey` 或“最近到达”聚合。
- contract validator 必须确认 alert name、severity、service 和所需标签与当前 Prometheus rule 一致，并验证 `send_resolved` 与 Alertmanager receiver 一致。
- receipt 写入 contract revision。后续 Catalog 修改不会重写历史关联的解释。
- 无合同的告警可以作为普通 receipt 保留，但其 `fault_run_correlation_status=NOT_REQUIRED`，不能被选择为阶段 5 pilot 输入。

## 6. 数据模型

### 6.1 身份、时间与可见性

`alertRef` 在 Agent-facing 协议中是下列二元组，不是 bearer token：

```json
{
  "fingerprint": "Alertmanager fingerprint",
  "startsAt": "2026-09-11T08:20:00.000Z"
}
```

服务端将时间解析为 UTC 并固定到毫秒精度，再以该值查找 `(fingerprint, starts_at)`。同一逻辑必须用于 webhook、report 和测试 fixture；不能比较未经规范化的 RFC 3339 原字符串。

数据库可拥有随机 `alert_ref` 供 Operator URL 和内部关联使用，但不得把 `receipt_id`、`incident_id`、`matched_fault_run_id` 或它们的数据库序号返回给 Agent。`incidentRef` 是控制面内部聚合引用，绝不进入 Alertmanager 直接投递的 payload 或 AgentRcaReport 结果。

### 6.2 `alert_receipts`

```sql
CREATE TABLE alert_receipts (
  alert_receipt_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alert_ref CHAR(36) NOT NULL,
  fingerprint VARCHAR(255) NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  current_status VARCHAR(16) NOT NULL,
  alert_name VARCHAR(128) NOT NULL,
  service_name VARCHAR(128) NULL,
  severity VARCHAR(32) NULL,
  environment_name VARCHAR(128) NULL,
  operation_name VARCHAR(128) NULL,
  resource_key VARCHAR(256) NULL,
  group_key VARCHAR(512) NULL,
  contract_revision VARCHAR(128) NULL,
  first_received_at DATETIME(3) NOT NULL,
  last_received_at DATETIME(3) NOT NULL,
  resolved_at DATETIME(3) NULL,
  notification_count INT UNSIGNED NOT NULL DEFAULT 1,
  incident_id BIGINT NULL,
  fault_run_correlation_status VARCHAR(16) NOT NULL,
  correlation_checked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_alert_receipts_ref (alert_ref),
  UNIQUE KEY uq_alert_receipts_instance (fingerprint, starts_at),
  INDEX idx_alert_receipts_received (last_received_at),
  INDEX idx_alert_receipts_incident (incident_id, starts_at),
  INDEX idx_alert_receipts_correlation (fault_run_correlation_status, starts_at),
  CHECK (current_status IN ('FIRING', 'RESOLVED')),
  CHECK (fault_run_correlation_status IN
    ('NOT_REQUIRED', 'MATCHED', 'UNMATCHED', 'AMBIGUOUS'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

说明：

- `group_key` 只用于回答“本次 Alertmanager 通知来自哪个分组”，不能作为任何唯一键或关联条件。
- `operation_name`、`resource_key` 和 `environment_name` 只在合同明确允许时写入；否则为 `NULL`。
- `notification_count` 和 `last_received_at` 表示控制面收到的次数，不表示 Alertmanager 成功向 Agent 投递的次数。
- 若 Alertmanager 对相同 instance 发送 out-of-order notification，完整事件仍保留在 `alert_receipt_events`；当前状态只接受不早于已知 lifecycle 时间的变化，避免迟到的 firing 覆盖已确认的 resolved。

### 6.3 最小 receipt event 历史

```sql
CREATE TABLE alert_receipt_events (
  event_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alert_receipt_id BIGINT NOT NULL,
  notification_status VARCHAR(16) NOT NULL,
  receipt_outcome VARCHAR(32) NOT NULL,
  group_key VARCHAR(512) NULL,
  observed_at DATETIME(3) NULL,
  received_at DATETIME(3) NOT NULL,
  payload_digest CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_alert_receipt_event_receipt FOREIGN KEY (alert_receipt_id)
    REFERENCES alert_receipts(alert_receipt_id) ON DELETE RESTRICT,
  INDEX idx_alert_receipt_events_time (alert_receipt_id, received_at, event_id),
  CHECK (notification_status IN ('FIRING', 'RESOLVED')),
  CHECK (receipt_outcome IN ('CREATED', 'DUPLICATE', 'STATE_UPDATED', 'STALE_NOTIFICATION'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`payload_digest` 是受控字段投影的 SHA-256，不是原始 body。事件表允许 Operator 识别重试与状态顺序，同时避免保存 annotations、可能敏感的 label 或凭据。

### 6.4 incident 与 membership

```sql
CREATE TABLE alert_incidents (
  incident_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  incident_ref CHAR(36) NOT NULL,
  correlation_key_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  opened_at DATETIME(3) NOT NULL,
  last_alert_at DATETIME(3) NOT NULL,
  resolved_at DATETIME(3) NULL,
  contract_revision VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_alert_incidents_ref (incident_ref),
  INDEX idx_alert_incidents_key_time (correlation_key_hash, last_alert_at),
  CHECK (status IN ('OPEN', 'RESOLVED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE alert_incident_memberships (
  incident_id BIGINT NOT NULL,
  alert_receipt_id BIGINT NOT NULL,
  joined_at DATETIME(3) NOT NULL,
  join_reason VARCHAR(64) NOT NULL,
  PRIMARY KEY (incident_id, alert_receipt_id),
  UNIQUE KEY uq_alert_incident_member_receipt (alert_receipt_id),
  CONSTRAINT fk_alert_incident_member_incident FOREIGN KEY (incident_id)
    REFERENCES alert_incidents(incident_id) ON DELETE RESTRICT,
  CONSTRAINT fk_alert_incident_member_receipt FOREIGN KEY (alert_receipt_id)
    REFERENCES alert_receipts(alert_receipt_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

每个 receipt 至多属于一个 incident。第一个可关联的 receipt 创建 singleton incident；只有 correlation key、受控标签和窗口全部命中时，后续 receipt 才能加入。resolved receipt 不会自动关闭 Evaluation，`alert_incidents.status` 仅表达该告警集合的当前 lifecycle。

### 6.5 Fault Run correlation 历史

```sql
CREATE TABLE alert_fault_run_correlations (
  correlation_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alert_receipt_id BIGINT NOT NULL,
  decision VARCHAR(16) NOT NULL,
  matched_fault_run_id CHAR(36) NULL,
  candidate_count INT UNSIGNED NOT NULL,
  reason_code VARCHAR(128) NOT NULL,
  contract_revision VARCHAR(128) NULL,
  checked_at DATETIME(3) NOT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  current_guard TINYINT GENERATED ALWAYS AS (
    CASE WHEN is_current = 1 THEN 1 ELSE NULL END
  ) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_alert_correlation_receipt FOREIGN KEY (alert_receipt_id)
    REFERENCES alert_receipts(alert_receipt_id) ON DELETE RESTRICT,
  UNIQUE KEY uq_alert_correlation_current (alert_receipt_id, current_guard),
  INDEX idx_alert_correlation_run (matched_fault_run_id, checked_at),
  CHECK (decision IN ('NOT_REQUIRED', 'MATCHED', 'UNMATCHED', 'AMBIGUOUS'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`matched_fault_run_id` 故意不建立到 `fault_runs` 的外键：现有 Fault Run retention 会删除终态运行，receipt 的审计记录必须独立存活。只有受控的 `reason_code`、候选数和 contract revision 可进入 Operator 读模型；不要持久化候选运行的完整参数、错误栈或任意事件 payload。

## 7. 接收、幂等与关联流程

### 7.1 Route 准入

`POST /internal/alertmanager/webhook` 的处理顺序必须是：

1. `middleware.ts` 对该**精确路径**放行到 route；其他 `/internal/**` 保持 Operator session 要求。
2. route 校验 `ALERT_INTAKE_ENABLED=true` 和部署注入的专用 Basic Auth。用户名和密码必须使用固定时间比较；缺少或无效凭据不读取或记录 request body。
3. 校验 `Content-Type: application/json`、`Content-Length` 和受限 body 大小。超限、无效 JSON、缺失 `alerts[]`、无 fingerprint 或无有效 `startsAt` 是明确的入站错误。
4. 解析顶层 envelope，并以每个 `alerts[]` 项自己的 `status`、`labels`、`annotations`、`startsAt`、`endsAt` 和 `fingerprint` 为事实。顶层 `status` 只用于一致性检查，不能覆盖单项状态。
5. 将每一项投影为 allowlisted receipt input，并在同一 MySQL transaction 中处理整个 grouped notification。
6. 只有整个 transaction 成功才返回 2xx。不可恢复的 payload 错误返回 400；认证失败返回 401；数据库或依赖错误返回 503，使 Alertmanager 能重试且唯一键保持安全。

路由成功响应仅返回总数与受控结果计数，例如：

```json
{
  "code": 0,
  "message": "accepted",
  "data": {
    "received": 2,
    "created": 1,
    "duplicates": 1,
    "stateUpdated": 0
  }
}
```

它不返回 incident、Fault Run、候选数、凭据、原始 labels 或完整错误。

### 7.2 单条 alert 的事务处理

```text
canonicalize fingerprint + startsAt
  -> SELECT receipt FOR UPDATE
  -> receipt 不存在：创建 receipt + receipt event
  -> receipt 已存在：比较 lifecycle 时间并更新当前投影 + receipt event
  -> 从 receipt 的合同字段导出 incident correlation key
  -> 创建或锁定唯一 incident，写入 membership
  -> 只读加载活跃或最近结束的 Fault Run 候选
  -> 执行确定性 correlation，写入当前 correlation history
  -> 更新 receipt 的最新 correlation 摘要
  -> COMMIT
```

重复 webhook 对同一 `(fingerprint, startsAt)` 不得创建新 `alert_ref`、incident 或 correlation。收到新的 firing 且 `startsAt` 已改变时，才形成新的告警实例；它是否加入既有 incident 取决于合同窗口，而不是 fingerprint 相同与否。

### 7.3 Fault Run correlation 规则

`FaultRunCorrelationResolver` 必须只使用 Catalog alert contract 和可验证运行事实：

1. 若合同声明 `faultRunCorrelation=not_required`，写入 `NOT_REQUIRED`，不加载候选。
2. 只读取 `ACTIVE`、`RECOVERING` 或在合同 `recentGraceAfterSec` 内结束的运行，绝不从任意历史运行中挑选。
3. 对候选同时比较 alert name、service、severity、必需 resource/operation 标签、可选 environment 标签，以及 `startsAt`/`receivedAt` 与运行 active/expiry/stop 时间的合同窗口。
4. 命中一个候选时写入 `MATCHED`；零个写入 `UNMATCHED`；多个写入 `AMBIGUOUS`。
5. 不能以“时间最近”、alert 文本相似或 `groupKey` 相同强行选择候选。`AMBIGUOUS` 是保留事实，不是需要自动修复的异常。

同一 receipt 的历史 correlation 通过将旧行 `is_current=0` 后插入新行维护。正常路径只在 receipt 入站时计算一次；只有由明确的 contract/运行事实变化触发的受控 reconciliation 才允许重算，并必须留下新历史行。重算不得修改已提交的 Agent RCA 或既有 EvaluationReport。

## 8. Operator 查询、审计与错误语义

本批次新增的 Operator 读接口保持既有 envelope、session 和错误模式：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/internal/alerts/receipts` | 按时间、alert name、service、当前状态、correlation status 查询 receipt 摘要。 |
| `GET` | `/internal/alerts/receipts/{alertRef}` | 查询一个 receipt、最小 lifecycle event、incident 摘要和 correlation 历史。 |
| `GET` | `/internal/alerts/incidents/{incidentRef}` | 查询 incident 成员集合及其 receipt 摘要；仅面向 Operator。 |

接口不可支持按任意 alert 文本、原始 annotation 或 webhook body 搜索。分页必须稳定地按 `(last_received_at, alert_receipt_id)` 排序，避免重试期间遗漏或重复页面。

| 状态/错误码 | HTTP | 含义与处理 |
| --- | ---: | --- |
| `ALERT_INTAKE_DISABLED` | 404 | 开关关闭；部署必须先撤销 receiver，再关闭 handler。 |
| `ALERTMANAGER_AUTH_REQUIRED` | 401 | 无凭据；不记录 body。 |
| `ALERTMANAGER_AUTH_INVALID` | 401 | 无效机器凭据；仅记录安全审计计数。 |
| `INVALID_ALERTMANAGER_PAYLOAD` | 400 | 不可解析或缺少告警实例身份；不写部分记录。 |
| `ALERT_RECEIPT_PERSIST_FAILED` | 503 | 数据库事务失败；Alertmanager 可安全重试。 |
| `UNMATCHED` / `AMBIGUOUS` | 2xx | 有效接收结果中的关联限制，绝不伪装成 delivery failure。 |

machine ingress 不写 `operator_audit_logs` 冒充人工操作。它使用 receipt event、受控结构化日志和后续指标作为审计证据。Operator 对 future close、recheck 或保留策略的操作才使用既有 Operator audit。

## 9. 配置、部署、迁移与保留

### 9.1 配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `ALERT_INTAKE_ENABLED` | `false` | 开启 intake route 的唯一功能开关。 |
| `ALERTMANAGER_INTAKE_USERNAME` | 无 | 仅用于 Alertmanager 到控制面。 |
| `ALERTMANAGER_INTAKE_PASSWORD` | 无 | 仅从部署 Secret 注入；为空时拒绝启用。 |
| `ALERT_INTAKE_MAX_BODY_BYTES` | `262144` | webhook 输入上限，防止异常 grouped payload 占用内存。 |
| `ALERT_RECEIPT_RETENTION_DAYS` | `30` | receipt/incident 的独立最短保留期，必须不小于 Fault Run retention。 |
| `ALERT_CORRELATION_MAX_CANDIDATES` | `20` | 防止异常数据扩大一次 correlation 查询；达到上限时保留 `AMBIGUOUS` 限制。 |

所有开关和限制值必须在 `src/lib/env.ts` 中严格校验。密码、外部 URL 和 Alertmanager 配置文件路径不应出现在 Operator API、日志、前端 bundle 或数据库。

### 9.2 Alertmanager receiver

新增或替换为部署管理的内部 receiver，保持 `send_resolved: true`：

```yaml
- name: control-plane-alert-intake
  webhook_configs:
    - url: http://traffic-control-plane:3086/internal/alertmanager/webhook
      send_resolved: true
      http_config:
        basic_auth:
          username: alertmanager-intake
          password_file: /etc/alertmanager/secrets/intake-password
```

必须在部署前使用当前固定的 Alertmanager 镜像执行 `amtool check-config`。Compose 与 Kubernetes 的 Alertmanager 配置是两份独立文件，必须在同一次变更中更新，并且 Kubernetes 镜像先从 `latest` 固定到已验证版本。

当前 `alert-config.ts` 会保存和重渲染 receiver 密码，无法安全表达 `password_file`。pilot 环境应将 `control-plane-alert-intake` 标记为部署管理且不可编辑；在该限制落实前，Operator alert config save 必须在启用 intake 时拒绝执行，而不是丢失认证配置。

### 9.3 数据库迁移

每个新表同时进入：

1. 下一个顺序号的 `traffic-control-plane/src/lib/migrations/*-alert-intake.sql`；
2. `src/lib/alert-receipt-schema.ts` 的幂等 schema 初始化；
3. 对应 `infra/mysql/init/*-alert-intake.sql` fresh-install 文件。

迁移只 expand：新增表、索引和检查约束，不修改 `fault_runs`、`fault_run_events` 的状态机或外键。现有 MySQL volume 不会自动执行 `infra/mysql/init`，因此运行时 schema 初始化必须覆盖升级路径。先部署可读新表的代码，再启用 receiver；禁止通过重置 MySQL volume 完成升级。

### 9.4 保留与回退

- Fault Run 七天后删除时，receipt、incident、correlation 和 receipt event 不级联删除。
- 观测 retention 与告警 receipt retention 分离。receipt 的存在不代表 Prometheus/Loki/Tempo 仍可查询。
- 初始实现不自动清理含有后续 AgentRcaReport 或 EvaluationReport 的 incident。引入自动清理前，必须增加显式配置、Operator audit、引用检查和测试。
- 回退顺序是：先从 Alertmanager 移除/reload 新 receiver，再关闭 `ALERT_INTAKE_ENABLED`，最后停止新查询入口。不得先关闭 handler，导致 Alertmanager 持续重试。
- 回退不删除 receipt 事实；若机器凭据可能泄露，只轮换该专用凭据。

## 10. 可观测性与安全日志

新增低基数计数器、结构化日志字段和 Operator 可查摘要：

| 信号 | 标签/字段 | 目的 |
| --- | --- | --- |
| `alert_intake_received_total` | `outcome`、`status` | 区分创建、重复、状态更新和拒绝。 |
| `alert_intake_correlation_total` | `correlation_status` | 观察 `UNMATCHED`/`AMBIGUOUS` 是否异常。 |
| `alert_intake_auth_failures_total` | `reason` | 识别凭据或入口配置问题。 |
| `alert_intake_processing_duration_seconds` | 无高基数标签 | 观察数据库和关联成本。 |

不得把 fingerprint、`alert_ref`、`incident_ref`、Fault Run ID、完整 URI、payload digest、Authorization 或标签集合放进 Prometheus label。结构化日志可包含短错误码、grouped item 数量和结果计数，但不能包含原始请求体或 secret。

## 11. 测试设计

### 11.1 单元测试

- 解析 firing/resolved payload，且以每条 alert 的状态而非顶层状态为准。
- RFC 3339 时区、亚毫秒与无效时间的 canonicalization。
- grouped alert 拆分、重复通知、resolved 更新、迟到通知和重新 firing。
- `(fingerprint, startsAt)` 唯一性在并发 upsert 下只产生一个 receipt。
- `groupKey` 相同但合同 key 不同不得合并；合同 key 和窗口全部命中才可加入同一 incident。
- `MATCHED`、`UNMATCHED`、`AMBIGUOUS`、`NOT_REQUIRED` 的候选计算，特别是禁止“最近运行”择一。
- allowlist 投影、payload 限制和日志/持久化中不出现 authorization、cookie、任意 annotation。

### 11.2 集成测试

- fresh MySQL 与已有 Fault Run volume 都能创建 schema 和索引。
- middleware 只放行精确 webhook path；相邻 `/internal/*` 路径仍要求 Operator session。
- 无、错、对的 intake Basic Auth 分别返回预期错误，错误凭据不触发 body 持久化。
- Alertmanager retry 在数据库失败后可重试，在已提交成功后返回 2xx 且不重复建行。
- Fault Run 删除后 receipt 和 correlation history 仍可读。
- Operator 查询保持 session/CSRF 约束和既有 response envelope。

### 11.3 环境验收

在 disposable Compose 和一个 Kubernetes 环境分别完成：

1. 使用实际 pilot 候选触发 firing，确认 Alertmanager 到 internal service 的 HTTP 调用真实到达 handler。
2. 验证一次 grouped firing、一次 repeat 和一次 resolved，检查每个告警实例只生成一个 receipt。
3. 验证 `UNMATCHED` 与刻意构造的多候选 `AMBIGUOUS` 都保留事实且未触发任何 Fault Run 控制动作。
4. 检查 receiver 认证失败、NetworkPolicy/网络边界和 handler 直连绕过路径。
5. 检查 MySQL、渲染后的 Alertmanager 配置和日志中没有凭据、完整 webhook、Agent 信息或原始观测数据。

## 12. 实施顺序

1. 扩展阶段 3 Catalog alert contract 和 contract validation，不启用任何 route。
2. 新增 schema、类型、repository 和 payload parser，先以 fixture 覆盖 grouped/retry/resolved。
3. 实现 deterministic incident/correlation service，使用 fake Fault Run repository 覆盖全部关联结果。
4. 添加精确 middleware 例外、route 内机器认证和 Operator 读接口。
5. 同步更新 Compose/Kubernetes 内部 receiver、Secret 挂载、NetworkPolicy 和配置校验；保持开关关闭。
6. 在单一专用环境开启 intake，完成真实 firing/retry/resolved 验收。
7. 只有 receipt 身份、关联语义、保留与入口边界稳定后，才进入批次 5.1。

批次 5.0 的完成标准是“控制面可证明自己收到并正确表达最小告警事实”，不是“已向 Agent 交付告警”，更不是“已经完成 RCA 或恢复”。
