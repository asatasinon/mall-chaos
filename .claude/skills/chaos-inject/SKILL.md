---
name: chaos-inject
description: Inject or remove chaos in Castrel services (slow-sql, memory-leak, deadlock, table-lock, network-delay). Prompts for type, target service, and duration, then executes the appropriate curl command via traffic-control-plane.
disable-model-invocation: true
---

# Chaos Inject

向运行中的 Castrel 服务注入或移除故障。所有请求经由 traffic-control-plane (:18086) 转发。

## 用法

```
/chaos-inject [type] [action] [service] [durationSec]
```

- **type**: `slow-sql` | `memory-leak` | `deadlock` | `table-lock` | `network-delay`
- **action**: `enable` | `disable` | `cleanup` | `status`
- **service**: 目标服务名（支持多个，逗号分隔）
- **durationSec**: 自动关闭秒数（0 = 不自动关闭）

## 端点速查

所有请求都发往 `http://localhost:18086/internal/traffic/chaos/<type>/<action>`

### Slow SQL（JOIN 大表放大查询）

适用服务：catalog / inventory / order / payment / promotion / risk / fulfillment / notification

```bash
# 开启（JOIN user_behavior_log，3分钟后自动关闭）
curl -s -X POST http://localhost:18086/internal/traffic/chaos/slow-sql/enable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["<service>"],"joinTable":"user_behavior_log","durationSec":180}' | jq

# 关闭
curl -s -X POST http://localhost:18086/internal/traffic/chaos/slow-sql/disable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["<service>"]}' | jq

# 状态
curl -s "http://localhost:18086/internal/traffic/chaos/slow-sql/status?targets=<service>" | jq
```

### Memory Leak（JVM 堆内存泄漏）

适用服务：order / payment

```bash
# 开启（每300ms分配1MB，上限350MB，3分钟后自动停止分配）
curl -s -X POST http://localhost:18086/internal/traffic/chaos/memory-leak/enable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["<service>"],"chunkSizeKb":1024,"intervalMs":300,"maxMb":350,"durationSec":180}' | jq

# 停止分配（已持有内存不释放）
curl -s -X POST http://localhost:18086/internal/traffic/chaos/memory-leak/disable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["<service>"]}' | jq

# 释放全部持有内存
curl -s -X POST http://localhost:18086/internal/traffic/chaos/memory-leak/cleanup \
  -H 'Content-Type: application/json' \
  -d '{"targets":["<service>"]}' | jq
```

### Deadlock（数据库死锁注入）

适用服务：order / payment

```bash
# 开启（40%概率，3分钟后自动关闭）
curl -s -X POST http://localhost:18086/internal/traffic/chaos/deadlock/enable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["<service>"],"injectRate":0.4,"scope":"ALL","durationSec":180}' | jq

# 关闭
curl -s -X POST http://localhost:18086/internal/traffic/chaos/deadlock/disable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["<service>"]}' | jq
```

### Table Lock（表锁阻塞）

适用服务：inventory / order / payment / risk / fulfillment / notification

```bash
# 开启（锁定指定表，5分钟后自动释放）
curl -s -X POST http://localhost:18086/internal/traffic/chaos/table-lock/enable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["<service>"],"targetTable":"orders","durationSec":300}' | jq

# 释放
curl -s -X POST http://localhost:18086/internal/traffic/chaos/table-lock/disable \
  -H 'Content-Type: application/json' \
  -d '{"targets":["<service>"]}' | jq
```

### Network Delay（ToxiProxy 网络延迟）

代理映射：`order-to-payment` | `order-to-inventory` | `gateway-to-order`

```bash
# 注入延迟（120秒后自动移除）
curl -s -X POST http://localhost:18086/internal/traffic/chaos/network-delay/enable \
  -H 'Content-Type: application/json' \
  -d '{"proxyName":"order-to-payment","latencyMs":3000,"jitterMs":500,"durationSec":120}' | jq

# 移除延迟
curl -s -X POST http://localhost:18086/internal/traffic/chaos/network-delay/disable \
  -H 'Content-Type: application/json' \
  -d '{"proxyName":"order-to-payment"}' | jq

# 查看状态
curl -s "http://localhost:18086/internal/traffic/chaos/network-delay/status?proxyName=order-to-payment" | jq
```

## 一键恢复所有故障

```bash
# 关闭全部服务的 slow-sql / memory-leak / deadlock / table-lock
for svc in catalog-service inventory-service order-service payment-service promotion-service risk-service fulfillment-service notification-service; do
  curl -s -X POST http://localhost:18086/internal/traffic/chaos/slow-sql/disable \
    -H 'Content-Type: application/json' -d "{\"targets\":[\"$svc\"]}" > /dev/null
  curl -s -X POST http://localhost:18086/internal/traffic/chaos/memory-leak/cleanup \
    -H 'Content-Type: application/json' -d "{\"targets\":[\"$svc\"]}" > /dev/null
  curl -s -X POST http://localhost:18086/internal/traffic/chaos/deadlock/disable \
    -H 'Content-Type: application/json' -d "{\"targets\":[\"$svc\"]}" > /dev/null
  curl -s -X POST http://localhost:18086/internal/traffic/chaos/table-lock/disable \
    -H 'Content-Type: application/json' -d "{\"targets\":[\"$svc\"]}" > /dev/null
done

# 移除全部网络 toxics
curl -s -X POST http://localhost:18086/internal/traffic/chaos/network-delay/disable \
  -H 'Content-Type: application/json' -d '{"proxyName":"order-to-payment"}' > /dev/null
curl -s -X POST http://localhost:18086/internal/traffic/chaos/network-delay/disable \
  -H 'Content-Type: application/json' -d '{"proxyName":"order-to-inventory"}' > /dev/null
curl -s -X POST http://localhost:18086/internal/traffic/chaos/network-delay/disable \
  -H 'Content-Type: application/json' -d '{"proxyName":"gateway-to-order"}' > /dev/null

echo "全部 chaos 已清除"
```
