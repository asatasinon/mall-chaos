#!/usr/bin/env bash
set -euo pipefail

# Keep the default test run free of chaos injection and run each available layer.
mvn test -Dspring.profiles.active=test -Dchaos.endpoints.enabled=false

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