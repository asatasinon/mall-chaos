# 阶段 2：Worker 所有权和状态重协调

## 目标

为未来多副本和进程接管建立基础，但阶段内仍保持单 Worker 默认部署。

## Owner Lease

Worker 执行记录增加：

```text
fault_run_id
owner_id
owner_epoch / fencing_token
lease_expires_at
last_heartbeat_at
last_action
drain_state
```

Worker owner lease 与目标侧 `OperationRunGuard`、数据预热 lease 分开：

- 目标 guard 防止旧运行影响目标服务。
- Worker owner lease 决定谁有权持续执行 Fault Run。
- 预热 lease 只负责预热写入所有权。

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

## 灰度

先只写 owner/heartbeat；再 shadow mode 计算接管动作；最后只在测试环境开启自动接管。回退时关闭自动接管，保留 additive 字段。
