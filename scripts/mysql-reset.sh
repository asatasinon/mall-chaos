#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MYSQL_DATA_DIR="$ROOT_DIR/data/mysql"

MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"

usage() {
  cat <<'EOF'
Usage: ./scripts/mysql-reset.sh --yes

Destructively removes the MySQL data directory, then starts MySQL so the
current scripts under infra/mysql/init/ recreate the schema and seed data.

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

if [[ -L "$MYSQL_DATA_DIR" || ! -d "$MYSQL_DATA_DIR" ]]; then
  echo "Refusing to reset unexpected MySQL data path: $MYSQL_DATA_DIR" >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Stopping services that can write to MySQL..."
docker compose stop \
  traffic-control-plane-worker traffic-control-plane shopfront gateway-service \
  user-service cart-service catalog-service inventory-service order-service \
  payment-service promotion-service risk-service fulfillment-service \
  notification-service >/dev/null

echo "Stopping MySQL..."
docker compose stop "$MYSQL_SERVICE" >/dev/null

echo "Removing all contents of $MYSQL_DATA_DIR..."
find "$MYSQL_DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +

echo "Starting MySQL and running the current initialization scripts..."
docker compose up -d "$MYSQL_SERVICE" >/dev/null

for attempt in {1..60}; do
  if docker compose exec -T "$MYSQL_SERVICE" sh -c \
    'mysqladmin ping -h localhost -uroot -p"$MYSQL_ROOT_PASSWORD" --silent' \
    >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == 60 ]]; then
    echo "MySQL did not become ready. Check: docker compose logs $MYSQL_SERVICE" >&2
    exit 1
  fi
  sleep 2
done

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
  "$inventories_count" != "50" || "$carts_count" != "2" ]]; then
  echo "Seed data verification failed: users=$users_count products=$products_count inventories=$inventories_count carts=$carts_count" >&2
  exit 1
fi

if [[ "$(mysql_query "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = 'skywalking';")" != "1" ]]; then
  echo "Seed database verification failed: skywalking database is missing" >&2
  exit 1
fi

echo "MySQL reset complete: schema_version=$schema_version users=$users_count products=$products_count inventories=$inventories_count carts=$carts_count"
echo "Application services remain stopped; start them after reviewing the reset result."