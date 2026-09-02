import { getGatewayClient } from './gateway-client';
import {
  appendFaultRunEvent,
  createFaultRun,
  loadFaultRun,
  listActiveFaultRuns,
  listExpiredActiveFaultRuns,
  transitionFaultRun,
  type CreateFaultRunInput,
  type FaultRunRecord,
  type FaultRunTargetSummary,
} from './fault-run-repository';
import { getScenarioDefinition, validateScenarioParameters } from './fault-run-catalog';
import { createFaultRunContext } from './fault-run-context';

export interface FaultRunTargetAdapter {
  start(run: FaultRunRecord): Promise<unknown>;
  stop(run: FaultRunRecord): Promise<unknown>;
  compensate(run: FaultRunRecord): Promise<void>;
}

export interface FaultRunStore {
  create(input: CreateFaultRunInput): Promise<{ run: FaultRunRecord; created: boolean }>;
  load(faultRunId: string): Promise<FaultRunRecord | null>;
  listActive(): Promise<FaultRunRecord[]>;
  listExpired(now?: Date): Promise<FaultRunRecord[]>;
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
  transition(...args: Parameters<FaultRunStore['transition']>) { return transitionFaultRun(...args); }
  appendEvent(faultRunId: string, eventType: string, payload?: unknown) {
    return appendFaultRunEvent(faultRunId, eventType, payload);
  }
}

export class GatewayFaultRunTargetAdapter implements FaultRunTargetAdapter {
  async start(run: FaultRunRecord): Promise<unknown> {
    if (run.targetService === 'traffic-control-plane') return { accepted: true, target: 'worker' };
    return getGatewayClient().postInternal(
      '/internal/gateway/fault-runs/start', toGatewayPayload(run), run.traceId ?? undefined);
  }

  async stop(run: FaultRunRecord): Promise<unknown> {
    if (run.targetService === 'traffic-control-plane') return { stopped: true, target: 'worker' };
    return getGatewayClient().postInternal(
      '/internal/gateway/fault-runs/stop',
      toGatewayPayload(run),
      run.traceId ?? undefined,
    );
  }

  async compensate(run: FaultRunRecord): Promise<void> {
    await this.stop(run);
  }
}

export interface CreateFaultRunCommand {
  scenario: string;
  parameters: unknown;
  idempotencyKey: string;
  traceId: string;
}

export class FaultRunCoordinator {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly recoveryPromises = new Map<string, Promise<FaultRunRecord | null>>();
  private readonly runDrains = new Map<string, () => Promise<unknown>>();

  constructor(
    private readonly targetAdapter: FaultRunTargetAdapter = new GatewayFaultRunTargetAdapter(),
    private readonly store: FaultRunStore = new SqlFaultRunStore(),
  ) {}

  registerRunDrain(faultRunId: string, drain: () => Promise<unknown>): () => void {
    this.runDrains.set(faultRunId, drain);
    return () => this.runDrains.delete(faultRunId);
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
    };
    const result = await this.store.create(input);
    if (!result.created) {
      this.schedule(result.run);
      return result;
    }

    try {
      const targetResponse = await this.targetAdapter.start(result.run);
      const targetSummary = sanitizeTargetSummary(result.run, targetResponse);
      const active = await this.store.transition(
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
      if (!active) throw new Error('FAULT_RUN_ACTIVATION_READBACK_FAILED');
      this.schedule(active);
      return { run: active, created: true };
    } catch (error) {
      const compensationError = await this.compensateAfterCreateFailure(result.run, error);
      await this.store.transition(
        result.run.faultRunId,
        ['CREATING'],
        'FAILED',
        {
          eventType: 'CREATE_FAILED',
          payload: { error: errorMessage(error), compensationError },
          stopReason: 'TARGET_UNAVAILABLE',
          recoveryResult: { compensated: compensationError === null },
          recoveryError: compensationError ?? errorMessage(error),
        },
      );
      throw new Error('FAULT_RUN_TARGET_START_FAILED');
    }
  }

  async stop(faultRunId: string, reason: 'MANUAL' | 'EXPIRED' = 'MANUAL'): Promise<FaultRunRecord | null> {
    const existing = await this.store.load(faultRunId);
    if (!existing) return null;
    if (isTerminal(existing.state)) return existing;
    if (existing.state === 'SERVICE_UNAVAILABLE') return existing;
    if (existing.parameters.durationSec && existing.expiresAt <= new Date().toISOString()) reason = 'EXPIRED';

    const current = this.recoveryPromises.get(faultRunId);
    if (current) return current;
    const recovery = this.recover(existing, reason);
    this.recoveryPromises.set(faultRunId, recovery);
    try {
      return await recovery;
    } finally {
      this.recoveryPromises.delete(faultRunId);
    }
  }

  async stopExpired(faultRunId: string): Promise<FaultRunRecord | null> {
    return this.stop(faultRunId, 'EXPIRED');
  }

  async markServiceUnavailable(faultRunId: string, details: unknown = {}): Promise<FaultRunRecord | null> {
    this.clearTimer(faultRunId);
    return this.store.transition(
      faultRunId,
      ['ACTIVE', 'RECOVERING'],
      'SERVICE_UNAVAILABLE',
      { eventType: 'SERVICE_UNAVAILABLE', payload: details, stopReason: 'SERVICE_UNAVAILABLE' },
    );
  }

  async markServiceRecovered(faultRunId: string, details: unknown = {}): Promise<FaultRunRecord | null> {
    this.clearTimer(faultRunId);
    return this.store.transition(
      faultRunId,
      ['SERVICE_UNAVAILABLE'],
      'RECOVERED',
      {
        eventType: 'SERVICE_RECOVERED',
        payload: details,
        recoveryResult: { serviceRestarted: true, ...asRecord(details) },
      },
    );
  }

  async recoverExpiredRuns(): Promise<void> {
    const runs = await this.store.listExpired();
    await Promise.all(runs.map((run) => this.stop(run.faultRunId, 'EXPIRED')));
  }

  async scheduleActiveRuns(): Promise<void> {
    const runs = await this.store.listActive();
    await Promise.all(runs.map(async (run) => {
      if (run.state === 'CREATING') {
        const compensationError = await this.compensateAfterCreateFailure(run, new Error('CONTROL_PLANE_RESTART'));
        await this.store.transition(
          run.faultRunId,
          ['CREATING'],
          'FAILED',
          {
            eventType: 'CREATE_RECOVERY_FAILED',
            payload: { compensationError },
            stopReason: 'CONTROL_PLANE_RESTART',
            recoveryResult: { compensated: compensationError === null },
            recoveryError: compensationError ?? 'CREATING run was interrupted by control-plane restart',
          },
        );
      } else if (run.state === 'RECOVERING') await this.stop(run.faultRunId, 'EXPIRED');
      else if (run.expiresAt <= new Date().toISOString()) await this.stop(run.faultRunId, 'EXPIRED');
      else this.schedule(run);
    }));
  }

  private async recover(run: FaultRunRecord, reason: 'MANUAL' | 'EXPIRED'): Promise<FaultRunRecord | null> {
    this.clearTimer(run.faultRunId);
    const recovering = run.state === 'RECOVERING'
      ? run
      : await this.store.transition(
        run.faultRunId,
        ['CREATING', 'ACTIVE'],
        'RECOVERING',
        { eventType: 'RECOVERY_STARTED', payload: { reason }, stopReason: reason },
      );
    if (!recovering || isTerminal(recovering.state)) return recovering;
    const workerDrain = await this.drainRun(run.faultRunId);
    try {
      const result = await this.targetAdapter.stop(recovering);
      return this.store.transition(
        run.faultRunId,
        ['RECOVERING'],
        reason === 'MANUAL' ? 'STOPPED' : 'RECOVERED',
        {
          eventType: 'RECOVERY_COMPLETED',
          payload: { ...(asRecord(result)), workerDrain },
          recoveryResult: { ...(asRecord(result)), workerDrain, stopped: true },
        },
      );
    } catch (error) {
      return this.store.transition(
        run.faultRunId,
        ['RECOVERING'],
        'FAILED',
        {
          eventType: 'RECOVERY_FAILED',
          payload: { error: errorMessage(error), workerDrain },
          recoveryResult: { stopped: false, workerDrain },
          recoveryError: errorMessage(error),
          stopReason: 'RECOVERY_FAILED',
        },
      );
    }
  }

  private async compensateAfterCreateFailure(run: FaultRunRecord, originalError: unknown): Promise<string | null> {
    await this.store.appendEvent(run.faultRunId, 'COMPENSATION_STARTED', { error: errorMessage(originalError) });
    try {
      await this.targetAdapter.compensate(run);
      await this.store.appendEvent(run.faultRunId, 'COMPENSATION_COMPLETED');
      return null;
    } catch (error) {
      const message = errorMessage(error);
      await this.store.appendEvent(run.faultRunId, 'COMPENSATION_FAILED', { error: message });
      return message;
    }
  }

  private schedule(run: FaultRunRecord): void {
    this.clearTimer(run.faultRunId);
    if (isTerminal(run.state) || run.state === 'SERVICE_UNAVAILABLE') return;
    const delay = Math.max(0, new Date(run.expiresAt).getTime() - Date.now());
    this.timers.set(run.faultRunId, setTimeout(() => {
      void this.stop(run.faultRunId, 'EXPIRED');
    }, delay));
  }

  private clearTimer(faultRunId: string): void {
    const timer = this.timers.get(faultRunId);
    if (timer) clearTimeout(timer);
    this.timers.delete(faultRunId);
  }

  private async drainRun(faultRunId: string): Promise<Record<string, unknown>> {
    const drain = this.runDrains.get(faultRunId);
    if (!drain) return { registered: false, drained: true };
    try {
      return { registered: true, drained: true, result: asRecord(await drain()) };
    } catch (error) {
      return { registered: true, drained: false, error: errorMessage(error) };
    }
  }
}

function toGatewayPayload(run: FaultRunRecord): Record<string, unknown> {
  return {
    ...createFaultRunContext(run),
    scenario: run.scenario,
    operation: run.targetOperation,
    parameters: run.parameters,
  };
}

function isTerminal(state: FaultRunRecord['state']): boolean {
  return state === 'RECOVERED' || state === 'STOPPED' || state === 'FAILED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
      && source.hashKey === `catalog:product-detail:exercise:${run.faultRunId}`) {
    summary.hashKey = source.hashKey;
  }
  assignSafeInteger(source.memberCount, 1, 47, (value) => { summary.memberCount = value; });
  assignSafeInteger(source.memberSizeBytes, 256, 4 * 1024 * 1024,
    (value) => { summary.memberSizeBytes = value; });
  assignSafeInteger(source.logicalBytes, 1, 64 * 1024 * 1024,
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
