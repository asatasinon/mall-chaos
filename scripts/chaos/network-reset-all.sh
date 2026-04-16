#!/bin/bash
# Remove ALL toxics from every known proxy.
# Usage: network-reset-all.sh

set -euo pipefail

TOXIPROXY_API="${TOXIPROXY_API:-http://localhost:8474}"
PROXIES=("order-to-payment" "order-to-inventory" "gateway-to-order")

echo "[chaos] Resetting all toxics..."
for proxy in "${PROXIES[@]}"; do
  # List current toxics for this proxy
  toxics=$(curl -sf "${TOXIPROXY_API}/proxies/${proxy}/toxics" 2>/dev/null || echo "[]")
  names=$(echo "${toxics}" | grep -o '"name":"[^"]*"' | awk -F'"' '{print $4}' || true)
  if [ -z "${names}" ]; then
    echo "  [${proxy}] no toxics."
  else
    for name in ${names}; do
      curl -sf -X DELETE "${TOXIPROXY_API}/proxies/${proxy}/toxics/${name}" || true
      echo "  [${proxy}] removed toxic '${name}'."
    done
  fi
done
echo "[chaos] All toxics cleared."
