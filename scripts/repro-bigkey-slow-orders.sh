#!/usr/bin/env bash
# 稳定复现 "Redis BigKey 导致 GET /api/orders/{id} 变慢" 场景。
#
# 解决的三个问题（对照 inject-bigkey-query-enrichment.sh 的单独注入）：
#   1. QueryEnrichmentInterceptor 有 5s 本地缓存，直接注入后单次 curl 大概率
#      读不到 Redis —— 这里用 /internal/maintenance/query-enrichment/force-refresh
#      强制下一次请求必定触发 HGETALL。
#   2. 该 hash 里的 enabled/joinTable 字段会额外触发一次 SQL JOIN 慢查询，
#      污染"变慢是否来自 Redis"的判断 —— 这里显式把 enabled 设为 false，
#      只保留 BigKey 本身的 HGETALL 开销。
#   3. QueryEnrichmentInterceptor 优先读取 per-service key
#      castrel:query:enrichment:{serviceName}，只有它为空时才 fallback 到
#      全局 legacy key castrel:query:enrichment —— legacy key 被所有业务
#      服务共享，注入大 key 会导致其他服务（例如堆内存更小的 catalog-service）
#      在自己的 per-service key 为空时也去反序列化这个大 hash，曾经因此把
#      catalog-service 直接 OOM 打死。因此这里改为只注入 order-service 专属的
#      per-service key，不再写 legacy key，避免误伤其他服务。
#
# 用法: ./scripts/repro-bigkey-slow-orders.sh [order_id] [field_count] [value_size]
set -euo pipefail

REDIS_HOST="${REDIS_HOST:-10.106.2.78}"
REDIS_PORT="${REDIS_PORT:-16379}"
TARGET_SERVICE="order-service"
REDIS_KEY="castrel:query:enrichment:${TARGET_SERVICE}"
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
  local rt_sec http_status
  # 用 curl 自带的 time_total，避免 `date +%s%3N` 在 macOS (BSD date) 上不支持 %N 的问题
  read -r http_status rt_sec < <(curl -s -o /dev/null -w "%{http_code} %{time_total}\n" "${ORDER_SERVICE_URL}/api/orders/${ORDER_ID}"; true)
  echo "[$label] GET /api/orders/${ORDER_ID} http_status=${http_status} RT = ${rt_sec}s"
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
echo "  \"HGETALL ${REDIS_KEY} cost=...ms fieldCount=...\""
echo "或对应 APM trace 中 opsForHash().entries 这个 span。"
echo
echo "清理: redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} DEL ${REDIS_KEY}"
