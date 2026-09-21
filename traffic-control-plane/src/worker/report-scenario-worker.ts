import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { forwardAbortSignal, throwIfAborted } from '../lib/abort-signal';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import type { OwnedFaultRunDriver, OwnedRunHandle } from './fault-run-driver';
import {
  getGatewayClient,
  type CustomerRequestContext,
  type GatewayClient,
} from '../lib/gateway-client';
import {
  appendFaultRunEvent,
  listRunnableFaultRuns,
  type FaultRunRecord,
} from '../lib/fault-run-repository';
import { loadLifecycleAccounts } from '../lib/lifecycle-accounts';
import { env } from '../lib/env';
import { CustomerSessionManager } from './customer-session-manager';
import { normalizeFaultRunSummaryEventPayload } from '../lib/fault-run-event-contract';
import {
  getFaultRunDrainRegistry,
  type FaultRunDrainParticipant,
  type FaultRunDrainRegistry,
  type FaultRunWorkPermit,
} from './fault-run-drain-registry';

const log = pino({ name: 'report-scenario-worker' });

interface ReportScenarioWorkerDependencies {
  gateway: GatewayClient;
  listRunnableRuns: () => Promise<FaultRunRecord[]>;
  appendEvent: (faultRunId: string, eventType: string, payload?: unknown) => Promise<void>;
  loadAccounts: typeof loadLifecycleAccounts;
  drainRegistry: Pick<FaultRunDrainRegistry, 'register' | 'tryAcquire'>;
  safeRuntimeEnabled: boolean;
}

export class ReportScenarioWorker {
  private readonly gateway: GatewayClient;
  private readonly listRunnableRuns: ReportScenarioWorkerDependencies['listRunnableRuns'];
  private readonly appendEvent: ReportScenarioWorkerDependencies['appendEvent'];
  private readonly loadAccounts: ReportScenarioWorkerDependencies['loadAccounts'];
  private readonly drainRegistry: ReportScenarioWorkerDependencies['drainRegistry'];
  private readonly safeRuntimeEnabled: boolean;
  private readonly running = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly blockedRunIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;

  constructor(dependencies: Partial<ReportScenarioWorkerDependencies> = {}) {
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
    for (const controller of this.controllers.values()) controller.abort('CONTROL_PLANE_STOP');
    await Promise.allSettled([...this.running.values()]);
  }

  async startOwned(run: FaultRunRecord, fence: FaultRunOwnerFence): Promise<OwnedRunHandle> {
    const task = this.execute(run, fence.signal);
    return {
      stop: async () => {
        fence.lose('OWNER_DRAIN');
        try {
          await task;
          return { drained: true };
        } catch {
          return { drained: false, errorCode: 'REPORT_WORKER_FAILED' };
        }
      },
    };
  }

  private async scan(): Promise<void> {
    try {
      const activeRuns = await this.listRunnableRuns();
      if (this.stopping) return;
      const reportRuns = activeRuns.filter((run) =>
        run.state === 'ACTIVE'
          && Date.parse(run.expiresAt) > Date.now()
          && (run.scenario === 'BROWSE_REPORT_SQL' || run.scenario === 'ORDER_REPORT_SQL'));
      const activeIds = new Set(reportRuns.map((run) => run.faultRunId));
      for (const runId of this.blockedRunIds) {
        if (!activeIds.has(runId)) this.blockedRunIds.delete(runId);
      }
      for (const [runId, controller] of this.controllers) {
        if (!activeIds.has(runId)) controller.abort('RUN_STOPPED');
      }
      for (const run of reportRuns) {
        if (!this.running.has(run.faultRunId) && !this.blockedRunIds.has(run.faultRunId)) {
          this.startRun(run);
        }
      }
    } catch (error) {
      log.warn({ error }, 'Report run scan failed');
    }
  }

  private startRun(run: FaultRunRecord): void {
    if (this.stopping) return;
    const controller = new AbortController();
    const completion = deferredVoid();
    let unregisterParticipant = () => {};
    let permit: FaultRunWorkPermit | null = null;
    let removePermitAbortListener = () => {};
    if (this.safeRuntimeEnabled) {
      const participant: FaultRunDrainParticipant = {
        kind: 'REPORT',
        requestStop: () => controller.abort(),
        settled: () => completion.promise,
      };
      unregisterParticipant = this.drainRegistry.register(run.faultRunId, participant);
      permit = this.drainRegistry.tryAcquire(run.faultRunId, 'REPORT');
      if (!permit) {
        this.blockedRunIds.add(run.faultRunId);
        completion.resolve();
        unregisterParticipant();
        return;
      }
      removePermitAbortListener = forwardAbortSignal(permit.signal, controller);
    }

    this.controllers.set(run.faultRunId, controller);
    const task = this.execute(run, controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          log.warn({
            faultRunId: run.faultRunId,
            code: workerErrorCode(error),
          }, 'Report Worker execution failed');
        }
      })
      .finally(() => {
        this.controllers.delete(run.faultRunId);
        this.running.delete(run.faultRunId);
        removePermitAbortListener();
        permit?.complete();
        completion.resolve();
        unregisterParticipant();
      });
    this.running.set(run.faultRunId, task);
  }

  private async execute(run: FaultRunRecord, signal: AbortSignal): Promise<void> {
    let requests = 0;
    let successes = 0;
    let failures = 0;
    let timeouts = 0;
    let inFlight = 0;
    let totalLatencyMs = 0;
    let session: CustomerRequestContext | null = null;
    let sessionManager: CustomerSessionManager | null = null;
    try {
      throwIfAborted(signal);
      await this.appendEvent(
        run.faultRunId,
        'REPORT_WORKER_STARTED',
        normalizeFaultRunSummaryEventPayload('REPORT_WORKER_STARTED', { requestIntervalMs: 1000 }),
      );
      if (run.scenario === 'ORDER_REPORT_SQL') {
        const account = this.loadAccounts()
          .find((candidate) => candidate.enabled && candidate.expectedCustomerId !== 19);
        if (!account) throw new Error('REPORT_CUSTOMER_ACCOUNT_UNAVAILABLE');
        sessionManager = new CustomerSessionManager({ gateway: this.gateway, accounts: [account] });
        session = await sessionManager.openSession(
          run.faultRunId,
          randomUUID(),
          run.traceId ?? randomUUID(),
          { signal },
        );
      }
      while (!signal.aborted && Date.now() < new Date(run.expiresAt).getTime()) {
        if (signal.aborted) break;
        const startedAt = Date.now();
        requests++;
        inFlight++;
        try {
          if (run.scenario === 'BROWSE_REPORT_SQL') {
            await this.gateway.get('/api/reports/product-browse', undefined, {
              traceId: run.traceId ?? undefined,
              signal,
            });
          } else if (session) {
            await this.gateway.customerGet('/api/reports/order-query', undefined, session, signal);
          }
          successes++;
        } catch (error) {
          if (signal.aborted) {
            requests--;
            break;
          }
          if (error instanceof Error && error.name === 'TimeoutError') timeouts++;
          failures++;
        } finally {
          inFlight--;
          if (!signal.aborted) totalLatencyMs += Date.now() - startedAt;
        }
        await abortableDelay(1000, signal);
      }
    } finally {
      if (session && sessionManager) {
        await sessionManager.closeSession(session.lifecycleId, session.traceId, signal).catch(() => undefined);
      }
      await this.appendEvent(
        run.faultRunId,
        'REPORT_WORKER_STOPPED',
        normalizeFaultRunSummaryEventPayload('REPORT_WORKER_STOPPED', {
          requests,
          successes,
          failures,
          timeouts,
          inFlight,
          averageLatencyMs: requests === 0 ? 0 : Math.round(totalLatencyMs / requests),
          reason: signal.aborted ? 'RUN_STOPPED' : 'EXPIRED_OR_STOPPED',
        }),
      ).catch(() => undefined);
    }
  }
}

export class ReportScenarioFaultRunDriver implements OwnedFaultRunDriver {
  readonly name = 'REPORT_SCENARIO_WORKER';

  constructor(private readonly worker: ReportScenarioWorker = new ReportScenarioWorker()) {}

  supports(run: FaultRunRecord): boolean {
    return run.scenario === 'BROWSE_REPORT_SQL' || run.scenario === 'ORDER_REPORT_SQL';
  }

  start(input: { run: FaultRunRecord; fence: FaultRunOwnerFence }): Promise<OwnedRunHandle> {
    return this.worker.startOwned(input.run, input.fence);
  }
}

let worker: ReportScenarioWorker | null = null;

export function getReportScenarioWorker(): ReportScenarioWorker {
  if (!worker) worker = new ReportScenarioWorker();
  return worker;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function workerErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(error.message)
    ? error.message
    : 'REPORT_WORKER_FAILED';
}
