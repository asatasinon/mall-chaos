#!/bin/bash
# Inject latency into a ToxiProxy proxy.
# Usage: network-delay.sh [proxy] [latencyMs] [jitterMs] [durationSec]
#   proxy      : ToxiProxy proxy name (default: order-to-payment)
#   latencyMs  : one-way latency in ms (default: 3000)
#   jitterMs   : jitter in ms (default: 500)
#   durationSec: auto-remove after N seconds; 0 = keep until manual removal (default: 120)

set -euo pipefail

TOXIPROXY_API="${TOXIPROXY_API:-http://localhost:18474}"
PROXY="${1:-order-to-payment}"
LATENCY="${2:-3000}"
JITTER="${3:-500}"
DURATION="${4:-120}"
TOXIC_NAME="chaos-delay"

echo "[chaos] Injecting ${LATENCY}ms latency (±${JITTER}ms) into proxy '${PROXY}'..."
curl -sf -X POST "${TOXIPROXY_API}/proxies/${PROXY}/toxics" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${TOXIC_NAME}\",\"type\":\"latency\",\"stream\":\"downstream\",\"attributes\":{\"latency\":${LATENCY},\"jitter\":${JITTER}}}"
echo ""
echo "[chaos] Delay injected into '${PROXY}'."

if [ "${DURATION}" -gt 0 ]; then
  echo "[chaos] Auto-removing in ${DURATION}s..."
  sleep "${DURATION}"
  curl -sf -X DELETE "${TOXIPROXY_API}/proxies/${PROXY}/toxics/${TOXIC_NAME}" || true
  echo "[chaos] Delay removed from '${PROXY}'."
fi
