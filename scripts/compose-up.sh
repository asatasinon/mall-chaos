#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_SOURCE="${IMAGE_SOURCE:-internal}"
COMPOSE_ARGS=()

usage() {
  cat <<'EOF'
Usage: ./scripts/compose-up.sh [--image-source dockerhub|internal] [-- <docker compose up args>]

Examples:
  ./scripts/compose-up.sh
  ./scripts/compose-up.sh --image-source dockerhub
  ./scripts/compose-up.sh --image-source dockerhub -- --force-recreate

Notes:
  - Default image source is internal.
  - The script runs 'docker compose pull' first, then 'docker compose up --no-build'.
  - You can still override individual image variables such as REGISTRY or MYSQL_IMAGE.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-source)
      [[ $# -lt 2 ]] && { echo "--image-source requires a value" >&2; exit 1; }
      IMAGE_SOURCE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      COMPOSE_ARGS+=("$@")
      break
      ;;
    *)
      COMPOSE_ARGS+=("$1")
      shift
      ;;
  esac
done

case "$IMAGE_SOURCE" in
  dockerhub)
    export REGISTRY="${REGISTRY:-castrel}"
    export MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.0}"
    export REDIS_IMAGE="${REDIS_IMAGE:-redis:7.2-alpine}"
    export PROMETHEUS_IMAGE="${PROMETHEUS_IMAGE:-prom/prometheus:v3.11.2}"
    export LOKI_IMAGE="${LOKI_IMAGE:-grafana/loki:3.6.10}"
    export TEMPO_IMAGE="${TEMPO_IMAGE:-grafana/tempo:2.10.4}"
    export GRAFANA_IMAGE="${GRAFANA_IMAGE:-grafana/grafana:12.4.3}"
    export NGINX_IMAGE="${NGINX_IMAGE:-nginx:alpine}"
    export NODE_EXPORTER_IMAGE="${NODE_EXPORTER_IMAGE:-prom/node-exporter:v1.9.1}"
    export MYSQLD_EXPORTER_IMAGE="${MYSQLD_EXPORTER_IMAGE:-prom/mysqld-exporter:v0.15.1}"
    export PROMTAIL_IMAGE="${PROMTAIL_IMAGE:-grafana/promtail:3.6.10}"
    export TOXIPROXY_IMAGE="${TOXIPROXY_IMAGE:-ghcr.io/shopify/toxiproxy:latest}"
    ;;
  internal)
    export REGISTRY="${REGISTRY:-harbor.cloudwise.com/noname}"
    export MYSQL_IMAGE="${MYSQL_IMAGE:-harbor.cloudwise.com/noname/mysql:8.0}"
    export REDIS_IMAGE="${REDIS_IMAGE:-harbor.cloudwise.com/noname/redis:7.2-alpine}"
    export PROMETHEUS_IMAGE="${PROMETHEUS_IMAGE:-harbor.cloudwise.com/noname/prometheus:v3.11.2}"
    export LOKI_IMAGE="${LOKI_IMAGE:-harbor.cloudwise.com/noname/loki:3.6.10}"
    export TEMPO_IMAGE="${TEMPO_IMAGE:-harbor.cloudwise.com/noname/tempo:2.10.4}"
    export GRAFANA_IMAGE="${GRAFANA_IMAGE:-harbor.cloudwise.com/noname/grafana:12.4.3}"
    export NGINX_IMAGE="${NGINX_IMAGE:-harbor.cloudwise.com/noname/nginx:alpine}"
    export NODE_EXPORTER_IMAGE="${NODE_EXPORTER_IMAGE:-harbor.cloudwise.com/noname/node-exporter:v1.9.1}"
    export MYSQLD_EXPORTER_IMAGE="${MYSQLD_EXPORTER_IMAGE:-harbor.cloudwise.com/noname/mysqld-exporter:v0.15.1}"
    export PROMTAIL_IMAGE="${PROMTAIL_IMAGE:-harbor.cloudwise.com/noname/promtail:3.6.10}"
    export TOXIPROXY_IMAGE="${TOXIPROXY_IMAGE:-harbor.cloudwise.com/noname/toxiproxy:latest}"
    ;;
  *)
    echo "Unsupported image source: ${IMAGE_SOURCE}" >&2
    echo "Expected one of: dockerhub, internal" >&2
    exit 1
    ;;
esac

if [[ ${#COMPOSE_ARGS[@]} -eq 0 ]]; then
  COMPOSE_ARGS=(-d)
fi

cd "$REPO_ROOT"

echo "==> Image source: ${IMAGE_SOURCE}"
echo "==> Business registry: ${REGISTRY}"
echo "==> Pulling images from configured registry"
docker compose pull

echo "==> Starting services"
docker compose up --no-build "${COMPOSE_ARGS[@]}"