# 阶段 6：Environment Profile、资源/数据隔离和 Trial

> 状态：远期冻结；当前无实现人力

## 目标

在阶段 5 稳定且重新获得实现资源后，把专用单环境 RCA 试点扩展成可重复、可验证、可并行的 Trial 基础设施。

## 对象模型

```text
Environment
  -> Experiment
      -> Campaign
          -> Trial
              -> Fault Run (0..n)
```

| 对象 | 作用 |
| --- | --- |
| `Environment` | 一套隔离的 Compose/Kubernetes、数据库、Redis、文件卷、观测和配置 |
| `Experiment` | 研究目标、Agent 版本集合和默认环境配置 |
| `Campaign` | 场景、参数矩阵、并发限制和停止策略 |
| `Trial` | 一个 Agent 在一个环境和配置下的一次可比较执行 |
| `Fault Run` | Trial 内具体的在线受控故障运行 |

阶段 5 的专用手工环境需要迁移为受 `Environment` 管理的实例；Agent Access 继续只读 RCA，直到另行完成实际场景 remediation 执行的安全评审。

## Profile

| Profile | 用途 |
| --- | --- |
| `lite` | 前端、接口和控制面开发，关闭大规模预热 |
| `full` | 完整电商故障演练和观测 |
| `benchmark` | 固定镜像、配置、seed、数据 profile 和安全策略 |
| `isolated-trial` | 独立 Compose project/namespace、数据库、Redis 前缀或完整 stack |
| `observability-heavy` | 深度 Trace、额外 Recorder 和高级诊断 |

## 隔离要求

- 共享数据库上的多个 Fault Run 不等于多个公平 Trial。
- 数据库、Redis、文件卷、端口、观测数据和控制面状态必须隔离。
- 每个 Trial 有 `environmentId`、配置 revision、数据 profile 和销毁状态。
- `lite` 不默认写入 5400 万行历史数据。
- 阶段 5 的 Agent Access 迁移后仍默认保持只读 RCA。

## 上线顺序

1. 提供 `lite`。
2. 提供单 Trial `benchmark`。
3. 将阶段 5 专用环境迁移到 Environment 管理。
4. 验证两个独立 `isolated-trial` 并行。
5. 通过污染、销毁和容量测试后，才允许 Campaign 调度多个 Trial。

## Trial 生命周期

```text
Environment create
  -> seed/config/schema checks
  -> Trial start
  -> Fault Run prepare/active
  -> Alert-driven RCA (optional)
  -> stop/expire/recovery
  -> Query Manifest/report
  -> Trial cleanup
  -> Environment destroy
```

环境启动失败、容量不足、观测不可用和销毁失败必须成为明确状态。一个环境销毁失败不能自动影响其他 Environment。

## 验收

- 两个相同场景的 Redis、MySQL、文件和事件互不污染。
- 一个环境销毁不影响另一个。
- Trial Query Manifest 和报告可以绑定环境和镜像/配置版本。
- Agent Access 权限和审计边界迁移后不变。
- 跨 Agent/版本比较只在隔离验证通过后开放。
- 同一 profile、配置和 seed 的重复 Trial 能区分环境差异、Agent 差异和目标效果差异。
