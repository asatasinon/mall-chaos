#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose-common.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/compose-restart.sh [--image-source|-s <dockerhub|hub|internal>] [--hub <dockerhub|hub|internal>] [-- <docker compose up args>]

Examples:
  ./scripts/compose-restart.sh
  ./scripts/compose-restart.sh -s hub
  ./scripts/compose-restart.sh -- --force-recreate

Notes:
  - Default image source is internal.
  - The script runs 'docker compose down', then 'docker compose pull', then 'docker compose up --no-build'.
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

echo "==> Image source: ${CASTREL_IMAGE_SOURCE}"
echo "==> Stopping existing services"
docker compose down

echo "==> Pulling images from configured registry"
docker compose pull

echo "==> Starting services"
docker compose up --no-build "${CASTREL_COMPOSE_ARGS[@]}"