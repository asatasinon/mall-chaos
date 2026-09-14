# 阶段 2：Worker 所有权和状态重协调

> 当前优先级：阶段 0～5
> 说明：本阶段只为单副本默认部署建立 owner/reconcile 基础，不在本阶段扩容 Worker。

## 目标

为未来多副本和进程接管建立基础，但阶段内仍保持单 Worker 默认部署。

## Owner Lease

Worker 执行记录增加：

```text
fault_run_id
owner_id
owner_epoch
lease_expires_at
last_heartbeat_at
last_action
drain_state
```

Worker owner lease 与目标侧 `OperationRunGuard`、数据预热 lease 分开；`owner_epoch` 不直接复用目标服务的 `fencingToken`，两者通过内部关联关系协同：

- 目标 guard 防止旧运行影响目标服务。
- Worker owner lease 决定谁有权持续执行 Fault Run。
- 预热 lease 只负责预热写入所有权。
- 正常客户 Runner、补给和留存任务的 singleton ownership 不能直接伪装成 Fault Run owner；它们需要独立的任务类型、lease 和关闭语义。

Owner fencing 只能约束带内部运行上下文的控制操作；对于经公开消费者 API 发出的报表/流量请求，旧 Worker 不能依赖目标侧 fencing 自动拒绝，必须靠 owner 失效后的停止接收、请求取消和 drain 收敛。

## Reconciler

Worker 启动和周期扫描以数据库状态为事实来源：

```text
CREATING   -> 检查 prepare，继续或 FAILED
ACTIVE     -> 检查 owner，启动或接管
RECOVERING -> 停止新任务，继续 drain/release/cleanup
过期状态    -> 进入 recovery，写明确事件
```

timer 只做及时执行加速，不能是唯一状态来源。

## 验收

- 两个 Worker 竞争同一 Fault Run 时只有一个获得 owner。
- 旧 owner 的请求在 fencing 失效后被拒绝。
- Worker 失联后可接管或明确标记人工处理。
- 重启不会重复 prepare、release 或跳过 cleanup。
- 单副本默认行为保持不变。
- owner lease 丢失不会直接修改 Fault Run 业务状态，必须通过 Reconciler 产生明确的接管、停止或人工介入结果。

## 灰度

先只写 owner/heartbeat；再 shadow mode 计算接管动作；最后只在测试环境开启自动接管。回退时关闭自动接管，保留 additive 字段。
