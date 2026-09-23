import pino from 'pino';
import {
  completeFaultRunManualCleanup,
  completeFaultRunRecovery,
  appendFaultRunEvent,
  listExpiredRunnableFaultRuns,
  listPendingTerminalCleanupFaultRuns,
  listRecoveringFaultRuns,
  loadFaultRun,
  recordFaultRunRecoveryStep,
  requestFaultRunStop,
  finishOwnedFaultRunAction,
  settleOwnedFaultRunRecoveryAction,
  startOwnedFaultRunRelease,
  type CompleteFaultRunRecoveryInput,
  type CompleteFaultRunManualCleanupInput,
  type FaultRunRecord,
  type RecordFaultRunRecoveryStepInput,
  type RequestFaultRunStopInput,
} from '../lib/fault-run-repository';
import {
  claimFaultRunAction,
  listFaultRunActions,
  markOwnedFaultRunActionUnknown,
  markStaleFaultRunActionUnknown,
  type FaultRunActionRecord,
} from '../lib/fault-run-action-repository';
import {
  claimFaultRunExecution,
  heartbeatFaultRunExecution,
  loadFaultRunExecution,
  markFaultRunExecutionLeaseLost,
  relinquishFaultRunExecution,
  updateOwnedFaultRunExecution,
  type FaultRunExecutionRecord,
} from '../lib/fault-run-execution-repository';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
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

interface RecoveryOwnerLease {
  execution: FaultRunExecutionRecord;
  fence: FaultRunOwnerFence;
  timer: ReturnType<typeof setInterval>;
  heartbeatPending: boolean;
  heartbeatPromise: Promise<void> | null;
  drainState: 'DRAINED' | 'DRAIN_TIMEOUT' | 'NOT_APPLICABLE' | null;
}

export interface FaultRunRecoveryStore {
  load(faultRunId: string): Promise<FaultRunRecord | null>;
  listRecovering(): Promise<FaultRunRecord[]>;
  listExpiredRunnable(now: Date): Promise<FaultRunRecord[]>;
  listPendingTerminalCleanup?(): Promise<FaultRunRecord[]>;
  requestStop(input: RequestFaultRunStopInput): ReturnType<typeof requestFaultRunStop>;
  recordStep(input: RecordFaultRunRecoveryStepInput): Promise<FaultRunRecord | null>;
  complete(input: CompleteFaultRunRecoveryInput): Promise<FaultRunRecord | null>;
  completeManualCleanup(input: CompleteFaultRunManualCleanupInput): Promise<FaultRunRecord | null>;
  loadExecution?(faultRunId: string): Promise<FaultRunExecutionRecord | null>;
  claimExecution?(input: Parameters<typeof claimFaultRunExecution>[0]): Promise<FaultRunExecutionRecord | null>;
  heartbeatExecution?(input: Parameters<typeof heartbeatFaultRunExecution>[0]): Promise<boolean>;
  markLeaseLost?(input: Parameters<typeof markFaultRunExecutionLeaseLost>[0]): Promise<boolean>;
  updateExecution?(input: Parameters<typeof updateOwnedFaultRunExecution>[0]): Promise<boolean>;
  relinquishExecution?(input: Parameters<typeof relinquishFaultRunExecution>[0]): Promise<boolean>;
  listActions?(faultRunId: string): Promise<FaultRunActionRecord[]>;
  claimAction?(input: Parameters<typeof claimFaultRunAction>[0]): Promise<FaultRunActionRecord | null>;
  markStaleActionUnknown?(
    input: Parameters<typeof markStaleFaultRunActionUnknown>[0],
  ): Promise<boolean>;
  markActionUnknown?(
    input: Parameters<typeof markOwnedFaultRunActionUnknown>[0],
  ): Promise<boolean>;
  startOwnedRelease?(
    input: Parameters<typeof startOwnedFaultRunRelease>[0],
  ): ReturnType<typeof startOwnedFaultRunRelease>;
  settleOwnedRecoveryAction?(
    input: Parameters<typeof settleOwnedFaultRunRecoveryAction>[0],
  ): ReturnType<typeof settleOwnedFaultRunRecoveryAction>;
  finishOwnedAction?(
    input: Parameters<typeof finishOwnedFaultRunAction>[0],
  ): ReturnType<typeof finishOwnedFaultRunAction>;
  appendEvent?(faultRunId: string, eventType: string, payload?: unknown): Promise<void>;
}

export class SqlFaultRunRecoveryStore implements FaultRunRecoveryStore {
  load(faultRunId: string) { return loadFaultRun(faultRunId); }
  listRecovering() { return listRecoveringFaultRuns(); }
  listExpiredRunnable(now: Date) { return listExpiredRunnableFaultRuns(now); }
  listPendingTerminalCleanup() { return listPendingTerminalCleanupFaultRuns(); }
  requestStop(input: RequestFaultRunStopInput) { return requestFaultRunStop(input); }
  recordStep(input: RecordFaultRunRecoveryStepInput) { return recordFaultRunRecoveryStep(input); }
  complete(input: CompleteFaultRunRecoveryInput) { return completeFaultRunRecovery(input); }
  completeManualCleanup(input: CompleteFaultRunManualCleanupInput) {
    return completeFaultRunManualCleanup(input);
  }
  loadExecution(faultRunId: string) { return loadFaultRunExecution(faultRunId); }
  claimExecution(input: Parameters<typeof claimFaultRunExecution>[0]) {
    return claimFaultRunExecution(input);
  }
  heartbeatExecution(input: Parameters<typeof heartbeatFaultRunExecution>[0]) {
    return heartbeatFaultRunExecution(input);
  }
  markLeaseLost(input: Parameters<typeof markFaultRunExecutionLeaseLost>[0]) {
    return markFaultRunExecutionLeaseLost(input);
  }
  updateExecution(input: Parameters<typeof updateOwnedFaultRunExecution>[0]) {
    return updateOwnedFaultRunExecution(input);
  }
  relinquishExecution(input: Parameters<typeof relinquishFaultRunExecution>[0]) {
    return relinquishFaultRunExecution(input);
  }
  listActions(faultRunId: string) { return listFaultRunActions(faultRunId); }
  claimAction(input: Parameters<typeof claimFaultRunAction>[0]) { return claimFaultRunAction(input); }
  markStaleActionUnknown(input: Parameters<typeof markStaleFaultRunActionUnknown>[0]) {
    return markStaleFaultRunActionUnknown(input);
  }
  markActionUnknown(input: Parameters<typeof markOwnedFaultRunActionUnknown>[0]) {
    return markOwnedFaultRunActionUnknown(input);
  }
  startOwnedRelease(input: Parameters<typeof startOwnedFaultRunRelease>[0]) {
    return startOwnedFaultRunRelease(input);
  }
  settleOwnedRecoveryAction(input: Parameters<typeof settleOwnedFaultRunRecoveryAction>[0]) {
    return settleOwnedFaultRunRecoveryAction(input);
  }
  finishOwnedAction(input: Parameters<typeof finishOwnedFaultRunAction>[0]) {
    return finishOwnedFaultRunAction(input);
  }
  appendEvent(faultRunId: string, eventType: string, payload?: unknown) {
    return appendFaultRunEvent(faultRunId, eventType, payload);
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
  ownerId?: string;
  leaseTtlMs?: number;
  heartbeatMs?: number;
  ownershipRequired?: boolean;
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
  private readonly ownerLeases = new Map<string, RecoveryOwnerLease>();
  private readonly ownerRequiredRunIds = new Set<string>();
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
    if (options.ownerId !== undefined
      && (!Number.isSafeInteger(options.leaseTtlMs)
        || !Number.isSafeInteger(options.heartbeatMs)
        || options.leaseTtlMs! < 1
        || options.heartbeatMs! < 1
        || options.heartbeatMs! >= options.leaseTtlMs!)) {
      throw new Error('INVALID_RECOVERY_OWNER_TIMINGS');
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
    await Promise.all([...this.ownerLeases.values()].map((lease) =>
      this.disposeRecoveryOwner(lease, true)));
    this.ownerRequiredRunIds.clear();
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
    const [recoveringRuns, expiredRuns, terminalCleanupRuns] = await Promise.all([
      this.store.listRecovering(),
      this.store.listExpiredRunnable(now),
      this.listPendingTerminalCleanup(),
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
    for (const terminalCleanup of terminalCleanupRuns) {
      if (this.stopping) return;
      candidates.set(terminalCleanup.faultRunId, terminalCleanup);
    }

    await Promise.all([...candidates.values()].map((run) =>
      this.stopping ? Promise.resolve() : this.execute(run.faultRunId)));
  }

  private async listPendingTerminalCleanup(): Promise<FaultRunRecord[]> {
    if (!this.store.listPendingTerminalCleanup) return [];
    try {
      return await this.store.listPendingTerminalCleanup();
    } catch (error) {
      if (!this.options.ownershipRequired
        && error instanceof Error
        && error.message.startsWith('FAULT_RUN_OWNERSHIP_MIGRATION_REQUIRED')) {
        this.logger.info('Skipping owner-journal cleanup scan while reconciliation is OFF');
        return [];
      }
      throw error;
    }
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
    if (!run) return;
    if (isTerminalFaultRun(run)) {
      await this.recoverTerminalCleanup(run);
      return;
    }
    if (run.state !== 'RECOVERING') return;

    let projection = this.requireSafeProjection(run);
    if (!isActionableRecovery(projection)) return;
    if (this.options.ownershipRequired && !run.execution) {
      this.logger.warn({
        faultRunId,
        code: 'RECOVERY_OWNERSHIP_MISSING',
      }, 'Fault Run recovery requires an ownership record');
      return;
    }
    const policy = resolveFaultRunRecoveryPolicy(getScenarioDefinition(run.scenario));
    try {
      if (run.execution && !await this.ensureRecoveryOwner(run, projection)) return;
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
    } finally {
      await this.finishRecoveryOwner(faultRunId);
    }
  }

  private async ensureRecoveryOwner(
    run: FaultRunRecord,
    projection?: FaultRunRecoveryProjection,
  ): Promise<RecoveryOwnerLease | null> {
    const ownerId = this.options.ownerId;
    if (!ownerId || !this.store.loadExecution || !this.store.claimExecution
      || !this.store.heartbeatExecution || !this.store.updateExecution
      || !this.store.relinquishExecution || !this.store.listActions) {
      return null;
    }
    const execution = await this.store.loadExecution(run.faultRunId);
    if (!execution || execution.reconciliationState === 'MANUAL_INTERVENTION_REQUIRED') return null;
    this.ownerRequiredRunIds.add(run.faultRunId);

    const actions = await this.store.listActions(run.faultRunId);
    const staleDispatches = actions.filter((action) => action.actionState === 'DISPATCHING'
      && (execution.ownerId !== action.dispatchOwnerId
        || execution.ownerEpoch > (action.dispatchOwnerEpoch ?? 0)
        || (execution.leaseExpiresAt !== null
          && Date.parse(execution.leaseExpiresAt) <= this.now().getTime())));
    if (staleDispatches.length > 0) {
      for (const action of staleDispatches) {
        if (!action.dispatchOwnerId || action.dispatchOwnerEpoch === null) continue;
        await this.markStaleActionUnknown({
          actionId: action.actionId,
          dispatchOwnerId: action.dispatchOwnerId,
          dispatchOwnerEpoch: action.dispatchOwnerEpoch,
          errorCode: 'OWNER_LEASE_EXPIRED',
        });
      }
      return null;
    }
    if (actions.some((action) => action.actionState === 'OUTCOME_UNKNOWN')) return null;

    const now = this.now().getTime();
    const leaseIsLive = execution.ownerId !== null
      && execution.leaseExpiresAt !== null
      && Date.parse(execution.leaseExpiresAt) > now;
    const local = this.ownerLeases.get(run.faultRunId);
    if (local && (local.execution.ownerId !== execution.ownerId
      || local.execution.ownerEpoch !== execution.ownerEpoch
      || !leaseIsLive)) {
      this.detachRecoveryOwner(local);
    }
    if (execution.ownerId === ownerId && leaseIsLive) {
      const currentLocal = this.ownerLeases.get(run.faultRunId);
      if (currentLocal?.execution.ownerEpoch === execution.ownerEpoch) {
        return currentLocal.fence.isLocallyCurrent() ? currentLocal : null;
      }
      return this.startRecoveryOwner(execution, desiredRecoveryDrainState(run, projection));
    }
    if (execution.ownerId !== null && !leaseIsLive) {
      if (execution.leaseExpiresAt === null
        || execution.executionMode !== 'TAKEOVER') return null;
    } else if (execution.ownerId !== null) {
      return null;
    }

    const initial = execution.ownerId === null && execution.ownerEpoch === 0;
    const claimed = await this.store.claimExecution({
      faultRunId: run.faultRunId,
      executionMode: execution.executionMode,
      ownerId,
      leaseTtlMs: this.options.leaseTtlMs!,
      reconciliationState: initial ? 'OWNED' : 'TAKEN_OVER',
      lastAction: initial ? 'OWNER_LEASE_ACQUIRED' : 'OWNER_TAKEOVER_COMPLETED',
    });
    if (!claimed) return null;
    const drainState = desiredRecoveryDrainState(run, projection);
    const lease = await this.startRecoveryOwner(claimed, drainState);
    if (lease && this.store.appendEvent) {
      await this.store.appendEvent(run.faultRunId, initial
        ? 'OWNER_LEASE_ACQUIRED'
        : 'OWNER_TAKEOVER_COMPLETED', {
        ownerEpoch: claimed.ownerEpoch,
        reason: initial ? 'INITIAL' : 'TAKEOVER',
        component: 'RECOVERY',
      });
    }
    return lease;
  }

  private async startRecoveryOwner(
    execution: FaultRunExecutionRecord,
    drainState: RecoveryOwnerLease['drainState'],
  ): Promise<RecoveryOwnerLease | null> {
    const fence = new FaultRunOwnerFence(
      execution.faultRunId,
      execution.ownerId!,
      execution.ownerEpoch,
    );
    const lease: RecoveryOwnerLease = {
      execution,
      fence,
      timer: setInterval(() => {
        const heartbeat = this.heartbeatRecoveryOwner(lease);
        lease.heartbeatPromise = heartbeat;
        void heartbeat.finally(() => {
          if (lease.heartbeatPromise === heartbeat) lease.heartbeatPromise = null;
        });
      }, this.options.heartbeatMs!),
      heartbeatPending: false,
      heartbeatPromise: null,
      drainState,
    };
    this.ownerLeases.set(execution.faultRunId, lease);
    if (drainState) {
      const updated = await this.store.updateExecution?.({
        faultRunId: execution.faultRunId,
        ownerId: fence.ownerId,
        ownerEpoch: fence.ownerEpoch,
        drainState,
        lastAction: drainState === 'DRAIN_TIMEOUT'
          ? 'OWNER_DRAIN_TIMEOUT'
          : 'OWNER_DRAIN_COMPLETED',
      });
      if (!updated) {
        await this.disposeRecoveryOwner(lease, false);
        return null;
      }
    }
    return lease;
  }

  private async heartbeatRecoveryOwner(lease: RecoveryOwnerLease): Promise<void> {
    if (lease.heartbeatPending || !lease.fence.isLocallyCurrent()) return;
    lease.heartbeatPending = true;
    try {
      const renewed = await this.store.heartbeatExecution?.({
        faultRunId: lease.execution.faultRunId,
        ownerId: lease.fence.ownerId,
        ownerEpoch: lease.fence.ownerEpoch,
        leaseTtlMs: this.options.leaseTtlMs!,
      });
      if (renewed) return;
      lease.fence.lose('HEARTBEAT_REJECTED');
      clearInterval(lease.timer);
      if (this.ownerLeases.get(lease.execution.faultRunId) === lease) {
        this.ownerLeases.delete(lease.execution.faultRunId);
      }
      await this.store.markLeaseLost?.({
        faultRunId: lease.execution.faultRunId,
        ownerId: lease.fence.ownerId,
        ownerEpoch: lease.fence.ownerEpoch,
        errorCode: 'HEARTBEAT_REJECTED',
      });
      await this.store.appendEvent?.(lease.execution.faultRunId, 'OWNER_LEASE_LOST', {
        ownerEpoch: lease.fence.ownerEpoch,
        reason: 'HEARTBEAT_REJECTED',
      });
      this.logger.warn({
        faultRunId: lease.execution.faultRunId,
        ownerEpoch: lease.fence.ownerEpoch,
        code: 'HEARTBEAT_REJECTED',
      }, 'Fault Run recovery owner lease was lost');
    } catch (error) {
      lease.fence.lose('HEARTBEAT_FAILED');
      clearInterval(lease.timer);
      if (this.ownerLeases.get(lease.execution.faultRunId) === lease) {
        this.ownerLeases.delete(lease.execution.faultRunId);
      }
      this.logger.warn({
        faultRunId: lease.execution.faultRunId,
        ownerEpoch: lease.fence.ownerEpoch,
        code: recoveryExecutorErrorCode(error),
      }, 'Fault Run recovery owner heartbeat failed');
    } finally {
      lease.heartbeatPending = false;
    }
  }

  private async setRecoveryDrainState(
    faultRunId: string,
    drainState: NonNullable<RecoveryOwnerLease['drainState']>,
  ): Promise<void> {
    const lease = this.ownerLeases.get(faultRunId);
    if (!lease) return;
    const updated = await this.store.updateExecution?.({
      faultRunId,
      ownerId: lease.fence.ownerId,
      ownerEpoch: lease.fence.ownerEpoch,
      drainState,
      lastAction: drainState === 'DRAIN_TIMEOUT'
        ? 'OWNER_DRAIN_TIMEOUT'
        : 'OWNER_DRAIN_COMPLETED',
      lastErrorCode: drainState === 'DRAIN_TIMEOUT' ? 'DRAIN_TIMEOUT' : null,
    });
    if (!updated) {
      lease.fence.lose('OWNER_LEASE_LOST');
      throw new Error('RECOVERY_OWNER_LEASE_LOST');
    }
    lease.drainState = drainState;
  }

  private async finishRecoveryOwner(faultRunId: string): Promise<void> {
    const lease = this.ownerLeases.get(faultRunId);
    if (!lease) return;
    const [run, execution] = await Promise.all([
      this.store.load(faultRunId),
      this.store.loadExecution?.(faultRunId) ?? Promise.resolve(null),
    ]);
    if (!run || isTerminalFaultRun(run)
      || execution?.reconciliationState === 'MANUAL_INTERVENTION_REQUIRED') {
      await this.disposeRecoveryOwner(lease, false);
    }
  }

  private async disposeRecoveryOwner(
    lease: RecoveryOwnerLease,
    shutdown: boolean,
  ): Promise<void> {
    if (this.ownerLeases.get(lease.execution.faultRunId) !== lease) return;
    clearInterval(lease.timer);
    if (lease.heartbeatPromise) await lease.heartbeatPromise;
    const safeDrainState = lease.drainState === 'DRAINED'
      || lease.drainState === 'NOT_APPLICABLE';
    const execution = await this.store.loadExecution?.(lease.execution.faultRunId);
    const canRelinquish = execution?.reconciliationState !== 'MANUAL_INTERVENTION_REQUIRED';
    if (lease.fence.isLocallyCurrent() && safeDrainState && canRelinquish) {
      const updated = await this.store.updateExecution?.({
        faultRunId: lease.execution.faultRunId,
        ownerId: lease.fence.ownerId,
        ownerEpoch: lease.fence.ownerEpoch,
        drainState: lease.drainState!,
        lastAction: shutdown ? 'OWNER_RELINQUISHED' : 'RECOVERY_COMPLETED',
      });
      if (updated) {
        await this.store.relinquishExecution?.({
          faultRunId: lease.execution.faultRunId,
          ownerId: lease.fence.ownerId,
          ownerEpoch: lease.fence.ownerEpoch,
        });
      }
    }
    lease.fence.lose(shutdown ? 'PROCESS_SHUTDOWN' : 'OWNER_RELINQUISHED');
    this.ownerLeases.delete(lease.execution.faultRunId);
    this.ownerRequiredRunIds.delete(lease.execution.faultRunId);
  }

  private detachRecoveryOwner(lease: RecoveryOwnerLease): void {
    clearInterval(lease.timer);
    lease.fence.lose('OWNER_EPOCH_CHANGED');
    if (this.ownerLeases.get(lease.execution.faultRunId) === lease) {
      this.ownerLeases.delete(lease.execution.faultRunId);
    }
  }

  private async recoverTerminalCleanup(run: FaultRunRecord): Promise<void> {
    if (this.options.ownershipRequired && !run.execution) {
      this.logger.warn({
        faultRunId: run.faultRunId,
        code: 'RECOVERY_OWNERSHIP_MISSING',
      }, 'Terminal cleanup requires an ownership record');
      return;
    }
    if (!run.execution) return;
    try {
      const owner = await this.ensureRecoveryOwner(run);
      if (!owner) return;
      const actions = await this.listActions(run.faultRunId);
      const action = actions.find((candidate) => candidate.actionType === 'CLEANUP'
        && candidate.requestedBy === 'OPERATOR'
        && candidate.actionState === 'REQUESTED');
      if (!action) return;
      const claimed = await this.claimAction({
        actionId: action.actionId,
        ownerId: owner.fence.ownerId,
        ownerEpoch: owner.fence.ownerEpoch,
      });
      if (!claimed) return;
      let dispatched = false;
      let response: unknown;
      try {
        response = await this.withDeadline(
          new Date(this.now().getTime() + this.options.recoveryTimeoutMs),
          (signal) => {
            owner.fence.assertLocallyCurrent();
            dispatched = true;
            return this.targetAdapter.cleanup(run, combineSignals(signal, owner.fence.signal));
          },
        );
      } catch (error) {
        const outcome = classifyRecoveryActionFailure(error, dispatched, 'CLEANUP');
        if (outcome.kind === 'UNKNOWN') {
          await this.markActionOutcomeUnknown(owner, claimed, outcome.errorCode);
          return;
        }
        await this.finishTerminalCleanup(
          run,
          owner,
          claimed,
          'DEFINITIVE_FAILURE',
          null,
          outcome.kind === 'TIMEOUT' ? 'CLEANUP_OPERATION_FAILED' : outcome.errorCode,
        );
        return;
      }
      const outcome = classifyRecoveryActionResponse(response, 'CLEANUP', run);
      if (outcome.kind === 'UNKNOWN') {
        await this.markActionOutcomeUnknown(owner, claimed, outcome.errorCode);
        return;
      }
      if (outcome.kind === 'DEFINITIVE_FAILURE') {
        await this.finishTerminalCleanup(run, owner, claimed, 'DEFINITIVE_FAILURE', null, outcome.errorCode);
        return;
      }
      await this.finishTerminalCleanup(run, owner, claimed, 'CONFIRMED', outcome.summary, null);
    } finally {
      await this.finishRecoveryOwner(run.faultRunId);
    }
  }

  private async finishTerminalCleanup(
    run: FaultRunRecord,
    owner: RecoveryOwnerLease,
    action: FaultRunActionRecord,
    actionState: 'CONFIRMED' | 'DEFINITIVE_FAILURE',
    resultSummary: unknown,
    errorCode: string | null,
  ): Promise<void> {
    const finished = await this.finishOwnedAction({
      faultRunId: action.faultRunId,
      actionId: action.actionId,
      actionType: 'CLEANUP',
      ownerId: owner.fence.ownerId,
      ownerEpoch: owner.fence.ownerEpoch,
      actionState,
      resultSummary,
      errorCode,
      eventType: actionState === 'CONFIRMED'
        ? 'MANUAL_CLEANUP_COMPLETED'
        : 'MANUAL_CLEANUP_FAILED',
      eventPayload: {
        cleanupAttempt: action.attemptNo,
        operation: run.targetOperation,
        ...(errorCode ? { errorCode } : {}),
        completedAt: this.now().toISOString(),
      },
    });
    if (!finished) throw new Error('CLEANUP_ACTION_PERSISTENCE_FAILED');
  }

  private async markActionOutcomeUnknown(
    owner: RecoveryOwnerLease,
    action: FaultRunActionRecord,
    errorCode: string,
  ): Promise<void> {
    const marked = await this.markActionUnknown({
      actionId: action.actionId,
      actionType: action.actionType as 'RELEASE' | 'CLEANUP',
      ownerId: owner.fence.ownerId,
      ownerEpoch: owner.fence.ownerEpoch,
      errorCode,
    });
    if (!marked) throw new Error('ACTION_OUTCOME_UNKNOWN_PERSISTENCE_FAILED');
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
      await this.setRecoveryDrainState(run.faultRunId, 'NOT_APPLICABLE');
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
      await this.setRecoveryDrainState(run.faultRunId, 'DRAINED');
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
      await this.setRecoveryDrainState(run.faultRunId, 'DRAIN_TIMEOUT');
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
    if (run.execution) {
      const owner = this.ownerLeases.get(run.faultRunId);
      if (!owner) throw new Error('RECOVERY_OWNER_REQUIRED');
      return this.releaseOwned(run, projection, policy, owner);
    }
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

  private async releaseOwned(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    policy: FaultRunResolvedRecoveryPolicy,
    owner: RecoveryOwnerLease,
  ): Promise<'CONTINUE' | 'BLOCKED'> {
    let actionId: string | null = null;
    const requestIdempotencyKey = `release-${run.faultRunId}-${projection.stop.attempt}`;
    if (projection.release.status === 'NOT_STARTED') {
      const startedAt = this.now().toISOString();
      const started = await this.startOwnedRelease({
        faultRunId: run.faultRunId,
        ownerId: owner.fence.ownerId,
        ownerEpoch: owner.fence.ownerEpoch,
        expectedAttempt: projection.stop.attempt,
        requestIdempotencyKey,
        mutation: {
          stage: 'RELEASE',
          step: {
            status: 'RUNNING',
            attempt: projection.stop.attempt,
            startedAt,
          },
          phase: nextPhase(projection, 'RELEASING'),
          outcome: projection.outcome,
          residuals: projection.residuals,
          lastError: projection.lastError,
        },
        eventPayload: { operation: policy.target.operation },
      });
      if (!started) return 'BLOCKED';
      run = started.run;
      projection = this.requireSafeProjection(run);
      actionId = started.actionId;
    }
    if (projection.release.status !== 'RUNNING') {
      return projection.release.status === 'SUCCEEDED' || projection.release.status === 'NOT_APPLICABLE'
        ? 'CONTINUE'
        : 'BLOCKED';
    }

    const actions = await this.listActions(run.faultRunId);
    const action = actionId
      ? actions.find((candidate) => candidate.actionId === actionId)
      : actions.find((candidate) => candidate.actionType === 'RELEASE'
        && candidate.requestIdempotencyKey === requestIdempotencyKey);
    if (!action) throw new Error('RELEASE_ACTION_INTENT_MISSING');
    if (action.actionState !== 'REQUESTED') return 'BLOCKED';
    const claimed = await this.claimAction({
      actionId: action.actionId,
      ownerId: owner.fence.ownerId,
      ownerEpoch: owner.fence.ownerEpoch,
    });
    if (!claimed) return 'BLOCKED';

    let dispatched = false;
    let response: unknown;
    try {
      response = await this.withDeadline(
        new Date(projection.deadlines.recoveryAt),
        (signal) => {
          owner.fence.assertLocallyCurrent();
          dispatched = true;
          return this.targetAdapter.stop(run, combineSignals(signal, owner.fence.signal));
        },
      );
    } catch (error) {
      const outcome = classifyRecoveryActionFailure(error, dispatched, 'RELEASE');
      if (outcome.kind === 'UNKNOWN') {
        await this.markActionOutcomeUnknown(owner, claimed, outcome.errorCode);
        return 'BLOCKED';
      }
      const failure = sanitizeFaultRunRecoveryError('RELEASE', {
        kind: outcome.kind === 'TIMEOUT' ? 'ABORTED' : 'REJECTED',
      });
      const completedAt = this.now().toISOString();
      const updated = await this.settleOwnedRecoveryAction(
        run,
        projection,
        owner,
        claimed,
        'DEFINITIVE_FAILURE',
        null,
        failure.code,
        {
          stage: 'RELEASE',
          step: {
            status: failure.code === 'TARGET_RELEASE_TIMEOUT' ? 'TIMED_OUT' : 'FAILED',
            attempt: projection.stop.attempt,
            startedAt: projection.release.startedAt,
            completedAt,
            errorCode: failure.code,
          },
          phase: 'PARTIAL_RECOVERY',
          outcome: selectDominantFaultRunRecoveryOutcome([projection.outcome, 'RELEASE_FAILED']),
          residuals: withResidual(projection.residuals, {
            kind: 'SERVICE_RECOVERY_REQUIRED',
            responsibility: 'SERVICE_OWNER',
            nextAction: 'WAIT_FOR_SERVICE_RECOVERY',
          }),
          lastError: failure,
        },
        'RELEASE_FAILED',
        {
          operation: policy.target.operation,
          completedAt,
          errorCode: failure.code,
        },
      );
      await this.completeBlockedRecovery(updated.run, updated.projection);
      return 'BLOCKED';
    }

    const outcome = classifyRecoveryActionResponse(response, 'RELEASE', run);
    if (outcome.kind === 'UNKNOWN') {
      await this.markActionOutcomeUnknown(owner, claimed, outcome.errorCode);
      return 'BLOCKED';
    }
    if (outcome.kind === 'DEFINITIVE_FAILURE') {
      const failure = sanitizeFaultRunRecoveryError('RELEASE', { kind: 'REJECTED' });
      const completedAt = this.now().toISOString();
      const updated = await this.settleOwnedRecoveryAction(
        run,
        projection,
        owner,
        claimed,
        'DEFINITIVE_FAILURE',
        null,
        failure.code,
        {
          stage: 'RELEASE',
          step: {
            status: 'FAILED',
            attempt: projection.stop.attempt,
            startedAt: projection.release.startedAt,
            completedAt,
            errorCode: failure.code,
          },
          phase: 'PARTIAL_RECOVERY',
          outcome: selectDominantFaultRunRecoveryOutcome([projection.outcome, 'RELEASE_FAILED']),
          residuals: withResidual(projection.residuals, {
            kind: 'SERVICE_RECOVERY_REQUIRED',
            responsibility: 'SERVICE_OWNER',
            nextAction: 'WAIT_FOR_SERVICE_RECOVERY',
          }),
          lastError: failure,
        },
        'RELEASE_FAILED',
        {
          operation: policy.target.operation,
          completedAt,
          errorCode: failure.code,
        },
      );
      await this.completeBlockedRecovery(updated.run, updated.projection);
      return 'BLOCKED';
    }

    const completedAt = this.now().toISOString();
    await this.settleOwnedRecoveryAction(
      run,
      projection,
      owner,
      claimed,
      'CONFIRMED',
      outcome.summary,
      null,
      {
        stage: 'RELEASE',
        step: {
          status: 'SUCCEEDED',
          attempt: projection.stop.attempt,
          startedAt: projection.release.startedAt,
          completedAt,
        },
        phase: nextPhase(projection, 'RELEASING'),
        outcome: projection.outcome,
        residuals: projection.residuals,
        lastError: projection.lastError,
      },
      'RELEASE_COMPLETED',
      {
        operation: policy.target.operation,
        completedAt,
      },
    );
    return 'CONTINUE';
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

    if (run.execution) {
      const owner = this.ownerLeases.get(run.faultRunId);
      if (!owner) throw new Error('RECOVERY_OWNER_REQUIRED');
      await this.completeOwnedManualCleanup(run, projection, policy, owner);
      return;
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

  private async completeOwnedManualCleanup(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    policy: FaultRunResolvedRecoveryPolicy,
    owner: RecoveryOwnerLease,
  ): Promise<void> {
    const actions = await this.listActions(run.faultRunId);
    const action = actions.find((candidate) => candidate.actionType === 'CLEANUP'
      && candidate.requestIdempotencyKey === projection.cleanup.requestKeyHash);
    if (!action || action.actionState !== 'REQUESTED') return;
    const claimed = await this.claimAction({
      actionId: action.actionId,
      ownerId: owner.fence.ownerId,
      ownerEpoch: owner.fence.ownerEpoch,
    });
    if (!claimed) return;

    let dispatched = false;
    let response: unknown;
    try {
      response = await this.withDeadline(
        new Date(projection.deadlines.recoveryAt),
        (signal) => {
          owner.fence.assertLocallyCurrent();
          dispatched = true;
          return this.targetAdapter.cleanup(run, combineSignals(signal, owner.fence.signal));
        },
      );
    } catch (error) {
      const outcome = classifyRecoveryActionFailure(error, dispatched, 'CLEANUP');
      if (outcome.kind === 'UNKNOWN') {
        await this.markActionOutcomeUnknown(owner, claimed, outcome.errorCode);
        return;
      }
      const failure = sanitizeFaultRunRecoveryError('CLEANUP', {
        kind: outcome.kind === 'TIMEOUT' ? 'ABORTED' : 'UNKNOWN',
      });
      await this.settleOwnedRecoveryAction(
        run,
        projection,
        owner,
        claimed,
        'DEFINITIVE_FAILURE',
        null,
        failure.code,
        {
          stage: 'CLEANUP',
          step: {
            status: failure.code === 'CLEANUP_OPERATION_FAILED' && outcome.kind === 'TIMEOUT'
              ? 'TIMED_OUT'
              : 'FAILED',
            attempt: projection.stop.attempt,
            startedAt: projection.cleanup.startedAt,
            completedAt: this.now().toISOString(),
            errorCode: failure.code,
          },
          phase: 'PARTIAL_RECOVERY',
          outcome: 'CLEANUP_FAILED',
          residuals: projection.residuals,
          lastError: failure,
        },
        'MANUAL_CLEANUP_FAILED',
        {
          operation: policy.target.operation,
          cleanupAttempt: projection.cleanup.attempt,
          completedAt: this.now().toISOString(),
          errorCode: failure.code,
        },
      );
      return;
    }

    const outcome = classifyRecoveryActionResponse(response, 'CLEANUP', run);
    if (outcome.kind === 'UNKNOWN') {
      await this.markActionOutcomeUnknown(owner, claimed, outcome.errorCode);
      return;
    }
    const completedAt = this.now().toISOString();
    if (outcome.kind === 'DEFINITIVE_FAILURE') {
      const failure = sanitizeFaultRunRecoveryError('CLEANUP', { kind: 'UNKNOWN' });
      await this.settleOwnedRecoveryAction(
        run,
        projection,
        owner,
        claimed,
        'DEFINITIVE_FAILURE',
        null,
        failure.code,
        {
          stage: 'CLEANUP',
          step: {
            status: 'FAILED',
            attempt: projection.stop.attempt,
            startedAt: projection.cleanup.startedAt,
            completedAt,
            errorCode: failure.code,
          },
          phase: 'PARTIAL_RECOVERY',
          outcome: 'CLEANUP_FAILED',
          residuals: projection.residuals,
          lastError: failure,
        },
        'MANUAL_CLEANUP_FAILED',
        {
          operation: policy.target.operation,
          cleanupAttempt: projection.cleanup.attempt,
          completedAt,
          errorCode: failure.code,
        },
      );
      return;
    }
    const settled = await this.settleOwnedRecoveryAction(
      run,
      projection,
      owner,
      claimed,
      'CONFIRMED',
      outcome.summary,
      null,
      {
        stage: 'CLEANUP',
        step: {
          status: 'SUCCEEDED',
          attempt: projection.stop.attempt,
          startedAt: projection.cleanup.startedAt,
          completedAt,
        },
        phase: 'VERIFYING',
        outcome: 'PENDING',
        residuals: withoutResidual(projection.residuals, 'MANUAL_CLEANUP_PENDING'),
      },
      'MANUAL_CLEANUP_COMPLETED',
      {
        operation: policy.target.operation,
        cleanupAttempt: projection.cleanup.attempt,
        completedAt,
      },
    );
    this.logRecoverySummary(settled.projection);
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
    const owner = this.currentRecoveryOwner(run.faultRunId);
    const completed = await this.store.complete({
      faultRunId: run.faultRunId,
      expectedAttempt: projection.stop.attempt,
      projection,
      eventType: 'RECOVERY_BLOCKED',
      eventPayload: {
        outcome: projection.outcome,
        ...lastResidualEventFacts(projection.residuals),
      },
      ...(owner ? { owner } : {}),
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
    const owner = this.currentRecoveryOwner(run.faultRunId);
    const updated = await this.store.recordStep({
      faultRunId: run.faultRunId,
      expectedAttempt: projection.stop.attempt,
      mutation,
      eventType,
      eventPayload,
      ...(owner ? { owner } : {}),
    });
    if (!updated) throw new Error('RECOVERY_STEP_PERSISTENCE_FAILED');
    const nextProjection = this.requireSafeProjection(updated);
    this.logRecoverySummary(nextProjection);
    return { run: updated, projection: nextProjection };
  }

  private currentRecoveryOwner(
    faultRunId: string,
  ): { ownerId: string; ownerEpoch: number } | null {
    const lease = this.ownerLeases.get(faultRunId);
    if (!lease) {
      if (this.ownerRequiredRunIds.has(faultRunId)) throw new Error('RECOVERY_OWNER_REQUIRED');
      return null;
    }
    lease.fence.assertLocallyCurrent();
    return {
      ownerId: lease.fence.ownerId,
      ownerEpoch: lease.fence.ownerEpoch,
    };
  }

  private listActions(faultRunId: string): Promise<FaultRunActionRecord[]> {
    return this.store.listActions
      ? this.store.listActions(faultRunId)
      : listFaultRunActions(faultRunId);
  }

  private claimAction(
    input: Parameters<typeof claimFaultRunAction>[0],
  ): Promise<FaultRunActionRecord | null> {
    return this.store.claimAction
      ? this.store.claimAction(input)
      : claimFaultRunAction(input);
  }

  private markStaleActionUnknown(
    input: Parameters<typeof markStaleFaultRunActionUnknown>[0],
  ): Promise<boolean> {
    return this.store.markStaleActionUnknown
      ? this.store.markStaleActionUnknown(input)
      : markStaleFaultRunActionUnknown(input);
  }

  private markActionUnknown(
    input: Parameters<typeof markOwnedFaultRunActionUnknown>[0],
  ): Promise<boolean> {
    return this.store.markActionUnknown
      ? this.store.markActionUnknown(input)
      : markOwnedFaultRunActionUnknown(input);
  }

  private startOwnedRelease(
    input: Parameters<typeof startOwnedFaultRunRelease>[0],
  ): ReturnType<typeof startOwnedFaultRunRelease> {
    return this.store.startOwnedRelease
      ? this.store.startOwnedRelease(input)
      : startOwnedFaultRunRelease(input);
  }

  private persistOwnedRecoveryAction(
    input: Parameters<typeof settleOwnedFaultRunRecoveryAction>[0],
  ): ReturnType<typeof settleOwnedFaultRunRecoveryAction> {
    return this.store.settleOwnedRecoveryAction
      ? this.store.settleOwnedRecoveryAction(input)
      : settleOwnedFaultRunRecoveryAction(input);
  }

  private finishOwnedAction(
    input: Parameters<typeof finishOwnedFaultRunAction>[0],
  ): ReturnType<typeof finishOwnedFaultRunAction> {
    return this.store.finishOwnedAction
      ? this.store.finishOwnedAction(input)
      : finishOwnedFaultRunAction(input);
  }

  private async settleOwnedRecoveryAction(
    run: FaultRunRecord,
    projection: FaultRunRecoveryProjection,
    owner: RecoveryOwnerLease,
    action: FaultRunActionRecord,
    actionState: 'CONFIRMED' | 'DEFINITIVE_FAILURE',
    resultSummary: unknown,
    errorCode: string | null,
    mutation: RecordFaultRunRecoveryStepInput['mutation'],
    eventType: 'RELEASE_COMPLETED' | 'RELEASE_FAILED' | 'MANUAL_CLEANUP_COMPLETED' | 'MANUAL_CLEANUP_FAILED',
    eventPayload: unknown,
  ): Promise<{ run: FaultRunRecord; projection: FaultRunRecoveryProjection }> {
    owner.fence.assertLocallyCurrent();
    const updated = await this.persistOwnedRecoveryAction({
      faultRunId: run.faultRunId,
      actionId: action.actionId,
      actionType: action.actionType as 'RELEASE' | 'CLEANUP',
      requestIdempotencyKey: action.requestIdempotencyKey,
      ownerId: owner.fence.ownerId,
      ownerEpoch: owner.fence.ownerEpoch,
      actionState,
      resultSummary,
      errorCode,
      expectedAttempt: projection.stop.attempt,
      mutation,
      eventType,
      eventPayload,
    });
    if (!updated) throw new Error('RECOVERY_ACTION_SETTLEMENT_FENCED');
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

type RecoveryActionClassification =
  | { kind: 'CONFIRMED'; summary: Record<string, boolean | number | string> }
  | { kind: 'DEFINITIVE_FAILURE'; errorCode: string }
  | { kind: 'UNKNOWN'; errorCode: string };

type RecoveryActionFailure =
  | { kind: 'TIMEOUT' }
  | { kind: 'DEFINITIVE_FAILURE'; errorCode: string }
  | { kind: 'UNKNOWN'; errorCode: string };

function classifyRecoveryActionResponse(
  response: unknown,
  actionType: 'RELEASE' | 'CLEANUP',
  run: FaultRunRecord,
): RecoveryActionClassification {
  const gateway = asObject(response);
  const errorCode = actionType === 'RELEASE'
    ? 'TARGET_RELEASE_REJECTED'
    : 'CLEANUP_OPERATION_FAILED';
  if (gateway.code === 400 && gateway.data === null) {
    return { kind: 'DEFINITIVE_FAILURE', errorCode };
  }
  if (gateway.code !== 200) {
    return {
      kind: 'UNKNOWN',
      errorCode: actionType === 'RELEASE' ? 'RELEASE_OUTCOME_UNKNOWN' : 'CLEANUP_OUTCOME_UNKNOWN',
    };
  }
  const target = asObject(gateway.data);
  if (target.code !== 200) {
    return {
      kind: 'UNKNOWN',
      errorCode: actionType === 'RELEASE' ? 'RELEASE_OUTCOME_UNKNOWN' : 'CLEANUP_OUTCOME_UNKNOWN',
    };
  }
  const data = asObject(target.data);
  if ((data.operation !== undefined && data.operation !== run.targetOperation)
    || (data.runId !== undefined && data.runId !== run.faultRunId)) {
    return {
      kind: 'UNKNOWN',
      errorCode: actionType === 'RELEASE' ? 'RELEASE_OUTCOME_UNKNOWN' : 'CLEANUP_OUTCOME_UNKNOWN',
    };
  }
  const confirmed = actionType === 'RELEASE' ? data.released === true : data.cleaned === true;
  if (!confirmed) {
    return {
      kind: 'UNKNOWN',
      errorCode: actionType === 'RELEASE' ? 'RELEASE_OUTCOME_UNKNOWN' : 'CLEANUP_OUTCOME_UNKNOWN',
    };
  }
  return {
    kind: 'CONFIRMED',
    summary: {
      [actionType === 'RELEASE' ? 'released' : 'cleaned']: true,
      operation: run.targetOperation,
    },
  };
}

function classifyRecoveryActionFailure(
  error: unknown,
  dispatched: boolean,
  actionType: 'RELEASE' | 'CLEANUP',
): RecoveryActionFailure {
  if (!dispatched && error instanceof RecoveryDeadlineExceededError) return { kind: 'TIMEOUT' };
  if (error instanceof GatewayRequestError && error.status >= 400 && error.status < 500) {
    return {
      kind: 'DEFINITIVE_FAILURE',
      errorCode: actionType === 'RELEASE' ? 'TARGET_RELEASE_REJECTED' : 'CLEANUP_OPERATION_FAILED',
    };
  }
  return {
    kind: 'UNKNOWN',
    errorCode: actionType === 'RELEASE' ? 'RELEASE_OUTCOME_UNKNOWN' : 'CLEANUP_OUTCOME_UNKNOWN',
  };
}

function desiredRecoveryDrainState(
  run: FaultRunRecord,
  projection?: FaultRunRecoveryProjection,
): RecoveryOwnerLease['drainState'] {
  if (projection?.drain.status === 'SUCCEEDED') return 'DRAINED';
  if (projection?.drain.status === 'TIMED_OUT') return 'DRAIN_TIMEOUT';
  if (projection?.drain.status === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
  if (run.execution?.drainState === 'DRAINED'
    || run.execution?.drainState === 'DRAIN_TIMEOUT'
    || run.execution?.drainState === 'NOT_APPLICABLE') return run.execution.drainState;
  return null;
}

function isTerminalFaultRun(run: FaultRunRecord): boolean {
  return run.state === 'RECOVERED'
    || run.state === 'STOPPED'
    || run.state === 'FAILED'
    || run.state === 'SERVICE_UNAVAILABLE';
}

function combineSignals(deadlineSignal: AbortSignal, ownerSignal: AbortSignal): AbortSignal {
  return AbortSignal.any([deadlineSignal, ownerSignal]);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
