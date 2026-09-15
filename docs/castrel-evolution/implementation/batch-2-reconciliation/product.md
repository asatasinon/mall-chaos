# 批次 2：Worker 所有权与重协调产品规格

> 状态：产品规格 v1
> 对应路线阶段：阶段 2
> 依赖：批次 1
> 下一步：技术设计和 owner lease/reconciler 测试

## 1. 产品目标

当 Worker 重启、网络抖动或进程失去响应时，控制面能够判断谁拥有运行、谁可以接管，以及运行最终应收敛到什么状态，避免同一个 Fault Run 被两个 Worker 持续驱动。

本批次先服务单副本默认部署和测试环境接管，不把它作为扩容或 Worker Pool 方案。

## 2. 服务对象与问题

| 服务对象 | 当前问题 | 本批次价值 |
| --- | --- | --- |
| Operator | Worker 重启后无法判断运行是否仍在执行 | 能看到 owner、heartbeat、接管和收敛状态 |
| 平台维护者 | 旧进程可能在网络隔离后继续发送请求 | 通过 lease、epoch 和 stop 边界降低双 owner 风险 |
| 发布负责人 | 发布/崩溃后的 active run 需要人工猜测 | 具备明确的重协调和回退路径 |

## 3. 产品范围

### 3.1 包含

- 每个受控运行的 Worker owner lease。
- heartbeat、owner epoch 和 lease 丢失记录。
- Reconciler 发现过期 owner 后的接管或终止决策。
- 旧 owner 在失去所有权后的停止边界。
- Operator 可见的 owner、最后 heartbeat、接管次数和最终状态。
- 双 Worker 竞争、进程重启、网络抖动和 lease 丢失测试。

### 3.2 不包含

- 不改变目标服务 `OperationRunGuard` 的职责。
- 不复用目标服务 fencing token 作为 Worker owner epoch。
- 不承诺已发出的公开业务请求可被目标服务全部撤回。
- 不启用多副本默认部署、Worker Pool 或跨环境并行。
- 不把接管成功等同于业务恢复成功。

## 4. 关键用户流程

```text
Worker 获取 owner lease
  -> 周期 heartbeat
  -> 执行 Fault Run
  -> lease 正常：继续执行
  -> lease 丢失：停止接收新任务并退出受控路径
  -> Reconciler 检查运行状态
  -> 选择安全接管、标记人工处理或结束运行
  -> 记录 owner epoch、原因和最终状态
```

接管必须是明确的状态转换，不得通过“新 Worker 直接开始发请求”隐式完成。

## 5. 产品行为

Operator 至少可以查看：

```text
ownerId
ownerEpoch
leaseAcquiredAt
lastHeartbeatAt
leaseLostAt
reconciledAt
takeoverCount
drainState
finalRunState
```

如果旧 owner 仍可能存在 in-flight 请求，系统必须展示这种不确定性，并先执行停止和 drain 边界，不向 Operator 承诺完全无重叠。

## 6. 产品验收

- 同一个 Fault Run 在测试中不会出现两个有效 owner 同时持续驱动。
- lease 丢失后旧 owner 不再接受新的受控任务。
- Worker 重启后，运行能被恢复、接管或明确标记为人工处理。
- Reconciler 对过期运行有可审计的决定和原因。
- Operator 能区分“控制面已接管”和“业务已恢复”。
- 单个 Fault Run 的接管不会影响正常客户 Runner、数据预热和补给。

## 7. 成功指标与退出条件

- 双 Worker 竞争、heartbeat 丢失、进程重启和网络抖动测试通过。
- 旧 owner fencing 和新 owner 接管都有 Run Event。
- 单副本默认部署行为保持不变，接管能力以 opt-in 方式灰度。
- 没有需要通过删除 owner/lease 字段来修复的异常路径。

满足退出条件后，进入批次 3。
