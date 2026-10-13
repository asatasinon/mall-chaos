import { createHash } from 'node:crypto';
import { ALERT_RECEIPT_POLICY_ID } from './scenario-contract-constants';
import type {
  FaultRunParameterDefinition,
  FaultRunRecoveryPolicy,
  FaultRunRecoveryStrategy,
  FaultRunScenario,
  FaultRunScenarioDefinition,
  FaultRunWorkerDrainOwner,
} from './fault-run-catalog';
import type { FaultRunActionType } from './fault-run-action-repository';
import type { FaultRunRecoveryEventType as FaultRunRecoveryEventTypeSource } from './fault-run-event-contract';
import { resolveFaultRunRecoveryPolicy } from './fault-run-recovery-policy';

export const SCENARIO_CONTRACT_SCHEMA_VERSION = 'scenario-contract.v1' as const;
export { ALERT_RECEIPT_POLICY_ID } from './scenario-contract-constants';
export const SCENARIO_CONTRACT_REVISION_PATTERN = /^sc\.v1:sha256:[a-f0-9]{64}$/;

export class ScenarioContractRevisionError extends Error {
  constructor() {
    super('SCENARIO_CONTRACT_REVISION_FAILED');
    this.name = 'ScenarioContractRevisionError';
  }
}

export type ParameterConsumer = 'ADMISSION' | 'TARGET_PREPARE' | 'WORKER_EXECUTION';
export const EVIDENCE_SOURCE_VALUES = [
  'RUN_EVENT',
  'PROMETHEUS',
  'LOKI',
  'TEMPO',
  'BUSINESS_CHECK',
  'RESOURCE_CHECK',
] as const;
export type EvidenceSource = typeof EVIDENCE_SOURCE_VALUES[number];

export const EVIDENCE_WINDOW_VALUES = ['baseline', 'active', 'recovery', 'cleanup'] as const;
export type EvidenceWindow = typeof EVIDENCE_WINDOW_VALUES[number];

export const EVIDENCE_PROJECTION_VALUES = ['NUMERIC', 'COUNT', 'BOOLEAN', 'TIMELINE'] as const;
export type EvidenceProjection = typeof EVIDENCE_PROJECTION_VALUES[number];

export const EVIDENCE_TEMPLATE_VALUES = [
  'HTTP_P99',
  'HTTP_ERROR_RATIO',
  'HTTP_RATE',
  'HIKARI_UTILIZATION',
  'JVM_HEAP_RATIO',
  'MYSQL_SLOW_QUERY_RATE',
  'PAYMENT_FAILURE_RATIO',
  'PAYMENT_TIMEOUT_RATE',
  'REDIS_MEMORY_RATIO',
  'NODE_FILESYSTEM_RATIO',
  'NODE_FILESYSTEM_GROWTH_RATE',
  'SERVICE_EVENT_COUNT',
  'SERVICE_ERROR_COUNT',
  'SERVICE_REQUESTS',
  'SERVICE_ERRORS',
  'SERVICE_SLOW_REQUESTS',
  'SERVICE_ROUTE_REQUESTS',
  'CATALOG_PRODUCT_LIST',
  'CATALOG_BROWSE_REPORT',
  'RUN_TIMELINE',
] as const;
export type EvidenceTemplateId = typeof EVIDENCE_TEMPLATE_VALUES[number];

export const EVIDENCE_PREDICATE_OPERATOR_VALUES = ['GT', 'GTE', 'LT', 'LTE', 'EQ'] as const;
export const EVIDENCE_OBSERVATION_MODE_VALUES = ['WINDOWED', 'CURRENT'] as const;

const EVIDENCE_WINDOW_POLICY_KEYS = [
  'baselineBeforeActiveSec',
  'activeLeadSec',
  'activeTailSec',
  'recoveryLeadSec',
  'recoveryTailSec',
  'cleanupLeadSec',
] as const;

const EVIDENCE_RECIPE_KEYS = [
  'id',
  'source',
  'window',
  'observationMode',
  'required',
  'template',
  'scope',
  'predicate',
  'projection',
] as const;

export function isEvidenceContractPlan(value: unknown): value is EvidenceContractPlan {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, ['schemaVersion', 'windows', 'recipes', 'effectRule'])
    || value.schemaVersion !== 'evidence-contract.v1'
    || !isPlainRecord(value.windows)
    || !isEvidenceWindowPolicy(value.windows)
    || !Array.isArray(value.recipes)
    || value.recipes.length < 1
    || value.recipes.length > 512
    || !value.recipes.every(isEvidenceRecipeDefinition)
    || !isPlainRecord(value.effectRule)
    || !hasExactKeys(value.effectRule, ['mode', 'recipeIds'])
    || (value.effectRule.mode !== 'ALL' && value.effectRule.mode !== 'ANY')
    || !Array.isArray(value.effectRule.recipeIds)
    || value.effectRule.recipeIds.length < 1
    || value.effectRule.recipeIds.length > 512
    || !value.effectRule.recipeIds.every(isEvidenceRecipeId)) {
    return false;
  }
  const recipeIds = value.recipes.map((recipe) => recipe.id);
  return new Set(recipeIds).size === recipeIds.length
    && value.effectRule.recipeIds.every((recipeId) => recipeIds.includes(recipeId));
}

function isEvidenceRecipeDefinition(value: unknown): value is EvidenceRecipeDefinition {
  if (!isPlainRecord(value)
    || !hasExactKeys(value, EVIDENCE_RECIPE_KEYS)
    || !isEvidenceRecipeId(value.id)
    || !includesValue(EVIDENCE_SOURCE_VALUES, value.source)
    || !includesValue(EVIDENCE_WINDOW_VALUES, value.window)
    || !includesValue(EVIDENCE_OBSERVATION_MODE_VALUES, value.observationMode)
    || typeof value.required !== 'boolean'
    || !includesValue(EVIDENCE_TEMPLATE_VALUES, value.template)
    || !isEvidenceScope(value.scope)
    || !includesValue(EVIDENCE_PROJECTION_VALUES, value.projection)) {
    return false;
  }

  const predicate = value.predicate;
  if (!isPlainRecord(predicate)) return false;
  if (predicate.kind === 'NONE') return hasExactKeys(predicate, ['kind']);
  if (predicate.kind === 'BOOLEAN_EQUALS') {
    return hasExactKeys(predicate, ['kind', 'expected']) && typeof predicate.expected === 'boolean';
  }
  return predicate.kind === 'COMPARISON'
    && hasExactKeys(predicate, ['kind', 'operator', 'value'])
    && includesValue(EVIDENCE_PREDICATE_OPERATOR_VALUES, predicate.operator)
    && typeof predicate.value === 'number'
    && Number.isFinite(predicate.value);
}

function isEvidenceWindowPolicy(value: unknown): value is EvidenceWindowPolicy {
  return isPlainRecord(value)
    && hasExactKeys(value, EVIDENCE_WINDOW_POLICY_KEYS)
    && EVIDENCE_WINDOW_POLICY_KEYS.every((key) => isBoundedInteger(value[key], 0, 86_400));
}

function isEvidenceScope(value: unknown): value is EvidenceScope {
  if (!isPlainRecord(value)
    || !Object.keys(value).every((key) => key === 'service' || key === 'route' || key === 'fixedLabels')
    || typeof value.service !== 'string'
    || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.service)) {
    return false;
  }
  if (value.route !== undefined
    && (typeof value.route !== 'string' || value.route.length > 256 || /[\u0000-\u001f\u007f]/u.test(value.route))) {
    return false;
  }
  if (value.fixedLabels !== undefined) {
    if (!isPlainRecord(value.fixedLabels) || Object.keys(value.fixedLabels).length > 16) return false;
    for (const [key, label] of Object.entries(value.fixedLabels)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/u.test(key)
        || typeof label !== 'string'
        || label.length > 256
        || /[\u0000-\u001f\u007f]/u.test(label)) {
        return false;
      }
    }
  }
  return true;
}

function isEvidenceRecipeId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128
    && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function includesValue<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === 'string' && values.includes(value);
}

export interface EvidenceScope {
  readonly service: string;
  readonly route?: string;
  readonly fixedLabels?: Readonly<Record<string, string>>;
}

export type EvidencePredicate =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'BOOLEAN_EQUALS'; readonly expected: boolean }
  | {
      readonly kind: 'COMPARISON';
      readonly operator: 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
      readonly value: number;
    };

export interface EvidenceWindowPolicy {
  readonly baselineBeforeActiveSec: number;
  readonly activeLeadSec: number;
  readonly activeTailSec: number;
  readonly recoveryLeadSec: number;
  readonly recoveryTailSec: number;
  readonly cleanupLeadSec: number;
}

export interface EvidenceRecipeDefinition {
  readonly id: string;
  readonly source: EvidenceSource;
  readonly window: EvidenceWindow;
  readonly observationMode: 'WINDOWED' | 'CURRENT';
  readonly required: boolean;
  readonly template: EvidenceTemplateId;
  readonly scope: EvidenceScope;
  readonly predicate: EvidencePredicate;
  readonly projection: EvidenceProjection;
}

export interface EvidenceContractPlan {
  readonly schemaVersion: 'evidence-contract.v1';
  readonly windows: EvidenceWindowPolicy;
  readonly recipes: readonly EvidenceRecipeDefinition[];
  readonly effectRule: {
    readonly mode: 'ALL' | 'ANY';
    readonly recipeIds: readonly string[];
  };
}

export type BudgetBoundary =
  | {
      readonly kind: 'PARAMETER_BOUNDS';
      readonly parameterNames: readonly string[];
    }
  | {
      readonly kind: 'CATALOG_RULE';
      readonly ruleId: 'CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES';
      readonly parameterNames: readonly string[];
    }
  | {
      readonly kind: 'TARGET_CAPACITY_GUARD';
      readonly guardId: 'FILESYSTEM_USABLE_SPACE_RESERVE';
      readonly targetBytesParameter: 'totalBytes';
      readonly reserveBytesParameter: 'minFreeBytes';
      readonly hardTargetMaximum: 'UNBOUNDED_BY_DESIGN';
    }
  | {
      readonly kind: 'APPROVED_NON_RELEASING_EXCEPTION';
      readonly ruleId: 'NOTIFICATION_HEAP_PRESSURE_UNBOUNDED_RETAINED_HEAP';
      readonly hardTargetMaximum: 'UNBOUNDED_BY_DESIGN';
      readonly allowedEnvironment: 'DISPOSABLE_ONLY';
      readonly runtimeOutcome: 'OOM_OR_SERVICE_RESTART_POSSIBLE';
    };

export interface ScenarioResourceBudget {
  readonly resource:
    | 'REQUEST_CONCURRENCY'
    | 'REDIS_LOGICAL_BYTES'
    | 'JVM_RETAINED_BYTES'
    | 'STORAGE_FILE_BYTES';
  readonly boundary: BudgetBoundary;
}

export interface AlertCorrelationContract {
  readonly alertName: string;
  readonly service: string;
  readonly severity: 'warning' | 'critical';
  readonly requiredLabels: Readonly<Record<string, string>>;
  readonly incidentKeyLabels: readonly string[];
  readonly correlationWindowSec: number;
  readonly activeGraceBeforeSec: number;
  readonly recentGraceAfterSec: number;
  readonly sendResolvedToControlPlane: boolean;
  readonly faultRunCorrelation: 'required' | 'optional' | 'not_required';
}

export type ScenarioAlertContract =
  | {
      readonly expectation: 'NOT_EXPECTED';
      readonly reason: string;
      readonly faultRunCorrelation: 'not_required';
      readonly missingAlertTreatment: 'EFFECT_CAN_STILL_BE_OBSERVED';
      readonly receiptPolicyId: typeof ALERT_RECEIPT_POLICY_ID;
    }
  | {
      readonly expectation: 'CONDITIONAL' | 'REQUIRED_FOR_PILOT';
      readonly allowedAlerts: readonly AlertCorrelationContract[];
      readonly missingAlertTreatment: 'EFFECT_CAN_STILL_BE_OBSERVED' | 'EVIDENCE_UNAVAILABLE';
      readonly receiptPolicyId: typeof ALERT_RECEIPT_POLICY_ID;
    };

export type AgentDeliveryReadiness =
  | { readonly state: 'NOT_ENABLED_YET' }
  | {
      readonly state: 'ENABLED';
      readonly childRouteName: string;
      readonly externalReceiverName: string;
      readonly credentialSource: 'DEPLOYMENT_MANAGED_SECRET';
      readonly sendResolved: false;
    };

export interface ScenarioContractSupplement {
  readonly parameterConsumers: Readonly<Record<string, readonly ParameterConsumer[]>>;
  readonly budgets: readonly ScenarioResourceBudget[];
  readonly lifecycle: {
    readonly prepareEventTypes: readonly FaultRunPrepareEventType[];
    readonly stopEventTypes: readonly FaultRunRecoveryEventType[];
    readonly cleanupActionTypes: readonly FaultRunCleanupActionType[];
    readonly recoveryRecipeIds: readonly string[];
    readonly sideEffectRecipeIds: readonly string[];
    readonly nonReleasingReason?: string;
  };
  readonly evidence: EvidenceContractPlan;
  readonly alert: ScenarioAlertContract;
}

export type FaultRunPrepareEventType = 'CREATED' | 'TARGET_CONFIRMED' | 'CREATE_FAILED';
export type FaultRunRecoveryEventType = FaultRunRecoveryEventTypeSource;
export type FaultRunCleanupActionType = Extract<FaultRunActionType, 'CLEANUP'>;

export type ScenarioContractCatalogDefinition = FaultRunScenarioDefinition;

export interface ResolvedScenarioContract extends ScenarioContractSupplement {
  readonly schemaVersion: typeof SCENARIO_CONTRACT_SCHEMA_VERSION;
  readonly scenario: FaultRunScenario;
  readonly targetService: string;
  readonly targetOperation: string;
  readonly maxDurationSec: number;
  readonly recoveryStrategy: FaultRunRecoveryStrategy;
  readonly targetPrepare: 'REQUIRED' | 'NOT_APPLICABLE';
  readonly recoveryPolicy: FaultRunRecoveryPolicy;
  readonly allowManualCleanup: boolean;
  readonly parameters: readonly FaultRunParameterDefinition[];
  readonly dispatchOwner: FaultRunWorkerDrainOwner | null;
  readonly targetLifecycleMode: 'GATEWAY' | 'LOCAL_WORKER';
}

export function canonicalizeScenarioContractSupplement(
  contract: ScenarioContractSupplement,
): string {
  return canonicalizeJson(normalizeScenarioContractSupplement(contract));
}

export function normalizeScenarioContractSupplement(
  contract: ScenarioContractSupplement,
): ScenarioContractSupplement {
  const canonicalContract = structuredClone(contract);
  return {
    ...canonicalContract,
    parameterConsumers: Object.fromEntries(
      Object.entries(canonicalContract.parameterConsumers)
        .map(([name, consumers]) => [name, [...consumers].sort(compareStrings)]),
    ),
    budgets: canonicalContract.budgets
      .map(normalizeBudget)
      .sort((left, right) => compareStrings(canonicalizeJson(left), canonicalizeJson(right))),
    lifecycle: {
      ...canonicalContract.lifecycle,
      prepareEventTypes: [...canonicalContract.lifecycle.prepareEventTypes].sort(compareStrings),
      stopEventTypes: [...canonicalContract.lifecycle.stopEventTypes].sort(compareStrings),
      cleanupActionTypes: [...canonicalContract.lifecycle.cleanupActionTypes].sort(compareStrings),
      recoveryRecipeIds: [...canonicalContract.lifecycle.recoveryRecipeIds].sort(compareStrings),
      sideEffectRecipeIds: [...canonicalContract.lifecycle.sideEffectRecipeIds].sort(compareStrings),
    },
    evidence: canonicalEvidencePlan(canonicalContract.evidence),
    alert: canonicalAlertContract(canonicalContract.alert),
  };
}

export function canonicalizeResolvedScenarioContract(contract: ResolvedScenarioContract): string {
  const canonicalContract = structuredClone(contract);
  return canonicalizeJson({
    ...canonicalContract,
    parameters: [...canonicalContract.parameters]
      .map((parameter) => ({
        ...parameter,
        ...(parameter.options === undefined ? {} : { options: [...parameter.options].sort(compareStrings) }),
      }))
      .sort((left, right) => compareStrings(left.name, right.name)),
    budgets: canonicalContract.budgets
      .map(normalizeBudget)
      .sort((left, right) => compareStrings(canonicalizeJson(left), canonicalizeJson(right))),
    lifecycle: {
      ...canonicalContract.lifecycle,
      prepareEventTypes: [...canonicalContract.lifecycle.prepareEventTypes].sort(compareStrings),
      stopEventTypes: [...canonicalContract.lifecycle.stopEventTypes].sort(compareStrings),
      cleanupActionTypes: [...canonicalContract.lifecycle.cleanupActionTypes].sort(compareStrings),
      recoveryRecipeIds: [...canonicalContract.lifecycle.recoveryRecipeIds].sort(compareStrings),
      sideEffectRecipeIds: [...canonicalContract.lifecycle.sideEffectRecipeIds].sort(compareStrings),
    },
    evidence: canonicalEvidencePlan(canonicalContract.evidence),
    alert: canonicalAlertContract(canonicalContract.alert),
  });
}

export function getScenarioContractRevision(contract: ResolvedScenarioContract): string {
  return `sc.v1:sha256:${createHash('sha256')
    .update(canonicalizeResolvedScenarioContract(contract), 'utf8')
    .digest('hex')}`;
}

export function canonicalizeEvidenceContractPlan(contract: EvidenceContractPlan): string {
  return canonicalizeJson(canonicalEvidencePlan(structuredClone(contract)));
}

export function getEvidenceContractHash(contract: EvidenceContractPlan): string {
  return createHash('sha256')
    .update(canonicalizeEvidenceContractPlan(contract), 'utf8')
    .digest('hex');
}

export function resolveScenarioContract(
  definition: ScenarioContractCatalogDefinition,
): Readonly<ResolvedScenarioContract> {
  const resolvedPolicy = resolveFaultRunRecoveryPolicy(definition);
  const contract = structuredClone(definition.contract);
  const parameters = structuredClone(definition.parameters);

  return deepFreeze({
    parameterConsumers: contract.parameterConsumers,
    budgets: contract.budgets,
    lifecycle: contract.lifecycle,
    evidence: contract.evidence,
    alert: contract.alert,
    schemaVersion: SCENARIO_CONTRACT_SCHEMA_VERSION,
    scenario: definition.scenario,
    targetService: definition.targetService,
    targetOperation: definition.targetOperation,
    maxDurationSec: definition.maxDurationSec,
    recoveryStrategy: definition.recoveryStrategy,
    targetPrepare: definition.targetPrepare,
    recoveryPolicy: {
      workerDrain: structuredClone(resolvedPolicy.workerDrain),
      targetRelease: resolvedPolicy.targetRelease,
      cleanup: resolvedPolicy.cleanup,
      verification: resolvedPolicy.verification,
    },
    allowManualCleanup: definition.allowManualCleanup,
    parameters,
    dispatchOwner: resolvedPolicy.workerDrain.requirement === 'REQUIRED'
      ? resolvedPolicy.workerDrain.owner
      : null,
    targetLifecycleMode: definition.targetPrepare === 'REQUIRED' ? 'GATEWAY' : 'LOCAL_WORKER',
  });
}

function canonicalEvidencePlan(contract: EvidenceContractPlan): EvidenceContractPlan {
  return {
    ...contract,
    recipes: [...contract.recipes]
      .map((recipe) => ({
        ...recipe,
        scope: {
          ...recipe.scope,
          ...(recipe.scope.fixedLabels === undefined
            ? {}
            : { fixedLabels: { ...recipe.scope.fixedLabels } }),
        },
        predicate: { ...recipe.predicate },
      }))
      .sort((left, right) => compareStrings(left.id, right.id)),
    effectRule: {
      ...contract.effectRule,
      recipeIds: [...contract.effectRule.recipeIds].sort(compareStrings),
    },
  };
}

function canonicalAlertContract(contract: ScenarioAlertContract): ScenarioAlertContract {
  if (contract.expectation === 'NOT_EXPECTED') return { ...contract };
  return {
    ...contract,
    allowedAlerts: [...contract.allowedAlerts]
      .map((alert) => ({
        ...alert,
        requiredLabels: { ...alert.requiredLabels },
        incidentKeyLabels: [...alert.incidentKeyLabels].sort(compareStrings),
      }))
      .sort((left, right) => compareStrings(
        `${left.alertName}\u0000${left.service}`,
        `${right.alertName}\u0000${right.service}`,
      )),
  };
}

function normalizeBudget(budget: ScenarioResourceBudget): ScenarioResourceBudget {
  const boundary = budget.boundary;
  if ('parameterNames' in boundary) {
    return {
      resource: budget.resource,
      boundary: {
        ...boundary,
        parameterNames: [...boundary.parameterNames].sort(compareStrings),
      },
    };
  }
  return { resource: budget.resource, boundary: { ...boundary } };
}

function canonicalizeJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ScenarioContractRevisionError();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareStrings(left, right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeJson(item)}`)
      .join(',')}}`;
  }
  throw new ScenarioContractRevisionError();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}
