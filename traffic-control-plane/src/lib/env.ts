// Environment configuration for traffic-control-plane

import type { FaultRunExecutionMode } from './fault-run-execution-repository';

export type FaultRunReconciliationMode = 'OFF' | FaultRunExecutionMode;

export interface FaultRunRuntimeConfig {
  safeRuntimeEnabled: boolean;
  stopScanIntervalMs: number;
  drainTimeoutMs: number;
  recoveryTimeoutMs: number;
  shutdownTimeoutMs: number;
  workerStopGracePeriodMs: number | null;
  reconciliationMode: FaultRunReconciliationMode;
  ownerLeaseTtlMs: number;
  ownerHeartbeatMs: number;
  reconcileIntervalMs: number;
  ownerIdPrefix: string;
}

export function parseFaultRunRuntimeConfig(
  source: Record<string, string | undefined>,
): FaultRunRuntimeConfig {
  const drainTimeoutMs = strictBoundedInteger(
    'FAULT_RUN_DRAIN_TIMEOUT_MS',
    source.FAULT_RUN_DRAIN_TIMEOUT_MS,
    30_000,
    1_000,
    120_000,
  );
  const recoveryTimeoutMs = strictBoundedInteger(
    'FAULT_RUN_RECOVERY_TIMEOUT_MS',
    source.FAULT_RUN_RECOVERY_TIMEOUT_MS,
    60_000,
    Math.max(5_000, drainTimeoutMs),
    300_000,
  );
  const shutdownTimeoutMs = strictBoundedInteger(
    'FAULT_RUN_SHUTDOWN_TIMEOUT_MS',
    source.FAULT_RUN_SHUTDOWN_TIMEOUT_MS,
    90_000,
    recoveryTimeoutMs,
    600_000,
  );
  const workerStopGracePeriodMs = optionalStrictDurationMs(
    'FAULT_RUN_WORKER_STOP_GRACE_PERIOD',
    source.FAULT_RUN_WORKER_STOP_GRACE_PERIOD,
  );
  if (workerStopGracePeriodMs !== null && workerStopGracePeriodMs <= shutdownTimeoutMs) {
    throw new Error('FAULT_RUN_WORKER_STOP_GRACE_PERIOD_TOO_SHORT');
  }
  const ownerLeaseTtlMs = strictBoundedInteger(
    'FAULT_RUN_OWNER_LEASE_TTL_MS',
    source.FAULT_RUN_OWNER_LEASE_TTL_MS,
    30_000,
    15_000,
    120_000,
  );
  const ownerHeartbeatMs = strictBoundedInteger(
    'FAULT_RUN_OWNER_HEARTBEAT_MS',
    source.FAULT_RUN_OWNER_HEARTBEAT_MS,
    10_000,
    250,
    60_000,
  );
  if (ownerHeartbeatMs * 2 >= ownerLeaseTtlMs) {
    throw new Error('FAULT_RUN_OWNER_HEARTBEAT_TOO_LONG');
  }

  return {
    safeRuntimeEnabled: strictBoolean(
      'FAULT_RUN_SAFE_RUNTIME_ENABLED',
      source.FAULT_RUN_SAFE_RUNTIME_ENABLED,
      false,
    ),
    stopScanIntervalMs: strictBoundedInteger(
      'FAULT_RUN_STOP_SCAN_INTERVAL_MS',
      source.FAULT_RUN_STOP_SCAN_INTERVAL_MS,
      1000,
      250,
      10_000,
    ),
    drainTimeoutMs,
    recoveryTimeoutMs,
    shutdownTimeoutMs,
    workerStopGracePeriodMs,
    reconciliationMode: parseFaultRunReconciliationMode(source.FAULT_RUN_RECONCILIATION_MODE),
    ownerLeaseTtlMs,
    ownerHeartbeatMs,
    reconcileIntervalMs: strictBoundedInteger(
      'FAULT_RUN_RECONCILE_INTERVAL_MS',
      source.FAULT_RUN_RECONCILE_INTERVAL_MS,
      1000,
      250,
      5000,
    ),
    ownerIdPrefix: strictOwnerIdPrefix(source.FAULT_RUN_OWNER_ID_PREFIX),
  };
}

export function parseFaultRunReconciliationMode(
  value: string | undefined,
): FaultRunReconciliationMode {
  if (value === undefined) return 'OFF';
  if (value === 'OFF' || value === 'OBSERVE' || value === 'SHADOW' || value === 'TAKEOVER') {
    return value;
  }
  throw new Error('INVALID_ENUM_ENV:FAULT_RUN_RECONCILIATION_MODE');
}

const faultRunRuntimeConfig = parseFaultRunRuntimeConfig(process.env);

export const env = {
  // Gateway is the ONLY external service traffic-control-plane talks to
  GATEWAY_BASE_URL: process.env.GATEWAY_BASE_URL || 'http://localhost:18080',
  CASTREL_INTERNAL_SERVICE_KEY: process.env.CASTREL_INTERNAL_SERVICE_KEY || '',
  NOTIFICATION_RESTART_BROKER_URL: process.env.NOTIFICATION_RESTART_BROKER_URL || 'http://localhost:8095',
  NOTIFICATION_RESTART_BROKER_KEY: process.env.NOTIFICATION_RESTART_BROKER_KEY || '',
  TRAFFIC_LIFECYCLE_ACCOUNTS: process.env.TRAFFIC_LIFECYCLE_ACCOUNTS || '[]',
  TRAFFIC_SCENARIO_ACCOUNTS: process.env.TRAFFIC_SCENARIO_ACCOUNTS
    || '[{"label":"sam","email":"sam@example.com","password":"password","expectedCustomerId":19}]',

  // MySQL for runner config storage
  MYSQL_HOST: process.env.MYSQL_HOST || 'localhost',
  MYSQL_PORT: parseInt(process.env.MYSQL_PORT || '13306', 10),
  MYSQL_USER: process.env.MYSQL_USER || 'castrel',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'castrel',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'castrel',
  MYSQL_POOL_CONNECTION_LIMIT: boundedInteger(process.env.MYSQL_POOL_CONNECTION_LIMIT, 5, 3, 20),

  // Redis for distributed locking and runtime coordination
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '16379', 10),

  // Grafana deep links
  GRAFANA_BASE_URL: process.env.GRAFANA_BASE_URL || '',
  TEMPO_BASE_URL: process.env.TEMPO_BASE_URL || '',
  CASTREL_RELEASE_REVISION: process.env.CASTREL_RELEASE_REVISION?.trim() || null,
  CASTREL_DEPLOYMENT_MODE: process.env.CASTREL_DEPLOYMENT_MODE?.trim() || 'unknown',
  BASELINE_CAPTURE_ENABLED: process.env.BASELINE_CAPTURE_ENABLED === 'true',
  BASELINE_OBSERVATION_CHECK_TIMEOUT_MS: boundedInteger(
    process.env.BASELINE_OBSERVATION_CHECK_TIMEOUT_MS, 5000, 1000, 60_000),
  BASELINE_OBSERVATION_WINDOW_SEC: boundedInteger(
    process.env.BASELINE_OBSERVATION_WINDOW_SEC, 900, 60, 86_400),

  // Safe runtime remains opt-in until Docker Compose canary and rollback gates are complete.
  FAULT_RUN_SAFE_RUNTIME_ENABLED: faultRunRuntimeConfig.safeRuntimeEnabled,
  FAULT_RUN_DRAIN_TIMEOUT_MS: faultRunRuntimeConfig.drainTimeoutMs,
  FAULT_RUN_RECOVERY_TIMEOUT_MS: faultRunRuntimeConfig.recoveryTimeoutMs,
  FAULT_RUN_SHUTDOWN_TIMEOUT_MS: faultRunRuntimeConfig.shutdownTimeoutMs,
  FAULT_RUN_STOP_SCAN_INTERVAL_MS: faultRunRuntimeConfig.stopScanIntervalMs,
  FAULT_RUN_WORKER_STOP_GRACE_PERIOD_MS: faultRunRuntimeConfig.workerStopGracePeriodMs,
  FAULT_RUN_RECONCILIATION_MODE: faultRunRuntimeConfig.reconciliationMode,
  FAULT_RUN_OWNER_LEASE_TTL_MS: faultRunRuntimeConfig.ownerLeaseTtlMs,
  FAULT_RUN_OWNER_HEARTBEAT_MS: faultRunRuntimeConfig.ownerHeartbeatMs,
  FAULT_RUN_RECONCILE_INTERVAL_MS: faultRunRuntimeConfig.reconcileIntervalMs,
  FAULT_RUN_OWNER_ID_PREFIX: faultRunRuntimeConfig.ownerIdPrefix,

  ALERT_CONFIG_DIR: process.env.ALERT_CONFIG_DIR || '../data',
  ALERT_SOURCE_RULES_PATH: process.env.ALERT_SOURCE_RULES_PATH || '../infra/prometheus/rules/alert-rules.yml',
  ALERT_SOURCE_MANAGER_PATH: process.env.ALERT_SOURCE_MANAGER_PATH || '../infra/alertmanager/alertmanager.yml',
  PROMETHEUS_RELOAD_URL: process.env.PROMETHEUS_RELOAD_URL || 'http://localhost:9090/-/reload',
  ALERTMANAGER_RELOAD_URL: process.env.ALERTMANAGER_RELOAD_URL || 'http://localhost:9093/-/reload',

  // Worker settings
  WORKER_ENABLED: process.env.WORKER_ENABLED !== 'false',
  APP_TIME_ZONE: process.env.APP_TIME_ZONE || 'Asia/Shanghai',
  PRODUCT_DETAIL_REQUEST_TIMEOUT_MS: boundedInteger(
    process.env.PRODUCT_DETAIL_REQUEST_TIMEOUT_MS, 5000, 100, 30_000),
} as const;

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function strictBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`INVALID_BOOLEAN_ENV:${name}`);
}

function strictBoundedInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`INVALID_INTEGER_ENV:${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`INVALID_INTEGER_ENV:${name}`);
  }
  return parsed;
}

function optionalStrictDurationMs(name: string, value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^([1-9]\d*)(ms|s|m)$/.exec(value);
  if (!match) throw new Error(`INVALID_DURATION_ENV:${name}`);
  const magnitude = Number(match[1]);
  const multiplier = match[2] === 'ms' ? 1 : match[2] === 's' ? 1000 : 60_000;
  const milliseconds = magnitude * multiplier;
  if (!Number.isSafeInteger(milliseconds) || milliseconds > 900_000) {
    throw new Error(`INVALID_DURATION_ENV:${name}`);
  }
  return milliseconds;
}

function strictOwnerIdPrefix(value: string | undefined): string {
  const prefix = value === undefined ? 'traffic-control-plane-worker' : value;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(prefix)) {
    throw new Error('INVALID_OWNER_ID_PREFIX');
  }
  return prefix;
}
