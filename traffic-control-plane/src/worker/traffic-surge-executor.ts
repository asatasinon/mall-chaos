import { randomUUID } from 'node:crypto';
import { appendFaultRunEvent, listActiveFaultRuns, type FaultRunRecord } from '../lib/fault-run-repository';
import { getGatewayClient, type CustomerRequestContext } from '../lib/gateway-client';
import { getTrafficExerciseTarget } from '../lib/fault-run-targets';
import { loadLifecycleAccounts } from '../lib/lifecycle-accounts';
import { CustomerSessionManager } from './customer-session-manager';
import { ControlledExerciseWorker } from './controlled-exercise-worker';

export class TrafficSurgeExecutor {
  private readonly gateway = getGatewayClient();
  private readonly workers = new Map<string, { worker: ControlledExerciseWorker; promise: Promise<void> }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    void this.scan();
    this.timer = setInterval(() => { void this.scan(); }, 1000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([...this.workers.values()].map(({ worker }) => worker.stop('CONTROL_PLANE_STOP')));
  }

  private async scan(): Promise<void> {
    const active = await listActiveFaultRuns();
    const eligible = active.filter((run) => run.scenario === 'BROWSE_SURGE' || run.scenario === 'ORDER_QUERY_SURGE');
    const activeIds = new Set(eligible.map((run) => run.faultRunId));
    for (const [runId, current] of this.workers) {
      if (!activeIds.has(runId)) void current.worker.stop('RUN_STOPPED');
    }
    for (const run of eligible) {
      if (!this.workers.has(run.faultRunId)) this.startRun(run);
    }
  }

  private startRun(run: FaultRunRecord): void {
    const target = getTrafficExerciseTarget(run.scenario);
    const concurrency = boundedInteger(run.parameters.concurrency, 1, 32, 1);
    const requestIntervalMs = boundedInteger(run.parameters.requestIntervalMs, 0, 60_000, 1000);
    const pageSize = boundedInteger(run.parameters.pageSize, 1, 50, 20);
    let session: CustomerRequestContext | null = null;
    let sessionManager: CustomerSessionManager | null = null;
    const setup = async () => {
      if (run.scenario === 'ORDER_QUERY_SURGE') {
        const account = loadLifecycleAccounts().find((candidate) => candidate.enabled && candidate.expectedCustomerId !== 19);
        if (!account) throw new Error('SURGE_CUSTOMER_ACCOUNT_UNAVAILABLE');
        sessionManager = new CustomerSessionManager({ gateway: this.gateway, accounts: [account] });
        session = await sessionManager.openSession(run.faultRunId, randomUUID(), run.traceId ?? randomUUID());
      }
    };
    const request = async (signal: AbortSignal) => {
      if (run.scenario === 'BROWSE_SURGE') {
        await this.gateway.get(target.path, { page: '0', size: String(pageSize), sort: 'latest' }, { traceId: run.traceId ?? undefined, signal });
      } else if (session) {
        await this.gateway.customerGet(target.path, { page: '0', size: String(pageSize) }, session, signal);
      }
    };
    const worker = new ControlledExerciseWorker(run, { concurrency, requestIntervalMs, request });
    const promise = setup()
      .then(async () => {
        if (this.stopping) {
          await worker.stop('CONTROL_PLANE_STOP');
          return;
        }
        await worker.start();
      })
      .catch(async (error) => {
        await appendWorkerFailure(run, error);
      })
      .finally(async () => {
        if (session && sessionManager) await sessionManager.closeSession(session.lifecycleId, session.traceId).catch(() => undefined);
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

let executor: TrafficSurgeExecutor | null = null;

export function getTrafficSurgeExecutor(): TrafficSurgeExecutor {
  if (!executor) executor = new TrafficSurgeExecutor();
  return executor;
}
