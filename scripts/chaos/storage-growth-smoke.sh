#!/usr/bin/env bash
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:18080}"
TARGET_SERVICE="${TARGET_SERVICE:-catalog-service}"
STORAGE_TYPE="${STORAGE_TYPE:-mysql}"
RUN_ID="${RUN_ID:-storage-smoke-$(date +%s)}"
TARGET_BYTES="${TARGET_BYTES:-4194304}"
RATE_BYTES_PER_SEC="${RATE_BYTES_PER_SEC:-1048576}"
DURATION_SEC="${DURATION_SEC:-30}"
MIN_FREE_BYTES="${MIN_FREE_BYTES:-1073741824}"

case "$TARGET_SERVICE" in
  catalog-service|risk-service|notification-service) ;;
  *) echo "Unsupported TARGET_SERVICE: $TARGET_SERVICE" >&2; exit 2 ;;
esac

case "$STORAGE_TYPE" in
  mysql|filesystem) ;;
  *) echo "Unsupported STORAGE_TYPE: $STORAGE_TYPE" >&2; exit 2 ;;
esac

payload=$(cat <<JSON
{
  "targetService": "$TARGET_SERVICE",
  "storageType": "$STORAGE_TYPE",
  "runId": "$RUN_ID",
  "targetBytes": $TARGET_BYTES,
  "rateBytesPerSec": $RATE_BYTES_PER_SEC,
  "durationSec": $DURATION_SEC,
  "minFreeBytes": $MIN_FREE_BYTES,
  "minFreePercent": 10
}
JSON
)

curl --fail-with-body -sS -X POST "$GATEWAY_URL/internal/gateway/chaos/storage-growth/enable" \
  -H 'Content-Type: application/json' -d "$payload"
printf '\n'

curl --fail-with-body -sS "$GATEWAY_URL/internal/gateway/chaos/storage-growth/status?targetService=$TARGET_SERVICE"
printf '\n'

curl --fail-with-body -sS -X POST "$GATEWAY_URL/internal/gateway/chaos/storage-growth/disable" \
  -H 'Content-Type: application/json' -d "$payload"
printf '\n'

curl --fail-with-body -sS -X POST "$GATEWAY_URL/internal/gateway/chaos/storage-growth/cleanup" \
  -H 'Content-Type: application/json' -d "$payload"
printf '\n'

echo "Storage growth smoke test completed: service=$TARGET_SERVICE type=$STORAGE_TYPE runId=$RUN_ID"
