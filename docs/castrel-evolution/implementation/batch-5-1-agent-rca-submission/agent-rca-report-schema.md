# AgentRcaReport v1 Schema 详细设计

> 状态：技术设计 v1
> 机器可读合同：[agent-rca-report.v1.schema.json](./agent-rca-report.v1.schema.json)
> 配套批次：[批次 5.1 技术设计](./tech.md)
> 面向对象：外部 RCA Agent、report ingress、Evaluator

## 1. 目的与边界

`AgentRcaReport` 是外部 Agent 向 Castrel-Chaos 返回 RCA、证据引用和**实际业务/基础设施** remediation 建议的唯一机器输入。它不是 Fault Run 控制协议、不是通用 webhook 注册格式，也不是自动修复脚本。

机器可读的唯一规范是同目录的 [`agent-rca-report.v1.schema.json`](./agent-rca-report.v1.schema.json)，采用 JSON Schema Draft 2020-12。本文定义该 Schema 的使用方式、字段语义和 JSON Schema 无法安全表达的跨字段规则。实现时将其原样复制到 `traffic-control-plane/src/lib/agent-rca-report.v1.schema.json`，并以 hash/fixture 测试确保源代码与本设计合同一致；运行时不从 `docs/` 读取文件。

下列信息永远不属于该协议：

- `taskId`、`evaluationId`、`faultRunId`、`incidentRef`、数据库 ID、fencing token、内部 operation 或 Ground Truth；
- Operator session、Cookie、Authorization、密码、token、service key、kubeconfig 和数据库连接信息；
- 任何可执行 URL、shell、SQL、脚本、callback 或自动 remediation 指令；
- `remediationExecuted`、`cleanupExecuted`、`score`、`passed` 等 Agent 无权声明的服务端事实。

## 2. 传输合同

| 项目 | 规范 |
| --- | --- |
| 公共入口 | `POST https://<agent-rca-ingress-host>/agent-rca/reports` |
| 应用入口 | `POST /api/agent-rca/reports`，仅由受限 ingress 映射 |
| Content-Type | 严格为 `application/json`，可带 `charset=utf-8` |
| 最大 body | 256 KiB，超限时不解析、不持久化 |
| 认证 | 专用 Agent RCA report Basic Auth，由 ingress 和 application route 双层验证 |
| Schema dialect | JSON Schema Draft 2020-12，`$id = urn:castrel:agent-rca-report:v1` |
| 成功语义 | `ACCEPTED` 或 `DUPLICATE`；成功不表示 RCA 已认可、建议已执行或业务已恢复 |
| 时效 | 不按固定 RCA 时限拒绝；显式关闭的 evaluation case 才返回 `EVALUATION_CLOSED` |

处理器必须先完成 body 大小和 JSON 深度限制，再使用明确声明的 `ajv` 与 `ajv-formats` 验证 Schema。实现使用 `ajv/dist/2020` 构造 Draft 2020-12 validator，并设置 `strict: true`、`allErrors: true`、`coerceTypes: false`、`useDefaults: false`、`removeAdditional: false` 和启用的 date-time format；未声明的传递依赖不能作为格式校验器。

## 3. 顶层模型

```text
AgentRcaReport
  ├── schemaVersion
  ├── reportId
  ├── alertRefs[]
  │     ├── fingerprint
  │     ├── startsAt
  │     └── role
  ├── agent
  │     ├── name
  │     └── version
  ├── affectedServices[]
  │     ├── service
  │     ├── components[]
  │     └── instances[] (optional)
  ├── diagnosis
  │     ├── summary
  │     ├── symptoms[] (optional)
  │     ├── rootCause
  │     │     ├── category
  │     │     ├── service
  │     │     ├── component
  │     │     ├── instances[] (optional)
  │     │     └── explanation
  │     ├── confidence
  │     └── uncertainties[]
  ├── evidenceRefs[]
  │     ├── evidenceId
  │     ├── kind
  │     ├── source
  │     ├── service
  │     ├── window
  │     │     ├── from
  │     │     └── to
  │     ├── agentQuery
  │     ├── observation
  │     └── supports[]
  ├── remediationRecommendation
  │     ├── summary
  │     └── actions[]
  │           ├── order
  │           ├── action
  │           ├── target
  │           ├── preconditions[]
  │           ├── risks[]
  │           ├── verification[]
  │           └── rollback[]
  ├── limitations[]
  ├── extensions (optional, bounded map)
  └── server-generated metadata (not in report JSON)
        └── reportReceivedAt
```

| 字段 | Schema 约束 | 服务端语义 |
| --- | --- | --- |
| `schemaVersion` | 常量 `agent-rca-report.v1` | 唯一版本选择器。未知版本不会降级解析。 |
| `reportId` | 1-128 位 URL-safe 标识符 | Agent 生成的幂等键。与 canonical payload hash 共同决定重试处理。 |
| `alertRefs` | 1-20 项，恰好一项 `primary` | Alertmanager 原生告警实例的 `(fingerprint, startsAt)` 引用；不是 capability 或内部 ID。 |
| `reportReceivedAt` | 不属于报告 JSON | 服务端在成功持久化报告时生成的接收时间；重复提交返回原值。 |
| `agent.name` / `agent.version` | 1-128 位受限标识符 | 追踪产生该结果的 Agent 实现；不得包含连接地址或凭据。 |
| `affectedServices` | 1-20 个 `AffectedService` 对象 | 报告级影响范围，供 Evidence、remediation 和 Evaluator 共同使用。 |
| `affectedServices[].service` | 小写 service 标识符 | 被影响或需要关注的服务；在同一报告内必须唯一。 |
| `affectedServices[].components` | 1-20 个唯一组件 | 属于该服务的表、缓存、锁、文件、依赖或业务路径，不等于 remediation 已执行。 |
| `affectedServices[].instances` | 可选的 1-20 个 string | 该服务中实际观察到受影响的实例；不是服务所有实例的完整清单。 |
| `affectedServices[].instances[]` | 1-128 位受限标识符 | 来自已授权观测 source 的非地址实例标签；不接受 IP、端口、URL、内部数据库 ID 或凭据。 |
| `diagnosis` | 结构化 RCA | Agent 的断言，Evaluator 会独立复查。 |
| `evidenceRefs` | 1-40 项受限证据引用 | Agent 使用过的查询与观察摘要；其中 query 仅作审计，绝不执行。 |
| `remediationRecommendation` | 至少一条声明性 action | 对真实问题的建议，而非控制面或演练操作。 |
| `limitations` | 最多 20 条 | Agent 自己已知的证据缺口与不确定性；允许空数组。 |
| `extensions` | 最多 20 个键的受限 JSON | 只供非评分辅助信息，不能覆盖核心字段或改变 Evaluator 行为。 |

服务端在 AgentRcaReport 通过 Schema、安全、告警引用和事务性持久化后，以数据库 `CURRENT_TIMESTAMP(3)` 写入 `reportReceivedAt`；它是报告的可信审计时间，不是 payload hash 的输入，也不能由 Agent 覆盖。该时间与批次 5.0 每个 alert receipt 的 `receivedAt` 不同，后者表示控制面收到 Alertmanager 通知的时间。

## 4. `alertRefs[]` 合同

每个 `alertRef` 都严格由以下三项构成：

```json
{
  "fingerprint": "alert-fp-01J8EXAMPLE",
  "startsAt": "2026-09-11T08:20:00Z",
  "role": "primary"
}
```

| 字段 | Schema 约束 | 服务端额外规则 |
| --- | --- | --- |
| `fingerprint` | 1-128 位字母、数字、点、下划线或连字符 | 必须与批次 5.0 receipt 的 Alertmanager fingerprint 精确匹配。 |
| `startsAt` | RFC 3339 date-time | 解析为 UTC 毫秒 canonical form 后，与 receipt identity 匹配。 |
| `role` | `primary` 或 `supporting` | 全文恰好一项为 `primary`；相同 tuple 不能以不同 role 重复出现。 |

跨字段规则：

1. Schema 的 `contains` 约束保证恰好一个 `primary`；服务端还必须确认 tuple 去重。
2. 每个 tuple 必须存在于 `alert_receipts`。与 Alertmanager parallel delivery 竞争时，返回可重试 `ALERT_RECEIPT_UNAVAILABLE`，不写入部分 report。
3. 多个 receipt 必须属于同一个内部 incident。`groupKey` 相同不能替代 incident membership；跨 incident 时返回 `ALERT_SET_CONFLICT`。
4. `MATCHED`、`UNMATCHED`、`AMBIGUOUS` 和 `NOT_REQUIRED` 是 receipt 的内部关联事实，均不改变 Schema 合法性。Evaluator 在报告中表达限制。
5. `startsAt` 不承担提交窗口。Alert resolved、Fault Run 到期和 telemetry retention 过期都不能单独使合法 tuple 失效。

时间 canonicalization 统一为：解析带时区的 RFC 3339 值，转换 UTC，固定为毫秒精度，再序列化为 `YYYY-MM-DDTHH:mm:ss.SSSZ`。若输入包含无法无损表示到毫秒的非零更高精度，ingress 返回 `INVALID_ALERT_REFERENCE_TIMESTAMP`，而不是静默截断为另一个告警实例。

## 5. `diagnosis` 合同

| 字段 | Schema 约束 | 评估语义 |
| --- | --- | --- |
| `summary` | 1-4096 字符 | 面向人的 RCA 摘要，不能替代结构化根因。 |
| `symptoms` | 可选，最多 20 项 | Agent 观察到的症状；与独立 evidence 交叉验证。 |
| `rootCause.category` | 固定十类枚举 | Evaluator 对照服务端 Ground Truth predicate 输出 assessment，不回传隐藏答案。 |
| `rootCause.service` | 小写 service 标识符 | 主要归因服务，必须可映射到受控业务/基础设施名称。 |
| `rootCause.component` | 1-1024 字符 | 主要业务或基础设施组件，不得是内部控制操作。 |
| `rootCause.instances` | 可选的 1-20 个 string | 可确认时标识主要因果实例；无法可靠定位时省略。 |
| `rootCause.explanation` | 1-4096 字符 | 解释性断言，需由 `evidenceRefs` 支持。 |
| `confidence` | 数值 `0..1` | Agent 自评，不是 Evaluator 分数。 |
| `uncertainties` | 最多 20 项 | 已知替代解释、缺失数据或查询限制。 |

`UNKNOWN` 是有效根因类别。它要求 Agent 保留不确定性，并允许 Evaluator 给出 `UNDETERMINABLE`；不得为了通过 Schema 或评估而编造精确根因。

`rootCause.component` 是稳定、可定位的**名词对象**，用于回答“哪个业务或基础设施组件是主要根因”，例如 `product-listing request capacity`、`payment PSP authorization dependency` 或 `catalog report query plan`。它应足够具体，供 Evaluator 将诊断与受控 evidence contract 对齐，但不能写入 Fault Run、worker、release 或 cleanup 等控制面对象。

`rootCause.explanation` 是可证伪的**因果断言**，用于回答“为什么这个对象被判断为根因”。例如，上例将持续流量、观察到的处理能力和下游延迟之间的关系写成一句完整解释。它不是日志摘录、建议动作或单纯症状；至少一个 `evidenceRefs[].supports` 必须包含 `root_cause`，且 Evaluator 会用服务端受控 recipe 独立复查。

`rootCause.component` 有意保持单值：它标识本次报告的**主要因果对象**，使 Evaluator 能对一个明确断言进行验证。若问题同时影响多个组件，它们都应归入顶层 `affectedServices[].components[]`；若无法辨别唯一主要对象，应使用 `rootCause.category = "UNKNOWN"` 并在 `uncertainties` 中说明，而不是将多个候选根因塞入数组。

`instances` 有意保持可选。全局流量、配置、共享依赖或证据不完整时，Agent 不应猜测一个 pod、节点或副本；此时省略 `instances` 并在 `uncertainties` 说明。若提供实例，它只能是观测系统已公开的非地址标签，而不是 IP、端口、URL、内部数据库 ID 或控制面 ID。

## 6. `affectedServices[]` 合同

`affectedServices` 是报告级的必填影响范围，不属于 `diagnosis`。它将原先分散的服务与影响组件信息合并为服务对象，避免“第 N 个组件属于第 N 个服务”的脆弱隐含约定；Evidence、remediation 和 Evaluator 都以它作为共同上下文。

| 字段 | Schema 约束 | 服务端规则 |
| --- | --- | --- |
| `affectedServices` | 1-20 个 `AffectedService` 对象 | 每项表达一个受影响服务及其资源范围。 |
| `affectedServices[].service` | 小写 service 标识符 | 同一报告内必须唯一；不能用控制面、内部 operation 或任意外部 URL 伪装服务。 |
| `affectedServices[].components` | 1-20 个唯一 string | 该服务受影响的表、缓存、锁、文件、依赖或业务路径；至少一个元素。 |
| `affectedServices[].instances` | 可选 1-20 个唯一 string | 已观察到受影响的非地址实例标签；不是服务全部实例清单。 |

跨字段规则：

1. `diagnosis.rootCause.service` 必须位于顶层 `affectedServices[].service` 中。
2. `diagnosis.rootCause.component` 必须位于该服务的 `components[]` 中。
3. `diagnosis.rootCause.instances` 存在时，每个实例必须位于该服务的 `instances[]` 中；没有可靠的根因实例时省略前者，没有可靠的受影响实例时省略后者。
4. `components[]` 和 `instances[]` 分别在所属服务对象内去重；同一组件可以出现在多个服务对象中，但必须代表可解释的共享依赖或业务路径。
5. `evidenceRefs[]` 是实例、组件和根因判断的唯一证据模型：`evidenceRefs[].service`、`window` 和 `supports` 描述证据的适用范围，Evaluator 再用受控 recipe 独立复查。因此不在 `instances[]` 或其他嵌套对象中重复维护 `evidenceIds`，避免同一关系出现两个可分歧的来源。

## 7. `evidenceRefs[]` 合同

每一项定义“Agent 看到了什么”，而不是“Evaluator 应执行什么”：

| 字段 | Schema 约束 | 服务端规则 |
| --- | --- | --- |
| `evidenceId` | 1-64 位受限标识符 | 必须在同一 report 内唯一。 |
| `kind` | metric、log、trace、business_check、resource_check | 决定允许的 source 组合。 |
| `source` | prometheus、loki、tempo、business_api、resource_api | Schema 用 `if/then` 固定 kind/source 映射。 |
| `service` | 必填 | 必须是受控服务标识，不能为控制面伪造业务事实。 |
| `window.from/to` | 两个 RFC 3339 时间 | `from < to`，且必须落在关联 receipt/manifest 的允许时间范围。 |
| `agentQuery` | 1-2048 字符 | 仅存审计文字；永不传给 query executor。 |
| `observation` | 1-4096 字符 | Agent 对结果的摘要，不是原始数据副本。 |
| `supports` | 1-4 个枚举 | 明确该证据支持 symptom、root cause、impact 或 remediation 的哪一部分。 |

Schema 固定的 kind/source 组合如下：

| `kind` | 唯一 `source` |
| --- | --- |
| `metric` | `prometheus` |
| `log` | `loki` |
| `trace` | `tempo` |
| `business_check` | `business_api` |
| `resource_check` | `resource_api` |

### 7.1 `business_check` 与 `resource_check`

两者都不是让 Agent 自由调用的通用 API。每个检查必须先由 Scenario Evidence Contract 和 Evidence Query Manifest 声明为一个固定、只读的检查键；Agent 只能通过部署允许的入口调用该键，Evaluator 再用服务端受控的相同检查独立复查。

| 类型 | 回答的问题 | 唯一 source | `agentQuery` 的含义 | 示例检查键 | 明确不允许 |
| --- | --- | --- | --- | --- | --- |
| `business_check` | 真实业务路径是否可用、失败或恢复，例如商品列表、订单查询、库存可用性或支付结果。 | `business_api` | 固定业务只读检查键，不是 URL。 | `product-listing-read-check` | 消费者写 API、订单/支付/库存写入、`/internal/**`、任意 Gateway operation。 |
| `resource_check` | 支撑业务路径的特定资源状态是否异常，例如受控缓存状态、锁诊断、存储增长摘要或依赖可用性。 | `resource_api` | 固定资源只读检查键，不是命令、SQL 或资源连接串。 | `catalog-cache-state-check` | 直接 Redis/MySQL/JMX/文件系统/Kubernetes 访问、shell、任意主机或数据库查询。 |

`business_check` 关注的是**业务结果**，例如“商品列表是否仍能被正常读取”；`resource_check` 关注的是**资源事实**，例如“与该业务路径相关的受控缓存状态是否符合预期”。同一个问题可以同时使用两类证据，但它们不能相互替代：资源正常不证明业务恢复，业务可读也不证明资源状态完全正常。

对这两类检查，`evidenceRefs[].service` 必须是对应受影响服务，`window` 必须在 manifest 允许范围内，`observation` 只记录有界摘要。`agentQuery` 只保存 Agent 使用的检查键作为审计文本，Evaluator 绝不从该字符串构造 URL、执行命令或选择任意 operation。

## 8. `remediationRecommendation` 合同

每条 action 必须是非可执行的声明性建议，且完整描述变更风险：

| 字段 | Schema 约束 | 语义 |
| --- | --- | --- |
| `summary` | 1-4096 字符 | 建议针对的真实业务/基础设施问题摘要。 |
| `actions` | 1-10 项 | 执行顺序由 `order` 表达。 |
| `order` | 整数 `1..10` | 服务端确认从 1 开始连续且不重复。 |
| `action` | 1-4096 字符 | 人工审批后可执行的描述，不是命令或脚本。 |
| `target` | 1-1024 字符 | 业务服务、依赖、资源或配置；不能是 Fault Run 或控制面。 |
| `preconditions` | 1-10 项 | 执行前必须确认的安全/业务条件。 |
| `risks` | 1-10 项 | 变更副作用或不确定性；不能省略。 |
| `verification` | 1-10 项 | 通过真实业务或基础设施检查验证效果。 |
| `rollback` | 1-10 项 | 通过正常变更流程回退实际修复。 |

JSON Schema 不能可靠判断自然语言是否包含可执行危险内容，因此 `AgentRcaReportSafetyValidator` 还会在所有字符串字段中拒绝：

- 代码块、shell substitution、重定向、管道、`curl`、`wget`、`kubectl`、`sudo` 和明显的命令语法；
- SQL statement、DDL/DML、连接字符串、任意 URL 或 callback；
- `fault run`、`release`、`cleanup`、control-plane、Worker、Alertmanager、Evaluator 等作为 remediation 的操作目标；
- 密钥名、Bearer/Basic 凭据、私钥、Cookie、内网服务地址和内部 operation payload。

安全 validator 报错时不回显命中的敏感文字，也不持久化原 payload。

## 9. `extensions` 合同

`extensions` 用于不影响 v1 判定的低风险辅助字段。它最多有 20 个以小写字母开头的键，每个递归对象最多 10 个键、数组最多 10 项、字符串最多 1024 字符。入口还对整个 JSON 施加最大 12 层深度。

`extensions` 禁止：

- 复制、重命名或覆盖任一顶层业务字段；
- 放入 credentials、URL、脚本、SQL、控制面身份或分数；
- 充当自定义 query、callback、自动 remediation 或 schema 版本逃逸通道。

Evaluator v1 不读取 `extensions` 进行 RCA、evidence、remediation 或 score 判定。未来若某项扩展需要改变机器语义，必须发布新 `schemaVersion`，不能偷偷扩大 v1。

## 10. 完整合法示例

以下 JSON 可直接通过 `agent-rca-report.v1.schema.json` 的结构校验；其中的时间、fingerprint 和观察内容仅用于说明，不代表一个已选择或已触发的 pilot。

```json
{
  "schemaVersion": "agent-rca-report.v1",
  "reportId": "rpt_01J8EXAMPLE",
  "alertRefs": [
    {
      "fingerprint": "alert-fp-01J8EXAMPLE",
      "startsAt": "2026-09-11T08:20:00Z",
      "role": "primary"
    },
    {
      "fingerprint": "alert-fp-01J8SUPPORTING",
      "startsAt": "2026-09-11T08:21:00Z",
      "role": "supporting"
    }
  ],
  "agent": {
    "name": "example-rca-agent",
    "version": "0.1.0"
  },
  "diagnosis": {
    "summary": "Product-listing traffic increased while the gateway and catalog path showed elevated latency.",
    "symptoms": [
      "Product-listing request rate remained above the baseline window.",
      "Gateway and catalog request latency increased during the active window."
    ],
    "rootCause": {
      "category": "TRAFFIC",
      "service": "gateway-service",
      "component": "product-listing request capacity",
      "instances": [
        "gateway-service-1"
      ],
      "explanation": "Sustained product-listing traffic exceeded the currently observed request-handling capacity, which propagated elevated latency to the catalog read path."
    },
    "confidence": 0.78,
    "uncertainties": [
      "The available evidence does not isolate a single capacity limit."
    ]
  },
  "affectedServices": [
    {
      "service": "gateway-service",
      "components": [
        "product-listing request capacity",
        "product-listing request path"
      ],
      "instances": [
        "gateway-service-1"
      ]
    },
    {
      "service": "catalog-service",
      "components": [
        "catalog read capacity"
      ],
      "instances": [
        "catalog-service-1"
      ]
    }
  ],
  "evidenceRefs": [
    {
      "evidenceId": "metric-traffic-rate",
      "kind": "metric",
      "source": "prometheus",
      "service": "gateway-service",
      "window": {
        "from": "2026-09-11T08:15:00Z",
        "to": "2026-09-11T08:30:00Z"
      },
      "agentQuery": "sum(rate(http_server_requests_seconds_count{service=\"gateway-service\",uri=\"/api/products\"}[5m]))",
      "observation": "The product-listing request rate remained higher than the preceding baseline window.",
      "supports": [
        "symptom",
        "impact"
      ]
    },
    {
      "evidenceId": "trace-latency",
      "kind": "trace",
      "source": "tempo",
      "service": "catalog-service",
      "window": {
        "from": "2026-09-11T08:20:00Z",
        "to": "2026-09-11T08:30:00Z"
      },
      "agentQuery": "{ resource.service.name = \"catalog-service\" && span.http.route = \"/api/products\" }",
      "observation": "Catalog request duration increased during the same alert window.",
      "supports": [
        "symptom",
        "root_cause"
      ]
    },
    {
      "evidenceId": "business-listing-check",
      "kind": "business_check",
      "source": "business_api",
      "service": "catalog-service",
      "window": {
        "from": "2026-09-11T08:20:00Z",
        "to": "2026-09-11T08:30:00Z"
      },
      "agentQuery": "product-listing-read-check",
      "observation": "The product-listing read path remained available but returned more slowly than the baseline.",
      "supports": [
        "impact",
        "remediation"
      ]
    }
  ],
  "remediationRecommendation": {
    "summary": "Review the approved request-shaping and capacity configuration for the product-listing path, then verify the business path returns toward baseline.",
    "actions": [
      {
        "order": 1,
        "action": "Review and apply the approved request-shaping or capacity change for product-listing traffic through the normal change process.",
        "target": "gateway-service product-listing traffic policy",
        "preconditions": [
          "Confirm that elevated traffic and latency are still present in the current environment.",
          "Confirm the proposed change has an approved capacity and rollback plan."
        ],
        "risks": [
          "Traffic shaping can temporarily reduce product-listing throughput for some consumers."
        ],
        "verification": [
          "Compare product-listing request rate, latency, and error rate with the baseline window.",
          "Confirm gateway-service and catalog-service health after the approved change."
        ],
        "rollback": [
          "Revert the approved traffic or capacity change through the normal deployment or configuration process."
        ]
      }
    ]
  },
  "limitations": [
    "This report does not prove that the recommended remediation has been executed."
  ],
  "extensions": {
    "analysisMode": "read_only"
  }
}
```

## 11. 接收结果和错误合同

成功响应仍使用控制面统一 envelope：

```json
{
  "code": 0,
  "message": "accepted",
  "data": {
    "reportId": "rpt-01J8EXAMPLE",
    "disposition": "ACCEPTED",
    "reportReceivedAt": "2026-09-11T08:30:01.000Z"
  }
}
```

| 代码 | HTTP | 是否可重试 | 说明 |
| --- | ---: | --- | --- |
| `ACCEPTED` | 202 | 否 | 已持久化并仅入队一次；不表示已评估。 |
| `DUPLICATE` | 200 | 否 | `reportId` 与 canonical payload hash 均相同，返回原接受事实。 |
| `UNSUPPORTED_SCHEMA_VERSION` | 400 | 修改 payload 后 | 不尝试猜测或降级解析。 |
| `INVALID_AGENT_RCA_REPORT` | 400 | 修改报告后 | Schema 失败；可返回安全的 JSON Pointer，不回显内容。 |
| `REPORT_TOO_LARGE` / `REPORT_TOO_DEEP` | 413 / 400 | 修改报告后 | 在 Schema 前拒绝。 |
| `DANGEROUS_AGENT_RCA_REPORT_CONTENT` | 400 | 修改报告后 | 安全策略失败，不保存 body。 |
| `INVALID_ALERT_REFERENCE_TIMESTAMP` | 400 | 修改 payload 后 | `startsAt` 无法与 receipt 的毫秒身份无损匹配。 |
| `ALERT_RECEIPT_UNAVAILABLE` | 409 | 是 | Alertmanager parallel intake 尚未持久化 receipt，或 receipt 不存在。 |
| `ALERT_SET_CONFLICT` | 409 | 修改 payload 后 | 多个 alert reference 不属于同一个 incident。 |
| `EVALUATION_CLOSED` | 409 | 否 | Operator/服务端已显式关闭该 incident 的 case。 |
| `REPORT_ID_REUSED` | 409 | 使用新 ID 并审查报告 | 同 ID 不同 canonical hash，已有不可变记录不会覆盖。 |

任何 5xx 都不能写成功形状的 response；事务回滚后 Agent 可按通常的有限退避重试。错误日志只记录错误码、body 大小和安全 request ID。

## 12. Canonical report hash 与幂等

服务端在 Schema 与安全验证成功后：

1. 按稳定 key 顺序序列化 JSON；
2. 保留数组顺序，特别是 `alertRefs` 和 remediation action 顺序；
3. 将 RFC 3339 时间替换为 canonical UTC 毫秒形式；
4. 计算 SHA-256 `payloadHash`；
5. 在同一个 MySQL transaction 中比较/插入 `reportId`、写 report、reference membership、case 和 queue job。

相同 ID 加相同 hash 是网络重试；相同 ID 加不同 hash 是冲突。不同 `reportId` 的相同内容是新的 Agent 报告，是否能取代尚未开始的 case selection 由批次 5.1/5.2 的状态机决定，不由 JSON Schema 决定。

## 13. 版本演进

- v1 是 append-only contract：已接受的 v1 JSON 永远用 v1 validator 读取。
- 新必填字段、语义变化、新的 evidence source/kind、改变 remediation 安全模型或让 `extensions` 影响评分，都必须创建 `agent-rca-report.v2`。
- v2 与 v1 可并行接受，但各自使用独立 `$id`、validator、hash 算法版本和 EvaluationReport 可追溯关联。
- 只有在所有未关闭的 v1 case 都完成审计保留后，才可停止接受 v1；停止接受不删除历史 report。

## 14. 实施验收

- 使用 Ajv Draft 2020-12 加 `ajv-formats` 对 Schema 正反 fixture 执行验证。
- 覆盖唯一 primary、kind/source 错配、未知字段、超长值、重复 `evidenceId`/alert tuple、`window.from >= window.to` 和 action `order` 非连续等 Schema 外规则。
- 覆盖 secret、URL、shell、SQL、控制面 remediation 和嵌套 `extensions` 的安全拒绝。
- 覆盖 timestamp canonicalization、receipt race、partial alert coverage、`UNMATCHED`/`AMBIGUOUS` 允许、closed case、同 ID 同/异 hash 和事务回滚。
- 确认成功/错误 response、数据库、日志、审计和 Agent-visible JSON 均不包含内部 incident/Fault Run/evaluation ID、凭据或 Ground Truth。
