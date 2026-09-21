import type { OwnedFaultRunDriver } from './fault-run-driver';
import { ReportScenarioFaultRunDriver, getReportScenarioWorker } from './report-scenario-worker';
import { TrafficSurgeFaultRunDriver, getTrafficSurgeExecutor } from './traffic-surge-executor';
import { ScenarioFaultRunDriver, getScenarioWorkers } from './scenario-workers';
import { RunnerBackedFaultRunDriver } from './runner-backed-fault-run-driver';

let drivers: readonly OwnedFaultRunDriver[] | null = null;

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
