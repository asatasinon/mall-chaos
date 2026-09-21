import { getGatewayClient } from './gateway-client';
import {
  appendFaultRunEvent,
  createFaultRun,
  loadFaultRun,
  listActiveFaultRuns,
  listExpiredActiveFaultRuns,
  requestFaultRunStop,
  transitionFaultRun,
  type CreateFaultRunInput,
  type FaultRunCommandResult,
  type FaultRunRecord,
  type FaultRunTargetSummary,
  type RequestFaultRunStopInput,
} from './fault-run-repository';
import {
  CATALOG_LARGE_VALUE_MIN_MEMBER_SIZE_BYTES,
  getScenarioDefinition,
  validateScenarioParameters,
} from './fault-run-catalog';
import { env } from './env';
import type { FaultRunExecutionMode } from './fault-run-execution-repository';

export interface FaultRunTargetAdapter {
  start(run: FaultRunRecord): Promise<unknown>;
  stop(run: FaultRunRecord, signal?: AbortSignal): Promise<unknown>;
  cleanup(run: FaultRunRecord, signal?: AbortSignal): Promise<unknown>;
  compensate(run: FaultRunRecord, signal?: AbortSignal): Promise<void>;
}

export interface FaultRunStore {
  create(input: CreateFaultRunInput): Promise<{ run: FaultRunRecord; created: boolean }>;
  load(faultRunId: string): Promise<FaultRunRecord | null>;
  listActive(): Promise<FaultRunRecord[]>;
  listExpired(now?: Date): Promise<FaultRunRecord[]>;
  requestStop(input: RequestFaultRunStopInput): Promise<FaultRunCommandResult | null>;
  transition(
    faultRunId: string,
    expectedStates: readonly FaultRunRecord['state'][],
    nextState: FaultRunRecord['state'],
    details: Parameters<typeof transitionFaultRun>[3],
  ): Promise<FaultRunRecord | null>;
  appendEvent(faultRunId: string, eventType: string, payload?: unknown): Promise<void>;
}

export class SqlFaultRunStore implements FaultRunStore {
  create(input: CreateFaultRunInput) { return createFaultRun(input); }
  load(faultRunId: string) { return loadFaultRun(faultRunId); }
  listActive() { return listActiveFaultRuns(); }
  listExpired(now?: Date) { return listExpiredActiveFaultRuns(now); }
  requestStop(input: RequestFaultRunStopInput) { return requestFaultRunStop(input); }
  transition(...args: Parameters<FaultRunStore['transition']>) { return transitionFaultRun(...args); }
  appendEvent(faultRunId: string, eventType: string, payload?: unknown) {
    return appendFaultRunEvent(faultRunId, eventType, payload);
  }
}

export class GatewayFaultRunTargetAdapter implements FaultRunTargetAdapter {
  async start(run: FaultRunRecord): Promise<unknown> {
    if (run.scenario === 'BROWSE_SURGE' || run.scenario === 'ORDER_QUERY_SURGE') {
      return { accepted: true, target: 'worker' };
    }
    return getGatewayClient().postInternal(
      '/internal/gateway/operations/prepare', toGatewayPayload(run), run.traceId ?? undefined);
  }

  async stop(run: FaultRunRecord, signal?: AbortSignal): Promise<unknown> {
    if (run.scenario === 'BROWSE_SURGE' || run.scenario === 'ORDER_QUERY_SURGE') {
      return { stopped: true, target: 'worker' };
    }
    return getGatewayClient().postInternal(
      '/internal/gateway/operations/release',
      toGatewayPayload(run),
      run.traceId ?? undefined,
      signal,
    );
  }

  async cleanup(run: FaultRunRecord, signal?: AbortSignal): Promise<unknown> {
    return getGatewayClient().postInternal(
      '/internal/gateway/operations/cleanup',
      toGatewayCleanupPayload(run),
      run.traceId ?? undefined,
      signal,
    );
  }

  async compensate(run: FaultRunRecord, signal?: AbortSignal): Promise<void> {
    await this.stop(run, signal);
  }
}

export interface CreateFaultRunCommand {
  scenario: string;
  parameters: unknown;
  idempotencyKey: string;
  traceId: string;
  executionMode?: FaultRunExecutionMode;
}

export interface FaultRunCoordinatorOptions {
  safeRuntimeEnabled?: boolean;
  drainTimeoutMs?: number;
  recoveryTimeoutMs?: number;
}

export class FaultRunCoordinator {
  private readonly safeRuntimeEnabled: boolean;
  private readonly drainTimeoutMs: number;
  private readonly recoveryTimeoutMs: number;

  constructor(
    private readonly targetAdapter: FaultRunTargetAdapter = new GatewayFaultRunTargetAdapter(),
    private readonly store: FaultRunStore = new SqlFaultRunStore(),
    options: FaultRunCoordinatorOptions = {},
  ) {
    this.safeRuntimeEnabled = options.safeRuntimeEnabled ?? env.FAULT_RUN_SAFE_RUNTIME_ENABLED;
    this.drainTimeoutMs = options.drainTimeoutMs ?? env.FAULT_RUN_DRAIN_TIMEOUT_MS;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? env.FAULT_RUN_RECOVERY_TIMEOUT_MS;
  }

  async create(command: CreateFaultRunCommand): Promise<{ run: FaultRunRecord; created: boolean }> {
    const definition = getScenarioDefinition(command.scenario);
    const parameters = validateScenarioParameters(command.scenario, command.parameters);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(command.idempotencyKey)) {
      throw new Error('INVALID_IDEMPOTENCY_KEY');
    }
    const durationSec = Number(parameters.durationSec);
    const input: CreateFaultRunInput = {
      scenario: definition.scenario,
      targetService: definition.targetService,
      targetOperation: definition.targetOperation,
      parameters,
      idempotencyKey: command.idempotencyKey,
      expiresAt: new Date(Date.now() + durationSec * 1000),
      traceId: command.traceId,
      executionMode: command.executionMode,
    };
    const result = await this.store.create(input);
    if (!result.created) return result;

    let targetResponse: unknown;
    try {
      targetResponse = await this.targetAdapter.start(result.run);
    } catch {
      return this.failCreatedRun(result.run);
    }

    const targetSummary = sanitizeTargetSummary(result.run, targetResponse);
    let active: FaultRunRecord | null;
    try {
      active = await this.store.transition(
        result.run.faultRunId,
        ['CREATING'],
        'ACTIVE',
        {
          eventType: 'TARGET_CONFIRMED',
          payload: {
            targetService: result.run.targetService,
            ...(targetSummary ? { targetSummary } : {}),
          },
        },
      );
    } catch {
      return this.failCreatedRun(result.run);
    }
    if (!active || active.state === 'FAILED' || active.state === 'SERVICE_UNAVAILABLE') {
      return this.failCreatedRun(result.run);
    }
    if (active.state === 'RECOVERING') {
      await this.store.appendEvent(active.faultRunId, 'CREATE_CANCELLED_AFTER_PREPARE');
      return { run: active, created: true };
    }
    if (active.state !== 'ACTIVE') return this.failCreatedRun(result.run);
    return { run: active, created: true };
  }

  async markServiceUnavailable(faultRunId: string, details: unknown = {}): Promise<FaultRunRecord | null> {
    if (this.safeRuntimeEnabled) {
      const command = await this.store.requestStop({
        faultRunId,
        reason: 'SERVICE_UNAVAILABLE',
        drainTimeoutMs: this.drainTimeoutMs,
        recoveryTimeoutMs: this.recoveryTimeoutMs,
      });
      return command?.run ?? null;
    }
    const summary = sanitizeServiceUnavailableSummary(details);
    return this.store.transition(
      faultRunId,
      ['ACTIVE', 'RECOVERING'],
      'SERVICE_UNAVAILABLE',
      { eventType: 'SERVICE_UNAVAILABLE', payload: summary, stopReason: 'SERVICE_UNAVAILABLE' },
    );
  }
  async markServiceRecovered(faultRunId: string, details: unknown = {}): Promise<FaultRunRecord | null> {
    if (this.safeRuntimeEnabled) {
      return this.store.load(faultRunId);
    }
    const summary = sanitizeServiceRecoverySummary(details);
    return this.store.transition(
      faultRunId,
      ['SERVICE_UNAVAILABLE'],
      'RECOVERED',
      {
        eventType: 'SERVICE_RECOVERED',
        payload: summary,
        recoveryResult: summary,
      },
    );
  }

  private async compensateAfterCreateFailure(run: FaultRunRecord): Promise<string | null> {
    await this.store.appendEvent(run.faultRunId, 'COMPENSATION_STARTED');
    try {
      await this.targetAdapter.compensate(run);
      await this.store.appendEvent(run.faultRunId, 'COMPENSATION_COMPLETED');
      return null;
    } catch {
      await this.store.appendEvent(run.faultRunId, 'COMPENSATION_FAILED', {
        errorCode: 'RECOVERY_COMPENSATION_FAILED',
      });
      return 'RECOVERY_COMPENSATION_FAILED';
    }
  }

  private async failCreatedRun(run: FaultRunRecord): Promise<never> {
    const current = await this.store.load(run.faultRunId);
    if (current?.state === 'RECOVERING') {
      throw new Error('FAULT_RUN_TARGET_START_FAILED');
    }
    if (this.safeRuntimeEnabled) {
      await this.store.requestStop({
        faultRunId: run.faultRunId,
        reason: 'WORKER_FAILED',
        drainTimeoutMs: this.drainTimeoutMs,
        recoveryTimeoutMs: this.recoveryTimeoutMs,
      });
      throw new Error('FAULT_RUN_TARGET_START_FAILED');
    }
    const compensationError = await this.compensateAfterCreateFailure(run);
    await this.store.transition(
      run.faultRunId,
      ['CREATING'],
      'FAILED',
      {
        eventType: 'CREATE_FAILED',
        payload: {
          errorCode: compensationError ? 'RECOVERY_COMPENSATION_FAILED' : 'TARGET_EFFECT_REJECTED',
          compensationError,
        },
        stopReason: 'TARGET_UNAVAILABLE',
        recoveryResult: { compensated: compensationError === null },
        recoveryError: compensationError ?? 'TARGET_EFFECT_REJECTED',
      },
    );
    throw new Error('FAULT_RUN_TARGET_START_FAILED');
  }

}

function toGatewayPayload(run: FaultRunRecord): Record<string, unknown> {
  return {
    runId: run.faultRunId,
    expiresAt: run.expiresAt,
    fencingToken: run.fencingToken,
    idempotencyKey: run.idempotencyKey,
    operation: run.targetOperation,
    parameters: run.parameters,
  };
}

function toGatewayCleanupPayload(run: FaultRunRecord): Record<string, unknown> {
  return {
    runId: run.faultRunId,
    operation: run.targetOperation,
    fencingToken: run.fencingToken,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sanitizeServiceUnavailableSummary(value: unknown): Record<string, string> {
  const source = asRecord(value);
  return typeof source.errorCode === 'string' && /^[A-Z0-9_]{3,96}$/.test(source.errorCode)
    ? { errorCode: source.errorCode }
    : {};
}

function sanitizeServiceRecoverySummary(value: unknown): {
  serviceRestarted: boolean;
  healthy: boolean;
  restartMode?: 'compose' | 'kubernetes';
} {
  const source = asRecord(value);
  const nestedResult = asRecord(source.result);
  const result = Object.keys(nestedResult).length > 0 ? nestedResult : source;
  const restartMode = result.mode === 'compose' || result.mode === 'kubernetes'
    ? result.mode
    : undefined;
  return {
    serviceRestarted: result.restarted === true,
    healthy: result.healthy === true,
    ...(restartMode === undefined ? {} : { restartMode }),
  };
}

function sanitizeTargetSummary(run: FaultRunRecord, response: unknown): FaultRunTargetSummary | undefined {
  if (run.scenario !== 'CATALOG_REDIS_LARGE_VALUE') return undefined;
  const envelope = asRecord(response);
  const firstData = asRecord(envelope.data);
  const nested = asRecord(firstData.data);
  const source = Object.keys(nested).length > 0
    ? nested
    : Object.keys(firstData).length > 0 ? firstData : envelope;
  const summary: FaultRunTargetSummary = {};

  if (source.accepted === true) summary.accepted = true;
  if (source.layout === 'HASH') summary.layout = 'HASH';
  if (typeof source.hashKey === 'string'
      && source.hashKey === `catalog:product-detail:operation:${run.faultRunId}`) {
    summary.hashKey = source.hashKey;
  }
  assignSafeInteger(source.memberCount, 1, 47, (value) => { summary.memberCount = value; });
  assignSafeInteger(source.memberSizeBytes, CATALOG_LARGE_VALUE_MIN_MEMBER_SIZE_BYTES, 128 * 1024 * 1024,
    (value) => { summary.memberSizeBytes = value; });
  assignSafeInteger(source.logicalBytes, 1, 512 * 1024 * 1024,
    (value) => { summary.logicalBytes = value; });
  assignSafeInteger(source.observedBytes, 1, Number.MAX_SAFE_INTEGER,
    (value) => { summary.observedBytes = value; });
  if (typeof source.probeSku === 'string' && source.probeSku.length > 0 && source.probeSku.length <= 128) {
    summary.probeSku = source.probeSku;
  }
  if (Array.isArray(source.memberSkus)) {
    const memberSkus = source.memberSkus
      .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128)
      .slice(0, 64);
    if (memberSkus.length > 0) summary.memberSkus = memberSkus;
  }
  if (typeof source.expiresAt === 'string' && !Number.isNaN(Date.parse(source.expiresAt))) {
    summary.expiresAt = source.expiresAt;
  }
  assignSafeInteger(source.keyTtlSec, 1, 3600, (value) => { summary.keyTtlSec = value; });

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function assignSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  assign: (value: number) => void,
): void {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum) {
    assign(value);
  }
}

let coordinator: FaultRunCoordinator | null = null;

export function getFaultRunCoordinator(): FaultRunCoordinator {
  if (!coordinator) coordinator = new FaultRunCoordinator();
  return coordinator;
}
