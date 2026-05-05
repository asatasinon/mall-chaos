#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose-common.sh"

REPO_SW_OVERRIDE="infra/skywalking/skywalking.override.yml"
MYSQL_CONNECTOR_VERSION="${MYSQL_CONNECTOR_VERSION:-8.0.33}"
MYSQL_CONNECTOR_JAR="mysql-connector-j-${MYSQL_CONNECTOR_VERSION}.jar"
MYSQL_CONNECTOR_REL_PATH="infra/skywalking/ext-libs/${MYSQL_CONNECTOR_JAR}"
MYSQL_CONNECTOR_URL="${MYSQL_CONNECTOR_URL:-https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/${MYSQL_CONNECTOR_VERSION}/${MYSQL_CONNECTOR_JAR}}"

ensure_mysql_connector_jar() {
  if [[ -f "$MYSQL_CONNECTOR_REL_PATH" ]]; then
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download ${MYSQL_CONNECTOR_JAR}" >&2
    return 1
  fi

  echo "==> MySQL JDBC driver missing, downloading: ${MYSQL_CONNECTOR_JAR}"
  mkdir -p "$(dirname "$MYSQL_CONNECTOR_REL_PATH")"
  curl -fL --retry 3 -o "$MYSQL_CONNECTOR_REL_PATH" "$MYSQL_CONNECTOR_URL"
}

usage() {
  cat <<'EOF'
Usage: ./scripts/compose-up.sh [--image-source dockerhub|internal] [--hub dockerhub|internal] [-- <docker compose up args>]

Examples:
  ./scripts/compose-up.sh
  ./scripts/compose-up.sh --image-source dockerhub
  ./scripts/compose-up.sh --hub internal
  ./scripts/compose-up.sh --image-source dockerhub -- --force-recreate

Notes:
  - Default image source is internal.
  - The script runs 'docker compose pull' first, then 'docker compose up --no-build'.
  - If a SkyWalking override file exists, it is auto-included:
      1) CASTREL_SKYWALKING_OVERRIDE_FILE (if set)
      2) ./infra/skywalking/skywalking.override.yml
      3) $HOME/skywalking.override.yml
  - When using ./infra/skywalking/skywalking.override.yml, the script auto-downloads
    mysql-connector-j-${MYSQL_CONNECTOR_VERSION}.jar if missing.
  - You can still override individual image variables such as REGISTRY or MYSQL_IMAGE.
EOF
}

castrel_parse_compose_args "$@"
if [[ "$CASTREL_SHOW_HELP" == "true" ]]; then
  usage
  exit 0
fi

castrel_apply_image_source

if [[ ${#CASTREL_COMPOSE_ARGS[@]} -eq 0 ]]; then
  CASTREL_COMPOSE_ARGS=(-d)
fi

cd "$CASTREL_REPO_ROOT"

COMPOSE_FILE_ARGS=(-f docker-compose.yml)
OVERRIDE_FILE=""

if [[ -n "${CASTREL_SKYWALKING_OVERRIDE_FILE:-}" ]]; then
  OVERRIDE_FILE="$CASTREL_SKYWALKING_OVERRIDE_FILE"
elif [[ -f "infra/skywalking/skywalking.override.yml" ]]; then
  OVERRIDE_FILE="infra/skywalking/skywalking.override.yml"
elif [[ -f "$HOME/skywalking.override.yml" ]]; then
  OVERRIDE_FILE="$HOME/skywalking.override.yml"
fi

if [[ -n "$OVERRIDE_FILE" ]]; then
  COMPOSE_FILE_ARGS+=(-f "$OVERRIDE_FILE")
fi

if [[ "$OVERRIDE_FILE" == "$REPO_SW_OVERRIDE" || "$OVERRIDE_FILE" == "$CASTREL_REPO_ROOT/$REPO_SW_OVERRIDE" ]]; then
  ensure_mysql_connector_jar
fi

echo "==> Image source: ${CASTREL_IMAGE_SOURCE}"
echo "==> Business registry: ${REGISTRY}"
if [[ -n "$OVERRIDE_FILE" ]]; then
  echo "==> Auto-include override: ${OVERRIDE_FILE}"
else
  echo "==> SkyWalking override not found, using base compose only"
fi
echo "==> Pulling images from configured registry"
docker compose "${COMPOSE_FILE_ARGS[@]}" pull

echo "==> Starting services"
docker compose "${COMPOSE_FILE_ARGS[@]}" up --no-build "${CASTREL_COMPOSE_ARGS[@]}"