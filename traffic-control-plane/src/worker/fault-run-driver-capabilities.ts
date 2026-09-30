import {
  listScenarioDefinitions,
  type FaultRunScenario,
  type FaultRunWorkerDrainOwner,
} from '../lib/fault-run-catalog';
import type { FaultRunDrainParticipantKind } from '../lib/fault-run-recovery';
import { FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE } from '../lib/fault-run-event-contract';

export const FAULT_RUN_DRIVER_EXECUTION = Object.freeze({
  state: 'ACTIVE',
  mode: 'ACTIVE_ONLY',
} as const);

export const REPORT_SCENARIO_TERMINAL_SUMMARY_EVENT = 'REPORT_WORKER_STOPPED' as const;
export const TRAFFIC_SURGE_TERMINAL_SUMMARY_EVENT = 'SCENARIO_WORKER_DRAINED' as const;
export const SCENARIO_WORKER_TERMINAL_SUMMARY_EVENT = 'SCENARIO_WORKER_DRAINED' as const;
export const RUNNER_TERMINAL_SUMMARY_EVENT = 'RUNNER_LIFECYCLE_SUMMARY' as const;

export interface FaultRunDriverCapability {
  readonly name: FaultRunWorkerDrainOwner;
  readonly drainOwner: FaultRunWorkerDrainOwner;
  readonly executionState: typeof FAULT_RUN_DRIVER_EXECUTION.mode;
  readonly summaryEventType: string;
  readonly terminalSummaryEvent: typeof FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE;
  readonly supportedScenarios: readonly FaultRunScenario[];
}

export const FAULT_RUN_DRAIN_PARTICIPANT_BY_OWNER: Readonly<
Record<FaultRunWorkerDrainOwner, FaultRunDrainParticipantKind>
> = Object.freeze({
  REPORT_SCENARIO_WORKER: 'REPORT',
  TRAFFIC_SURGE_EXECUTOR: 'SURGE',
  SCENARIO_WORKERS: 'SCENARIO',
  RUNNER_ENGINE: 'RUNNER',
});

export const FAULT_RUN_DRIVER_CAPABILITIES: readonly FaultRunDriverCapability[] = Object.freeze([
  capability({
    name: 'REPORT_SCENARIO_WORKER',
    summaryEventType: REPORT_SCENARIO_TERMINAL_SUMMARY_EVENT,
    supportedScenarios: ['BROWSE_REPORT_SQL', 'ORDER_REPORT_SQL'],
  }),
  capability({
    name: 'TRAFFIC_SURGE_EXECUTOR',
    summaryEventType: TRAFFIC_SURGE_TERMINAL_SUMMARY_EVENT,
    supportedScenarios: ['BROWSE_SURGE', 'ORDER_QUERY_SURGE'],
  }),
  capability({
    name: 'SCENARIO_WORKERS',
    summaryEventType: SCENARIO_WORKER_TERMINAL_SUMMARY_EVENT,
    supportedScenarios: [
      'CATALOG_REDIS_LARGE_VALUE',
      'PROMOTION_LOCK_CONTENTION',
      'INVENTORY_TABLE_EXCLUSIVE',
      'INVENTORY_ROW_LOCK',
      'CART_CATALOG_DEPENDENCY',
    ],
  }),
  capability({
    name: 'RUNNER_ENGINE',
    summaryEventType: RUNNER_TERMINAL_SUMMARY_EVENT,
    supportedScenarios: [
      'NOTIFICATION_HEAP_PRESSURE',
      'NOTIFICATION_STORAGE_APPEND',
      'PSP_PROVIDER_OUTCOME',
    ],
  }),
]);

export function supportsFaultRunScenario(
  driverName: FaultRunWorkerDrainOwner,
  scenario: FaultRunScenario,
): boolean {
  return FAULT_RUN_DRIVER_CAPABILITIES
    .find(({ name }) => name === driverName)
    ?.supportedScenarios.includes(scenario) ?? false;
}

export function faultRunDrainParticipantForOwner(
  owner: FaultRunWorkerDrainOwner,
): FaultRunDrainParticipantKind {
  return FAULT_RUN_DRAIN_PARTICIPANT_BY_OWNER[owner];
}

function capability(
  input: Pick<FaultRunDriverCapability, 'name' | 'summaryEventType' | 'supportedScenarios'>,
): FaultRunDriverCapability {
  return Object.freeze({
    name: input.name,
    drainOwner: input.name,
    executionState: FAULT_RUN_DRIVER_EXECUTION.mode,
    summaryEventType: input.summaryEventType,
    terminalSummaryEvent: FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE,
    supportedScenarios: Object.freeze([...input.supportedScenarios]),
  });
}

const CATALOG_SCENARIOS = new Set(listScenarioDefinitions().map(({ scenario }) => scenario));
if (FAULT_RUN_DRIVER_CAPABILITIES.some(({ supportedScenarios }) => (
  supportedScenarios.some((scenario) => !CATALOG_SCENARIOS.has(scenario))
))) {
  throw new Error('FAULT_RUN_DRIVER_CAPABILITY_SCENARIO_UNKNOWN');
}
