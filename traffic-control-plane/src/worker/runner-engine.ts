import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { loadRunnerConfigFromDb, RunnerConfig } from '../lib/runner-config';
import { completeTrafficRun, ensureTrafficRun } from '../lib/runner-persistence';
import { appendFaultRunEvent, loadActiveFaultRun } from '../lib/fault-run-repository';
import { createFaultRunContext } from '../lib/fault-run-context';
import { getFaultRunCoordinator } from '../lib/fault-run-coordinator';
import { getRunnerControlState, pushActivity, setRunnerStatus } from '../lib/runtime-state';
import {
  RunnerActionResult,
  TrafficActionOrchestrator,
} from './traffic-action-orchestrator';

const log = pino({ name: 'runner-engine' });

export class RunnerEngine {
  private config: RunnerConfig;
  private paused = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private lastConfigCheckAt = 0;
  private trafficRunId: string | null = null;
  private trafficRunPersistence: Promise<void> | null = null;
  private lifecycleAbortController: AbortController | null = null;
  private lifecyclePromise: Promise<void> | null = null;
  private currentLifecycleId: string | null = null;
  private lastLifecycleStartedAt: number | null = null;
  private lastLifecycleCompletedAt: number | null = null;
  private lifecycleStartedCount = 0;
  private lifecycleCompletedCount = 0;
  private lifecycleNoopCount = 0;
  private lifecycleFailedCount = 0;
  private lifecycleInterruptedCount = 0;
  private intervalSamples: number[] = [];
  private previousLifecycleStartedAt: number | null = null;
  private paymentSuccessCount = 0;
  private cancelCount = 0;
  private couponRequestedCount = 0;
  private couponAppliedCount = 0;
  private addressCreatedCount = 0;
  private cartReusedCount = 0;
  private pendingPaymentRetainedCount = 0;
  private readonly orchestrator = new TrafficActionOrchestrator();

  constructor() {
    this.config = {
      version: 1,
      enabled: true,
      trafficMode: 'CUSTOMER_LIFECYCLE',
      lifecycleIntervalSec: 60,
      maxItems: 3,
      maxItemQuantity: 3,
      successfulPaymentRatio: 1,
      couponUsageRatio: 0,
      backgroundActionsEnabled: false,
    };
  }

  async loadConfigFromDb(): Promise<void> {
    this.config = await loadRunnerConfigFromDb();
    log.info({ config: this.config }, 'Config loaded from DB');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.trafficRunId = uuidv4();
    const trafficRunId = this.trafficRunId;
    this.trafficRunPersistence = ensureTrafficRun(trafficRunId, this.config.version).catch((error) => {
      log.error({ error }, 'Failed to persist runner start');
    });
    this.scheduleTick();
    void this.refreshAndPublishStatus().catch((error) => {
      log.error({ error }, 'Failed to publish initial runner status');
    });
    this.statusTimer = setInterval(() => {
      void this.refreshAndPublishStatus().catch((error) => {
        log.error({ error }, 'Failed to publish runner heartbeat');
      });
    }, 5000);
    log.info({ trafficRunId }, 'Runner engine started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    this.lifecycleAbortController?.abort();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const trafficRunId = this.trafficRunId;
    this.trafficRunId = null;
    const lifecycleDrain = this.lifecyclePromise ?? Promise.resolve();
    await lifecycleDrain;
    if (trafficRunId) {
      await (this.trafficRunPersistence ?? Promise.resolve());
      await completeTrafficRun(trafficRunId).catch((error) => {
        log.error({ error, trafficRunId }, 'Failed to persist runner stop');
      });
    }
    this.trafficRunPersistence = null;
    await this.publishStatus();
    log.info({ trafficRunId }, 'Runner engine stopped');
  }

  pause(): void {
    this.paused = true;
    log.info('Runner paused');
  }

  resume(): void {
    this.paused = false;
    log.info('Runner resumed');
  }

  getStatus() {
    return {
      running: this.running && this.config.enabled && !this.paused,
      enabled: this.config.enabled,
      paused: this.paused,
      trafficMode: this.config.trafficMode,
      lifecycleIntervalSec: this.config.lifecycleIntervalSec,
      configVersion: this.config.version,
      trafficRunId: this.trafficRunId,
      currentLifecycleId: this.currentLifecycleId,
      lastLifecycleStartedAt: this.lastLifecycleStartedAt
        ? new Date(this.lastLifecycleStartedAt).toISOString() : null,
      lastLifecycleCompletedAt: this.lastLifecycleCompletedAt
        ? new Date(this.lastLifecycleCompletedAt).toISOString() : null,
      lifecycleStartedCount: this.lifecycleStartedCount,
      lifecycleCompletedCount: this.lifecycleCompletedCount,
      lifecycleNoopCount: this.lifecycleNoopCount,
      lifecycleFailedCount: this.lifecycleFailedCount,
      lifecycleInterruptedCount: this.lifecycleInterruptedCount,
      averageIntervalSec: this.intervalSamples.length > 0
        ? +(this.intervalSamples.reduce((sum, value) => sum + value, 0) / this.intervalSamples.length).toFixed(2)
        : null,
      paymentSuccessCount: this.paymentSuccessCount,
      cancelCount: this.cancelCount,
      couponRequestedCount: this.couponRequestedCount,
      couponAppliedCount: this.couponAppliedCount,
      addressCreatedCount: this.addressCreatedCount,
      cartReusedCount: this.cartReusedCount,
      pendingPaymentRetainedCount: this.pendingPaymentRetainedCount,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── Private ──

  private scheduleTick(): void {
    if (!this.running) return;
    const delayMs = Math.max(this.config.lifecycleIntervalSec * 1000, 1000);
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (error) {
        log.error({ error }, 'Runner tick failed');
      }
      this.scheduleTick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    await this.refreshControlState();
    await this.refreshConfigIfNeeded();
    await this.publishStatus();

    if (!this.config.enabled || this.paused) return;
    if (!this.trafficRunId) return;
    const t0 = Date.now();
    const trafficRunId = this.trafficRunId;
    if (this.trafficRunPersistence) await this.trafficRunPersistence;
    const lifecycleAbortController = new AbortController();
    this.lifecycleAbortController = lifecycleAbortController;
    this.lifecycleStartedCount++;
    this.lastLifecycleStartedAt = t0;
    this.currentLifecycleId = null;
    const activeFaultRun = await loadActiveFaultRun();
    const runnerFaultRun = activeFaultRun
      && (activeFaultRun.scenario === 'NOTIFICATION_HEAP_PRESSURE'
        || activeFaultRun.scenario === 'NOTIFICATION_STORAGE_APPEND'
        || activeFaultRun.scenario === 'PSP_PROVIDER_OUTCOME')
      ? activeFaultRun
      : null;
    this.lifecyclePromise = this.orchestrator.executeLifecycle(trafficRunId, {
        maxItems: this.config.maxItems,
        maxItemQuantity: this.config.maxItemQuantity,
        paymentSuccessRatio: this.config.successfulPaymentRatio,
        couponUsageRatio: this.config.couponUsageRatio,
      }, {
        signal: lifecycleAbortController.signal,
        ...(runnerFaultRun ? {
          faultRunContext: createFaultRunContext(runnerFaultRun),
          faultRunScenario: runnerFaultRun.scenario,
        } : {}),
      })
      .then((result) => this.finishLifecycle(result, t0))
      .finally(() => {
        if (this.lifecycleAbortController === lifecycleAbortController) {
          this.lifecycleAbortController = null;
        }
        this.lifecyclePromise = null;
      });
    await this.lifecyclePromise;
    const result = this.lastLifecycleResult!;
    if (runnerFaultRun?.scenario === 'NOTIFICATION_HEAP_PRESSURE' && result.status === 'FAILED') {
      await getFaultRunCoordinator().markServiceUnavailable(runnerFaultRun.faultRunId, {
        lifecycleId: result.lifecycleId,
        errorCode: result.errorCode,
      }).catch((error) => log.warn({ error, faultRunId: runnerFaultRun.faultRunId }, 'Failed to mark notification service unavailable'));
    }
    if (runnerFaultRun) {
      await appendFaultRunEvent(runnerFaultRun.faultRunId, 'RUNNER_LIFECYCLE_SUMMARY', {
        trafficRunId,
        lifecycleId: result.lifecycleId,
        status: result.status,
        success: result.success,
        latencyMs: Date.now() - t0,
        errorCode: result.errorCode,
      }).catch((error) => log.warn({ error }, 'Failed to record Fault Run runner summary'));
    }
    const latencyMs = Date.now() - t0;
    void pushActivity({
      ts: t0,
      action: 'CUSTOMER_LIFECYCLE',
      success: result.success,
      latencyMs,
      trafficRunId,
      customerId: result.customerId,
      orderId: result.orderId,
      paymentId: result.paymentId,
      traceId: result.traceId,
      lifecycleId: result.lifecycleId,
      pendingPaymentRetained: result.pendingPaymentRetained,
      status: result.status,
      errorCode: result.errorCode,
    });
    await this.publishStatus();
  }

  private lastLifecycleResult: RunnerActionResult | null = null;

  private finishLifecycle(result: RunnerActionResult, startedAt: number): void {
    this.lastLifecycleResult = result;
    this.currentLifecycleId = result.lifecycleId ?? null;
    this.lastLifecycleCompletedAt = Date.now();
    if (this.previousLifecycleStartedAt !== null) {
      this.intervalSamples.push((startedAt - this.previousLifecycleStartedAt) / 1000);
      this.intervalSamples = this.intervalSamples.slice(-100);
    }
    this.previousLifecycleStartedAt = startedAt;
    if (result.status === 'SUCCESS') this.lifecycleCompletedCount++;
    else if (result.status === 'NOOP') this.lifecycleNoopCount++;
    else if (result.status === 'INTERRUPTED') this.lifecycleInterruptedCount++;
    else this.lifecycleFailedCount++;
    const steps = result.steps ?? [];
    if (steps.some((step) => step.actionType === 'PAYMENT_CONFIRM' && step.success)) this.paymentSuccessCount++;
    if (steps.some((step) => step.actionType === 'CANCEL_PENDING_ORDER' && step.success)) this.cancelCount++;
    if (steps.some((step) => step.actionType === 'COUPON_SELECT'
      && step.resultCode !== 'NO_COUPON_REQUESTED')) this.couponRequestedCount++;
    if (steps.some((step) => step.actionType === 'COUPON_SELECT' && step.success
      && step.resultCode !== 'COUPON_UNAVAILABLE' && step.resultCode !== 'NO_COUPON_REQUESTED')) this.couponAppliedCount++;
    if (steps.some((step) => step.actionType === 'ADDRESS_CREATE' && step.success)) this.addressCreatedCount++;
    if (steps.some((step) => step.actionType === 'CART_REUSED')) this.cartReusedCount++;
    if (result.pendingPaymentRetained) this.pendingPaymentRetainedCount++;
  }

  private async refreshControlState(): Promise<void> {
    const state = await getRunnerControlState();
    this.paused = state.paused;
  }

  private async refreshAndPublishStatus(): Promise<void> {
    if (!this.running) return;
    await this.refreshControlState();
    await this.refreshConfigIfNeeded();
    await this.publishStatus();
  }

  private async refreshConfigIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastConfigCheckAt < 5000) {
      return;
    }
    this.lastConfigCheckAt = now;
    const latest = await loadRunnerConfigFromDb();
    if (latest.version !== this.config.version) {
      this.config = latest;
      log.info({ version: latest.version }, 'Runner config reloaded from DB');
    }
  }

  private async publishStatus(): Promise<void> {
    await setRunnerStatus(this.getStatus());
  }
}

// Singleton
let engine: RunnerEngine | null = null;

export function getRunnerEngine(): RunnerEngine {
  if (!engine) {
    engine = new RunnerEngine();
  }
  return engine;
}
