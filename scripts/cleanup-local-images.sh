#!/usr/bin/env bash
# Remove old local Castrel business-image tags while keeping one selected tag.
# Usage: ./scripts/cleanup-local-images.sh [--keep-tag <tag>] [--dry-run] [--yes]
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose-common.sh"

KEEP_TAG="${IMAGE_TAG:-latest}"
DRY_RUN=false
ASSUME_YES=false

SERVICES=(
  gateway-service
  user-service
  cart-service
  catalog-service
  inventory-service
  order-service
  payment-service
  promotion-service
  risk-service
  fulfillment-service
  notification-service
  traffic-control-plane
  shopfront
)

usage() {
  cat <<'EOF'
Usage: ./scripts/cleanup-local-images.sh [options]

Remove local Castrel business-image tags except the selected tag.

Options:
  --keep-tag <tag>  Keep this tag for every business image (default: IMAGE_TAG or latest)
  --tag <tag>       Alias for --keep-tag
  --dry-run         List images that would be removed without deleting them
  --yes             Skip the confirmation prompt
  --image-source <source>
                    Use dockerhub or internal registry defaults
  -h, --help        Show this help

Examples:
  ./scripts/cleanup-local-images.sh
  ./scripts/cleanup-local-images.sh --keep-tag v1.0.0 --dry-run
  REGISTRY=harbor.example.com/castrel ./scripts/cleanup-local-images.sh --yes

Notes:
  - The registry defaults to the configured IMAGE_SOURCE/REGISTRY settings.
  - Only business images produced by build-all.sh are considered.
  - Infrastructure images and dangling images are not removed.
  - Docker refuses to remove an image still used by a container unless force removal is used;
    this script intentionally does not force removal.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-tag|--tag)
      [[ $# -lt 2 ]] && { echo "$1 requires a value" >&2; exit 1; }
      KEEP_TAG="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --yes)
      ASSUME_YES=true
      shift
      ;;
    --image-source|--hub)
      [[ $# -lt 2 ]] && { echo "$1 requires a value" >&2; exit 1; }
      CASTREL_IMAGE_SOURCE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$KEEP_TAG" ]]; then
  echo "Keep tag must not be empty" >&2
  exit 1
fi

castrel_apply_image_source

OLD_IMAGE_REFS=()
for service in "${SERVICES[@]}"; do
  repository="${REGISTRY}/${service}"
  keep_ref="${repository}:${KEEP_TAG}"

  while IFS= read -r image_ref; do
    [[ -z "$image_ref" || "$image_ref" == "$keep_ref" ]] && continue
    OLD_IMAGE_REFS+=("$image_ref")
  done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=${repository}:*")
done

echo "==> Business registry: ${REGISTRY}"
echo "==> Keeping tag: ${KEEP_TAG}"

if [[ ${#OLD_IMAGE_REFS[@]} -eq 0 ]]; then
  echo "==> No old local business-image tags found"
  exit 0
fi

echo "==> Images selected for removal:"
printf '  %s\n' "${OLD_IMAGE_REFS[@]}"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "==> Dry run; no images were removed"
  exit 0
fi

if [[ "$ASSUME_YES" != "true" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Confirmation is required when stdin is not interactive; rerun with --yes" >&2
    exit 1
  fi

  printf 'Remove these images? [y/N] '
  read -r confirmation
  case "$confirmation" in
    y|Y|yes|YES)
      ;;
    *)
      echo "==> Cancelled"
      exit 0
      ;;
  esac
fi

removed_count=0
failed_count=0
for image_ref in "${OLD_IMAGE_REFS[@]}"; do
  if docker image rm "$image_ref"; then
    removed_count=$((removed_count + 1))
  else
    failed_count=$((failed_count + 1))
    echo "Failed to remove ${image_ref}; it may be used by a container." >&2
  fi
done

echo "==> Removed ${removed_count} image tag(s)"
if [[ "$failed_count" -gt 0 ]]; then
  echo "==> Failed to remove ${failed_count} image tag(s)" >&2
  exit 1
fi