#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'check-safe-runtime-compose: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail 'required command not found: docker'
command -v node >/dev/null 2>&1 || fail 'required command not found: node'

cd "$REPO_ROOT"
docker compose config --format json | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const config = JSON.parse(input);
  const web = config.services?.["traffic-control-plane"];
  const worker = config.services?.["traffic-control-plane-worker"];
  if (!web || !worker) throw new Error("CONTROL_PLANE_WORKER_SHAPE_INVALID");
  if (web.image !== worker.image) throw new Error("CONTROL_PLANE_IMAGE_MISMATCH");

  const keys = [
    "FAULT_RUN_SAFE_RUNTIME_ENABLED",
    "FAULT_RUN_STOP_SCAN_INTERVAL_MS",
    "FAULT_RUN_DRAIN_TIMEOUT_MS",
    "FAULT_RUN_RECOVERY_TIMEOUT_MS",
    "FAULT_RUN_SHUTDOWN_TIMEOUT_MS",
  ];
  for (const key of keys) {
    if (web.environment?.[key] !== worker.environment?.[key]) {
      throw new Error(`FAULT_RUN_RUNTIME_ENV_MISMATCH:${key}`);
    }
  }

  const strictRuntimeDurationMs = (value) => {
    if (typeof value !== "string") throw new Error("INVALID_COMPOSE_GRACE_PERIOD");
    const match = /^([1-9]\d*)(ms|s|m)$/.exec(value);
    if (!match) throw new Error("INVALID_COMPOSE_GRACE_PERIOD");
    const milliseconds = Number(match[1]) * ({ ms: 1, s: 1000, m: 60000 })[match[2]];
    if (!Number.isSafeInteger(milliseconds) || milliseconds > 900000) {
      throw new Error("INVALID_COMPOSE_GRACE_PERIOD");
    }
    return milliseconds;
  };
  const composeDurationMs = (value) => {
    if (typeof value !== "string") throw new Error("INVALID_COMPOSE_GRACE_PERIOD");
    const matches = [...value.matchAll(/(\d+)(ms|h|m|s)/g)];
    if (matches.length === 0 || matches.map((match) => match[0]).join("") !== value) {
      throw new Error("INVALID_COMPOSE_GRACE_PERIOD");
    }
    const milliseconds = matches.reduce(
      (total, match) => total + Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 })[match[2]],
      0,
    );
    if (!Number.isSafeInteger(milliseconds)) throw new Error("INVALID_COMPOSE_GRACE_PERIOD");
    return milliseconds;
  };
  const strictBoolean = (value) => {
    if (value !== "true" && value !== "false") throw new Error("INVALID_SAFE_RUNTIME_FLAG");
  };
  const strictInteger = (key, value, minimum, maximum) => {
    if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
      throw new Error(`INVALID_SAFE_RUNTIME_INTEGER:${key}`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new Error(`INVALID_SAFE_RUNTIME_INTEGER:${key}`);
    }
    return parsed;
  };

  strictBoolean(worker.environment?.FAULT_RUN_SAFE_RUNTIME_ENABLED);
  strictInteger("FAULT_RUN_STOP_SCAN_INTERVAL_MS", worker.environment?.FAULT_RUN_STOP_SCAN_INTERVAL_MS, 250, 10000);
  const drainTimeoutMs = strictInteger(
    "FAULT_RUN_DRAIN_TIMEOUT_MS", worker.environment?.FAULT_RUN_DRAIN_TIMEOUT_MS, 1000, 120000,
  );
  const recoveryTimeoutMs = strictInteger(
    "FAULT_RUN_RECOVERY_TIMEOUT_MS", worker.environment?.FAULT_RUN_RECOVERY_TIMEOUT_MS,
    Math.max(5000, drainTimeoutMs), 300000,
  );
  const shutdownTimeoutMs = strictInteger(
    "FAULT_RUN_SHUTDOWN_TIMEOUT_MS", worker.environment?.FAULT_RUN_SHUTDOWN_TIMEOUT_MS,
    recoveryTimeoutMs, 600000,
  );
  const configuredGraceMs = strictRuntimeDurationMs(worker.environment?.FAULT_RUN_WORKER_STOP_GRACE_PERIOD);
  if (composeDurationMs(worker.stop_grace_period) !== configuredGraceMs) {
    throw new Error("WORKER_GRACE_PERIOD_MISMATCH");
  }
  if (configuredGraceMs <= shutdownTimeoutMs) {
    throw new Error("WORKER_GRACE_PERIOD_TOO_SHORT");
  }
  if (typeof worker.environment?.CASTREL_INTERNAL_SERVICE_KEY !== "string"
    || worker.environment.CASTREL_INTERNAL_SERVICE_KEY.trim() === "") {
    throw new Error("WORKER_INTERNAL_SERVICE_KEY_MISSING");
  }
  let lifecycleAccounts;
  try {
    lifecycleAccounts = JSON.parse(worker.environment?.TRAFFIC_LIFECYCLE_ACCOUNTS ?? "");
  } catch {
    throw new Error("WORKER_LIFECYCLE_ACCOUNTS_INVALID");
  }
  if (!Array.isArray(lifecycleAccounts) || lifecycleAccounts.length === 0) {
    throw new Error("WORKER_LIFECYCLE_ACCOUNTS_MISSING");
  }

  console.log("check-safe-runtime-compose: passed");
});
' || fail 'safe-runtime Web/Worker pairing or shutdown grace budget is invalid'
