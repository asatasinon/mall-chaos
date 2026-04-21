#!/usr/bin/env bash
# build-all.sh — Build all service JARs and Docker images
# Usage: ./scripts/build-all.sh [--push] [--tag <tag>]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="${REGISTRY:-harbor.cloudwise.com/noname}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
BASE_IMAGE_REGISTRY="${BASE_IMAGE_REGISTRY:-}"
PUSH_IMAGE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH_IMAGE=true; shift ;;
    --tag)  IMAGE_TAG="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SERVICES=(
  gateway-service
  user-service
  catalog-service
  inventory-service
  order-service
  payment-service
  promotion-service
  risk-service
  fulfillment-service
  notification-service
)

echo "=== Building common module ==="
cd "$REPO_ROOT"
mvn clean install -pl common -DskipTests -q

DOCKER_BUILD_ARGS=()
if [[ -n "$BASE_IMAGE_REGISTRY" ]]; then
  DOCKER_BUILD_ARGS+=(--build-arg "BASE_IMAGE_REGISTRY=${BASE_IMAGE_REGISTRY}")
fi

echo ""
echo "=== Building & packaging services ==="
for svc in "${SERVICES[@]}"; do
  echo "--- [$svc] Maven package ---"
  mvn package -pl "$svc" -DskipTests -q

  echo "--- [$svc] Docker build (tag: ${REGISTRY}/${svc}:${IMAGE_TAG}) ---"
  docker build "${DOCKER_BUILD_ARGS[@]}" -t "${REGISTRY}/${svc}:${IMAGE_TAG}" -f "$REPO_ROOT/$svc/Dockerfile" "$REPO_ROOT"

  if [[ "$PUSH_IMAGE" == "true" ]]; then
    echo "--- [$svc] Docker push ---"
    docker push "${REGISTRY}/${svc}:${IMAGE_TAG}"
  fi

  echo "--- [$svc] Done ---"
  echo ""
done

echo ""
echo "=== Building traffic-control-plane (Node.js) ==="
echo "--- [traffic-control-plane] Docker build (tag: ${REGISTRY}/traffic-control-plane:${IMAGE_TAG}) ---"
docker build "${DOCKER_BUILD_ARGS[@]}" -t "${REGISTRY}/traffic-control-plane:${IMAGE_TAG}" "$REPO_ROOT/traffic-control-plane"
if [[ "$PUSH_IMAGE" == "true" ]]; then
  echo "--- [traffic-control-plane] Docker push ---"
  docker push "${REGISTRY}/traffic-control-plane:${IMAGE_TAG}"
fi
echo "--- [traffic-control-plane] Done ---"

echo ""
echo "=== Build complete. All images tagged as ${REGISTRY}/*:${IMAGE_TAG} ==="
if [[ -n "$BASE_IMAGE_REGISTRY" ]]; then
  echo "Base images resolved from ${BASE_IMAGE_REGISTRY}"
fi
if [[ "$PUSH_IMAGE" == "false" ]]; then
  echo "Tip: Run with --push to push images to registry"
fi
