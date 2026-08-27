import { randomUUID } from 'node:crypto';
import { getGatewayClient } from '../lib/gateway-client';
import { createFaultRunContext } from '../lib/fault-run-context';
import { appendFaultRunEvent, listActiveFaultRuns, type FaultRunRecord } from '../lib/fault-run-repository';
import { loadExerciseAccounts } from '../lib/exercise-accounts';
import { CustomerSessionManager } from './customer-session-manager';
import { ControlledExerciseWorker } from './controlled-exercise-worker';

export class ScenarioExerciseWorkers {
  private readonly gateway = getGatewayClient();
  private readonly workers = new Map<string, { worker: ControlledExerciseWorker; promise: Promise<void> }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    void this.scan();
    this.timer = setInterval(() => { void this.scan(); }, 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([...this.workers.values()].map(({ worker }) => worker.stop('CONTROL_PLANE_STOP')));
  }

  private async scan(): Promise<void> {
    const active = await listActiveFaultRuns();
    const eligible = active.filter((run) =>
      run.scenario === 'CART_REDIS_LARGE_VALUE'
      || run.scenario === 'PROMOTION_LOCK_CONTENTION'
      || run.scenario === 'INVENTORY_TABLE_EXCLUSIVE');
    const activeIds = new Set(eligible.map((run) => run.faultRunId));
    for (const [runId, current] of this.workers) {
      if (!activeIds.has(runId)) void current.worker.stop('RUN_STOPPED');
    }
    for (const run of eligible) {
      if (!this.workers.has(run.faultRunId)) this.startRun(run);
    }
  }

  private startRun(run: FaultRunRecord): void {
    const concurrency = boundedInteger(run.parameters.concurrency, 1, 32, 1);
    const requestIntervalMs = boundedInteger(run.parameters.requestIntervalMs, 0, 60_000, 1000);
    let sessionManager: CustomerSessionManager | null = null;
    let session: import('../lib/gateway-client').CustomerRequestContext | null = null;
    const setup = async () => {
      if (run.scenario !== 'CART_REDIS_LARGE_VALUE') return;
      const sam = loadExerciseAccounts().find((candidate) => candidate.expectedCustomerId === 19);
      if (!sam) throw new Error('SAM_EXERCISE_ACCOUNT_UNAVAILABLE');
      sessionManager = new CustomerSessionManager({
        gateway: this.gateway,
        accounts: [sam],
      });
      session = await sessionManager.openSession(
        run.faultRunId,
        randomUUID(),
        run.traceId ?? randomUUID(),
        { faultRunContext: createFaultRunContext(run), faultRunScenario: run.scenario },
      );
    };
    const request = async (signal: AbortSignal) => {
      if (run.scenario === 'CART_REDIS_LARGE_VALUE' && session) {
        await this.gateway.customerPost('/api/cart/items', {
          sku: 'SKU-001',
          quantity: 1,
          operationId: `${run.faultRunId}:${randomUUID()}`,
        }, session, signal);
      } else {
        await this.gateway.postInternal('/internal/gateway/fault-runs/probe', {
          faultRunId: run.faultRunId,
          scenario: run.scenario,
          operation: run.targetOperation,
          parameters: run.parameters,
          expiresAt: run.expiresAt,
          fencingToken: run.fencingToken,
          idempotencyKey: run.idempotencyKey,
        }, run.traceId ?? undefined, signal);
      }
    };
    const worker = new ControlledExerciseWorker(run, { concurrency, requestIntervalMs, request });
    const promise = setup()
      .then(() => worker.start())
      .finally(async () => {
        if (session && sessionManager) await sessionManager.closeSession(session.lifecycleId, session.traceId).catch(() => undefined);
        await appendFaultRunEvent(run.faultRunId, 'SCENARIO_WORKER_DRAINED', worker.snapshot()).catch(() => undefined);
        this.workers.delete(run.faultRunId);
      });
    this.workers.set(run.faultRunId, { worker, promise });
  }
}

function boundedInteger(value: number | string | undefined, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : fallback;
}

let workers: ScenarioExerciseWorkers | null = null;

export function getScenarioExerciseWorkers(): ScenarioExerciseWorkers {
  if (!workers) workers = new ScenarioExerciseWorkers();
  return workers;
}
