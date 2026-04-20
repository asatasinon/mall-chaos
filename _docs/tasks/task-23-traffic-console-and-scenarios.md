# Task 23 — traffic console 与场景编排

**阶段**：Phase 3.5 — 控制面重构  
**依赖**：Task 20、Task 21、Task 22  
**产出**：新的 Next.js 控制台、聚合状态接口、预设场景执行与一键恢复能力

---

## 职责

在新的 traffic control plane 中实现完整控制台体验，替代旧 `chaos-console`。

---

## 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/internal/traffic/chaos/overview` | 聚合 chaos 状态 |
| POST | `/internal/traffic/chaos/slow-sql/enable` | 控制慢 SQL |
| POST | `/internal/traffic/chaos/slow-sql/disable` | 关闭慢 SQL |
| GET | `/internal/traffic/chaos/slow-sql/status` | 查询慢 SQL |
| POST | `/internal/traffic/chaos/memory-leak/enable` | 控制内存泄漏 |
| POST | `/internal/traffic/chaos/memory-leak/disable` | 停止内存泄漏注入 |
| POST | `/internal/traffic/chaos/memory-leak/cleanup` | 清理内存泄漏 |
| GET | `/internal/traffic/chaos/memory-leak/status` | 查询内存泄漏 |
| POST | `/internal/traffic/chaos/deadlock/enable` | 控制死锁 |
| POST | `/internal/traffic/chaos/deadlock/disable` | 关闭死锁 |
| POST | `/internal/traffic/chaos/deadlock/cleanup` | 清理死锁 |
| GET | `/internal/traffic/chaos/deadlock/status` | 查询死锁 |
| POST | `/internal/traffic/chaos/table-lock/enable` | 控制表锁 |
| POST | `/internal/traffic/chaos/table-lock/disable` | 关闭表锁 |
| GET | `/internal/traffic/chaos/table-lock/status` | 查询表锁 |
| POST | `/internal/traffic/chaos/network-delay/enable` | 控制网络延迟 |
| POST | `/internal/traffic/chaos/network-delay/disable` | 关闭网络延迟 |
| GET | `/internal/traffic/chaos/network-delay/status` | 查询网络延迟 |
| POST | `/internal/traffic/scenarios/{scenarioId}/run` | 执行预设场景 |
| POST | `/internal/traffic/scenarios/recover-all` | 一键恢复 |
| GET | `/internal/traffic/scenarios` | 查询预设场景 |

---

## 子任务

### 23.1 Next.js 控制台

- [ ] 构建新的控制台首页
- [ ] 提供服务拓扑可视化
- [ ] 提供资源状态卡片
- [ ] 提供操作日志面板
- [ ] 提供 Grafana / Tempo 深链

### 23.2 聚合状态接口

- [ ] 实现 `GET /internal/traffic/chaos/overview`
- [ ] 聚合 runner、slow-sql、memory-leak、deadlock、table-lock、network 状态
- [ ] 首屏加载优先走 overview

### 23.3 控制动作编排

- [ ] 所有控制动作都经由 gateway
- [ ] batch 操作在 traffic 层做参数校验与结果聚合
- [ ] UI 只面向统一协议，不感知服务差异

### 23.4 场景与恢复

- [ ] 将旧前端 JS 里的场景逻辑迁到 Next.js 服务端 / worker
- [ ] 实现场景配置与场景执行
- [ ] `recover-all` 由后端统一编排
- [ ] 记录执行历史与失败项

### 23.5 旧控制台替换

- [ ] 新控制台功能覆盖旧 `chaos-console`
- [ ] 旧控制台完全下线

### 23.6 验证

- [ ] 首页可加载 overview
- [ ] 每类操作可在 UI 中执行
- [ ] 预设场景可执行
- [ ] 一键恢复可回收所有已激活场景
