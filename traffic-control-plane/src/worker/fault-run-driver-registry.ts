import type { OwnedFaultRunDriver } from './fault-run-driver';
import { FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE } from '../lib/fault-run-event-contract';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import { FAULT_RUN_DRIVER_EXECUTION } from './fault-run-reconciler';
import type { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import type { OwnedRunHandle } from './fault-run-driver';
import { ReportScenarioFaultRunDriver, getReportScenarioWorker } from './report-scenario-worker';
import { TrafficSurgeFaultRunDriver, getTrafficSurgeExecutor } from './traffic-surge-executor';
import { ScenarioFaultRunDriver, getScenarioWorkers } from './scenario-workers';
import { RunnerBackedFaultRunDriver } from './runner-backed-fault-run-driver';

let drivers: readonly OwnedFaultRunDriver[] | null = null;

export interface ScenarioDispatchDescriptor {
  readonly driver: OwnedFaultRunDriver;
  readonly name: string;
  readonly drainOwner: OwnedFaultRunDriver['drainOwner'];
  readonly executionState: typeof FAULT_RUN_DRIVER_EXECUTION.mode;
  readonly summaryEventType: OwnedFaultRunDriver['summaryEventType'];
  readonly terminalSummaryEvent: typeof FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE;
  supports(run: FaultRunRecord): boolean;
  start(input: { run: FaultRunRecord; fence: FaultRunOwnerFence }): Promise<OwnedRunHandle>;
}

export function getFaultRunDrivers(): readonly OwnedFaultRunDriver[] {
  if (!drivers) {
    drivers = Object.freeze([
      new ReportScenarioFaultRunDriver(getReportScenarioWorker()),
      new TrafficSurgeFaultRunDriver(getTrafficSurgeExecutor()),
      new ScenarioFaultRunDriver(getScenarioWorkers()),
      new RunnerBackedFaultRunDriver(),
    ]);
  }
  return drivers;
}

export function getFaultRunDriverDescriptors(): readonly ScenarioDispatchDescriptor[] {
  return Object.freeze(getFaultRunDrivers().map((driver) => Object.freeze({
    driver,
    name: driver.name,
    drainOwner: driver.drainOwner,
    executionState: FAULT_RUN_DRIVER_EXECUTION.mode,
    summaryEventType: driver.summaryEventType,
    terminalSummaryEvent: FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE,
    supports: (run: FaultRunRecord) => driver.supports(run),
    start: (input: { run: FaultRunRecord; fence: FaultRunOwnerFence }) => driver.start(input),
  })));
}
