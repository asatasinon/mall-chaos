# Task 09 — traffic-control-plane

**阶段**：Phase 1 — 基础 7 服务  
**依赖**：Task 01–08（所有基础服务）  
**产出**：一个 `Next.js + pnpm` 的 traffic control plane，启动后自动持续产生业务流量，提供控制台 UI、Runner 控制 API，以及通过 `gateway-service` 分发的 Chaos 控制能力

---

## 职责

`traffic-control-plane` 不再是单纯的 Java Runner，而是新的 traffic 控制平面，包含：

1. Next.js 控制台 UI
2. Next.js Route Handlers / 控制 API
3. 独立 Runner Worker
4. 场景预设编排
5. 运行状态聚合

关键网络约束：

- [ ] `traffic-control-plane` **只能访问 `gateway-service`**
- [ ] 不允许从 traffic 直连任何业务服务
- [ ] 所有 HTTP 控制调用统一走 `traffic -> gateway -> service`

---

## 接口清单

### 9.0 traffic-runner 自身 API

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| GET | `/internal/traffic/runner/status` | Runner | 返回运行状态、QPS、成功率 |
| POST | `/internal/traffic/runner/pause` | Runner | 暂停流量生成 |
| POST | `/internal/traffic/runner/resume` | Runner | 恢复流量生成 |
| POST | `/internal/traffic/runner/rate` | Runner | 动态调整流量倍率 |
| GET | `/internal/traffic/runner/config` | Runner | 查看 DB/内存配置版本 |
| PUT | `/internal/traffic/runner/config` | Runner | 更新规则配置（含乐观锁） |
| GET | `/internal/traffic/runner/inventory-reset/schedule` | Runner | 查询库存重置策略 |
| PUT | `/internal/traffic/runner/inventory-reset/schedule` | Runner | 更新库存重置策略 |
| POST | `/internal/traffic/runner/inventory-reset/trigger` | Runner | 立即触发库存重置 |
| GET | `/internal/traffic/runner/data-warmup/progress` | Runner | 查询大表数据填充进度 |

### 9.0.1 traffic-runner 对 gateway 的依赖接口

以下接口由 `gateway-service` 提供，供 traffic 控制平面调用：

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| POST | `/internal/gateway/chaos/slow-sql/enable` | Gateway Dispatch | 分发慢 SQL 启用请求 |
| POST | `/internal/gateway/chaos/slow-sql/disable` | Gateway Dispatch | 分发慢 SQL 关闭请求 |
| GET | `/internal/gateway/chaos/slow-sql/status` | Gateway Dispatch | 聚合慢 SQL 状态 |
| POST | `/internal/gateway/chaos/memory-leak/enable` | Gateway Dispatch | 分发内存泄漏启用请求 |
| POST | `/internal/gateway/chaos/memory-leak/disable` | Gateway Dispatch | 分发内存泄漏停注入请求 |
| POST | `/internal/gateway/chaos/memory-leak/cleanup` | Gateway Dispatch | 分发内存泄漏清理请求 |
| GET | `/internal/gateway/chaos/memory-leak/status` | Gateway Dispatch | 聚合内存泄漏状态 |
| POST | `/internal/gateway/chaos/deadlock/enable` | Gateway Dispatch | 分发死锁启用请求 |
| POST | `/internal/gateway/chaos/deadlock/disable` | Gateway Dispatch | 分发死锁关闭请求 |
| POST | `/internal/gateway/chaos/deadlock/cleanup` | Gateway Dispatch | 分发死锁清理请求 |
| GET | `/internal/gateway/chaos/deadlock/status` | Gateway Dispatch | 聚合死锁状态 |
| POST | `/internal/gateway/chaos/table-lock/enable` | Gateway Dispatch | 分发表锁启用请求 |
| POST | `/internal/gateway/chaos/table-lock/disable` | Gateway Dispatch | 分发表锁关闭请求 |
| GET | `/internal/gateway/chaos/table-lock/status` | Gateway Dispatch | 聚合表锁状态 |
| POST | `/internal/gateway/network-delay/enable` | Gateway Dispatch | 注入网络延迟 |
| POST | `/internal/gateway/network-delay/disable` | Gateway Dispatch | 删除网络延迟 toxic |
| GET | `/internal/gateway/network-delay/status` | Gateway Dispatch | 查询网络延迟状态 |
| POST | `/internal/gateway/network-reset/enable` | Gateway Dispatch | 注入 reset_peer |
| POST | `/internal/gateway/network-reset/disable` | Gateway Dispatch | 删除网络 reset toxic |
| GET | `/internal/gateway/network-reset/status` | Gateway Dispatch | 查询网络 reset 状态 |

---

## 子任务

### 9.1 技术形态调整

- [ ] 将 `traffic-control-plane` 从 Spring Boot 服务重构为 `Next.js + pnpm`
- [ ] 默认使用 TypeScript
- [ ] 默认使用 `pnpm`
- [ ] Node.js 承担 Runner API、控制编排、状态聚合与场景执行职责
- [ ] Next.js 页面层承担控制台页面、拓扑展示、操作面板、执行日志面板
- [ ] 独立 worker 承担持续调度、库存重置调度、自动恢复定时器
- [ ] 旧 gateway 内置 `chaos-console.html` 下线
- [ ] 新控制台入口统一为 `traffic-control-plane`

### 9.2 数据模型（建于 MySQL，初始化时插入默认行）

以下表结构继续沿用，保证原始运行控制不变量不变。

**`runner_profile`**
```sql
CREATE TABLE runner_profile (
    id               BIGINT  PRIMARY KEY AUTO_INCREMENT,
    enabled          TINYINT NOT NULL DEFAULT 1,
    base_qps         INT     NOT NULL DEFAULT 5,
    peak_multiplier  FLOAT   NOT NULL DEFAULT 2.0,
    cycle_minutes    INT     NOT NULL DEFAULT 10,
    jitter_pct       FLOAT   NOT NULL DEFAULT 0.1,
    version          INT     NOT NULL DEFAULT 1
);
INSERT INTO runner_profile VALUES (1, 1, 5, 2.0, 10, 0.1, 1);
```

**`runner_mix_rule`**
```sql
CREATE TABLE runner_mix_rule (
    id           BIGINT       PRIMARY KEY AUTO_INCREMENT,
    action_type  VARCHAR(32)  NOT NULL,
    ratio        FLOAT        NOT NULL,
    version      INT          NOT NULL DEFAULT 1
);
```

**`runner_time_window`**
```sql
CREATE TABLE runner_time_window (
    id          BIGINT    PRIMARY KEY AUTO_INCREMENT,
    start_time  TIME      NOT NULL,
    end_time    TIME      NOT NULL,
    multiplier  FLOAT     NOT NULL DEFAULT 1.0,
    version     INT       NOT NULL DEFAULT 1
);
```

**`runner_inventory_reset_policy`**
```sql
CREATE TABLE runner_inventory_reset_policy (
    id               BIGINT       PRIMARY KEY AUTO_INCREMENT,
    enabled          TINYINT      NOT NULL DEFAULT 1,
    cron_expr        VARCHAR(64)  NOT NULL DEFAULT '0 */30 * * * *',
    timezone         VARCHAR(64)  NOT NULL DEFAULT 'Asia/Shanghai',
    allowed_window   VARCHAR(32)  NOT NULL DEFAULT '00:00-06:00',
    reset_scope      VARCHAR(16)  NOT NULL DEFAULT 'ALL',
    baseline_version INT          NOT NULL DEFAULT 1,
    version          INT          NOT NULL DEFAULT 1
);
INSERT INTO runner_inventory_reset_policy VALUES (1, 1, '0 */30 * * * *', 'Asia/Shanghai', '00:00-06:00', 'ALL', 1, 1);
```

### 9.3 流量生成引擎

- [ ] 在独立 worker 中实现调度器，按 `base_qps * multiplier` 生成流量
- [ ] 每个调度 tick：
  1. 从 `runner_mix_rule` 内存规则按概率抽取 `action_type`
  2. 随机选择 `userId`（1~20）、`sku`（SKU-001~SKU-050）、`qty`（1~3）
  3. 调用 `gateway-service POST /api/orders`
  4. 记录结果（成功/失败），更新滚动统计窗口
- [ ] 支持 `jitter_pct` 随机抖动
- [ ] 支持 `cycle_minutes` 周期波动
- [ ] 不允许绕过 gateway 直连 order-service

### 9.4 动态调速

- [ ] `POST /internal/traffic/runner/rate`：请求体 `{ "multiplier": 2.0 }`
- [ ] 原子更新内存中的倍率，**无需重启**，下一 tick 生效

### 9.5 暂停与恢复

- [ ] `POST /internal/traffic/runner/pause`：停止调度（不清除配置）
- [ ] `POST /internal/traffic/runner/resume`：恢复调度，继续使用当前内存配置

### 9.6 配置热更新（关键约束）

- [ ] `PUT /internal/traffic/runner/config` 请求体：
  ```json
  {
    "version": 1,
    "baseQps": 10,
    "peakMultiplier": 3.0,
    "cycleMinutes": 5,
    "jitterPct": 0.2,
    "mixRules": [
      { "actionType": "ORDER_SUCCESS", "ratio": 0.85 },
      { "actionType": "ORDER_FAIL", "ratio": 0.10 },
      { "actionType": "CANCEL", "ratio": 0.05 }
    ]
  }
  ```
- [ ] 使用乐观锁（`WHERE version=?`），成功才更新 DB
- [ ] DB 更新成功后**原子替换**内存规则对象
- [ ] 返回 `{ newVersion, appliedAt, activeRuleDigest }`
- [ ] DB 更新失败（版本冲突）不影响当前内存运行，返回 409
- [ ] `GET /internal/traffic/runner/config`：返回 `{ dbVersion, memVersion, digest }`

### 9.7 库存重置定时调度

- [ ] cron 表达式从 `runner_inventory_reset_policy` 内存加载
- [ ] 执行前检查 `allowed_window`
- [ ] 执行流程：
  1. 通过 gateway 调用 `POST /internal/gateway/inventory-reset/plan`
  2. 通过 gateway 调用 `POST /internal/gateway/inventory-reset`
  3. 请求中必须带 `expectedVersion`
  4. 记录执行结果日志
- [ ] `PUT /internal/traffic/runner/inventory-reset/schedule`：更新 cron 后**立即刷新内存调度器**
- [ ] `POST /internal/traffic/runner/inventory-reset/trigger`：绕过时间窗检查，立即执行一次
- [ ] 保持“`expectedVersion + distributed Redis lock`”不变量不变

### 9.8 控制台聚合能力

- [ ] 新增 `GET /internal/traffic/chaos/overview`
- [ ] 聚合返回：
  - runner 当前运行状态
  - slow-sql / memory-leak / deadlock / table-lock / network 当前状态
  - 每类资源的目标服务摘要
  - 最后一次操作记录
  - Grafana / Tempo 深链参数
- [ ] React 首页优先使用 overview 接口进行初始化

### 9.9 场景控制与预设

- [ ] 新增 `GET /internal/traffic/scenarios`
- [ ] 新增 `POST /internal/traffic/scenarios/{scenarioId}/run`
- [ ] 新增 `POST /internal/traffic/scenarios/recover-all`
- [ ] 预设场景逻辑从前端 JS 迁移到 Next.js 服务端 / worker
- [ ] `recover-all` 必须在后端统一编排，不允许前端 best-effort 并发调用多个端点

### 9.10 状态接口

- [ ] `GET /internal/traffic/runner/status` 返回：
  ```json
  {
    "running": true,
    "currentQps": 8.2,
    "successRate": 0.91,
    "failRate": 0.09,
    "totalRequests": 12345,
    "windowSeconds": 60
  }
  ```
- [ ] 滚动窗口统计（最近 60 秒）

### 9.11 gateway 分发依赖要求

- [ ] traffic 的所有 chaos 控制调用统一转发到 `gateway-service`
- [ ] gateway 负责目标服务白名单校验、traceId 注入、错误格式统一
- [ ] gateway 负责将控制请求分发到业务服务 chaos endpoint 或 toxiproxy 代理
- [ ] traffic 不感知具体业务服务地址与基础设施地址

### 9.12 metrics

- [ ] `runner.request.total` counter
- [ ] `runner.request.success` counter
- [ ] `runner.request.fail` counter
- [ ] `runner.qps` gauge
- [ ] `traffic.control.request.total` counter
- [ ] `traffic.control.request.fail` counter

### 9.13 验证

- [ ] 启动后 Grafana 可见持续流量产生
- [ ] 动态调速后，Grafana QPS 曲线立即变化
- [ ] 配置更新（版本冲突）正确返回 409
- [ ] 库存定时重置自动执行，重置后下单不再因库存不足失败
- [ ] 暂停/恢复功能正常，恢复后流量自动恢复
- [ ] 控制台加载与场景执行只访问 `traffic-control-plane`
- [ ] traffic 到业务侧的访问链路统一体现为 `traffic -> gateway -> services`
