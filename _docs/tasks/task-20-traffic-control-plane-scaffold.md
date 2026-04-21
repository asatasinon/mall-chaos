# Task 20 — Next.js traffic control plane 脚手架

**阶段**：Phase 3.5 — 控制面重构  
**依赖**：Task 03、Task 09  
**产出**：`traffic-control-plane` 重构为 `Next.js + pnpm` 项目，具备基础控制平面骨架、Runner 控制 API 与独立 worker

---

## 职责

将原有 `traffic-control-plane` 从 Java Spring Boot Runner 重构为新的 traffic control plane：

1. Next.js 前端入口
2. Next.js Route Handlers / BFF
3. Runner Worker
4. 基础状态聚合与审计日志

关键约束：

- [ ] `traffic-control-plane` 只能访问 `gateway-service`
- [ ] 不允许直连业务服务
- [ ] Node 包管理统一使用 `pnpm`
- [ ] 默认使用 TypeScript
- [ ] 原有 Runner 的关键不变量必须保留：
  - 配置更新需带 `version`
  - 库存重置需带 `expectedVersion`
  - 调速无需重启即时生效

---

## 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/internal/traffic/runner/status` | Runner 状态 |
| POST | `/internal/traffic/runner/pause` | 暂停流量 |
| POST | `/internal/traffic/runner/resume` | 恢复流量 |
| POST | `/internal/traffic/runner/rate` | 调整倍率 |
| GET | `/internal/traffic/runner/config` | 查询配置版本 |
| PUT | `/internal/traffic/runner/config` | 更新配置 |
| GET | `/internal/traffic/runner/inventory-reset/schedule` | 查询库存重置策略 |
| PUT | `/internal/traffic/runner/inventory-reset/schedule` | 更新库存重置策略 |
| POST | `/internal/traffic/runner/inventory-reset/trigger` | 立即触发库存重置 |
| GET | `/internal/traffic/runner/data-warmup/progress` | 查询数据填充进度 |

---

## 子任务

### 20.1 项目结构

- [ ] 将 `traffic-control-plane` 重构为 `Next.js + pnpm`
- [ ] 前后端同仓管理
- [ ] 提供本地开发与生产构建方式
- [ ] 保留现有端口语义：对外入口仍为 `18086`
- [ ] 明确 `web` 与 `worker` 两种运行角色

### 20.2 Next.js Route Handlers / BFF 骨架

- [ ] 搭建 Route Handlers 与统一错误处理中间件
- [ ] 统一返回 `ApiResponse<T>` 风格
- [ ] 提供 traceId 透传与日志上下文
- [ ] 提供 `gateway-service` 客户端封装

### 20.3 Next.js 控制台骨架

- [ ] 提供控制台首页与基础布局
- [ ] 提供状态面板、拓扑占位、操作日志面板
- [ ] 提供 Grafana / Tempo 深链配置

### 20.4 Runner Worker 调度迁移

- [ ] 在独立 worker 中实现流量调度引擎
- [ ] 调用 `gateway-service /api/orders`
- [ ] 实现 `jitter_pct`
- [ ] 实现 `cycle_minutes`
- [ ] 记录滚动窗口成功率与失败率
- [ ] 明确 `worker` 默认单实例运行

### 20.5 配置与库存重置

- [ ] 保留 MySQL 表结构不变
- [ ] 保留 `version` 乐观锁更新语义
- [ ] 保留库存重置定时器与立即触发能力
- [ ] 库存重置调用统一经 gateway 分发

### 20.6 构建、镜像与运行模型

- [ ] 使用 `pnpm install` / `pnpm build` 生成 Next.js 产物
- [ ] 设计新的 `traffic-control-plane` Dockerfile
- [ ] 明确 `web` 与 `worker` 是同镜像双入口，还是拆分成两个镜像
- [ ] 在文档中明确生产默认采用“单实例 worker”
- [ ] 补齐环境变量约定：gateway base url、MySQL、Redis、Grafana base url
### 20.7 验证

- [ ] traffic 控制平面可独立启动
- [ ] Next.js 页面可访问
- [ ] Runner 状态接口可返回 `running=true`
- [ ] traffic 发出的业务流量统一经过 gateway
- [ ] `web` 与 `worker` 的启动方式清晰可复现
