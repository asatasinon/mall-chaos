#!/usr/bin/env bash
# mvn-full-build.sh — Full Maven package + Docker image build for all business services.
# Usage:
#   ./scripts/mvn-full-build.sh
#   ./scripts/mvn-full-build.sh --with-tests
#   ./scripts/mvn-full-build.sh --skip-docker
#   ./scripts/mvn-full-build.sh --tag v1.0.0 --push

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SKIP_TESTS=true
SKIP_DOCKER=false
PUSH_IMAGE=false

SERVICES=(
  gateway-service
  user-service
  catalog-service
  inventory-service
  order-service
  payment-service
  traffic-runner-service
  promotion-service
  risk-service
  fulfillment-service
  notification-service
)

usage() {
  cat <<'USAGE'
Full Maven package + Docker build script

Options:
  --with-tests      Run Maven tests during package
  --skip-docker     Only run Maven package, skip Docker image build
  --tag <tag>       Docker image tag (default: latest, or IMAGE_TAG env)
  --push            Push built images after docker build
  -h, --help        Show help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-tests)
      SKIP_TESTS=false
      shift
      ;;
    --skip-docker)
      SKIP_DOCKER=true
      shift
      ;;
    --tag)
      [[ $# -lt 2 ]] && { echo "--tag requires a value" >&2; exit 1; }
      IMAGE_TAG="$2"
      shift 2
      ;;
    --push)
      PUSH_IMAGE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

cd "$REPO_ROOT"

echo "==> [1/2] Maven full package"
if [[ "$SKIP_TESTS" == "true" ]]; then
  mvn clean package -DskipTests
else
  mvn clean package
fi

echo "==> Maven build finished"

if [[ "$SKIP_DOCKER" == "true" ]]; then
  echo "==> Docker build skipped (--skip-docker)"
  exit 0
fi

echo "==> [2/2] Docker image build"
for svc in "${SERVICES[@]}"; do
  image="castrel/${svc}:${IMAGE_TAG}"
  echo "--> Building ${image}"
  docker build -t "${image}" -f "${REPO_ROOT}/${svc}/Dockerfile" "${REPO_ROOT}"

  if [[ "$PUSH_IMAGE" == "true" ]]; then
    echo "--> Pushing ${image}"
    docker push "${image}"
  fi
done

echo "==> All done"
echo "Built images: castrel/*:${IMAGE_TAG}"
