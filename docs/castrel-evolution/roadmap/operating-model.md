# 演化共用发布与运行规则

## 1. 不变原则

### 1.1 真实路径优先

- 故障效果必须来自真实 HTTP、SQL、Redis、JVM、文件系统、数据库锁、外部支付或业务依赖。
- 不用 Controller 直返错误、固定等待、随机假结果或脱离业务链路的测试端点替代真实效果。
- 控制动作完成、目标效果发生、业务恢复和资源清理必须分别记录。

### 1.2 控制面和业务面分离

- `traffic-control-plane` 是 Catalog、Fault Run、审计、恢复和评估语义的唯一所有者。
- 控制面业务 HTTP 继续经过 Gateway 固定 operation。
- 目标服务只接收通用 operation、opaque run context、expiry、idempotency 和 fencing。
- 消费者和业务运行时不得暴露场景 ID、Fault Run、Ground Truth、Operator session 或内部密钥。

### 1.3 Agent 权限边界

- 外部 Agent 不获取 `taskId`、`evaluationId`、`faultRunId`、Operator session 或内部 service key。
- Agent 由 Alertmanager firing alert 被动触发。
- Agent 只接收告警 envelope 和 opaque `alertRef`。
- Agent 只读查询观测数据、提交 RCA 和恢复建议。
- Agent 不执行恢复、release、cleanup 或业务写操作。

### 1.4 Evidence Query v0 边界

- 只保存控制面时间线、查询窗口、查询配方、RCA/建议和评估状态。
- 不保存 Prometheus 指标结果、Loki 日志、Tempo Trace、MySQL/Redis volume、JVM heap 或文件现场快照。
- 观测数据过期或查询失败时输出 `evidence_unavailable`。
- 如果未来需要离线 replay，另立 `offline-evidence` 阶段。

## 2. 灰度模型

```text
部署代码
  -> 默认关闭新执行路径
  -> 旁路记录
  -> 测试环境开启
  -> 单环境 canary
  -> 小范围默认开启
  -> 全量默认开启
```

建议为 drain、自动接管、Evidence Query、Agent Alert Delivery、benchmark profile 和 broker 分别设置开关。

## 3. 数据库迁移

采用 expand/contract：

```text
Expand
  -> 新增 nullable 字段/表/索引
  -> 新旧代码兼容
  -> 双写或回填
  -> 读取新字段并观测
  -> 停止旧代码
  -> Contract 删除旧结构
```

禁止一个发布同时删除旧列、切换状态机、启用多副本和改变所有服务读取逻辑。

## 4. 通用发布门禁

### 4.1 可靠性

- 失败、超时、取消、重启、网络抖动和清理失败都有明确状态。
- 没有静默成功、broad catch 或成功形状 fallback。
- 所有等待有总超时和最后状态。

### 4.2 真实性

- 仍经过真实业务和真实资源。
- 不把告警、OOM、磁盘耗尽、死锁或恢复时间写成必然承诺。

### 4.3 安全

- Agent 不能访问 Operator 权限、内部 service key 或 Ground Truth。
- 内部 operation 使用固定 allowlist。
- Secret、token、kubeconfig、RCA 和告警关联数据有明确访问边界。

### 4.4 运维

- 有发布、灰度、停止、回退和 active Fault Run 处理步骤。
- 有 dashboard、日志关键词、告警和残留资源检查。

## 5. 回退规则

- 代码回退不能依赖已经删除的数据库字段。
- active Fault Run 回退前先停止新 Worker，再确认旧版本可识别状态。
- 关闭 Agent Alert Delivery 后，Operator 仍能通过现有控制面停止、恢复和清理。
- Evaluator 不执行恢复，因此评估逻辑回退不应改变业务运行状态。
