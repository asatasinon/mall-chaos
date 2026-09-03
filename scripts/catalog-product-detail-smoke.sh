#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://127.0.0.1:13086}"
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:18080}"
REDIS_SERVICE="${REDIS_SERVICE:-redis}"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
MYSQL_USER="${MYSQL_USER:-castrel}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-castrel}"
MYSQL_DATABASE="${MYSQL_DATABASE:-castrel}"
CONTROL_PLANE_USERNAME="${CONTROL_PLANE_USERNAME:-castrel}"
CONTROL_PLANE_PASSWORD="${CONTROL_PLANE_PASSWORD:-C@stre1_best_ai}"
DURATION_SEC="${CATALOG_SMOKE_DURATION_SEC:-30}"
MEMBER_COUNT="${CATALOG_SMOKE_MEMBER_COUNT:-2}"
MEMBER_SIZE_BYTES="${CATALOG_SMOKE_MEMBER_SIZE_BYTES:-1024}"
CONCURRENCY="${CATALOG_SMOKE_CONCURRENCY:-1}"
REQUEST_INTERVAL_MS="${CATALOG_SMOKE_REQUEST_INTERVAL_MS:-0}"
KEY_TTL_SEC="${CATALOG_SMOKE_KEY_TTL_SEC:-120}"
DEFAULT_HASH="catalog:product-detail:cache"
MARKER_KEY="catalog:product-detail:active"
MARKER_OWNER_KEY="catalog:product-detail:active:owner"
MARKER_FENCE_KEY="catalog:product-detail:active:fence"
SCENARIO="CATALOG_REDIS_LARGE_VALUE"
OPERATION="product-detail-cache"
COOKIE_JAR=""
RUN_ID=""
CSRF_TOKEN=""

fail() {
  printf 'catalog-product-detail-smoke: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  [[ "$actual" == "$expected" ]] || fail "$label: expected '$expected', got '$actual'"
}

assert_true() {
  "$@" || fail "assertion failed: $*"
}

redis_cli() {
  docker compose exec -T "$REDIS_SERVICE" redis-cli --raw "$@"
}

mysql_scalar() {
  docker compose exec -T "$MYSQL_SERVICE" mysql --batch --skip-column-names \
    -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "$1"
}

request() {
  local method="$1"
  local url="$2"
  local body_file="$3"
  local headers_file="$4"
  shift 4
  curl -fsS -D "$headers_file" -o "$body_file" -w '%{http_code}' \
    -X "$method" "$url" "$@"
}

cache_result_header() {
  awk 'tolower($1) == "x-castrel-cache-result:" { gsub("\r", "", $2); print $2; exit }' "$1"
}

json_code_must_be_zero() {
  jq -e '.code == 0' "$1" >/dev/null || fail "unexpected API response: $(jq -c '.' "$1")"
}

cleanup_run() {
  local exit_code="${1:-0}"
  set +e
  if [[ -n "$RUN_ID" && -n "$CSRF_TOKEN" ]]; then
    local stop_key="catalog-smoke-stop-${RUN_ID}-$(date +%s)"
    local cleanup_key="catalog-smoke-cleanup-${RUN_ID}-$(date +%s)"
    curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" \
      -H "X-Idempotency-Key: $stop_key" -H 'Content-Type: application/json' \
      -X POST "${CONTROL_PLANE_URL}/internal/fault-runs/${RUN_ID}/stop" \
      --data '{"confirmed":true}' >/dev/null 2>&1
    curl -sS -b "$COOKIE_JAR" -H "X-CSRF-Token: $CSRF_TOKEN" \
      -H "X-Idempotency-Key: $cleanup_key" -H 'Content-Type: application/json' \
      -X POST "${CONTROL_PLANE_URL}/internal/fault-runs/${RUN_ID}/cleanup" \
      --data '{"confirmed":true}' >/dev/null 2>&1
  fi
  if [[ -n "$COOKIE_JAR" ]]; then rm -rf "$COOKIE_JAR"; fi
  exit "$exit_code"
}

require_command curl
require_command jq
require_command docker
require_command awk
require_command sed
require_command mktemp
trap 'cleanup_run "$?"' EXIT

[[ "$DURATION_SEC" =~ ^[0-9]+$ && "$DURATION_SEC" -ge 1 ]] || fail 'CATALOG_SMOKE_DURATION_SEC must be a positive integer'
[[ "$MEMBER_COUNT" =~ ^[0-9]+$ && "$MEMBER_COUNT" -ge 1 ]] || fail 'CATALOG_SMOKE_MEMBER_COUNT must be a positive integer'
[[ "$MEMBER_SIZE_BYTES" =~ ^[0-9]+$ && "$MEMBER_SIZE_BYTES" -ge 256 ]] || fail 'CATALOG_SMOKE_MEMBER_SIZE_BYTES must be at least 256'
[[ "$KEY_TTL_SEC" =~ ^[0-9]+$ && "$KEY_TTL_SEC" -ge $((DURATION_SEC + 60)) ]] \
  || fail 'CATALOG_SMOKE_KEY_TTL_SEC must cover duration plus 60 seconds of cleanup grace'

cd "$REPO_ROOT"
COOKIE_JAR="$(mktemp -d)"
login_body="$COOKIE_JAR/login.json"
login_headers="$COOKIE_JAR/login.headers"
login_status="$(request POST "${CONTROL_PLANE_URL}/api/operator/session" "$login_body" "$login_headers" \
  -c "$COOKIE_JAR/cookies.txt" -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg username "$CONTROL_PLANE_USERNAME" --arg password "$CONTROL_PLANE_PASSWORD" \
    '{username:$username,password:$password}')")" || true
assert_equal "$login_status" "200" 'operator login HTTP status'
json_code_must_be_zero "$login_body"
CSRF_TOKEN="$(awk '$6 == "operator_csrf" { print $7 }' "$COOKIE_JAR/cookies.txt")"
[[ "${#CSRF_TOKEN}" -ge 32 ]] || fail 'operator CSRF cookie was not issued'

before_default_exists="$(redis_cli EXISTS "$DEFAULT_HASH")"
before_default_type="$(redis_cli TYPE "$DEFAULT_HASH")"
before_default_fields="$(redis_cli HLEN "$DEFAULT_HASH")"
before_products="$(mysql_scalar 'SELECT COUNT(*) FROM products;')"
before_inventories="$(mysql_scalar 'SELECT COUNT(*) FROM inventories;')"
before_carts="$(mysql_scalar 'SELECT COUNT(*) FROM carts;')"
before_orders="$(mysql_scalar 'SELECT COUNT(*) FROM orders;')"

idempotency_key="catalog-smoke-create-$(date +%s)-$$"
create_body="$COOKIE_JAR/create.json"
create_headers="$COOKIE_JAR/create.headers"
create_status="$(request POST "${CONTROL_PLANE_URL}/internal/fault-runs" "$create_body" "$create_headers" \
  -b "$COOKIE_JAR/cookies.txt" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "X-Idempotency-Key: $idempotency_key" -H 'Content-Type: application/json' \
  --data "$(jq -cn \
    --arg scenario "$SCENARIO" \
    --arg idempotencyKey "$idempotency_key" \
    --argjson durationSec "$DURATION_SEC" \
    --argjson memberCount "$MEMBER_COUNT" \
    --argjson memberSizeBytes "$MEMBER_SIZE_BYTES" \
    --argjson concurrency "$CONCURRENCY" \
    --argjson requestIntervalMs "$REQUEST_INTERVAL_MS" \
    --argjson keyTtlSec "$KEY_TTL_SEC" \
    '{scenario:$scenario,parameters:{durationSec:$durationSec,memberCount:$memberCount,memberSizeBytes:$memberSizeBytes,concurrency:$concurrency,requestIntervalMs:$requestIntervalMs,keyTtlSec:$keyTtlSec},confirmed:true,idempotencyKey:$idempotencyKey}')" || true)"
assert_equal "$create_status" "201" 'Fault Run create HTTP status'
json_code_must_be_zero "$create_body"
RUN_ID="$(jq -r '.data.faultRunId' "$create_body")"
[[ "$RUN_ID" =~ ^[0-9a-f-]{36}$ ]] || fail 'Fault Run create did not return a UUID'
assert_equal "$(jq -r '.data.state' "$create_body")" "ACTIVE" 'Fault Run state after create'

run_detail_body="$COOKIE_JAR/detail.json"
run_detail_status="$(request GET "${CONTROL_PLANE_URL}/internal/fault-runs/${RUN_ID}" "$run_detail_body" "$COOKIE_JAR/detail.headers" \
  -b "$COOKIE_JAR/cookies.txt")"
assert_equal "$run_detail_status" "200" 'Fault Run detail HTTP status'
json_code_must_be_zero "$run_detail_body"
jq -e --arg scenario "$SCENARIO" \
  '.data.run.scenario == $scenario
   and (.data.events | any(.eventType == "TARGET_CONFIRMED"))
   and (.data.audit.action == "FAULT_RUN_CREATE")
   and (.data.audit.result == "SUCCESS")' "$run_detail_body" >/dev/null \
  || fail 'Fault Run detail did not contain target confirmation and audit evidence'

hash_key="catalog:product-detail:operation:${RUN_ID}"
summary="$(jq -c '.data.events[] | select(.eventType == "TARGET_CONFIRMED") | .payload.targetSummary' "$run_detail_body" | tail -n 1)"
[[ -n "$summary" && "$summary" != "null" ]] || fail 'target summary is missing from Fault Run detail'
assert_equal "$(jq -r '.layout' <<<"$summary")" "HASH" 'target layout'
assert_equal "$(jq -r '.hashKey' <<<"$summary")" "$hash_key" 'target Hash namespace'
assert_equal "$(jq -r '.memberCount' <<<"$summary")" "$MEMBER_COUNT" 'target member count'
assert_equal "$(jq -r '.memberSizeBytes' <<<"$summary")" "$MEMBER_SIZE_BYTES" 'target member size'
assert_equal "$(jq -r '.logicalBytes' <<<"$summary")" "$((MEMBER_COUNT * MEMBER_SIZE_BYTES))" 'target logical bytes'
probe_sku="$(jq -r '.probeSku' <<<"$summary")"
member_sku="$(jq -r '.memberSkus[0]' <<<"$summary")"
[[ -n "$probe_sku" && -n "$member_sku" && "$probe_sku" != "$member_sku" ]] || fail 'target summary did not separate probe and member SKU'

assert_equal "$(redis_cli TYPE "$hash_key")" "hash" 'run Redis type'
assert_equal "$(redis_cli HLEN "$hash_key")" "$MEMBER_COUNT" 'run Hash field count'
run_ttl="$(redis_cli TTL "$hash_key")"
[[ "$run_ttl" =~ ^[0-9]+$ && "$run_ttl" -ge "$DURATION_SEC" ]] || fail "run Hash TTL is too short: $run_ttl"
observed_bytes="$(redis_cli MEMORY USAGE "$hash_key")"
[[ "$observed_bytes" =~ ^[0-9]+$ ]] || observed_bytes='unavailable'
marker_payload="$(redis_cli GET "$MARKER_KEY")"
jq -e --arg run "$RUN_ID" --arg hash "$hash_key" \
  '.runId == $run and .hashKey == $hash and .fencingToken > 0' <<<"$marker_payload" >/dev/null \
  || fail 'active marker does not point to the created run'
assert_equal "$(redis_cli GET "$MARKER_OWNER_KEY")" "$RUN_ID" 'active marker owner'
marker_fence="$(redis_cli GET "$MARKER_FENCE_KEY")"
[[ "$marker_fence" =~ ^[1-9][0-9]*$ ]] || fail 'active marker fence is invalid'

for sku in $(jq -r '.memberSkus[]' <<<"$summary"); do
  raw_bytes="$(redis_cli --raw HGET "$hash_key" "$sku" | wc -c | sed 's/[[:space:]]//g')"
  [[ "$raw_bytes" =~ ^[0-9]+$ && "$raw_bytes" -gt 0 ]] || fail "missing Hash value for $sku"
  assert_equal "$((raw_bytes - 1))" "$MEMBER_SIZE_BYTES" "logical bytes for $sku"
done

assert_equal "$(redis_cli HEXISTS "$hash_key" "$probe_sku")" "0" 'probe is absent before first read'
member_body="$COOKIE_JAR/member.json"
member_headers="$COOKIE_JAR/member.headers"
member_status="$(request GET "${GATEWAY_URL}/api/products/${member_sku}" "$member_body" "$member_headers")"
assert_equal "$member_status" "200" 'injected member detail HTTP status'
assert_equal "$(cache_result_header "$member_headers")" "CACHE_HIT" 'injected member cache result'
jq -e --arg sku "$member_sku" '.data.sku == $sku and (.data | has("padding") | not)' "$member_body" >/dev/null \
  || fail 'injected member response is not the public ProductDTO shape'

probe_first_body="$COOKIE_JAR/probe-first.json"
probe_first_headers="$COOKIE_JAR/probe-first.headers"
probe_first_status="$(request GET "${GATEWAY_URL}/api/products/${probe_sku}" "$probe_first_body" "$probe_first_headers")"
assert_equal "$probe_first_status" "200" 'probe first detail HTTP status'
assert_equal "$(cache_result_header "$probe_first_headers")" "CACHE_MISS_DB_FALLBACK" 'probe first cache result'
jq -e --arg sku "$probe_sku" '.data.sku == $sku' "$probe_first_body" >/dev/null \
  || fail 'probe first response returned the wrong SKU'
assert_equal "$(redis_cli HEXISTS "$hash_key" "$probe_sku")" "1" 'probe field after fallback'

probe_second_body="$COOKIE_JAR/probe-second.json"
probe_second_headers="$COOKIE_JAR/probe-second.headers"
probe_second_status="$(request GET "${GATEWAY_URL}/api/products/${probe_sku}" "$probe_second_body" "$probe_second_headers")"
assert_equal "$probe_second_status" "200" 'probe second detail HTTP status'
assert_equal "$(cache_result_header "$probe_second_headers")" "CACHE_HIT" 'probe second cache result'

stop_key="catalog-smoke-stop-${RUN_ID}-$(date +%s)"
stop_body="$COOKIE_JAR/stop.json"
stop_status="$(request POST "${CONTROL_PLANE_URL}/internal/fault-runs/${RUN_ID}/stop" "$stop_body" "$COOKIE_JAR/stop.headers" \
  -b "$COOKIE_JAR/cookies.txt" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "X-Idempotency-Key: $stop_key" -H 'Content-Type: application/json' \
  --data '{"confirmed":true}')"
assert_equal "$stop_status" "200" 'Fault Run stop HTTP status'
json_code_must_be_zero "$stop_body"
assert_equal "$(jq -r '.data.state' "$stop_body")" "STOPPED" 'Fault Run state after stop'
assert_equal "$(redis_cli EXISTS "$MARKER_KEY" "$MARKER_OWNER_KEY" "$MARKER_FENCE_KEY")" "0" 'active marker keys after stop'

cleanup_key="catalog-smoke-cleanup-${RUN_ID}-$(date +%s)"
cleanup_body="$COOKIE_JAR/cleanup.json"
cleanup_status="$(request POST "${CONTROL_PLANE_URL}/internal/fault-runs/${RUN_ID}/cleanup" "$cleanup_body" "$COOKIE_JAR/cleanup.headers" \
  -b "$COOKIE_JAR/cookies.txt" -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "X-Idempotency-Key: $cleanup_key" -H 'Content-Type: application/json' \
  --data '{"confirmed":true}')"
assert_equal "$cleanup_status" "200" 'Fault Run cleanup HTTP status'
json_code_must_be_zero "$cleanup_body"
assert_equal "$(redis_cli EXISTS "$hash_key")" "0" 'run Hash after cleanup'

assert_equal "$(redis_cli EXISTS "$DEFAULT_HASH")" "$before_default_exists" 'default Hash existence after cleanup'
assert_equal "$(redis_cli TYPE "$DEFAULT_HASH")" "$before_default_type" 'default Hash type after cleanup'
assert_equal "$(redis_cli HLEN "$DEFAULT_HASH")" "$before_default_fields" 'default Hash field count after cleanup'
assert_equal "$(mysql_scalar 'SELECT COUNT(*) FROM products;')" "$before_products" 'products row count after cleanup'
assert_equal "$(mysql_scalar 'SELECT COUNT(*) FROM inventories;')" "$before_inventories" 'inventories row count after cleanup'
assert_equal "$(mysql_scalar 'SELECT COUNT(*) FROM carts;')" "$before_carts" 'carts row count after cleanup'
assert_equal "$(mysql_scalar 'SELECT COUNT(*) FROM orders;')" "$before_orders" 'orders row count after cleanup'
RUN_ID=""
printf 'catalog-product-detail-smoke: passed (run=%s, fields=%s, logical_bytes=%s, observed_bytes=%s)\n' \
  "$(jq -r '.data.faultRunId' "$create_body")" "$MEMBER_COUNT" "$((MEMBER_COUNT * MEMBER_SIZE_BYTES))" "$observed_bytes"
