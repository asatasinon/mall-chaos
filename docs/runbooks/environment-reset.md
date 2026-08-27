# 环境重建与运行清理

本项目按新环境部署设计。需要重新应用 schema 和种子数据时，停止应用后清理 MySQL 数据目录，再启动 Compose 初始化脚本。

```bash
./scripts/compose-down.sh
./scripts/mysql-reset.sh --yes
./scripts/compose-up.sh
```

重建后检查：

```bash
curl http://localhost:18080/actuator/health
curl http://localhost:13086/internal/traffic/runner/status
kubectl -n castrel get pods
```

## Fault Run 清理

控制台的运行详情只查询最近 7 天。停止运行必须从控制台执行确认式操作；协调器会停止 worker、调用固定目标恢复并记录事件。不要直接修改 `fault_runs`、`fault_run_events` 或业务表。

通知存储追加运行只能在状态为 `RECOVERED` 或 `STOPPED` 且场景 catalog 允许时，使用详情页面的 Cleanup 操作。清理入口只接受运行 ID，并由目标服务按运行归属删除；不能提交表名、SQL、文件路径或服务名。

通知内存压力运行不会清理已保留对象。服务健康失败后，控制台会显示固定的 notification-service 重启操作：Compose 由独立 broker 执行，Kubernetes 由最小 RBAC 的 broker patch Deployment 模板；重启结果和健康轮询结果写入 Fault Run 事件。

## 数据预热

standalone worker 独占 Redis lease 后维护两个 180 天日分区窗口。每表每天目标 500,000 行，容量保护触发时状态为 `PAUSED_GUARD`。预热状态从控制面 worker API 查看，不手动删除窗口分区。
