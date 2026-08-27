#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
MYSQL_READY_TIMEOUT_SEC="${MYSQL_READY_TIMEOUT_SEC:-120}"
MYSQL_READY_POLL_INTERVAL_SEC="${MYSQL_READY_POLL_INTERVAL_SEC:-2}"

if ! [[ "$MYSQL_READY_TIMEOUT_SEC" =~ ^[1-9][0-9]*$ ]] ||
  ! [[ "$MYSQL_READY_POLL_INTERVAL_SEC" =~ ^[1-9][0-9]*$ ]]; then
  echo "MYSQL_READY_TIMEOUT_SEC and MYSQL_READY_POLL_INTERVAL_SEC must be positive integers." >&2
  exit 2
fi

MYSQL_READY_ATTEMPTS=$((
  (MYSQL_READY_TIMEOUT_SEC + MYSQL_READY_POLL_INTERVAL_SEC - 1) /
  MYSQL_READY_POLL_INTERVAL_SEC
))

usage() {
  cat <<'EOF'
Usage: ./scripts/mysql-reset.sh --yes

Stops application writers, clears the databases through MySQL, and reapplies
the current scripts under infra/mysql/init/ to recreate the schema and seed data.

MYSQL_READY_TIMEOUT_SEC and MYSQL_READY_POLL_INTERVAL_SEC can override the
MySQL readiness wait (defaults: 120 seconds and 2 seconds).

This script does not reset Redis or start the stopped application services.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" != "--yes" || "$#" -ne 1 ]]; then
  usage >&2
  echo >&2
  echo "Refusing to continue without the explicit --yes confirmation." >&2
  exit 2
fi

cd "$ROOT_DIR"

echo "Stopping services that can write to MySQL..."
docker compose stop \
  traffic-control-plane-worker traffic-control-plane shopfront gateway-service \
  user-service cart-service catalog-service inventory-service order-service \
  payment-service promotion-service risk-service fulfillment-service \
  notification-service skywalking-oap >/dev/null

echo "Starting MySQL..."
docker compose up -d "$MYSQL_SERVICE" >/dev/null

for ((attempt = 1; attempt <= MYSQL_READY_ATTEMPTS; attempt++)); do
  if docker compose exec -T "$MYSQL_SERVICE" sh -c \
    'mysqladmin ping -h localhost -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' \
    >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "$MYSQL_READY_ATTEMPTS" ]]; then
    echo "MySQL did not become ready within ${MYSQL_READY_TIMEOUT_SEC}s. Check: docker compose logs $MYSQL_SERVICE" >&2
    exit 1
  fi
  sleep "$MYSQL_READY_POLL_INTERVAL_SEC"
done

echo "Clearing castrel and skywalking databases through SQL..."
docker compose exec -T "$MYSQL_SERVICE" sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --batch -uroot -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; DROP DATABASE IF EXISTS skywalking;"'

mysql_import_database() {
  local init_script="$1"
  docker compose exec -T "$MYSQL_SERVICE" sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --binary-mode=1 -uroot "$MYSQL_DATABASE" < "$1"' \
    sh "$init_script"
}

mysql_import_global() {
  local init_script="$1"
  docker compose exec -T "$MYSQL_SERVICE" sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --binary-mode=1 -uroot < "$1"' \
    sh "$init_script"
}

echo "Applying MySQL schema and seed scripts..."
mysql_import_database /docker-entrypoint-initdb.d/00-schema-ddl.sql
mysql_import_database /docker-entrypoint-initdb.d/01-seed-dml.sql
mysql_import_global /docker-entrypoint-initdb.d/02-exporter-grants.sql
mysql_import_global /docker-entrypoint-initdb.d/03-skywalking-db.sql
mysql_import_database /docker-entrypoint-initdb.d/04-fault-run-schema.sql
mysql_import_database /docker-entrypoint-initdb.d/05-warmup-partitions.sql

mysql_query() {
  local query="$1"
  docker compose exec -T "$MYSQL_SERVICE" sh -c \
    'MYSQL_PWD="$MYSQL_PASSWORD" mysql --batch --skip-column-names -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "$1"' \
    sh "$query"
}

schema_version="$(mysql_query 'SELECT version FROM schema_version WHERE id = 1;')"
if [[ "$schema_version" != "1" ]]; then
  echo "Unexpected schema version: ${schema_version:-<missing>} (expected 1)" >&2
  exit 1
fi

users_count="$(mysql_query 'SELECT COUNT(*) FROM users;')"
products_count="$(mysql_query 'SELECT COUNT(*) FROM products;')"
inventories_count="$(mysql_query 'SELECT COUNT(*) FROM inventories;')"
carts_count="$(mysql_query 'SELECT COUNT(*) FROM carts;')"

if [[ "$users_count" != "20" || "$products_count" != "50" ||
  "$inventories_count" != "50" || "$carts_count" != "1" ]]; then
  echo "Seed data verification failed: users=$users_count products=$products_count inventories=$inventories_count carts=$carts_count" >&2
  exit 1
fi

if [[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = 'skywalking';")" != "1" ]]; then
  echo "Seed database verification failed: skywalking database is missing" >&2
  exit 1
fi

echo "MySQL reset complete: schema_version=$schema_version users=$users_count products=$products_count inventories=$inventories_count carts=$carts_count"
echo "Application services remain stopped; start them after reviewing the reset result."