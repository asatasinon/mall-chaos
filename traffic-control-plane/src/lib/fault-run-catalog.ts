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
type ParameterUnit = 'bytes';

export interface FaultRunParameterDefinition {
  name: string;
  kind: ParameterKind;
  unit?: ParameterUnit;
  required?: boolean;
  default?: number | string;
  options?: readonly string[];
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
  default: 600,
  min: 1,
  max: 3600,
};

const boundedConcurrency: FaultRunParameterDefinition = {
  name: 'concurrency',
  kind: 'integer',
  required: false,
  default: 4,
  min: 1,
  max: 32,
};

const requestInterval: FaultRunParameterDefinition = {
  name: 'requestIntervalMs',
  kind: 'integer',
  required: false,
  default: 1000,
  min: 0,
  max: 60_000,
};

const BYTE_UNIT_MULTIPLIERS: Record<string, number> = {
  B: 1,
  K: 1024,
  KB: 1024,
  M: 1024 ** 2,
  MB: 1024 ** 2,
  G: 1024 ** 3,
  GB: 1024 ** 3,
};

function parseParameterNumber(parameter: FaultRunParameterDefinition, supplied: unknown): number | undefined {
  if (typeof supplied === 'number') return supplied;
  if (parameter.unit !== 'bytes' || typeof supplied !== 'string') return undefined;

  const match = supplied.trim().match(/^(\d+(?:\.\d+)?)(B|KB?|MB?|GB?)?$/i);
  if (!match) return undefined;
  const multiplier = match[2] === undefined ? 1 : BYTE_UNIT_MULTIPLIERS[match[2].toUpperCase()];
  return Number(match[1]) * multiplier;
}

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
    parameters: [duration, boundedConcurrency, requestInterval,
      { name: 'pageSize', kind: 'integer', default: 20, min: 1, max: 50 }],
  },
  ORDER_QUERY_SURGE: {
    scenario: 'ORDER_QUERY_SURGE',
    targetService: 'traffic-control-plane',
    targetOperation: 'order-query-worker',
    maxDurationSec: 1800,
    recoveryStrategy: 'WORKER',
    allowManualCleanup: false,
    parameters: [duration, boundedConcurrency, requestInterval,
      { name: 'pageSize', kind: 'integer', default: 20, min: 1, max: 50 }],
  },
  CART_REDIS_LARGE_VALUE: {
    scenario: 'CART_REDIS_LARGE_VALUE',
    targetService: 'cart-service',
    targetOperation: 'cart-large-value',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    allowManualCleanup: true,
    parameters: [duration, boundedConcurrency, requestInterval,
      { name: 'fieldCount', kind: 'integer', default: 8, min: 1, max: 64 },
      { name: 'fieldSizeBytes', kind: 'integer', unit: 'bytes', default: 1024, min: 1, max: 65536 },
      { name: 'totalSizeBytes', kind: 'integer', unit: 'bytes', default: 8192, min: 1, max: 1048576 },
      { name: 'keyTtlSec', kind: 'integer', default: 600, min: 1, max: 3600 }],
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
    parameters: [duration, requestInterval,
      { name: 'retainedBytesPerNotification', kind: 'integer', unit: 'bytes', default: 65536, min: 1024, max: 1048576 }],
  },
  NOTIFICATION_STORAGE_APPEND: {
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    maxDurationSec: 3600,
    recoveryStrategy: 'MANUAL_CLEANUP',
    allowManualCleanup: true,
    parameters: [duration, requestInterval,
      { name: 'totalBytes', kind: 'integer', unit: 'bytes', default: 1048576, min: 1024, max: 1073741824 },
      { name: 'appendBytes', kind: 'integer', unit: 'bytes', default: 8192, min: 1, max: 1048576 },
      { name: 'minFreeBytes', kind: 'integer', unit: 'bytes', default: 1048576, min: 1, max: 1073741824 }],
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
    parameters: [duration,
      { name: 'providerOutcome', kind: 'string', required: true, default: 'TIMEOUT', options: ['AUTHORIZED', 'DECLINED', 'TIMEOUT'], maxLength: 16 },
      { name: 'effectPercentage', kind: 'integer', default: 100, min: 0, max: 100 }],
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
      if (parameter.default !== undefined) result[parameter.name] = parameter.default;
      continue;
    }
    if (parameter.kind === 'string') {
      if (typeof supplied !== 'string' || supplied.length === 0
          || (parameter.options !== undefined && !parameter.options.includes(supplied))
          || (parameter.maxLength !== undefined && supplied.length > parameter.maxLength)) {
        throw new FaultRunValidationError(`INVALID_PARAMETER:${parameter.name}`);
      }
      result[parameter.name] = supplied;
      continue;
    }
    const numericValue = parseParameterNumber(parameter, supplied);
    if (numericValue === undefined || !Number.isFinite(numericValue)
        || (parameter.kind === 'integer' && !Number.isInteger(numericValue))
        || (parameter.min !== undefined && numericValue < parameter.min)
        || (parameter.max !== undefined && numericValue > parameter.max)) {
      throw new FaultRunValidationError(`INVALID_PARAMETER:${parameter.name}`);
    }
    result[parameter.name] = numericValue;
  }

  const durationSec = Number(result.durationSec);
  if (durationSec > definition.maxDurationSec) {
    throw new FaultRunValidationError('DURATION_EXCEEDS_SCENARIO_LIMIT');
  }
  return result;
}
