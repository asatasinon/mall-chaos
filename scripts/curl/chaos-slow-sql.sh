#!/usr/bin/env bash
# Chaos - Slow SQL (requires Spring profile: chaos)
#
# 支持的服务端口：
#   catalog-service    8082
#   inventory-service  8083
#   order-service      8084
#   payment-service    8085
#   promotion-service  8087
#   risk-service       8088
#   fulfillment-service 8089
#
# 参数说明：
#   mode        sleep(真实 SELECT SLEEP) | delay(应用层 Thread.sleep)
#   delayMs     延迟毫秒数
#   injectRate  注入概率 0.0~1.0
#   durationSec 自动关闭秒数，0=永不自动关闭

# ── order-service 示例 ──────────────────────────────────────
ORDER="http://localhost:18084"

curl -X POST "$ORDER/internal/chaos/slow-sql/enable" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "sleep",
    "delayMs": 3000,
    "injectRate": 0.5,
    "durationSec": 60
  }'

curl -X POST "$ORDER/internal/chaos/slow-sql/disable"

curl "$ORDER/internal/chaos/slow-sql/status"

# ── catalog-service ──────────────────────────────────────────
CATALOG="http://localhost:18082"

curl -X POST "$CATALOG/internal/chaos/slow-sql/enable" \
  -H "Content-Type: application/json" \
  -d '{"mode": "sleep", "delayMs": 2000, "injectRate": 1.0, "durationSec": 30}'

curl -X POST "$CATALOG/internal/chaos/slow-sql/disable"

# ── inventory-service ────────────────────────────────────────
INVENTORY="http://localhost:18083"

curl -X POST "$INVENTORY/internal/chaos/slow-sql/enable" \
  -H "Content-Type: application/json" \
  -d '{"mode": "sleep", "delayMs": 2000, "injectRate": 0.8, "durationSec": 60}'

curl -X POST "$INVENTORY/internal/chaos/slow-sql/disable"

# ── payment-service ──────────────────────────────────────────
PAYMENT="http://localhost:18085"

curl -X POST "$PAYMENT/internal/chaos/slow-sql/enable" \
  -H "Content-Type: application/json" \
  -d '{"mode": "sleep", "delayMs": 2000, "injectRate": 1.0, "durationSec": 60}'

curl -X POST "$PAYMENT/internal/chaos/slow-sql/disable"
curl "$PAYMENT/internal/chaos/slow-sql/status"

# ── promotion-service ────────────────────────────────────────
curl -X POST "http://localhost:18087/internal/chaos/slow-sql/enable" \
  -H "Content-Type: application/json" \
  -d '{"mode": "sleep", "delayMs": 1500, "injectRate": 0.5, "durationSec": 60}'

# ── risk-service ─────────────────────────────────────────────
curl -X POST "http://localhost:18088/internal/chaos/slow-sql/enable" \
  -H "Content-Type: application/json" \
  -d '{"mode": "sleep", "delayMs": 1500, "injectRate": 0.5, "durationSec": 60}'

# ── fulfillment-service ──────────────────────────────────────
curl -X POST "http://localhost:18089/internal/chaos/slow-sql/enable" \
  -H "Content-Type: application/json" \
  -d '{"mode": "sleep", "delayMs": 1500, "injectRate": 0.5, "durationSec": 60}'
