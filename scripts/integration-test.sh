#!/usr/bin/env bash
set -euo pipefail

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-13306}"
MYSQL_USER="${MYSQL_USER:-castrel}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-castrel}"
MYSQL_DATABASE="${MYSQL_DATABASE:-castrel}"

docker compose up -d mysql redis >/dev/null

for attempt in {1..30}; do
  if mysqladmin ping -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --silent 2>/dev/null; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    echo "mysql did not become ready" >&2
    exit 1
  fi
  sleep 2
done

mysql_query() {
  mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -e "$1"
}

[[ "$(mysql_query 'SELECT version FROM schema_version WHERE id = 1;')" == "1" ]]
[[ "$(mysql_query 'SELECT COUNT(*) FROM carts;')" -ge 2 ]]
[[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${MYSQL_DATABASE}' AND table_name LIKE '%_outbox_events';")" -eq 0 ]]
[[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${MYSQL_DATABASE}' AND table_name LIKE '%_inbox_events';")" -eq 0 ]]
if [[ "$(docker compose exec -T redis redis-cli ping)" != "PONG" ]]; then
  echo "redis did not respond with PONG" >&2
  exit 1
fi

if [[ "${RUN_SCHEMA_VERSION_SMOKE:-false}" == "true" ]]; then
  ./scripts/schema-version-smoke-test.sh
fi

echo "integration-test: passed"