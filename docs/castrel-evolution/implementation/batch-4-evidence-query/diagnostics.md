# 批次 4：Evidence Query 诊断指引

本指引用于在已授权的 Operator 环境中定位 Evidence API 问题。它不替代 Phase 3/4 环境门禁，也不授权启用功能、连接真实数据源、修改数据库或执行真实场景。

## 安全边界

- `EVIDENCE_MANIFEST_CAPTURE_ENABLED`、`EVIDENCE_QUERY_ENABLED` 和 `EVIDENCE_QUERY_EXECUTION_ENABLED` 默认关闭。不要为排查临时修改共享环境开关；查询和真实 pilot 需遵守 P4-18/P4-19 的环境批准。
- Manifest、report history 和 note history 都是 Operator-only `/internal/**` 路由。GET 不调用 Prometheus、Loki、Tempo 或 Gateway，但首次 Manifest GET 可能写入冻结 metadata；report history GET 可能惰性结算已过期的 `RUNNING` attempt。
- 只有显式 POST report 会发出受控 source/Gateway 请求。只使用用户已选的 `manifestId`/`manifestHash`；网络重试复用原 idempotency key，新一轮实时查询必须显式确认并使用新 key。
- 不把 query、endpoint、credential、source response、完整日志/trace、业务 payload 或原始异常复制到 note、工单、聊天或命令行。Note 过滤仅拒绝确定可识别的形式，不保证识别所有敏感文本。
- 当前不增加 Evidence 专用 metrics 或原始异常日志。诊断优先使用固定 API 错误码、attempt/history 状态、单项 reason code 和 Operator audit reference；不得用 ad hoc SQL 改写 attempt、Manifest、note 或 audit。

## 建议诊断顺序

1. **确认 Operator 会话和请求保护。** `401` 表示 session 未通过；`403 CSRF_VALIDATION_FAILED` 表示写请求的 CSRF 校验未通过。不要绕过 middleware 或从浏览器控制台伪造通用请求。
2. **检查运行与 Manifest metadata。** 调用 `GET /internal/fault-runs/{faultRunId}/evidence`。`409 RUN_NOT_TERMINAL` 表示运行还没有稳定终态；`EVIDENCE_UNAVAILABLE / CONTRACT_SNAPSHOT_UNAVAILABLE` 表示该 legacy Run 没有可复用的捕获合同；`404 FAULT_RUN_NOT_FOUND` 表示没有可读 Run 或保留 Manifest。该 GET 不检查数据源可用性。
3. **只在已授权情况下执行一次显式报告。** 先通过 Manifest list/detail 选定 revision，再用对应 ID/hash 和确认字段发出 POST。不能通过 URL 参数、任意查询文本或任意 source 选择改变 frozen recipe。
4. **读取 metadata-only report history。** `GET /internal/fault-runs/{faultRunId}/evidence/reports?limit=...` 返回状态、单项 availability/coverage/predicate outcome、reason code、时间/耗时和 audit ID，不包含数值摘要或 provider response。历史读取会先惰性结算过期 attempt；没有后续请求时中断 attempt 可暂时保留 `RUNNING`。
5. **按固定状态码和 reason code 分类。**

| 结果 | 含义与排查方向 |
| --- | --- |
| `404 EVIDENCE_QUERY_DISABLED` | Web query flag 关闭；不要在未授权环境启用。 |
| `409 RUN_NOT_TERMINAL` / `MANIFEST_REVISION_MISMATCH` | Run 尚未终态，或所选 Manifest ID/hash 与该 Run 不匹配。重新读取正确 metadata，不要自动切 latest。 |
| `409 IDEMPOTENCY_KEY_REUSED` | 同一 Run/key 已绑定不同 request signature；原请求用原 key 重试，新的显式请求换新 key。 |
| `422 INVALID_QUERY` | Frozen protocol 无法解释或违反内部约束；保留固定错误码并升级维护，不要重渲染、编辑 DB 或改用任意查询。 |
| `429 EVIDENCE_QUERY_BUSY` | 同步执行并发额度已满；等待当前请求收敛后再由 Operator 显式发起新请求。 |
| `503` 固定 Evidence 错误码 | 配置、数据库、审计或 executor 不可用；先检查受支持的服务健康/配置流程，禁止重放原始异常或手工补写终态。 |
| `200` + `PARTIAL` / `EVIDENCE_UNAVAILABLE` | 查询协议返回了结构化结果但证据不足或不可用；按 recipe 的 coverage/reason code 区分 retention/lookback/future tail、source timeout、未配置与 NO_DATA。不要将 CURRENT 或 timeline 解释成历史遥测。 |

6. **关联审计但不扩大数据面。** 用返回的 `operatorAuditId`、action 和 Manifest reference 检查既有 Operator audit。报告/note 正文与 source 内容不应出现在 audit parameters；审计写入失败属于失败，不能手工将其标记成功。
7. **排查 notes。** `GET /internal/fault-runs/{faultRunId}/evidence/notes` 可按有界 cursor 查看 Operator 已保存的分析文字。`POST .../notes` 只接受固定 Manifest ID/hash 和纯文本；固定拒绝码不回显被拒正文。Note 是辅助解释，不是控制面事实或恢复证明。

## 不可据此推断

- HTTP 200 不代表效果已观测；同时查看报告的总体 `evidenceStatus` 与独立 `effectAssessment`。
- Manifest 可读取不代表 Prometheus/Loki/Tempo/Gateway 可达；浏览 metadata 不发起 source 查询。
- audit/history 中没有遥测摘要是有意的数据最小化，不得通过提高日志级别、临时导出数据库或增加 metric label 绕过。
- 本地 fixture/mock 验收不能代替空库验证、真实 source/Gateway pilot、回退演练或阶段退出证据。
