#!/bin/bash
# Show all ToxiProxy proxy statuses and active toxics.
# Usage: toxiproxy-status.sh

set -euo pipefail

TOXIPROXY_API="${TOXIPROXY_API:-http://localhost:18474}"
PROXIES=("order-to-payment" "order-to-inventory" "gateway-to-order")

echo "=== ToxiProxy Status (${TOXIPROXY_API}) ==="
for proxy in "${PROXIES[@]}"; do
  info=$(curl -sf "${TOXIPROXY_API}/proxies/${proxy}" 2>/dev/null || echo "NOT FOUND")
  toxics=$(curl -sf "${TOXIPROXY_API}/proxies/${proxy}/toxics" 2>/dev/null || echo "[]")
  echo ""
  echo "Proxy: ${proxy}"
  echo "  Info:   ${info}"
  echo "  Toxics: ${toxics}"
done
echo ""
