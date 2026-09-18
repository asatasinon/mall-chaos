import {
  GatewayFaultRunTargetAdapter,
  SqlFaultRunStore,
  type FaultRunStore,
  type FaultRunTargetAdapter,
} from './fault-run-coordinator';
import type { FaultRunRecord } from './fault-run-repository';

/**
 * Compatibility-only recovery path used while safe-runtime is disabled.
 * The safe-runtime Worker executor never imports or invokes this service.
 */
export class LegacyFaultRunRecovery {
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

  async stop(faultRunId: string, reason: 'MANUAL' | 'EXPIRED' = 'MANUAL'): Promise<FaultRunRecord | null> {
    const existing = await this.store.load(faultRunId);
    if (!existing) return null;
    if (isTerminal(existing.state) || existing.state === 'SERVICE_UNAVAILABLE') return existing;
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

  async recoverExpiredRuns(): Promise<void> {
    const runs = await this.store.listExpired();
    await Promise.all(runs.map((run) => this.stop(run.faultRunId, 'EXPIRED')));
  }

  async scheduleActiveRuns(): Promise<void> {
    const runs = await this.store.listActive();
    await Promise.all(runs.map(async (run) => {
      if (run.state === 'CREATING') {
        const compensationError = await this.compensateAfterCreateFailure(run);
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
      } else if (run.state === 'RECOVERING') {
        await this.stop(run.faultRunId, 'EXPIRED');
      } else if (run.expiresAt <= new Date().toISOString()) {
        await this.stop(run.faultRunId, 'EXPIRED');
      } else {
        this.schedule(run);
      }
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
    if (workerDrain.drained !== true) {
      return this.store.transition(
        run.faultRunId,
        ['RECOVERING'],
        'FAILED',
        {
          eventType: 'RECOVERY_FAILED',
          payload: { workerDrain },
          recoveryResult: { stopped: false, workerDrain },
          recoveryError: 'WORKER_DRAIN_INCOMPLETE',
          stopReason: 'RECOVERY_FAILED',
        },
      );
    }
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
    } catch {
      return this.store.transition(
        run.faultRunId,
        ['RECOVERING'],
        'FAILED',
        {
          eventType: 'RECOVERY_FAILED',
          payload: { workerDrain },
          recoveryResult: { stopped: false, workerDrain },
          recoveryError: 'TARGET_RELEASE_FAILED',
          stopReason: 'RECOVERY_FAILED',
        },
      );
    }
  }

  private async compensateAfterCreateFailure(run: FaultRunRecord): Promise<string | null> {
    await this.store.appendEvent(run.faultRunId, 'COMPENSATION_STARTED');
    try {
      await this.targetAdapter.compensate(run);
      await this.store.appendEvent(run.faultRunId, 'COMPENSATION_COMPLETED');
      return null;
    } catch {
      await this.store.appendEvent(run.faultRunId, 'COMPENSATION_FAILED', {
        failureCode: 'RECOVERY_COMPENSATION_FAILED',
      });
      return 'COMPENSATION_FAILED';
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
    if (!drain) return { registered: false, drained: false };
    try {
      return { registered: true, drained: true, result: asRecord(await drain()) };
    } catch {
      return { registered: true, drained: false };
    }
  }
}

function isTerminal(state: FaultRunRecord['state']): boolean {
  return state === 'RECOVERED' || state === 'STOPPED' || state === 'FAILED';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

let legacyFaultRunRecovery: LegacyFaultRunRecovery | null = null;

export function getLegacyFaultRunRecovery(): LegacyFaultRunRecovery {
  if (!legacyFaultRunRecovery) legacyFaultRunRecovery = new LegacyFaultRunRecovery();
  return legacyFaultRunRecovery;
}
