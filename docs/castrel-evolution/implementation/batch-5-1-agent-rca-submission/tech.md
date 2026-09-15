# 批次 5.1：Agent 告警投递与 RCA 提交技术设计

> 状态：技术设计 v1
> 配套产品规格：[product.md](./product.md)
> 对应路线阶段：阶段 5.1
> 前置条件：批次 5.0 intake 已在专用环境真实验收；阶段 4 的 Evidence Query contract/manifest 接口已确定；仅选择一个已核验 pilot
> 设计原则：Alertmanager 直接投递、专用 ingress、版本化 JSON、提交不可变、幂等入队、无 Agent 写权限

## 1. 设计结论

批次 5.1 增加两条彼此独立的外部路径：

```text
Alertmanager --固定 webhook + Basic Auth--> 外部 Agent receiver
外部 Agent --受限 Nginx/Ingress + Basic Auth--> AgentRcaReport endpoint
```

控制面不代理 Alertmanager 到 Agent 的通知，不增加 Alert Delivery Gateway，也不让 Agent 调用 Operator/Fault Run API。Agent 从 Alertmanager 原生 payload 中取得 `(fingerprint, startsAt)`，以此作为 `alertRefs[]` 的输入；控制面在提交时将其解析为内部 receipt/incident。

关键结论：

1. Agent receiver 是 Alertmanager 的直接 destination。控制面 parallel receipt 不能证明外部 receiver 已处理通知；UI 只能显示 route 已配置、Alertmanager 配置核验和后续 report 事实。
2. pilot selector、alert name、service、severity 和关联字段仍由 Catalog alert contract 派生。不得在 YAML、环境变量和 route handler 复制可变的场景事实。
3. 新的 Agent 入口只能暴露一个 `POST` report path。它使用专用 Basic Auth，并以网络/ingress 限制防止绕开 Nginx 直接访问应用端口。
4. `AgentRcaReport.json` 是唯一机器输入。Markdown、自由文本文件或 Agent callback URL 不参与自动评估。
5. 同一 `reportId` 加相同 canonical report 返回同一接受事实；同一 ID 加不同报告必须冲突，不能静默覆盖或重新排队。
6. `UNMATCHED`、`AMBIGUOUS` 是 EvaluationReport 的限制，不能导致合法 alert reference 被拒绝。未知 receipt、跨 incident 引用、评估已关闭和危险内容才是拒绝条件。

## 2. 架构与部署拓扑

```text
                 +--> control-plane-alert-intake (send_resolved: true)
Alertmanager ----|
                 +--> agent-rca-pilot receiver (send_resolved: false)
                         | Basic Auth: agent webhook credential
                         v
                    External Agent
                         |
                         | Basic Auth: report credential
                         v
                 Nginx / Kubernetes Ingress
                         | only POST /agent-rca/reports
                         v
                 traffic-control-plane
                         |
                         +--> AgentRcaReportIntakeService
                                -> receipt/incident validation
                                -> immutable report
                                -> durable evaluation job
```

Agent 的观测读取入口也必须独立于 Operator 和 report credentials：

| 用途 | 认证材料 | 可访问范围 |
| --- | --- | --- |
| Alertmanager 到 Agent webhook | `AGENT_WEBHOOK_*` | 外部 Agent 自己的 webhook endpoint。 |
| Agent 到 report ingress | `AGENT_RCA_REPORT_*` | 仅一个 `POST` path。 |
| Agent 到 Prometheus/Loki/Tempo/指定业务只读路径 | `AGENT_OBSERVATION_*` | 每个 source 的受限 GET/HEAD query allowlist。 |
| Alertmanager 到控制面 intake | `ALERTMANAGER_INTAKE_*` | 仅内部 `/internal/alertmanager/webhook`。 |
| Operator | 既有 session/CSRF | 既有控制面和 Operator-only RCA 页面。 |

以上凭据必须互不复用。尤其不能把当前 Compose 中面向人类、覆盖完整 observability upstream 的 `.htpasswd` 作为 Agent 最小只读权限，也不能使用 Operator session、数据库凭据或内部 service key。

## 3. Pilot route 与 Catalog 单一事实来源

### 3.1 选择与生成

pilot 由阶段 0 review 选出，并由 Catalog 中唯一一个 `agentRcaPilot=true` 的 alert contract 表达。受控配置生成器读取此合同，生成 Alertmanager child route；它不接受运行时 Agent 提供的 rule、service、callback URL 或 matcher。

建议新增：

| 模块 | 职责 |
| --- | --- |
| `src/lib/agent-rca-pilot-contract.ts` | 解析唯一 pilot、验证合同 revision、生成受控 route matcher。 |
| `src/lib/agent-rca-alertmanager-overlay.ts` | 将受控 receiver 和 child route 合并到部署管理的 Alertmanager 配置。 |
| `src/lib/agent-rca-report-schema.ts` | 导出 JSON Schema、TypeScript 类型、版本选择和 size limits。 |
| `src/lib/agent-rca-report-safety.ts` | 验证 secret、URL、可执行内容和控制面操作禁令。 |
| `src/lib/agent-rca-report-repository.ts` | 不可变 report、reference membership、接受审计和事务性 queue handoff。 |
| `src/lib/agent-rca-report-intake.ts` | 协调认证、schema、receipt/incident、幂等和入队。 |
| `src/app/api/agent-rca/reports/route.ts` | 唯一机器 report handler。 |

受控 overlay 必须先通过 Catalog/Prometheus rule/Alertmanager config 三方 validation：

- Catalog 中恰好一个 pilot，且该 contract 已通过阶段 0 的真实 firing 核验。
- 生成的 matcher 与实际 alert rule 的 alert name、service、severity 和必需标签相符。
- pilot child route 在现有 severity route **之前**，并设 `continue: true`。
- 对于当前只按 `critical`/`warning` 转发内部 receiver 的配置，pilot 只能选择能继续命中内部 receiver 的 severity。否则应生成显式 internal child route，不能假定 parent receiver 会收到已命中 child 的告警。
- 默认 receiver、critical receiver、warning receiver 和业务告警路由保持原有行为；pilot route 只增加外部一份 firing 通知。

配置形态如下，其中尖括号内容由受控生成器和部署 Secret 填入：

```yaml
route:
  routes:
    - receiver: agent-rca-pilot
      match:
        alertname: <catalog-derived alert name>
        service: <catalog-derived service>
      continue: true
    - receiver: critical-receiver
      match:
        severity: critical
      continue: false

receivers:
  - name: agent-rca-pilot
    webhook_configs:
      - url: <deployment-owned fixed Agent URL>
        send_resolved: false
        http_config:
          basic_auth:
            username: <secret-backed username>
            password_file: /etc/alertmanager/secrets/agent-webhook-password
```

外部 Agent 在本版本仅由 firing 告警启动，故 `send_resolved: false`。内部 `control-plane-alert-intake` 保持 `send_resolved: true`，负责 receipt lifecycle；resolved 不取消已提交或排队的 RCA。

### 3.2 现有 alert 配置编辑器的限制

`alert-config.ts` 当前会将 receiver Basic Auth 密码写入 MySQL 并将 literal password 写入可写的 rendered YAML。它不能管理上面的 `password_file` 或保证 child route 顺序。

因此 pilot 环境必须采取以下之一，推荐第一项：

1. 将 Agent/internal managed receivers 和 pilot routes 置于部署管理 overlay 中，并在 `AGENT_RCA_ALERT_DELIVERY_ENABLED=true` 时拒绝 Operator 对 Alertmanager source/config 的保存操作；
2. 完成 editor 对 managed receiver、credential-file 和 route merge 的安全支持后，再开放保存。

不允许以“保存后重新手工补齐密码”为过渡方案。

## 4. 外部 ingress 与只读观测边界

### 4.1 Agent RCA report ingress

Agent 看到的公开路径是：

```text
POST https://<agent-rca-ingress-host>/agent-rca/reports
```

Ingress/Nginx 将它唯一映射到控制面的：

```text
POST /api/agent-rca/reports
```

`middleware.ts` 只对这一个精确 application path 绕过 Operator cookie 验证。Route 随后以专用 Basic Auth 再次认证请求，作为 Nginx 之外的防御层；这只是一个固定机器入口的凭据检查，不引入 Agent role、租户或细粒度授权模型。

| 部署模式 | 必需边界 |
| --- | --- |
| Compose | pilot override 将控制面 `13086` 绑定到 loopback；单独 proxy 仅发布 report path；proxy 只允许 `POST`，限制请求体，并向 upstream 显式传递受控 Basic Auth。 |
| Kubernetes | 保持 `traffic-control-plane` Service 为 `ClusterIP`；新增独立 Ingress host/path、Nginx Ingress Basic Auth Secret 和 NetworkPolicy，只允许 Ingress controller 到 report path、Alertmanager 到 intake path。 |
| 所有环境 | 直接访问应用端口不能绕过同一专用 Basic Auth；任何 `/internal/**`、Operator UI、alert config API、worker 控制或泛化 API 都不能通过外部 ingress 到达。 |

Nginx/Ingress 必须拒绝 `GET`、`PUT`、`PATCH`、`DELETE`、未知 path、超大 body、转发代理头伪造和未认证请求。日志中不得记录 `Authorization`。

### 4.2 Agent 只读观测

不新增 Observation Gateway，但现有全 upstream proxy 也不能直接视为 Agent read-only access。pilot 部署需要为 Agent 凭据配置 method/path allowlist：

| Source | 允许 | 禁止 |
| --- | --- | --- |
| Prometheus | 固定的只读 query、query_range、labels/metadata GET 路径 | `/-/reload`、remote-write、admin、任意 POST。 |
| Loki | 固定的 query、query_range、标签 GET 路径 | push、delete、admin、任意 POST。 |
| Tempo | 固定的 search/trace GET 路径 | OTLP ingestion、配置/管理接口、任意写入。 |
| 业务检查 | Catalog/阶段 4 明确列出的 Gateway read-only operation | 消费者写 API、`/internal/**`、任意服务直连。 |

Agent query 仍不构成控制面 Evaluator 的执行输入。Evaluator 只运行阶段 4 Manifest 中的受控 recipes。

## 5. AgentRcaReport v1 合同与校验

### 5.1 Schema 位置和资源限制

完整的协议说明和机器可读合同位于 [AgentRcaReport v1 Schema 详细设计](./agent-rca-report-schema.md) 与 [agent-rca-report.v1.schema.json](./agent-rca-report.v1.schema.json)。实现时将该单一 Schema 复制到 `src/lib/agent-rca-report.v1.schema.json`，由 `agent-rca-report-schema.ts` 通过 `ajv/dist/2020` 加载并导出类型；不得维护另一份手写字段定义。应显式新增 `ajv` 与 `ajv-formats` 作为直接依赖，而不是依赖未声明的传递包。

请求必须同时满足：

| 限制 | 值 |
| --- | ---: |
| 总 body | 最大 256 KiB |
| JSON 深度 | 最大 12 |
| `alertRefs` | 1-20 个，且恰好一个 `primary` |
| `evidenceRefs` | 1-40 个 |
| 可选 `instances` | 每个 root cause 或受影响服务至多 20 个；每项是一个非地址实例标识字符串 |
| remediation actions | 1-10 个，`order` 从 1 连续递增 |
| 单一字符串 | 最大 4 KiB；`agentQuery` 最大 2 KiB |
| `reportId` | 1-128 个 URL-safe 字符 |
| 时间 | RFC 3339，服务端以 UTC 毫秒规范化 |

顶层仅允许产品规格中定义的字段和受限的 `extensions`。`extensions` 不参与评估规则、不能覆盖核心字段，并受相同深度、key 长度与敏感内容扫描约束。

### 5.2 双层验证

```text
Content-Type / body limit
  -> JSON parse
  -> agent-rca-report.v1 JSON Schema
  -> recursive secret and executable-content policy
  -> canonical payload hash
  -> alert reference / incident / closure validation
  -> immutable persistence and evaluation enqueue
```

`AgentRcaReportSafetyValidator` 不把用户字符串当作可执行内容。它必须递归拒绝：

- secret-bearing object keys 或值：`password`、`token`、`secret`、`authorization`、`cookie`、`kubeconfig`、`serviceKey` 等；
- control-plane identity/authority：`faultRunId`、`taskId`、`evaluationId`、内部 database ID、fencing token、`/internal/` operation payload；
- URL、callback、凭据 URI、shell command/substitution、代码块、SQL statement 和自动修复脚本；
- `remediationExecuted`、`cleanupExecuted`、`score`、`passed` 等 Agent 无权声明的结果；
- 将 Fault Run stop/release/cleanup、Worker、Alertmanager 或 Evaluator 操作表述为 remediation target 的内容。
- `instances[]` 中的 IP、端口、URL、内部数据库 ID 或控制面 ID。

安全检查失败时不保存 report JSON，只写不含 body 的 intake audit reason。通过检查的 `agentQuery` 仍只是审计文本；不得被 `fetch`、数据库或 shell 执行。

### 5.3 Alert reference 与 case 归属

服务端使用规范化的 `(fingerprint, startsAt)` 查找批次 5.0 receipt：

1. 每个引用都必须存在，且没有重复 tuple。
2. 多个 receipt 必须属于同一个内部 incident；否则返回 `ALERT_SET_CONFLICT`。由 Alertmanager 并行 delivery 导致 receipt 尚未到达时，返回可重试的 `ALERT_RECEIPT_UNAVAILABLE`，不创建部分 report。
3. receipt 的 `MATCHED`、`UNMATCHED` 或 `AMBIGUOUS` 不影响合法性。后两者作为 case/report limitation 保存。
4. incident 的 `evaluation_closed_at` 不为空时，返回 `EVALUATION_CLOSED`。
5. 在 case 仍未开始评估时，新的不同 `reportId` 可依规则替换 selection；已经开始或完成的 case 只能通过 Operator 显式重试或 reopen 选择新 report。

此设计允许 Agent 只引用 incident 已知 alert 集合的一部分。Evaluator 后续计算 `COMPLETE`、`PARTIAL` 或 `UNKNOWN` coverage，而不是在 report 阶段将 partial 伪装成非法。

## 6. 持久化与幂等 handoff

### 6.1 不可变 report

```sql
CREATE TABLE agent_rca_reports (
  report_id VARCHAR(128) NOT NULL PRIMARY KEY,
  payload_hash CHAR(64) NOT NULL,
  schema_version VARCHAR(64) NOT NULL,
  incident_id BIGINT NOT NULL,
  agent_name VARCHAR(128) NOT NULL,
  agent_version VARCHAR(128) NOT NULL,
  payload_json JSON NOT NULL,
  received_at DATETIME(3) NOT NULL,
  received_principal_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_agent_rca_report_incident FOREIGN KEY (incident_id)
    REFERENCES alert_incidents(incident_id) ON DELETE RESTRICT,
  INDEX idx_agent_rca_reports_incident_received (incident_id, received_at),
  CHECK (schema_version = 'agent-rca-report.v1')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE agent_rca_report_alert_refs (
  report_id VARCHAR(128) NOT NULL,
  alert_receipt_id BIGINT NOT NULL,
  role VARCHAR(16) NOT NULL,
  PRIMARY KEY (report_id, alert_receipt_id),
  CONSTRAINT fk_agent_rca_report_ref_report FOREIGN KEY (report_id)
    REFERENCES agent_rca_reports(report_id) ON DELETE RESTRICT,
  CONSTRAINT fk_agent_rca_report_ref_receipt FOREIGN KEY (alert_receipt_id)
    REFERENCES alert_receipts(alert_receipt_id) ON DELETE RESTRICT,
  CHECK (role IN ('primary', 'supporting'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`payload_json` 只保存通过 Schema 和安全策略的 bounded report JSON。`received_principal_hash` 是 ingress 用户名的不可逆标识，用于低敏审计；密码、Authorization header 和 client IP 不进入这个表。

需要额外记录被拒绝、重复或冲突的请求时，使用不保存请求体的 `agent_rca_report_intake_audits`，字段限定为随机 request ID、report ID（若可解析）、report hash（若可安全计算）、结果码、principal hash 和接收时间。

### 6.2 事务性 evaluation handoff

提交事务的顺序固定为：

```text
锁定 receipt/incident/case
  -> 确认 closure 和选中 report 规则
  -> INSERT agent_rca_reports
  -> INSERT agent_rca_report_alert_refs
  -> 创建或更新 evaluation_case
  -> INSERT evaluation_job (QUEUED)
  -> INSERT intake audit
  -> COMMIT
```

`evaluation_cases` 和 `evaluation_jobs` 是批次 5.1/5.2 的共享 schema 合同，完整状态和 worker 语义由 [批次 5.2 技术设计](../batch-5-2-evaluator/tech.md)定义。批次 5.1 可以写入 `QUEUED` job，但在 `RCA_EVALUATOR_ENABLED=false` 时不会启动 worker；这样不会用内存 callback 或 Redis list 丢失已接受的报告。

对 `report_id` 的冲突处理：

| 已存记录 | 新请求 | 结果 |
| --- | --- | --- |
| 不存在 | 合法 report | `ACCEPTED`，仅入队一次。 |
| 相同 ID、相同 hash | 任意网络重试 | `DUPLICATE`，返回原接受事实，不新增 job。 |
| 相同 ID、不同 hash | 复用或篡改 | `REPORT_ID_REUSED`，409，不更新已有内容。 |
| case 已关闭 | 新 ID | `EVALUATION_CLOSED`，409，不写 report。 |

响应只包含 `reportId`、disposition 和服务端接收时间；不包含 case/job/incident/Fault Run/manifest/database ID，也不泄露 Ground Truth。

## 7. Operator 边界

Agent RCA report endpoint 不提供 case 浏览、job 状态、重试、abandon、close 或 remediation outcome 写入。它们是批次 5.2 的 Operator-only 接口，必须沿用 operator session、CSRF 和 `operator_audit_logs`。

Agent 也不被授予通过 report endpoint 查询其他 report、receipt、alert group、Fault Run、业务订单或 Agent 结果的能力。重复 report 只返回自己 `reportId` 的既有 disposition，不能成为枚举入口。

## 8. 配置、迁移和回退

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `AGENT_RCA_ALERT_DELIVERY_ENABLED` | `false` | 是否写入并启用由 Catalog 派生的 Agent Alertmanager route。 |
| `AGENT_RCA_REPORT_INGRESS_ENABLED` | `false` | 是否接受外部 AgentRcaReport。 |
| `AGENT_RCA_REPORT_USERNAME` / `PASSWORD` | 无 | ingress 与 route 双层验证的专用凭据。 |
| `AGENT_RCA_REPORT_MAX_BODY_BYTES` | `262144` | report body 上限。 |
| `AGENT_RCA_PILOT_SCENARIO` | 无 | 仅用于与 Catalog 唯一 pilot 交叉验证；不能成为第二份 selector。 |

数据库继续使用运行时幂等 schema 加 `infra/mysql/init` 双轨迁移。新增表不得对 `fault_runs` 使用级联外键。启用顺序必须是：

1. 部署 schema、report handler 和所有开关关闭的代码。
2. 部署 Secret、Nginx/Ingress、只读观测 allowlist 和 direct-backend 阻断。
3. 渲染、静态检查并 reload Alertmanager 的 pilot route，但仍关闭 delivery。
4. 开启 internal intake，确认真实 receipt。
5. 开启单个 pilot external receiver，再开启 report ingress。
6. 最后开启 evaluator worker。

回退时先禁用/reload pilot external child route，再关闭 report ingress；internal intake、receipt、report 和 queued job 都保留。若外部凭据泄露，只轮换对应 Agent webhook/report/observation credential，不影响 Operator、JWT 或内部 service key。

## 9. 测试设计

### 9.1 单元和合同测试

- JSON Schema 对版本、必填字段、未知核心字段、数组/长度/深度和 timestamp 均严格校验。
- secret/executable/control-plane remediation 拒绝规则覆盖嵌套 `extensions` 和文本字段。
- `(fingerprint, startsAt)` 规范化与批次 5.0 lookup 使用同一 fixture。
- 缺 receipt、跨 incident、closed case、`UNMATCHED`、`AMBIGUOUS`、partial coverage 和重复 references 的结果明确。
- 相同 ID/same hash 与相同 ID/different hash 的幂等语义。
- Catalog 只允许一个 validated pilot，并能生成位于 severity route 前的 child route。

### 9.2 集成和部署测试

- Alertmanager 的 pilot route 同时实现 external firing delivery 和 internal receipt，不破坏 warning/critical 正常 receiver。
- 外部 Agent webhook 收到 Basic Auth，错误凭据导致 Alertmanager delivery failure 可观测，而不是控制面虚报成功。
- report ingress 对匿名、错凭据、错方法、超大 body 和非 report path 返回拒绝。
- 直接访问控制面端口不能绕过 ingress 边界或 route 内凭据检查。
- Agent observability credentials 无法访问 Alertmanager、Prometheus remote-write、Loki push、Tempo ingestion、控制面或业务写路径。
- 提交入库和 queue insert 在单一事务中成功或回滚；重复请求绝不创建第二个 job。
- 持久化、日志、Nginx access log 和结果 JSON 不出现密码、Authorization、控制面内部 ID 或 Ground Truth。

### 9.3 Pilot 环境验收

1. 用一个已核验的真实 firing alert 验证配置 route，而不是以合成 webhook 当成全部验收。
2. Agent 仅用公开 alert envelope 和只读入口完成一次结构化 report。
3. 验证 resolved 既不会重新触发 Agent，也不会关闭已接受的 report。
4. 验证 Agent 只引用 incident 的部分 receipt 时提交被接受，并为 batch 5.2 输出 coverage 限制。
5. 删除或停止 external route 后，确认内部 receipt 和 Operator 现有控制面仍正常工作。

## 10. 实施顺序

1. 固化并验证批次 5.0 receipt/incident 合同及唯一 pilot 的 Catalog 约束。
2. 实现受控 Alertmanager overlay、Secret-file receiver 和配置编辑器保护。
3. 实现专用 report ingress、route 认证和只读 observation path allowlist。
4. 实现 AgentRcaReport Schema、安全 validator、repository 和 intake audit。
5. 实现不可变 report 与事务性 `QUEUED` job handoff，先不启动 worker。
6. 在单一非生产环境验证 firing 直投、report、重试和回退。
7. 只有入口、secret、幂等和不泄露边界通过后，才开启批次 5.2 Evaluator。

批次 5.1 的完成标准是“Agent 可以安全提交可复查的 RCA 输入并获得一次持久化的评估请求”，不是“控制面已经认可 RCA”、更不是“建议已经执行”。
