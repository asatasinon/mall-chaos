import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { getGatewayClient, type CustomerRequestContext } from '../lib/gateway-client';
import { appendFaultRunEvent, listActiveFaultRuns, type FaultRunRecord } from '../lib/fault-run-repository';
import { loadLifecycleAccounts } from '../lib/lifecycle-accounts';
import { CustomerSessionManager } from './customer-session-manager';

const log = pino({ name: 'report-exercise-worker' });

export class ReportExerciseWorker {
  private readonly gateway = getGatewayClient();
  private readonly running = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    void this.scan();
    this.timer = setInterval(() => { void this.scan(); }, 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.running.values()]);
  }

  private async scan(): Promise<void> {
    try {
      const activeRuns = await listActiveFaultRuns();
      const reportRuns = activeRuns.filter((run) =>
        run.scenario === 'BROWSE_REPORT_SQL' || run.scenario === 'ORDER_REPORT_SQL');
      for (const run of reportRuns) {
        if (!this.running.has(run.faultRunId)) {
          const task = this.execute(run).finally(() => this.running.delete(run.faultRunId));
          this.running.set(run.faultRunId, task);
        }
      }
    } catch (error) {
      log.warn({ error }, 'Report run scan failed');
    }
  }

  private async execute(run: FaultRunRecord): Promise<void> {
    await appendFaultRunEvent(run.faultRunId, 'REPORT_WORKER_STARTED', {
      scenario: run.scenario,
      targetOperation: run.targetOperation,
    });
    let requests = 0;
    let successes = 0;
    let failures = 0;
    let totalLatencyMs = 0;
    let session: CustomerRequestContext | null = null;
    let sessionManager: CustomerSessionManager | null = null;
    try {
      if (run.scenario === 'ORDER_REPORT_SQL') {
        const account = loadLifecycleAccounts().find((candidate) => candidate.enabled && candidate.expectedCustomerId !== 19);
        if (!account) throw new Error('REPORT_CUSTOMER_ACCOUNT_UNAVAILABLE');
        sessionManager = new CustomerSessionManager({ gateway: this.gateway, accounts: [account] });
        session = await sessionManager.openSession(run.faultRunId, randomUUID(), run.traceId ?? randomUUID());
      }
      while (Date.now() < new Date(run.expiresAt).getTime()) {
        const startedAt = Date.now();
        requests++;
        try {
          if (run.scenario === 'BROWSE_REPORT_SQL') {
            await this.gateway.get('/api/products/browse-report', undefined, { traceId: run.traceId ?? undefined });
          } else if (session) {
            await this.gateway.customerGet('/api/orders/query-report', undefined, session);
          }
          successes++;
        } catch (error) {
          failures++;
          await appendFaultRunEvent(run.faultRunId, 'REPORT_REQUEST_FAILED', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        const latencyMs = Date.now() - startedAt;
        totalLatencyMs += latencyMs;
        await appendFaultRunEvent(run.faultRunId, 'REPORT_REQUEST', {
          requests,
          successes,
          failures,
          latencyMs,
          inFlight: 0,
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } finally {
      if (session && sessionManager) await sessionManager.closeSession(session.lifecycleId, session.traceId).catch(() => undefined);
      await appendFaultRunEvent(run.faultRunId, 'REPORT_WORKER_STOPPED', {
        requests,
        successes,
        failures,
        averageLatencyMs: requests === 0 ? 0 : Math.round(totalLatencyMs / requests),
        reason: 'EXPIRED_OR_STOPPED',
      }).catch(() => undefined);
    }
  }
}

let worker: ReportExerciseWorker | null = null;

export function getReportExerciseWorker(): ReportExerciseWorker {
  if (!worker) worker = new ReportExerciseWorker();
  return worker;
}
