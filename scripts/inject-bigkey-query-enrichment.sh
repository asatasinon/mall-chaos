#!/usr/bin/env bash
# 向 castrel:query:enrichment 注入大量字段,模拟 Redis 大 key 故障场景。
set -euo pipefail

REDIS_HOST="${REDIS_HOST:-10.106.2.78}"
REDIS_PORT="${REDIS_PORT:-16379}"
REDIS_KEY="castrel:query:enrichment"
FIELD_COUNT="${1:-50000}"
VALUE_SIZE="${2:-100}"
START_INDEX="${3:-1}"
END_INDEX=$((START_INDEX + FIELD_COUNT - 1))

REDIS_CLI_ARGS=(-h "$REDIS_HOST" -p "$REDIS_PORT")
if [[ -n "${REDIS_PASSWORD:-}" ]]; then
  REDIS_CLI_ARGS+=(-a "$REDIS_PASSWORD" --no-auth-warning)
fi

echo "目标: redis://${REDIS_HOST}:${REDIS_PORT} key=${REDIS_KEY}"
echo "注入字段数: ${FIELD_COUNT}, 每个字段值长度: ${VALUE_SIZE} 字节, 字段起始序号: ${START_INDEX}"
echo "注入前该 key 的字段数: $(redis-cli "${REDIS_CLI_ARGS[@]}" HLEN "$REDIS_KEY" 2>/dev/null || echo 0)"

PADDING=$(printf 'x%.0s' $(seq 1 "$VALUE_SIZE"))

{
  for i in $(seq "$START_INDEX" "$END_INDEX"); do
    printf 'HSET %s field-%06d %s\n' "$REDIS_KEY" "$i" "$PADDING"
  done
} | redis-cli "${REDIS_CLI_ARGS[@]}" --pipe

echo "注入完成,当前字段数: $(redis-cli "${REDIS_CLI_ARGS[@]}" HLEN "$REDIS_KEY")"
echo "预估占用内存: $(redis-cli "${REDIS_CLI_ARGS[@]}" MEMORY USAGE "$REDIS_KEY" 2>/dev/null || echo '(需要 Redis 4.0+)') 字节"
