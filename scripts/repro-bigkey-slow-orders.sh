#!/usr/bin/env bash
# Reliably reproduce the scenario where a Redis BigKey slows GET /api/orders/{id}.
#
# Three issues addressed (compared with the standalone injection script):
#   1. QueryEnrichmentInterceptor has a 5s local cache, so a single curl after
#      injection will likely miss Redis. This uses /internal/maintenance/query-enrichment/force-refresh
#      to force the next request to trigger HGETALL.
#   2. The enabled/joinTable fields in the hash would also trigger a slow SQL JOIN,
#      contaminating the check of whether the slowdown comes from Redis. This explicitly sets enabled
#      to false and measures only the BigKey HGETALL overhead.
#   3. QueryEnrichmentInterceptor reads the per-service key first,
#      castrel:query:enrichment:{serviceName}; only when it is empty does it fall back to
#      the global legacy key castrel:query:enrichment. The legacy key is shared by all
#      business services, so injecting a large key can cause other services, such as the smaller
#      catalog-service heap, to deserialize it when their per-service key is empty. This has previously
#      caused catalog-service to OOM. This script therefore injects only the order-service-specific
#      per-service key and does not write the legacy key, avoiding impact on other services.
#
# Usage: ./scripts/repro-bigkey-slow-orders.sh [order_id] [field_count] [value_size]
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
  # Use curl's built-in time_total because macOS BSD date does not support %N in `date +%s%3N`.
  read -r http_status rt_sec < <(curl -s -o /dev/null -w "%{http_code} %{time_total}\n" "${ORDER_SERVICE_URL}/api/orders/${ORDER_ID}"; true)
  echo "[$label] GET /api/orders/${ORDER_ID} http_status=${http_status} RT = ${rt_sec}s"
}

echo "== Step 0: Clear old state and restore a normal small hash (baseline) =="
redis-cli "${REDIS_CLI_ARGS[@]}" DEL "$REDIS_KEY" >/dev/null
redis-cli "${REDIS_CLI_ARGS[@]}" HSET "$REDIS_KEY" \
  enabled false joinTable "" targetServices "" operator "repro-script" startedAt "$(date -u +%FT%TZ)" >/dev/null

echo
echo "== Step 1: Baseline measurement (5 normal fields, no BigKey) =="
force_refresh_and_time "baseline"

echo
echo "== Step 2: Inject BigKey (${FIELD_COUNT} fields, ${VALUE_SIZE} bytes each) =="
./scripts/inject-bigkey-query-enrichment.sh "$FIELD_COUNT" "$VALUE_SIZE"

echo "Ensure enabled=false, isolate SQL JOIN interference, and measure only BigKey HGETALL overhead"
redis-cli "${REDIS_CLI_ARGS[@]}" HSET "$REDIS_KEY" enabled false >/dev/null

echo
echo "== Step 3: BigKey measurement (force bypass of the 5s local cache) =="
force_refresh_and_time "bigkey"

echo
echo "== Step 4: Verify Redis-side metrics =="
echo "HLEN: $(redis-cli "${REDIS_CLI_ARGS[@]}" HLEN "$REDIS_KEY")"
echo "MEMORY USAGE: $(redis-cli "${REDIS_CLI_ARGS[@]}" MEMORY USAGE "$REDIS_KEY" 2>/dev/null || echo '(requires Redis 4.0+)') bytes"
redis-cli "${REDIS_CLI_ARGS[@]}" INFO commandstats | grep -i hgetall || true

echo
echo "== Step 5: Global blocking comparison (optional) =="
echo "At the same time, request an endpoint that does not touch this key to check whether the slowdown is caused by Redis single-threaded global blocking:"
echo "  curl -s -o /dev/null -w '%{time_total}\\n' ${ORDER_SERVICE_URL}/actuator/health"

echo
echo "== Reproduction complete =="
echo "The RT difference between Step 1 and Step 3 is the additional overhead introduced by the BigKey."
echo "For detailed timing sources (HGETALL time versus application-side deserialization), check the order-service log for:"
echo "  \"HGETALL ${REDIS_KEY} cost=...ms fieldCount=...\""
echo "or the corresponding opsForHash().entries span in the APM trace."
echo
echo "Cleanup: redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} DEL ${REDIS_KEY}"
