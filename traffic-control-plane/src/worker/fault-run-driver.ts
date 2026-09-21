import type { FaultRunRecord } from '../lib/fault-run-repository';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import type { FaultRunWorkerDrainOwner } from '../lib/fault-run-catalog';

export type OwnedRunStopReason =
  | 'MANUAL'
  | 'EXPIRED'
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
  name: string;
  drainOwner: FaultRunWorkerDrainOwner;
  supports(run: FaultRunRecord): boolean;
  start(input: {
    run: FaultRunRecord;
    fence: FaultRunOwnerFence;
  }): Promise<OwnedRunHandle>;
}
