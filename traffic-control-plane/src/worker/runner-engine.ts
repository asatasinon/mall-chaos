import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { loadRunnerConfigFromDb, RunnerConfig } from '../lib/runner-config';
import { completeTrafficRun, ensureTrafficRun } from '../lib/runner-persistence';
import {
  appendFaultRunEvent,
  loadRunnableFaultRun,
  type FaultRunRecord,
} from '../lib/fault-run-repository';
import { normalizeFaultRunSummaryEventPayload } from '../lib/fault-run-event-contract';
import { createFaultRunContext } from '../lib/fault-run-context';
import { getFaultRunCoordinator } from '../lib/fault-run-coordinator';
import { getRunnerControlState, pushActivity, setRunnerStatus } from '../lib/runtime-state';
import { env } from '../lib/env';
import { forwardAbortSignal } from '../lib/abort-signal';
import {
  RunnerActionResult,
  TrafficActionOrchestrator,
} from './traffic-action-orchestrator';
import {
  getFaultRunDrainRegistry,
  type FaultRunDrainParticipant,
  type FaultRunDrainRegistry,
  type FaultRunWorkPermit,
} from './fault-run-drain-registry';

const log = pino({ name: 'runner-engine' });

export interface RunnerEngineDependencies {
  loadConfig: typeof loadRunnerConfigFromDb;
  ensureTrafficRun: typeof ensureTrafficRun;
  completeTrafficRun: typeof completeTrafficRun;
  loadRunnableFaultRun: typeof loadRunnableFaultRun;
  appendEvent: typeof appendFaultRunEvent;
  markServiceUnavailable: (
    faultRunId: string,
    input: { lifecycleId?: string; errorCode?: string },
  ) => Promise<unknown>;
  getControlState: typeof getRunnerControlState;
  activityWriter: typeof pushActivity;
  statusWriter: typeof setRunnerStatus;
  orchestrator: Pick<TrafficActionOrchestrator, 'executeLifecycle' | 'executeStorageGrowth'>;
  drainRegistry: Pick<FaultRunDrainRegistry, 'register' | 'tryAcquire'>;
  safeRuntimeEnabled: boolean;
  faultRunExecutionEnabled?: boolean;
  now: () => number;
  createTrafficRunId: () => string;
}

interface RunnerAdmission {
  complete(): void;
}

export class RunnerEngine {
  private readonly loadConfig: RunnerEngineDependencies['loadConfig'];
  private readonly persistTrafficRun: RunnerEngineDependencies['ensureTrafficRun'];
  private readonly finishTrafficRun: RunnerEngineDependencies['completeTrafficRun'];
  private readonly loadRunnableRun: RunnerEngineDependencies['loadRunnableFaultRun'];
  private readonly appendEvent: RunnerEngineDependencies['appendEvent'];
  private readonly markServiceUnavailable: RunnerEngineDependencies['markServiceUnavailable'];
  private readonly getControlState: RunnerEngineDependencies['getControlState'];
  private readonly activityWriter: RunnerEngineDependencies['activityWriter'];
  private readonly statusWriter: RunnerEngineDependencies['statusWriter'];
  private readonly orchestrator: RunnerEngineDependencies['orchestrator'];
  private readonly drainRegistry: RunnerEngineDependencies['drainRegistry'];
  private readonly safeRuntimeEnabled: boolean;
  private readonly faultRunExecutionEnabled: boolean;
  private readonly now: () => number;
  private readonly createTrafficRunId: () => string;
  private config: RunnerConfig;
  private paused = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private lastConfigCheckAt = 0;
  private trafficRunId: string | null = null;
  private trafficRunPersistence: Promise<void> | null = null;
  private lifecycleAbortController: AbortController | null = null;
  private lifecyclePromise: Promise<RunnerActionResult> | null = null;
  private stopPromise: Promise<void> | null = null;
  private readonly ticks = new Set<Promise<void>>();
  private runGeneration = 0;
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
  private storageGrowthCompletedRunId: string | null = null;

  constructor(dependencies: Partial<RunnerEngineDependencies> = {}) {
    this.loadConfig = dependencies.loadConfig ?? loadRunnerConfigFromDb;
    this.persistTrafficRun = dependencies.ensureTrafficRun ?? ensureTrafficRun;
    this.finishTrafficRun = dependencies.completeTrafficRun ?? completeTrafficRun;
    this.loadRunnableRun = dependencies.loadRunnableFaultRun ?? loadRunnableFaultRun;
    this.appendEvent = dependencies.appendEvent ?? appendFaultRunEvent;
    this.markServiceUnavailable = dependencies.markServiceUnavailable
      ?? ((faultRunId, input) => getFaultRunCoordinator().markServiceUnavailable(faultRunId, input));
    this.getControlState = dependencies.getControlState ?? getRunnerControlState;
    this.activityWriter = dependencies.activityWriter ?? pushActivity;
    this.statusWriter = dependencies.statusWriter ?? setRunnerStatus;
    this.orchestrator = dependencies.orchestrator ?? new TrafficActionOrchestrator();
    this.drainRegistry = dependencies.drainRegistry ?? getFaultRunDrainRegistry();
    this.safeRuntimeEnabled = dependencies.safeRuntimeEnabled ?? env.FAULT_RUN_SAFE_RUNTIME_ENABLED;
    this.faultRunExecutionEnabled = dependencies.faultRunExecutionEnabled
      ?? env.FAULT_RUN_RECONCILIATION_MODE === 'OFF';
    this.now = dependencies.now ?? Date.now;
    this.createTrafficRunId = dependencies.createTrafficRunId ?? uuidv4;
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
    this.config = await this.loadConfig();
    log.info({ config: this.config }, 'Config loaded from DB');
  }

  start(): void {
    if (this.running) return;
    this.stopPromise = null;
    this.running = true;
    this.runGeneration++;
    this.trafficRunId = this.createTrafficRunId();
    const trafficRunId = this.trafficRunId;
    this.trafficRunPersistence = this.persistTrafficRun(trafficRunId, this.config.version).catch((error) => {
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
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopInternal();
    return this.stopPromise;
  }

  private async stopInternal(): Promise<void> {
    this.running = false;
    this.runGeneration++;
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
    await Promise.allSettled([...this.ticks]);
    const lifecycleDrain = this.lifecyclePromise ?? Promise.resolve();
    await lifecycleDrain;
    if (trafficRunId) {
      await (this.trafficRunPersistence ?? Promise.resolve());
      await this.finishTrafficRun(trafficRunId).catch((error) => {
        log.error({ error, trafficRunId }, 'Failed to persist runner stop');
      });
    }
    this.trafficRunPersistence = null;
    this.storageGrowthCompletedRunId = null;
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

  tick(): Promise<void> {
    if (!this.running) return Promise.resolve();
    const tick = this.tickInternal(this.runGeneration);
    this.ticks.add(tick);
    void tick.then(
      () => this.ticks.delete(tick),
      () => this.ticks.delete(tick),
    );
    return tick;
  }

  private async tickInternal(generation: number): Promise<void> {
    await this.refreshControlState();
    await this.refreshConfigIfNeeded();
    await this.publishStatus();

    if (!this.config.enabled || this.paused) return;
    if (!this.trafficRunId) return;
    const t0 = this.now();
    const trafficRunId = this.trafficRunId;
    if (this.trafficRunPersistence) await this.trafficRunPersistence;
    if (!this.isCurrentTrafficRun(trafficRunId, generation)) return;
    const runnableFaultRun = this.faultRunExecutionEnabled
      ? await this.loadRunnableRun()
      : null;
    if (!this.isCurrentTrafficRun(trafficRunId, generation)) return;
    const runnerFaultRun = runnableFaultRun
      && runnableFaultRun.state === 'ACTIVE'
      && Date.parse(runnableFaultRun.expiresAt) > this.now()
      && isRunnerScenario(runnableFaultRun)
      ? runnableFaultRun
      : null;
    if (runnerFaultRun?.scenario !== 'NOTIFICATION_STORAGE_APPEND') {
      this.storageGrowthCompletedRunId = null;
    }
    if (runnerFaultRun?.scenario === 'NOTIFICATION_STORAGE_APPEND'
        && this.storageGrowthCompletedRunId === runnerFaultRun.faultRunId) {
      return;
    }

    const lifecycleAbortController = new AbortController();
    const admission = runnerFaultRun && this.safeRuntimeEnabled
      ? this.admitControlledLifecycle(runnerFaultRun, lifecycleAbortController)
      : null;
    if (runnerFaultRun && this.safeRuntimeEnabled && !admission) return;

    const runnerFaultContext = runnerFaultRun?.scenario === 'NOTIFICATION_STORAGE_APPEND'
      ? createFaultRunContext(runnerFaultRun)
      : undefined;
    this.lifecycleAbortController = lifecycleAbortController;
    this.lifecycleStartedCount++;
    this.lastLifecycleStartedAt = t0;
    this.currentLifecycleId = null;
    this.lifecyclePromise = (async () => {
      const result = runnerFaultRun?.scenario === 'NOTIFICATION_STORAGE_APPEND'
        ? await this.orchestrator.executeStorageGrowth(trafficRunId, runnerFaultContext!, {
          signal: lifecycleAbortController.signal,
          requestIntervalMs: Number(runnerFaultRun.parameters.requestIntervalMs ?? 100),
          totalBytes: Number(runnerFaultRun.parameters.totalBytes ?? 10 * 1024 ** 3),
        })
        : await this.orchestrator.executeLifecycle(trafficRunId, {
          maxItems: this.config.maxItems,
          maxItemQuantity: this.config.maxItemQuantity,
          paymentSuccessRatio: this.config.successfulPaymentRatio,
          couponUsageRatio: this.config.couponUsageRatio,
        }, {
          signal: lifecycleAbortController.signal,
        });
      if (runnerFaultRun?.scenario === 'NOTIFICATION_STORAGE_APPEND'
          && result.resultCode === 'STORAGE_APPEND_COMPLETE') {
        this.storageGrowthCompletedRunId = runnerFaultRun.faultRunId;
      }
      this.finishLifecycle(result, t0);
      if (runnerFaultRun?.scenario === 'NOTIFICATION_HEAP_PRESSURE' && result.status === 'FAILED') {
        await this.markServiceUnavailable(runnerFaultRun.faultRunId, {
          lifecycleId: result.lifecycleId,
          errorCode: result.errorCode,
        }).catch((error) => log.warn({ error, faultRunId: runnerFaultRun.faultRunId }, 'Failed to mark notification service unavailable'));
      }
      if (runnerFaultRun) {
        await this.appendEvent(
          runnerFaultRun.faultRunId,
          'RUNNER_LIFECYCLE_SUMMARY',
          normalizeFaultRunSummaryEventPayload('RUNNER_LIFECYCLE_SUMMARY', {
            resultStatus: result.status,
            success: result.success,
            latencyMs: this.now() - t0,
            errorCode: result.errorCode,
          }),
        ).catch((error) => log.warn({ error }, 'Failed to record Fault Run runner summary'));
      }
      return result;
    })().finally(() => {
        admission?.complete();
        if (this.lifecycleAbortController === lifecycleAbortController) {
          this.lifecycleAbortController = null;
        }
        this.lifecyclePromise = null;
      });
    const result = await this.lifecyclePromise;
    const latencyMs = this.now() - t0;
    void this.activityWriter({
      ts: t0,
      action: result.steps?.some((step) => step.actionType === 'NOTIFICATION_STORAGE_APPEND')
        ? 'NOTIFICATION_STORAGE_APPEND' : 'CUSTOMER_LIFECYCLE',
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

  private isCurrentTrafficRun(trafficRunId: string, generation: number): boolean {
    return this.running
      && this.runGeneration === generation
      && this.trafficRunId === trafficRunId;
  }

  private admitControlledLifecycle(
    run: FaultRunRecord,
    lifecycleAbortController: AbortController,
  ): RunnerAdmission | null {
    const completion = deferredVoid();
    const participant: FaultRunDrainParticipant = {
      kind: 'RUNNER',
      requestStop: () => lifecycleAbortController.abort(),
      settled: () => completion.promise,
    };
    const unregisterParticipant = this.drainRegistry.register(run.faultRunId, participant);
    const permit = this.drainRegistry.tryAcquire(run.faultRunId, 'RUNNER');
    if (!permit) {
      completion.resolve();
      unregisterParticipant();
      return null;
    }
    const removePermitAbortListener = forwardAbortSignal(permit.signal, lifecycleAbortController);
    return completeRunnerAdmission(
      permit,
      completion.resolve,
      removePermitAbortListener,
      unregisterParticipant,
    );
  }

  private finishLifecycle(result: RunnerActionResult, startedAt: number): void {
    this.currentLifecycleId = result.lifecycleId ?? null;
    this.lastLifecycleCompletedAt = this.now();
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
    const state = await this.getControlState();
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
    const latest = await this.loadConfig();
    if (latest.version !== this.config.version) {
      this.config = latest;
      log.info({ version: latest.version }, 'Runner config reloaded from DB');
    }
  }

  private async publishStatus(): Promise<void> {
    await this.statusWriter(this.getStatus());
  }
}

function isRunnerScenario(run: FaultRunRecord): boolean {
  return run.scenario === 'NOTIFICATION_HEAP_PRESSURE'
    || run.scenario === 'NOTIFICATION_STORAGE_APPEND'
    || run.scenario === 'PSP_PROVIDER_OUTCOME';
}

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function completeRunnerAdmission(
  permit: FaultRunWorkPermit,
  resolveCompletion: () => void,
  removePermitAbortListener: () => void,
  unregisterParticipant: () => void,
): RunnerAdmission {
  let completed = false;
  return {
    complete: () => {
      if (completed) return;
      completed = true;
      removePermitAbortListener();
      permit.complete();
      resolveCompletion();
      unregisterParticipant();
    },
  };
}

// Singleton
let engine: RunnerEngine | null = null;

export function getRunnerEngine(): RunnerEngine {
  if (!engine) {
    engine = new RunnerEngine();
  }
  return engine;
}
