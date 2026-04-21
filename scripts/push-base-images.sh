#!/usr/bin/env bash
set -euo pipefail

TARGET_REGISTRY="${TARGET_REGISTRY:-}"
SOURCE_REGISTRY="${SOURCE_REGISTRY:-docker.io}"

if [[ -z "$TARGET_REGISTRY" ]]; then
  echo "Usage: TARGET_REGISTRY=<harbor-host/project> $0"
  echo "Example: TARGET_REGISTRY=harbor.internal.example.com/base-images $0"
  exit 1
fi

IMAGES=(
  alpine:3.20
  eclipse-temurin:21-jre-alpine
  node:22-alpine
)

for image in "${IMAGES[@]}"; do
  source_image="${SOURCE_REGISTRY}/${image}"
  target_image="${TARGET_REGISTRY}/${image}"

  echo "=== Syncing ${source_image} -> ${target_image} ==="
  docker pull "${source_image}"
  docker tag "${source_image}" "${target_image}"
  docker push "${target_image}"
done

echo ""
echo "Done. Use BASE_IMAGE_REGISTRY=${TARGET_REGISTRY}/ when running docker build or ./scripts/build-all.sh."