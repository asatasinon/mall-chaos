#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose-common.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/compose-down.sh [--image-source|-s <dockerhub|hub|internal>] [--hub <dockerhub|hub|internal>] [-- <docker compose down args>]

Examples:
  ./scripts/compose-down.sh
  ./scripts/compose-down.sh -s hub
  ./scripts/compose-down.sh -- --volumes

Notes:
  - Default image source is internal.
  - Image source is accepted for a symmetric CLI, though docker compose down itself does not pull images.
EOF
}

castrel_parse_compose_args "$@"
if [[ "$CASTREL_SHOW_HELP" == "true" ]]; then
  usage
  exit 0
fi

castrel_apply_image_source

cd "$CASTREL_REPO_ROOT"

echo "==> Image source: ${CASTREL_IMAGE_SOURCE}"
echo "==> Stopping and removing services"
docker compose down "${CASTREL_COMPOSE_ARGS[@]}"