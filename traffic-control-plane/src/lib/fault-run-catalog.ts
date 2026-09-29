import { assertFaultRunRecoveryPolicy } from './fault-run-recovery-policy';
import type {
  AlertCorrelationContract,
  EvidenceContractPlan,
  EvidencePredicate,
  EvidenceRecipeDefinition,
  EvidenceScope,
  EvidenceTemplateId,
  FaultRunCleanupActionType,
  FaultRunPrepareEventType,
  FaultRunRecoveryEventType,
  ParameterConsumer,
  ScenarioAlertContract,
  ScenarioContractSupplement,
  ScenarioResourceBudget,
} from './scenario-contract';

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
  | 'CATALOG_REDIS_LARGE_VALUE'
  | 'CART_CATALOG_DEPENDENCY'
  | 'NOTIFICATION_HEAP_PRESSURE'
  | 'NOTIFICATION_STORAGE_APPEND'
  | 'PROMOTION_LOCK_CONTENTION'
  | 'INVENTORY_TABLE_EXCLUSIVE'
  | 'INVENTORY_ROW_LOCK'
  | 'PSP_PROVIDER_OUTCOME';

export type FaultRunRecoveryStrategy = 'TARGET' | 'WORKER' | 'NON_RELEASING' | 'MANUAL_CLEANUP';
export type FaultRunWorkerDrainOwner =
  | 'REPORT_SCENARIO_WORKER'
  | 'TRAFFIC_SURGE_EXECUTOR'
  | 'SCENARIO_WORKERS'
  | 'RUNNER_ENGINE';
export type FaultRunWorkerDrainPolicy =
  | {
      requirement: 'REQUIRED';
      owner: FaultRunWorkerDrainOwner;
    }
  | {
      requirement: 'NOT_APPLICABLE';
      owner?: never;
    };
export type FaultRunTargetReleasePolicy = 'REQUIRED' | 'FORBIDDEN' | 'NOT_APPLICABLE';
export type FaultRunCleanupPolicy = 'NONE' | 'OPTIONAL_PER_RUN' | 'OPERATOR_CONFIRMED';
export type FaultRunVerificationPolicy = 'REQUIRED' | 'BEST_EFFORT' | 'NOT_CONFIGURED';

export interface FaultRunRecoveryPolicy {
  workerDrain: FaultRunWorkerDrainPolicy;
  targetRelease: FaultRunTargetReleasePolicy;
  cleanup: FaultRunCleanupPolicy;
  verification: FaultRunVerificationPolicy;
}

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
  targetPrepare: 'REQUIRED' | 'NOT_APPLICABLE';
  maxDurationSec: number;
  recoveryStrategy: FaultRunRecoveryStrategy;
  recoveryPolicy: FaultRunRecoveryPolicy;
  allowManualCleanup: boolean;
  parameters: readonly FaultRunParameterDefinition[];
  contract: ScenarioContractSupplement;
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

export const TRAFFIC_SURGE_MAX_PAGE_SIZE = 100;

const trafficSurgeConcurrency: FaultRunParameterDefinition = {
  name: 'concurrency',
  kind: 'integer',
  required: false,
  default: 4,
  min: 1,
  max: 128,
};

const requestInterval: FaultRunParameterDefinition = {
  name: 'requestIntervalMs',
  kind: 'integer',
  required: false,
  default: 100,
  min: 0,
  max: 60_000,
};

const CATALOG_LARGE_VALUE_CLEANUP_GRACE_SEC = 60;
const CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES = 512 * 1024 * 1024;
export const CATALOG_LARGE_VALUE_MIN_MEMBER_SIZE_BYTES = 1024;

const BYTE_UNIT_MULTIPLIERS: Record<string, number> = {
  B: 1,
  K: 1024,
  KB: 1024,
  M: 1024 ** 2,
  MB: 1024 ** 2,
  G: 1024 ** 3,
  GB: 1024 ** 3,
};

const ALERT_CORRELATION_TIMING = {
  correlationWindowSec: 900,
  activeGraceBeforeSec: 900,
  recentGraceAfterSec: 900,
} as const;

const EVIDENCE_WINDOWS = {
  baselineBeforeActiveSec: 300,
  activeLeadSec: 30,
  activeTailSec: 30,
  recoveryLeadSec: 30,
  recoveryTailSec: 300,
  cleanupLeadSec: 300,
} as const;

interface ScenarioContractInput {
  readonly targetPrepareParameters?: readonly string[];
  readonly workerExecutionParameters?: readonly string[];
  readonly budgets: readonly ScenarioResourceBudget[];
  readonly evidence: EvidenceContractPlan;
  readonly alert: ScenarioAlertContract;
  readonly nonReleasingReason?: string;
}

interface EvidenceSignal {
  readonly id: string;
  readonly template: EvidenceTemplateId;
  readonly source?: EvidenceRecipeDefinition['source'];
  readonly scope: EvidenceScope;
  readonly activeThreshold?: number;
  readonly activePredicate?: EvidencePredicate;
  readonly recoveryPredicate?: EvidencePredicate;
  readonly effect?: boolean;
}

interface ScenarioEvidenceInput {
  readonly scopes: readonly EvidenceScope[];
  readonly signals: readonly EvidenceSignal[];
  readonly effectRuleMode?: 'ALL' | 'ANY';
  readonly tempoSlowThresholdSec: number;
  readonly currentReadCheck?: 'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT';
  readonly currentReadCheckScope?: EvidenceScope;
  readonly cleanupCheck?: boolean;
}

function defineScenario<T extends Omit<FaultRunScenarioDefinition, 'contract'>>(
  definition: T,
  input: ScenarioContractInput,
): T & { contract: ScenarioContractSupplement } {
  const parameterConsumers = defineParameterConsumers(definition, input);
  const lifecycle = defineLifecycle(definition, input.evidence, input.nonReleasingReason);
  return {
    ...definition,
    contract: {
      parameterConsumers,
      budgets: input.budgets,
      lifecycle,
      evidence: input.evidence,
      alert: input.alert,
    },
  };
}

function defineParameterConsumers(
  definition: Omit<FaultRunScenarioDefinition, 'contract'>,
  input: ScenarioContractInput,
): Readonly<Record<string, readonly ParameterConsumer[]>> {
  const targetParameters = new Set(input.targetPrepareParameters ?? []);
  const workerParameters = new Set(input.workerExecutionParameters ?? []);
  const knownParameters = new Set(definition.parameters.map(({ name }) => name));
  for (const name of [...targetParameters, ...workerParameters]) {
    if (!knownParameters.has(name)) throw new Error('CATALOG_CONTRACT_CONSUMER_UNKNOWN_PARAMETER');
  }
  if (definition.targetPrepare === 'NOT_APPLICABLE' && targetParameters.size > 0) {
    throw new Error('CATALOG_CONTRACT_TARGET_CONSUMER_WITHOUT_PREPARE');
  }
  if (definition.recoveryPolicy.workerDrain.requirement !== 'REQUIRED' && workerParameters.size > 0) {
    throw new Error('CATALOG_CONTRACT_WORKER_CONSUMER_WITHOUT_DRIVER');
  }

  const consumers: Record<string, readonly ParameterConsumer[]> = {};
  for (const parameter of definition.parameters) {
    const parameterConsumers = new Set<ParameterConsumer>(['ADMISSION']);
    if (parameter.name === 'durationSec') {
      if (definition.targetPrepare === 'REQUIRED') parameterConsumers.add('TARGET_PREPARE');
      if (definition.recoveryPolicy.workerDrain.requirement === 'REQUIRED') {
        parameterConsumers.add('WORKER_EXECUTION');
      }
    } else {
      if (targetParameters.has(parameter.name)) parameterConsumers.add('TARGET_PREPARE');
      if (workerParameters.has(parameter.name)) parameterConsumers.add('WORKER_EXECUTION');
    }
    consumers[parameter.name] = Object.freeze([...parameterConsumers].sort(compareStrings));
  }
  return Object.freeze(consumers);
}

function defineLifecycle(
  definition: Omit<FaultRunScenarioDefinition, 'contract'>,
  evidence: EvidenceContractPlan,
  nonReleasingReason: string | undefined,
): ScenarioContractSupplement['lifecycle'] {
  const prepareEventTypes: FaultRunPrepareEventType[] = definition.targetPrepare === 'REQUIRED'
    ? ['CREATED', 'TARGET_CONFIRMED', 'CREATE_FAILED']
    : ['CREATED'];
  const stopEventTypes: FaultRunRecoveryEventType[] = [
    'STOP_REQUESTED',
    'DRAIN_STARTED',
    'DRAIN_COMPLETED',
    'DRAIN_TIMED_OUT',
    'DRAIN_LATE_COMPLETED',
    'DRAIN_FAILED',
  ];
  if (definition.recoveryPolicy.targetRelease === 'REQUIRED') {
    stopEventTypes.push('RELEASE_STARTED', 'RELEASE_COMPLETED', 'RELEASE_FAILED');
  } else if (definition.recoveryStrategy === 'NON_RELEASING') {
    stopEventTypes.push('NON_RELEASING_RECORDED');
  } else {
    stopEventTypes.push('RELEASE_SKIPPED');
  }
  stopEventTypes.push('CLEANUP_SKIPPED');
  if (definition.recoveryPolicy.cleanup !== 'NONE') {
    stopEventTypes.push(
      'MANUAL_CLEANUP_REQUIRED',
      'MANUAL_CLEANUP_REQUESTED',
      'MANUAL_CLEANUP_COMPLETED',
      'MANUAL_CLEANUP_FAILED',
    );
  }
  if (definition.recoveryPolicy.verification === 'NOT_CONFIGURED') {
    stopEventTypes.push('VERIFY_STARTED', 'VERIFY_UNAVAILABLE');
  } else {
    stopEventTypes.push('VERIFY_STARTED', 'VERIFY_COMPLETED', 'VERIFY_UNAVAILABLE', 'VERIFY_FAILED');
  }
  stopEventTypes.push('RECOVERY_BLOCKED', 'RECOVERY_COMPLETED');
  const cleanupActionTypes: FaultRunCleanupActionType[] = definition.recoveryPolicy.cleanup === 'NONE'
    ? []
    : ['CLEANUP'];
  const recoveryRecipeIds = evidence.recipes
    .filter((recipe) => recipe.window === 'recovery'
      && (recipe.source === 'PROMETHEUS'
        || recipe.source === 'RESOURCE_CHECK'
        || recipe.source === 'BUSINESS_CHECK')
      && recipe.observationMode === 'WINDOWED')
    .map(({ id }) => id);
  if (recoveryRecipeIds.length === 0) throw new Error('CATALOG_CONTRACT_RECOVERY_EVIDENCE_REQUIRED');
  if (definition.recoveryPolicy.cleanup !== 'NONE'
    && !evidence.recipes.some((recipe) => recipe.window === 'cleanup')) {
    throw new Error('CATALOG_CONTRACT_CLEANUP_EVIDENCE_REQUIRED');
  }
  if ((definition.recoveryStrategy === 'NON_RELEASING') !== (nonReleasingReason !== undefined)) {
    throw new Error('CATALOG_CONTRACT_NON_RELEASING_REASON_INVALID');
  }

  return {
    prepareEventTypes,
    stopEventTypes,
    cleanupActionTypes,
    recoveryRecipeIds,
    sideEffectRecipeIds: [...evidence.effectRule.recipeIds],
    ...(nonReleasingReason === undefined ? {} : { nonReleasingReason }),
  };
}

function buildEvidenceContract(
  scenario: FaultRunScenario,
  input: ScenarioEvidenceInput,
): EvidenceContractPlan {
  if (input.scopes.length === 0 || input.signals.length === 0) {
    throw new Error('CATALOG_CONTRACT_EVIDENCE_SIGNAL_REQUIRED');
  }
  const slug = scenario.toLowerCase().replaceAll('_', '-');
  const recipes: EvidenceRecipeDefinition[] = [];
  const effectRecipeIds: string[] = [];

  for (const signal of input.signals) {
    const source = signal.source ?? 'PROMETHEUS';
    const sourceSlug = source.toLowerCase().replaceAll('_', '-');
    const activeId = `${slug}.${sourceSlug}.active-${signal.id}`;
    const recoveryId = `${slug}.${sourceSlug}.recovery-${signal.id}`;
    const activePredicate = signal.activePredicate
      ?? (signal.activeThreshold === undefined
        ? undefined
        : { kind: 'COMPARISON' as const, operator: 'GT' as const, value: signal.activeThreshold });
    if (!activePredicate || activePredicate.kind === 'NONE') {
      throw new Error('CATALOG_CONTRACT_EFFECT_PREDICATE_REQUIRED');
    }
    const activeRecipe = recipe(
      activeId,
      source,
      'active',
      'WINDOWED',
      signal.effect !== false,
      signal.template,
      signal.scope,
      activePredicate,
      source === 'TEMPO' ? 'COUNT' : 'NUMERIC',
    );
    const recoveryPredicate = signal.recoveryPredicate ?? invertPredicate(activePredicate);
    const recoveryRecipe = recipe(
      recoveryId,
      source,
      'recovery',
      'WINDOWED',
      false,
      signal.template,
      signal.scope,
      recoveryPredicate,
      source === 'TEMPO' ? 'COUNT' : 'NUMERIC',
    );
    recipes.push(activeRecipe, recoveryRecipe);
    if (signal.effect !== false) effectRecipeIds.push(activeId);
  }

  recipes.push(
    recipe(
      `${slug}.run.active-timeline`,
      'RUN_EVENT',
      'active',
      'WINDOWED',
      true,
      'RUN_TIMELINE',
      { service: 'traffic-control-plane' },
      { kind: 'NONE' },
      'TIMELINE',
    ),
    recipe(
      `${slug}.run.recovery-timeline`,
      'RUN_EVENT',
      'recovery',
      'WINDOWED',
      false,
      'RUN_TIMELINE',
      { service: 'traffic-control-plane' },
      { kind: 'NONE' },
      'TIMELINE',
    ),
  );

  for (const scope of input.scopes) {
    const scopeId = evidenceScopeId(scope);
    recipes.push(
      recipe(
        `${slug}.loki.${scopeId}.active-errors`,
        'LOKI',
        'active',
        'WINDOWED',
        false,
        'SERVICE_ERROR_COUNT',
        scope,
        { kind: 'COMPARISON', operator: 'GT', value: 0 },
        'COUNT',
      ),
      recipe(
        `${slug}.tempo.${scopeId}.active-slow-requests`,
        'TEMPO',
        'active',
        'WINDOWED',
        false,
        'SERVICE_SLOW_REQUESTS',
        scope,
        { kind: 'COMPARISON', operator: 'GT', value: input.tempoSlowThresholdSec },
        'COUNT',
      ),
    );
  }

  if (input.currentReadCheck) {
    const scope = input.currentReadCheckScope ?? input.scopes[0];
    if (!scope) throw new Error('CATALOG_CONTRACT_CURRENT_CHECK_SCOPE_REQUIRED');
    recipes.push(recipe(
      `${slug}.business.current-check`,
      'BUSINESS_CHECK',
      'recovery',
      'CURRENT',
      false,
      input.currentReadCheck,
      scope,
      { kind: 'NONE' },
      'BOOLEAN',
    ));
  }
  if (input.cleanupCheck) {
    recipes.push(recipe(
      `${slug}.run.cleanup-timeline`,
      'RUN_EVENT',
      'cleanup',
      'WINDOWED',
      true,
      'RUN_TIMELINE',
      { service: 'traffic-control-plane' },
      { kind: 'NONE' },
      'TIMELINE',
    ));
  }

  if (effectRecipeIds.length === 0) throw new Error('CATALOG_CONTRACT_EFFECT_RECIPE_REQUIRED');
  return {
    schemaVersion: 'evidence-contract.v1',
    windows: EVIDENCE_WINDOWS,
    recipes,
    effectRule: {
      mode: input.effectRuleMode ?? 'ALL',
      recipeIds: effectRecipeIds,
    },
  };
}

function invertPredicate(predicate: EvidencePredicate): EvidencePredicate {
  if (predicate.kind === 'BOOLEAN_EQUALS') {
    return { kind: 'BOOLEAN_EQUALS', expected: !predicate.expected };
  }
  if (predicate.kind !== 'COMPARISON') {
    throw new Error('CATALOG_CONTRACT_RECOVERY_PREDICATE_REQUIRED');
  }
  switch (predicate.operator) {
    case 'GT':
      return { kind: 'COMPARISON', operator: 'LTE', value: predicate.value };
    case 'GTE':
      return { kind: 'COMPARISON', operator: 'LT', value: predicate.value };
    case 'LT':
      return { kind: 'COMPARISON', operator: 'GTE', value: predicate.value };
    case 'LTE':
      return { kind: 'COMPARISON', operator: 'GT', value: predicate.value };
    case 'EQ':
      throw new Error('CATALOG_CONTRACT_RECOVERY_PREDICATE_REQUIRED');
  }
}

function recipe(
  id: string,
  source: EvidenceRecipeDefinition['source'],
  window: EvidenceRecipeDefinition['window'],
  observationMode: EvidenceRecipeDefinition['observationMode'],
  required: boolean,
  template: EvidenceRecipeDefinition['template'],
  scope: EvidenceScope,
  predicate: EvidencePredicate,
  projection: EvidenceRecipeDefinition['projection'],
): EvidenceRecipeDefinition {
  return {
    id,
    source,
    window,
    observationMode,
    required,
    template,
    scope,
    predicate,
    projection,
  };
}

function evidenceScopeId(scope: EvidenceScope): string {
  return [scope.service, scope.route]
    .filter((value): value is string => value !== undefined)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function evidenceScope(
  service: string,
  route?: string,
  fixedLabels?: Readonly<Record<string, string>>,
): EvidenceScope {
  return {
    service,
    ...(route === undefined ? {} : { route }),
    ...(fixedLabels === undefined ? {} : { fixedLabels }),
  };
}

function alertCorrelation(
  alertName: string,
  service: string,
  severity: AlertCorrelationContract['severity'],
  requiredLabels: Readonly<Record<string, string>> = {},
  faultRunCorrelation: AlertCorrelationContract['faultRunCorrelation'] = 'optional',
): AlertCorrelationContract {
  return {
    alertName,
    service,
    severity,
    requiredLabels,
    incidentKeyLabels: faultRunCorrelation === 'not_required'
      ? []
      : Object.keys(requiredLabels).sort(compareStrings),
    ...ALERT_CORRELATION_TIMING,
    sendResolvedToControlPlane: true,
    faultRunCorrelation,
  };
}

function conditionalAlerts(...allowedAlerts: readonly AlertCorrelationContract[]): ScenarioAlertContract {
  if (allowedAlerts.length === 0) throw new Error('CATALOG_CONTRACT_ALERT_SIGNAL_REQUIRED');
  return {
    expectation: 'CONDITIONAL',
    allowedAlerts,
    missingAlertTreatment: 'EFFECT_CAN_STILL_BE_OBSERVED',
    receiptPolicyId: 'alert-receipt.v1',
  };
}

function httpPerformanceAlerts(service: string, route: string): readonly AlertCorrelationContract[] {
  const labels = { uri: route };
  return [
    alertCorrelation('HighErrorRate', service, 'critical', labels),
    alertCorrelation('HighLatencyP99', service, 'warning', labels),
    alertCorrelation('CriticalLatencyP99', service, 'critical', labels),
  ];
}

function httpLatencyAlerts(service: string, route: string): readonly AlertCorrelationContract[] {
  const labels = { uri: route };
  return [
    alertCorrelation('HighLatencyP99', service, 'warning', labels),
    alertCorrelation('CriticalLatencyP99', service, 'critical', labels),
  ];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseParameterNumber(parameter: FaultRunParameterDefinition, supplied: unknown): number | undefined {
  if (typeof supplied === 'number') return supplied;
  if (parameter.unit !== 'bytes' || typeof supplied !== 'string') return undefined;

  const match = supplied.trim().match(/^(\d+(?:\.\d+)?)(B|KB?|MB?|GB?)?$/i);
  if (!match) return undefined;
  const multiplier = match[2] === undefined ? 1 : BYTE_UNIT_MULTIPLIERS[match[2].toUpperCase()];
  return Number(match[1]) * multiplier;
}

function validateParameterNumber(parameter: FaultRunParameterDefinition, supplied: unknown): number | undefined {
  const numericValue = parseParameterNumber(parameter, supplied);
  if (numericValue === undefined || !Number.isFinite(numericValue)
      || (parameter.kind === 'integer' && !Number.isSafeInteger(numericValue))
      || (parameter.min !== undefined && numericValue < parameter.min)
      || (parameter.max !== undefined && numericValue > parameter.max)) {
    return undefined;
  }
  return numericValue;
}

const CATALOG: Record<FaultRunScenario, FaultRunScenarioDefinition> = {
  BROWSE_REPORT_SQL: defineScenario({
    scenario: 'BROWSE_REPORT_SQL',
    targetPrepare: 'REQUIRED',
    targetService: 'catalog-service',
    targetOperation: 'products-browse-report',
    maxDurationSec: 3600,
    recoveryStrategy: 'WORKER',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'REPORT_SCENARIO_WORKER' },
      targetRelease: 'REQUIRED',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration],
  }, {
    budgets: [],
    evidence: buildEvidenceContract('BROWSE_REPORT_SQL', {
      scopes: [evidenceScope('catalog-service', '/api/reports/product-browse')],
      signals: [
        {
          id: 'report-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('catalog-service', '/api/reports/product-browse'),
          activeThreshold: 2,
        },
        {
          id: 'mysql-slow-query-rate',
          template: 'MYSQL_SLOW_QUERY_RATE',
          scope: evidenceScope('mysql'),
          activeThreshold: 0.5,
        },
      ],
      effectRuleMode: 'ANY',
      tempoSlowThresholdSec: 2,
      currentReadCheck: 'CATALOG_BROWSE_REPORT',
      currentReadCheckScope: evidenceScope('catalog-service', '/api/reports/product-browse'),
    }),
    alert: conditionalAlerts(
      ...httpLatencyAlerts('catalog-service', '/api/reports/product-browse'),
      alertCorrelation('MySQLSlowQueries', 'mysql', 'warning', {}, 'not_required'),
      alertCorrelation('HikariPoolExhaustion', 'catalog-service', 'warning'),
    ),
  }),
  ORDER_REPORT_SQL: defineScenario({
    scenario: 'ORDER_REPORT_SQL',
    targetPrepare: 'REQUIRED',
    targetService: 'order-service',
    targetOperation: 'orders-query-report',
    maxDurationSec: 3600,
    recoveryStrategy: 'WORKER',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'REPORT_SCENARIO_WORKER' },
      targetRelease: 'REQUIRED',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration],
  }, {
    budgets: [],
    evidence: buildEvidenceContract('ORDER_REPORT_SQL', {
      scopes: [evidenceScope('order-service', '/api/reports/order-query')],
      signals: [
        {
          id: 'report-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('order-service', '/api/reports/order-query'),
          activeThreshold: 2,
        },
        {
          id: 'mysql-slow-query-rate',
          template: 'MYSQL_SLOW_QUERY_RATE',
          scope: evidenceScope('mysql'),
          activeThreshold: 0.5,
        },
        {
          id: 'hikari-utilization',
          template: 'HIKARI_UTILIZATION',
          scope: evidenceScope('order-service'),
          activeThreshold: 0.8,
          effect: false,
        },
      ],
      effectRuleMode: 'ANY',
      tempoSlowThresholdSec: 2,
    }),
    alert: conditionalAlerts(
      ...httpLatencyAlerts('order-service', '/api/reports/order-query'),
      alertCorrelation('MySQLSlowQueries', 'mysql', 'warning', {}, 'not_required'),
      alertCorrelation('HikariPoolExhaustion', 'order-service', 'warning'),
    ),
  }),
  BROWSE_SURGE: defineScenario({
    scenario: 'BROWSE_SURGE',
    targetPrepare: 'NOT_APPLICABLE',
    targetService: 'catalog-service',
    targetOperation: 'browse-api-worker',
    maxDurationSec: 1800,
    recoveryStrategy: 'WORKER',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'TRAFFIC_SURGE_EXECUTOR' },
      targetRelease: 'NOT_APPLICABLE',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration, trafficSurgeConcurrency, requestInterval,
      { name: 'pageSize', kind: 'integer', default: 20, min: 1, max: TRAFFIC_SURGE_MAX_PAGE_SIZE }],
  }, {
    workerExecutionParameters: ['concurrency', 'requestIntervalMs', 'pageSize'],
    budgets: [{
      resource: 'REQUEST_CONCURRENCY',
      boundary: { kind: 'PARAMETER_BOUNDS', parameterNames: ['concurrency'] },
    }],
    evidence: buildEvidenceContract('BROWSE_SURGE', {
      scopes: [
        evidenceScope('gateway-service', '/api/products'),
        evidenceScope('catalog-service', '/api/products'),
      ],
      signals: [
        {
          id: 'gateway-request-rate',
          template: 'HTTP_RATE',
          scope: evidenceScope('gateway-service', '/api/products'),
          activeThreshold: 10,
        },
        {
          id: 'catalog-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('catalog-service', '/api/products'),
          activeThreshold: 5,
          effect: false,
        },
      ],
      tempoSlowThresholdSec: 1,
      currentReadCheck: 'CATALOG_PRODUCT_LIST',
      currentReadCheckScope: evidenceScope('catalog-service', '/api/products'),
    }),
    alert: conditionalAlerts(
      alertCorrelation('TrafficSurge', 'gateway-service', 'warning', { uri: '/api/products' }),
      ...httpPerformanceAlerts('gateway-service', '/api/products'),
      ...httpPerformanceAlerts('catalog-service', '/api/products'),
      alertCorrelation('HikariPoolExhaustion', 'catalog-service', 'warning'),
      alertCorrelation('MySQLHighThreads', 'mysql', 'warning', {}, 'not_required'),
    ),
  }),
  ORDER_QUERY_SURGE: defineScenario({
    scenario: 'ORDER_QUERY_SURGE',
    targetPrepare: 'NOT_APPLICABLE',
    targetService: 'order-service',
    targetOperation: 'order-query-worker',
    maxDurationSec: 1800,
    recoveryStrategy: 'WORKER',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'TRAFFIC_SURGE_EXECUTOR' },
      targetRelease: 'NOT_APPLICABLE',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration, trafficSurgeConcurrency, requestInterval,
      { name: 'pageSize', kind: 'integer', default: 20, min: 1, max: TRAFFIC_SURGE_MAX_PAGE_SIZE }],
  }, {
    workerExecutionParameters: ['concurrency', 'requestIntervalMs', 'pageSize'],
    budgets: [{
      resource: 'REQUEST_CONCURRENCY',
      boundary: { kind: 'PARAMETER_BOUNDS', parameterNames: ['concurrency'] },
    }],
    evidence: buildEvidenceContract('ORDER_QUERY_SURGE', {
      scopes: [
        evidenceScope('gateway-service', '/api/orders'),
        evidenceScope('order-service', '/api/orders'),
      ],
      signals: [
        {
          id: 'gateway-request-rate',
          template: 'HTTP_RATE',
          scope: evidenceScope('gateway-service', '/api/orders'),
          activeThreshold: 10,
        },
        {
          id: 'order-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('order-service', '/api/orders'),
          activeThreshold: 5,
          effect: false,
        },
      ],
      tempoSlowThresholdSec: 1,
    }),
    alert: conditionalAlerts(
      alertCorrelation('TrafficSurge', 'gateway-service', 'warning', { uri: '/api/orders' }),
      ...httpPerformanceAlerts('gateway-service', '/api/orders'),
      ...httpPerformanceAlerts('order-service', '/api/orders'),
      alertCorrelation('HikariPoolExhaustion', 'order-service', 'warning'),
    ),
  }),
  CATALOG_REDIS_LARGE_VALUE: defineScenario({
    scenario: 'CATALOG_REDIS_LARGE_VALUE',
    targetPrepare: 'REQUIRED',
    targetService: 'catalog-service',
    targetOperation: 'product-detail-cache',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
      targetRelease: 'REQUIRED',
      cleanup: 'OPTIONAL_PER_RUN',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: true,
    parameters: [duration, boundedConcurrency, requestInterval,
      { name: 'memberCount', kind: 'integer', default: 8, min: 1, max: 47 },
      { name: 'memberSizeBytes', kind: 'integer', unit: 'bytes', default: '32M', min: CATALOG_LARGE_VALUE_MIN_MEMBER_SIZE_BYTES, max: 128 * 1024 * 1024 },
      { name: 'keyTtlSec', kind: 'integer', default: 900, min: 1, max: 3600 }],
  }, {
    targetPrepareParameters: ['memberCount', 'memberSizeBytes', 'keyTtlSec'],
    workerExecutionParameters: ['concurrency', 'requestIntervalMs'],
    budgets: [
      {
        resource: 'REQUEST_CONCURRENCY',
        boundary: { kind: 'PARAMETER_BOUNDS', parameterNames: ['concurrency'] },
      },
      {
        resource: 'REDIS_LOGICAL_BYTES',
        boundary: {
          kind: 'CATALOG_RULE',
          ruleId: 'CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES',
          parameterNames: ['memberCount', 'memberSizeBytes'],
        },
      },
    ],
    evidence: buildEvidenceContract('CATALOG_REDIS_LARGE_VALUE', {
      scopes: [evidenceScope('catalog-service', '/api/products/{sku}')],
      signals: [
        {
          id: 'detail-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('catalog-service', '/api/products/{sku}'),
          activeThreshold: 1,
        },
        {
          id: 'redis-memory',
          template: 'REDIS_MEMORY_RATIO',
          scope: evidenceScope('redis'),
          activeThreshold: 0.8,
          effect: false,
        },
        {
          id: 'catalog-heap',
          template: 'JVM_HEAP_RATIO',
          scope: evidenceScope('catalog-service'),
          activeThreshold: 0.85,
          effect: false,
        },
      ],
      effectRuleMode: 'ANY',
      tempoSlowThresholdSec: 1,
      currentReadCheck: 'CATALOG_PRODUCT_LIST',
      currentReadCheckScope: evidenceScope('catalog-service', '/api/products'),
      cleanupCheck: true,
    }),
    alert: conditionalAlerts(
      ...httpLatencyAlerts('catalog-service', '/api/products/{sku}'),
      alertCorrelation('HighHeapUsage', 'catalog-service', 'warning'),
      alertCorrelation('CriticalHeapUsage', 'catalog-service', 'critical'),
      alertCorrelation('FrequentGCPause', 'catalog-service', 'warning'),
      alertCorrelation('RedisHighMemory', 'redis', 'warning', {}, 'not_required'),
    ),
  }),
  CART_CATALOG_DEPENDENCY: defineScenario({
    scenario: 'CART_CATALOG_DEPENDENCY',
    targetPrepare: 'REQUIRED',
    targetService: 'catalog-service',
    targetOperation: 'cart-product-validation',
    maxDurationSec: 900,
    recoveryStrategy: 'TARGET',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
      targetRelease: 'REQUIRED',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration],
  }, {
    budgets: [],
    evidence: buildEvidenceContract('CART_CATALOG_DEPENDENCY', {
      scopes: [
        evidenceScope('cart-service', '/api/cart/items'),
        evidenceScope('catalog-service', '/internal/catalog/products/{sku}/validate'),
      ],
      signals: [
        {
          id: 'cart-error-ratio',
          template: 'HTTP_ERROR_RATIO',
          scope: evidenceScope('cart-service', '/api/cart/items'),
          activeThreshold: 0.05,
        },
        {
          id: 'cart-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('cart-service', '/api/cart/items'),
          activeThreshold: 0.5,
        },
        {
          id: 'catalog-validation-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('catalog-service', '/internal/catalog/products/{sku}/validate'),
          activeThreshold: 0.5,
          effect: false,
        },
      ],
      effectRuleMode: 'ANY',
      tempoSlowThresholdSec: 0.5,
    }),
    alert: conditionalAlerts(
      ...httpPerformanceAlerts('cart-service', '/api/cart/items'),
      ...httpPerformanceAlerts('catalog-service', '/internal/catalog/products/{sku}/validate'),
    ),
  }),
  NOTIFICATION_HEAP_PRESSURE: defineScenario({
    scenario: 'NOTIFICATION_HEAP_PRESSURE',
    targetPrepare: 'REQUIRED',
    targetService: 'notification-service',
    targetOperation: 'notification-retention',
    maxDurationSec: 3600,
    recoveryStrategy: 'NON_RELEASING',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'RUNNER_ENGINE' },
      targetRelease: 'FORBIDDEN',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration, requestInterval,
      { name: 'retainedBytesPerNotification', kind: 'integer', unit: 'bytes', default: '1M', min: 1024, max: 10 * 1024 * 1024 }],
  }, {
    targetPrepareParameters: ['retainedBytesPerNotification'],
    workerExecutionParameters: ['requestIntervalMs'],
    budgets: [{
      resource: 'JVM_RETAINED_BYTES',
      boundary: {
        kind: 'APPROVED_NON_RELEASING_EXCEPTION',
        ruleId: 'NOTIFICATION_HEAP_PRESSURE_UNBOUNDED_RETAINED_HEAP',
        hardTargetMaximum: 'UNBOUNDED_BY_DESIGN',
        allowedEnvironment: 'DISPOSABLE_ONLY',
        runtimeOutcome: 'OOM_OR_SERVICE_RESTART_POSSIBLE',
      },
    }],
    evidence: buildEvidenceContract('NOTIFICATION_HEAP_PRESSURE', {
      scopes: [evidenceScope('notification-service')],
      signals: [
        {
          id: 'heap-ratio',
          template: 'JVM_HEAP_RATIO',
          scope: evidenceScope('notification-service'),
          activeThreshold: 0.85,
          recoveryPredicate: { kind: 'COMPARISON', operator: 'GT', value: 0.85 },
        },
        {
          id: 'notification-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('notification-service'),
          activeThreshold: 1,
          effect: false,
        },
      ],
      effectRuleMode: 'ANY',
      tempoSlowThresholdSec: 1,
    }),
    alert: conditionalAlerts(
      alertCorrelation('HighHeapUsage', 'notification-service', 'warning'),
      alertCorrelation('CriticalHeapUsage', 'notification-service', 'critical'),
      alertCorrelation('FrequentGCPause', 'notification-service', 'warning'),
      alertCorrelation('ServiceDown', 'notification-service', 'critical'),
    ),
    nonReleasingReason: 'Stopping the worker prevents further allocations but does not release retained objects.',
  }),
  NOTIFICATION_STORAGE_APPEND: defineScenario({
    scenario: 'NOTIFICATION_STORAGE_APPEND',
    targetPrepare: 'REQUIRED',
    targetService: 'notification-service',
    targetOperation: 'notification-storage',
    maxDurationSec: 3600,
    recoveryStrategy: 'MANUAL_CLEANUP',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'RUNNER_ENGINE' },
      targetRelease: 'REQUIRED',
      cleanup: 'OPERATOR_CONFIRMED',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: true,
    parameters: [duration, requestInterval,
      { name: 'totalBytes', kind: 'integer', unit: 'bytes', default: '10G', min: 1024 },
      { name: 'appendBytes', kind: 'integer', unit: 'bytes', default: '16M', min: 1, max: 64 * 1024 * 1024 },
      { name: 'minFreeBytes', kind: 'integer', unit: 'bytes', default: '1M', min: 1024 ** 2, max: 1073741824 }],
  }, {
    targetPrepareParameters: ['totalBytes', 'appendBytes', 'minFreeBytes'],
    workerExecutionParameters: ['requestIntervalMs', 'totalBytes'],
    budgets: [
      {
        resource: 'STORAGE_FILE_BYTES',
        boundary: {
          kind: 'TARGET_CAPACITY_GUARD',
          guardId: 'FILESYSTEM_USABLE_SPACE_RESERVE',
          targetBytesParameter: 'totalBytes',
          reserveBytesParameter: 'minFreeBytes',
          hardTargetMaximum: 'UNBOUNDED_BY_DESIGN',
        },
      },
      {
        resource: 'STORAGE_FILE_BYTES',
        boundary: { kind: 'PARAMETER_BOUNDS', parameterNames: ['appendBytes'] },
      },
    ],
    evidence: buildEvidenceContract('NOTIFICATION_STORAGE_APPEND', {
      scopes: [
        evidenceScope('notification-service', '/internal/notification/storage/append'),
        evidenceScope('node', undefined, { mountpoint: '/data', fstype: 'ext4' }),
      ],
      signals: [
        {
          id: 'storage-append-route',
          source: 'TEMPO',
          template: 'SERVICE_ROUTE_REQUESTS',
          scope: evidenceScope('notification-service', '/internal/notification/storage/append'),
          activeThreshold: 0,
        },
        {
          id: 'filesystem-growth-rate',
          template: 'NODE_FILESYSTEM_GROWTH_RATE',
          scope: evidenceScope('node', undefined, { mountpoint: '/data', fstype: 'ext4' }),
          activePredicate: { kind: 'COMPARISON', operator: 'LT', value: -(2 * 1024 ** 2) },
        },
        {
          id: 'filesystem-utilization',
          template: 'NODE_FILESYSTEM_RATIO',
          scope: evidenceScope('node', undefined, { mountpoint: '/data', fstype: 'ext4' }),
          activeThreshold: 0.7,
          effect: false,
        },
      ],
      effectRuleMode: 'ALL',
      tempoSlowThresholdSec: 1,
      cleanupCheck: true,
    }),
    alert: conditionalAlerts(
      alertCorrelation(
        'NodeDataFilesystemGrowthRateHigh',
        'node',
        'warning',
        { mountpoint: '/data', fstype: 'ext4' },
        'not_required',
      ),
      alertCorrelation(
        'NodeDataFilesystemUsageHigh',
        'node',
        'warning',
        { mountpoint: '/data', fstype: 'ext4' },
        'not_required',
      ),
      alertCorrelation('HighErrorRate', 'notification-service', 'critical'),
    ),
  }),
  PROMOTION_LOCK_CONTENTION: defineScenario({
    scenario: 'PROMOTION_LOCK_CONTENTION',
    targetPrepare: 'REQUIRED',
    targetService: 'promotion-service',
    targetOperation: 'coupon-reservation-consistency',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
      targetRelease: 'REQUIRED',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration, boundedConcurrency, requestInterval],
  }, {
    workerExecutionParameters: ['concurrency', 'requestIntervalMs'],
    budgets: [{
      resource: 'REQUEST_CONCURRENCY',
      boundary: { kind: 'PARAMETER_BOUNDS', parameterNames: ['concurrency'] },
    }],
    evidence: buildEvidenceContract('PROMOTION_LOCK_CONTENTION', {
      scopes: [evidenceScope('promotion-service')],
      signals: [
        {
          id: 'promotion-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('promotion-service'),
          activeThreshold: 1,
        },
        {
          id: 'hikari-utilization',
          template: 'HIKARI_UTILIZATION',
          scope: evidenceScope('promotion-service'),
          activeThreshold: 0.8,
          effect: false,
        },
      ],
      tempoSlowThresholdSec: 1,
    }),
    alert: conditionalAlerts(
      alertCorrelation('HighLatencyP99', 'promotion-service', 'warning'),
      alertCorrelation('CriticalLatencyP99', 'promotion-service', 'critical'),
      alertCorrelation('HighErrorRate', 'promotion-service', 'critical'),
      alertCorrelation('HikariPoolExhaustion', 'promotion-service', 'warning'),
      alertCorrelation('HikariPoolPending', 'promotion-service', 'critical'),
    ),
  }),
  INVENTORY_TABLE_EXCLUSIVE: defineScenario({
    scenario: 'INVENTORY_TABLE_EXCLUSIVE',
    targetPrepare: 'REQUIRED',
    targetService: 'inventory-service',
    targetOperation: 'inventory-availability-report',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
      targetRelease: 'REQUIRED',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration],
  }, {
    budgets: [],
    evidence: buildEvidenceContract('INVENTORY_TABLE_EXCLUSIVE', {
      scopes: [evidenceScope('inventory-service', '/internal/inventory/availability/report')],
      signals: [
        {
          id: 'availability-report-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('inventory-service', '/internal/inventory/availability/report'),
          activeThreshold: 1,
        },
        {
          id: 'hikari-utilization',
          template: 'HIKARI_UTILIZATION',
          scope: evidenceScope('inventory-service'),
          activeThreshold: 0.8,
          effect: false,
        },
      ],
      tempoSlowThresholdSec: 1,
    }),
    alert: conditionalAlerts(
      ...httpPerformanceAlerts('inventory-service', '/internal/inventory/availability/report'),
      alertCorrelation('HikariPoolExhaustion', 'inventory-service', 'warning'),
      alertCorrelation('HikariPoolPending', 'inventory-service', 'critical'),
    ),
  }),
  INVENTORY_ROW_LOCK: defineScenario({
    scenario: 'INVENTORY_ROW_LOCK',
    targetPrepare: 'REQUIRED',
    targetService: 'inventory-service',
    targetOperation: 'inventory-reservation-summary',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'SCENARIO_WORKERS' },
      targetRelease: 'REQUIRED',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration, boundedConcurrency, requestInterval],
  }, {
    workerExecutionParameters: ['concurrency', 'requestIntervalMs'],
    budgets: [{
      resource: 'REQUEST_CONCURRENCY',
      boundary: { kind: 'PARAMETER_BOUNDS', parameterNames: ['concurrency'] },
    }],
    evidence: buildEvidenceContract('INVENTORY_ROW_LOCK', {
      scopes: [evidenceScope('inventory-service', '/internal/inventory/reservations/summary')],
      signals: [
        {
          id: 'reservation-summary-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('inventory-service', '/internal/inventory/reservations/summary'),
          activeThreshold: 1,
        },
        {
          id: 'hikari-utilization',
          template: 'HIKARI_UTILIZATION',
          scope: evidenceScope('inventory-service'),
          activeThreshold: 0.8,
          effect: false,
        },
      ],
      tempoSlowThresholdSec: 1,
    }),
    alert: conditionalAlerts(
      ...httpPerformanceAlerts('inventory-service', '/internal/inventory/reservations/summary'),
      alertCorrelation('HikariPoolExhaustion', 'inventory-service', 'warning'),
      alertCorrelation('HikariPoolPending', 'inventory-service', 'critical'),
    ),
  }),
  PSP_PROVIDER_OUTCOME: defineScenario({
    scenario: 'PSP_PROVIDER_OUTCOME',
    targetPrepare: 'REQUIRED',
    targetService: 'psp-simulator',
    targetOperation: 'provider-outcome',
    maxDurationSec: 1800,
    recoveryStrategy: 'TARGET',
    recoveryPolicy: {
      workerDrain: { requirement: 'REQUIRED', owner: 'RUNNER_ENGINE' },
      targetRelease: 'REQUIRED',
      cleanup: 'NONE',
      verification: 'NOT_CONFIGURED',
    },
    allowManualCleanup: false,
    parameters: [duration,
      { name: 'providerOutcome', kind: 'string', required: true, default: 'TIMEOUT', options: ['AUTHORIZED', 'DECLINED', 'TIMEOUT'], maxLength: 16 },
      { name: 'effectPercentage', kind: 'integer', default: 100, min: 0, max: 100 }],
  }, {
    targetPrepareParameters: ['providerOutcome', 'effectPercentage'],
    budgets: [],
    evidence: buildEvidenceContract('PSP_PROVIDER_OUTCOME', {
      scopes: [
        evidenceScope('payment-service'),
        evidenceScope('psp-simulator', '/api/psp/authorize'),
      ],
      signals: [
        {
          id: 'payment-failure-ratio',
          template: 'PAYMENT_FAILURE_RATIO',
          scope: evidenceScope('payment-service'),
          activeThreshold: 0.1,
        },
        {
          id: 'payment-timeout-rate',
          template: 'PAYMENT_TIMEOUT_RATE',
          scope: evidenceScope('payment-service'),
          activeThreshold: 0.5,
        },
        {
          id: 'provider-route-p99',
          template: 'HTTP_P99',
          scope: evidenceScope('psp-simulator', '/api/psp/authorize'),
          activeThreshold: 3,
        },
      ],
      effectRuleMode: 'ANY',
      tempoSlowThresholdSec: 3,
    }),
    alert: conditionalAlerts(
      alertCorrelation('PaymentFailureRateHigh', 'payment-service', 'critical'),
      alertCorrelation('PaymentTimeoutSpike', 'payment-service', 'warning'),
      ...httpPerformanceAlerts('psp-simulator', '/api/psp/authorize'),
    ),
  }),
};

for (const definition of Object.values(CATALOG)) {
  assertFaultRunRecoveryPolicy(definition);
}

export class FaultRunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultRunValidationError';
  }
}

export function getScenarioDefinition(scenario: string): FaultRunScenarioDefinition {
  const definition = Object.prototype.hasOwnProperty.call(CATALOG, scenario)
    ? CATALOG[scenario as FaultRunScenario]
    : undefined;
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
      if (parameter.default !== undefined) {
        if (parameter.kind === 'string') {
          result[parameter.name] = parameter.default;
        } else {
          const defaultValue = validateParameterNumber(parameter, parameter.default);
          if (defaultValue === undefined) throw new FaultRunValidationError(`INVALID_PARAMETER:${parameter.name}`);
          result[parameter.name] = defaultValue;
        }
      }
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
    const numericValue = validateParameterNumber(parameter, supplied);
    if (numericValue === undefined) {
      throw new FaultRunValidationError(`INVALID_PARAMETER:${parameter.name}`);
    }
    result[parameter.name] = numericValue;
  }

  const durationSec = Number(result.durationSec);
  if (durationSec > definition.maxDurationSec) {
    throw new FaultRunValidationError('DURATION_EXCEEDS_SCENARIO_LIMIT');
  }
  if (scenario === 'CATALOG_REDIS_LARGE_VALUE') {
    validateCatalogLargeValueParameters(result, durationSec);
  }
  return result;
}

function validateCatalogLargeValueParameters(
  parameters: Record<string, number | string>,
  durationSec: number,
): void {
  const memberCount = Number(parameters.memberCount);
  const memberSizeBytes = Number(parameters.memberSizeBytes);
  const keyTtlSec = Number(parameters.keyTtlSec);
  if (memberCount * memberSizeBytes > CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES) {
    throw new FaultRunValidationError('AGGREGATE_LOGICAL_BYTES_EXCEEDS_LIMIT');
  }
  if (keyTtlSec < durationSec + CATALOG_LARGE_VALUE_CLEANUP_GRACE_SEC) {
    throw new FaultRunValidationError('KEY_TTL_TOO_SHORT');
  }
}
