import { randomUUID } from 'node:crypto';
import { forwardAbortSignal, throwIfAborted } from '../lib/abort-signal';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import {
  appendFaultRunEvent,
  listRunnableFaultRuns,
  type FaultRunRecord,
} from '../lib/fault-run-repository';
import { TRAFFIC_SURGE_MAX_PAGE_SIZE } from '../lib/fault-run-catalog';
import { getGatewayClient, type CustomerRequestContext } from '../lib/gateway-client';
import { getTrafficScenarioTarget } from '../lib/fault-run-targets';
import { normalizeFaultRunSummaryEventPayload } from '../lib/fault-run-event-contract';
import { getLegacyFaultRunRecovery } from '../lib/legacy-fault-run-recovery';
import { loadLifecycleAccounts } from '../lib/lifecycle-accounts';
import { env } from '../lib/env';
import { CustomerSessionManager } from './customer-session-manager';
import { ControlledScenarioWorker } from './controlled-scenario-worker';
import type { OwnedFaultRunDriver, OwnedRunHandle } from './fault-run-driver';
import {
  getFaultRunDrainRegistry,
  type FaultRunDrainParticipant,
  type FaultRunDrainRegistry,
  type FaultRunWorkPermit,
} from './fault-run-drain-registry';

interface TrafficSurgeExecutorDependencies {
  gateway: ReturnType<typeof getGatewayClient>;
  listRunnableRuns: () => Promise<FaultRunRecord[]>;
  appendEvent: (faultRunId: string, eventType: string, payload?: unknown) => Promise<void>;
  loadAccounts: typeof loadLifecycleAccounts;
  drainRegistry: Pick<FaultRunDrainRegistry, 'register' | 'tryAcquire'>;
  safeRuntimeEnabled: boolean;
}

export class TrafficSurgeExecutor {
  private readonly gateway: ReturnType<typeof getGatewayClient>;
  private readonly listRunnableRuns: TrafficSurgeExecutorDependencies['listRunnableRuns'];
  private readonly appendEvent: TrafficSurgeExecutorDependencies['appendEvent'];
  private readonly loadAccounts: TrafficSurgeExecutorDependencies['loadAccounts'];
  private readonly drainRegistry: TrafficSurgeExecutorDependencies['drainRegistry'];
  private readonly safeRuntimeEnabled: boolean;
  private readonly workers = new Map<string, { worker: ControlledScenarioWorker; promise: Promise<void> }>();
  private readonly blockedRunIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;

  constructor(dependencies: Partial<TrafficSurgeExecutorDependencies> = {}) {
    this.gateway = dependencies.gateway ?? getGatewayClient();
    this.listRunnableRuns = dependencies.listRunnableRuns ?? listRunnableFaultRuns;
    this.appendEvent = dependencies.appendEvent ?? appendFaultRunEvent;
    this.loadAccounts = dependencies.loadAccounts ?? loadLifecycleAccounts;
    this.drainRegistry = dependencies.drainRegistry ?? getFaultRunDrainRegistry();
    this.safeRuntimeEnabled = dependencies.safeRuntimeEnabled ?? env.FAULT_RUN_SAFE_RUNTIME_ENABLED;
  }

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
    this.blockedRunIds.clear();
    const activeWorkers = [...this.workers.values()];
    await Promise.all(activeWorkers.map(({ worker }) => worker.stop('CONTROL_PLANE_STOP')));
    await Promise.allSettled(activeWorkers.map(({ promise }) => promise));
  }

  async startOwned(run: FaultRunRecord, fence: FaultRunOwnerFence): Promise<OwnedRunHandle> {
    const target = getTrafficScenarioTarget(run.scenario);
    const concurrency = boundedInteger(run.parameters.concurrency, 1, undefined, 1);
    const requestIntervalMs = boundedInteger(run.parameters.requestIntervalMs, 0, 60_000, 100);
    const pageSize = boundedInteger(run.parameters.pageSize, 1, TRAFFIC_SURGE_MAX_PAGE_SIZE, 20);
    const controller = new AbortController();
    const removeFenceAbortListener = forwardAbortSignal(fence.signal, controller);
    let session: CustomerRequestContext | null = null;
    let sessionManager: CustomerSessionManager | null = null;
    let setupFailed = false;
    const request = async (signal: AbortSignal) => {
      throwIfAborted(signal);
      if (run.scenario === 'BROWSE_SURGE') {
        await this.gateway.get(
          target.path,
          { page: '0', size: String(pageSize), sort: 'latest' },
          { traceId: run.traceId ?? undefined, signal },
        );
      } else if (session) {
        await this.gateway.customerGet(
          target.path,
          { page: '0', size: String(pageSize) },
          session,
          signal,
        );
      }
    };
    const worker = new ControlledScenarioWorker(
      run,
      { concurrency, requestIntervalMs, request, signal: controller.signal },
    );
    const task = (async () => {
      try {
        throwIfAborted(controller.signal);
        if (run.scenario === 'ORDER_QUERY_SURGE') {
          const account = this.loadAccounts()
            .find((candidate) => candidate.enabled && candidate.expectedCustomerId !== 19);
          if (!account) throw new Error('SURGE_CUSTOMER_ACCOUNT_UNAVAILABLE');
          sessionManager = new CustomerSessionManager({ gateway: this.gateway, accounts: [account] });
          session = await sessionManager.openSession(
            run.faultRunId,
            randomUUID(),
            run.traceId ?? randomUUID(),
            { signal: controller.signal },
          );
        }
        await worker.start();
      } catch (error) {
        if (!controller.signal.aborted) {
          setupFailed = true;
          await appendWorkerFailure(this.appendEvent, run, error);
        }
      }
    })();
    return {
      stop: async ({ reason }) => {
        controller.abort(reason);
        const stats = await worker.stop(reason);
        await task;
        if (session && sessionManager) {
          await sessionManager.closeSession(session.lifecycleId, session.traceId, controller.signal)
            .catch(() => undefined);
        }
        removeFenceAbortListener();
        return {
          drained: !setupFailed && stats.inFlight === 0,
          inFlight: stats.inFlight,
          ...(setupFailed ? { errorCode: 'SURGE_WORKER_SETUP_FAILED' } : {}),
        };
      },
    };
  }

  private async scan(): Promise<void> {
    const active = await this.listRunnableRuns();
    if (this.stopping) return;
    const eligible = active.filter((run) => run.state === 'ACTIVE'
      && Date.parse(run.expiresAt) > Date.now()
      && (run.scenario === 'BROWSE_SURGE' || run.scenario === 'ORDER_QUERY_SURGE'));
    const activeIds = new Set(eligible.map((run) => run.faultRunId));
    for (const runId of this.blockedRunIds) {
      if (!activeIds.has(runId)) this.blockedRunIds.delete(runId);
    }

    for (const [runId, current] of this.workers) {
      if (!activeIds.has(runId)) void current.worker.stop('RUN_STOPPED');
    }
    for (const run of eligible) {
      if (!this.workers.has(run.faultRunId) && !this.blockedRunIds.has(run.faultRunId)) {
        this.startRun(run);
      }
    }
  }

  private startRun(run: FaultRunRecord): void {
    if (this.stopping) return;
    const target = getTrafficScenarioTarget(run.scenario);
    const concurrency = boundedInteger(run.parameters.concurrency, 1, undefined, 1);
    const requestIntervalMs = boundedInteger(run.parameters.requestIntervalMs, 0, 60_000, 100);
    const pageSize = boundedInteger(run.parameters.pageSize, 1, TRAFFIC_SURGE_MAX_PAGE_SIZE, 20);
    const runController = new AbortController();
    const completion = deferredVoid();
    let controlledWorker: ControlledScenarioWorker | null = null;
    let unregisterParticipant = () => {};
    let permit: FaultRunWorkPermit | null = null;
    let removePermitAbortListener = () => {};
    if (this.safeRuntimeEnabled) {
      const participant: FaultRunDrainParticipant = {
        kind: 'SURGE',
        requestStop: () => {
          runController.abort();
          return controlledWorker?.stop('COORDINATOR_RECOVERY').then(() => undefined);
        },
        settled: () => completion.promise,
      };
      unregisterParticipant = this.drainRegistry.register(run.faultRunId, participant);
      permit = this.drainRegistry.tryAcquire(run.faultRunId, 'SURGE');
      if (!permit) {
        this.blockedRunIds.add(run.faultRunId);
        completion.resolve();
        unregisterParticipant();
        return;
      }
      removePermitAbortListener = forwardAbortSignal(permit.signal, runController);
    }
    let session: CustomerRequestContext | null = null;
    let sessionManager: CustomerSessionManager | null = null;
    const closeSession = async () => {
      if (session && sessionManager) {
        await sessionManager.closeSession(session.lifecycleId, session.traceId, runController.signal)
          .catch(() => undefined);
      }
    };
    const completeAdmission = () => {
      removePermitAbortListener();
      permit?.complete();
      completion.resolve();
      unregisterParticipant();
    };
    const request = async (signal: AbortSignal) => {
      if (run.scenario === 'BROWSE_SURGE') {
        await this.gateway.get(target.path, { page: '0', size: String(pageSize), sort: 'latest' }, { traceId: run.traceId ?? undefined, signal });
      } else if (session) {
        await this.gateway.customerGet(target.path, { page: '0', size: String(pageSize) }, session, signal);
      }
    };
    const worker = new ControlledScenarioWorker(
      run,
      {
        concurrency,
        requestIntervalMs,
        request,
        signal: runController.signal,
      },
      this.appendEvent,
    );
    controlledWorker = worker;
    const unregisterDrain = this.safeRuntimeEnabled
      ? () => {}
      : getLegacyFaultRunRecovery().registerRunDrain(
        run.faultRunId,
        () => worker.stop('COORDINATOR_RECOVERY'),
      );
    const promise = (async () => {
      try {
        throwIfAborted(runController.signal);
        if (run.scenario === 'ORDER_QUERY_SURGE') {
          const account = this.loadAccounts()
            .find((candidate) => candidate.enabled && candidate.expectedCustomerId !== 19);
          if (!account) throw new Error('SURGE_CUSTOMER_ACCOUNT_UNAVAILABLE');
          sessionManager = new CustomerSessionManager({ gateway: this.gateway, accounts: [account] });
          session = await sessionManager.openSession(
            run.faultRunId,
            randomUUID(),
            run.traceId ?? randomUUID(),
            { signal: runController.signal },
          );
        }
        if (this.stopping || runController.signal.aborted) return;
        await worker.start();
      } catch (error) {
        if (!runController.signal.aborted) {
          await appendWorkerFailure(this.appendEvent, run, error);
        }
      } finally {
        unregisterDrain();
        await this.appendEvent(
          run.faultRunId,
          'SCENARIO_WORKER_DRAINED',
          normalizeFaultRunSummaryEventPayload('SCENARIO_WORKER_DRAINED', worker.snapshot()),
        ).catch(() => undefined);
        await closeSession();
        this.workers.delete(run.faultRunId);
        completeAdmission();
      }
    })();
    this.workers.set(run.faultRunId, { worker, promise });
  }
}

export class TrafficSurgeFaultRunDriver implements OwnedFaultRunDriver {
  readonly name = 'TRAFFIC_SURGE_EXECUTOR';

  constructor(private readonly executor: TrafficSurgeExecutor = new TrafficSurgeExecutor()) {}

  supports(run: FaultRunRecord): boolean {
    return run.scenario === 'BROWSE_SURGE' || run.scenario === 'ORDER_QUERY_SURGE';
  }

  start(input: { run: FaultRunRecord; fence: FaultRunOwnerFence }): Promise<OwnedRunHandle> {
    return this.executor.startOwned(input.run, input.fence);
  }
}

async function appendWorkerFailure(
  appendEvent: TrafficSurgeExecutorDependencies['appendEvent'],
  run: FaultRunRecord,
  error: unknown,
): Promise<void> {
  await appendEvent(
    run.faultRunId,
    'SCENARIO_WORKER_SETUP_FAILED',
    normalizeFaultRunSummaryEventPayload('SCENARIO_WORKER_SETUP_FAILED', {
      failureCode: 'WORKER_SETUP_FAILED',
      error: error instanceof Error ? error.message : String(error),
    }),
  ).catch(() => undefined);
}

function boundedInteger(value: number | string | undefined, min: number, max: number | undefined, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(numeric) && numeric >= min && (max === undefined || numeric <= max) ? numeric : fallback;
}

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let executor: TrafficSurgeExecutor | null = null;

export function getTrafficSurgeExecutor(): TrafficSurgeExecutor {
  if (!executor) executor = new TrafficSurgeExecutor();
  return executor;
}
