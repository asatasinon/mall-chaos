import { getGatewayClient } from '../lib/gateway-client';
import { appendFaultRunEvent, listActiveFaultRuns, type FaultRunRecord } from '../lib/fault-run-repository';
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
      run.scenario === 'PROMOTION_LOCK_CONTENTION'
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
    const requestIntervalMs = boundedInteger(run.parameters.requestIntervalMs, 0, 60_000, 100);
    const request = async (signal: AbortSignal) => {
      const observationPath = run.scenario === 'INVENTORY_TABLE_EXCLUSIVE'
        ? '/internal/gateway/inventory/availability'
        : '/internal/gateway/promotion/consistency';
      await this.gateway.postInternal(observationPath, {
        faultRunId: run.faultRunId,
        expiresAt: run.expiresAt,
        fencingToken: run.fencingToken,
        idempotencyKey: run.idempotencyKey,
      }, run.traceId ?? undefined, signal);
    };
    const worker = new ControlledExerciseWorker(run, { concurrency, requestIntervalMs, request });
    const promise = worker.start()
      .catch(async (error) => {
        await appendWorkerFailure(run, error);
      })
      .finally(async () => {
        await appendFaultRunEvent(run.faultRunId, 'SCENARIO_WORKER_DRAINED', worker.snapshot()).catch(() => undefined);
        this.workers.delete(run.faultRunId);
      });
    this.workers.set(run.faultRunId, { worker, promise });
  }
}

async function appendWorkerFailure(run: FaultRunRecord, error: unknown): Promise<void> {
  await appendFaultRunEvent(run.faultRunId, 'EXERCISE_WORKER_SETUP_FAILED', {
    error: error instanceof Error ? error.message : String(error),
  }).catch(() => undefined);
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
