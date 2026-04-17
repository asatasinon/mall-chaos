#!/bin/bash
# Remove a named toxic from a ToxiProxy proxy.
# Usage: network-remove-toxic.sh [proxy] [toxicName]
#   proxy     : ToxiProxy proxy name (default: order-to-payment)
#   toxicName : toxic name to remove (default: chaos-delay)

set -euo pipefail

TOXIPROXY_API="${TOXIPROXY_API:-http://localhost:18474}"
PROXY="${1:-order-to-payment}"
TOXIC="${2:-chaos-delay}"

echo "[chaos] Removing toxic '${TOXIC}' from proxy '${PROXY}'..."
curl -sf -X DELETE "${TOXIPROXY_API}/proxies/${PROXY}/toxics/${TOXIC}"
echo ""
echo "[chaos] Done."
