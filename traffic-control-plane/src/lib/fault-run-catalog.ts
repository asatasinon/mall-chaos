export type FaultRunState =
  | 'CREATING'
  | 'ACTIVE'
  | 'RECOVERING'
  | 'RECOVERED'
  | 'STOPPED'
  | 'FAILED'
  | 'SERVICE_UNAVAILABLE';

export type FaultRunScenario =
  | 'BROWSE_REPORT_SQL'
  | 'ORDER_REPORT_SQL'
  | 'BROWSE_SURGE'
  | 'ORDER_QUERY_SURGE'
  | 'CART_REDIS_LARGE_VALUE'
  | 'CART_CATALOG_DEPENDENCY'
  | 'NOTIFICATION_HEAP_PRESSURE'
  | 'NOTIFICATION_STORAGE_APPEND'
  | 'PROMOTION_LOCK_CONTENTION'
  | 'INVENTORY_TABLE_EXCLUSIVE'
  | 'PSP_PROVIDER_OUTCOME';

export type FaultRunRecoveryStrategy = 'TARGET' | 'WORKER' | 'NON_RELEASING' | 'MANUAL_CLEANUP';
type ParameterKind = 'integer' | 'number' | 'string';

export interface FaultRunParameterDefinition {
  name: string;
  kind: ParameterKind;
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface FaultRunScenarioDefinition {
  scenario: FaultRunScenario;
  targetService: string;
  targetOperation: string;
  maxDurationSec: number;
  recoveryStrategy: FaultRunRecoveryStrategy;
  allowManualCleanup: boolean;
  parameters: readonly FaultRunParameterDefinition[];
}

const duration: FaultRunParameterDefinition = {
  name: 'durationSec',
  kind: 'integer',
  required: true,
  min: 1,
  max: 3600,
};

const boundedConcurrency: FaultRunParameterDefinition = {
  name: 'concurrency',
  kind: 'integer',
  required: false,
  min: 1,
  max: 32,
};

const requestInterval: FaultRunParameterDefinition = {
  name: 'requestIntervalMs',
  kind: 'integer',
  required: false,
  min: 0,
  max: 60_000,
};

const CATALOG: Record<FaultRunScenario, FaultRunScenarioDefinition> = {
  BROWSE_REPORT_SQL: {
    scenario: 'BROWSE_REPORT_SQL',
    targetService: 'catalog-service',
    targetOperation: 'products-browse-report',
    maxDurationSec: 3600,
    recoveryStrategy: 'WORKER',
    allowManualCleanup: false,
    parameters: [duration],
  },
  ORDER_REPORT_SQL: {
    scenario: 'ORDER_REPORT_SQL',
    targetService: 'order-service',
    targetOperation: 'orders-query-report',
    maxDurationSec: 3600,
    recoveryStrategy: 'WORKER',
    allowManualCleanup: false,
    parameters: [duration],
  },
  BROWSE_SURGE: {
    scenario: 'BROWSE_SURGE',
    targetService: 'traffic-control-plane',
    targetOperation: 'browse-api-worker',
    maxDurationSec: 1800,
    recoveryStrategy: 'WORKER',
    allowManualCleanup: false,
    parameters: [duration, boundedConcurrency, requestInterval],
  },
  ORDER_QUERY_SURGE: {
    scenario: 'ORDER_QUERY_SURGE',
    targetService: 'traffic-control-plane',
    targetOperation: 'order-query-worker',
    maxDurationSec: 1800,
    recoveryStrategy: 'WORKER',
    allowManualCleanup: false,
    parameters: [duration, boundedConcurrency, requestInterval],
  },
  CART_REDIS_LARGE_VALUE: {
    scenario: 'CART_REDIS_LARGE_VALUE',
    targetService: 'cart-service',
    targetOperation: 'cart-large-value',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    allowManualCleanup: true,
    parameters: [duration, boundedConcurrency, requestInterval],
  },
  CART_CATALOG_DEPENDENCY: {
    scenario: 'CART_CATALOG_DEPENDENCY',
    targetService: 'catalog-service',
    targetOperation: 'cart-product-validation',
    maxDurationSec: 900,
    recoveryStrategy: 'TARGET',
    allowManualCleanup: false,
    parameters: [duration],
  },
  NOTIFICATION_HEAP_PRESSURE: {
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    targetService: 'notification-service',
    targetOperation: 'notification-retention',
    maxDurationSec: 3600,
    recoveryStrategy: 'NON_RELEASING',
    allowManualCleanup: false,
    parameters: [duration, requestInterval],
  },
  NOTIFICATION_STORAGE_APPEND: {
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    maxDurationSec: 3600,
    recoveryStrategy: 'MANUAL_CLEANUP',
    allowManualCleanup: true,
    parameters: [duration, requestInterval],
  },
  PROMOTION_LOCK_CONTENTION: {
    scenario: 'PROMOTION_LOCK_CONTENTION',
    targetService: 'promotion-service',
    targetOperation: 'coupon-reservation-consistency',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    allowManualCleanup: false,
    parameters: [duration, boundedConcurrency, requestInterval],
  },
  INVENTORY_TABLE_EXCLUSIVE: {
    scenario: 'INVENTORY_TABLE_EXCLUSIVE',
    targetService: 'inventory-service',
    targetOperation: 'inventory-availability-report',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    allowManualCleanup: false,
    parameters: [duration],
  },
  PSP_PROVIDER_OUTCOME: {
    scenario: 'PSP_PROVIDER_OUTCOME',
    targetService: 'psp-simulator',
    targetOperation: 'provider-outcome',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    allowManualCleanup: false,
    parameters: [duration],
  },
};

export class FaultRunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultRunValidationError';
  }
}

export function getScenarioDefinition(scenario: string): FaultRunScenarioDefinition {
  const definition = CATALOG[scenario as FaultRunScenario];
  if (!definition) throw new FaultRunValidationError('UNKNOWN_SCENARIO');
  return definition;
}

export function listScenarioDefinitions(): FaultRunScenarioDefinition[] {
  return Object.values(CATALOG);
}

export function validateScenarioParameters(
  scenario: string,
  value: unknown,
): Record<string, number | string> {
  const definition = getScenarioDefinition(scenario);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FaultRunValidationError('PARAMETERS_MUST_BE_OBJECT');
  }

  const parameters = value as Record<string, unknown>;
  const allowed = new Map(definition.parameters.map((parameter) => [parameter.name, parameter]));
  for (const key of Object.keys(parameters)) {
    if (!allowed.has(key)) throw new FaultRunValidationError(`UNKNOWN_PARAMETER:${key}`);
  }

  const result: Record<string, number | string> = {};
  for (const parameter of definition.parameters) {
    const supplied = parameters[parameter.name];
    if (supplied === undefined) {
      if (parameter.required) throw new FaultRunValidationError(`MISSING_PARAMETER:${parameter.name}`);
      continue;
    }
    if (parameter.kind === 'string') {
      if (typeof supplied !== 'string' || supplied.length === 0
          || (parameter.maxLength !== undefined && supplied.length > parameter.maxLength)) {
        throw new FaultRunValidationError(`INVALID_PARAMETER:${parameter.name}`);
      }
      result[parameter.name] = supplied;
      continue;
    }
    if (typeof supplied !== 'number' || !Number.isFinite(supplied)
        || (parameter.kind === 'integer' && !Number.isInteger(supplied))
        || (parameter.min !== undefined && supplied < parameter.min)
        || (parameter.max !== undefined && supplied > parameter.max)) {
      throw new FaultRunValidationError(`INVALID_PARAMETER:${parameter.name}`);
    }
    result[parameter.name] = supplied;
  }

  const durationSec = Number(result.durationSec);
  if (durationSec > definition.maxDurationSec) {
    throw new FaultRunValidationError('DURATION_EXCEEDS_SCENARIO_LIMIT');
  }
  return result;
}
