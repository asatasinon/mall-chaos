import type { FaultRunScenario } from './fault-run-catalog';

export interface TrafficScenarioTarget {
  scenario: Extract<FaultRunScenario, 'BROWSE_SURGE' | 'ORDER_QUERY_SURGE'>;
  path: string;
  customerSource: 'NONE' | 'RUNNER_PERSISTED_ACCOUNT_ORDER';
  excludesCustomerIds: readonly number[];
}

export const TRAFFIC_SCENARIO_TARGETS: Record<TrafficScenarioTarget['scenario'], TrafficScenarioTarget> = {
  BROWSE_SURGE: {
    scenario: 'BROWSE_SURGE',
    path: '/api/products',
    customerSource: 'NONE',
    excludesCustomerIds: [19],
  },
  ORDER_QUERY_SURGE: {
    scenario: 'ORDER_QUERY_SURGE',
    path: '/api/orders',
    customerSource: 'RUNNER_PERSISTED_ACCOUNT_ORDER',
    excludesCustomerIds: [19],
  },
};

export function getTrafficScenarioTarget(scenario: string): TrafficScenarioTarget {
  const target = TRAFFIC_SCENARIO_TARGETS[scenario as TrafficScenarioTarget['scenario']];
  if (!target) throw new Error('UNKNOWN_TRAFFIC_SCENARIO_TARGET');
  return target;
}