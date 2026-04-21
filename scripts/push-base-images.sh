#!/usr/bin/env bash
# push-base-images.sh
# Run this on the EXTERNAL machine that has internet access.
# Pulls (if needed), re-tags, and pushes shared base images to Harbor.
#
# Usage:
#   HARBOR_REGISTRY=harbor.example.com/base-images ./scripts/push-base-images.sh
#   TARGET_REGISTRY=harbor.example.com/base-images ./scripts/push-base-images.sh
#   SOURCE_REGISTRY=docker.io HARBOR_REGISTRY=harbor.example.com/base-images ./scripts/push-base-images.sh

set -euo pipefail

HARBOR_REGISTRY="${HARBOR_REGISTRY:-${TARGET_REGISTRY:-}}"
SOURCE_REGISTRY="${SOURCE_REGISTRY:-docker.io}"

if [[ -z "${HARBOR_REGISTRY}" ]]; then
  echo "Usage: HARBOR_REGISTRY=<harbor-host/project> $0"
  echo "   or: TARGET_REGISTRY=<harbor-host/project> $0"
  echo "Example: HARBOR_REGISTRY=harbor.internal.example.com/base-images $0"
  exit 1
fi

# Map: <source image>  <harbor image name:tag>
declare -a IMAGES=(
  "${SOURCE_REGISTRY}/alpine:3.20                      alpine:3.20"
  "${SOURCE_REGISTRY}/eclipse-temurin:21-jre-alpine   eclipse-temurin:21-jre-alpine"
  "${SOURCE_REGISTRY}/node:22-alpine                  node:22-alpine"
)

echo "==> Target registry: ${HARBOR_REGISTRY}"
echo ""

for entry in "${IMAGES[@]}"; do
  SRC=$(echo "$entry" | awk '{print $1}')
  DST=$(echo "$entry" | awk '{print $2}')
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

echo "==> All base images pushed to ${HARBOR_REGISTRY}"
echo ""
echo "Pushed images:"
for entry in "${IMAGES[@]}"; do
  DST=$(echo "$entry" | awk '{print $2}')
  echo "  ${HARBOR_REGISTRY}/${DST}"
done
echo ""
echo "Use BASE_IMAGE_REGISTRY=${HARBOR_REGISTRY}/ when running docker build or ./scripts/build-all.sh."