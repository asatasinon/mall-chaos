#!/usr/bin/env bash
# chaos-verify.sh — Interactive Chaos verification helper (Task 19)
# Covers 7 mandatory chaos scenarios for Castrel Chaos acceptance.
#
# Usage:
#   ./scripts/chaos/chaos-verify.sh [--gateway <url>] [--scenario <1-7>]
#
# Defaults:
#   GATEWAY_URL = http://localhost:18080   (Docker Compose local)
#   For K8s:    GATEWAY_URL = http://castrel.local
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:18080}"
SCENARIO="${SCENARIO:-}"

# ── Helpers ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

pass()  { echo -e "${GREEN}[PASS]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; }
info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
step()  { echo ""; echo -e "${CYAN}──── $* ────${NC}"; }

check_runner_running() {
  local status
  status=$(curl -sf "$GATEWAY_URL/internal/runner/status" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('running','false'))" 2>/dev/null || echo "false")
  if [[ "$status" == "true" ]]; then
    pass "Runner is running"
  else
    fail "Runner is NOT running — start it first: POST $GATEWAY_URL/internal/runner/start"
    return 1
  fi
}

chaos_post() {
  local url="$1"; shift
  local body="$*"
  curl -sf -X POST "$url" -H 'Content-Type: application/json' -d "$body" | python3 -m json.tool || true
}

# ── Scenario 1: Baseline Stability ───────────────────────────────────────────

scenario_1() {
  step "Scenario 1: Baseline Stability (no chaos injection)"
  info "Expected: success rate > 95%, P95 < 500ms for 30 minutes"
  echo ""
  check_runner_running
  info "Runner status:"
  curl -sf "$GATEWAY_URL/internal/runner/status" | python3 -m json.tool || true
  echo ""
  warn "Manual step: Monitor Grafana for 30 minutes."
  warn "Acceptance: Success rate > 95%, P95 < 500ms, no chaos_event_log entries"
}

# ── Scenario 2: Network Delay order→payment ──────────────────────────────────

scenario_2() {
  step "Scenario 2: order→payment Network Delay (2-5s)"
  check_runner_running
  echo ""
  info "Injecting 3s ± 1s latency on order→payment..."
  bash "$(dirname "$0")/network-delay.sh" order-to-payment 3000 1000 300
  echo ""
  warn "Observe Grafana for 5 minutes:"
  warn "  - payment.charge.timeout.count should rise"
  warn "  - Tempo: payment spans showing 3-5s duration"
  warn "  - order TIMEOUT orders should be FAILED, not PENDING"
  echo ""
  read -rp "Press Enter when ready to remove toxic (after 5 min observation)..."
  bash "$(dirname "$0")/network-remove-toxic.sh" order-to-payment chaos-delay
  echo ""
  warn "Observe recovery for 5 minutes. Acceptance: success rate > 90%"
}

# ── Scenario 3: JVM Memory Leak ──────────────────────────────────────────────

scenario_3() {
  # In K8s, use kubectl port-forward or hit through gateway internal
  step "Scenario 3: order-service JVM Memory Leak"
  check_runner_running
  echo ""
  info "Starting memory leak: chunkSizeKb=1024, intervalMs=300, maxMb=350"
  chaos_post "$GATEWAY_URL/internal/chaos/memory-leak/start" \
    '{"chunkSizeKb":1024,"intervalMs":300,"maxMb":350}'
  echo ""
  warn "Monitor Grafana JVM Heap for 10 minutes."
  warn "  - heap should reach ~350 MB"
  warn "  - GC pause time should increase"
  warn "  - Prometheus alert: JVM Heap > 80%"
  echo ""
  read -rp "Press Enter to stop memory leak (after ~10 min)..."
  chaos_post "$GATEWAY_URL/internal/chaos/memory-leak/stop" '{}'
  echo ""
  info "Clearing held references..."
  chaos_post "$GATEWAY_URL/internal/chaos/memory-leak/clear" '{}'
  echo ""
  warn "Acceptance: Heap drops below 40% after next GC cycle"
}

# ── Scenario 4: Slow SQL ─────────────────────────────────────────────────────

scenario_4() {
  step "Scenario 4: payment-service Slow SQL (sleep + real mode)"
  check_runner_running
  echo ""
  info "Phase 1: sleep mode (delayMs=3000, rate=1.0, duration=180s)"
  chaos_post "$GATEWAY_URL/internal/chaos/slow-sql/enable" \
    '{"mode":"sleep","delayMs":3000,"injectRate":1.0,"durationSec":180}'
  echo ""
  warn "Observe 3 minutes: payment P50 should be > 3s"
  read -rp "Press Enter after 3 min to switch to real mode..."
  chaos_post "$GATEWAY_URL/internal/chaos/slow-sql/disable" '{}'
  echo ""
  info "Phase 2: real mode — SELECT SLEEP(2) inside transaction (rate=0.5, duration=180s)"
  chaos_post "$GATEWAY_URL/internal/chaos/slow-sql/enable" \
    '{"mode":"real","delayMs":2000,"injectRate":0.5,"durationSec":180}'
  echo ""
  warn "Observe 3 minutes."
  warn "  - MySQL slow query log should show: SELECT SLEEP(2)"
  warn "  - durationSec expires → auto-disable → P95 drops"
  warn "  - chaos_event_log has payment/slow-sql entry"
}

# ── Scenario 5: Deadlock ─────────────────────────────────────────────────────

scenario_5() {
  step "Scenario 5: order + payment Deadlock Injection"
  check_runner_running
  echo ""
  info "Injecting deadlock in order-service (rate=0.4, duration=180s)..."
  chaos_post "$GATEWAY_URL/internal/chaos/deadlock/enable" \
    '{"service":"order","injectRate":0.4,"durationSec":180}'
  echo ""
  info "Injecting deadlock in payment-service (rate=0.3, duration=180s)..."
  chaos_post "$GATEWAY_URL/internal/chaos/deadlock/enable" \
    '{"service":"payment","injectRate":0.3,"durationSec":180}'
  echo ""
  warn "Observe 3 minutes:"
  warn "  - chaos.deadlock.count rising for both services"
  warn "  - MySQL error log: 'Deadlock found when trying to get lock'"
  warn "  - chaos.deadlock.retry.count rising (exponential backoff working)"
  warn "  - Orders exceeding retry limit end with ORDER_DEADLOCK_MAX_RETRY error"
  warn "  - Runner success rate lower but > 0"
}

# ── Scenario 6: Inventory Reset ──────────────────────────────────────────────

scenario_6() {
  step "Scenario 6: Inventory Reset Exercise"
  check_runner_running
  echo ""
  info "Step 1: Check current inventory plan..."
  curl -sf "$GATEWAY_URL/internal/runner/inventory-reset/plan" | python3 -m json.tool || true
  echo ""
  info "Step 2: Trigger immediate reset..."
  chaos_post "$GATEWAY_URL/internal/runner/inventory-reset/trigger" '{}'
  echo ""
  warn "Acceptance: plan returns diff < 0 (stock consumed); reset restores baseline"
  echo ""
  info "Step 3: Test optimistic lock conflict..."
  warn "Manually modify baseline_version in DB, then trigger again → should return 409"
  echo ""
  info "Step 4: Update schedule to every 1 minute..."
  chaos_post "$GATEWAY_URL/internal/runner/inventory-reset/schedule" \
    '{"cron":"0/1 * * * *"}'
  echo ""
  warn "Observe next auto-trigger in ~1 minute. Then restore original cron."
}

# ── Scenario 7: Combined Chaos ────────────────────────────────────────────────

scenario_7() {
  step "Scenario 7: Combined Fault Injection (network + slow SQL + deadlock)"
  check_runner_running
  echo ""
  info "Injecting 1: ToxiProxy order→payment 2s delay..."
  bash "$(dirname "$0")/network-delay.sh" order-to-payment 2000 500 300
  echo ""
  info "Injecting 2: order slow SQL (delayMs=1500, rate=0.5, duration=300s)..."
  chaos_post "$GATEWAY_URL/internal/chaos/slow-sql/enable" \
    '{"mode":"sleep","delayMs":1500,"injectRate":0.5,"durationSec":300}'
  echo ""
  info "Injecting 3: order deadlock (rate=0.2, duration=300s)..."
  chaos_post "$GATEWAY_URL/internal/chaos/deadlock/enable" \
    '{"service":"order","injectRate":0.2,"durationSec":300}'
  echo ""
  warn "Observe 5 minutes. Acceptance:"
  warn "  - Success rate > 20% (not fully unavailable)"
  warn "  - Grafana shows all 3 fault signals simultaneously"
  warn "  - Runner has NOT crashed"
  echo ""
  read -rp "Press Enter to remove all chaos..."
  echo ""
  info "Removing deadlock..."
  chaos_post "$GATEWAY_URL/internal/chaos/deadlock/disable" '{"service":"order"}'
  info "Removing slow SQL..."
  chaos_post "$GATEWAY_URL/internal/chaos/slow-sql/disable" '{}'
  info "Removing network toxic..."
  bash "$(dirname "$0")/network-remove-toxic.sh" order-to-payment chaos-delay
  echo ""
  warn "Observe recovery for 5 minutes. Acceptance: success rate > 90% within 5 min"
  warn "chaos_event_log should show complete event timeline"
}

# ── Global Checks ─────────────────────────────────────────────────────────────

global_checks() {
  step "Global Acceptance Checklist"
  echo ""
  info "Runner status:"
  curl -sf "$GATEWAY_URL/internal/runner/status" | python3 -m json.tool || true
  echo ""
  info "Chaos event log (last 10 entries):"
  curl -sf "$GATEWAY_URL/internal/chaos/events?limit=10" | python3 -m json.tool || true
  echo ""
  echo "Manual checklist:"
  echo "  [ ] All Chaos enables support scope + injectRate + durationSec"
  echo "  [ ] durationSec auto-disables all chaos on schedule"
  echo "  [ ] Chaos endpoints return 404 on non-chaos profile"
  echo "  [ ] Grafana: Services Overview dashboard complete"
  echo "  [ ] Grafana: Chaos Events dashboard complete"
  echo "  [ ] Tempo: full trace visible for each scenario"
  echo "  [ ] Runner survived all 7 scenarios without crashing"
}

# ── Entry Point ───────────────────────────────────────────────────────────────

print_usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --gateway <url>      Gateway base URL (default: http://localhost:18080)"
  echo "  --scenario <1-7>     Run a specific scenario (default: interactive menu)"
  echo "  --global             Run global acceptance checklist only"
  echo ""
  echo "Scenarios:"
  echo "  1 - Baseline stability (30 min, no chaos)"
  echo "  2 - order→payment network delay 2-5s"
  echo "  3 - order-service JVM memory leak"
  echo "  4 - payment-service slow SQL (sleep + real)"
  echo "  5 - order + payment deadlock injection"
  echo "  6 - inventory reset exercise"
  echo "  7 - Combined fault injection"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gateway)   GATEWAY_URL="$2"; shift 2 ;;
    --scenario)  SCENARIO="$2"; shift 2 ;;
    --global)    global_checks; exit 0 ;;
    --help|-h)   print_usage; exit 0 ;;
    *) echo "Unknown option: $1"; print_usage; exit 1 ;;
  esac
done

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║   Castrel Chaos — Verification Runner (Task 19)   ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "  Gateway: $GATEWAY_URL"
echo ""

if [[ -n "$SCENARIO" ]]; then
  "scenario_${SCENARIO}"
  exit 0
fi

# Interactive menu
echo "Select scenario to run:"
echo "  1) Baseline Stability"
echo "  2) Network Delay (order→payment)"
echo "  3) JVM Memory Leak (order-service)"
echo "  4) Slow SQL (payment-service)"
echo "  5) Deadlock Injection (order + payment)"
echo "  6) Inventory Reset Exercise"
echo "  7) Combined Fault Injection"
echo "  g) Global Acceptance Checklist"
echo "  q) Quit"
echo ""
read -rp "Enter choice: " CHOICE

case "$CHOICE" in
  1) scenario_1 ;;
  2) scenario_2 ;;
  3) scenario_3 ;;
  4) scenario_4 ;;
  5) scenario_5 ;;
  6) scenario_6 ;;
  7) scenario_7 ;;
  g) global_checks ;;
  q) echo "Exiting."; exit 0 ;;
  *) echo "Invalid choice: $CHOICE"; exit 1 ;;
esac

echo ""
info "Scenario complete. Check Grafana for metrics and Tempo for traces."
