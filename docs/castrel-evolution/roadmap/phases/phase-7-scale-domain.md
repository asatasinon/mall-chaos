# 阶段 7：规模化、异步和领域扩展

## 进入条件

- Owner lease、heartbeat、fencing 和 Reconciler 稳定。
- 重启、接管和网络分区测试通过。
- 所有持续 Worker 都支持 drain 和失败传播。
- `isolated-trial` 已证明互不污染。
- Agent RCA 试点和 Evidence Query 稳定。

## Worker Pool 和多副本

按以下顺序：

1. 单 Worker 多任务但仍单副本。
2. 两个 Worker 副本，一个 standby。
3. active/standby 自动接管。
4. 按 Environment/Trial 分配 Worker。
5. 最后才考虑共享 Worker Pool。

## Outbox 和消息驱动

不直接把所有同步 HTTP 改为消息队列：

1. 支付结果、通知和履约事件先做事务 Outbox spike。
2. 保留当前同步 `sync` profile。
3. 增加可选 broker profile。
4. 单独验证重试、重复投递、顺序、积压和最终一致性。
5. 将同步级联和异步积压作为不同演练类型。

## FinOps 和 CISO

复用：

```text
Environment Profile
  -> Scenario Contract
  -> Trial/Fault Run Lifecycle
  -> Evidence Query Manifest
  -> Evaluator
```

不要为 FinOps/CISO 创建完全独立的生命周期协议。

## 验收

- Worker Pool 不重复执行、不重复恢复。
- 消息模式可观察、可重试、可处理重复和积压。
- 新领域复用同一 Trial、Evidence Query 和 Evaluator 底座。
- 领域扩展不泄露控制面语义，不破坏真实业务路径。
