#!/usr/bin/env bash

CASTREL_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CASTREL_IMAGE_SOURCE="${IMAGE_SOURCE:-internal}"
CASTREL_COMPOSE_ARGS=()
CASTREL_SHOW_HELP=false

castrel_parse_compose_args() {
  CASTREL_COMPOSE_ARGS=()
  CASTREL_SHOW_HELP=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --image-source|--hub)
        [[ $# -lt 2 ]] && { echo "$1 requires a value" >&2; return 1; }
        CASTREL_IMAGE_SOURCE="$2"
        shift 2
        ;;
      -h|--help)
        CASTREL_SHOW_HELP=true
        shift
        ;;
      --)
        shift
        CASTREL_COMPOSE_ARGS+=("$@")
        break
        ;;
      *)
        CASTREL_COMPOSE_ARGS+=("$1")
        shift
        ;;
    esac
  done
}

castrel_apply_image_source() {
  case "$CASTREL_IMAGE_SOURCE" in
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
      echo "Unsupported image source: ${CASTREL_IMAGE_SOURCE}" >&2
      echo "Expected one of: dockerhub, internal" >&2
      return 1
      ;;
  esac
}