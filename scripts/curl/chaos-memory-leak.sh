#!/usr/bin/env bash
# Chaos - Memory Leak (requires Spring profile: chaos)
# 支持服务：order-service(8084), payment-service(8085)
#
# 参数说明：
#   chunkSizeKb  每次分配的块大小（KB）
#   intervalMs   分配间隔（ms）
#   maxMb        最大占用上限（MB），达到后停止分配

# ── order-service ─────────────────────────────────────────────
ORDER="http://localhost:8084"

curl -X POST "$ORDER/internal/chaos/memory-leak/start" \
  -H "Content-Type: application/json" \
  -d '{"chunkSizeKb": 1024, "intervalMs": 500, "maxMb": 512}'

# 停止（保留已占内存）
curl -X POST "$ORDER/internal/chaos/memory-leak/stop"

# 清除已泄漏内存
curl -X POST "$ORDER/internal/chaos/memory-leak/clear"

# 查看状态（holdingMb / objectCount / running）
curl "$ORDER/internal/chaos/memory-leak/status"

# ── payment-service ───────────────────────────────────────────
PAYMENT="http://localhost:8085"

curl -X POST "$PAYMENT/internal/chaos/memory-leak/start" \
  -H "Content-Type: application/json" \
  -d '{"chunkSizeKb": 1024, "intervalMs": 500, "maxMb": 512}'

curl -X POST "$PAYMENT/internal/chaos/memory-leak/stop"
curl -X POST "$PAYMENT/internal/chaos/memory-leak/clear"
curl "$PAYMENT/internal/chaos/memory-leak/status"
