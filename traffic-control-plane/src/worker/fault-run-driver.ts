import type { FaultRunRecord } from '../lib/fault-run-repository';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import type { FaultRunWorkerDrainOwner } from '../lib/fault-run-catalog';
import type { FaultRunSummaryEventType } from '../lib/fault-run-event-contract';

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
  supports(run: FaultRunRecord): boolean;
  start(input: {
    run: FaultRunRecord;
    fence: FaultRunOwnerFence;
  }): Promise<OwnedRunHandle>;
}
