#!/usr/bin/env bash
# k8s-deploy.sh — Deploy the full Castrel Chaos stack to Kubernetes
# Usage: ./scripts/k8s-deploy.sh [--dry-run]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K8S_DIR="$REPO_ROOT/k8s"
DRY_RUN_FLAG=""

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN_FLAG="--dry-run=client"
  echo "=== DRY RUN mode (no changes applied) ==="
fi

echo "=== Step 1: Apply namespace ==="
kubectl apply -f "$K8S_DIR/namespace.yaml" $DRY_RUN_FLAG

echo ""
echo "=== Step 2: Apply ConfigMaps ==="
kubectl apply -f "$K8S_DIR/configmap/" $DRY_RUN_FLAG

echo ""
echo "=== Step 3: Apply Secrets ==="
kubectl apply -f "$K8S_DIR/secrets/" $DRY_RUN_FLAG

echo ""
echo "=== Step 4: Apply infrastructure (MySQL, Redis, observability) ==="
kubectl apply -f "$K8S_DIR/infra/" $DRY_RUN_FLAG

if [[ -z "$DRY_RUN_FLAG" ]]; then
  echo "  Waiting for MySQL to be ready..."
  kubectl wait --namespace castrel \
    --for=condition=ready pod \
    --selector=app=mysql \
    --timeout=120s || echo "  [WARN] MySQL not ready yet, continuing..."

  echo "  Waiting for Redis to be ready..."
  kubectl wait --namespace castrel \
    --for=condition=ready pod \
    --selector=app=redis \
    --timeout=60s || echo "  [WARN] Redis not ready yet, continuing..."
fi

echo ""
echo "=== Step 5: Apply business services ==="
kubectl apply -f "$K8S_DIR/services/" $DRY_RUN_FLAG --recursive

echo ""
echo "=== Step 6: Apply Ingress ==="
kubectl apply -f "$K8S_DIR/ingress/" $DRY_RUN_FLAG

echo ""
if [[ -z "$DRY_RUN_FLAG" ]]; then
  echo "=== Deployment complete! ==="
  echo ""
  echo "Check pod status:"
  echo "  kubectl get pods -n castrel"
  echo ""
  echo "Access gateway (add to /etc/hosts: 127.0.0.1 castrel.local):"
  echo "  curl http://castrel.local/api/products"
  echo ""
  echo "Port-forward Grafana:"
  echo "  kubectl port-forward -n castrel svc/grafana 3000:3000"
  echo ""
  echo "Port-forward Chaos Mesh Dashboard:"
  echo "  kubectl port-forward -n chaos-mesh svc/chaos-dashboard 2333:2333"
else
  echo "=== Dry run complete. Review above output before applying. ==="
fi
