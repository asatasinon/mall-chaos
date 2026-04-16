#!/usr/bin/env bash
# Chaos - Deadlock (requires Spring profile: chaos)
# 支持服务：order-service(8084), payment-service(8085)
#
# 参数说明：
#   injectRate  触发死锁的概率 0.0~1.0
#   durationSec 自动关闭秒数，0=永不自动关闭

# ── order-service ─────────────────────────────────────────────
ORDER="http://localhost:8084"

curl -X POST "$ORDER/internal/chaos/deadlock/enable" \
  -H "Content-Type: application/json" \
  -d '{"injectRate": 0.3, "durationSec": 60}'

curl -X POST "$ORDER/internal/chaos/deadlock/disable"

# 清除死锁计数器和 lastError
curl -X POST "$ORDER/internal/chaos/deadlock/clear"

# 查看状态（deadlockCount / lastError / autoDisableAt）
curl "$ORDER/internal/chaos/deadlock/status"

# ── payment-service ───────────────────────────────────────────
PAYMENT="http://localhost:8085"

curl -X POST "$PAYMENT/internal/chaos/deadlock/enable" \
  -H "Content-Type: application/json" \
  -d '{"injectRate": 0.3, "durationSec": 60}'

curl -X POST "$PAYMENT/internal/chaos/deadlock/disable"
curl -X POST "$PAYMENT/internal/chaos/deadlock/clear"
curl "$PAYMENT/internal/chaos/deadlock/status"
