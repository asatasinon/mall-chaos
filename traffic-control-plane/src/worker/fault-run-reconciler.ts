import pino from 'pino';
import type { FaultRunReconciliationMode } from '../lib/env';
import {
  claimFaultRunExecution,
  heartbeatFaultRunExecution,
  loadFaultRunExecution,
  markFaultRunExecutionLeaseLost,
  relinquishFaultRunExecution,
  updateOwnedFaultRunExecution,
  type FaultRunExecutionRecord,
} from '../lib/fault-run-execution-repository';
import {
  appendFaultRunEvent,
  loadFaultRun,
  listFaultRunReconciliationCandidates,
  requestFaultRunStop,
  type FaultRunRecord,
  type RequestFaultRunStopInput,
} from '../lib/fault-run-repository';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import type { OwnedFaultRunDriver, OwnedRunDrainResult, OwnedRunHandle, OwnedRunStopReason } from './fault-run-driver';
import {
  faultRunDrainParticipantForOwner,
  type FaultRunDrainRegistry,
} from './fault-run-drain-registry';

const log = pino({ name: 'fault-run-reconciler' });

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
  drainRegistry?: Pick<FaultRunDrainRegistry, 'register'>;
  drivers: readonly OwnedFaultRunDriver[];
  now: () => Date;
  logger: Pick<typeof log, 'warn' | 'info'>;
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

export class FaultRunReconciler {
  private readonly owned = new Map<string, OwnedRun>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private scanPromise: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly dependencies: FaultRunReconcilerDependencies,
    private readonly options: FaultRunReconcilerOptions,
  ) {
    validateOptions(options);
  }

  async start(): Promise<void> {
    if (this.options.mode === 'OFF' || this.timer) return;
    this.stopping = false;
    await this.scan();
    if (this.stopping) return;
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
    this.dependencies.logger.info('Fault Run reconciler started');
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.timer = null;
    this.heartbeatTimer = null;
    await Promise.all([...this.owned.values()].map((owned) =>
      this.stopOwned(owned, 'PROCESS_SHUTDOWN')));
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
    if (run.state !== 'ACTIVE') return;
    const execution = await this.dependencies.loadExecution(run.faultRunId);
    if (!execution) return;
    const stale = execution.ownerId !== null
      && execution.leaseExpiresAt !== null
      && Date.parse(execution.leaseExpiresAt) <= this.dependencies.now().getTime();
    const initial = execution.ownerEpoch === 0 && execution.ownerId === null;
    if (!initial && !stale) return;

    if (stale && this.options.mode !== 'TAKEOVER') {
      await this.dependencies.updateExecution({
        faultRunId: run.faultRunId,
        ownerId: execution.ownerId!,
        ownerEpoch: execution.ownerEpoch,
        reconciliationState: 'TAKEOVER_PENDING',
        lastAction: this.options.mode === 'SHADOW'
          ? 'TAKEOVER_SHADOW_PLANNED'
          : 'TAKEOVER_OBSERVED',
        lastErrorCode: null,
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

    const fence = new FaultRunOwnerFence(
      run.faultRunId,
      this.options.ownerId,
      claimed.ownerEpoch,
    );
    try {
      const handle = await driver.start({ run, fence });
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
      this.owned.set(run.faultRunId, owned);
      await this.dependencies.appendEvent(run.faultRunId, initial
        ? 'OWNER_LEASE_ACQUIRED'
        : 'OWNER_TAKEOVER_COMPLETED', {
        ownerEpoch: claimed.ownerEpoch,
        reason: initial ? 'INITIAL' : 'TAKEOVER',
        driver: driver.name,
      });
    } catch (error) {
      fence.lose('DRIVER_START_FAILED');
      await this.dependencies.markLeaseLost({
        faultRunId: run.faultRunId,
        ownerId: this.options.ownerId,
        ownerEpoch: claimed.ownerEpoch,
        errorCode: 'DRIVER_START_FAILED',
      }).catch(() => false);
      throw error;
    }
  }

  private async heartbeatOwned(): Promise<void> {
    for (const owned of [...this.owned.values()]) {
      if (this.stopping || !owned.fence.isLocallyCurrent()) continue;
      const renewed = await this.dependencies.heartbeatExecution({
        faultRunId: owned.run.faultRunId,
        ownerId: owned.fence.ownerId,
        ownerEpoch: owned.fence.ownerEpoch,
        leaseTtlMs: this.options.leaseTtlMs,
      }).catch(() => false);
      if (!renewed) {
        owned.fence.lose('HEARTBEAT_REJECTED');
        await this.dependencies.markLeaseLost({
          faultRunId: owned.run.faultRunId,
          ownerId: owned.fence.ownerId,
          ownerEpoch: owned.fence.ownerEpoch,
          errorCode: 'HEARTBEAT_REJECTED',
        }).catch(() => false);
        await this.stopOwned(owned, 'OWNER_LOST');
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
