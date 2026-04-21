#!/bin/sh
# push-infra-images.sh
# Run this on the EXTERNAL machine that has internet access.
# Pulls (if needed), re-tags, and pushes all third-party infra images to Harbor.
#
# Usage:
#   ./scripts/push-infra-images.sh
#   HARBOR_REGISTRY=harbor.example.com/myproject ./scripts/push-infra-images.sh

set -eu

HARBOR_REGISTRY="${HARBOR_REGISTRY:-harbor.cloudwise.com/noname}"

IMAGES=$(cat <<'EOF'
mysql:8.0|mysql:8.0
redis:7.2-alpine|redis:7.2-alpine
nginx:alpine|nginx:alpine
prom/prometheus:v3.11.2|prometheus:v3.11.2
prom/node-exporter:v1.9.1|node-exporter:v1.9.1
prom/mysqld-exporter:v0.15.1|mysqld-exporter:v0.15.1
grafana/loki:3.6.10|loki:3.6.10
grafana/promtail:3.6.10|promtail:3.6.10
grafana/tempo:2.10.4|tempo:2.10.4
grafana/grafana:12.4.3|grafana:12.4.3
ghcr.io/shopify/toxiproxy:latest|toxiproxy:latest
EOF
)

echo "==> Target registry: ${HARBOR_REGISTRY}"
echo ""

printf '%s\n' "$IMAGES" | while IFS='|' read -r SRC DST; do
  FULL_DST="${HARBOR_REGISTRY}/${DST}"

  echo "---- ${SRC}"
  echo "     pull  ..."
  docker pull "${SRC}"

  echo "     tag   -> ${FULL_DST}"
  docker tag "${SRC}" "${FULL_DST}"

  echo "     push  -> ${FULL_DST}"
  docker push "${FULL_DST}"

  echo ""
done

echo "==> All images pushed to ${HARBOR_REGISTRY}"
echo ""
echo "Pushed images:"
printf '%s\n' "$IMAGES" | while IFS='|' read -r SRC DST; do
  echo "  ${HARBOR_REGISTRY}/${DST}"
done
