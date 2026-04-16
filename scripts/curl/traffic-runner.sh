#!/usr/bin/env bash
# Traffic Runner API (port 8086)
BASE="http://localhost:8086"

# 查看运行状态
curl "$BASE/internal/runner/status"

# 暂停流量
curl -X POST "$BASE/internal/runner/pause"

# 恢复流量
curl -X POST "$BASE/internal/runner/resume"

# 调整流量倍率（1.0=正常, 2.0=双倍）
curl -X POST "$BASE/internal/runner/rate" \
  -H "Content-Type: application/json" \
  -d '{"multiplier": 2.0}'

# 手动触发库存重置
curl -X POST "$BASE/internal/runner/inventory-reset/trigger"

# 查看 runner 配置
curl "$BASE/internal/runner/config"

# 更新 runner 配置（version 字段为乐观锁，必填）
curl -X PUT "$BASE/internal/runner/config" \
  -H "Content-Type: application/json" \
  -d '{"version": 1, "orderIntervalMs": 2000, "userPool": 50}'
