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
  fencingToken?: number;
  startedAt?: string | null;
  expiresAt: string;
  stoppedAt?: string | null;
  stopReason?: string | null;
  recoveryResult?: unknown;
  recoveryError?: string | null;
  createdAt: string;
  updatedAt?: string;
  operatorAuditId?: number | null;
};

export type Event = { id: number; eventType: string; payload?: unknown; createdAt: string };
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
  parameterHash: string | null;
  result: 'SUCCESS' | 'FAILURE';
  correlationId: string | null;
  createdAt: string;
};

export type FaultRunDetails = {
  run: FaultRun;
  events: Event[];
  audit?: FaultRunAudit | null;
};
