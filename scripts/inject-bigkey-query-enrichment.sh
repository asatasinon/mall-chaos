#!/usr/bin/env bash
# Inject many fields into castrel:query:enrichment to simulate a Redis BigKey failure.
set -euo pipefail

REDIS_HOST="${REDIS_HOST:-10.106.2.78}"
REDIS_PORT="${REDIS_PORT:-16379}"
# Use a per-service key to avoid polluting the global legacy key and affecting other services.
# (The legacy key is the fallback shared by all services. Injecting a BigKey can make every
# service deserialize the hash when its per-service key is empty, potentially OOM-killing
# catalog-service, which has only a 256MB heap.)
TARGET_SERVICE="${TARGET_SERVICE:-order-service}"
REDIS_KEY="castrel:query:enrichment:${TARGET_SERVICE}"
FIELD_COUNT="${1:-50000}"
VALUE_SIZE="${2:-100}"
START_INDEX="${3:-1}"
END_INDEX=$((START_INDEX + FIELD_COUNT - 1))

REDIS_CLI_ARGS=(-h "$REDIS_HOST" -p "$REDIS_PORT")
if [[ -n "${REDIS_PASSWORD:-}" ]]; then
  REDIS_CLI_ARGS+=(-a "$REDIS_PASSWORD" --no-auth-warning)
fi

echo "Target: redis://${REDIS_HOST}:${REDIS_PORT} key=${REDIS_KEY}"
echo "Fields to inject: ${FIELD_COUNT}, value size per field: ${VALUE_SIZE} bytes, starting index: ${START_INDEX}"
echo "Field count before injection: $(redis-cli "${REDIS_CLI_ARGS[@]}" HLEN "$REDIS_KEY" 2>/dev/null || echo 0)"

PADDING=$(printf 'x%.0s' $(seq 1 "$VALUE_SIZE"))

{
  for i in $(seq -f '%.0f' "$START_INDEX" "$END_INDEX"); do
    printf 'HSET %s field-%06d %s\n' "$REDIS_KEY" "$i" "$PADDING"
  done
} | redis-cli "${REDIS_CLI_ARGS[@]}" --pipe

echo "Injection complete, current field count: $(redis-cli "${REDIS_CLI_ARGS[@]}" HLEN "$REDIS_KEY")"
echo "Estimated memory usage: $(redis-cli "${REDIS_CLI_ARGS[@]}" MEMORY USAGE "$REDIS_KEY" 2>/dev/null || echo '(requires Redis 4.0+)') bytes"
