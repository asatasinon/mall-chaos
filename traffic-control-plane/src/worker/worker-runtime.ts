import pino from 'pino';
import { env } from '../lib/env';
import { closePool } from '../lib/db';
import { closeRedis, getRedis } from '../lib/redis';
import { loadLifecycleAccounts } from '../lib/lifecycle-accounts';
import {
  FaultRunCommandError,
  appendFaultRunEvent,
  deleteExpiredFaultRuns,
  loadFaultRun,
  listFaultRunReconciliationCandidates,
  listShutdownCandidateFaultRuns,
  requestFaultRunStop,
  type FaultRunRecord,
} from '../lib/fault-run-repository';
import { verifyFaultRunOwnershipSchema } from '../lib/fault-run-schema';
import {
  claimFaultRunExecution,
  heartbeatFaultRunExecution,
  loadFaultRunExecution,
  markFaultRunExecutionLeaseLost,
  relinquishFaultRunExecution,
  updateOwnedFaultRunExecution,
} from '../lib/fault-run-execution-repository';
import { createWorkerOwnerId } from '../lib/fault-run-owner-fence';
import { getLegacyFaultRunRecovery } from '../lib/legacy-fault-run-recovery';
import {
  getFaultRunRecoveryExecutor,
  type FaultRunRecoveryExecutorStopResult,
} from './fault-run-recovery-executor';
import { getRunnerEngine } from './runner-engine';
import { getDataWarmupService } from './data-warmup';
import { getCouponReplenishmentScheduler } from './coupon-replenishment';
import { getInventoryReplenishmentScheduler } from './inventory-replenishment';
import { getReportScenarioWorker } from './report-scenario-worker';
import { getTrafficSurgeExecutor } from './traffic-surge-executor';
import { getScenarioWorkers } from './scenario-workers';
import { getFaultRunDrivers } from './fault-run-driver-registry';
import { FaultRunReconciler } from './fault-run-reconciler';
import { getFaultRunDrainRegistry } from './fault-run-drain-registry';

const log = pino({ name: 'worker' });
const FAULT_RUN_RETENTION_LOCK = 'traffic-control-plane:fault-run-retention:lease';

export type WorkerShutdownReason = 'SIGINT' | 'SIGTERM' | 'STARTUP_FAILURE';

interface AsyncWorkerComponent {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface EffectWorkerComponent {
  start(): void;
  stop(): Promise<void>;
}

interface RunnerComponent {
  loadConfigFromDb(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
}

interface WarmupComponent {
  start(): void;
  stop(): Promise<void>;
}

interface RecoveryExecutorComponent {
  start(): Promise<void>;
  scan(): Promise<void>;
  stop(): Promise<FaultRunRecoveryExecutorStopResult>;
}

interface ReconcilerComponent {
  start(): Promise<void>;
  quiesce(): Promise<void>;
  stop(): Promise<void>;
}

interface LegacyRecoveryComponent {
  scheduleActiveRuns(): Promise<void>;
  recoverExpiredRuns(): Promise<void>;
}

export interface WorkerRuntimeDependencies {
  safeRuntimeEnabled: boolean;
  reconciliationMode?: 'OFF' | 'OBSERVE' | 'SHADOW' | 'TAKEOVER';
  verifyOwnershipSchema?: typeof verifyFaultRunOwnershipSchema;
  reconciler?: ReconcilerComponent;
  drainTimeoutMs: number;
  recoveryTimeoutMs: number;
  shutdownTimeoutMs: number;
  internalServiceKey: string;
  loadLifecycleAccounts: typeof loadLifecycleAccounts;
  runner: RunnerComponent;
  recoveryExecutor: RecoveryExecutorComponent;
  legacyRecovery: LegacyRecoveryComponent;
  couponScheduler: AsyncWorkerComponent;
  inventoryScheduler: AsyncWorkerComponent;
  reportWorker: EffectWorkerComponent;
  surgeExecutor: EffectWorkerComponent;
  scenarioWorkers: EffectWorkerComponent;
  dataWarmup: WarmupComponent;
  listShutdownCandidates: () => Promise<FaultRunRecord[]>;
  requestStop: typeof requestFaultRunStop;
  runRetention: () => Promise<void>;
  closePool: () => Promise<void>;
  closeRedis: () => Promise<void>;
  now: () => number;
  logger: Pick<typeof log, 'error' | 'info' | 'warn'>;
}

export class WorkerRuntime {
  private readonly started = {
    recovery: false,
    reconciler: false,
    coupon: false,
    inventory: false,
    report: false,
    surge: false,
    scenarios: false,
    runner: false,
    warmup: false,
  };
  private legacyRecoveryTimer: ReturnType<typeof setInterval> | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private retentionPromise: Promise<void> | null = null;
  private shutdownPromise: Promise<number> | null = null;

  constructor(private readonly dependencies: WorkerRuntimeDependencies) {}

  async start(): Promise<void> {
    const dependencies = this.dependencies;
    dependencies.logger.info('Starting traffic-control-plane worker...');
    if (!dependencies.internalServiceKey.trim()) throw new Error('INTERNAL_SERVICE_KEY_REQUIRED');
    dependencies.loadLifecycleAccounts();

    await dependencies.runner.loadConfigFromDb();
    if (this.isShuttingDown()) return;

    const useReconciler = dependencies.reconciliationMode !== undefined
      && dependencies.reconciliationMode !== 'OFF';
    if (useReconciler && !dependencies.safeRuntimeEnabled) {
      throw new Error('FAULT_RUN_RECONCILIATION_REQUIRES_SAFE_RUNTIME');
    }
    if (useReconciler) {
      await (dependencies.verifyOwnershipSchema ?? verifyFaultRunOwnershipSchema)();
      if (!dependencies.reconciler) throw new Error('FAULT_RUN_RECONCILER_NOT_CONFIGURED');
      this.started.recovery = true;
      await dependencies.recoveryExecutor.start();
      this.started.reconciler = true;
      await dependencies.reconciler!.start();
    }
    if (!useReconciler) {
      if (dependencies.safeRuntimeEnabled) {
        this.started.recovery = true;
        await dependencies.recoveryExecutor.start();
      } else {
        await dependencies.legacyRecovery.scheduleActiveRuns();
        await dependencies.legacyRecovery.recoverExpiredRuns();
      }
    }
    if (this.isShuttingDown()) return;

    if (!useReconciler) {
      this.started.report = true;
      dependencies.reportWorker.start();
      this.started.surge = true;
      dependencies.surgeExecutor.start();
      this.started.scenarios = true;
      dependencies.scenarioWorkers.start();
    }
    this.started.runner = true;
    dependencies.runner.start();
    if (this.isShuttingDown()) return;

    this.started.coupon = true;
    await dependencies.couponScheduler.start();
    if (this.isShuttingDown()) return;
    this.started.inventory = true;
    await dependencies.inventoryScheduler.start();
    if (this.isShuttingDown()) return;

    this.started.warmup = true;
    dependencies.dataWarmup.start();
    dependencies.logger.info('Data warmup service started; database configuration controls execution');

    if (!dependencies.safeRuntimeEnabled) {
      this.legacyRecoveryTimer = setInterval(() => {
        void dependencies.legacyRecovery.recoverExpiredRuns().catch((error) => {
          dependencies.logger.warn({
            code: workerErrorCode(error),
          }, 'Failed to recover expired Fault Runs');
        });
      }, 1000);
    }
    this.retentionTimer = setInterval(() => this.startRetention(), 24 * 60 * 60 * 1000);
    dependencies.logger.info('Worker is running. Press Ctrl+C to stop.');
  }

  shutdown(reason: WorkerShutdownReason): Promise<number> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.shutdownInternal(reason);
    }
    return this.shutdownPromise;
  }

  private async shutdownInternal(reason: WorkerShutdownReason): Promise<number> {
    const deadlineAt = this.dependencies.now() + this.dependencies.shutdownTimeoutMs;
    let criticalFailure = false;
    const stopStep = async (
      name: string,
      operation: () => Promise<void>,
      critical: boolean,
    ): Promise<void> => {
      const completed = await this.runWithinShutdownBudget(deadlineAt, operation);
      if (completed.kind === 'COMPLETED') return;
      if (critical) criticalFailure = true;
      this.dependencies.logger.error({
        step: name,
        code: completed.code,
      }, 'Worker shutdown step did not complete');
    };

    this.dependencies.logger.info({ reason }, 'Shutting down worker...');
    this.stopTimers();

    await stopStep('effect-workers', async () => {
      await Promise.all([
        this.started.report ? this.dependencies.reportWorker.stop() : Promise.resolve(),
        this.started.surge ? this.dependencies.surgeExecutor.stop() : Promise.resolve(),
        this.started.scenarios ? this.dependencies.scenarioWorkers.stop() : Promise.resolve(),
        this.started.runner ? this.dependencies.runner.stop() : Promise.resolve(),
      ]);
    }, true);

    if (this.dependencies.safeRuntimeEnabled && this.started.recovery) {
      await stopStep('shutdown-stop-commands', () => this.requestShutdownStops(), true);
      let reconcilerQuiesced = !this.started.reconciler;
      if (this.started.reconciler) {
        await stopStep('fault-run-reconciler-quiesce', async () => {
          await this.dependencies.reconciler!.quiesce();
          reconcilerQuiesced = true;
        }, true);
      }
      if (reconcilerQuiesced) {
        await stopStep('recovery-scan', () => this.dependencies.recoveryExecutor.scan(), true);
      }
      if (this.started.reconciler) {
        await stopStep('fault-run-reconciler', () => this.dependencies.reconciler!.stop(), true);
      }
      await stopStep('recovery-executor', async () => {
        const result = await this.dependencies.recoveryExecutor.stop();
        if (result.failedRunIds.length > 0) {
          throw new Error('RECOVERY_PERSISTENCE_UNCONFIRMED');
        }
      }, true);
    }

    await stopStep('coupon-replenishment', () =>
      this.started.coupon ? this.dependencies.couponScheduler.stop() : Promise.resolve(), false);
    await stopStep('inventory-replenishment', () =>
      this.started.inventory ? this.dependencies.inventoryScheduler.stop() : Promise.resolve(), false);
    await stopStep('data-warmup-lease', () =>
      this.started.warmup ? this.dependencies.dataWarmup.stop() : Promise.resolve(), true);
    await stopStep('fault-run-retention', () => this.waitForRetention(), false);
    await stopStep('mysql-close', this.dependencies.closePool, false);
    await stopStep('redis-close', this.dependencies.closeRedis, false);

    const exitCode = criticalFailure ? 1 : 0;
    this.dependencies.logger.info({ reason, exitCode }, 'Worker shutdown completed');
    return exitCode;
  }

  private async requestShutdownStops(): Promise<void> {
    const runs = await this.dependencies.listShutdownCandidates();
    for (const run of runs) {
      try {
        await this.dependencies.requestStop({
          faultRunId: run.faultRunId,
          reason: 'WORKER_SHUTDOWN',
          drainTimeoutMs: this.dependencies.drainTimeoutMs,
          recoveryTimeoutMs: this.dependencies.recoveryTimeoutMs,
          now: new Date(this.dependencies.now()),
        });
      } catch (error) {
        if (error instanceof FaultRunCommandError && error.code === 'STOP_REQUEST_CONFLICT') {
          this.dependencies.logger.info({
            faultRunId: run.faultRunId,
          }, 'Fault Run changed while Worker shutdown requested recovery');
          continue;
        }
        throw error;
      }
    }
  }

  private startRetention(): void {
    if (this.retentionPromise) return;
    const retention = this.dependencies.runRetention();
    this.retentionPromise = retention;
    void retention.then(
      () => {
        if (this.retentionPromise === retention) this.retentionPromise = null;
      },
      (error) => {
        if (this.retentionPromise === retention) this.retentionPromise = null;
        this.dependencies.logger.warn({
          code: workerErrorCode(error),
        }, 'Failed to delete expired Fault Run records');
      },
    );
  }

  private async waitForRetention(): Promise<void> {
    await this.retentionPromise;
  }

  private stopTimers(): void {
    if (this.legacyRecoveryTimer) {
      clearInterval(this.legacyRecoveryTimer);
      this.legacyRecoveryTimer = null;
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  private isShuttingDown(): boolean {
    return this.shutdownPromise !== null;
  }

  private async runWithinShutdownBudget(
    deadlineAt: number,
    operation: () => Promise<void>,
  ): Promise<{ kind: 'COMPLETED' } | { kind: 'FAILED'; code: string }> {
    const remainingMs = deadlineAt - this.dependencies.now();
    if (remainingMs <= 0) return { kind: 'FAILED', code: 'WORKER_SHUTDOWN_TIMEOUT' };

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('WORKER_SHUTDOWN_TIMEOUT')), remainingMs);
        }),
      ]);
      return { kind: 'COMPLETED' };
    } catch (error) {
      return { kind: 'FAILED', code: workerErrorCode(error) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function createWorkerRuntime(): WorkerRuntime {
  const reconciler = new FaultRunReconciler({
    listCandidates: listFaultRunReconciliationCandidates,
    loadRun: loadFaultRun,
    requestStop: requestFaultRunStop,
    loadExecution: loadFaultRunExecution,
    claimExecution: claimFaultRunExecution,
    heartbeatExecution: heartbeatFaultRunExecution,
    markLeaseLost: markFaultRunExecutionLeaseLost,
    updateExecution: updateOwnedFaultRunExecution,
    relinquishExecution: relinquishFaultRunExecution,
    appendEvent: appendFaultRunEvent,
    drainRegistry: getFaultRunDrainRegistry(),
    drivers: getFaultRunDrivers(),
    now: () => new Date(),
    logger: log,
  }, {
    mode: env.FAULT_RUN_RECONCILIATION_MODE,
    ownerId: createWorkerOwnerId(env.FAULT_RUN_OWNER_ID_PREFIX),
    leaseTtlMs: env.FAULT_RUN_OWNER_LEASE_TTL_MS,
    heartbeatMs: env.FAULT_RUN_OWNER_HEARTBEAT_MS,
    reconcileIntervalMs: env.FAULT_RUN_RECONCILE_INTERVAL_MS,
    drainTimeoutMs: env.FAULT_RUN_DRAIN_TIMEOUT_MS,
    recoveryTimeoutMs: env.FAULT_RUN_RECOVERY_TIMEOUT_MS,
  });
  return new WorkerRuntime({
    safeRuntimeEnabled: env.FAULT_RUN_SAFE_RUNTIME_ENABLED,
    reconciliationMode: env.FAULT_RUN_RECONCILIATION_MODE,
    verifyOwnershipSchema: verifyFaultRunOwnershipSchema,
    reconciler,
    drainTimeoutMs: env.FAULT_RUN_DRAIN_TIMEOUT_MS,
    recoveryTimeoutMs: env.FAULT_RUN_RECOVERY_TIMEOUT_MS,
    shutdownTimeoutMs: env.FAULT_RUN_SHUTDOWN_TIMEOUT_MS,
    internalServiceKey: env.CASTREL_INTERNAL_SERVICE_KEY,
    loadLifecycleAccounts,
    runner: getRunnerEngine(),
    recoveryExecutor: getFaultRunRecoveryExecutor({
      drainTimeoutMs: env.FAULT_RUN_DRAIN_TIMEOUT_MS,
      recoveryTimeoutMs: env.FAULT_RUN_RECOVERY_TIMEOUT_MS,
      scanIntervalMs: env.FAULT_RUN_STOP_SCAN_INTERVAL_MS,
    }),
    legacyRecovery: getLegacyFaultRunRecovery(),
    couponScheduler: getCouponReplenishmentScheduler(),
    inventoryScheduler: getInventoryReplenishmentScheduler(),
    reportWorker: getReportScenarioWorker(),
    surgeExecutor: getTrafficSurgeExecutor(),
    scenarioWorkers: getScenarioWorkers(),
    dataWarmup: getDataWarmupService(),
    listShutdownCandidates: listShutdownCandidateFaultRuns,
    requestStop: requestFaultRunStop,
    runRetention: runFaultRunRetention,
    closePool,
    closeRedis,
    now: Date.now,
    logger: log,
  });
}

export async function runFaultRunRetention(): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const owner = `retention-${process.pid}`;
  const acquired = await redis.set(FAULT_RUN_RETENTION_LOCK, owner, 'EX', 300, 'NX').catch(() => null);
  if (acquired !== 'OK') return;
  try {
    await deleteExpiredFaultRuns();
  } finally {
    await redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      FAULT_RUN_RETENTION_LOCK,
      owner,
    ).catch(() => undefined);
  }
}

function workerErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_.:-]{0,95}$/.test(error.message)
    ? error.message
    : 'WORKER_SHUTDOWN_STEP_FAILED';
}
