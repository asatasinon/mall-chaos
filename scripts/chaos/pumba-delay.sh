#!/bin/bash
# Inject network delay into a container using Pumba + tc netem.
# Usage: pumba-delay.sh [containerName] [delayMs] [jitterMs] [durationSec]
#   containerName : Docker container name (default: castrel-order)
#   delayMs       : delay in ms (default: 2000)
#   jitterMs      : jitter in ms (default: 500)
#   durationSec   : duration in seconds (default: 60)

set -euo pipefail

CONTAINER="${1:-castrel-order}"
DELAY_MS="${2:-2000}"
JITTER_MS="${3:-500}"
DURATION="${4:-60}"

echo "[chaos] Injecting ${DELAY_MS}ms network delay (±${JITTER_MS}ms) into '${CONTAINER}' for ${DURATION}s..."
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  gaiaadm/pumba:latest \
  netem \
    --duration "${DURATION}s" \
    --tc-image gaiadocker/iproute2 \
    delay \
      --time "${DELAY_MS}" \
      --jitter "${JITTER_MS}" \
    "${CONTAINER}"
echo "[chaos] Pumba delay injection completed."
