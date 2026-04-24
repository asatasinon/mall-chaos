---
name: service-log
description: Fetch and filter logs from a Castrel Docker Compose service. Supports tail length, log level filter (ERROR/WARN/INFO), and traceId filter. Usage: /service-log <service> [--tail N] [--level ERROR] [--trace <traceId>]
disable-model-invocation: true
---

# Service Log

快速拉取指定服务的结构化日志，支持按日志级别和 traceId 过滤。

## 用法

```
/service-log <service> [--tail N] [--level ERROR|WARN|INFO] [--trace <traceId>]
```

**service** 可选值：
`gateway-service` | `user-service` | `catalog-service` | `inventory-service` | `order-service` | `payment-service` | `promotion-service` | `risk-service` | `fulfillment-service` | `notification-service` | `traffic-control-plane`

## 常用命令

```bash
# 查看 order-service 最近 100 条日志
docker compose logs --tail=100 --no-log-prefix order-service

# 只看 ERROR 级别
docker compose logs --tail=200 --no-log-prefix order-service | grep '"level":"ERROR"'

# 按 traceId 过滤（定位完整链路）
docker compose logs --tail=500 --no-log-prefix order-service | grep '"traceId":"<traceId>"'

# 多服务同时看（下单链路）
docker compose logs --tail=100 --no-log-prefix order-service payment-service inventory-service

# 实时跟踪（-f）某服务的 ERROR
docker compose logs -f --no-log-prefix order-service | grep --line-buffered '"level":"ERROR"'

# 按 traceId 跨全部服务追踪一条请求
TRACE_ID="<traceId>"
for svc in gateway-service order-service payment-service inventory-service; do
  echo "=== $svc ==="
  docker compose logs --tail=500 --no-log-prefix $svc | grep "\"$TRACE_ID\""
done

# 查看最近的慢 SQL 日志
docker compose logs --tail=500 --no-log-prefix order-service | \
  python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
        if 'slow' in str(d).lower() or d.get('durationMs', 0) > 1000:
            print(json.dumps(d, ensure_ascii=False))
    except:
        pass
"

# 查看内存泄漏相关日志
docker compose logs --tail=300 --no-log-prefix order-service | grep -i "memory\|heap\|leak"

# 查看死锁重试日志
docker compose logs --tail=300 --no-log-prefix order-service payment-service | grep -i "deadlock\|retry"
```

## 服务容器名映射

| 服务 | 容器名 | 宿主机端口 |
|---|---|---|
| gateway-service | gateway-service | 18080 |
| order-service | order-service | 18084 |
| payment-service | payment-service | 18085 |
| inventory-service | inventory-service | 18083 |
| catalog-service | catalog-service | 18082 |
| user-service | user-service | 18081 |
| promotion-service | promotion-service | 18087 |
| risk-service | risk-service | 18088 |
| fulfillment-service | fulfillment-service | 18089 |
| notification-service | notification-service | 18090 |
| traffic-control-plane | traffic-control-plane | 18086 |

## MySQL 诊断命令（配合 chaos 分析）

```bash
# 查看当前活跃事务（死锁/表锁时有用）
docker exec -it castrel-mysql mysql -u castrel -pcastrel castrel \
  -e "SELECT * FROM information_schema.INNODB_TRX\G"

# 查看当前进程列表（慢 SQL 时有用）
docker exec -it castrel-mysql mysql -u castrel -pcastrel castrel \
  -e "SHOW FULL PROCESSLIST\G"

# 最近慢查询
docker exec -it castrel-mysql mysql -u castrel -pcastrel castrel \
  -e "SELECT query_time, sql_text FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10\G"

# InnoDB 锁等待状态
docker exec -it castrel-mysql mysql -u castrel -pcastrel castrel \
  -e "SHOW ENGINE INNODB STATUS\G" | grep -A 30 "LATEST DETECTED DEADLOCK"
```
