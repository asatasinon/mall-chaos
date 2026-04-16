#!/bin/bash
# Randomly kill (and restart) a container using Pumba.
# Usage: pumba-kill.sh [containerName] [intervalSec]
#   containerName : Docker container name (default: castrel-order)
#   intervalSec   : kill interval in seconds (default: 300, i.e. every 5 min)

set -euo pipefail

CONTAINER="${1:-castrel-order}"
INTERVAL="${2:-300}"

echo "[chaos] Starting Pumba kill loop for '${CONTAINER}' every ${INTERVAL}s. Ctrl+C to stop."
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  gaiaadm/pumba:latest \
  --random \
  kill \
    --interval "${INTERVAL}s" \
    --signal SIGKILL \
    "${CONTAINER}"
