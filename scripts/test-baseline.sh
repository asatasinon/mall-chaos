#!/usr/bin/env bash
set -euo pipefail

# Run each available test layer with the default service configuration.
mvn test -Dspring.profiles.active=test

./scripts/integration-test.sh

pushd traffic-control-plane >/dev/null
pnpm typecheck
pnpm lint
popd >/dev/null

if [[ -d shopfront && -f shopfront/package.json ]]; then
  pushd shopfront >/dev/null
  pnpm typecheck
  pnpm lint
  if [[ -d tests ]]; then
    pnpm exec playwright test
  fi
  popd >/dev/null
fi