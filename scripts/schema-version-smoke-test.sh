#!/usr/bin/env bash
set -euo pipefail

SERVICE_URL="${SCHEMA_VERSION_SERVICE_URL:-http://localhost:8081}"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"

mysql_exec() {
  docker compose exec -T "$MYSQL_SERVICE" mysql -ucastrel -pcastrel castrel -N -e "$1"
}

restore_schema_version() {
  mysql_exec "DELETE FROM schema_version WHERE id = 1; INSERT INTO schema_version (id, version) VALUES (1, 1);" >/dev/null
}

trap restore_schema_version EXIT

assert_readiness() {
  local expected_code="$1"
  local expected_status="$2"
  local response
  response="$(curl --silent --show-error --write-out '\n%{http_code}' "$SERVICE_URL/actuator/health/readiness")"
  if [[ "$(printf '%s\n' "$response" | tail -n 1)" != "$expected_code" ]] ||
     ! printf '%s\n' "$response" | grep -q '"status":"'"$expected_status"'"'; then
    printf 'unexpected readiness response: %s\n' "$response" >&2
    exit 1
  fi
}

assert_readiness 200 UP
mysql_exec "DELETE FROM schema_version WHERE id = 1;" >/dev/null
assert_readiness 503 DOWN
mysql_exec "INSERT INTO schema_version (id, version) VALUES (1, 2);" >/dev/null
assert_readiness 503 DOWN
mysql_exec "UPDATE schema_version SET version = 1 WHERE id = 1;" >/dev/null
assert_readiness 200 UP

echo "schema-version-smoke-test: passed"