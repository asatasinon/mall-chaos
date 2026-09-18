import pino from 'pino';
import {
  completeFaultRunManualCleanup,
  completeFaultRunRecovery,
  listExpiredRunnableFaultRuns,
  listRecoveringFaultRuns,
  loadFaultRun,
  recordFaultRunRecoveryStep,
  requestFaultRunStop,
  type CompleteFaultRunRecoveryInput,
  type CompleteFaultRunManualCleanupInput,
  type FaultRunRecord,
  type RecordFaultRunRecoveryStepInput,
  type RequestFaultRunStopInput,
} from '../lib/fault-run-repository';
import {
  getScenarioDefinition,
  type FaultRunWorkerDrainOwner,
} from '../lib/fault-run-catalog';
import {
  GatewayFaultRunTargetAdapter,
  type FaultRunTargetAdapter,
} from '../lib/fault-run-coordinator';
import { GatewayRequestError } from '../lib/gateway-client';
import {
  parseFaultRunRecoveryProjection,
  sanitizeFaultRunRecoveryError,
  selectDominantFaultRunRecoveryOutcome,
  type FaultRunRecoveryError,
  type FaultRunRecoveryOutcome,
  type FaultRunRecoveryProjection,
  type FaultRunRecoveryResidual,
  type FaultRunRecoveryStep,
} from '../lib/fault-run-recovery';
import {
  resolveFaultRunRecoveryPolicy,
  type FaultRunResolvedRecoveryPolicy,
} from '../lib/fault-run-recovery-policy';
import {
  faultRunDrainParticipantForOwner,
  getFaultRunDrainRegistry,
  type FaultRunDrainController as FaultRunRecoveryDrainController,
  type FaultRunDrainGateResult as FaultRunRecoveryGateResult,
  type FaultRunDrainResult as FaultRunRecoveryDrainResult,
} from './fault-run-drain-registry';

export type {
  FaultRunDrainController as FaultRunRecoveryDrainController,
  FaultRunDrainGateResult as FaultRunRecoveryGateResult,
  FaultRunDrainResult as FaultRunRecoveryDrainResult,
} from './fault-run-drain-registry';

const log = pino({ name: 'fault-run-recovery-executor' });

class RecoveryDeadlineExceededError extends Error {
  constructor() {
    super('RECOVERY_DEADLINE_EXCEEDED');
    this.name = 'RecoveryDeadlineExceededError';
  }
}

type ReleaseSettlement =
  | {
      status: 'SUCCEEDED';
      completedAt: string;
    }
  | {
      status: 'FAILED';
      completedAt: string;
      error: FaultRunRecoveryError;
    };

type CleanupSettlement =
  | {
      status: 'SUCCEEDED';
      completedAt: string;
    }
  | {
      status: 'FAILED';
      completedAt: string;
      error: FaultRunRecoveryError;
      timedOut: boolean;
    };

export interface FaultRunRecoveryStore {
  load(faultRunId: string): Promise<FaultRunRecord | null>;
  listRecovering(): Promise<FaultRunRecord[]>;
  listExpiredRunnable(now: Date): Promise<FaultRunRecord[]>;
  requestStop(input: RequestFaultRunStopInput): ReturnType<typeof requestFaultRunStop>;
  recordStep(input: RecordFaultRunRecoveryStepInput): Promise<FaultRunRecord | null>;
  complete(input: CompleteFaultRunRecoveryInput): Promise<FaultRunRecord | null>;
  completeManualCleanup(input: CompleteFaultRunManualCleanupInput): Promise<FaultRunRecord | null>;
}

export class SqlFaultRunRecoveryStore implements FaultRunRecoveryStore {
  load(faultRunId: string) { return loadFaultRun(faultRunId); }
  listRecovering() { return listRecoveringFaultRuns(); }
  listExpiredRunnable(now: Date) { return listExpiredRunnableFaultRuns(now); }
  requestStop(input: RequestFaultRunStopInput) { return requestFaultRunStop(input); }
  recordStep(input: RecordFaultRunRecoveryStepInput) { return recordFaultRunRecoveryStep(input); }
  complete(input: CompleteFaultRunRecoveryInput) { return completeFaultRunRecovery(input); }
  completeManualCleanup(input: CompleteFaultRunManualCleanupInput) {
    return completeFaultRunManualCleanup(input);
  }
}

/**
 * A test-only fail-closed controller for cases that intentionally do not use
 * the Worker-local registry.
 * A missing participant is a recovery limitation, not a drained result.
 */
export class MissingFaultRunRecoveryDrainController implements FaultRunRecoveryDrainController {
  async closeGate(input: {
    owner: FaultRunWorkerDrainOwner;
  }): Promise<FaultRunRecoveryGateResult> {
    return {
      kind: 'MISSING',
      participant: faultRunDrainParticipantForOwner(input.owner),
    };
  }

  async drain(input: {
    owner: FaultRunWorkerDrainOwner;
  }): Promise<FaultRunRecoveryDrainResult> {
    return {
      kind: 'MISSING',
      participant: faultRunDrainParticipantForOwner(input.owner),
    };
  }
}

export interface FaultRunRecoveryExecutorOptions {
  drainTimeoutMs: number;
  recoveryTimeoutMs: number;
  scanIntervalMs?: number;
  now?: () => Date;
  logger?: Pick<typeof log, 'warn' | 'info'>;
}

export interface FaultRunRecoveryExecutorStopResult {
  failedRunIds: readonly string[];
}

export class FaultRunRecoveryExecutor {
  private readonly running = new Map<string, Promise<void>>();
  private readonly releaseSettlements = new Map<string, ReleaseSettlement>();
  private readonly cleanupSettlements = new Map<string, CleanupSettlement>();
  private readonly failedRunIds = new Set<string>();
  private readonly scans = new Set<Promise<void>>();
  private readonly now: () => Date;
  private readonly logger: Pick<typeof log, 'warn' | 'info'>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;

  constructor(
    private readonly store: FaultRunRecoveryStore,
    private readonly drainController: FaultRunRecoveryDrainController,
    private readonly targetAdapter: Pick<FaultRunTargetAdapter, 'stop' | 'cleanup'>,
    private readonly options: FaultRunRecoveryExecutorOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? log;
    if (!Number.isSafeInteger(options.drainTimeoutMs)
      || !Number.isSafeInteger(options.recoveryTimeoutMs)
      || options.drainTimeoutMs < 1
      || options.recoveryTimeoutMs < options.drainTimeoutMs) {
      throw new Error('INVALID_RECOVERY_EXECUTOR_TIMEOUTS');
    }
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    await this.scan();
    if (this.stopping) return;
    this.timer = setInterval(() => {
      void this.scan().catch(() => {
        this.logger.warn({ code: 'RECOVERY_SCAN_FAILED' }, 'Fault Run recovery scan failed');
      });
    }, this.options.scanIntervalMs ?? 1000);
    this.logger.info('Fault Run recovery executor started');
  }

  async stop(): Promise<FaultRunRecoveryExecutorStopResult> {
    this.stopping = true;
    const timer = this.timer;
    this.timer = null;
    if (timer) clearInterval(timer);
    await Promise.allSettled([...this.scans]);
    await Promise.allSettled(this.running.values());
    return { failedRunIds: [...this.failedRunIds].sort() };
  }

  async scan(): Promise<void> {
    if (this.stopping) return;
    const scan = this.scanInternal();
    this.scans.add(scan);
    try {
      await scan;
    } finally {
      this.scans.delete(scan);
    }
  }

  private async scanInternal(): Promise<void> {
    const now = this.now();
    const [recoveringRuns, expiredRuns] = await Promise.all([
      this.store.listRecovering(),
      this.store.listExpiredRunnable(now),
    ]);
    if (this.stopping) return;
    const candidates = new Map<string, FaultRunRecord>();

    for (const expired of expiredRuns) {
      if (this.stopping) return;
      const command = await this.store.requestStop({
        faultRunId: expired.faultRunId,
        reason: 'EXPIRED',
        drainTimeoutMs: this.options.drainTimeoutMs,
        recoveryTimeoutMs: this.options.recoveryTimeoutMs,
        now,
      });
      if (command) candidates.set(command.run.faultRunId, command.run);
    }
    if (this.stopping) return;
    for (const recovering of recoveringRuns) {
      if (this.stopping) return;
      candidates.set(recovering.faultRunId, recovering);
    }

    await Promise.all([...candidates.values()].map((run) =>
      this.stopping ? Promise.resolve() : this.execute(run.faultRunId)));
  }

  execute(faultRunId: string): Promise<void> {
    if (this.stopping) return Promise.resolve();
    const existing = this.running.get(faultRunId);
    if (existing) return existing;

    const execution = this.recover(faultRunId)
      .then(() => {
        this.failedRunIds.delete(faultRunId);
      })
      .catch((error: unknown) => {
        this.failedRunIds.add(faultRunId);
        this.logger.warn({
          faultRunId,
          code: recoveryExecutorErrorCode(error),
        }, 'Fault Run recovery execution stopped before completion');
      })
      .finally(() => {
        this.running.delete(faultRunId);
      });
    this.running.set(faultRunId, execution);
    return execution;
  }

  private async recover(faultRunId: string): Promise<void> {
    let run = await this.store.load(faultRunId);
    if (!run || run.state !== 'RECOVERING') return;

    let projection = this.requireSafeProjection(run);
    if (!isActionableRecovery(projection)) return;
    const policy = resolveFaultRunRecoveryPolicy(getScenarioDefinition(run.scenario));

    if (projection.phase === 'CLEANING') {
      await this.completeManualCleanup(run, projection, policy);
      return;
    }

    const drainResult = await this.drain(run, projection, policy);
    if (drainResult === 'BLOCKED') return;
    ({ run, projection } = await this.reloadRecovery(faultRunId));

    if (policy.targetRelease === 'FORBIDDEN') {
      ({ run, projection } = await this.markNonReleasing(run, projection, policy));
      await this.completeBlockedRecovery(run, projection);
      return;
    }

    if (policy.targetRelease === 'NOT_APPLICABLE') {
      ({ run, projection } = await this.skipRelease(run, projection, policy));
    } else {
      const releaseResult = await this.release(run, projection, policy);
      if (releaseResult === 'BLOCKED') return;
      ({ run, projection } = await this.reloadRecovery(faultRunId));
    }

    if (policy.cleanup === 'OPERATOR_CONFIRMED' && projection.cleanup.status === 'NOT_STARTED') {
      await this.requireManualCleanup(run, projection, policy);
      return;
    }
    if (projection.cleanup.status !== 'SUCCEEDED') {
      ({ run, projection } = await this.skipCleanup(run, projection));
    }

    if (policy.verification === 'NOT_CONFIGURED') {
      ({ run, projection } = await this.recordVerificationUnavailable(run, projection));
      await this.completeBlockedRecovery(run, projection);
      return;
    }

    await this.recordVerificationFailure(run, projection);
  }

  private async drain(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    policy: FaultRunResolvedRecoveryPolicy,
  ): Promise<'CONTINUE' | 'BLOCKED'> {
    if (projection.drain.status !== 'NOT_STARTED' && projection.drain.status !== 'RUNNING') {
      return isDrainUsable(projection.drain.status) ? 'CONTINUE' : 'BLOCKED';
    }
    if (policy.workerDrain.requirement === 'NOT_APPLICABLE') {
      if (projection.drain.status !== 'NOT_STARTED') {
        return isDrainUsable(projection.drain.status) ? 'CONTINUE' : 'BLOCKED';
      }
      await this.recordStep(run, projection, {
        stage: 'DRAIN',
        step: { status: 'NOT_APPLICABLE', attempt: 0 },
        phase: nextPhase(projection, 'RELEASING'),
        outcome: projection.outcome,
        residuals: projection.residuals,
        lastError: projection.lastError,
      }, 'DRAIN_COMPLETED');
      return 'CONTINUE';
    }

    const owner = requiredDrainOwner(policy);
    const expectedParticipant = faultRunDrainParticipantForOwner(owner);
    const deadlineAt = new Date(projection.deadlines.drainAt);
    let gate: FaultRunRecoveryGateResult;
    try {
      gate = await this.drainController.closeGate({
        run,
        owner,
        deadlineAt,
      });
    } catch {
      gate = { kind: 'FAILED', participant: expectedParticipant };
    }
    if (gate.participant !== expectedParticipant) {
      gate = { kind: 'FAILED', participant: expectedParticipant };
    }
    const gateMetrics = gate.kind === 'MISSING' ? undefined : gate.metrics;

    if (projection.drain.status === 'NOT_STARTED') {
      ({ run, projection } = await this.recordStep(run, projection, {
        stage: 'DRAIN',
        step: {
          status: 'RUNNING',
          attempt: projection.stop.attempt,
          startedAt: this.now().toISOString(),
          participantKinds: [expectedParticipant],
          ...(gateMetrics === undefined ? {} : { metrics: gateMetrics }),
        },
        phase: nextPhase(projection, 'DRAINING'),
        outcome: projection.outcome,
        residuals: projection.residuals,
        lastError: projection.lastError,
      }, 'DRAIN_STARTED', {
        participant: expectedParticipant,
        ...(gateMetrics ?? {}),
        deadlineAt: projection.deadlines.drainAt,
      }));
    }

    if (projection.drain.status !== 'RUNNING') {
      return isDrainUsable(projection.drain.status) ? 'CONTINUE' : 'BLOCKED';
    }

    let result: FaultRunRecoveryDrainResult;
    if (gate.kind === 'MISSING') {
      result = { kind: 'MISSING', participant: expectedParticipant };
    } else if (gate.kind === 'FAILED') {
      result = {
        kind: 'FAILED',
        participant: expectedParticipant,
        metrics: gate.metrics,
        failureKind: 'UNKNOWN',
      };
    } else {
      try {
        result = await this.withDeadline(deadlineAt, (signal) => this.drainController.drain({
          run,
          owner,
          deadlineAt,
          signal,
        }));
      } catch (error) {
        const metrics = this.drainController.snapshot?.({ run, owner });
        result = isAbortFailure(error, deadlineAt, this.now)
          ? { kind: 'TIMED_OUT', participant: expectedParticipant, metrics }
          : {
              kind: 'FAILED',
              participant: expectedParticipant,
              failureKind: 'UNKNOWN',
            };
      }
      if (result.participant !== expectedParticipant) {
        result = {
          kind: 'FAILED',
          participant: expectedParticipant,
          failureKind: 'UNKNOWN',
        };
      }
    }
    const completedAt = this.now().toISOString();
    const metrics = result.kind === 'MISSING' ? undefined : result.metrics;
    const stepBase = {
      attempt: projection.stop.attempt,
      startedAt: projection.drain.startedAt,
      completedAt,
      participantKinds: [result.participant],
      ...(metrics === undefined ? {} : { metrics }),
    };

    if (result.kind === 'DRAINED') {
      await this.recordStep(run, projection, {
        stage: 'DRAIN',
        step: { ...stepBase, status: 'SUCCEEDED' },
        phase: nextPhase(projection, 'RELEASING'),
        outcome: projection.outcome,
        residuals: projection.residuals,
        lastError: projection.lastError,
      }, 'DRAIN_COMPLETED', {
        participant: result.participant,
        ...(result.metrics ?? {}),
        completedAt,
      });
      return 'CONTINUE';
    }

    if (result.kind === 'TIMED_OUT') {
      const error = sanitizeFaultRunRecoveryError('DRAIN', { kind: 'ABORTED' });
      await this.recordStep(run, projection, {
        stage: 'DRAIN',
        step: { ...stepBase, status: 'TIMED_OUT', errorCode: error.code },
        phase: 'PARTIAL_RECOVERY',
        outcome: selectDominantFaultRunRecoveryOutcome([projection.outcome, 'DRAIN_TIMEOUT']),
        residuals: withResidual(projection.residuals, {
          kind: 'DRAIN_UNCERTAIN',
          responsibility: 'CONTROL_PLANE',
          nextAction: 'INVESTIGATE_DRAIN',
        }),
        lastError: error,
      }, 'DRAIN_TIMED_OUT', {
        participant: result.participant,
        ...(result.metrics ?? {}),
        deadlineAt: projection.deadlines.drainAt,
        completedAt,
        errorCode: error.code,
      });
      this.drainController.acknowledgeDrainTimeout?.({ run, owner });
      return 'CONTINUE';
    }

    if (result.kind === 'MISSING') {
      const error = sanitizeFaultRunRecoveryError('DRAIN', { kind: 'MISSING_PARTICIPANT' });
      const updated = await this.recordStep(run, projection, {
        stage: 'DRAIN',
        step: {
          ...stepBase,
          status: 'FAILED',
          errorCode: error.code,
        },
        phase: 'PARTIAL_RECOVERY',
        outcome: 'PARTIAL_RECOVERY',
        residuals: withResidual(projection.residuals, {
          kind: 'DRAIN_UNCERTAIN',
          responsibility: 'CONTROL_PLANE',
          nextAction: 'INVESTIGATE_DRAIN',
        }),
        lastError: error,
      }, 'DRAIN_FAILED', {
        participant: result.participant,
        completedAt,
        errorCode: error.code,
      });
      await this.completeBlockedRecovery(updated.run, updated.projection);
      return 'BLOCKED';
    }

    const error = sanitizeFaultRunRecoveryError('DRAIN', {
      kind: result.failureKind ?? 'UNKNOWN',
    });
    const outcome: FaultRunRecoveryOutcome = error.code === 'WORKER_FAILED'
      ? 'WORKER_FAILED'
      : 'PARTIAL_RECOVERY';
    const updated = await this.recordStep(run, projection, {
      stage: 'DRAIN',
      step: {
        ...stepBase,
        status: 'FAILED',
        errorCode: error.code,
      },
      phase: 'PARTIAL_RECOVERY',
      outcome: selectDominantFaultRunRecoveryOutcome([projection.outcome, outcome]),
      residuals: withResidual(projection.residuals, {
        kind: 'DRAIN_UNCERTAIN',
        responsibility: 'CONTROL_PLANE',
        nextAction: 'INVESTIGATE_DRAIN',
      }),
      lastError: error,
    }, 'DRAIN_FAILED', {
      participant: result.participant,
      ...(result.metrics ?? {}),
      completedAt,
      errorCode: error.code,
    });
    await this.completeBlockedRecovery(updated.run, updated.projection);
    return 'BLOCKED';
  }

  private async release(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    policy: FaultRunResolvedRecoveryPolicy,
  ): Promise<'CONTINUE' | 'BLOCKED'> {
    if (projection.release.status === 'NOT_STARTED') {
      ({ run, projection } = await this.recordStep(run, projection, {
        stage: 'RELEASE',
        step: {
          status: 'RUNNING',
          attempt: projection.stop.attempt,
          startedAt: this.now().toISOString(),
        },
        phase: nextPhase(projection, 'RELEASING'),
        outcome: projection.outcome,
        residuals: projection.residuals,
        lastError: projection.lastError,
      }, 'RELEASE_STARTED', { operation: policy.target.operation }));
    }
    if (projection.release.status !== 'RUNNING') {
      return projection.release.status === 'SUCCEEDED' || projection.release.status === 'NOT_APPLICABLE'
        ? 'CONTINUE'
        : 'BLOCKED';
    }

    const key = `${run.faultRunId}:${projection.stop.attempt}`;
    let settlement = this.releaseSettlements.get(key);
    if (!settlement) {
      const deadlineAt = new Date(projection.deadlines.recoveryAt);
      try {
        await this.withDeadline(deadlineAt, (signal) => this.targetAdapter.stop(run, signal));
        settlement = {
          status: 'SUCCEEDED',
          completedAt: this.now().toISOString(),
        };
      } catch (error) {
        settlement = {
          status: 'FAILED',
          completedAt: this.now().toISOString(),
          error: sanitizeFaultRunRecoveryError('RELEASE', {
            kind: targetReleaseFailureKind(error, deadlineAt, this.now),
          }),
        };
      }
      this.releaseSettlements.set(key, settlement);
    }

    if (settlement.status === 'SUCCEEDED') {
      await this.recordStep(run, projection, {
        stage: 'RELEASE',
        step: {
          status: 'SUCCEEDED',
          attempt: projection.stop.attempt,
          startedAt: projection.release.startedAt,
          completedAt: settlement.completedAt,
        },
        phase: nextPhase(projection, 'RELEASING'),
        outcome: projection.outcome,
        residuals: projection.residuals,
        lastError: projection.lastError,
      }, 'RELEASE_COMPLETED', {
        operation: policy.target.operation,
        completedAt: settlement.completedAt,
      });
      this.releaseSettlements.delete(key);
      return 'CONTINUE';
    }

    const updated = await this.recordStep(run, projection, {
      stage: 'RELEASE',
      step: {
        status: settlement.error.code === 'TARGET_RELEASE_TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
        attempt: projection.stop.attempt,
        startedAt: projection.release.startedAt,
        completedAt: settlement.completedAt,
        errorCode: settlement.error.code,
      },
      phase: 'PARTIAL_RECOVERY',
      outcome: selectDominantFaultRunRecoveryOutcome([projection.outcome, 'RELEASE_FAILED']),
      residuals: withResidual(projection.residuals, {
        kind: 'SERVICE_RECOVERY_REQUIRED',
        responsibility: 'SERVICE_OWNER',
        nextAction: 'WAIT_FOR_SERVICE_RECOVERY',
      }),
      lastError: settlement.error,
    }, 'RELEASE_FAILED', {
      operation: policy.target.operation,
      completedAt: settlement.completedAt,
      errorCode: settlement.error.code,
    });
    this.releaseSettlements.delete(key);
    await this.completeBlockedRecovery(updated.run, updated.projection);
    return 'BLOCKED';
  }

  private async skipRelease(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    policy: FaultRunResolvedRecoveryPolicy,
  ): Promise<{ run: FaultRunRecord; projection: FaultRunRecoveryProjection }> {
    if (projection.release.status !== 'NOT_STARTED') return { run, projection };
    return this.recordStep(run, projection, {
      stage: 'RELEASE',
      step: { status: 'NOT_APPLICABLE', attempt: 0 },
      phase: nextPhase(projection, 'RELEASING'),
      outcome: projection.outcome,
      residuals: projection.residuals,
      lastError: projection.lastError,
    }, 'RELEASE_SKIPPED', { operation: policy.target.operation });
  }

  private async markNonReleasing(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    policy: FaultRunResolvedRecoveryPolicy,
  ): Promise<{ run: FaultRunRecord; projection: FaultRunRecoveryProjection }> {
    if (projection.release.status !== 'NOT_STARTED') return { run, projection };
    const outcome = selectDominantFaultRunRecoveryOutcome([
      projection.outcome,
      'NON_RELEASING_ACTIVE',
    ]);
    return this.recordStep(run, projection, {
      stage: 'RELEASE',
      step: { status: 'NOT_APPLICABLE', attempt: 0 },
      phase: outcome === 'NON_RELEASING_ACTIVE' ? 'NON_RELEASING_ACTIVE' : 'PARTIAL_RECOVERY',
      outcome,
      residuals: withResidual(projection.residuals, {
        kind: 'NON_RELEASING_EFFECT',
        responsibility: 'SERVICE_OWNER',
        nextAction: 'WAIT_FOR_SERVICE_RECOVERY',
      }),
    }, 'NON_RELEASING_RECORDED', {
      operation: policy.target.operation,
      residualKind: 'NON_RELEASING_EFFECT',
      responsibility: 'SERVICE_OWNER',
      nextAction: 'WAIT_FOR_SERVICE_RECOVERY',
    });
  }

  private async skipCleanup(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
  ): Promise<{ run: FaultRunRecord; projection: FaultRunRecoveryProjection }> {
    if (projection.cleanup.status !== 'NOT_STARTED') return { run, projection };
    return this.recordStep(run, projection, {
      stage: 'CLEANUP',
      step: { status: 'NOT_APPLICABLE', attempt: 0 },
      phase: nextPhase(projection, 'VERIFYING'),
      outcome: projection.outcome,
      residuals: projection.residuals,
      lastError: projection.lastError,
    }, 'CLEANUP_SKIPPED');
  }

  private async requireManualCleanup(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    policy: FaultRunResolvedRecoveryPolicy,
  ): Promise<void> {
    if (projection.cleanup.status !== 'NOT_STARTED') return;
    await this.recordStep(run, projection, {
      stage: 'CLEANUP',
      step: {
        status: 'MANUAL_REQUIRED',
        attempt: 0,
        errorCode: 'MANUAL_CLEANUP_REQUIRED',
      },
      phase: 'MANUAL_CLEANUP_REQUIRED',
      outcome: 'MANUAL_CLEANUP_REQUIRED',
      residuals: withResidual(projection.residuals, {
        kind: 'MANUAL_CLEANUP_PENDING',
        responsibility: 'OPERATOR',
        nextAction: 'COMPLETE_MANUAL_CLEANUP',
      }),
      lastError: {
        stage: 'CLEANUP',
        code: 'MANUAL_CLEANUP_REQUIRED',
        retryable: false,
      },
    }, 'MANUAL_CLEANUP_REQUIRED', {
      operation: policy.target.operation,
      residualKind: 'MANUAL_CLEANUP_PENDING',
      responsibility: 'OPERATOR',
      nextAction: 'COMPLETE_MANUAL_CLEANUP',
    });
  }

  private async completeManualCleanup(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    policy: FaultRunResolvedRecoveryPolicy,
  ): Promise<void> {
    if (policy.cleanup !== 'OPERATOR_CONFIRMED'
      || projection.cleanup.status !== 'RUNNING'
      || projection.cleanup.requestKeyHash === undefined) {
      throw new Error('MANUAL_CLEANUP_STATE_INVALID');
    }

    const key = `${run.faultRunId}:${projection.stop.attempt}:${projection.cleanup.requestKeyHash}`;
    let settlement = this.cleanupSettlements.get(key);
    if (!settlement) {
      const deadlineAt = new Date(projection.deadlines.recoveryAt);
      try {
        await this.withDeadline(deadlineAt, (signal) => this.targetAdapter.cleanup(run, signal));
        settlement = {
          status: 'SUCCEEDED',
          completedAt: this.now().toISOString(),
        };
      } catch (error) {
        const timedOut = isAbortFailure(error, deadlineAt, this.now);
        settlement = {
          status: 'FAILED',
          completedAt: this.now().toISOString(),
          error: sanitizeFaultRunRecoveryError('CLEANUP', {
            kind: timedOut ? 'ABORTED' : 'UNKNOWN',
          }),
          timedOut,
        };
      }
      this.cleanupSettlements.set(key, settlement);
    }

    const cleanup = settlement.status === 'SUCCEEDED'
      ? {
          status: 'SUCCEEDED' as const,
          attempt: projection.stop.attempt,
          startedAt: projection.cleanup.startedAt,
          completedAt: settlement.completedAt,
        }
      : {
          status: settlement.timedOut ? 'TIMED_OUT' as const : 'FAILED' as const,
          attempt: projection.stop.attempt,
          startedAt: projection.cleanup.startedAt,
          completedAt: settlement.completedAt,
          errorCode: settlement.error.code,
        };
    const nextProjection: FaultRunRecoveryProjection = settlement.status === 'SUCCEEDED'
      ? {
          ...projection,
          phase: 'VERIFYING',
          outcome: 'PENDING',
          cleanup,
          residuals: withoutResidual(projection.residuals, 'MANUAL_CLEANUP_PENDING'),
        }
      : {
          ...projection,
          phase: 'PARTIAL_RECOVERY',
          outcome: 'CLEANUP_FAILED',
          cleanup,
          residuals: projection.residuals,
          lastError: settlement.error,
        };
    const updated = await this.store.completeManualCleanup({
      faultRunId: run.faultRunId,
      expectedAttempt: projection.stop.attempt,
      projection: nextProjection,
      eventType: settlement.status === 'SUCCEEDED'
        ? 'MANUAL_CLEANUP_COMPLETED'
        : 'MANUAL_CLEANUP_FAILED',
      eventPayload: {
        operation: policy.target.operation,
        cleanupAttempt: projection.cleanup.attempt,
        completedAt: settlement.completedAt,
        ...(settlement.status === 'FAILED' ? { errorCode: settlement.error.code } : {}),
      },
    });
    if (!updated) throw new Error('MANUAL_CLEANUP_PERSISTENCE_FAILED');
    this.logRecoverySummary(this.requireSafeProjection(updated));
    this.cleanupSettlements.delete(key);
  }

  private async recordVerificationUnavailable(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
  ): Promise<{ run: FaultRunRecord; projection: FaultRunRecoveryProjection }> {
    if (projection.verification.status === 'NOT_STARTED') {
      ({ run, projection } = await this.recordStep(run, projection, {
        stage: 'VERIFY',
        step: {
          status: 'RUNNING',
          attempt: projection.stop.attempt,
          startedAt: this.now().toISOString(),
        },
        phase: nextPhase(projection, 'VERIFYING'),
        outcome: projection.outcome,
        residuals: projection.residuals,
        lastError: projection.lastError,
      }, 'VERIFY_STARTED'));
    }
    if (projection.verification.status !== 'RUNNING') return { run, projection };

    const completedAt = this.now().toISOString();
    const error = sanitizeFaultRunRecoveryError('VERIFY', { kind: 'NOT_CONFIGURED' });
    return this.recordStep(run, projection, {
      stage: 'VERIFY',
      step: {
        status: 'NOT_CONFIGURED',
        attempt: projection.stop.attempt,
        startedAt: projection.verification.startedAt,
        completedAt,
        errorCode: error.code,
      },
      phase: 'PARTIAL_RECOVERY',
      outcome: selectDominantFaultRunRecoveryOutcome([projection.outcome, 'VERIFY_UNAVAILABLE']),
      residuals: withResidual(projection.residuals, {
        kind: 'VERIFICATION_UNAVAILABLE',
        responsibility: 'CONTROL_PLANE',
        nextAction: 'CONFIGURE_VERIFICATION',
      }),
      lastError: error,
    }, 'VERIFY_UNAVAILABLE', {
      completedAt,
      errorCode: error.code,
    });
  }

  private async recordVerificationFailure(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
  ): Promise<void> {
    if (projection.verification.status === 'NOT_STARTED') {
      ({ run, projection } = await this.recordStep(run, projection, {
        stage: 'VERIFY',
        step: {
          status: 'RUNNING',
          attempt: projection.stop.attempt,
          startedAt: this.now().toISOString(),
        },
        phase: nextPhase(projection, 'VERIFYING'),
        outcome: projection.outcome,
        residuals: projection.residuals,
        lastError: projection.lastError,
      }, 'VERIFY_STARTED'));
    }
    if (projection.verification.status !== 'RUNNING') {
      await this.completeBlockedRecovery(run, projection);
      return;
    }
    const completedAt = this.now().toISOString();
    const error = sanitizeFaultRunRecoveryError('VERIFY', { kind: 'UNKNOWN' });
    const updated = await this.recordStep(run, projection, {
      stage: 'VERIFY',
      step: {
        status: 'FAILED',
        attempt: projection.stop.attempt,
        startedAt: projection.verification.startedAt,
        completedAt,
        errorCode: error.code,
      },
      phase: 'PARTIAL_RECOVERY',
      outcome: selectDominantFaultRunRecoveryOutcome([projection.outcome, 'VERIFY_FAILED']),
      residuals: projection.residuals,
      lastError: error,
    }, 'VERIFY_FAILED', { completedAt, errorCode: error.code });
    await this.completeBlockedRecovery(updated.run, updated.projection);
  }

  private async completeBlockedRecovery(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
  ): Promise<void> {
    if (projection.outcome === 'PENDING') return;
    const completed = await this.store.complete({
      faultRunId: run.faultRunId,
      expectedAttempt: projection.stop.attempt,
      projection,
      eventType: 'RECOVERY_BLOCKED',
      eventPayload: {
        outcome: projection.outcome,
        ...lastResidualEventFacts(projection.residuals),
      },
    });
    if (completed && completed.state !== 'RECOVERING') {
      this.drainController.forgetCompletedRun?.(completed.faultRunId);
    }
    if (completed) {
      const result = parseFaultRunRecoveryProjection(completed.recoveryResult);
      if (result.kind === 'SAFE_RUNTIME_V1') this.logRecoverySummary(result.projection);
    }
  }

  private async recordStep(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    mutation: RecordFaultRunRecoveryStepInput['mutation'],
    eventType: RecordFaultRunRecoveryStepInput['eventType'],
    eventPayload?: unknown,
  ): Promise<{ run: FaultRunRecord; projection: FaultRunRecoveryProjection }> {
    const updated = await this.store.recordStep({
      faultRunId: run.faultRunId,
      expectedAttempt: projection.stop.attempt,
      mutation,
      eventType,
      eventPayload,
    });
    if (!updated) throw new Error('RECOVERY_STEP_PERSISTENCE_FAILED');
    const nextProjection = this.requireSafeProjection(updated);
    this.logRecoverySummary(nextProjection);
    return { run: updated, projection: nextProjection };
  }

  private async reloadRecovery(
    faultRunId: string,
  ): Promise<{ run: FaultRunRecord; projection: FaultRunRecoveryProjection }> {
    const run = await this.store.load(faultRunId);
    if (!run || run.state !== 'RECOVERING') throw new Error('RECOVERY_RUN_NOT_AVAILABLE');
    const projection = this.requireSafeProjection(run);
    return { run, projection };
  }

  private requireSafeProjection(run: FaultRunRecord): FaultRunRecoveryProjection {
    const result = parseFaultRunRecoveryProjection(run.recoveryResult);
    if (result.kind === 'SAFE_RUNTIME_V1') return result.projection;
    this.logger.warn({
      faultRunId: run.faultRunId,
      code: result.kind === 'UNKNOWN' ? 'RECOVERY_PROJECTION_INVALID' : 'RECOVERY_PROJECTION_LEGACY',
    }, 'Fault Run recovery executor left an unreadable recovery command unchanged');
    throw new Error(result.kind === 'UNKNOWN'
      ? 'RECOVERY_PROJECTION_INVALID'
      : 'RECOVERY_PROJECTION_LEGACY');
  }

  private logRecoverySummary(projection: FaultRunRecoveryProjection): void {
    this.logger.info({
      phase: projection.phase,
      outcome: projection.outcome,
      attempt: projection.stop.attempt,
      ...(projection.lastError ? { errorCode: projection.lastError.code } : {}),
    }, 'Fault Run recovery state persisted');
  }

  private async withDeadline<T>(
    deadlineAt: Date,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const remainingMs = Math.max(0, deadlineAt.getTime() - this.now().getTime());
    if (remainingMs === 0) {
      controller.abort();
      throw new RecoveryDeadlineExceededError();
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new RecoveryDeadlineExceededError());
      }, remainingMs);
    });
    try {
      return await Promise.race([operation(controller.signal), deadline]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

function isActionableRecovery(projection: FaultRunRecoveryProjection): boolean {
  if (['STOP_REQUESTED', 'DRAINING', 'RELEASING', 'VERIFYING', 'CLEANING'].includes(projection.phase)) {
    return true;
  }
  return projection.phase === 'PARTIAL_RECOVERY'
    && (projection.outcome === 'DRAIN_TIMEOUT' || projection.outcome === 'SERVICE_UNAVAILABLE')
    && (
      isPendingRecoveryStep(projection.release)
      || (isSettledRecoveryStep(projection.release) && isPendingRecoveryStep(projection.cleanup))
      || (isSettledRecoveryStep(projection.release)
        && isSettledRecoveryStep(projection.cleanup)
        && isPendingRecoveryStep(projection.verification))
    );
}

function isDrainUsable(status: FaultRunRecoveryStep['status']): boolean {
  return status === 'SUCCEEDED' || status === 'TIMED_OUT' || status === 'NOT_APPLICABLE';
}

function isPendingRecoveryStep(step: FaultRunRecoveryStep): boolean {
  return step.status === 'NOT_STARTED' || step.status === 'RUNNING';
}

function isSettledRecoveryStep(step: FaultRunRecoveryStep): boolean {
  return step.status !== 'NOT_STARTED'
    && step.status !== 'RUNNING'
    && step.status !== 'MANUAL_REQUIRED';
}

function requiredDrainOwner(policy: FaultRunResolvedRecoveryPolicy): FaultRunWorkerDrainOwner {
  if (policy.workerDrain.requirement === 'REQUIRED' && policy.workerDrain.owner) {
    return policy.workerDrain.owner;
  }
  throw new Error('RECOVERY_DRAIN_OWNER_REQUIRED');
}

function nextPhase(
  projection: FaultRunRecoveryProjection,
  pendingPhase: Extract<FaultRunRecoveryProjection['phase'], 'DRAINING' | 'RELEASING' | 'VERIFYING'>,
): FaultRunRecoveryProjection['phase'] {
  return projection.outcome === 'PENDING' ? pendingPhase : 'PARTIAL_RECOVERY';
}

function withResidual(
  current: readonly FaultRunRecoveryResidual[],
  residual: FaultRunRecoveryResidual,
): readonly FaultRunRecoveryResidual[] {
  return current.some((item) => item.kind === residual.kind) ? current : [...current, residual];
}

function withoutResidual(
  current: readonly FaultRunRecoveryResidual[],
  kind: FaultRunRecoveryResidual['kind'],
): readonly FaultRunRecoveryResidual[] {
  return current.filter((residual) => residual.kind !== kind);
}

function lastResidualEventFacts(
  residuals: readonly FaultRunRecoveryResidual[],
): Record<string, unknown> {
  const residual = residuals.at(-1);
  return residual ? {
    residualKind: residual.kind,
    responsibility: residual.responsibility,
    nextAction: residual.nextAction,
  } : {};
}

function isAbortFailure(error: unknown, deadlineAt: Date, now: () => Date): boolean {
  return error instanceof RecoveryDeadlineExceededError
    || (error instanceof Error && error.name === 'AbortError')
    || now().getTime() >= deadlineAt.getTime();
}

function targetReleaseFailureKind(
  error: unknown,
  deadlineAt: Date,
  now: () => Date,
): 'ABORTED' | 'UNAVAILABLE' | 'REJECTED' | 'UNKNOWN' {
  if (isAbortFailure(error, deadlineAt, now)) return 'ABORTED';
  if (error instanceof GatewayRequestError) {
    return error.status >= 500 ? 'UNAVAILABLE' : 'REJECTED';
  }
  return 'UNKNOWN';
}

function recoveryExecutorErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z_]{3,96}$/.test(error.message)) return error.message;
  return 'RECOVERY_EXECUTION_FAILED';
}

let executor: FaultRunRecoveryExecutor | null = null;

export function getFaultRunRecoveryExecutor(options: FaultRunRecoveryExecutorOptions): FaultRunRecoveryExecutor {
  if (!executor) {
    executor = new FaultRunRecoveryExecutor(
      new SqlFaultRunRecoveryStore(),
      getFaultRunDrainRegistry(),
      new GatewayFaultRunTargetAdapter(),
      options,
    );
  }
  return executor;
}
