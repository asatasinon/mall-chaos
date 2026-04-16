#!/usr/bin/env bash
# k8s-teardown.sh — Remove all Castrel Chaos resources from Kubernetes
# Usage: ./scripts/k8s-teardown.sh [--delete-pvc]
# WARNING: --delete-pvc will permanently remove MySQL data volumes.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DELETE_PVC=false

if [[ "${1:-}" == "--delete-pvc" ]]; then
  DELETE_PVC=true
fi

echo "=== Removing Castrel Chaos from Kubernetes ==="
echo ""

echo "Step 1: Remove Chaos Mesh experiments..."
kubectl delete -f "$REPO_ROOT/k8s/chaos/" --ignore-not-found=true 2>/dev/null || true

echo "Step 2: Remove Ingress..."
kubectl delete -f "$REPO_ROOT/k8s/ingress/" --ignore-not-found=true

echo "Step 3: Remove business services..."
kubectl delete -f "$REPO_ROOT/k8s/services/" --ignore-not-found=true --recursive

echo "Step 4: Remove infrastructure..."
kubectl delete -f "$REPO_ROOT/k8s/infra/" --ignore-not-found=true

echo "Step 5: Remove ConfigMaps and Secrets..."
kubectl delete -f "$REPO_ROOT/k8s/configmap/" --ignore-not-found=true
kubectl delete -f "$REPO_ROOT/k8s/secrets/" --ignore-not-found=true

if [[ "$DELETE_PVC" == "true" ]]; then
  echo "Step 6: Removing PersistentVolumeClaims (DATA WILL BE LOST)..."
  kubectl delete pvc -n castrel --all --ignore-not-found=true
else
  echo "Step 6: Skipping PVC deletion (MySQL data preserved)."
  echo "  Run with --delete-pvc to remove data volumes."
fi

echo "Step 7: Removing namespace..."
kubectl delete namespace castrel --ignore-not-found=true

echo ""
echo "=== Teardown complete ==="
