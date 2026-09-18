import pino from 'pino';
import type { FaultRunWorkerDrainOwner } from '../lib/fault-run-catalog';
import {
  appendFaultRunEvent,
  type FaultRunRecord,
} from '../lib/fault-run-repository';
import {
  normalizeFaultRunRecoveryEventPayload,
} from '../lib/fault-run-event-contract';
import type {
  FaultRunDrainParticipantKind,
  FaultRunRecoveryMetrics,
} from '../lib/fault-run-recovery';

const log = pino({ name: 'fault-run-drain-registry' });
const MAX_RECOVERY_COUNTER = 2_147_483_647;

const PARTICIPANT_BY_OWNER: Record<FaultRunWorkerDrainOwner, FaultRunDrainParticipantKind> = {
  REPORT_SCENARIO_WORKER: 'REPORT',
  TRAFFIC_SURGE_EXECUTOR: 'SURGE',
  SCENARIO_WORKERS: 'SCENARIO',
  RUNNER_ENGINE: 'RUNNER',
};

export type FaultRunDrainGateResult =
  | {
      kind: 'CLOSED';
      participant: FaultRunDrainParticipantKind;
      metrics?: FaultRunRecoveryMetrics;
    }
  | {
      kind: 'MISSING';
      participant: FaultRunDrainParticipantKind;
    }
  | {
      kind: 'FAILED';
      participant: FaultRunDrainParticipantKind;
      metrics?: FaultRunRecoveryMetrics;
    };

export type FaultRunDrainResult =
  | {
      kind: 'DRAINED';
      participant: FaultRunDrainParticipantKind;
      metrics?: FaultRunRecoveryMetrics;
    }
  | {
      kind: 'TIMED_OUT';
      participant: FaultRunDrainParticipantKind;
      metrics?: FaultRunRecoveryMetrics;
    }
  | {
      kind: 'FAILED';
      participant: FaultRunDrainParticipantKind;
      metrics?: FaultRunRecoveryMetrics;
      failureKind?: 'WORKER_FAILED' | 'UNKNOWN';
    }
  | {
      kind: 'MISSING';
      participant: FaultRunDrainParticipantKind;
    };

export interface FaultRunDrainController {
  closeGate(input: {
    run: FaultRunRecord;
    owner: FaultRunWorkerDrainOwner;
    deadlineAt: Date;
  }): Promise<FaultRunDrainGateResult>;
  drain(input: {
    run: FaultRunRecord;
    owner: FaultRunWorkerDrainOwner;
    deadlineAt: Date;
    signal: AbortSignal;
  }): Promise<FaultRunDrainResult>;
  snapshot?(input: {
    run: FaultRunRecord;
    owner: FaultRunWorkerDrainOwner;
  }): FaultRunRecoveryMetrics;
  acknowledgeDrainTimeout?(input: {
    run: FaultRunRecord;
    owner: FaultRunWorkerDrainOwner;
  }): void;
  forgetCompletedRun?(faultRunId: string): boolean;
}

export interface FaultRunDrainParticipant {
  kind: FaultRunDrainParticipantKind;
  requestStop(): void | Promise<void>;
  settled(): Promise<void>;
}

export interface FaultRunWorkPermit {
  readonly signal: AbortSignal;
  complete(): void;
}

export interface FaultRunDrainRegistryOptions {
  now?: () => Date;
  appendLateCompletion?: (
    faultRunId: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  logger?: Pick<typeof log, 'warn'>;
}

interface ParticipantEntry {
  id: number;
  kind: FaultRunDrainParticipantKind;
  requestStop: (() => void | Promise<void>) | null;
  settled: boolean;
  settlementFailed: boolean;
  settlementPromise: Promise<void>;
  unregistered: boolean;
  stopRequested: boolean;
  stopSettled: boolean;
  stopFailed: boolean;
  stopPromise: Promise<void> | null;
}

interface PermitEntry {
  id: number;
  kind: FaultRunDrainParticipantKind;
  settled: Promise<void>;
  resolve: () => void;
  completed: boolean;
}

interface ParticipantCounters {
  accepted: number;
  completed: number;
  aborted: number;
}

interface DrainTimeout {
  metrics: FaultRunRecoveryMetrics;
  acknowledged: boolean;
  lateCompletionWriting: boolean;
  lateCompletionWritten: boolean;
}

interface RunDrainState {
  gateClosed: boolean;
  terminalRequested: boolean;
  controller: AbortController;
  participants: ParticipantEntry[];
  permits: Map<number, PermitEntry>;
  counters: Map<FaultRunDrainParticipantKind, ParticipantCounters>;
  timeouts: Map<FaultRunDrainParticipantKind, DrainTimeout>;
  nextParticipantId: number;
  nextPermitId: number;
}

/**
 * A Worker-local registry. Its state is intentionally process scoped and is
 * never used as a cross-process owner, lease, or fencing mechanism.
 */
export class FaultRunDrainRegistry implements FaultRunDrainController {
  private readonly states = new Map<string, RunDrainState>();
  private readonly now: () => Date;
  private readonly appendLateCompletion: NonNullable<FaultRunDrainRegistryOptions['appendLateCompletion']>;
  private readonly logger: Pick<typeof log, 'warn'>;

  constructor(options: FaultRunDrainRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.appendLateCompletion = options.appendLateCompletion ?? defaultLateCompletionWriter;
    this.logger = options.logger ?? log;
  }

  register(faultRunId: string, participant: FaultRunDrainParticipant): () => void {
    const state = this.stateFor(faultRunId);
    const entry: ParticipantEntry = {
      id: state.nextParticipantId++,
      kind: participant.kind,
      requestStop: participant.requestStop,
      settled: false,
      settlementFailed: false,
      settlementPromise: Promise.resolve(),
      unregistered: false,
      stopRequested: false,
      stopSettled: false,
      stopFailed: false,
      stopPromise: null,
    };
    state.participants.push(entry);
    entry.settlementPromise = this.observeSettlement(
      faultRunId,
      state,
      entry,
      participant.settled,
    );
    if (state.gateClosed) this.requestParticipantStop(faultRunId, state, entry);

    return () => {
      entry.unregistered = true;
      this.retireParticipant(entry);
      this.scheduleLateCompletion(faultRunId, state, entry.kind);
      this.pruneIfTerminal(faultRunId, state);
    };
  }

  tryAcquire(
    faultRunId: string,
    participant: FaultRunDrainParticipantKind,
  ): FaultRunWorkPermit | null {
    const state = this.stateFor(faultRunId);
    if (state.gateClosed || state.controller.signal.aborted) return null;

    const id = state.nextPermitId++;
    let resolve!: () => void;
    const settled = new Promise<void>((complete) => {
      resolve = complete;
    });
    const permit: PermitEntry = {
      id,
      kind: participant,
      settled,
      resolve,
      completed: false,
    };
    state.permits.set(id, permit);
    incrementCounter(this.countersFor(state, participant), 'accepted');

    return {
      signal: state.controller.signal,
      complete: () => {
        if (permit.completed) return;
        permit.completed = true;
        state.permits.delete(id);
        const counters = this.countersFor(state, participant);
        if (state.controller.signal.aborted) incrementCounter(counters, 'aborted');
        else incrementCounter(counters, 'completed');
        permit.resolve();
        this.scheduleLateCompletion(faultRunId, state, participant);
        this.pruneIfTerminal(faultRunId, state);
      },
    };
  }

  async closeGate(input: {
    run: FaultRunRecord;
    owner: FaultRunWorkerDrainOwner;
    deadlineAt: Date;
  }): Promise<FaultRunDrainGateResult> {
    const participant = faultRunDrainParticipantForOwner(input.owner);
    const state = this.stateFor(input.run.faultRunId);
    if (!state.gateClosed) {
      state.gateClosed = true;
      state.controller.abort();
    }
    const entries = this.participantsFor(state, participant);
    for (const entry of entries) this.requestParticipantStop(input.run.faultRunId, state, entry);

    const metrics = this.metrics(state, participant, 'inFlightAtStart');
    if (entries.length === 0 && this.permitsFor(state, participant).length === 0) {
      return { kind: 'MISSING', participant };
    }
    if (this.hasParticipantFailure(entries)) {
      return { kind: 'FAILED', participant, metrics };
    }
    return { kind: 'CLOSED', participant, metrics };
  }

  async drain(input: {
    run: FaultRunRecord;
    owner: FaultRunWorkerDrainOwner;
    deadlineAt: Date;
    signal: AbortSignal;
  }): Promise<FaultRunDrainResult> {
    const participant = faultRunDrainParticipantForOwner(input.owner);
    const state = this.stateFor(input.run.faultRunId);
    const existingTimeout = state.timeouts.get(participant);
    if (existingTimeout) {
      this.scheduleLateCompletion(input.run.faultRunId, state, participant);
      return { kind: 'TIMED_OUT', participant, metrics: existingTimeout.metrics };
    }
    if (!state.gateClosed) {
      return {
        kind: 'FAILED',
        participant,
        metrics: this.metrics(state, participant, 'inFlightAtStart'),
        failureKind: 'UNKNOWN',
      };
    }

    const entries = this.participantsFor(state, participant);
    if (entries.length === 0 && this.permitsFor(state, participant).length === 0) {
      return { kind: 'MISSING', participant };
    }

    const initialMetrics = this.metrics(state, participant, 'inFlightAtStart');
    if (this.hasParticipantFailure(entries)) {
      return {
        kind: 'FAILED',
        participant,
        metrics: this.metrics(state, participant, 'inFlightAtFinish', initialMetrics),
        failureKind: 'UNKNOWN',
      };
    }

    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutResolve!: () => void;
    const timedOut = new Promise<void>((resolve) => {
      timeoutResolve = resolve;
    });
    const timeout = () => {
      this.markTimedOut(state, participant, initialMetrics);
      timeoutResolve();
    };
    const remainingMs = input.deadlineAt.getTime() - this.now().getTime();
    if (remainingMs <= 0 || input.signal.aborted) timeout();
    else {
      deadlineTimer = setTimeout(timeout, remainingMs);
      input.signal.addEventListener('abort', timeout, { once: true });
    }

    try {
      while (true) {
        const currentEntries = this.participantsFor(state, participant);
        if (this.hasParticipantFailure(currentEntries)) {
          return {
            kind: 'FAILED',
            participant,
            metrics: this.metrics(state, participant, 'inFlightAtFinish', initialMetrics),
            failureKind: 'UNKNOWN',
          };
        }
        const pending = this.pendingWork(state, participant);
        if (pending.length === 0) {
          return {
            kind: 'DRAINED',
            participant,
            metrics: this.metrics(state, participant, 'inFlightAtFinish', initialMetrics),
          };
        }
        const result = await Promise.race([
          Promise.allSettled(pending).then(() => 'SETTLED' as const),
          timedOut.then(() => 'TIMED_OUT' as const),
        ]);
        if (result === 'TIMED_OUT') {
          const recorded = this.markTimedOut(state, participant, initialMetrics);
          return { kind: 'TIMED_OUT', participant, metrics: recorded.metrics };
        }
      }
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      input.signal.removeEventListener('abort', timeout);
    }
  }

  snapshot(input: {
    run: FaultRunRecord;
    owner: FaultRunWorkerDrainOwner;
  }): FaultRunRecoveryMetrics {
    const participant = faultRunDrainParticipantForOwner(input.owner);
    const state = this.states.get(input.run.faultRunId);
    if (!state) return zeroMetrics();
    return state.timeouts.get(participant)?.metrics
      ?? this.metrics(state, participant, 'inFlightAtFinish');
  }

  acknowledgeDrainTimeout(input: {
    run: FaultRunRecord;
    owner: FaultRunWorkerDrainOwner;
  }): void {
    const participant = faultRunDrainParticipantForOwner(input.owner);
    const state = this.states.get(input.run.faultRunId);
    const timeout = state?.timeouts.get(participant);
    if (!state || !timeout) return;
    timeout.acknowledged = true;
    this.scheduleLateCompletion(input.run.faultRunId, state, participant);
  }

  forgetCompletedRun(faultRunId: string): boolean {
    const state = this.states.get(faultRunId);
    if (!state) return true;
    state.terminalRequested = true;
    return this.pruneIfTerminal(faultRunId, state);
  }

  private stateFor(faultRunId: string): RunDrainState {
    let state = this.states.get(faultRunId);
    if (!state) {
      state = {
        gateClosed: false,
        terminalRequested: false,
        controller: new AbortController(),
        participants: [],
        permits: new Map(),
        counters: new Map(),
        timeouts: new Map(),
        nextParticipantId: 1,
        nextPermitId: 1,
      };
      this.states.set(faultRunId, state);
    }
    return state;
  }

  private observeSettlement(
    faultRunId: string,
    state: RunDrainState,
    entry: ParticipantEntry,
    settledOperation: () => Promise<void>,
  ): Promise<void> {
    let settled: Promise<void>;
    try {
      settled = Promise.resolve(settledOperation());
    } catch {
      entry.settlementFailed = true;
      entry.settled = true;
      this.retireParticipant(entry);
      this.scheduleLateCompletion(faultRunId, state, entry.kind);
      this.pruneIfTerminal(faultRunId, state);
      return Promise.resolve();
    }
    return settled.then(
      () => {
        entry.settled = true;
        this.retireParticipant(entry);
        this.scheduleLateCompletion(faultRunId, state, entry.kind);
        this.pruneIfTerminal(faultRunId, state);
      },
      () => {
        entry.settled = true;
        entry.settlementFailed = true;
        this.retireParticipant(entry);
        this.scheduleLateCompletion(faultRunId, state, entry.kind);
        this.pruneIfTerminal(faultRunId, state);
      },
    );
  }

  private requestParticipantStop(
    faultRunId: string,
    state: RunDrainState,
    entry: ParticipantEntry,
  ): void {
    if (entry.stopRequested) return;
    entry.stopRequested = true;
    if (!entry.requestStop) return;
    try {
      entry.stopPromise = Promise.resolve(entry.requestStop());
      void entry.stopPromise.then(
        () => {
          entry.stopSettled = true;
          entry.stopPromise = null;
          this.scheduleLateCompletion(faultRunId, state, entry.kind);
          this.pruneIfTerminal(faultRunId, state);
        },
        () => {
          entry.stopSettled = true;
          entry.stopFailed = true;
          entry.stopPromise = null;
          this.scheduleLateCompletion(faultRunId, state, entry.kind);
          this.pruneIfTerminal(faultRunId, state);
        },
      );
    } catch {
      entry.stopFailed = true;
      this.scheduleLateCompletion(faultRunId, state, entry.kind);
    }
  }

  private markTimedOut(
    state: RunDrainState,
    participant: FaultRunDrainParticipantKind,
    initialMetrics: FaultRunRecoveryMetrics,
  ): DrainTimeout {
    const current = state.timeouts.get(participant);
    if (current) return current;
    const timeout: DrainTimeout = {
      metrics: this.metrics(state, participant, 'inFlightAtDeadline', initialMetrics),
      acknowledged: false,
      lateCompletionWriting: false,
      lateCompletionWritten: false,
    };
    state.timeouts.set(participant, timeout);
    return timeout;
  }

  private scheduleLateCompletion(
    faultRunId: string,
    state: RunDrainState,
    participant: FaultRunDrainParticipantKind,
  ): void {
    const timeout = state.timeouts.get(participant);
    if (!timeout
      || !timeout.acknowledged
      || timeout.lateCompletionWriting
      || timeout.lateCompletionWritten
      || this.pendingWork(state, participant).length > 0) {
      return;
    }
    timeout.lateCompletionWriting = true;
    const metrics = this.metrics(state, participant, 'inFlightAtFinish', timeout.metrics);
    void this.appendLateCompletion(
      faultRunId,
      normalizeFaultRunRecoveryEventPayload('DRAIN_LATE_COMPLETED', {
        participant,
        ...metrics,
        completedAt: this.now().toISOString(),
      }),
    ).then(
      () => {
        timeout.lateCompletionWritten = true;
        timeout.lateCompletionWriting = false;
        this.pruneIfTerminal(faultRunId, state);
      },
      () => {
        timeout.lateCompletionWriting = false;
        this.logger.warn({
          faultRunId,
          code: 'DRAIN_LATE_EVENT_WRITE_FAILED',
        }, 'Failed to persist Fault Run late drain completion');
      },
    );
  }

  private participantsFor(
    state: RunDrainState,
    participant: FaultRunDrainParticipantKind,
  ): ParticipantEntry[] {
    return state.participants.filter((entry) => entry.kind === participant);
  }

  private permitsFor(
    state: RunDrainState,
    participant: FaultRunDrainParticipantKind,
  ): PermitEntry[] {
    return [...state.permits.values()].filter((entry) => entry.kind === participant);
  }

  private pendingWork(
    state: RunDrainState,
    participant: FaultRunDrainParticipantKind,
  ): Promise<void>[] {
    const entries = this.participantsFor(state, participant);
    return [
      ...entries.flatMap((entry) => [
        ...(entry.settled ? [] : [entry.settlementPromise]),
        ...(entry.stopPromise && !entry.stopSettled ? [entry.stopPromise] : []),
      ]),
      ...this.permitsFor(state, participant).map((entry) => entry.settled),
    ];
  }

  private hasParticipantFailure(entries: readonly ParticipantEntry[]): boolean {
    return entries.some((entry) => entry.stopFailed || entry.settlementFailed);
  }

  private retireParticipant(entry: ParticipantEntry): void {
    if (!entry.unregistered || !entry.settled) return;
    entry.requestStop = null;
    entry.settlementPromise = Promise.resolve();
    entry.stopPromise = null;
  }

  private pruneIfTerminal(faultRunId: string, state: RunDrainState): boolean {
    if (!state.terminalRequested
      || !state.gateClosed
      || state.permits.size > 0
      || state.participants.some((entry) => !entry.settled)
      || [...state.timeouts.values()].some((timeout) => !timeout.lateCompletionWritten)) {
      return false;
    }
    this.states.delete(faultRunId);
    return true;
  }

  private metrics(
    state: RunDrainState,
    participant: FaultRunDrainParticipantKind,
    inFlightKey: 'inFlightAtStart' | 'inFlightAtDeadline' | 'inFlightAtFinish',
    initial: FaultRunRecoveryMetrics = {},
  ): FaultRunRecoveryMetrics {
    const counters = this.countersFor(state, participant);
    return {
      participants: this.participantsFor(state, participant).length,
      accepted: counters.accepted,
      completed: counters.completed,
      aborted: counters.aborted,
      ...(initial.inFlightAtStart === undefined ? {} : { inFlightAtStart: initial.inFlightAtStart }),
      [inFlightKey]: this.permitsFor(state, participant).length,
    };
  }

  private countersFor(
    state: RunDrainState,
    participant: FaultRunDrainParticipantKind,
  ): ParticipantCounters {
    let counters = state.counters.get(participant);
    if (!counters) {
      counters = { accepted: 0, completed: 0, aborted: 0 };
      state.counters.set(participant, counters);
    }
    return counters;
  }
}

export function faultRunDrainParticipantForOwner(
  owner: FaultRunWorkerDrainOwner,
): FaultRunDrainParticipantKind {
  return PARTICIPANT_BY_OWNER[owner];
}

function incrementCounter(counters: ParticipantCounters, field: keyof ParticipantCounters): void {
  counters[field] = Math.min(MAX_RECOVERY_COUNTER, counters[field] + 1);
}

function zeroMetrics(): FaultRunRecoveryMetrics {
  return {
    participants: 0,
    accepted: 0,
    completed: 0,
    aborted: 0,
    inFlightAtFinish: 0,
  };
}

async function defaultLateCompletionWriter(
  faultRunId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await appendFaultRunEvent(faultRunId, 'DRAIN_LATE_COMPLETED', payload);
}

let registry: FaultRunDrainRegistry | null = null;

export function getFaultRunDrainRegistry(): FaultRunDrainRegistry {
  if (!registry) registry = new FaultRunDrainRegistry();
  return registry;
}
