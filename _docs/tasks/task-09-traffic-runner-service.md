# Task 09 — traffic-runner-service

**阶段**：Phase 1 — 基础 7 服务  
**依赖**：Task 01–08（所有基础服务）  
**产出**：启动后自动持续产生业务流量、支持动态调速与配置热更新的 Runner

---

## 职责
启动后自动执行正常业务流量（下单链路），按定时策略触发库存重置，支持动态配置热更新（DB + 内存双写）。

## 接口清单

| 方法 | 路径 | 分组 | 说明 |
|---|---|---|---|
| GET | `/internal/runner/status` | 控制 | 返回运行状态、QPS、成功率 |
| POST | `/internal/runner/pause` | 控制 | 暂停流量生成 |
| POST | `/internal/runner/resume` | 控制 | 恢复流量生成 |
| POST | `/internal/runner/rate` | 控制 | 动态调整流量倍率 |
| POST | `/internal/runner/inventory-reset/trigger` | 控制 | 立即触发库存重置 |
| PUT | `/internal/runner/inventory-reset/schedule` | 控制 | 更新重置定时策略 |
| GET | `/internal/runner/inventory-reset/schedule` | 控制 | 查询重置定时策略 |
| PUT | `/internal/runner/config` | 控制 | 更新规则配置（含乐观锁）|
| GET | `/internal/runner/config` | 控制 | 查看 DB/内存配置版本 |

## 子任务

### 9.1 数据模型（建于 MySQL，初始化时插入默认行）

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
-- 插入默认行
INSERT INTO runner_profile VALUES (1, 1, 5, 2.0, 10, 0.1, 1);
```

**`runner_mix_rule`**
```sql
CREATE TABLE runner_mix_rule (
    id           BIGINT       PRIMARY KEY AUTO_INCREMENT,
    action_type  VARCHAR(32)  NOT NULL,  -- ORDER_SUCCESS / ORDER_FAIL / CANCEL
    ratio        FLOAT        NOT NULL,
    version      INT          NOT NULL DEFAULT 1
);
-- 插入默认规则：90% 正常下单, 5% 失败场景, 5% 取消
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

### 9.2 流量生成引擎
- [ ] 启动 `ScheduledThreadPoolExecutor`，按 `base_qps * multiplier` 调度任务
- [ ] 每个调度 tick：
  1. 从 `runner_mix_rule` 内存规则按概率抽取 `action_type`
  2. 随机选择 `userId`（1~20）、`sku`（SKU-001~SKU-050）、`qty`（1~3）
  3. 调用 `gateway-service POST /api/orders`（或直接调 order-service 内部接口）
  4. 记录结果（成功/失败），更新滚动统计窗口
- [ ] 支持 `jitter_pct` 随机抖动（避免固定节拍）
- [ ] 支持 `cycle_minutes`：流量按周期正弦波动（早晚高峰模拟）

### 9.3 动态调速
- [ ] `POST /internal/runner/rate`：请求体 `{ "multiplier": 2.0 }`
- [ ] 原子更新内存中的倍率，**无需重启**，下一 tick 生效

### 9.4 暂停与恢复
- [ ] `POST /internal/runner/pause`：停止调度（不清除配置）
- [ ] `POST /internal/runner/resume`：恢复调度，继续使用当前内存配置

### 9.5 配置热更新（关键约束）
- [ ] `PUT /internal/runner/config` 请求体：
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
- [ ] DB 更新成功后**原子替换**内存规则对象（`AtomicReference<RunnerConfig>`）
- [ ] 返回 `{ newVersion, appliedAt, activeRuleDigest }`
- [ ] DB 更新失败（版本冲突）不影响当前内存运行，返回 409
- [ ] `GET /internal/runner/config`：返回 `{ dbVersion, memVersion, digest }`

### 9.6 库存重置定时调度
- [ ] 使用 `spring-scheduling`，cron 表达式从 `runner_inventory_reset_policy` 内存加载
- [ ] 执行前检查 `allowed_window`（时间窗限制）
- [ ] 执行流程：
  1. `POST /internal/inventory/reset/plan`（获取预览）
  2. `POST /internal/inventory/reset`（含 `expectedVersion`）
  3. 记录执行结果日志
- [ ] `PUT /internal/runner/inventory-reset/schedule`：更新 cron，**立即刷新内存调度器**（取消旧 task，注册新 task）
- [ ] `POST /internal/runner/inventory-reset/trigger`：绕过时间窗检查，立即执行一次

### 9.7 状态接口
- [ ] `GET /internal/runner/status` 返回：
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

### 9.8 actuator & metrics
- [ ] `runner.request.total` counter
- [ ] `runner.request.success` counter
- [ ] `runner.request.fail` counter
- [ ] `runner.qps` gauge（当前有效 QPS）

### 9.9 验证
- [ ] 启动后 Grafana 可见持续流量产生
- [ ] 动态调速后，Grafana QPS 曲线立即变化
- [ ] 配置更新（版本冲突）正确返回 409
- [ ] 库存定时重置自动执行，重置后下单不再因库存不足失败
- [ ] 暂停/恢复功能正常，恢复后流量自动恢复
