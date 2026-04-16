#!/usr/bin/env bash
# Inventory Reset API (port 8083)
BASE="http://localhost:8083"

# 查看重置计划（dry-run，不实际执行）
curl -X POST "$BASE/internal/inventory/reset/plan"

# 执行库存重置（expectedVersion 从 reset/plan 响应获取）
curl -X POST "$BASE/internal/inventory/reset" \
  -H "Content-Type: application/json" \
  -d '{"expectedVersion": 1}'

# 查询某 SKU 库存
curl "$BASE/internal/inventory/SKU-001"
