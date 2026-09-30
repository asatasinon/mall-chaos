import type { FaultRunRecord } from '../lib/fault-run-repository';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import type { FaultRunWorkerDrainOwner } from '../lib/fault-run-catalog';
import type { FaultRunSummaryEventType } from '../lib/fault-run-event-contract';

export type FaultRunDriverRecord = Omit<FaultRunRecord, 'contractRevision'>;

export function toFaultRunDriverRecord(run: FaultRunRecord): FaultRunDriverRecord {
  return {
    faultRunId: run.faultRunId,
    scenario: run.scenario,
    targetService: run.targetService,
    targetOperation: run.targetOperation,
    state: run.state,
    parameters: run.parameters,
    idempotencyKey: run.idempotencyKey,
    fencingToken: run.fencingToken,
    startedAt: run.startedAt,
    expiresAt: run.expiresAt,
    stoppedAt: run.stoppedAt,
    stopReason: run.stopReason,
    recoveryResult: run.recoveryResult,
    recoveryError: run.recoveryError,
    operatorAuditId: run.operatorAuditId,
    traceId: run.traceId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.execution === undefined ? {} : { execution: run.execution }),
  };
}

export type OwnedRunStopReason =
  | 'MANUAL'
  | 'EXPIRED'
  | 'RECOVERY'
  | 'OWNER_LOST'
  | 'PROCESS_SHUTDOWN';

export interface OwnedRunDrainResult {
  drained: boolean;
  inFlight?: number;
  errorCode?: string;
}

export interface OwnedRunHandle {
  stop(input: {
    reason: OwnedRunStopReason;
    signal: AbortSignal;
  }): Promise<OwnedRunDrainResult>;
}

export interface OwnedFaultRunDriver {
  readonly name: string;
  readonly drainOwner: FaultRunWorkerDrainOwner;
  readonly summaryEventType: FaultRunSummaryEventType;
  supports(run: FaultRunDriverRecord): boolean;
  start(input: {
    run: FaultRunDriverRecord;
    fence: FaultRunOwnerFence;
  }): Promise<OwnedRunHandle>;
}
