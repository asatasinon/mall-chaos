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
} from './fault-run-repository';
import { getScenarioDefinition, validateScenarioParameters } from './fault-run-catalog';
import { createFaultRunContext } from './fault-run-context';

export interface FaultRunTargetAdapter {
  start(run: FaultRunRecord): Promise<void>;
  stop(run: FaultRunRecord): Promise<unknown>;
  compensate(run: FaultRunRecord): Promise<void>;
}

export class GatewayFaultRunTargetAdapter implements FaultRunTargetAdapter {
  async start(run: FaultRunRecord): Promise<void> {
    if (run.targetService === 'traffic-control-plane') return;
    await getGatewayClient().postInternal('/internal/gateway/fault-runs/start', toGatewayPayload(run), run.traceId ?? undefined);
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

  constructor(private readonly targetAdapter: FaultRunTargetAdapter = new GatewayFaultRunTargetAdapter()) {}

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
    const result = await createFaultRun(input);
    if (!result.created) {
      this.schedule(result.run);
      return result;
    }

    try {
      await this.targetAdapter.start(result.run);
      const active = await transitionFaultRun(
        result.run.faultRunId,
        ['CREATING'],
        'ACTIVE',
        { eventType: 'TARGET_CONFIRMED', payload: { targetService: result.run.targetService } },
      );
      if (!active) throw new Error('FAULT_RUN_ACTIVATION_READBACK_FAILED');
      this.schedule(active);
      return { run: active, created: true };
    } catch (error) {
      const compensationError = await this.compensateAfterCreateFailure(result.run, error);
      await transitionFaultRun(
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
    const existing = await loadFaultRun(faultRunId);
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

  async markServiceUnavailable(faultRunId: string, details: unknown = {}): Promise<FaultRunRecord | null> {
    this.clearTimer(faultRunId);
    return transitionFaultRun(
      faultRunId,
      ['ACTIVE', 'RECOVERING'],
      'SERVICE_UNAVAILABLE',
      { eventType: 'SERVICE_UNAVAILABLE', payload: details, stopReason: 'SERVICE_UNAVAILABLE' },
    );
  }

  async recoverExpiredRuns(): Promise<void> {
    const runs = await listExpiredActiveFaultRuns();
    await Promise.all(runs.map((run) => this.stop(run.faultRunId, 'EXPIRED')));
  }

  async scheduleActiveRuns(): Promise<void> {
    const runs = await listActiveFaultRuns();
    await Promise.all(runs.map(async (run) => {
      if (run.state === 'CREATING') {
        const compensationError = await this.compensateAfterCreateFailure(run, new Error('CONTROL_PLANE_RESTART'));
        await transitionFaultRun(
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
      : await transitionFaultRun(
        run.faultRunId,
        ['CREATING', 'ACTIVE'],
        'RECOVERING',
        { eventType: 'RECOVERY_STARTED', payload: { reason }, stopReason: reason },
      );
    if (!recovering || isTerminal(recovering.state)) return recovering;
    try {
      const result = await this.targetAdapter.stop(recovering);
      return transitionFaultRun(
        run.faultRunId,
        ['RECOVERING'],
        'RECOVERED',
        { eventType: 'RECOVERY_COMPLETED', payload: result ?? {}, recoveryResult: result ?? { stopped: true } },
      );
    } catch (error) {
      return transitionFaultRun(
        run.faultRunId,
        ['RECOVERING'],
        'FAILED',
        {
          eventType: 'RECOVERY_FAILED',
          payload: { error: errorMessage(error) },
          recoveryResult: { stopped: false },
          recoveryError: errorMessage(error),
          stopReason: 'RECOVERY_FAILED',
        },
      );
    }
  }

  private async compensateAfterCreateFailure(run: FaultRunRecord, originalError: unknown): Promise<string | null> {
    await appendFaultRunEvent(run.faultRunId, 'COMPENSATION_STARTED', { error: errorMessage(originalError) });
    try {
      await this.targetAdapter.compensate(run);
      await appendFaultRunEvent(run.faultRunId, 'COMPENSATION_COMPLETED');
      return null;
    } catch (error) {
      const message = errorMessage(error);
      await appendFaultRunEvent(run.faultRunId, 'COMPENSATION_FAILED', { error: message });
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

let coordinator: FaultRunCoordinator | null = null;

export function getFaultRunCoordinator(): FaultRunCoordinator {
  if (!coordinator) coordinator = new FaultRunCoordinator();
  return coordinator;
}
