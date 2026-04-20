#!/bin/sh
# Provisions an additional Grafana user via the Admin API.
# Runs once after Grafana passes its healthcheck (see grafana-init service in docker-compose.yml).

set -e

GRAFANA_URL="http://grafana:3000"

echo "[grafana-init] Creating user: ${GRAFANA_CASTREL_USER}"

HTTP_CODE=$(curl -s -o /tmp/gf_response.json -w "%{http_code}" \
  -u "${GRAFANA_USER}:${GRAFANA_PASSWORD}" \
  -X POST "${GRAFANA_URL}/api/admin/users" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${GRAFANA_CASTREL_USER}\",\"login\":\"${GRAFANA_CASTREL_USER}\",\"password\":\"${GRAFANA_CASTREL_PASSWORD}\",\"OrgId\":1}")

case "$HTTP_CODE" in
  200) echo "[grafana-init] User '${GRAFANA_CASTREL_USER}' created successfully." ;;
  409) echo "[grafana-init] User '${GRAFANA_CASTREL_USER}' already exists, skipping." ;;
  *)   echo "[grafana-init] Unexpected response ${HTTP_CODE}:"; cat /tmp/gf_response.json; exit 1 ;;
esac
