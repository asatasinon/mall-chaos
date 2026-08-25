# Castrel Shopfront 环境重置 Runbook

## 用途与边界

本 Runbook 用于清空并重新初始化整套演示环境。它会删除 MySQL 和 Redis 中的全部演示数据、幂等键、冻结令牌和 runner 队列。

它不是 `inventory reset`：库存重置只恢复库存基线，不删除客户、购物车、订单、支付、事件或 Redis 数据，也不能替代本 Runbook。

## 前置条件

- 已通知演示使用者，确认可以丢弃当前全部演示数据。
- 已停止外部业务流量、浏览器自动化和压测工具。
- 已确认没有正在执行的混沌注入或库存重置任务。
- 已保存需要保留的日志、指标和链路查询结果。

## 操作步骤

1. 停止业务流量来源。

   ```bash
   # 停止控制面 worker，保留控制台进程也可以，但不得恢复 runner
   docker compose stop traffic-control-plane
   ```

2. 停止 Gateway 和全部业务服务。

   ```bash
   docker compose stop gateway-service user-service catalog-service inventory-service \
     order-service payment-service promotion-service risk-service fulfillment-service \
     notification-service
   ```

3. 确认没有业务容器仍在运行或连接数据存储。

   ```bash
   docker compose ps
   docker ps --filter 'name=castrel-' --format '{{.Names}} {{.Status}}'
   ```

   若仍有业务容器，先停止它们；不得在有业务连接时删除数据目录。

4. 停止 MySQL 和 Redis。

   ```bash
   docker compose stop mysql redis
   ```

5. 清除数据目录。此操作不可逆，执行前再次确认当前目录是仓库根目录。

   ```bash
   test "$(basename "$PWD")" = "castrel-chaos"
   rm -rf data/mysql data/redis
   mkdir -p data/mysql data/redis
   ```

6. 启动基础设施并等待健康状态。

   ```bash
   docker compose up -d mysql redis
   docker compose ps mysql redis
   ```

   MySQL 首次启动会执行 `infra/mysql/init/00-schema.sql`。若初始化失败，查看日志并修复 Schema 后重新清理数据目录；不要在旧数据目录上假设初始化脚本会重跑。

7. 验证 Schema 版本和关键数据。

   ```bash
   docker compose exec mysql mysql -ucastrel -pcastrel castrel \
     -e 'SELECT id, version FROM schema_version WHERE id = 1;'
   docker compose exec redis redis-cli DBSIZE
   ```

   预期 `schema_version.version = 1`。Redis 应没有旧 checkout 冻结、幂等键和 runner 队列。

8. 启动全部业务服务和 Gateway，等待健康检查通过。

   ```bash
   docker compose up -d gateway-service user-service catalog-service inventory-service \
     order-service payment-service promotion-service risk-service fulfillment-service \
     notification-service
   docker compose ps
   curl --fail http://localhost:18080/actuator/health
   ```

9. 最后启动控制面并恢复 runner。

   ```bash
   docker compose up -d traffic-control-plane
   curl --fail http://localhost:13086/internal/traffic/runner/status
   ```

   只有服务健康、Schema 版本正确、种子数据可读且没有残留 Redis 状态时，才允许恢复 runner。

## 故障处理

- MySQL 初始化失败：停止全部服务，清空 `data/mysql`，修复初始化 SQL 后从第 6 步重试。
- Redis 非空：确认没有合法的新环境数据后停止 Redis，清空 `data/redis`，再启动并复核 `DBSIZE`。
- 服务健康检查失败：保持 runner 停止，先检查服务日志、Schema 版本和数据库连接；不要用 inventory reset 掩盖初始化失败。
- 需要保留当前演示数据：停止操作并先完成数据库与 Redis 备份；本 Runbook 不提供在线保留数据迁移。

## 完成标准

- 所有业务服务、Gateway 和控制面健康。
- `schema_version` 为 Version 1。
- MySQL 中无重置前订单、支付、事件和审计记录。
- Redis 中无重置前幂等键、冻结键和 runner 队列。
- runner 在最后恢复，并能产生新的演示流量。