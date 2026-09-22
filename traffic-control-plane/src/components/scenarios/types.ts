export type Parameter = {
  name: string;
  kind: 'integer' | 'number' | 'string';
  unit?: 'bytes';
  required?: boolean;
  default?: number | string;
  options?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
};

export type Scenario = {
  scenario: string;
  targetService: string;
  targetOperation: string;
  maxDurationSec: number;
  recoveryStrategy: string;
  allowManualCleanup: boolean;
  parameters: Parameter[];
};

export type FaultRun = {
  faultRunId: string;
  scenario: string;
  targetService: string;
  targetOperation: string;
  state: string;
  parameters?: Record<string, number | string>;
  parameterStatus?: 'VALIDATED' | 'LEGACY' | 'UNKNOWN';
  parameterIssue?: string | null;
  startedAt?: string | null;
  expiresAt: string;
  stoppedAt?: string | null;
  stopReason?: string | null;
  recovery: FaultRunRecoveryView;
  manualCleanup: 'UNAVAILABLE' | 'SAFE_COMMAND' | 'LEGACY_TERMINAL';
  createdAt: string;
  updatedAt?: string;
  operatorAuditId?: number | null;
  execution?: FaultRunExecution | null;
};

export type FaultRunExecution = {
  mode: 'OBSERVE' | 'SHADOW' | 'TAKEOVER';
  ownerId: string | null;
  ownerEpoch: number;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  leaseLostAt: string | null;
  reconciledAt: string | null;
  takeoverCount: number;
  reconciliationState: string;
  drainState: string;
  drainDeadlineAt: string | null;
  lastAction: string | null;
  lastErrorCode: string | null;
};

export type FaultRunAction = {
  actionId: string;
  actionType: 'PREPARE' | 'RELEASE' | 'CLEANUP';
  attemptNo: number;
  actionState: string;
  requestedBy: 'OPERATOR' | 'RECONCILER';
  dispatchOwnerId: string | null;
  dispatchOwnerEpoch: number | null;
  requestedAt: string;
  dispatchStartedAt: string | null;
  completedAt: string | null;
  resultSummary: Record<string, boolean | number | string> | null;
  errorCode: string | null;
};

export type Event = { id: number; eventType: string; payload: Record<string, unknown>; createdAt: string };
export type ConsoleData = { scenarios: Scenario[]; runs: FaultRun[] };

export type FaultRunTargetSummary = {
  layout: 'HASH';
  hashKey: string;
  memberCount: number;
  memberSizeBytes: number;
  logicalBytes: number;
  observedBytes?: number;
  probeSku: string;
  memberSkus: string[];
  expiresAt?: string;
  keyTtlSec: number;
};

export type FaultRunWorkerStats = {
  requests: number;
  successes: number;
  failures: number;
  timeouts: number;
  inFlight: number;
  stopReason: string | null;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  cacheResults: Partial<Record<'CACHE_HIT' | 'CACHE_MISS_DB_FALLBACK' | 'CACHE_INVALID_FALLBACK' | 'CACHE_BACKEND_ERROR' | 'CACHE_UNKNOWN', number>>;
};

export type FaultRunDrain = {
  registered: boolean;
  drained: boolean;
  result?: FaultRunWorkerStats;
  error?: string;
};

export type FaultRunCleanupResult = {
  hashRemoved?: boolean;
  released?: boolean;
  markerRemoved?: boolean;
  faultRunId?: string;
};

export type FaultRunAudit = {
  id: number;
  operatorId: number | null;
  action: string;
  target: string | null;
  result: 'SUCCESS' | 'FAILURE';
  createdAt: string;
};

export type FaultRunDetails = {
  run: FaultRun;
  events: Event[];
  audit?: FaultRunAudit | null;
  audits: FaultRunAudit[];
  actions?: FaultRunAction[];
};
import type { FaultRunRecoveryView } from '@/lib/fault-run-operator-view';
