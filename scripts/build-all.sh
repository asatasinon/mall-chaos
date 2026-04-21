#!/usr/bin/env bash
# build-all.sh — Build all service JARs and Docker images
# Usage: ./scripts/build-all.sh [--push] [--tag <tag>]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="${REGISTRY:-harbor.cloudwise.com/noname}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
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

echo ""
echo "=== Building & packaging services ==="
for svc in "${SERVICES[@]}"; do
  echo "--- [$svc] Maven package ---"
  mvn package -pl "$svc" -DskipTests -q

  echo "--- [$svc] Docker build (tag: ${REGISTRY}/${svc}:${IMAGE_TAG}) ---"
  docker build -t "${REGISTRY}/${svc}:${IMAGE_TAG}" "$REPO_ROOT/$svc"

  if [[ "$PUSH_IMAGE" == "true" ]]; then
    echo "--- [$svc] Docker push ---"
    docker push "${REGISTRY}/${svc}:${IMAGE_TAG}"
  fi

  echo "--- [$svc] Done ---"
  echo ""
done

echo ""
echo "=== Building traffic-control-plane (Node.js) ==="
echo "--- [traffic-runner-service] Docker build (tag: ${REGISTRY}/traffic-runner-service:${IMAGE_TAG}) ---"
docker build -t "${REGISTRY}/traffic-runner-service:${IMAGE_TAG}" "$REPO_ROOT/traffic-control-plane"
if [[ "$PUSH_IMAGE" == "true" ]]; then
  echo "--- [traffic-runner-service] Docker push ---"
  docker push "${REGISTRY}/traffic-runner-service:${IMAGE_TAG}"
fi
echo "--- [traffic-runner-service] Done ---"

echo ""
echo "=== Build complete. All images tagged as ${REGISTRY}/*:${IMAGE_TAG} ==="
if [[ "$PUSH_IMAGE" == "false" ]]; then
  echo "Tip: Run with --push to push images to registry"
fi
