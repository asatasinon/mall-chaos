import type { FaultRunScenario } from './fault-run-catalog';

export interface TrafficExerciseTarget {
  scenario: Extract<FaultRunScenario, 'BROWSE_SURGE' | 'ORDER_QUERY_SURGE'>;
  path: string;
  customerSource: 'NONE' | 'RUNNER_PERSISTED_ACCOUNT_ORDER';
  excludesCustomerIds: readonly number[];
}

export const TRAFFIC_EXERCISE_TARGETS: Record<TrafficExerciseTarget['scenario'], TrafficExerciseTarget> = {
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

export function getTrafficExerciseTarget(scenario: string): TrafficExerciseTarget {
  const target = TRAFFIC_EXERCISE_TARGETS[scenario as TrafficExerciseTarget['scenario']];
  if (!target) throw new Error('UNKNOWN_TRAFFIC_EXERCISE_TARGET');
  return target;
}