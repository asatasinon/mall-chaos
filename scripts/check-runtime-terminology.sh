#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATTERN='故障注入|故障演练|故障场景|场景码|fault[ -]?injection|fault[ -]?exercise|fault[ -]?scenario|chaos[ -]?scenario|fault[ -]?run|faultRunId|BROWSE_REPORT_SQL|ORDER_REPORT_SQL|BROWSE_SURGE|ORDER_QUERY_SURGE|CATALOG_REDIS_LARGE_VALUE|CART_CATALOG_DEPENDENCY|NOTIFICATION_HEAP_PRESSURE|NOTIFICATION_STORAGE_APPEND|PROMOTION_LOCK_CONTENTION|INVENTORY_TABLE_EXCLUSIVE|INVENTORY_ROW_LOCK|PSP_PROVIDER_OUTCOME'

fail() {
  printf 'check-runtime-terminology: %s\n' "$1" >&2
  exit 1
}

command -v rg >/dev/null 2>&1 || fail 'required command not found: rg'

cd "$REPO_ROOT"
if matches="$(rg -n -i --glob '!**/target/**' --glob '!traffic-control-plane/**' --glob '**/src/**' "$PATTERN" .)"; then
  printf '%s\n' "$matches" >&2
  fail 'control-plane terminology leaked into runtime source'
else
  scan_exit=$?
fi

if [[ "$scan_exit" -ne 1 ]]; then
  fail "rg failed with exit code $scan_exit"
fi

printf 'check-runtime-terminology: passed\n'