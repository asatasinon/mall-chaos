# 阶段 5：告警驱动的 Agent RCA 试点

> 状态：当前路线最后阶段；依赖阶段 0～4
> 配套技术设计：[批次 5.0](../../implementation/batch-5-0-alert-intake/tech.md)、[批次 5.1](../../implementation/batch-5-1-agent-rca-submission/tech.md)、[批次 5.2](../../implementation/batch-5-2-evaluator/tech.md)

## 目标

在资源与数据隔离平台通用化之前，用专用、非生产、单运行环境验证：

```text
告警 -> 外部 Agent 只读观测 -> RCA/建议提交 -> 自动评估
```

实际场景 remediation 执行不属于本阶段 Agent 能力。

本阶段必须先选择一个通过阶段 0 告警基线的场景。不要为了触发 Agent 而新增伪造告警或把所有通用告警强行映射到场景。

Pilot candidate 至少满足：

- 现有 alert rule 在专用环境中可稳定触发，并能通过 alert receipt 关联到唯一运行。
- 只读观测入口已经可用，Agent 不需要访问控制面或业务写 API。
- 目标业务/基础设施问题的 remediation 可以用声明性建议描述，不依赖 Agent 执行 Fault Run stop/release/cleanup。
- baseline、active、recovery 查询窗口清晰；由于本阶段不保存现场数据，必须确认观测 retention 足以完成一次 RCA。
- 不会因为 Operator 不采纳建议而留下不可控的破坏性资源。

推荐先从 `BROWSE_SURGE`、`PSP_PROVIDER_OUTCOME` 等有明确告警和业务路径的候选中选择一个，最终以阶段 0 的实际阈值和环境验证结果为准；不默认把推荐名称当作已选场景。

## 5.0 先补告警接收与关联基础

这是阶段 5 的前置子阶段，必须在外部 Agent 接入前完成。阶段 0 只负责核对现状、记录阻塞和选择候选场景；阶段 5 负责补齐缺失实现。

### 必须实现

1. **控制面 Alertmanager webhook route**
   - 实现配置中使用的 `POST /internal/alertmanager/webhook` 或等价内部 route。
   - 只允许 Alertmanager 所在内部网络调用；不把该 route 作为外部 Agent API。
   - 解析 Alertmanager webhook payload 的 `status`、`groupKey`、`commonLabels`、`commonAnnotations` 和 `alerts[]`。
   - 同时处理 `firing`、`resolved`、grouped alerts 和 `send_resolved`。
2. **告警接收记录**
   - 保存 `fingerprint`、alert name、severity、service、startsAt、endsAt/resolvedAt、receivedAt、groupKey、status 和关联结果。
   - 保存最小字段，不保存指标、日志、Trace 或完整 Alertmanager payload 中的秘密/无关内容。
   - 对同一 fingerprint 和 startsAt 做幂等去重，重复 webhook 不重复创建告警实例。
3. **告警与 Fault Run 关联**
   - 告警接收和 Agent 投递不以 Fault Run 关联成功为前置条件；Fault Run 关联只是控制面内部的可选审计上下文。
   - 根据 Scenario Contract 的 alert contract、服务、规则、时间窗口和 active Fault Run 候选做关联，并记录 `faultRunCorrelationStatus`。
   - 零匹配记录 `faultRunCorrelationStatus=UNMATCHED`；多匹配记录 `faultRunCorrelationStatus=AMBIGUOUS`，两者都不阻断外部 Agent 投递或一般 RCA Evaluator。
   - 为每个告警实例生成/确认 `alertRef`；外部 Agent 可以收到一个或多个告警引用。
4. **Alertmanager 外部 receiver**
   - Alertmanager 直接向外部 Agent webhook 投递，不新增 Alert Delivery Gateway。
   - receiver 使用部署侧 Nginx Basic Auth 保护的 Agent webhook 地址和 Basic Auth 配置。
   - Alertmanager 的内部控制面 webhook 与外部 Agent webhook 是两个独立 receiver。
   - 只为阶段 5 选定的 alert name/service 配置专用 child route，不把默认、warning 或 critical 全量告警发送给 Agent。
   - Agent webhook URL、Basic Auth 用户名/密码由部署配置提供，不接受 Agent 在运行时注册任意 callback URL。
5. **AgentRcaReport 接收入口**
   - 对外提交入口由统一 Nginx Basic Auth 拦截未认证请求。
   - 通过 `agent-rca-report.v1` JSON Schema 校验。
   - 校验 `alertRefs[]` 中每个引用是否存在以及评估是否关闭；`faultRunCorrelationStatus` 为 `UNMATCHED` 或 `AMBIGUOUS` 时仍保存提交，并在评估报告中记录限制。
   - 保存幂等的 report metadata，然后自动排队 Evaluator。

### 必须测试

- Alertmanager `firing` payload。
- Alertmanager `resolved` payload。
- grouped alerts 拆分为独立 alert fingerprint。
- 重复 webhook 幂等。
- `send_resolved` 关闭告警关联。
- 无匹配和多匹配 Fault Run。
- Alertmanager 到控制面 webhook 的内部网络访问。
- Alertmanager 到外部 Agent webhook 的 Basic Auth。
- 未认证访问 Agent webhook/提交入口被 Nginx 拒绝。
- 相同 `reportId` 重试不重复排队。
- 无效 `alertRefs[]`、未知 fingerprint 和已关闭评估被拒绝；有效但没有唯一 Fault Run 上下文的引用仍可评估，不因关联不完整阻断 Alertmanager 投递。

### 该子阶段不实现

- 不实现 Agent 细粒度授权。
- 不实现 Observation Gateway。
- 不实现 Agent 自动 remediation。
- 不实现并行调度、环境自动创建或规模化调度。
- 不把 Alertmanager 当前 API/UI 的 Nginx 认证误当作内部 webhook 认证。

## 触发链路

```text
控制面开启 Fault Run
  -> 真实业务行为产生影响
  -> Alertmanager 产生配置规则选中的 firing alert
  -> Alertmanager 通过内部 webhook 投递到 traffic-control-plane
  -> traffic-control-plane 接收并关联告警
  -> Alertmanager 通过 HTTP webhook + Basic Auth 投递给外部 Agent endpoint
  -> Agent 使用现有 Nginx Basic Auth 访问 Prometheus/Loki/Tempo/业务只读入口
  -> Agent 提交 AgentRcaReport.json
  -> AgentRcaReport endpoint 由 Nginx Basic Auth 拦截未认证请求并自动排队 Evaluator
```

这里有三个不同入口：

| 入口 | 作用 | 认证边界 |
| --- | --- | --- |
| Alertmanager HTTP API/UI | 人员或系统查看、管理 Alertmanager | 当前由 Compose `obs-auth-proxy` 的 Nginx Basic Auth 保护，例如宿主机 `19093` |
| Alertmanager → 控制面 webhook | Alertmanager 向控制面发送 `firing/resolved` | 容器/集群内部服务调用，不是宿主机 `19093` 这个 Alertmanager API/UI 入口 |
| Alertmanager → 外部 Agent webhook | Alertmanager 将选定告警直接投递给外部 Agent | Alertmanager receiver 使用 Basic Auth 调用 Agent webhook endpoint；不增加 Alert Delivery Gateway |
| AgentRcaReport endpoint | 外部 Agent 回传 `AgentRcaReport.json` | 对外暴露时由统一 Nginx Basic Auth 拦截未认证请求；阶段 5 不增加应用层细粒度授权 |

Nginx Basic Auth 不是 Alertmanager 的替代品：Alertmanager 负责产生、聚合和转发告警；Nginx 只负责对外 HTTP 入口的未认证拦截。外部 Agent webhook 的 Basic Auth 凭据由 Alertmanager receiver 使用，AgentRcaReport endpoint 的 Basic Auth 由部署入口使用。

### Alertmanager → 控制面 webhook 的作用

Alertmanager 直接向外部 Agent webhook 投递告警；控制面内部 webhook 是并行的**告警接收与关联通道**，主要用于：

1. **保存最小告警接收记录**
   - alert fingerprint；
   - alert name、severity、service；
   - `startsAt`、`resolvedAt`、控制面 `receivedAt`；
   - groupKey、当前状态和去重结果；
   - 关联结果与失败原因。
2. **关联当前 Fault Run**
   - 根据告警服务、规则、时间和活动运行判断是否属于某个 active Fault Run；
   - 无法关联时记录 `faultRunCorrelationStatus=UNMATCHED`；
   - 多个运行匹配时记录 `faultRunCorrelationStatus=AMBIGUOUS`；
   - `faultRunCorrelationStatus=UNMATCHED/AMBIGUOUS` 不阻断 Alertmanager 已配置的 Agent receiver，也不阻止基于告警和观测证据的 RCA Evaluator。
3. **生成/确认 `alertRef`**
   - 每个 `fingerprint + startsAt` 告警实例都有一个 `alertRef`；
   - 同一实际问题的多个 `alertRef` 可以由控制面聚合为内部 `incidentRef`；
   - Evaluator 通过 `alertRefs[]` 和 `incidentRef` 找到告警接收记录、Fault Run 和查询时间窗口。
4. **处理告警生命周期**
   - 接收 `firing` 和 `resolved`；
   - 处理重复通知和 grouped alerts；
   - 支持评估报告区分告警已恢复与业务 remediation 是否执行。
5. **审计和可观测性**
   - 记录 pilot route 是否已配置、控制面是否收到告警，以及后续是否收到 AgentRcaReport；不把并行控制面 receipt 误写为 Agent webhook 已成功处理；
   - 记录 AgentRcaReport 是否关联成功；
   - 为 Evaluator 提供告警来源事实和聚合后的 `incidentRef`。

该 webhook **不负责**：

- 保存 Prometheus 指标、Loki 日志或 Tempo Trace；
- 代理 Alertmanager API/UI；
- 执行 Fault Run stop/release/cleanup；
- 执行 Agent 的 remediation；
- 把控制面内部字段暴露给 Agent。

### Fault Run 关联是可选内部上下文

Agent RCA 的前提是告警和可查询的实际观测，不是必须存在或唯一匹配的 Fault Run。Fault Run 关联保留的价值是：

- 在受控演练中为 Operator 提供运行审计上下文；
- 让 Evaluator 在**唯一匹配成功时**参考该运行的时间线、目标 operation 和 recovery facts；
- 识别一个告警是否可能来自某个演练运行，而不是把它误当成确定事实。

它不用于：

- 决定 Alertmanager 是否向 Agent 投递；
- 要求 Agent 认识 Fault Run；
- 把 `remediationRecommendation` 转换成 Fault Run 控制动作；
- 在没有唯一匹配时阻止一般 RCA 评估。

判断发生在控制面内部 webhook 保存 alert receipt 之后，由 `FaultRunCorrelationResolver` 异步或事务后执行；不发生在 Alertmanager，也不发生在 Agent。告警接收记录至少保存：

```text
faultRunCorrelationStatus: NOT_REQUIRED | MATCHED | UNMATCHED | AMBIGUOUS
matchedFaultRunRef: internal nullable reference
candidateCount
correlationCheckedAt
correlationReason
```

候选匹配规则必须来自控制面内部的 Scenario Contract 和 Fault Run 事实：

1. 只读取 active 或最近结束的 Fault Run 候选，不把历史任意运行作为候选。
2. 比较 alert contract 声明的 alert name、service、severity、资源/operation 标签。
3. 比较 `startsAt`/`receivedAt` 与 Fault Run 的 active、expires、stop 时间窗口；允许的前后 grace 必须由 Contract 声明。
4. 如果部署环境或观测标签能够提供环境身份，则要求环境身份一致。
5. 一个候选命中则为 `MATCHED`；零个候选为 `UNMATCHED`；多个候选为 `AMBIGUOUS`；未启用 run correlation 的告警为 `NOT_REQUIRED`。
6. 不按“最近时间”或告警文本强行选择一个运行，不把多个候选压缩为一个确定关联。

`UNMATCHED` 和 `AMBIGUOUS` 都是内部限制，不是 Alertmanager 投递失败。Evaluator 只有在 `MATCHED` 时才能把 Fault Run Event 当作该告警的受控运行上下文；其他状态下仍可根据 alert receipt、Prometheus、Loki、Tempo 和业务检查执行 RCA，但必须在报告中记录 Fault Run 上下文不可确定。

当前 checkout 的 Alertmanager 配置已有类似 `/internal/alertmanager/webhook` 的目标，但控制面对应接收 route 尚未被确认实现。因此它是阶段 5 的实现阻塞项，而不是已经存在的功能。

## 进入本阶段前必须核对的告警接入

当前部署配置已经使用类似 `/internal/alertmanager/webhook` 的内部 webhook 配置；但在当前 checkout 的控制面 `src/app` 路由中没有找到对应的已实现接收 route。配置存在不等于控制面已有完整告警接收能力，因此阶段 5 目前被该能力阻塞。阶段 0/5 必须通过代码和集成测试确认：

- 控制面 webhook route 是否真实存在；Alertmanager 到该 route 使用内部服务网络。
- Alertmanager payload 的 `firing`/`resolved`、grouped alerts 和 `send_resolved` 是否正确处理。
- 对外告警/提交入口是否由统一 Nginx Basic Auth 拦截未认证请求。
- 选定告警规则、目标服务、严重级别和 active Fault Run 关联是否正确。
- fingerprint 去重、重复投递、告警接收记录、`startsAt`、`resolvedAt`、评估关闭和 retention 处理是否正确。
- Alertmanager grouped notification 的每个 alert 如何拆成独立 `alertRef`；一个问题产生的多个 `alertRef` 如何聚合为 `incidentRef`；`groupKey` 只表示通知分组，不直接表示根因事件。
- 外部 Agent webhook endpoint 是否真实可用，且 Alertmanager receiver 使用部署侧 Basic Auth 调用。
- Agent 是否能够使用部署侧提供的 Basic Auth 访问现有观测入口。
- 报告入口是否接收 `AgentRcaReport.json` 并自动排队 Evaluator。

阶段 5 不应把配置文件中的 webhook URL 当作现成实现；缺失部分属于本阶段的实现范围。

### AlertRef 与 IncidentRef

需要区分三个不同对象：

| 对象 | 含义 | 是否等于根因事件 |
| --- | --- | --- |
| `alertRef` | 一个 `fingerprint + startsAt` 告警实例的关联引用 | 否 |
| `groupKey` | Alertmanager 将多个 alert 放进同一通知的分组键 | 否，只是通知分组 |
| `incidentRef` | 控制面根据明确关联规则聚合的一组相关 `alertRef` | 表示“当前认为属于同一问题的告警集合”，不是自动证明根因 |

一个真实问题可能产生多个告警，例如延迟、错误率、连接池和节点资源告警。此时每个告警仍有独立 `alertRef`，多个 `alertRef` 可以属于同一个 `incidentRef`。不能把多个告警压缩成一个 fingerprint，也不能把 Alertmanager `groupKey` 直接当成 `incidentRef`。

单个告警引用只包含 Alertmanager 和控制面能够共同确认的实例字段：

```json
{
  "fingerprint": "alert-fp-01J8EXAMPLE",
  "startsAt": "2026-09-11T08:20:00Z"
}
```

`receivedAt` 是控制面内部接收事实，不放入由 Alertmanager 直接投递给 Agent 的 `alertRef`；AgentRcaReport 由服务端根据 `fingerprint + startsAt` 查找接收记录。

控制面在告警到达时做一次 admission：

- 校验 Alertmanager 来源和部署侧 Basic Auth/内部网络边界。
- 校验选定告警规则、目标服务、时间和 active Fault Run。
- 为每个 alert 保存最小接收记录并做 fingerprint 幂等。
- 根据 Scenario Contract、服务/资源关联、时间窗口、active Fault Run 和可选 correlation label 聚合 `incidentRef`。
- 记录告警到达时间、startsAt、resolvedAt（如有）、receivedAt、关联状态、去重结果和评估关闭状态。

Evaluator 通过 `alertRefs[]` 和内部 `incidentRef` 查找告警接收事实；不要求告警当前仍为 firing。`firing -> resolved` 是正常恢复过程。

如果告警无法唯一关联到一个 active Fault Run，或者匹配到多个运行，控制面分别记录 `faultRunCorrelationStatus=UNMATCHED` 或 `AMBIGUOUS`。在 Alertmanager 直接投递模式下，告警仍可能已经发送给 Agent；提交仍可进入 RCA Evaluator，但报告必须带上该限制，不得把任意一个候选 Fault Run 当作确定事实。只有多个 alert 能够确认属于同一问题时，才合并到同一个 `incidentRef`。

`incidentRef` 的关联窗口由 Scenario Contract、active Fault Run 时间线和选定告警规则共同决定；它是告警关联窗口，不是 AgentRcaReport 的固定过期时间。第一个告警到达后，后续相关告警可以加入同一个 incident；Agent 先提交一个告警的报告不会阻止控制面继续补充告警事实。

### Evaluation eligibility

RCA 评估不设置一个固定的 Agent 提交过期时间。只要告警接收记录存在且评估没有被服务端关闭，Agent 都可以提交报告；Prometheus/Loki/Tempo retention 只决定 Evaluator 能否复查证据，不决定提交本身是否有效：

```text
receivedAt = 服务端第一次接受该告警实例的时间
evaluationClosedAt = 服务端或 Operator 显式关闭评估的时间，可为空
observabilityRetention = Prometheus/Loki/Tempo 当前保留窗口
```

规则：

- `startsAt` 是 Prometheus/Alertmanager 观察到告警开始的时间，不用它单独计算 Agent 窗口；Agent 可能在 Alertmanager group wait 后才收到告警。
- `receivedAt` 由服务端记录并绑定到每个 `alertRef`；AgentRcaReport 不提供自报时间，服务端另为每个已接受报告生成 `reportReceivedAt` 审计事实。
- Alertmanager 的重复通知不会创建新的评估对象；同一 fingerprint 和 startsAt 仍归属于同一告警接收记录。
- 告警恢复为 `resolved` 不会使提交失效；恢复只影响观测时间线和后续 remediation 状态。
- `alertRefs[]` 是 Agent 实际使用的告警子集，不要求列出该 `incidentRef` 下的全部 alert receipts；只要每个已提交引用有效且可关联，提交仍可接收。
- 服务端只拒绝告警引用无效、告警集合内部互相冲突或明确关闭的提交；暂时无法唯一关联 Fault Run 的提交仍可接收和评估。如果观测 retention 已无法复查，提交仍可接收，但评估结果为 `EVIDENCE_UNAVAILABLE` 或部分证据不可用。
- 新一轮重新 firing 且 `startsAt` 改变时，为该告警实例生成新的 `alertRef`；如果与其他告警属于同一问题，则关联到已有或新的 `incidentRef`。
- v0 不因为经过固定分钟数、告警变为 resolved 或 Fault Run 到期而自动关闭评估；`evaluationClosedAt` 只在 Operator/服务端显式关闭或本次评估完成明确终态流程后写入。
- 评估为 `COMPLETED` 后，新的 AgentRcaReport 默认不再替换原报告；如需重新评估，Operator 必须显式重试或重新打开评估并记录原因。

例如控制面在一个 `incidentRef` 下已知 5 个告警，而 Agent 只提交其中 2 个有效 `alertRef`：提交允许进入 Evaluator，评估报告记录 `alertCoverageStatus=PARTIAL`。如果这 2 个告警已经足以支持 RCA，RCA 仍可以判定为正确；遗漏的 3 个告警只会作为覆盖度、证据充分性或诊断完整性的限制。

这几个时间必须分开：

| 时间 | 作用 |
| --- | --- |
| Fault Run `expiresAt` | 控制故障活动或租约何时到期 |
| Alert `startsAt` | 观测系统认为告警开始的时间 |
| Alert `receivedAt` | 控制面第一次接受告警的服务端时间 |
| Agent RCA report `reportReceivedAt` | 服务端接受并持久化 AgentRcaReport 的时间，仅作审计信息 |
| `evaluationClosedAt` | 服务端/Operator 关闭该告警评估的时间，可为空 |
| Observability retention end | Prometheus/Loki/Tempo 仍可查询该窗口的最晚时间 |

告警接收记录的保留时间与观测 retention 分开：观测数据可以过期并导致 `EVIDENCE_UNAVAILABLE`，但告警接收记录、AgentRcaReport 和评估状态仍应按 Fault Run/控制面 retention 保留，便于审计。

`alertRefs[]` 和 `incidentRef` 只是关联键，不是观测凭据。Agent 使用部署侧提供的统一 Nginx Basic Auth 访问现有观测入口：

- 观测入口：Prometheus、Loki、Tempo 和指定业务只读入口。
- Basic Auth 用户名/密码由部署环境注入，不写入 `AgentRcaReport.json`。
- Nginx 拒绝未认证请求；阶段 5 不新增应用层的 Agent 角色、租户或细粒度授权逻辑。

告警 envelope 或外部 Agent 的部署配置提供现有观测入口地址；不能把控制面内部 URL、数据库连接或 service key 直接暴露给 Agent。

Basic Auth 凭据不得写入 `AgentRcaReport.json`，也不得出现在 RCA、日志或 Markdown 展示文件中。

不新增 Observation Gateway。阶段 5 直接复用现有 Nginx Basic Auth 保护的 Prometheus、Loki、Tempo 和业务只读入口。

### 服务端评估状态和 retention 边界

以下信息由控制面/Evaluator 服务端维护或读取，不由 Agent 提供：

| 信息 | 来源 | 是否进入 `AgentRcaReport.json` |
| --- | --- | --- |
| `evaluationStatus` | Evaluator 评估记录，例如 `OPEN`、`RUNNING`、`COMPLETED`、`CLOSED`、`EVIDENCE_UNAVAILABLE`、`FAILED` | 否 |
| `evaluationClosedAt` | 服务端或 Operator 显式关闭评估 | 否 |
| Prometheus retention | Prometheus 部署配置、运行时 API 或查询结果 | 否 |
| Loki retention | Loki 部署配置、运行时 API 或查询结果 | 否 |
| Tempo retention | Tempo 部署配置、运行时 API 或查询结果 | 否 |
| `evidenceAvailability` | Evaluator 对每个查询窗口的实际查询结果 | 否；属于 Evaluation Report |
| `alertCoverageStatus` | Evaluator 对 `alertRefs[]` 与 incident 已知告警集合的覆盖判断 | 否；属于 Evaluation Report |
| `faultRunCorrelationStatus` | 控制面内部 Fault Run 关联器的结果 | 否；属于告警接收记录和 Evaluation Report |
| Agent RCA report `reportReceivedAt` | 服务端持久化报告时生成 | 否；只作为审计时间，不决定 retention |

因此：

- `AgentRcaReport.json` 只描述 Agent 的 RCA、证据引用和实际场景 remediation 建议。
- Agent 不填写 `evaluationStatus`、`evaluationClosedAt`、retention、`evidence_unavailable` 或评分结果。
- Evaluator 根据服务端评估状态判断是否接受新提交；评估已关闭返回 `EVALUATION_CLOSED`。
- Evaluator 根据观测系统实际可查询范围判断证据是否可用；数据不可查返回 `EVIDENCE_UNAVAILABLE`，不把它归因于 Agent RCA 错误。
- Evaluator 同时对比 `alertRefs[]` 与 incident 已知告警集合，生成 `alertCoverageStatus`；`PARTIAL` 表示 Agent 没有覆盖全部已知告警，但不是自动失败。
- 不同 Prometheus/Loki/Tempo 可能有不同 retention，Evaluator 应按查询窗口逐个判断，而不是只依赖一个全局 retention 数值。

## AgentRcaReport v1

完整的机器可读合同和跨字段安全语义见 [AgentRcaReport v1 Schema 详细设计](../../implementation/batch-5-1-agent-rca-submission/agent-rca-report-schema.md) 与 [agent-rca-report.v1.schema.json](../../implementation/batch-5-1-agent-rca-submission/agent-rca-report.v1.schema.json)。Schema 是 AgentRcaReport 字段约束的唯一来源；本阶段文档保留其产品和评估语义。

JSON 是唯一机器输入，Markdown 只能由 JSON 派生或用于人工查看。

规范最小结构：

```json
{
  "schemaVersion": "agent-rca-report.v1",
  "reportId": "rpt-01J8EXAMPLE",
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
    "summary": "商品浏览报表出现持续高延迟。",
    "symptoms": ["catalog-service report latency increased"],
    "rootCause": {
      "category": "DATABASE_QUERY",
      "service": "catalog-service",
      "resource": "product browse report",
      "explanation": "The report query is consuming increased database capacity."
    },
    "affectedServices": ["catalog-service"],
    "affectedResources": ["product browse report"],
    "confidence": 0.82,
    "uncertainties": ["The exact query plan was not available."]
  },
  "evidenceRefs": [
    {
      "evidenceId": "e-1",
      "kind": "trace",
      "source": "tempo",
      "service": "catalog-service",
      "window": {
        "from": "2026-09-11T08:20:00Z",
        "to": "2026-09-11T08:30:00Z"
      },
      "agentQuery": "{ resource.service.name = \"catalog-service\" }",
      "observation": "JDBC duration increased during the active window.",
      "supports": ["symptom", "root_cause"]
    }
  ],
  "remediationRecommendation": {
    "summary": "Review the product browse report query plan and apply an approved query/index optimization, then verify report latency returns toward baseline.",
    "actions": [
      {
        "order": 1,
        "action": "Review the report query plan and apply the approved catalog report query/index change through the normal change process.",
        "target": "catalog-service product browse report / MySQL",
        "preconditions": ["Confirm the query plan and affected table/index.", "Confirm the change is safe for current traffic."],
        "risks": ["A query or index change can increase write cost or affect other catalog reads."],
        "verification": ["Check report latency and error rate against the baseline window.", "Check catalog-service and MySQL health after the change."],
        "rollback": ["Revert the query/index change through the normal deployment or database change procedure."]
      }
    ]
  },
  "limitations": ["This report does not prove that the recommended remediation has been executed."],
  "extensions": {}
}
```

### 字段说明

#### 顶层字段

| 字段路径 | 类型 | 必填 | 来源/写入者 | 说明与 Evaluator 用途 |
| --- | --- | --- | --- | --- |
| `schemaVersion` | string | 是 | Agent，受 Schema 限制 | 固定为 `agent-rca-report.v1`，用于选择解析和校验规则。 |
| `reportId` | string | 是 | Agent 提供，服务端校验唯一性 | 本次报告的幂等键和审计键；同值重试不得重复排队。 |
| `alertRefs` | array<object> | 是 | Agent 从一个或多个告警 envelope 原样回传 | 关联一个问题涉及的一个或多个告警实例；至少一个元素，不能自行创建或修改。 |
| `alertRefs[].fingerprint` | string | 是 | 告警接收系统生成 | 一个 Alertmanager 告警实例的指纹。 |
| `alertRefs[].startsAt` | RFC 3339 string | 是 | 告警接收系统生成 | 该告警实例的开始时间；用于复查窗口，不代表当前仍 firing。 |
| `alertRefs[].role` | enum | 是 | Agent 根据告警集合声明 | `primary` 或 `supporting`；只表达 Agent 的组织方式，不等于 Evaluator 已确认根因。 |
| `agent` | object | 是 | Agent | 标识 Agent 实现，不包含凭据或内部连接信息。 |
| `agent.name` | string | 是 | Agent | Agent 名称。 |
| `agent.version` | string | 是 | Agent | Agent 版本，用于结果分组和复现。 |
| `diagnosis` | object | 是 | Agent | RCA 分析主体。 |
| `evidenceRefs` | array | 是 | Agent | Agent 使用过的证据引用；Evaluator 会重新查询验证。 |
| `remediationRecommendation` | object | 是 | Agent | 针对实际业务/基础设施问题的修复建议，不是 Fault Run 控制动作。 |
| `limitations` | array[string] | 是 | Agent | Agent 已知的证据缺口、不确定性和不能证明的结论。 |
| `extensions` | object | 否 | Agent | 非核心扩展字段；Evaluator v1 不依赖其内容评分。 |

#### `diagnosis` 字段

| 字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `diagnosis.summary` | string | 是 | 面向人的 RCA 一句话摘要。 |
| `diagnosis.symptoms` | array[string] | 建议 | 观察到的症状，例如延迟、错误、依赖不可用或资源压力。不能把未经查询验证的猜测写成事实。 |
| `diagnosis.rootCause` | object | 是 | Agent 对根因的结构化判断。 |
| `diagnosis.rootCause.category` | enum | 是 | `DATABASE_QUERY`、`CACHE`、`DEPENDENCY`、`LOCK`、`JVM`、`STORAGE`、`EXTERNAL_PROVIDER`、`TRAFFIC`、`CONFIGURATION` 或 `UNKNOWN`。 |
| `diagnosis.rootCause.service` | string | 是 | Agent 判断的主要业务/基础设施服务。 |
| `diagnosis.rootCause.resource` | string | 是 | 受影响的资源、操作、依赖或配置对象。 |
| `diagnosis.rootCause.explanation` | string | 是 | 用证据支持的根因解释；不能包含内部密钥或控制面秘密。 |
| `diagnosis.affectedServices` | array[string] | 是 | 受影响或需要关注的服务。 |
| `diagnosis.affectedResources` | array[string] | 是 | 受影响的表、缓存、锁、文件、依赖或业务路径。 |
| `diagnosis.confidence` | number `0..1` | 是 | Agent 自评置信度，不等于 Evaluator 确认结果。 |
| `diagnosis.uncertainties` | array[string] | 是 | 未确认的查询、数据缺口和替代解释。允许为空数组。 |

#### `evidenceRefs` 字段

| 字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `evidenceRefs[].evidenceId` | string | 是 | 本次提交内唯一的证据引用 ID。 |
| `evidenceRefs[].kind` | enum | 是 | `metric`、`log`、`trace`、`business_check`、`run_event` 或 `resource_check`。 |
| `evidenceRefs[].source` | enum | 是 | `prometheus`、`loki`、`tempo`、`business_api`、`control_plane` 或 `resource_api`。 |
| `evidenceRefs[].service` | string | 视 kind | 观测服务或业务服务；控制面字段不能替代业务服务事实。 |
| `evidenceRefs[].window.from/to` | RFC 3339 string | 是 | Agent 查询证据的时间窗口，必须落在 `alertRefs[]` 关联的允许窗口内。 |
| `evidenceRefs[].agentQuery` | string | 是 | Agent 实际使用的查询文本，仅作审计和对照；Evaluator 不直接执行。 |
| `evidenceRefs[].observation` | string | 是 | Agent 从查询结果看到的现象摘要，不是原始日志/Trace 的替代存储。 |
| `evidenceRefs[].supports` | array[enum] | 是 | `symptom`、`root_cause`、`impact`、`remediation` 之一或多个。 |

Agent 的 `agentQuery` 不能包含凭据、任意外部 URL、可执行 SQL 或绕过 allowlist 的内部地址。Evaluator 根据 Scenario Contract 和 Evidence Query Manifest 生成受控查询进行复查。

#### `remediationRecommendation` 字段

| 字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `remediationRecommendation.summary` | string | 是 | 实际业务/基础设施修复建议摘要。 |
| `remediationRecommendation.actions` | array | 是 | 按顺序排列的声明性建议，不是可直接执行脚本。 |
| `actions[].order` | integer | 是 | 建议顺序，从 1 开始。 |
| `actions[].action` | string | 是 | 修复实际问题的操作描述，例如修改业务配置、修复 Service、回滚应用版本或调整索引。 |
| `actions[].target` | string | 是 | 目标业务服务、资源、依赖或配置对象。禁止填写 Fault Run 控制面。 |
| `actions[].preconditions` | array[string] | 是 | 执行前需要确认的业务、资源和变更条件。 |
| `actions[].risks` | array[string] | 是 | 修复可能造成的副作用和风险。 |
| `actions[].verification` | array[string] | 是 | 验证实际业务/基础设施修复是否生效的检查。 |
| `actions[].rollback` | array[string] | 是 | 回退实际修复动作的方法。 |

`remediationRecommendation` 不允许建议停止/延长 Fault Run、调用 `release`/`cleanup`、操作 Alertmanager/Evaluator/Worker 或修改控制面状态。Operator 是否执行建议由控制面单独记录，不能由 Agent 在 JSON 中声明。

#### 由服务端/Evaluator 管理的字段

以下信息不进入 `AgentRcaReport.json`：

| 信息 | 维护者 | 说明 |
| --- | --- | --- |
| `evaluationStatus` | Evaluator | `OPEN`、`RUNNING`、`COMPLETED`、`CLOSED`、`EVIDENCE_UNAVAILABLE`、`FAILED`。 |
| `evaluationClosedAt` | 服务端/Operator | 关闭评估的时间。 |
| Prometheus/Loki/Tempo retention | 部署配置和观测系统 | 判断能否复查证据。 |
| `evidenceAvailability` | Evaluator | 每个查询窗口的可用性。 |
| `remediationExecutionStatus` | Operator/控制面 | `NOT_REVIEWED`、`REJECTED`、`ACCEPTED_NOT_EXECUTED`、`EXECUTED`、`VERIFIED`、`FAILED`。 |
| `faultRunControlStatus` | Fault Run 控制面 | stop/release/cleanup 等内部状态，与实际 remediation 分开。 |
| `score` | Evaluator | Agent 不能自报或修改。 |

必填字段：

- `schemaVersion = "agent-rca-report.v1"`
- `reportId`
- `alertRefs`
- `agent.name/version`
- `diagnosis`
- `evidenceRefs`
- `remediationRecommendation`
- `limitations`

`reportId` 用于幂等、重试和审计；同一个 `alertRefs[]`/`incidentRef` 可以有多次报告。Agent RCA report intake service 需要定义：

- 相同 `reportId` 重复提交返回同一接收结果，不重复排队评估。
- 新 `reportId` 在同一 `alertRefs[]` 或 `incidentRef` 下提交时，只有在前一次评估尚未开始时才允许替换；评估已开始后必须由 Operator 显式重试或选择新报告。
- 评估已关闭的新提交返回 `EVALUATION_CLOSED`；如果观测 retention 已无法覆盖查询窗口，返回 `EVIDENCE_UNAVAILABLE`，不直接判定 RCA 错误。
- Agent 不获得 `taskId`、`evaluationId`、`faultRunId` 或内部数据库 ID。

RCA 至少包含：

- 症状。
- `rootCause.category`：`DATABASE_QUERY`、`CACHE`、`DEPENDENCY`、`LOCK`、`JVM`、`STORAGE`、`EXTERNAL_PROVIDER`、`TRAFFIC`、`CONFIGURATION`、`UNKNOWN`。
- 受影响服务和资源。
- `confidence` 与不确定性。

Evidence 引用至少包含：

- `evidenceId`。
- 数据源和服务。
- 查询时间窗口。
- Agent 使用的查询文本。
- 观察结果。
- 支持的结论。

实际场景修复建议至少包含：

- 建议动作。
- 目标业务服务、资源或依赖。
- 前置条件。
- 风险。
- 验证步骤。
- 回退方案。

该字段描述的是**修复 RCA 所识别的实际业务/基础设施问题**，不是 Fault Run 的控制动作。Agent 不知道也不需要知道 Fault Run；以下内容不属于 Agent 的建议：

- 停止或延长 Fault Run。
- 调用 Fault Run `release` 或 `cleanup`。
- 修改控制面状态。
- 操作 Alertmanager、Evaluator 或内部 Worker。

禁止 Agent 提交：

- `remediationExecuted`、`cleanupExecuted`、`score`、`passed`。
- 密码、token、service key、kubeconfig 和 Authorization Header。
- 可直接执行的 shell、SQL、任意 URL 或内部 operation payload。
- Ground Truth、`taskId`、`evaluationId` 或控制面内部 ID。

Result Gateway 在保存提交前必须执行：

```text
AgentRcaReport.json
  -> JSON Schema validation
  -> alertRefs[] / incident correlation / permission / size / secret checks
  -> immutable report record
  -> automatically queued Evaluator
```

Markdown 只能用于人工查看或由 JSON 派生生成；只提交 Markdown 的内容不能进入自动评估。

## Evaluator 触发和职责

Nginx Basic Auth 保护的提交入口校验 JSON Schema 后自动排队 Evaluator。Operator 可以通过现有控制面查看、重试或放弃一次评估。

Evaluator：

- 重新查询实时观测数据。
- 检查 Agent 证据引用是否成立。
- 判断 RCA 正确性、证据充分性和建议安全性。
- 判断告警接收、Fault Run 控制面状态和目标效果。
- 不执行实际场景 remediation，不替 Operator 调用 release/cleanup。
- 告警从 `firing` 变为 `resolved` 仍然可以评估；Evaluator 校验告警接收记录、`alertRefs[]` 和内部 `incidentRef`，不要求当前仍为 firing。
- 查询失败或观测 retention 过期时返回 `evidence_unavailable`，不直接判定 RCA 错误。
- Evaluator 使用服务端定义的查询配方，不执行 Agent 提交的任意 URL、shell 或 SQL。

Evaluator 报告必须把控制面状态和实际场景 remediation 状态分开：

```text
EvaluationReport
  - evaluationStatus
  - alertReceiptStatus
  - rcaCorrectness
  - evidenceSufficiency
  - recommendationSafety
  - remediationReviewStatus
  - remediationExecutionStatus
  - businessRecoveryStatus
  - faultRunControlStatus
  - limitations / evidence_unavailable
```

实际场景 remediation 的状态至少区分：

```text
NOT_REVIEWED
REJECTED
ACCEPTED_NOT_EXECUTED
EXECUTED
VERIFIED
FAILED
```

`faultRunControlStatus` 只表示内部 Fault Run 的 stop/release/cleanup 状态，不代表 Agent 是否修复了实际业务问题；`remediationExecutionStatus` 只表示 Operator 是否执行了 Agent 建议或其他批准的实际修复。

## 验收

- 没有 firing alert，不向 Agent 发送 RCA 任务。
- 告警接收记录缺失时返回 `ALERT_RECEIPT_UNAVAILABLE`；Fault Run 上下文无法唯一关联时记录 `faultRunCorrelationStatus=UNMATCHED/AMBIGUOUS`，两者都不直接判定 RCA 错误。
- Agent 不能通过试点接入地址访问控制面写 API、Ground Truth 或其他运行数据；阶段 5 不新增应用层授权模型。
- Agent 只能只读查询并提交 RCA/建议。
- AgentRcaReport 必须通过版本化 JSON Schema。
- 同一 `reportId` 重试幂等；评估已关闭的告警报告不进入自动评估，观测过期则进入 `EVIDENCE_UNAVAILABLE`。
- Operator 不执行实际场景 remediation 是合法结果，报告使用 `remediationExecutionStatus = ACCEPTED_NOT_EXECUTED`；尚未审核时使用 `NOT_REVIEWED`。
- Evaluator 状态区分 `PENDING`、`RUNNING`、`COMPLETED`、`EVIDENCE_UNAVAILABLE`、`FAILED`。
- 不发布跨 Agent 排行榜。
- 试点场景的 alert receipts、`alertRefs[]`、内部 `incidentRef`、AgentRcaReport、Evaluator report 和 `remediationExecutionStatus` 可以关联；Fault Run 的内部 stop/release/cleanup 状态仍只由控制面记录。

## 回退

撤销 Agent 接入、停止 Alert Delivery、保留 RCA/评估记录，并继续使用现有 Operator 控制面完成停止、恢复和清理。
