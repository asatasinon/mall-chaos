#!/usr/bin/env bash
# 稳定复现 "Redis BigKey 导致 GET /api/orders/{id} 变慢" 场景。
#
# 解决的两个问题（对照 inject-bigkey-query-enrichment.sh 的单独注入）：
#   1. QueryEnrichmentInterceptor 有 5s 本地缓存，直接注入后单次 curl 大概率
#      读不到 Redis —— 这里用 /internal/maintenance/query-enrichment/force-refresh
#      强制下一次请求必定触发 HGETALL。
#   2. 该 hash 里的 enabled/joinTable 字段会额外触发一次 SQL JOIN 慢查询，
#      污染"变慢是否来自 Redis"的判断 —— 这里显式把 enabled 设为 false，
#      只保留 BigKey 本身的 HGETALL 开销。
#
# 用法: ./scripts/repro-bigkey-slow-orders.sh [order_id] [field_count] [value_size]
set -euo pipefail

REDIS_HOST="${REDIS_HOST:-10.106.2.78}"
REDIS_PORT="${REDIS_PORT:-16379}"
REDIS_KEY="castrel:query:enrichment"
ORDER_SERVICE_URL="${ORDER_SERVICE_URL:-http://localhost:8084}"
ORDER_ID="${1:-10}"
FIELD_COUNT="${2:-50000}"
VALUE_SIZE="${3:-100}"

REDIS_CLI_ARGS=(-h "$REDIS_HOST" -p "$REDIS_PORT")
if [[ -n "${REDIS_PASSWORD:-}" ]]; then
  REDIS_CLI_ARGS+=(-a "$REDIS_PASSWORD" --no-auth-warning)
fi

force_refresh_and_time() {
  local label="$1"
  curl -s -o /dev/null -X POST "${ORDER_SERVICE_URL}/internal/maintenance/query-enrichment/force-refresh"
  local t0 t1 rt_ms
  t0=$(date +%s%3N)
  curl -s -o /dev/null -w "http_status=%{http_code}\n" "${ORDER_SERVICE_URL}/api/orders/${ORDER_ID}"
  t1=$(date +%s%3N)
  rt_ms=$((t1 - t0))
  echo "[$label] GET /api/orders/${ORDER_ID} RT = ${rt_ms} ms"
}

echo "== Step 0: 清理旧状态,还原为正常小 hash（baseline） =="
redis-cli "${REDIS_CLI_ARGS[@]}" DEL "$REDIS_KEY" >/dev/null
redis-cli "${REDIS_CLI_ARGS[@]}" HSET "$REDIS_KEY" \
  enabled false joinTable "" targetServices "" operator "repro-script" startedAt "$(date -u +%FT%TZ)" >/dev/null

echo
echo "== Step 1: baseline 测量（5 个正常字段,无 BigKey） =="
force_refresh_and_time "baseline"

echo
echo "== Step 2: 注入 BigKey（${FIELD_COUNT} 个字段, 每个 ${VALUE_SIZE} 字节） =="
./scripts/inject-bigkey-query-enrichment.sh "$FIELD_COUNT" "$VALUE_SIZE"

echo "确保 enabled=false,隔离 SQL JOIN 干扰,只测量 BigKey 本身的 HGETALL 开销"
redis-cli "${REDIS_CLI_ARGS[@]}" HSET "$REDIS_KEY" enabled false >/dev/null

echo
echo "== Step 3: BigKey 场景测量（强制绕过 5s 本地缓存） =="
force_refresh_and_time "bigkey"

echo
echo "== Step 4: Redis 侧指标核对 =="
echo "HLEN: $(redis-cli "${REDIS_CLI_ARGS[@]}" HLEN "$REDIS_KEY")"
echo "MEMORY USAGE: $(redis-cli "${REDIS_CLI_ARGS[@]}" MEMORY USAGE "$REDIS_KEY" 2>/dev/null || echo '(需要 Redis 4.0+)') 字节"
redis-cli "${REDIS_CLI_ARGS[@]}" INFO commandstats | grep -i hgetall || true

echo
echo "== Step 5: 全局阻塞对照（可选） =="
echo "同时段请求一个不碰该 key 的接口,确认变慢是否为 Redis 单线程全局阻塞效应:"
echo "  curl -s -o /dev/null -w '%{time_total}\\n' ${ORDER_SERVICE_URL}/actuator/health"

echo
echo "== 复现完成 =="
echo "对比 Step 1 与 Step 3 的 RT 差值,即为 BigKey 引入的额外开销。"
echo "详细耗时来源(HGETALL 本身耗时 vs 应用侧反序列化)可查看 order-service 日志中:"
echo "  \"HGETALL castrel:query:enrichment cost=...ms fieldCount=...\""
echo "或对应 APM trace 中 opsForHash().entries 这个 span。"
echo
echo "清理: redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} DEL ${REDIS_KEY}"
