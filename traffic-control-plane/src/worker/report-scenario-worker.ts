import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { getGatewayClient, type CustomerRequestContext } from '../lib/gateway-client';
import { appendFaultRunEvent, listActiveFaultRuns, type FaultRunRecord } from '../lib/fault-run-repository';
import { loadLifecycleAccounts } from '../lib/lifecycle-accounts';
import { CustomerSessionManager } from './customer-session-manager';
import { normalizeFaultRunSummaryEventPayload } from '../lib/fault-run-event-contract';

const log = pino({ name: 'report-scenario-worker' });

export class ReportScenarioWorker {
  private readonly gateway = getGatewayClient();
  private readonly running = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    void this.scan();
    this.timer = setInterval(() => { void this.scan(); }, 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const controller of this.controllers.values()) controller.abort('CONTROL_PLANE_STOP');
    await Promise.allSettled([...this.running.values()]);
  }

  private async scan(): Promise<void> {
    try {
      const activeRuns = await listActiveFaultRuns();
      const reportRuns = activeRuns.filter((run) =>
        run.scenario === 'BROWSE_REPORT_SQL' || run.scenario === 'ORDER_REPORT_SQL');
      const activeIds = new Set(reportRuns.map((run) => run.faultRunId));
      for (const [runId, controller] of this.controllers) {
        if (!activeIds.has(runId)) controller.abort('RUN_STOPPED');
      }
      for (const run of reportRuns) {
        if (!this.running.has(run.faultRunId)) {
          const controller = new AbortController();
          this.controllers.set(run.faultRunId, controller);
          const task = this.execute(run, controller.signal).finally(() => {
            this.controllers.delete(run.faultRunId);
            this.running.delete(run.faultRunId);
          });
          this.running.set(run.faultRunId, task);
        }
      }
    } catch (error) {
      log.warn({ error }, 'Report run scan failed');
    }
  }

  private async execute(run: FaultRunRecord, signal: AbortSignal): Promise<void> {
    let requests = 0;
    let successes = 0;
    let failures = 0;
    let totalLatencyMs = 0;
    let session: CustomerRequestContext | null = null;
    let sessionManager: CustomerSessionManager | null = null;
    try {
      await appendFaultRunEvent(
        run.faultRunId,
        'REPORT_WORKER_STARTED',
        normalizeFaultRunSummaryEventPayload('REPORT_WORKER_STARTED', { requestIntervalMs: 1000 }),
      );
      if (run.scenario === 'ORDER_REPORT_SQL') {
        const account = loadLifecycleAccounts().find((candidate) => candidate.enabled && candidate.expectedCustomerId !== 19);
        if (!account) throw new Error('REPORT_CUSTOMER_ACCOUNT_UNAVAILABLE');
        sessionManager = new CustomerSessionManager({ gateway: this.gateway, accounts: [account] });
        session = await sessionManager.openSession(run.faultRunId, randomUUID(), run.traceId ?? randomUUID());
      }
      while (!signal.aborted && Date.now() < new Date(run.expiresAt).getTime()) {
        if (signal.aborted) break;
        const startedAt = Date.now();
        requests++;
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
        } catch {
          if (signal.aborted) {
            requests--;
            break;
          }
          failures++;
        }
        const latencyMs = Date.now() - startedAt;
        totalLatencyMs += latencyMs;
        await abortableDelay(1000, signal);
      }
    } finally {
      if (session && sessionManager) await sessionManager.closeSession(session.lifecycleId, session.traceId).catch(() => undefined);
      await appendFaultRunEvent(
        run.faultRunId,
        'REPORT_WORKER_STOPPED',
        normalizeFaultRunSummaryEventPayload('REPORT_WORKER_STOPPED', {
          requests,
          successes,
          failures,
          averageLatencyMs: requests === 0 ? 0 : Math.round(totalLatencyMs / requests),
          reason: signal.aborted ? 'RUN_STOPPED' : 'EXPIRED_OR_STOPPED',
        }),
      ).catch(() => undefined);
    }
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
