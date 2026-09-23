import type { Logger } from 'pino';
import type { FaultRunReconciliationMode } from '../lib/env';
import { getScenarioDefinition } from '../lib/fault-run-catalog';
import { GatewayFaultRunTargetAdapter, sanitizeTargetSummary } from '../lib/fault-run-coordinator';
import {
  claimFaultRunAction,
  listFaultRunActions,
  markPrepareOutcomeUnknown,
  markStaleFaultRunActionUnknown,
} from '../lib/fault-run-action-repository';
import {
  claimFaultRunExecution,
  heartbeatFaultRunExecution,
  markFaultRunExecutionLeaseLost,
  relinquishFaultRunExecution,
  updateOwnedFaultRunExecution,
  type FaultRunExecutionRecord,
} from '../lib/fault-run-execution-repository';
import {
  activateOwnedCreatingRun,
  appendFaultRunEvent,
  extractFaultRunTargetSummary,
  loadFaultRun,
  requestFaultRunStop,
  rejectOwnedPrepare,
  type FaultRunRecord,
  type RequestFaultRunStopInput,
} from '../lib/fault-run-repository';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import type { OwnedFaultRunDriver, OwnedRunDrainResult, OwnedRunHandle, OwnedRunStopReason } from './fault-run-driver';
import {
  faultRunDrainParticipantForOwner,
  type FaultRunDrainRegistry,
} from './fault-run-drain-registry';

export interface FaultRunReconcilerDependencies {
  listCandidates: () => Promise<FaultRunRecord[]>;
  loadRun?: typeof loadFaultRun;
  requestStop?: typeof requestFaultRunStop;
  loadExecution: (faultRunId: string) => Promise<FaultRunExecutionRecord | null>;
  claimExecution: typeof claimFaultRunExecution;
  heartbeatExecution: typeof heartbeatFaultRunExecution;
  markLeaseLost: typeof markFaultRunExecutionLeaseLost;
  updateExecution: typeof updateOwnedFaultRunExecution;
  relinquishExecution: typeof relinquishFaultRunExecution;
  appendEvent: typeof appendFaultRunEvent;
  listActions?: typeof listFaultRunActions;
  claimAction?: typeof claimFaultRunAction;
  markStaleActionUnknown?: typeof markStaleFaultRunActionUnknown;
  markPrepareUnknown?: typeof markPrepareOutcomeUnknown;
  activateCreating?: typeof activateOwnedCreatingRun;
  rejectPrepare?: typeof rejectOwnedPrepare;
  prepare?: (run: FaultRunRecord, signal?: AbortSignal) => Promise<unknown>;
  drainRegistry?: Pick<FaultRunDrainRegistry, 'register'>;
  drivers: readonly OwnedFaultRunDriver[];
  now: () => Date;
  logger: Pick<Logger, 'warn' | 'info'>;
}

export interface FaultRunReconcilerOptions {
  mode: FaultRunReconciliationMode;
  ownerId: string;
  leaseTtlMs: number;
  heartbeatMs: number;
  reconcileIntervalMs: number;
  drainTimeoutMs?: number;
  recoveryTimeoutMs?: number;
}

interface OwnedRun {
  run: FaultRunRecord;
  execution: FaultRunExecutionRecord;
  fence: FaultRunOwnerFence;
  handle: OwnedRunHandle;
  driver: OwnedFaultRunDriver;
  unregisterDrain: (() => void) | null;
  settledResolve: () => void;
  stopPromise: Promise<OwnedRunDrainResult> | null;
}

interface StartingRun {
  run: FaultRunRecord;
  fence: FaultRunOwnerFence;
  phase: 'PREPARING' | 'STARTING';
}

export class FaultRunReconciler {
  private readonly owned = new Map<string, OwnedRun>();
  private readonly starting = new Map<string, StartingRun>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private scanPromise: Promise<void> | null = null;
  private quiescePromise: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly dependencies: FaultRunReconcilerDependencies,
    private readonly options: FaultRunReconcilerOptions,
  ) {
    validateOptions(options);
  }

  async start(): Promise<void> {
    if (this.options.mode === 'OFF' || this.timer || this.quiescePromise) return;
    this.stopping = false;
    this.timer = setInterval(() => {
      void this.scan().catch((error) => {
        this.dependencies.logger.warn({ code: errorCode(error) }, 'Fault Run reconciliation scan failed');
      });
    }, this.options.reconcileIntervalMs);
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeatOwned().catch((error) => {
        this.dependencies.logger.warn({ code: errorCode(error) }, 'Fault Run owner heartbeat failed');
      });
    }, this.options.heartbeatMs);
    try {
      await this.scan();
    } catch (error) {
      this.stopping = true;
      for (const starting of this.starting.values()) {
        if (starting.phase === 'PREPARING') starting.fence.lose('RECONCILER_START_FAILED');
      }
      if (this.timer) clearInterval(this.timer);
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.timer = null;
      this.heartbeatTimer = null;
      throw error;
    }
    if (this.stopping) return;
    this.dependencies.logger.info('Fault Run reconciler started');
  }

  async quiesce(): Promise<void> {
    if (!this.quiescePromise) this.quiescePromise = this.quiesceInternal();
    return this.quiescePromise;
  }

  async stop(): Promise<void> {
    let quiesceFailed = false;
    let quiesceError: unknown;
    try {
      await this.quiesce();
    } catch (error) {
      quiesceFailed = true;
      quiesceError = error;
    }
    for (const starting of this.starting.values()) starting.fence.lose('PROCESS_SHUTDOWN');
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    await Promise.all([...this.owned.values()].map((owned) =>
      this.stopOwned(owned, 'PROCESS_SHUTDOWN')));
    if (quiesceFailed) throw quiesceError;
  }

  private async quiesceInternal(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const starting of this.starting.values()) {
      if (starting.phase === 'PREPARING') starting.fence.lose('PROCESS_SHUTDOWN');
    }
    const scan = this.scanPromise;
    if (!scan) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        scan,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('RECONCILER_QUIESCE_TIMEOUT')),
            Math.min(this.options.leaseTtlMs, this.options.recoveryTimeoutMs ?? this.options.leaseTtlMs),
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async scan(): Promise<void> {
    if (this.stopping || this.options.mode === 'OFF') return;
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.scanInternal().finally(() => {
      this.scanPromise = null;
    });
    return this.scanPromise;
  }

  getOwnedRunIds(): string[] {
    return [...this.owned.keys()].sort();
  }

  private async scanInternal(): Promise<void> {
    await this.reconcileOwnedLifecycle();
    const candidates = await this.dependencies.listCandidates();
    for (const run of candidates) {
      if (this.stopping || this.owned.has(run.faultRunId)) continue;
      await this.reconcileCandidate(run);
    }
  }

  private async reconcileOwnedLifecycle(): Promise<void> {
      if (!this.dependencies.loadRun || !this.dependencies.requestStop) return;
      for (const owned of [...this.owned.values()]) {
        const run = await this.dependencies.loadRun(owned.run.faultRunId);
        if (!run || run.state !== 'ACTIVE' || Date.parse(run.expiresAt) > this.dependencies.now().getTime()) {
          continue;
        }
        const input: RequestFaultRunStopInput = {
          faultRunId: run.faultRunId,
          reason: 'EXPIRED',
          drainTimeoutMs: this.options.drainTimeoutMs ?? 30_000,
          recoveryTimeoutMs: this.options.recoveryTimeoutMs ?? 60_000,
          now: this.dependencies.now(),
        };
        await this.dependencies.requestStop(input);
      }
  }

  private async reconcileCandidate(run: FaultRunRecord): Promise<void> {
    if (run.state !== 'ACTIVE' && run.state !== 'CREATING') return;
    const execution = await this.dependencies.loadExecution(run.faultRunId);
    if (!execution) return;
    const now = this.dependencies.now().getTime();
    if (Date.parse(run.expiresAt) <= now) {
      if (this.dependencies.requestStop) {
        await this.dependencies.requestStop({
          faultRunId: run.faultRunId,
          reason: 'EXPIRED',
          drainTimeoutMs: this.options.drainTimeoutMs ?? 30_000,
          recoveryTimeoutMs: this.options.recoveryTimeoutMs ?? 60_000,
          now: this.dependencies.now(),
        });
      }
      return;
    }
    const stale = execution.ownerId !== null
      && execution.leaseExpiresAt !== null
      && Date.parse(execution.leaseExpiresAt) <= now;
    const initial = execution.ownerEpoch === 0 && execution.ownerId === null;
    if (!initial && !stale) return;

    if (run.state === 'CREATING' && stale) {
      const actions = await (this.dependencies.listActions ?? listFaultRunActions)(run.faultRunId);
      const dispatching = actions.find((action) =>
        action.actionType === 'PREPARE' && action.actionState === 'DISPATCHING');
      if (dispatching) {
        await (this.dependencies.markStaleActionUnknown ?? markStaleFaultRunActionUnknown)({
          actionId: dispatching.actionId,
          dispatchOwnerId: dispatching.dispatchOwnerId!,
          dispatchOwnerEpoch: dispatching.dispatchOwnerEpoch!,
          errorCode: 'OWNER_LEASE_EXPIRED',
        });
        return;
      }
      if (actions.some((action) =>
        action.actionType === 'PREPARE' && action.actionState !== 'REQUESTED')) return;
    }

    if (stale && execution.executionMode !== 'TAKEOVER') {
      await this.dependencies.updateExecution({
        faultRunId: run.faultRunId,
        ownerId: execution.ownerId!,
        ownerEpoch: execution.ownerEpoch,
        reconciliationState: 'TAKEOVER_PENDING',
        lastAction: execution.executionMode === 'SHADOW'
          ? 'TAKEOVER_SHADOW_PLANNED'
          : 'TAKEOVER_OBSERVED',
        lastErrorCode: null,
      });
      await this.dependencies.appendEvent(run.faultRunId, 'RECONCILIATION_DECISION', {
        decision: 'TAKEOVER',
        reason: execution.executionMode === 'SHADOW'
          ? 'TAKEOVER_SHADOW_PLANNED'
          : 'TAKEOVER_OBSERVED',
        ownerEpoch: execution.ownerEpoch,
      });
      return;
    }

    const driver = this.dependencies.drivers.find((candidate) => candidate.supports(run));
    if (!driver) return;
    const claimed = await this.dependencies.claimExecution({
      faultRunId: run.faultRunId,
      executionMode: execution.executionMode,
      ownerId: this.options.ownerId,
      leaseTtlMs: this.options.leaseTtlMs,
      reconciliationState: initial ? 'OWNED' : 'TAKEN_OVER',
      lastAction: initial ? 'OWNER_LEASE_ACQUIRED' : 'OWNER_TAKEOVER_COMPLETED',
    });
    if (!claimed) return;
    if (this.stopping) return;
    if (!claimed.leaseExpiresAt
      || Date.parse(claimed.leaseExpiresAt) <= this.dependencies.now().getTime()) return;

    const fence = new FaultRunOwnerFence(
      run.faultRunId,
      this.options.ownerId,
      claimed.ownerEpoch,
    );
    const starting: StartingRun = {
      run,
      fence,
      phase: run.state === 'CREATING' ? 'PREPARING' : 'STARTING',
    };
    this.starting.set(run.faultRunId, starting);
    try {
      if (run.state === 'CREATING') {
        const activated = await this.prepareCreating(run, claimed, fence);
        if (!activated || activated.state !== 'ACTIVE'
          || !fence.isLocallyCurrent()
          || Date.parse(activated.expiresAt) <= this.dependencies.now().getTime()) return;
        run = activated;
        starting.run = run;
        starting.phase = 'STARTING';
      }
      if (!fence.isLocallyCurrent()
        || Date.parse(run.expiresAt) <= this.dependencies.now().getTime()
        || Date.parse(claimed.leaseExpiresAt) <= this.dependencies.now().getTime()) return;
      const handle = await driver.start({ run, fence });
      if (!fence.isLocallyCurrent()) {
        try {
          await handle.stop({ reason: 'OWNER_LOST', signal: fence.signal });
        } catch (error) {
          this.dependencies.logger.warn({
            faultRunId: run.faultRunId,
            code: errorCode(error),
          }, 'Fault Run driver did not stop after owner loss');
        }
        return;
      }
      let settledResolve!: () => void;
      const settled = new Promise<void>((resolve) => {
        settledResolve = resolve;
      });
      const owned: OwnedRun = {
        run,
        execution: claimed,
        fence,
        handle,
        driver,
        unregisterDrain: null,
        settledResolve,
        stopPromise: null,
      };
      if (this.dependencies.drainRegistry) {
        owned.unregisterDrain = this.dependencies.drainRegistry.register(
          run.faultRunId,
          {
            kind: faultRunDrainParticipantForOwner(driver.drainOwner),
            requestStop: () => this.stopOwned(owned, 'MANUAL').then(() => undefined),
            settled: () => settled,
          },
        );
      }

      this.starting.delete(run.faultRunId);
      this.owned.set(run.faultRunId, owned);
      try {
        await this.dependencies.appendEvent(run.faultRunId, initial
          ? 'OWNER_LEASE_ACQUIRED'
          : 'OWNER_TAKEOVER_COMPLETED', {
          ownerEpoch: claimed.ownerEpoch,
          reason: initial ? 'INITIAL' : 'TAKEOVER',
          driver: driver.name,
        });
      } catch (error) {
        await this.stopOwned(owned, 'OWNER_LOST');
        throw error;
      }
    } catch (error) {
      if (fence.isLocallyCurrent()) {
        fence.lose('DRIVER_START_FAILED');
        await this.dependencies.markLeaseLost({
          faultRunId: run.faultRunId,
          ownerId: this.options.ownerId,
          ownerEpoch: claimed.ownerEpoch,
          errorCode: 'DRIVER_START_FAILED',
        }).catch(() => false);
        await this.dependencies.appendEvent(run.faultRunId, 'OWNER_LEASE_LOST', {
          ownerEpoch: claimed.ownerEpoch,
          reason: 'DRIVER_START_FAILED',
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      this.starting.delete(run.faultRunId);
    }
  }

  private async prepareCreating(
    run: FaultRunRecord,
    execution: FaultRunExecutionRecord,
    fence: FaultRunOwnerFence,
  ): Promise<FaultRunRecord | null> {
    if (!fence.isLocallyCurrent()) return null;
    const owner = {
      faultRunId: run.faultRunId,
      ownerId: execution.ownerId!,
      ownerEpoch: execution.ownerEpoch,
    };
    const definition = getScenarioDefinition(run.scenario);
    const activate = this.dependencies.activateCreating ?? activateOwnedCreatingRun;
    if (definition.targetPrepare === 'NOT_APPLICABLE') {
      return fence.isLocallyCurrent() ? activate(owner) : null;
    }
    const actions = await (this.dependencies.listActions ?? listFaultRunActions)(run.faultRunId);
    if (!fence.isLocallyCurrent()) return null;
    const action = actions.find((candidate) => candidate.actionType === 'PREPARE');
    if (!action || action.actionState !== 'REQUESTED') return null;
    const claimed = await (this.dependencies.claimAction ?? claimFaultRunAction)({
      actionId: action.actionId,
      ownerId: owner.ownerId,
      ownerEpoch: owner.ownerEpoch,
    });
    if (!claimed) return null;
    const unknown = async () => {
      await (this.dependencies.markPrepareUnknown ?? markPrepareOutcomeUnknown)({
        actionId: claimed.actionId,
        ownerId: owner.ownerId,
        ownerEpoch: owner.ownerEpoch,
        errorCode: 'PREPARE_OUTCOME_UNKNOWN',
      });
    };
    let response: unknown;
    try {
      if (!fence.isLocallyCurrent()) {
        await unknown();
        return null;
      }
      response = await (this.dependencies.prepare
        ? this.dependencies.prepare(run, fence.signal)
        : new GatewayFaultRunTargetAdapter().start(run, fence.signal));
    } catch {
      await unknown();
      return null;
    }
    if (!fence.isLocallyCurrent()) {
      await unknown();
      return null;
    }
    const outcome = classifyPrepareResponse(run, response);
    if (outcome === 'REJECTED') {
      const rejected = await (this.dependencies.rejectPrepare ?? rejectOwnedPrepare)({
        ...owner,
        actionId: claimed.actionId,
      });
      if (!rejected) await unknown();
      return null;
    }
    if (outcome !== 'CONFIRMED') {
      await unknown();
      return null;
    }
    const candidateSummary = sanitizeTargetSummary(run, response);
    const targetSummary = run.scenario === 'CATALOG_REDIS_LARGE_VALUE'
      ? extractFaultRunTargetSummary(run.faultRunId, { targetSummary: candidateSummary })
      : null;
    if (run.scenario === 'CATALOG_REDIS_LARGE_VALUE' && !targetSummary) {
      await unknown();
      return null;
    }
    try {
      const activated = await activate({
        ...owner,
        prepareActionId: claimed.actionId,
        ...(targetSummary ? { targetSummary } : {}),
      });
      if (activated) return activated;
    } catch {
      // The dispatch may already have taken effect; only a fenced journal update can settle it.
    }
    await unknown();
    return null;
  }

  private async heartbeatOwned(): Promise<void> {
    const owners = [
      ...[...this.starting.values()].map((starting) => ({
        faultRunId: starting.run.faultRunId,
        fence: starting.fence,
      })),
      ...[...this.owned.values()].map((owned) => ({
        faultRunId: owned.run.faultRunId,
        fence: owned.fence,
      })),
    ];
    for (const owner of owners) {
      if (!owner.fence.isLocallyCurrent()) continue;
      const renewed = await this.dependencies.heartbeatExecution({
        faultRunId: owner.faultRunId,
        ownerId: owner.fence.ownerId,
        ownerEpoch: owner.fence.ownerEpoch,
        leaseTtlMs: this.options.leaseTtlMs,
      }).catch(() => false);
      if (!renewed) {
        owner.fence.lose('HEARTBEAT_REJECTED');
        await this.dependencies.markLeaseLost({
          faultRunId: owner.faultRunId,
          ownerId: owner.fence.ownerId,
          ownerEpoch: owner.fence.ownerEpoch,
          errorCode: 'HEARTBEAT_REJECTED',
        }).catch(() => false);
        await this.dependencies.appendEvent(owner.faultRunId, 'OWNER_LEASE_LOST', {
          ownerEpoch: owner.fence.ownerEpoch,
          reason: 'HEARTBEAT_REJECTED',
        }).catch(() => undefined);
        const owned = this.owned.get(owner.faultRunId);
        if (owned) await this.stopOwned(owned, 'OWNER_LOST');
      }
    }
  }

  private async stopOwned(owned: OwnedRun, reason: OwnedRunStopReason): Promise<OwnedRunDrainResult> {
    if (owned.stopPromise) return owned.stopPromise;
    owned.stopPromise = (async () => {
      owned.fence.lose(reason);
      let result: OwnedRunDrainResult;
      try {
        result = await owned.handle.stop({ reason, signal: owned.fence.signal });
      } catch {
        result = { drained: false, errorCode: 'DRIVER_DRAIN_FAILED' };
      }
      this.owned.delete(owned.run.faultRunId);
      owned.unregisterDrain?.();
      owned.settledResolve();
      await this.dependencies.appendEvent(
        owned.run.faultRunId,
        result.drained ? 'OWNER_DRAIN_COMPLETED' : 'OWNER_DRAIN_TIMEOUT',
        {
          ownerEpoch: owned.fence.ownerEpoch,
          reason,
          drained: result.drained,
          ...(result.inFlight === undefined ? {} : { remaining: result.inFlight }),
        },
      ).catch(() => undefined);
      if (result.drained) {
        await this.dependencies.updateExecution({
          faultRunId: owned.run.faultRunId,
          ownerId: owned.fence.ownerId,
          ownerEpoch: owned.fence.ownerEpoch,
          drainState: 'DRAINED',
          lastAction: 'OWNER_DRAIN_COMPLETED',
          lastErrorCode: null,
        }).catch(() => false);
        await this.dependencies.relinquishExecution({
          faultRunId: owned.run.faultRunId,
          ownerId: owned.fence.ownerId,
          ownerEpoch: owned.fence.ownerEpoch,
        }).catch(() => false);
      } else {
        await this.dependencies.updateExecution({
          faultRunId: owned.run.faultRunId,
          ownerId: owned.fence.ownerId,
          ownerEpoch: owned.fence.ownerEpoch,
          drainState: 'DRAIN_TIMEOUT',
          lastAction: 'OWNER_DRAIN_TIMEOUT',
          lastErrorCode: result.errorCode ?? 'DRIVER_DRAIN_FAILED',
        }).catch(() => false);
      }
      return result;
    })();
    return owned.stopPromise;
  }
}

export function classifyPrepareResponse(
  run: FaultRunRecord,
  response: unknown,
): 'CONFIRMED' | 'REJECTED' | 'UNKNOWN' {
  const gateway = asObject(response);
  if (gateway.code === 400 && gateway.data === null) return 'REJECTED';
  if (gateway.code !== 200) return 'UNKNOWN';
  const target = asObject(gateway.data);
  if (target.code !== 200) return 'UNKNOWN';
  const data = asObject(target.data);
  if (data.accepted !== true
    || (data.operation !== undefined && data.operation !== run.targetOperation)
    || (data.runId !== undefined && data.runId !== run.faultRunId)) return 'UNKNOWN';
  return 'CONFIRMED';
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function validateOptions(options: FaultRunReconcilerOptions): void {
  if (!Number.isSafeInteger(options.leaseTtlMs) || options.leaseTtlMs < 1) {
    throw new Error('INVALID_OWNER_LEASE_TTL');
  }
  if (!Number.isSafeInteger(options.heartbeatMs)
    || options.heartbeatMs < 1
    || options.heartbeatMs * 2 >= options.leaseTtlMs) {
    throw new Error('INVALID_OWNER_HEARTBEAT_INTERVAL');
  }
  if (!Number.isSafeInteger(options.reconcileIntervalMs) || options.reconcileIntervalMs < 1) {
    throw new Error('INVALID_RECONCILE_INTERVAL');
  }
  if (options.drainTimeoutMs !== undefined
    && (!Number.isSafeInteger(options.drainTimeoutMs) || options.drainTimeoutMs < 1)) {
    throw new Error('INVALID_DRAIN_TIMEOUT');
  }
  if (options.recoveryTimeoutMs !== undefined
    && (!Number.isSafeInteger(options.recoveryTimeoutMs)
      || options.recoveryTimeoutMs < (options.drainTimeoutMs ?? 1))) {
    throw new Error('INVALID_RECOVERY_TIMEOUT');
  }
  if (options.ownerId.length === 0) throw new Error('INVALID_OWNER_ID');
}

function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_.:-]{0,95}$/.test(error.message)
    ? error.message
    : 'RECONCILIATION_FAILED';
}
