#!/bin/sh
# push-base-images.sh
# Run this on the EXTERNAL machine that has internet access.
# Pulls (if needed), re-tags, and pushes shared base images to Harbor.
#
# Usage:
#   ./scripts/push-base-images.sh
#   HARBOR_REGISTRY=harbor.example.com/base-images ./scripts/push-base-images.sh
#   TARGET_REGISTRY=harbor.example.com/base-images ./scripts/push-base-images.sh
#   SOURCE_REGISTRY=docker.io HARBOR_REGISTRY=harbor.example.com/base-images ./scripts/push-base-images.sh

set -eu

HARBOR_REGISTRY="${HARBOR_REGISTRY:-${TARGET_REGISTRY:-harbor.cloudwise.com/noname}}"
SOURCE_REGISTRY="${SOURCE_REGISTRY:-docker.io}"

IMAGES=$(cat <<EOF
${SOURCE_REGISTRY}/alpine:3.20|alpine:3.20
${SOURCE_REGISTRY}/eclipse-temurin:21-jdk-alpine|eclipse-temurin:21-jdk-alpine
${SOURCE_REGISTRY}/node:22-alpine|node:22-alpine
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

echo "==> All base images pushed to ${HARBOR_REGISTRY}"
echo ""
echo "Pushed images:"
printf '%s\n' "$IMAGES" | while IFS='|' read -r SRC DST; do
  echo "  ${HARBOR_REGISTRY}/${DST}"
done
echo ""
echo "Use BASE_IMAGE_REGISTRY=${HARBOR_REGISTRY}/ when running docker build or ./scripts/build-all.sh."