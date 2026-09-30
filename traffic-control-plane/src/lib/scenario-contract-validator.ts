import {
  ALERT_CORRELATION_TIMING,
  NOTIFICATION_STORAGE_MAX_FREE_BYTES,
  NOTIFICATION_STORAGE_MIN_FREE_BYTES,
  TRAFFIC_SURGE_MAX_CONCURRENCY,
  type FaultRunScenario,
  type FaultRunParameterDefinition,
  type FaultRunScenarioDefinition,
} from './fault-run-catalog';
import {
  FaultRunRecoveryPolicyInvariantError,
  resolveFaultRunRecoveryPolicy,
} from './fault-run-recovery-policy';
import type {
  FaultRunActionType,
} from './fault-run-action-repository';
import {
  FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE,
  SAFE_RUNTIME_RECOVERY_EVENT_TYPES,
  FaultRunEventContractError,
  normalizeFaultRunRecoveryEventPayload,
  normalizeFaultRunSummaryEventPayload,
  type FaultRunRecoveryEventType,
} from './fault-run-event-contract';
import type {
  AgentDeliveryReadiness,
  EvidenceSource,
  EvidenceTemplateId,
  ParameterConsumer,
  ResolvedScenarioContract,
} from './scenario-contract';
import { ALERT_RECEIPT_POLICY_ID } from './scenario-contract';

export const SCENARIO_CONTRACT_REPORT_SCHEMA_VERSION = 'scenario-contract-report.v1' as const;

export type ScenarioContractValidationStage = 'PREFLIGHT' | 'FINAL';
export type ScenarioContractValidationScope =
  | 'STATIC_CONTRACT'
  | 'DISPOSABLE_CANARY'
  | 'LIVE_SCENARIO_MATRIX';
export type ScenarioContractStatus = 'VALID' | 'BLOCKED' | 'LIMITED';
export type ScenarioContractIssueCategory =
  | 'missingTarget'
  | 'missingDispatch'
  | 'invalidParameters'
  | 'invalidRecoveryHook'
  | 'missingEvidenceQuery'
  | 'missingRunbook'
  | 'missingI18n'
  | 'invalidAlertContract';

export interface ScenarioContractValidationIssue {
  readonly category: ScenarioContractIssueCategory;
  readonly code: string;
  readonly scenario?: FaultRunScenario;
  readonly artifact?: string;
  readonly fieldPath?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly remediation: string;
}

export interface ScenarioContractValidationReport {
  readonly schemaVersion: typeof SCENARIO_CONTRACT_REPORT_SCHEMA_VERSION;
  readonly stage: ScenarioContractValidationStage;
  readonly scope: ScenarioContractValidationScope;
  readonly catalogRevision: string;
  readonly status: ScenarioContractStatus;
  readonly scenarios: readonly {
    readonly scenario: FaultRunScenario;
    readonly status: ScenarioContractStatus;
  }[];
  readonly requiredChecks: readonly {
    readonly checkId: string;
    readonly status: 'PASSED' | 'FAILED' | 'MISSING';
    readonly catalogRevision: string;
    readonly sourceCommitSha: string | null;
  }[];
  readonly blockingIssues: readonly ScenarioContractValidationIssue[];
  readonly readinessNotes: readonly {
    readonly code: string;
    readonly scenario?: FaultRunScenario;
    readonly detail: string;
  }[];
  readonly sourceCommitSha: string | null;
}

export type ScenarioContractFactStatus = 'PASSED' | 'FAILED' | 'MISSING';
export type ScenarioContractLocale = 'en' | 'zh-CN';
export type ScenarioContractDeploymentVariant = 'COMPOSE' | 'KUBERNETES';

export interface ScenarioDispatchValidationDescriptor {
  readonly name: string;
  readonly drainOwner: string;
  readonly supportedScenarios: readonly FaultRunScenario[];
  readonly executionState: string;
  readonly summaryEventType: string;
  readonly terminalSummaryEvent: string;
  readonly drainParticipantRegistered: boolean;
}

export type ScenarioTargetMappingStatus =
  | 'PASSED'
  | 'FAILED'
  | 'MISSING'
  | 'ABSENT'
  | 'NOT_APPLICABLE';

export interface ScenarioTargetMappingFact {
  readonly status: ScenarioTargetMappingStatus;
  readonly service: string | null;
  readonly operation: string | null;
  readonly paths: {
    readonly prepare: string | null;
    readonly release: string | null;
    readonly cleanup: string | null;
  };
}

export interface ScenarioTargetContractFact {
  readonly scenario: FaultRunScenario;
  readonly gateway: ScenarioTargetMappingFact;
  readonly target: ScenarioTargetMappingFact;
  readonly localWorker: {
    readonly status: ScenarioTargetMappingStatus;
    readonly scenario: FaultRunScenario | null;
    readonly source: 'TRAFFIC_SCENARIO_TARGETS' | null;
    readonly service: string | null;
    readonly path: string | null;
  };
  readonly cleanupCapability: {
    readonly status: ScenarioTargetMappingStatus;
    readonly policy: 'NONE' | 'OPTIONAL_PER_RUN' | 'OPERATOR_CONFIRMED' | 'SCENARIO_WIDE';
    readonly runScoped: boolean;
    readonly fenced: boolean;
    readonly confirmationSupported: boolean;
    readonly actionOwnerVerified: boolean;
  };
}

export interface ScenarioParameterValidationFact {
  /** Normalized outcome of the existing validateScenarioParameters() checks. */
  readonly scenario: FaultRunScenario;
  readonly status: ScenarioContractFactStatus;
}

export type ScenarioParameterGuardId =
  | 'CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES'
  | 'TRAFFIC_SURGE_MAX_CONCURRENCY'
  | 'FILESYSTEM_USABLE_SPACE_RESERVE';

export interface ScenarioParameterGuardFact {
  readonly scenario: FaultRunScenario;
  readonly guardId: ScenarioParameterGuardId;
  readonly status: ScenarioContractFactStatus;
  readonly parameterNames: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
}

export type ScenarioRunbookHeadingId =
  | 'PURPOSE_AND_FIXED_TARGET'
  | 'ACTUAL_IMPLEMENTATION'
  | 'PARAMETERS_AND_LIFECYCLE'
  | 'IMPACT_AND_EXCLUSIONS'
  | 'EVIDENCE'
  | 'TEMPO_INVESTIGATION'
  | 'RECOVERY_AND_VERIFICATION'
  | 'LIMITS_AND_SAFE_INTERPRETATION'
  | 'ALERTS';

export interface ScenarioRunbookFact {
  readonly scenario: FaultRunScenario;
  readonly metadataPresent: boolean;
  readonly metadataEntryCount: number;
  readonly targetService: string | null;
  readonly targetOperation: string | null;
  readonly locales: readonly {
    readonly locale: ScenarioContractLocale;
    readonly allowlisted: boolean;
    readonly contentAvailable: boolean;
    readonly headingIds: readonly ScenarioRunbookHeadingId[];
  }[];
}

export interface ScenarioI18nFact {
  readonly scenario: FaultRunScenario;
  readonly scenarioMetaPresent: boolean;
  readonly groupMembershipCount: number;
  readonly locales: readonly {
    readonly locale: ScenarioContractLocale;
    readonly scenarioLabelPresent: boolean;
    readonly scenarioDescriptionPresent: boolean;
    readonly recoveryStrategyLabelPresent: boolean;
    readonly groupLabelPresent: boolean;
    readonly parameters: readonly {
      readonly name: string;
      readonly labelPresent: boolean;
      readonly descriptionPresent: boolean;
    }[];
  }[];
}

export interface ScenarioPrometheusRuleFact {
  readonly alertName: string;
  readonly severity: string | null;
  readonly staticLabels: Readonly<Record<string, string>>;
  readonly outputLabelNames: readonly string[];
  readonly serviceLabelName: string | null;
  readonly forSeconds: number | null;
  readonly groupIntervalSeconds: number | null;
  readonly expressionSha256: string | null;
}

export interface ScenarioPrometheusDeploymentFact {
  readonly variant: ScenarioContractDeploymentVariant;
  readonly serviceLabelValues: readonly string[];
  readonly rules: readonly ScenarioPrometheusRuleFact[];
}

export interface ScenarioAlertmanagerDeploymentFact {
  readonly variant: ScenarioContractDeploymentVariant;
  readonly internalReceipt: {
    readonly routeConfigured: boolean;
    readonly receiverConfigured: boolean;
    readonly receiptPolicyId: string | null;
    readonly sendResolved: boolean | null;
    readonly routeTreeSha256: string | null;
  };
  readonly externalAgent: {
    readonly childRouteConfigured: boolean;
    readonly receiverConfigured: boolean;
    readonly childRouteName: string | null;
    readonly receiverName: string | null;
    readonly credentialSource: string | null;
    readonly sendResolved: boolean | null;
    readonly routeTreeSha256: string | null;
  };
}

export interface ScenarioAlertConfigurationFacts {
  readonly prometheus: readonly ScenarioPrometheusDeploymentFact[];
  readonly alertmanager: readonly ScenarioAlertmanagerDeploymentFact[];
  readonly agentDeliveryReadiness: AgentDeliveryReadiness;
}

export interface ScenarioContractCheckResult {
  readonly checkId: string;
  readonly status: 'PASSED' | 'FAILED';
  readonly catalogRevision: string;
  readonly sourceCommitSha: string | null;
}

export interface ScenarioContractCoverageFact {
  readonly scenario: FaultRunScenario;
  readonly status: 'COVERED' | 'FAILED' | 'MISSING' | 'EVIDENCE_UNAVAILABLE';
}

export interface ScenarioContractValidationInput {
  readonly stage: ScenarioContractValidationStage;
  readonly scope: ScenarioContractValidationScope;
  readonly catalogRevision: string;
  readonly sourceCommitSha: string | null;
  readonly catalogScenarios: readonly FaultRunScenario[];
  readonly contracts: readonly ResolvedScenarioContract[];
  readonly dispatchCapabilities: readonly ScenarioDispatchValidationDescriptor[];
  readonly targetFacts: readonly ScenarioTargetContractFact[];
  readonly parameterValidationFacts: readonly ScenarioParameterValidationFact[];
  readonly parameterGuardFacts: readonly ScenarioParameterGuardFact[];
  readonly evidenceTemplateIds: readonly EvidenceTemplateId[];
  readonly runbookFacts: readonly ScenarioRunbookFact[];
  readonly i18nFacts: readonly ScenarioI18nFact[];
  readonly alertConfiguration: ScenarioAlertConfigurationFacts;
  readonly requiredCheckIds: readonly string[];
  readonly checkResults: readonly ScenarioContractCheckResult[];
  readonly coverageFacts?: readonly ScenarioContractCoverageFact[];
  readonly deploymentScope?: 'disposable' | 'retained';
  readonly requireAgentDeliveryLive?: boolean;
}

export const SCENARIO_CONTRACT_REQUIRED_RUNBOOK_HEADINGS: readonly ScenarioRunbookHeadingId[] = [
  'PURPOSE_AND_FIXED_TARGET',
  'ACTUAL_IMPLEMENTATION',
  'PARAMETERS_AND_LIFECYCLE',
  'IMPACT_AND_EXCLUSIONS',
  'EVIDENCE',
  'TEMPO_INVESTIGATION',
  'RECOVERY_AND_VERIFICATION',
  'LIMITS_AND_SAFE_INTERPRETATION',
  'ALERTS',
];

const LOCALES: readonly ScenarioContractLocale[] = ['en', 'zh-CN'];
const SAFE_RECOVERY_EVENT_TYPES = new Set<string>(SAFE_RUNTIME_RECOVERY_EVENT_TYPES);
const EVIDENCE_SOURCES = new Set<EvidenceSource>([
  'RUN_EVENT',
  'PROMETHEUS',
  'LOKI',
  'TEMPO',
  'BUSINESS_CHECK',
  'RESOURCE_CHECK',
]);
const PARAMETER_CONSUMERS = new Set<ParameterConsumer>([
  'ADMISSION',
  'TARGET_PREPARE',
  'WORKER_EXECUTION',
]);
const VALID_COMMIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu;
const VALID_CATALOG_REVISION = /^[a-f0-9]{64}$/iu;
const VALID_CHECK_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u;
const BYTE_UNIT_MULTIPLIERS: Readonly<Record<string, number>> = {
  B: 1,
  K: 1024,
  KB: 1024,
  M: 1024 ** 2,
  MB: 1024 ** 2,
  G: 1024 ** 3,
  GB: 1024 ** 3,
};

/**
 * Checks only the supplied, already-normalized facts. This function does not
 * discover inputs, execute checks, or infer live effects from static coverage.
 */
export function validateScenarioContracts(
  input: ScenarioContractValidationInput,
): ScenarioContractValidationReport {
  const stage: ScenarioContractValidationStage = input.stage === 'PREFLIGHT'
    ? 'PREFLIGHT'
    : 'FINAL';
  const scope: ScenarioContractValidationScope = input.scope === 'STATIC_CONTRACT'
    ? 'STATIC_CONTRACT'
    : input.scope === 'DISPOSABLE_CANARY'
      ? 'DISPOSABLE_CANARY'
      : 'LIVE_SCENARIO_MATRIX';
  const issues: ScenarioContractValidationIssue[] = [];
  const readinessNotes: ScenarioContractValidationReport['readinessNotes'][number][] = [];
  const contractsByScenario = new Map<FaultRunScenario, ResolvedScenarioContract>();
  const contractCounts = new Map<FaultRunScenario, number>();
  const catalogScenarioCounts = countBy(input.catalogScenarios, (scenario) => scenario);

  for (const contract of input.contracts) {
    const count = (contractCounts.get(contract.scenario) ?? 0) + 1;
    contractCounts.set(contract.scenario, count);
    if (!contractsByScenario.has(contract.scenario)) {
      contractsByScenario.set(contract.scenario, contract);
    }
  }

  if (input.catalogScenarios.length === 0) {
    addIssue(issues, {
      category: 'invalidParameters',
      code: 'CATALOG_SCENARIO_INVENTORY_MISSING',
      artifact: 'catalog',
      fieldPath: 'scenarios',
      expected: 'NON_EMPTY_CATALOG_SCENARIO_INVENTORY',
      actual: 'MISSING',
      remediation: 'Pass the complete scenario inventory from the authoritative Catalog.',
    });
  }
  for (const [scenario, count] of catalogScenarioCounts) {
    if (count > 1) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'CATALOG_SCENARIO_INVENTORY_DUPLICATE',
        scenario,
        artifact: 'catalog',
        fieldPath: 'scenarios',
        expected: 'UNIQUE_CATALOG_SCENARIO_IDS',
        actual: 'DUPLICATE',
        remediation: 'Provide each authoritative Catalog scenario exactly once.',
      });
    }
  }

  for (const [scenario, count] of contractCounts) {
    if (count > 1) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'CATALOG_SCENARIO_DUPLICATE',
        scenario,
        artifact: 'catalog',
        fieldPath: 'scenario',
        expected: 'ONE_RESOLVED_CONTRACT',
        actual: 'DUPLICATE_CONTRACTS',
        remediation: 'Provide exactly one resolved Catalog contract per scenario.',
      });
    }
  }

  const knownScenarios = new Set(input.catalogScenarios);
  for (const scenario of input.catalogScenarios) {
    if (!contractsByScenario.has(scenario)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'CATALOG_CONTRACT_MISSING',
        scenario,
        artifact: 'catalog',
        fieldPath: 'contract',
        expected: 'ONE_RESOLVED_CONTRACT',
        actual: 'MISSING',
        remediation: 'Resolve the required Scenario Contract from the authoritative Catalog entry.',
      });
    }
  }

  for (const contract of input.contracts) {
    if (!knownScenarios.has(contract.scenario)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'CATALOG_CONTRACT_ORPHAN',
        scenario: contract.scenario,
        artifact: 'catalog',
        fieldPath: 'scenario',
        expected: 'AUTHORITATIVE_CATALOG_SCENARIO',
        actual: 'ORPHAN_CONTRACT',
        remediation: 'Remove resolved contracts that do not belong to the supplied Catalog inventory.',
      });
    }
  }

  const contracts = [...contractsByScenario.values()]
    .filter(({ scenario }) => knownScenarios.has(scenario))
    .sort((left, right) => (
    compareStrings(left.scenario, right.scenario)
  ));

  for (const contract of contracts) {
    validateTargetContract(contract, input.targetFacts, issues);
    validateDispatchContract(contract, input.dispatchCapabilities, issues);
    validateParameterContract(contract, input, issues);
    validateRecoveryContract(contract, input.targetFacts, issues);
    validateEvidenceContract(contract, input.evidenceTemplateIds, issues);
    validateRunbookContract(contract, input.runbookFacts, issues);
    validateI18nContract(contract, input.i18nFacts, issues);
    validateScenarioAlertContract(contract, input.alertConfiguration, issues);
  }

  validateOrphanTargetFacts(input.targetFacts, knownScenarios, issues);
  validateOrphanDispatchFacts(input.dispatchCapabilities, knownScenarios, issues);
  validateOrphanParameterFacts(input, knownScenarios, issues);
  validateOrphanRunbookFacts(input.runbookFacts, knownScenarios, issues);
  validateOrphanI18nFacts(input.i18nFacts, knownScenarios, issues);
  validateAlertConfiguration(input.alertConfiguration, issues);

  const catalogRevision = normalizeCatalogRevision(input.catalogRevision);
  const sourceCommitSha = normalizeCommitSha(input.sourceCommitSha);
  const requiredChecks = buildRequiredChecks(input, stage, catalogRevision, sourceCommitSha);
  const requiredChecksValid = requiredChecks.every(({ status }) => status === 'PASSED');

  const readinessState = input.alertConfiguration.agentDeliveryReadiness.state;
  if (readinessState === 'NOT_ENABLED_YET') {
    readinessNotes.push({
      code: 'AGENT_DELIVERY_NOT_ENABLED',
      detail: 'External Agent delivery is not enabled; internal alert receipt remains a separate contract.',
    });
    if (input.requireAgentDeliveryLive) {
      readinessNotes.push({
        code: 'AGENT_DELIVERY_LIVE_COVERAGE_MISSING',
        detail: 'The requested scope requires live external Agent delivery coverage.',
      });
    }
  }

  if (scope !== 'STATIC_CONTRACT') {
    for (const { scenario } of contracts) {
      const coverage = (input.coverageFacts ?? [])
        .filter((fact) => fact.scenario === scenario);
      if (coverage.length > 1 || coverage[0]?.status === 'FAILED') {
        readinessNotes.push({
          code: coverage.length > 1 ? 'SCENARIO_COVERAGE_AMBIGUOUS' : 'SCENARIO_COVERAGE_FAILED',
          scenario,
          detail: coverage.length > 1
            ? 'Multiple canary or live coverage outcomes make this scenario status ambiguous.'
            : 'A required canary or live scenario coverage check failed.',
        });
      } else if (coverage.length !== 1 || coverage[0]?.status === 'MISSING') {
        readinessNotes.push({
          code: 'SCENARIO_COVERAGE_INCOMPLETE',
          scenario,
          detail: 'The declared scope is missing canary or live scenario coverage.',
        });
      } else if (coverage[0]?.status === 'EVIDENCE_UNAVAILABLE') {
        readinessNotes.push({
          code: 'EVIDENCE_UNAVAILABLE',
          scenario,
          detail: 'Required evidence is unavailable; this report does not infer an observed effect.',
        });
      }
    }
  }

  const scenarioStatuses = [...knownScenarios].sort(compareStrings).map((scenario) => {
    const hasBlockingIssue = issues.some((issue) => issue.scenario === scenario);
    if (hasBlockingIssue || isScenarioCoverageBlocked(input, scenario, scope)) {
      return { scenario, status: 'BLOCKED' as const };
    }
    if (!contractsByScenario.has(scenario)) return { scenario, status: 'BLOCKED' as const };
    if (isScenarioLimited(input, scenario, scope)) {
      return { scenario, status: 'LIMITED' as const };
    }
    return { scenario, status: 'VALID' as const };
  });
  const hasLimitedScenario = scenarioStatuses.some(({ status }) => status === 'LIMITED');
  const hasBlockedScenario = scenarioStatuses.some(({ status }) => status === 'BLOCKED');
  const hasBlockingIssue = issues.length > 0;
  const hasCheckFailure = !requiredChecksValid;
  const status: ScenarioContractStatus = hasBlockingIssue || hasBlockedScenario || hasCheckFailure
    ? 'BLOCKED'
    : hasLimitedScenario
      ? 'LIMITED'
      : 'VALID';

  return {
    schemaVersion: SCENARIO_CONTRACT_REPORT_SCHEMA_VERSION,
    stage,
    scope,
    catalogRevision,
    status,
    scenarios: scenarioStatuses.sort((left, right) => compareStrings(left.scenario, right.scenario)),
    requiredChecks: requiredChecks.sort((left, right) => compareStrings(left.checkId, right.checkId)),
    blockingIssues: sortIssues(issues),
    readinessNotes: sortReadinessNotes(readinessNotes),
    sourceCommitSha,
  };
}

function validateTargetContract(
  contract: ResolvedScenarioContract,
  facts: readonly ScenarioTargetContractFact[],
  issues: ScenarioContractValidationIssue[],
): void {
  const matches = facts.filter(({ scenario }) => scenario === contract.scenario);
  if (matches.length !== 1) {
    addIssue(issues, {
      category: 'missingTarget',
      code: matches.length === 0 ? 'TARGET_FACT_MISSING' : 'TARGET_FACT_DUPLICATE',
      scenario: contract.scenario,
      artifact: 'target',
      fieldPath: 'mapping',
      expected: 'ONE_TARGET_MAPPING_FACT',
      actual: matches.length === 0 ? 'MISSING' : 'DUPLICATE',
      remediation: 'Provide one normalized Gateway and target mapping result for the Catalog operation.',
    });
    return;
  }

  const fact = matches[0];
  if (!fact) return;
  const expectedMode = contract.targetPrepare === 'REQUIRED' ? 'GATEWAY' : 'LOCAL_WORKER';
  if (contract.targetLifecycleMode !== expectedMode
    || !hasNonEmptyText(contract.targetService)
    || !hasNonEmptyText(contract.targetOperation)) {
    addIssue(issues, {
      category: 'missingTarget',
      code: 'CATALOG_TARGET_INVALID',
      scenario: contract.scenario,
      artifact: 'catalog',
      fieldPath: 'target',
      expected: 'FIXED_TARGET_AND_LIFECYCLE_MODE',
      actual: 'MISSING_OR_INCONSISTENT',
      remediation: 'Keep target service, operation, and lifecycle mode derived from the Catalog.',
    });
  }

  if (expectedMode === 'LOCAL_WORKER') {
    if (fact.gateway.status !== 'ABSENT'
      || fact.target.status !== 'NOT_APPLICABLE'
      || fact.localWorker.status !== 'PASSED'
      || fact.localWorker.scenario !== contract.scenario
      || fact.localWorker.source !== 'TRAFFIC_SCENARIO_TARGETS'
      || fact.localWorker.service !== contract.targetService
      || !isSafeConsumerRoute(fact.localWorker.path)
      || fact.gateway.service !== null
      || fact.gateway.operation !== null
      || fact.target.service !== null
      || fact.target.operation !== null
      || Object.values(fact.gateway.paths).some((path) => path !== null)
      || Object.values(fact.target.paths).some((path) => path !== null)) {
      addIssue(issues, {
        category: 'missingTarget',
        code: 'LOCAL_WORKER_BYPASS_INVALID',
        scenario: contract.scenario,
        artifact: 'worker-target',
        fieldPath: 'localWorker',
        expected: 'GATEWAY_ABSENT_AND_LOCAL_TARGET_PRESENT',
        actual: 'MISSING_OR_MISMATCHED',
        remediation: 'Verify the local Worker target mapping separately and keep it out of Gateway dispatch.',
      });
    }
    return;
  }

  if (fact.gateway.status !== 'PASSED'
    || fact.target.status !== 'PASSED'
    || fact.localWorker.status !== 'NOT_APPLICABLE'
    || fact.gateway.service !== contract.targetService
    || fact.target.service !== contract.targetService
    || fact.gateway.operation !== contract.targetOperation
    || fact.target.operation !== contract.targetOperation) {
    addIssue(issues, {
      category: 'missingTarget',
      code: 'GATEWAY_TARGET_MAPPING_MISMATCH',
      scenario: contract.scenario,
      artifact: 'gateway-target',
      fieldPath: 'operation',
      expected: 'CATALOG_SERVICE_AND_OPERATION',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Align Gateway registry and target controller mapping with the resolved Catalog target.',
    });
    return;
  }

  if (fact.localWorker.scenario !== null
    || fact.localWorker.source !== null
    || fact.localWorker.service !== null
    || fact.localWorker.path !== null) {
    addIssue(issues, {
      category: 'missingTarget',
      code: 'TARGET_WORKER_BYPASS_UNEXPECTED',
      scenario: contract.scenario,
      artifact: 'worker-target',
      fieldPath: 'localWorker',
      expected: 'NOT_APPLICABLE',
      actual: 'UNEXPECTED_LOCAL_MAPPING',
      remediation: 'Keep Gateway-backed operations out of the local Worker bypass map.',
    });
  }

  const requiredRoutes: readonly (keyof ScenarioTargetMappingFact['paths'])[] = [
    ...(contract.targetPrepare === 'REQUIRED' ? ['prepare' as const] : []),
    ...(contract.recoveryPolicy.targetRelease === 'REQUIRED' ? ['release' as const] : []),
    ...(contract.recoveryPolicy.cleanup !== 'NONE' ? ['cleanup' as const] : []),
  ];
  for (const routeName of requiredRoutes) {
    const gatewayPath = fact.gateway.paths[routeName];
    const targetPath = fact.target.paths[routeName];
    if (!hasNonEmptyText(gatewayPath)
      || !hasNonEmptyText(targetPath)
      || gatewayPath !== targetPath
      || !isSafeInternalPath(gatewayPath)
      || !isSafeInternalPath(targetPath)) {
      addIssue(issues, {
        category: 'missingTarget',
        code: 'TARGET_ACTION_PATH_MISMATCH',
        scenario: contract.scenario,
        artifact: routeName === 'prepare' ? 'gateway-target' : 'target',
        fieldPath: `actions.${routeName}`,
        expected: 'MATCHED_FIXED_PATH',
        actual: 'MISSING_OR_MISMATCHED',
        remediation: 'Align the required prepare, release, or cleanup route in Gateway and target tests.',
      });
    }
  }

}

function validateDispatchContract(
  contract: ResolvedScenarioContract,
  descriptors: readonly ScenarioDispatchValidationDescriptor[],
  issues: ScenarioContractValidationIssue[],
): void {
  const matching = descriptors.flatMap((descriptor) => (
    descriptor.supportedScenarios
      .filter((scenario) => scenario === contract.scenario)
      .map(() => descriptor)
  ));
  const requiresDriver = contract.recoveryPolicy.workerDrain.requirement === 'REQUIRED';

  if (requiresDriver && matching.length !== 1) {
    addIssue(issues, {
      category: 'missingDispatch',
      code: matching.length === 0 ? 'DRIVER_MISSING' : 'DRIVER_DUPLICATE',
      scenario: contract.scenario,
      artifact: 'worker',
      fieldPath: 'dispatch.owner',
      expected: 'EXACTLY_ONE_CATALOG_OWNER',
      actual: matching.length === 0 ? 'ZERO_MATCHES' : 'MULTIPLE_MATCHES',
      remediation: 'Register exactly one actual driver for this Catalog scenario.',
    });
  } else if (!requiresDriver
    && (matching.length !== 0 || contract.dispatchOwner !== null)) {
    addIssue(issues, {
      category: 'missingDispatch',
      code: 'DRIVER_NOT_APPLICABLE_BUT_REGISTERED',
      scenario: contract.scenario,
      artifact: 'worker',
      fieldPath: 'dispatch.owner',
      expected: 'NO_DRIVER_OR_OWNER',
      actual: 'UNEXPECTED_DRIVER_OR_OWNER',
      remediation: 'Remove a driver mapping when the Catalog recovery policy declares no Worker owner.',
    });
  }

  if (!requiresDriver || matching.length !== 1) return;
  const descriptor = matching[0];
  if (!descriptor) return;
  const expectedOwner = contract.recoveryPolicy.workerDrain.owner;
  const validSummary = supportsSummaryEvent(descriptor.summaryEventType);
  const validTerminalEvent = supportsRecoveryEvent(descriptor.terminalSummaryEvent);
  if (contract.dispatchOwner !== expectedOwner
    || descriptor.name !== expectedOwner
    || descriptor.drainOwner !== expectedOwner
    || descriptor.executionState !== 'ACTIVE_ONLY'
    || !validSummary
    || descriptor.terminalSummaryEvent !== FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE
    || !validTerminalEvent
    || !descriptor.drainParticipantRegistered) {
    addIssue(issues, {
      category: 'missingDispatch',
      code: 'DRIVER_CAPABILITY_MISMATCH',
      scenario: contract.scenario,
      artifact: 'worker',
      fieldPath: 'dispatch.capabilities',
      expected: 'OWNER_ACTIVE_ONLY_DRAIN_AND_SUMMARY',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Align the actual driver owner, ACTIVE-only gate, drain participant, and summary events.',
    });
  }

}

function validateParameterContract(
  contract: ResolvedScenarioContract,
  input: ScenarioContractValidationInput,
  issues: ScenarioContractValidationIssue[],
): void {
  if (contract.schemaVersion !== 'scenario-contract.v1') {
    addIssue(issues, {
      category: 'invalidParameters',
      code: 'CATALOG_CONTRACT_SCHEMA_INVALID',
      scenario: contract.scenario,
      artifact: 'catalog',
      fieldPath: 'schemaVersion',
      expected: 'scenario-contract.v1',
      actual: 'INVALID',
      remediation: 'Resolve contracts using the current Scenario Contract schema.',
    });
  }

  const names = new Set<string>();
  for (const parameter of contract.parameters) {
    if (names.has(parameter.name)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'PARAMETER_NAME_DUPLICATE',
        scenario: contract.scenario,
        artifact: 'catalog',
        fieldPath: 'parameters.name',
        expected: 'UNIQUE_PARAMETER_NAMES',
        actual: 'DUPLICATE',
        remediation: 'Give each Catalog parameter one unique name.',
      });
    }
    names.add(parameter.name);
    if (!isValidParameterDefinition(parameter)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'PARAMETER_SCHEMA_INVALID',
        scenario: contract.scenario,
        artifact: 'catalog',
        fieldPath: 'parameters',
        expected: 'VALID_KIND_UNIT_DEFAULT_OPTIONS_AND_BOUNDS',
        actual: 'INVALID',
        remediation: 'Correct the Catalog parameter schema and validate its defaults and bounds.',
      });
    }
  }

  const durationParameters = contract.parameters.filter(({ name }) => name === 'durationSec');
  const duration = durationParameters.length === 1 ? durationParameters[0] : undefined;
  if (!duration
    || duration.kind !== 'integer'
    || duration.required !== true
    || !Number.isSafeInteger(contract.maxDurationSec)
    || contract.maxDurationSec < 1
    || !Number.isSafeInteger(duration.min)
    || duration.min === undefined
    || duration.min < 1
    || !Number.isSafeInteger(duration.max)
    || duration.max === undefined
    || duration.max < contract.maxDurationSec
    || !isParameterDefaultValid(duration)
    || defaultAsNumber(duration) === undefined
    || defaultAsNumber(duration)! > contract.maxDurationSec) {
    addIssue(issues, {
      category: 'invalidParameters',
      code: 'DURATION_LIMIT_INVALID',
      scenario: contract.scenario,
      artifact: 'catalog',
      fieldPath: 'parameters.durationSec',
      expected: 'REQUIRED_INTEGER_WITHIN_MAX_DURATION',
      actual: 'MISSING_OR_INCONSISTENT',
      remediation: 'Keep durationSec required, bounded, and no greater than the scenario maxDurationSec.',
    });
  }

  validateParameterConsumers(contract, names, issues);
  validateResourceBudgets(contract, input, issues);

  const validationFacts = input.parameterValidationFacts
    .filter(({ scenario }) => scenario === contract.scenario);
  if (validationFacts.length !== 1 || validationFacts[0]?.status !== 'PASSED') {
    addIssue(issues, {
      category: 'invalidParameters',
      code: validationFacts.length === 0
        ? 'PARAMETER_VALIDATOR_TEST_MISSING'
        : validationFacts.length > 1
          ? 'PARAMETER_VALIDATOR_TEST_DUPLICATE'
          : 'PARAMETER_VALIDATOR_TEST_FAILED',
      scenario: contract.scenario,
      artifact: 'catalog-tests',
      fieldPath: 'validateScenarioParameters',
      expected: 'PASSED',
      actual: validationFacts.length === 0 ? 'MISSING' : 'FAILED_OR_DUPLICATE',
      remediation: 'Provide one passing result for the Catalog parameter validator.',
    });
  }

}

function validateParameterConsumers(
  contract: ResolvedScenarioContract,
  parameterNames: ReadonlySet<string>,
  issues: ScenarioContractValidationIssue[],
): void {
  const entries = Object.entries(contract.parameterConsumers as Record<string, readonly string[]>);
  const consumerNames = new Set(entries.map(([name]) => name));
  if (consumerNames.size !== parameterNames.size
    || [...parameterNames].some((name) => !consumerNames.has(name))
    || entries.some(([name]) => !parameterNames.has(name))) {
    addIssue(issues, {
      category: 'invalidParameters',
      code: 'PARAMETER_CONSUMER_COVERAGE_INVALID',
      scenario: contract.scenario,
      artifact: 'catalog',
      fieldPath: 'parameterConsumers',
      expected: 'EXACT_PARAMETER_COVERAGE',
      actual: 'MISSING_OR_ORPHAN_CONSUMER',
      remediation: 'Declare consumers for every Catalog parameter and remove orphan consumer entries.',
    });
  }

  for (const [name, consumers] of entries) {
    if (!Array.isArray(consumers)
      || consumers.length === 0
      || consumers.some((consumer) => !PARAMETER_CONSUMERS.has(consumer as ParameterConsumer))
      || new Set(consumers).size !== consumers.length
      || !consumers.includes('ADMISSION')) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'PARAMETER_CONSUMER_INVALID',
        scenario: contract.scenario,
        artifact: 'catalog',
        fieldPath: 'parameterConsumers',
        expected: 'UNIQUE_ADMISSION_AND_APPLICABLE_CONSUMERS',
        actual: 'INVALID',
        remediation: 'Keep the consumer list unique and include admission for every declared parameter.',
      });
      continue;
    }

    const isDuration = name === 'durationSec';
    if ((consumers.includes('TARGET_PREPARE')
        && contract.targetPrepare !== 'REQUIRED')
      || (consumers.includes('WORKER_EXECUTION')
        && contract.recoveryPolicy.workerDrain.requirement !== 'REQUIRED')
      || (!isDuration && consumers.length === 1)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'PARAMETER_CONSUMER_NOT_APPLICABLE',
        scenario: contract.scenario,
        artifact: 'catalog',
        fieldPath: 'parameterConsumers',
        expected: 'CONSUMERS_MATCH_EXECUTION_PATH',
        actual: 'INCOMPLETE_OR_NOT_APPLICABLE',
        remediation: 'Match parameter consumers to the Catalog prepare and Worker execution paths.',
      });
    }
  }

  const durationConsumers = contract.parameterConsumers.durationSec;
  if (durationConsumers) {
    const expectsPrepare = contract.targetPrepare === 'REQUIRED';
    const expectsWorker = contract.recoveryPolicy.workerDrain.requirement === 'REQUIRED';
    if (durationConsumers.includes('TARGET_PREPARE') !== expectsPrepare
      || durationConsumers.includes('WORKER_EXECUTION') !== expectsWorker) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'DURATION_CONSUMER_COVERAGE_INVALID',
        scenario: contract.scenario,
        artifact: 'catalog',
        fieldPath: 'parameterConsumers.durationSec',
        expected: 'ALL_APPLICABLE_DURATION_CONSUMERS',
        actual: 'MISSING_OR_EXTRA',
        remediation: 'Include durationSec in every applicable prepare and Worker execution consumer.',
      });
    }
  }
}

function validateResourceBudgets(
  contract: ResolvedScenarioContract,
  input: ScenarioContractValidationInput,
  issues: ScenarioContractValidationIssue[],
): void {
  const parameterByName = new Map(contract.parameters.map((parameter) => [parameter.name, parameter]));
  const budgets = contract.budgets;
  const hasConcurrency = parameterByName.has('concurrency');
  const hasLargeValueParameters = parameterByName.has('memberCount')
    || parameterByName.has('memberSizeBytes');
  const hasStorageParameters = parameterByName.has('totalBytes')
    || parameterByName.has('minFreeBytes');
  const hasHeapRisk = contract.recoveryStrategy === 'NON_RELEASING'
    || budgets.some(({ resource }) => resource === 'JVM_RETAINED_BYTES');
  const localWorker = contract.targetLifecycleMode === 'LOCAL_WORKER';

  for (const budget of budgets) {
    if (!hasExactKeys(budget, ['resource', 'boundary'])
      || !isValidBudgetBoundaryShape(budget.boundary)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'RESOURCE_BUDGET_SHAPE_INVALID',
        scenario: contract.scenario,
        artifact: 'catalog',
        fieldPath: 'budgets',
        expected: 'SUPPORTED_BUDGET_FIELDS_ONLY',
        actual: 'MISSING_OR_EXTRA_FIELDS',
        remediation: 'Use only the declared resource budget schema and approved boundary fields.',
      });
      continue;
    }
    const boundary = budget.boundary;
    if ('parameterNames' in boundary) {
      const references = boundary.parameterNames;
      if (references.length === 0
        || new Set(references).size !== references.length
        || references.some((name) => !parameterByName.has(name))) {
        addIssue(issues, {
          category: 'invalidParameters',
          code: 'BUDGET_PARAMETER_REFERENCE_INVALID',
          scenario: contract.scenario,
          artifact: 'catalog',
          fieldPath: 'budgets.parameterNames',
          expected: 'EXISTING_UNIQUE_PARAMETERS',
          actual: 'MISSING_OR_ORPHAN',
          remediation: 'Reference existing unique Catalog parameters in every resource budget.',
        });
      }
    }

    switch (boundary.kind) {
      case 'PARAMETER_BOUNDS': {
        if (budget.resource === 'REDIS_LOGICAL_BYTES'
          || budget.resource === 'JVM_RETAINED_BYTES'
          || (budget.resource === 'REQUEST_CONCURRENCY'
            && !sameStringSet(boundary.parameterNames, ['concurrency']))) {
          addIssue(issues, {
            category: 'invalidParameters',
            code: 'RESOURCE_BOUNDARY_KIND_MISMATCH',
            scenario: contract.scenario,
            artifact: 'catalog',
            fieldPath: 'budgets',
            expected: 'RESOURCE_APPROPRIATE_BOUNDARY',
            actual: 'MISMATCH',
            remediation: 'Use the Catalog rule or approved capacity exception required by this resource.',
          });
        }
        for (const name of boundary.parameterNames) {
          const parameter = parameterByName.get(name);
          if (!parameter || parameter.min === undefined || parameter.max === undefined) {
            addIssue(issues, {
              category: 'invalidParameters',
              code: 'RESOURCE_PARAMETER_BOUND_MISSING',
              scenario: contract.scenario,
              artifact: 'catalog',
              fieldPath: 'budgets',
              expected: 'FINITE_PARAMETER_BOUNDS',
              actual: 'MISSING',
              remediation: 'Add explicit parameter bounds or use a validated capacity-guard exception.',
            });
          }
        }
        break;
      }
      case 'CATALOG_RULE': {
        if (budget.resource !== 'REDIS_LOGICAL_BYTES'
          || boundary.ruleId !== 'CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES'
          || !sameStringSet(boundary.parameterNames, ['memberCount', 'memberSizeBytes'])) {
          addIssue(issues, {
            category: 'invalidParameters',
            code: 'CATALOG_RESOURCE_RULE_MISMATCH',
            scenario: contract.scenario,
            artifact: 'catalog',
            fieldPath: 'budgets',
            expected: 'REDIS_LARGE_VALUE_RULE_AND_PARAMETERS',
            actual: 'MISMATCH',
            remediation: 'Use the approved Catalog logical-byte rule for the large-value resource.',
          });
        }
        if (!hasPassingGuardFact(input.parameterGuardFacts, contract.scenario, boundary.ruleId, [
          'memberCount',
          'memberSizeBytes',
        ])) {
          addIssue(issues, {
            category: 'invalidParameters',
            code: 'CATALOG_RESOURCE_GUARD_UNVERIFIED',
            scenario: contract.scenario,
            artifact: 'catalog-tests',
            fieldPath: 'budgets',
            expected: 'PASSING_LOGICAL_BYTE_GUARD',
            actual: 'MISSING_OR_FAILED',
            remediation: 'Test the aggregate Catalog logical-byte guard; a missing parameter max is not a bound.',
          });
        }
        break;
      }
      case 'TARGET_CAPACITY_GUARD': {
        const targetBytes = parameterByName.get(boundary.targetBytesParameter);
        const reserveBytes = parameterByName.get(boundary.reserveBytesParameter);
        if (budget.resource !== 'STORAGE_FILE_BYTES'
          || boundary.guardId !== 'FILESYSTEM_USABLE_SPACE_RESERVE'
          || boundary.hardTargetMaximum !== 'UNBOUNDED_BY_DESIGN'
          || boundary.targetBytesParameter !== 'totalBytes'
          || boundary.reserveBytesParameter !== 'minFreeBytes'
          || !targetBytes
          || targetBytes.unit !== 'bytes'
          || targetBytes.max !== undefined
          || !reserveBytes
          || reserveBytes.kind !== 'integer'
          || reserveBytes.unit !== 'bytes'
          || reserveBytes.min !== NOTIFICATION_STORAGE_MIN_FREE_BYTES
          || reserveBytes.max !== NOTIFICATION_STORAGE_MAX_FREE_BYTES
          || !hasMatchingCapacityGuardFact(input.parameterGuardFacts, contract.scenario, reserveBytes)) {
          addIssue(issues, {
            category: 'invalidParameters',
            code: 'STORAGE_CAPACITY_GUARD_MISMATCH',
            scenario: contract.scenario,
            artifact: 'catalog-target-tests',
            fieldPath: 'budgets',
            expected: 'UNBOUNDED_TARGET_WITH_TESTED_MIN_FREE_RESERVE',
            actual: 'MISSING_OR_MISMATCHED',
            remediation: 'Preserve the target usable-space guard and align minFreeBytes with Catalog and target tests.',
          });
        }
        break;
      }
      case 'APPROVED_NON_RELEASING_EXCEPTION': {
        if (budget.resource !== 'JVM_RETAINED_BYTES'
          || contract.scenario !== 'NOTIFICATION_HEAP_PRESSURE'
          || boundary.ruleId !== 'NOTIFICATION_HEAP_PRESSURE_UNBOUNDED_RETAINED_HEAP'
          || boundary.hardTargetMaximum !== 'UNBOUNDED_BY_DESIGN'
          || boundary.allowedEnvironment !== 'DISPOSABLE_ONLY'
          || boundary.runtimeOutcome !== 'OOM_OR_SERVICE_RESTART_POSSIBLE'
          || contract.recoveryStrategy !== 'NON_RELEASING'
          || contract.recoveryPolicy.targetRelease !== 'FORBIDDEN'
          || contract.recoveryPolicy.cleanup !== 'NONE'
          || !hasNonEmptyText(contract.lifecycle.nonReleasingReason)) {
          addIssue(issues, {
            category: 'invalidParameters',
            code: 'NON_RELEASING_EXCEPTION_MISMATCH',
            scenario: contract.scenario,
            artifact: 'catalog',
            fieldPath: 'budgets',
            expected: 'APPROVED_DISPOSABLE_ONLY_NON_RELEASING_EXCEPTION',
            actual: 'MISSING_OR_MISAPPLIED',
            remediation: 'Keep the unbounded retained-heap exception explicit, disposable-only, and non-releasing.',
          });
        }
        break;
      }
      default: {
        addIssue(issues, {
          category: 'invalidParameters',
          code: 'RESOURCE_BOUNDARY_UNKNOWN',
          scenario: contract.scenario,
          artifact: 'catalog',
          fieldPath: 'budgets',
          expected: 'SUPPORTED_RESOURCE_BOUNDARY',
          actual: 'UNKNOWN',
          remediation: 'Use a defined budget boundary or an explicitly approved exception.',
        });
      }
    }
  }

  if (hasConcurrency || localWorker) {
    const parameter = parameterByName.get('concurrency');
    const concurrencyBudget = budgets.some((budget) => (
      budget.resource === 'REQUEST_CONCURRENCY'
      && budget.boundary.kind === 'PARAMETER_BOUNDS'
      && budget.boundary.parameterNames.includes('concurrency')
    ));
    if (hasConcurrency && (!parameter || !concurrencyBudget)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'CONCURRENCY_BUDGET_MISSING',
        scenario: contract.scenario,
        artifact: 'catalog',
        fieldPath: 'budgets',
        expected: 'REQUEST_CONCURRENCY_PARAMETER_BUDGET',
        actual: 'MISSING',
        remediation: 'Declare the request concurrency boundary using the Catalog concurrency parameter.',
      });
    }
    if (localWorker) {
      const guardFacts = input.parameterGuardFacts.filter((fact) => (
        fact.scenario === contract.scenario
        && fact.guardId === 'TRAFFIC_SURGE_MAX_CONCURRENCY'
      ));
      const expectedMax = parameter?.max;
      if (!parameter
        || !concurrencyBudget
        || parameter.kind !== 'integer'
        || parameter.min !== 1
        || expectedMax !== TRAFFIC_SURGE_MAX_CONCURRENCY
        || guardFacts.length !== 1
        || guardFacts[0]?.status !== 'PASSED'
        || !sameStringSet(guardFacts[0]?.parameterNames ?? [], ['concurrency'])
        || guardFacts[0]?.minimum !== parameter.min
        || guardFacts[0]?.maximum !== parameter.max) {
        addIssue(issues, {
          category: 'invalidParameters',
          code: 'SURGE_CONCURRENCY_LIMIT_UNVERIFIED',
          scenario: contract.scenario,
          artifact: 'worker-tests',
          fieldPath: 'parameters.concurrency',
          expected: 'CATALOG_LIMIT_AND_FAIL_CLOSED_GUARD',
          actual: 'MISSING_OR_MISMATCHED',
          remediation: 'Keep the local surge limit aligned with Catalog and test rejection above that limit.',
        });
      }
    } else if (parameter && (parameter.min === undefined
      || parameter.max === undefined
      || parameter.max > TRAFFIC_SURGE_MAX_CONCURRENCY)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'CONCURRENCY_PARAMETER_UNBOUNDED',
        scenario: contract.scenario,
        artifact: 'catalog',
        fieldPath: 'parameters.concurrency',
        expected: 'BOUNDED_CONCURRENCY',
        actual: 'MISSING_OR_TOO_LARGE',
        remediation: 'Bound concurrency in Catalog and keep its parameter-budget declaration in sync.',
      });
    }
  }

  if (hasLargeValueParameters && !budgets.some((budget) => (
    budget.resource === 'REDIS_LOGICAL_BYTES'
    && budget.boundary.kind === 'CATALOG_RULE'
    && budget.boundary.ruleId === 'CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES'
  ))) {
    addIssue(issues, {
      category: 'invalidParameters',
      code: 'REDIS_LOGICAL_BUDGET_MISSING',
      scenario: contract.scenario,
      artifact: 'catalog',
      fieldPath: 'budgets',
      expected: 'CATALOG_LOGICAL_BYTE_GUARD',
      actual: 'MISSING',
      remediation: 'Declare and test the Catalog logical-byte guard for large-value parameters.',
    });
  }

  if (hasStorageParameters && !budgets.some((budget) => (
    budget.resource === 'STORAGE_FILE_BYTES'
    && budget.boundary.kind === 'TARGET_CAPACITY_GUARD'
    && budget.boundary.guardId === 'FILESYSTEM_USABLE_SPACE_RESERVE'
  ))) {
    addIssue(issues, {
      category: 'invalidParameters',
      code: 'STORAGE_CAPACITY_BUDGET_MISSING',
      scenario: contract.scenario,
      artifact: 'catalog',
      fieldPath: 'budgets',
      expected: 'FILESYSTEM_USABLE_SPACE_RESERVE_GUARD',
      actual: 'MISSING',
      remediation: 'Declare the target free-space reserve guard for storage growth parameters.',
    });
  }

  if (parameterByName.has('appendBytes') && !budgets.some((budget) => (
    budget.resource === 'STORAGE_FILE_BYTES'
    && budget.boundary.kind === 'PARAMETER_BOUNDS'
    && sameStringSet(budget.boundary.parameterNames, ['appendBytes'])
  ))) {
    addIssue(issues, {
      category: 'invalidParameters',
      code: 'STORAGE_APPEND_BOUND_MISSING',
      scenario: contract.scenario,
      artifact: 'catalog',
      fieldPath: 'budgets.appendBytes',
      expected: 'BOUNDED_APPEND_PARAMETER',
      actual: 'MISSING',
      remediation: 'Keep appendBytes within an explicit Catalog parameter-bound budget.',
    });
  }

  const exceptionBudgets = budgets.filter(
    ({ boundary }) => boundary.kind === 'APPROVED_NON_RELEASING_EXCEPTION',
  );
  const heapBudgetMismatch = hasHeapRisk !== (exceptionBudgets.length === 1)
    || (exceptionBudgets.length > 0 && !hasHeapRisk);
  const heapScopeMismatch = hasHeapRisk
    && (input.deploymentScope === 'retained'
      || (input.scope !== 'STATIC_CONTRACT' && input.deploymentScope !== 'disposable'));
  if (heapBudgetMismatch || heapScopeMismatch) {
    const retainedScope = input.deploymentScope === 'retained' && hasHeapRisk;
    addIssue(issues, {
      category: 'invalidParameters',
      code: retainedScope
        ? 'HEAP_EXCEPTION_RETAINED_SCOPE_REJECTED'
        : heapScopeMismatch
          ? 'HEAP_EXCEPTION_DISPOSABLE_SCOPE_REQUIRED'
          : 'HEAP_EXCEPTION_BUDGET_MISMATCH',
      scenario: contract.scenario,
      artifact: 'catalog',
      fieldPath: 'budgets.JVM_RETAINED_BYTES',
      expected: 'DISPOSABLE_ONLY_APPROVED_EXCEPTION',
      actual: retainedScope
        ? 'RETAINED_SCOPE'
        : heapScopeMismatch
          ? 'DISPOSABLE_SCOPE_REQUIRED'
          : 'MISSING_OR_MISAPPLIED',
      remediation: retainedScope
        ? 'Reject non-releasing heap pressure outside an explicitly disposable deployment.'
        : heapScopeMismatch
          ? 'Require an explicitly disposable deployment for non-static heap-pressure coverage.'
          : 'Declare exactly one approved retained-heap exception only for a non-releasing contract.',
    });
  }
}

function validateRecoveryContract(
  contract: ResolvedScenarioContract,
  targetFacts: readonly ScenarioTargetContractFact[],
  issues: ScenarioContractValidationIssue[],
): void {
  const policy = contract.recoveryPolicy;
  const prepareExpected = contract.targetPrepare === 'REQUIRED'
    ? ['CREATED', 'TARGET_CONFIRMED', 'CREATE_FAILED']
    : ['CREATED'];
  const prepareActual = [...contract.lifecycle.prepareEventTypes];
  const cleanupRequired = policy.cleanup !== 'NONE';
  const cleanupEvents = [
    'MANUAL_CLEANUP_REQUIRED',
    'MANUAL_CLEANUP_REQUESTED',
    'MANUAL_CLEANUP_COMPLETED',
    'MANUAL_CLEANUP_FAILED',
  ];
  const releaseEvents = ['RELEASE_STARTED', 'RELEASE_COMPLETED', 'RELEASE_FAILED'];
  const resolvedPolicy = resolveContractRecoveryPolicy(contract);

  let policyConsistent = resolvedPolicy !== null
    && resolvedPolicy.target.service === contract.targetService
    && resolvedPolicy.target.operation === contract.targetOperation
    && resolvedPolicy.recoveryStrategy === contract.recoveryStrategy
    && resolvedPolicy.targetRelease === policy.targetRelease
    && resolvedPolicy.cleanup === policy.cleanup
    && resolvedPolicy.verification === policy.verification
    && resolvedPolicy.workerDrain.requirement === policy.workerDrain.requirement
    && (resolvedPolicy.workerDrain.requirement !== 'REQUIRED'
      || (policy.workerDrain.requirement === 'REQUIRED'
        && resolvedPolicy.workerDrain.owner === policy.workerDrain.owner))
    && contract.allowManualCleanup === cleanupRequired
    && sameStringSet(prepareActual, prepareExpected)
    && hasUniqueItems(prepareActual)
    && hasUniqueItems(contract.lifecycle.stopEventTypes)
    && contract.lifecycle.stopEventTypes.every((eventType) => SAFE_RECOVERY_EVENT_TYPES.has(eventType))
    && contract.lifecycle.cleanupActionTypes.every((action) => action === 'CLEANUP');

  const stopEvents = new Set<string>(contract.lifecycle.stopEventTypes);
  const requiredCommonEvents = [
    'STOP_REQUESTED',
    'DRAIN_STARTED',
    FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE,
    'DRAIN_TIMED_OUT',
    'DRAIN_LATE_COMPLETED',
    'DRAIN_FAILED',
    'CLEANUP_SKIPPED',
    'VERIFY_STARTED',
    'VERIFY_UNAVAILABLE',
    'RECOVERY_BLOCKED',
    'RECOVERY_COMPLETED',
  ];
  if (!requiredCommonEvents.every((eventType) => stopEvents.has(eventType))) {
    policyConsistent = false;
  }

  if (policy.targetRelease === 'REQUIRED') {
    policyConsistent = policyConsistent
      && releaseEvents.every((eventType) => stopEvents.has(eventType))
      && !stopEvents.has('RELEASE_SKIPPED')
      && !stopEvents.has('NON_RELEASING_RECORDED');
  } else if (policy.targetRelease === 'NOT_APPLICABLE') {
    policyConsistent = policyConsistent
      && stopEvents.has('RELEASE_SKIPPED')
      && !releaseEvents.some((eventType) => stopEvents.has(eventType))
      && !stopEvents.has('NON_RELEASING_RECORDED');
  } else if (policy.targetRelease === 'FORBIDDEN') {
    policyConsistent = policyConsistent
      && contract.recoveryStrategy === 'NON_RELEASING'
      && stopEvents.has('NON_RELEASING_RECORDED')
      && !releaseEvents.some((eventType) => stopEvents.has(eventType))
      && !stopEvents.has('RELEASE_SKIPPED');
  } else {
    policyConsistent = false;
  }

  if (cleanupRequired) {
    policyConsistent = policyConsistent
      && contract.lifecycle.cleanupActionTypes.length === 1
      && cleanupEvents.every((eventType) => stopEvents.has(eventType));
  } else {
    policyConsistent = policyConsistent
      && contract.lifecycle.cleanupActionTypes.length === 0
      && cleanupEvents.every((eventType) => !stopEvents.has(eventType));
  }

  if (policy.verification === 'NOT_CONFIGURED') {
    policyConsistent = policyConsistent
      && !stopEvents.has('VERIFY_COMPLETED')
      && !stopEvents.has('VERIFY_FAILED');
  } else if (policy.verification === 'REQUIRED' || policy.verification === 'BEST_EFFORT') {
    policyConsistent = policyConsistent
      && stopEvents.has('VERIFY_COMPLETED')
      && stopEvents.has('VERIFY_FAILED');
  } else {
    policyConsistent = false;
  }

  const drainRequired = policy.workerDrain.requirement === 'REQUIRED';
  const targetFact = targetFacts.find(({ scenario }) => scenario === contract.scenario);
  const cleanupCapability = targetFact?.cleanupCapability;
  const cleanupCapabilityConsistent = cleanupCapability !== undefined
    && cleanupCapability.policy === policy.cleanup
    && (cleanupRequired
      ? cleanupCapability.status === 'PASSED'
        && cleanupCapability.runScoped
        && cleanupCapability.fenced
        && cleanupCapability.confirmationSupported
        && cleanupCapability.actionOwnerVerified
      : cleanupCapability.status === 'NOT_APPLICABLE'
        && !cleanupCapability.runScoped
        && !cleanupCapability.fenced
        && !cleanupCapability.confirmationSupported
        && !cleanupCapability.actionOwnerVerified);
  policyConsistent = policyConsistent
    && cleanupCapabilityConsistent
    && (drainRequired
      ? contract.dispatchOwner === policy.workerDrain.owner
      : contract.dispatchOwner === null);
  const hasNonReleasingReason = hasNonEmptyText(contract.lifecycle.nonReleasingReason);
  if ((contract.recoveryStrategy === 'NON_RELEASING') !== hasNonReleasingReason) {
    policyConsistent = false;
  }

  if (!policyConsistent) {
    addIssue(issues, {
      category: 'invalidRecoveryHook',
      code: 'RECOVERY_POLICY_HOOK_MISMATCH',
      scenario: contract.scenario,
      artifact: 'recovery',
      fieldPath: 'lifecycle',
      expected: 'HOOKS_MATCH_CATALOG_RECOVERY_POLICY',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Align prepare, drain, release, verification, and cleanup hooks with the resolved recovery policy.',
    });
  }

  const actionTypes = new Set<FaultRunActionType>(['PREPARE', 'RELEASE', 'CLEANUP']);
  if (contract.lifecycle.cleanupActionTypes.some((action) => !actionTypes.has(action))) {
    addIssue(issues, {
      category: 'invalidRecoveryHook',
      code: 'CLEANUP_ACTION_TYPE_INVALID',
      scenario: contract.scenario,
      artifact: 'recovery',
      fieldPath: 'lifecycle.cleanupActionTypes',
      expected: 'CATALOG_CLEANUP_ACTION',
      actual: 'INVALID',
      remediation: 'Use only the supported per-run cleanup action for cleanup-capable policies.',
    });
  }
}

function resolveContractRecoveryPolicy(
  contract: ResolvedScenarioContract,
) {
  const definition: FaultRunScenarioDefinition = {
    scenario: contract.scenario,
    targetService: contract.targetService,
    targetOperation: contract.targetOperation,
    targetPrepare: contract.targetPrepare,
    maxDurationSec: contract.maxDurationSec,
    recoveryStrategy: contract.recoveryStrategy,
    recoveryPolicy: contract.recoveryPolicy,
    allowManualCleanup: contract.allowManualCleanup,
    parameters: contract.parameters,
    contract: {
      parameterConsumers: contract.parameterConsumers,
      budgets: contract.budgets,
      lifecycle: contract.lifecycle,
      evidence: contract.evidence,
      alert: contract.alert,
    },
  };
  try {
    return resolveFaultRunRecoveryPolicy(definition);
  } catch (error) {
    if (error instanceof FaultRunRecoveryPolicyInvariantError) return null;
    throw error;
  }
}

function validateEvidenceContract(
  contract: ResolvedScenarioContract,
  supportedTemplateIds: readonly EvidenceTemplateId[],
  issues: ScenarioContractValidationIssue[],
): void {
  const plan = contract.evidence;
  const supportedTemplates = new Set(supportedTemplateIds);
  const recipeById = new Map<string, (typeof plan.recipes)[number]>();
  let evidenceValid = hasExactKeys(plan, ['schemaVersion', 'windows', 'recipes', 'effectRule'])
    && hasExactKeys(plan.windows, [
      'baselineBeforeActiveSec',
      'activeLeadSec',
      'activeTailSec',
      'recoveryLeadSec',
      'recoveryTailSec',
      'cleanupLeadSec',
    ])
    && plan.schemaVersion === 'evidence-contract.v1'
    && isPositiveInteger(plan.windows.baselineBeforeActiveSec)
    && isPositiveInteger(plan.windows.activeLeadSec)
    && isPositiveInteger(plan.windows.activeTailSec)
    && isPositiveInteger(plan.windows.recoveryLeadSec)
    && isPositiveInteger(plan.windows.recoveryTailSec)
    && isPositiveInteger(plan.windows.cleanupLeadSec);

  for (const recipe of plan.recipes) {
    if (typeof recipe.id !== 'string'
      || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(recipe.id)
      || recipeById.has(recipe.id)) {
      evidenceValid = false;
      continue;
    }
    recipeById.set(recipe.id, recipe);
    const predicateValid = isValidEvidencePredicate(recipe.predicate);
    const sourceValid = EVIDENCE_SOURCES.has(recipe.source);
    const templateValid = supportedTemplates.has(recipe.template);
    const windowValid = ['baseline', 'active', 'recovery', 'cleanup'].includes(recipe.window);
    const observationValid = recipe.observationMode === 'WINDOWED' || recipe.observationMode === 'CURRENT';
    const projectionValid = ['NUMERIC', 'COUNT', 'BOOLEAN', 'TIMELINE'].includes(recipe.projection);
    const scope = isRecord(recipe.scope) ? recipe.scope : null;
    const recipeShapeValid = hasExactKeys(recipe, [
      'id',
      'source',
      'window',
      'observationMode',
      'required',
      'template',
      'scope',
      'predicate',
      'projection',
    ])
      && hasAllowedKeys(scope, ['service'], ['route', 'fixedLabels']);
    const fixedLabels = scope?.fixedLabels;
    const fixedLabelsValid = fixedLabels === undefined
      || (isRecord(fixedLabels)
        && Object.entries(fixedLabels).every(([name, value]) => (
          isSafeLabelName(name) && typeof value === 'string' && hasNonEmptyText(value)
        )));
    const scopeValid = recipeShapeValid
      && typeof scope?.service === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(scope.service)
      && (scope.route === undefined
        || (typeof scope.route === 'string' && isSafeEvidenceRoute(scope.route)))
      && fixedLabelsValid;
    const runEventSemanticsValid = recipe.source === 'RUN_EVENT'
      ? recipe.template === 'RUN_TIMELINE'
        && recipe.projection === 'TIMELINE'
        && recipe.predicate.kind === 'NONE'
      : recipe.template !== 'RUN_TIMELINE';
    const currentSemanticsValid = recipe.observationMode !== 'CURRENT'
      || (recipe.window === 'recovery' || recipe.window === 'cleanup')
        && (recipe.source === 'BUSINESS_CHECK' || recipe.source === 'RESOURCE_CHECK');
    const predicateSemanticsValid = recipe.predicate.kind !== 'NONE'
      || (recipe.source === 'RUN_EVENT' && recipe.template === 'RUN_TIMELINE')
      || (recipe.observationMode === 'CURRENT'
        && (recipe.source === 'BUSINESS_CHECK' || recipe.source === 'RESOURCE_CHECK')
        && recipe.projection === 'BOOLEAN');
    if (!predicateValid
      || !sourceValid
      || !templateValid
      || !windowValid
      || !observationValid
      || !projectionValid
      || !recipeShapeValid
      || !scopeValid
      || !runEventSemanticsValid
      || !currentSemanticsValid
      || !predicateSemanticsValid
      || typeof recipe.required !== 'boolean') {
      evidenceValid = false;
    }
  }

  const effectRuleShapeValid = hasExactKeys(plan.effectRule, ['mode', 'recipeIds'])
    && Array.isArray(plan.effectRule.recipeIds);
  const effectIds = effectRuleShapeValid ? plan.effectRule.recipeIds : [];
  const effectRecipes = effectIds.map((id) => recipeById.get(id));
  if (!effectRuleShapeValid
    || (plan.effectRule.mode !== 'ALL' && plan.effectRule.mode !== 'ANY')
    || effectIds.length === 0
    || !hasUniqueItems(effectIds)
    || effectRecipes.some((recipe) => (
      !recipe
      || recipe.source === 'RUN_EVENT'
      || recipe.window !== 'active'
      || recipe.observationMode !== 'WINDOWED'
      || !recipe.required
      || recipe.predicate.kind === 'NONE'
    ))) {
    evidenceValid = false;
  }

  const sideEffectIds = contract.lifecycle.sideEffectRecipeIds;
  if (!sameStringSet(sideEffectIds, effectIds) || !hasUniqueItems(sideEffectIds)) {
    evidenceValid = false;
  }

  if (!plan.recipes.some((recipe) => (
    recipe.source === 'RUN_EVENT'
    && recipe.window === 'active'
    && recipe.template === 'RUN_TIMELINE'
  ))) {
    evidenceValid = false;
  }

  if (!evidenceValid) {
    addIssue(issues, {
      category: 'missingEvidenceQuery',
      code: 'EVIDENCE_RECIPE_OR_EFFECT_RULE_INVALID',
      scenario: contract.scenario,
      artifact: 'evidence',
      fieldPath: 'evidence',
      expected: 'SUPPORTED_WINDOWED_EFFECT_RECIPES',
      actual: 'MISSING_OR_INVALID',
      remediation: 'Use supported templates, valid windows, and effect rules based only on observed active-window evidence.',
    });
  }

  const expectedRecoveryIds = plan.recipes
    .filter((recipe) => (
      recipe.window === 'recovery'
      && recipe.observationMode === 'WINDOWED'
      && (recipe.source === 'PROMETHEUS'
        || recipe.source === 'RESOURCE_CHECK'
        || recipe.source === 'BUSINESS_CHECK')
    ))
    .map(({ id }) => id);
  const recoveryIds = contract.lifecycle.recoveryRecipeIds;
  if (recoveryIds.length === 0
    || !hasUniqueItems(recoveryIds)
    || !sameStringSet(recoveryIds, expectedRecoveryIds)) {
    addIssue(issues, {
      category: 'invalidRecoveryHook',
      code: 'RECOVERY_EVIDENCE_REFERENCE_MISMATCH',
      scenario: contract.scenario,
      artifact: 'recovery',
      fieldPath: 'lifecycle.recoveryRecipeIds',
      expected: 'RECOVERY_WINDOW_BUSINESS_OR_RESOURCE_RECIPES',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Reference the declared recovery observations without treating a control event as business recovery.',
    });
  }

  const cleanupRecipes = plan.recipes.filter(({ window }) => window === 'cleanup');
  if (contract.recoveryPolicy.cleanup === 'NONE'
    ? cleanupRecipes.length > 0
    : cleanupRecipes.length === 0) {
    addIssue(issues, {
      category: 'invalidRecoveryHook',
      code: 'CLEANUP_EVIDENCE_POLICY_MISMATCH',
      scenario: contract.scenario,
      artifact: 'evidence',
      fieldPath: 'evidence.cleanup',
      expected: contract.recoveryPolicy.cleanup === 'NONE'
        ? 'NO_CLEANUP_EVIDENCE'
        : 'CLEANUP_WINDOW_EVIDENCE',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Keep cleanup evidence separate and applicable to the Catalog cleanup policy.',
    });
  }
}

function validateRunbookContract(
  contract: ResolvedScenarioContract,
  facts: readonly ScenarioRunbookFact[],
  issues: ScenarioContractValidationIssue[],
): void {
  const matches = facts.filter(({ scenario }) => scenario === contract.scenario);
  if (matches.length !== 1) {
    addIssue(issues, {
      category: 'missingRunbook',
      code: matches.length === 0 ? 'RUNBOOK_FACT_MISSING' : 'RUNBOOK_FACT_DUPLICATE',
      scenario: contract.scenario,
      artifact: 'runbook',
      fieldPath: 'metadata',
      expected: 'ONE_BILINGUAL_METADATA_ENTRY',
      actual: matches.length === 0 ? 'MISSING' : 'DUPLICATE',
      remediation: 'Provide one allowlisted bilingual runbook entry for every Catalog scenario.',
    });
    return;
  }

  const fact = matches[0];
  if (!fact) return;
  const localeFacts = fact.locales;
  const localeCounts = countBy(localeFacts, ({ locale }) => locale);
  const localeCoverageValid = LOCALES.every((locale) => localeCounts.get(locale) === 1)
    && localeFacts.length === LOCALES.length
    && localeFacts.every((localeFact) => (
      localeFact.allowlisted
      && localeFact.contentAvailable
      && SCENARIO_CONTRACT_REQUIRED_RUNBOOK_HEADINGS.every((heading) => localeFact.headingIds.includes(heading))
    ));
  if (!fact.metadataPresent
    || fact.metadataEntryCount !== 1
    || fact.targetService !== contract.targetService
    || fact.targetOperation !== contract.targetOperation
    || !localeCoverageValid) {
    addIssue(issues, {
      category: 'missingRunbook',
      code: 'RUNBOOK_COVERAGE_INVALID',
      scenario: contract.scenario,
      artifact: 'runbook',
      fieldPath: 'metadata.locales',
      expected: 'BILINGUAL_ALLOWLISTED_CONTENT_AND_REQUIRED_HEADINGS',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Align runbook metadata with the Catalog and provide the required headings in both locales.',
    });
  }

}

function validateI18nContract(
  contract: ResolvedScenarioContract,
  facts: readonly ScenarioI18nFact[],
  issues: ScenarioContractValidationIssue[],
): void {
  const matches = facts.filter(({ scenario }) => scenario === contract.scenario);
  if (matches.length !== 1) {
    addIssue(issues, {
      category: 'missingI18n',
      code: matches.length === 0 ? 'I18N_FACT_MISSING' : 'I18N_FACT_DUPLICATE',
      scenario: contract.scenario,
      artifact: 'i18n',
      fieldPath: 'scenario',
      expected: 'ONE_I18N_COVERAGE_FACT',
      actual: matches.length === 0 ? 'MISSING' : 'DUPLICATE',
      remediation: 'Provide one normalized bilingual i18n coverage fact per Catalog scenario.',
    });
    return;
  }

  const fact = matches[0];
  if (!fact) return;
  const localeCounts = countBy(fact.locales, ({ locale }) => locale);
  let valid = fact.scenarioMetaPresent
    && fact.groupMembershipCount === 1
    && fact.locales.length === LOCALES.length
    && LOCALES.every((locale) => localeCounts.get(locale) === 1);

  for (const locale of fact.locales) {
    const parameterCounts = countBy(locale.parameters, ({ name }) => name);
    const expectedNames = contract.parameters.map(({ name }) => name);
    valid = valid
      && locale.scenarioLabelPresent
      && locale.scenarioDescriptionPresent
      && locale.recoveryStrategyLabelPresent
      && locale.groupLabelPresent
      && locale.parameters.length === expectedNames.length
      && expectedNames.every((name) => parameterCounts.get(name) === 1)
      && locale.parameters.every((parameter) => (
        expectedNames.includes(parameter.name)
        && parameter.labelPresent
        && parameter.descriptionPresent
      ));
  }

  if (!valid) {
    addIssue(issues, {
      category: 'missingI18n',
      code: 'I18N_COVERAGE_INVALID',
      scenario: contract.scenario,
      artifact: 'i18n',
      fieldPath: 'scenarioMeta.parameters.groups',
      expected: 'BILINGUAL_SCENARIO_PARAMETER_RECOVERY_AND_ONE_GROUP',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Add both-locale scenario, parameter, recovery, and group translations with exact one-group coverage.',
    });
  }

}

function validateScenarioAlertContract(
  contract: ResolvedScenarioContract,
  config: ScenarioAlertConfigurationFacts,
  issues: ScenarioContractValidationIssue[],
): void {
  const alertContract = contract.alert;
  const alertContractShapeValid = alertContract.expectation === 'NOT_EXPECTED'
    ? hasExactKeys(alertContract, [
      'expectation',
      'reason',
      'faultRunCorrelation',
      'missingAlertTreatment',
      'receiptPolicyId',
    ])
    : hasExactKeys(alertContract, [
      'expectation',
      'allowedAlerts',
      'missingAlertTreatment',
      'receiptPolicyId',
    ]);
  let valid = alertContractShapeValid && alertContract.receiptPolicyId === ALERT_RECEIPT_POLICY_ID;
  const alerts = alertContract.expectation === 'NOT_EXPECTED'
    ? []
    : alertContract.allowedAlerts;

  if (alertContract.expectation === 'NOT_EXPECTED') {
    valid = valid
      && hasNonEmptyText(alertContract.reason)
      && alertContract.faultRunCorrelation === 'not_required'
      && alertContract.missingAlertTreatment === 'EFFECT_CAN_STILL_BE_OBSERVED';
  } else if (alertContract.expectation === 'CONDITIONAL'
    || alertContract.expectation === 'REQUIRED_FOR_PILOT') {
    valid = valid
      && alertContract.allowedAlerts.length > 0
      && (alertContract.missingAlertTreatment === 'EFFECT_CAN_STILL_BE_OBSERVED'
        || alertContract.missingAlertTreatment === 'EVIDENCE_UNAVAILABLE');
  } else {
    valid = false;
  }

  const alertKeys = new Set<string>();
  for (const alert of alerts) {
    const alertShapeValid = hasExactKeys(alert, [
      'alertName',
      'service',
      'severity',
      'requiredLabels',
      'incidentKeyLabels',
      'correlationWindowSec',
      'activeGraceBeforeSec',
      'recentGraceAfterSec',
      'sendResolvedToControlPlane',
      'faultRunCorrelation',
    ]);
    const key = `${alert.alertName}\u0000${alert.service}`;
    const requiredLabels = isRecord(alert.requiredLabels) ? alert.requiredLabels : null;
    const labelNames = requiredLabels ? Object.keys(requiredLabels) : [];
    if (!alertShapeValid
      || !/^[A-Za-z][A-Za-z0-9_]*$/u.test(alert.alertName)
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(alert.service)
      || (alert.severity !== 'warning' && alert.severity !== 'critical')
      || !Number.isSafeInteger(alert.correlationWindowSec)
      || alert.correlationWindowSec <= 0
      || !Number.isSafeInteger(alert.activeGraceBeforeSec)
      || alert.activeGraceBeforeSec < 0
      || !Number.isSafeInteger(alert.recentGraceAfterSec)
      || alert.recentGraceAfterSec < 0
      || alert.correlationWindowSec !== ALERT_CORRELATION_TIMING.correlationWindowSec
      || alert.activeGraceBeforeSec !== ALERT_CORRELATION_TIMING.activeGraceBeforeSec
      || alert.recentGraceAfterSec !== ALERT_CORRELATION_TIMING.recentGraceAfterSec
      || alert.sendResolvedToControlPlane !== true
      || !['required', 'optional', 'not_required'].includes(alert.faultRunCorrelation)
      || requiredLabels === null
      || !hasUniqueItems(labelNames)
      || labelNames.some((name) => !isSafeLabelName(name))
      || Object.values(requiredLabels ?? {}).some((value) => (
        typeof value !== 'string' || !hasNonEmptyText(value)
      ))
      || !hasUniqueItems(alert.incidentKeyLabels)
      || alert.incidentKeyLabels.some((name) => !isSafeLabelName(name))
      || alert.incidentKeyLabels.some((label) => !labelNames.includes(label))
      || (alert.faultRunCorrelation === 'not_required' && alert.incidentKeyLabels.length > 0)
      || alertKeys.has(key)) {
      valid = false;
    }
    alertKeys.add(key);
  }

  if (!valid) {
    addIssue(issues, {
      category: 'invalidAlertContract',
      code: 'SCENARIO_ALERT_DECLARATION_INVALID',
      scenario: contract.scenario,
      artifact: 'catalog-alert',
      fieldPath: 'alert',
      expected: 'VALID_CORRELATION_AND_RECEIPT_CONTRACT',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Align alert declaration, correlation fields, and the shared internal receipt policy.',
    });
    return;
  }

  const deployments = uniqueDeploymentVariants(config.prometheus);
  const alertmanagerDeployments = uniqueDeploymentVariants(config.alertmanager);
  if (deployments.length !== 2 || alertmanagerDeployments.length !== 2) {
    addIssue(issues, {
      category: 'invalidAlertContract',
      code: 'ALERT_DEPLOYMENT_FACTS_MISSING',
      scenario: contract.scenario,
      artifact: 'deployment-alerts',
      fieldPath: 'deployments',
      expected: 'COMPOSE_AND_KUBERNETES_FACTS',
      actual: 'MISSING_OR_DUPLICATE',
      remediation: 'Provide normalized alert configuration facts for Compose and Kubernetes.',
    });
    return;
  }

  for (const alert of alerts) {
    const ruleFacts = deployments.map((deployment) => (
      deployment.rules.filter(({ alertName }) => alertName === alert.alertName)
    ));
    if (ruleFacts.some((rules) => rules.length !== 1)) {
      addIssue(issues, {
        category: 'invalidAlertContract',
        code: 'PROMETHEUS_ALERT_RULE_MISSING_OR_DUPLICATE',
        scenario: contract.scenario,
        artifact: 'prometheus',
        fieldPath: 'alert.allowedAlerts',
        expected: 'ONE_RULE_PER_DEPLOYMENT',
        actual: 'MISSING_OR_DUPLICATE',
        remediation: 'Keep one matching Prometheus rule in each deployment configuration.',
      });
      continue;
    }

    const composeRule = ruleFacts[0]?.[0];
    const kubernetesRule = ruleFacts[1]?.[0];
    if (!composeRule || !kubernetesRule) continue;
    const requiredLabelNames = Object.keys(alert.requiredLabels);
    const composeValid = alertRuleMatchesContract(alert, composeRule, deployments[0]);
    const kubernetesValid = alertRuleMatchesContract(alert, kubernetesRule, deployments[1]);
    if (!composeValid || !kubernetesValid || !sameAlertRuleSemantics(composeRule, kubernetesRule)) {
      addIssue(issues, {
        category: 'invalidAlertContract',
        code: 'PROMETHEUS_ALERT_FIELDS_MISMATCH',
        scenario: contract.scenario,
        artifact: 'prometheus',
        fieldPath: 'alert.allowedAlerts',
        expected: `ALERT_FIELDS_AND_LABELS_${requiredLabelNames.length > 0 ? 'COVERED' : 'VALID'}`,
        actual: 'MISSING_OR_MISMATCHED',
        remediation: 'Align alert name, severity, service/label dimensions, and normalized rule semantics.',
      });
    }
  }
}

function validateAlertConfiguration(
  config: ScenarioAlertConfigurationFacts,
  issues: ScenarioContractValidationIssue[],
): void {
  if (uniqueDeploymentVariants(config.prometheus).length !== 2) {
    addIssue(issues, {
      category: 'invalidAlertContract',
      code: 'PROMETHEUS_DEPLOYMENT_FACTS_MISSING',
      artifact: 'prometheus',
      fieldPath: 'deployments',
      expected: 'COMPOSE_AND_KUBERNETES_FACTS',
      actual: 'MISSING_OR_DUPLICATE',
      remediation: 'Provide normalized Prometheus rule facts for Compose and Kubernetes.',
    });
  }

  const deployments = uniqueDeploymentVariants(config.alertmanager);
  if (deployments.length !== 2) {
    addIssue(issues, {
      category: 'invalidAlertContract',
      code: 'ALERTMANAGER_DEPLOYMENT_FACTS_MISSING',
      artifact: 'alertmanager',
      fieldPath: 'deployments',
      expected: 'COMPOSE_AND_KUBERNETES_FACTS',
      actual: 'MISSING_OR_DUPLICATE',
      remediation: 'Provide normalized Alertmanager route facts for Compose and Kubernetes.',
    });
    return;
  }

  const receiptsValid = deployments.every((deployment) => (
    deployment.internalReceipt.routeConfigured
    && deployment.internalReceipt.receiverConfigured
    && deployment.internalReceipt.receiptPolicyId === ALERT_RECEIPT_POLICY_ID
    && deployment.internalReceipt.sendResolved === true
    && isSha256(deployment.internalReceipt.routeTreeSha256)
  ));
  const receiptDigests = deployments.map(({ internalReceipt }) => internalReceipt.routeTreeSha256);
  if (!receiptsValid
    || normalizeSha256(receiptDigests[0]) === null
    || normalizeSha256(receiptDigests[0]) !== normalizeSha256(receiptDigests[1])) {
    addIssue(issues, {
      category: 'invalidAlertContract',
      code: 'INTERNAL_RECEIPT_ROUTE_INVALID',
      artifact: 'alertmanager',
      fieldPath: 'internalReceipt',
      expected: 'RESOLVED_RECEIPT_ROUTE_AND_SEND_RESOLVED',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Keep internal alert receipt routing configured with send_resolved enabled in both deployments.',
    });
  }

  const readiness = config.agentDeliveryReadiness;
  if (readiness.state === 'NOT_ENABLED_YET') {
    const undeclaredExternalRoute = deployments.some(({ externalAgent }) => (
      externalAgent.childRouteConfigured
      || externalAgent.receiverConfigured
      || externalAgent.routeTreeSha256 !== null
    ));
    if (undeclaredExternalRoute) {
      addIssue(issues, {
        category: 'invalidAlertContract',
        code: 'AGENT_ROUTE_CONFIGURED_WHILE_NOT_ENABLED',
        artifact: 'alertmanager',
        fieldPath: 'externalAgent',
        expected: 'NO_EXTERNAL_AGENT_ROUTE_OR_RECEIVER',
        actual: 'UNDECLARED_EXTERNAL_DELIVERY',
        remediation: 'Keep Agent delivery unset until its deployment-managed route and receiver are explicitly declared.',
      });
    }
    return;
  }
  if (readiness.state !== 'ENABLED') {
    addIssue(issues, {
      category: 'invalidAlertContract',
      code: 'AGENT_DELIVERY_READINESS_INVALID',
      artifact: 'alertmanager',
      fieldPath: 'agentDeliveryReadiness',
      expected: 'KNOWN_DELIVERY_READINESS',
      actual: 'INVALID',
      remediation: 'Provide an explicit deployment-level Agent delivery readiness fact.',
    });
    return;
  }
  const agentRoutesValid = readiness.credentialSource === 'DEPLOYMENT_MANAGED_SECRET'
    && readiness.sendResolved === false
    && hasNonEmptyText(readiness.childRouteName)
    && hasNonEmptyText(readiness.externalReceiverName)
    && deployments.every((deployment) => (
    deployment.externalAgent.childRouteConfigured
    && deployment.externalAgent.receiverConfigured
    && deployment.externalAgent.childRouteName === readiness.childRouteName
    && deployment.externalAgent.receiverName === readiness.externalReceiverName
    && deployment.externalAgent.credentialSource === 'DEPLOYMENT_MANAGED_SECRET'
    && deployment.externalAgent.sendResolved === false
    && isSha256(deployment.externalAgent.routeTreeSha256)
    ));
  const agentDigests = deployments.map(({ externalAgent }) => externalAgent.routeTreeSha256);
  if (!agentRoutesValid
    || normalizeSha256(agentDigests[0]) === null
    || normalizeSha256(agentDigests[0]) !== normalizeSha256(agentDigests[1])) {
    addIssue(issues, {
      category: 'invalidAlertContract',
      code: 'EXTERNAL_AGENT_ROUTE_INVALID',
      artifact: 'alertmanager',
      fieldPath: 'externalAgent',
      expected: 'ENABLED_CHILD_ROUTE_RECEIVER_SECRET_AND_SEND_RESOLVED_FALSE',
      actual: 'MISSING_OR_MISMATCHED',
      remediation: 'Match the enabled Agent route, receiver, deployment-managed credential, and resolved policy.',
    });
  }
}

function validateOrphanTargetFacts(
  facts: readonly ScenarioTargetContractFact[],
  knownScenarios: ReadonlySet<FaultRunScenario>,
  issues: ScenarioContractValidationIssue[],
): void {
  for (const fact of facts) {
    if (!knownScenarios.has(fact.scenario)) {
      addIssue(issues, {
        category: 'missingTarget',
        code: 'TARGET_FACT_ORPHAN',
        artifact: 'target',
        fieldPath: 'mapping',
        expected: 'CATALOG_SCENARIO',
        actual: 'ORPHAN_FACT',
        remediation: 'Remove orphan target facts or provide the matching resolved Catalog contract.',
      });
    }
  }
}

function validateOrphanDispatchFacts(
  descriptors: readonly ScenarioDispatchValidationDescriptor[],
  knownScenarios: ReadonlySet<FaultRunScenario>,
  issues: ScenarioContractValidationIssue[],
): void {
  const nameCounts = countBy(descriptors, ({ name }) => name);
  if ([...nameCounts.values()].some((count) => count > 1)) {
    addIssue(issues, {
      category: 'missingDispatch',
      code: 'DRIVER_DESCRIPTOR_DUPLICATE',
      artifact: 'worker',
      fieldPath: 'dispatch',
      expected: 'UNIQUE_DRIVER_DESCRIPTORS',
      actual: 'DUPLICATE',
      remediation: 'Project each actual owned driver exactly once.',
    });
  }
  for (const descriptor of descriptors) {
    if (descriptor.supportedScenarios.length === 0
      || descriptor.supportedScenarios.some((scenario) => !knownScenarios.has(scenario))) {
      addIssue(issues, {
        category: 'missingDispatch',
        code: 'DRIVER_DESCRIPTOR_ORPHAN',
        artifact: 'worker',
        fieldPath: 'dispatch.supportedScenarios',
        expected: 'CATALOG_SCENARIOS_ONLY',
        actual: 'ORPHAN_DRIVER',
        remediation: 'Remove unsupported driver claims or include the corresponding resolved Catalog contract.',
      });
    }
  }
}

function validateOrphanParameterFacts(
  input: ScenarioContractValidationInput,
  knownScenarios: ReadonlySet<FaultRunScenario>,
  issues: ScenarioContractValidationIssue[],
): void {
  for (const fact of input.parameterValidationFacts) {
    if (!knownScenarios.has(fact.scenario)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'PARAMETER_VALIDATOR_FACT_ORPHAN',
        artifact: 'catalog-tests',
        fieldPath: 'validateScenarioParameters',
        expected: 'CATALOG_SCENARIO',
        actual: 'ORPHAN_FACT',
        remediation: 'Remove parameter validation facts that have no resolved Catalog contract.',
      });
    }
  }
  for (const fact of input.parameterGuardFacts) {
    if (!knownScenarios.has(fact.scenario)) {
      addIssue(issues, {
        category: 'invalidParameters',
        code: 'PARAMETER_GUARD_FACT_ORPHAN',
        artifact: 'catalog-tests',
        fieldPath: 'parameterGuards',
        expected: 'CATALOG_SCENARIO',
        actual: 'ORPHAN_FACT',
        remediation: 'Remove resource guard facts that have no resolved Catalog contract.',
      });
    }
  }
}

function validateOrphanRunbookFacts(
  facts: readonly ScenarioRunbookFact[],
  knownScenarios: ReadonlySet<FaultRunScenario>,
  issues: ScenarioContractValidationIssue[],
): void {
  for (const fact of facts) {
    if (!knownScenarios.has(fact.scenario)) {
      addIssue(issues, {
        category: 'missingRunbook',
        code: 'RUNBOOK_FACT_ORPHAN',
        artifact: 'runbook',
        fieldPath: 'metadata',
        expected: 'CATALOG_SCENARIO',
        actual: 'ORPHAN_FACT',
        remediation: 'Remove runbook facts that have no resolved Catalog contract.',
      });
    }
  }
}

function validateOrphanI18nFacts(
  facts: readonly ScenarioI18nFact[],
  knownScenarios: ReadonlySet<FaultRunScenario>,
  issues: ScenarioContractValidationIssue[],
): void {
  for (const fact of facts) {
    if (!knownScenarios.has(fact.scenario)) {
      addIssue(issues, {
        category: 'missingI18n',
        code: 'I18N_FACT_ORPHAN',
        artifact: 'i18n',
        fieldPath: 'scenario',
        expected: 'CATALOG_SCENARIO',
        actual: 'ORPHAN_FACT',
        remediation: 'Remove i18n facts that have no resolved Catalog contract.',
      });
    }
  }
}

function alertRuleMatchesContract(
  alert: NonNullable<Extract<ResolvedScenarioContract['alert'], { expectation: 'CONDITIONAL' | 'REQUIRED_FOR_PILOT' }>['allowedAlerts'][number]>,
  rule: ScenarioPrometheusRuleFact,
  deployment: ScenarioPrometheusDeploymentFact | undefined,
): boolean {
  if (!deployment
    || rule.severity !== alert.severity
    || rule.staticLabels.severity !== alert.severity
    || rule.serviceLabelName !== 'service'
    || !rule.outputLabelNames.includes('service')
    || !deployment.serviceLabelValues.includes(alert.service)
    || !isPositiveInteger(rule.forSeconds)
    || !isPositiveInteger(rule.groupIntervalSeconds)
    || !isSha256(rule.expressionSha256)) {
    return false;
  }

  for (const [labelName, labelValue] of Object.entries(alert.requiredLabels)) {
    const staticValue = rule.staticLabels[labelName];
    if (staticValue !== undefined) {
      if (staticValue !== labelValue) return false;
    } else if (!rule.outputLabelNames.includes(labelName)) {
      return false;
    }
  }
  return alert.incidentKeyLabels.every((labelName) => (
    rule.outputLabelNames.includes(labelName)
    || Object.prototype.hasOwnProperty.call(rule.staticLabels, labelName)
  ));
}

function sameAlertRuleSemantics(
  left: ScenarioPrometheusRuleFact,
  right: ScenarioPrometheusRuleFact,
): boolean {
  return left.alertName === right.alertName
    && left.severity === right.severity
    && left.serviceLabelName === right.serviceLabelName
    && left.forSeconds === right.forSeconds
    && left.groupIntervalSeconds === right.groupIntervalSeconds
    && normalizeSha256(left.expressionSha256) === normalizeSha256(right.expressionSha256)
    && sameStringSet(left.outputLabelNames, right.outputLabelNames)
    && canonicalStringMap(left.staticLabels) === canonicalStringMap(right.staticLabels);
}

function buildRequiredChecks(
  input: ScenarioContractValidationInput,
  stage: ScenarioContractValidationStage,
  catalogRevision: string,
  sourceCommitSha: string | null,
): ScenarioContractValidationReport['requiredChecks'][number][] {
  const reservedCheckIds = new Set([
    'scenario-contract.catalog-revision',
    'scenario-contract.source-commit',
    'scenario-contract.required-check-plan',
  ]);
  const normalized = new Map<string, { rawId: string; duplicate: boolean; invalid: boolean }>();
  for (const checkId of input.requiredCheckIds) {
    const safeId = VALID_CHECK_ID.test(checkId) && !reservedCheckIds.has(checkId)
      ? checkId : 'INVALID_CHECK_ID';
    const previous = normalized.get(safeId);
    if (previous) {
      previous.duplicate = true;
      continue;
    }
    normalized.set(safeId, {
      rawId: checkId,
      duplicate: false,
      invalid: safeId === 'INVALID_CHECK_ID',
    });
  }

  const requiredChecks: ScenarioContractValidationReport['requiredChecks'][number][] = [{
    checkId: 'scenario-contract.catalog-revision',
    status: catalogRevision === 'INVALID' ? 'FAILED' : 'PASSED',
    catalogRevision,
    sourceCommitSha,
  }];
  if (input.sourceCommitSha !== null || stage === 'FINAL') {
    requiredChecks.push({
      checkId: 'scenario-contract.source-commit',
      status: input.sourceCommitSha === null
        ? 'MISSING'
        : sourceCommitSha === null ? 'FAILED' : 'PASSED',
      catalogRevision,
      sourceCommitSha,
    });
  }
  if (stage === 'FINAL' && input.requiredCheckIds.length === 0) {
    requiredChecks.push({
      checkId: 'scenario-contract.required-check-plan',
      status: 'MISSING',
      catalogRevision,
      sourceCommitSha,
    });
  }

  requiredChecks.push(...[...normalized.entries()].map(([checkId, required]) => {
    const results = required.invalid
      ? []
      : input.checkResults.filter((result) => result.checkId === required.rawId);
    const result = results.length === 1 ? results[0] : undefined;
    const checkRevision = result ? normalizeCatalogRevision(result.catalogRevision) : catalogRevision;
    const checkCommit = result ? normalizeCommitSha(result.sourceCommitSha) : null;
    let status: 'PASSED' | 'FAILED' | 'MISSING' = required.invalid || required.duplicate
      ? 'FAILED'
      : !result
        ? 'MISSING'
        : result.status === 'PASSED'
          ? 'PASSED'
          : 'FAILED';

    if (results.length > 1) status = 'FAILED';
    if (status === 'PASSED'
      && (catalogRevision === 'INVALID'
        || checkRevision === 'INVALID'
        || checkRevision !== catalogRevision
        || (result?.sourceCommitSha !== null && checkCommit === null)
        || (sourceCommitSha !== null && checkCommit !== sourceCommitSha)
        || (stage === 'FINAL' && (sourceCommitSha === null || checkCommit === null)))) {
      status = 'FAILED';
    }

    return {
      checkId,
      status,
      catalogRevision: result ? checkRevision : catalogRevision,
      sourceCommitSha: checkCommit,
    };
  }));

  return requiredChecks;
}

function isScenarioLimited(
  input: ScenarioContractValidationInput,
  scenario: FaultRunScenario,
  scope: ScenarioContractValidationScope,
): boolean {
  const agentDeliveryLimited = input.requireAgentDeliveryLive === true
    && input.alertConfiguration.agentDeliveryReadiness.state === 'NOT_ENABLED_YET';
  if (agentDeliveryLimited) return true;
  if (scope === 'STATIC_CONTRACT') return false;
  const facts = (input.coverageFacts ?? []).filter((fact) => fact.scenario === scenario);
  return facts.length !== 1 || facts[0]?.status !== 'COVERED';
}

function isScenarioCoverageBlocked(
  input: ScenarioContractValidationInput,
  scenario: FaultRunScenario,
  scope: ScenarioContractValidationScope,
): boolean {
  if (scope === 'STATIC_CONTRACT') return false;
  const facts = (input.coverageFacts ?? []).filter((fact) => fact.scenario === scenario);
  return facts.length > 1 || facts.some(({ status }) => status === 'FAILED');
}

function hasPassingGuardFact(
  facts: readonly ScenarioParameterGuardFact[],
  scenario: FaultRunScenario,
  guardId: ScenarioParameterGuardId,
  parameterNames: readonly string[],
): boolean {
  const matches = facts.filter((fact) => fact.scenario === scenario && fact.guardId === guardId);
  return matches.length === 1
    && matches[0]?.status === 'PASSED'
    && sameStringSet(matches[0]?.parameterNames ?? [], parameterNames);
}

function hasMatchingCapacityGuardFact(
  facts: readonly ScenarioParameterGuardFact[],
  scenario: FaultRunScenario,
  reserveParameter: FaultRunParameterDefinition,
): boolean {
  const matches = facts.filter((fact) => (
    fact.scenario === scenario && fact.guardId === 'FILESYSTEM_USABLE_SPACE_RESERVE'
  ));
  const fact = matches[0];
  return matches.length === 1
    && fact?.status === 'PASSED'
    && sameStringSet(fact.parameterNames, ['totalBytes', 'minFreeBytes'])
    && reserveParameter.min === NOTIFICATION_STORAGE_MIN_FREE_BYTES
    && reserveParameter.max === NOTIFICATION_STORAGE_MAX_FREE_BYTES
    && fact.minimum === reserveParameter.min
    && fact.maximum === reserveParameter.max;
}

function isValidBudgetBoundaryShape(boundary: unknown): boolean {
  if (!isRecord(boundary)) return false;
  switch (boundary.kind) {
    case 'PARAMETER_BOUNDS':
      return hasExactKeys(boundary, ['kind', 'parameterNames']);
    case 'CATALOG_RULE':
      return hasExactKeys(boundary, ['kind', 'ruleId', 'parameterNames']);
    case 'TARGET_CAPACITY_GUARD':
      return hasExactKeys(boundary, [
        'kind',
        'guardId',
        'targetBytesParameter',
        'reserveBytesParameter',
        'hardTargetMaximum',
      ]);
    case 'APPROVED_NON_RELEASING_EXCEPTION':
      return hasExactKeys(boundary, [
        'kind',
        'ruleId',
        'hardTargetMaximum',
        'allowedEnvironment',
        'runtimeOutcome',
      ]);
    default:
      return false;
  }
}

function isValidParameterDefinition(parameter: FaultRunParameterDefinition): boolean {
  if (!hasAllowedKeys(
    parameter,
    ['name', 'kind'],
    ['unit', 'required', 'default', 'options', 'min', 'max', 'maxLength'],
  )
    || !/^[A-Za-z][A-Za-z0-9]*$/u.test(parameter.name)
    || !['integer', 'number', 'string'].includes(parameter.kind)
    || (parameter.unit !== undefined && parameter.unit !== 'bytes')
    || (parameter.unit === 'bytes' && parameter.kind === 'string')
    || (parameter.required !== undefined && typeof parameter.required !== 'boolean')) {
    return false;
  }

  if (parameter.min !== undefined
    && (!Number.isFinite(parameter.min)
      || (parameter.kind === 'integer' && !Number.isSafeInteger(parameter.min)))) {
    return false;
  }
  if (parameter.max !== undefined
    && (!Number.isFinite(parameter.max)
      || (parameter.kind === 'integer' && !Number.isSafeInteger(parameter.max)))) {
    return false;
  }
  if (parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) {
    return false;
  }
  if (parameter.maxLength !== undefined
    && (parameter.kind !== 'string'
      || !Number.isSafeInteger(parameter.maxLength)
      || parameter.maxLength < 1)) {
    return false;
  }

  if (parameter.options !== undefined) {
    if (parameter.kind !== 'string'
      || parameter.options.length === 0
      || parameter.options.some((option) => !hasNonEmptyText(option))
      || !hasUniqueItems(parameter.options)) {
      return false;
    }
  }
  return parameter.default === undefined || isParameterDefaultValid(parameter);
}

function isParameterDefaultValid(parameter: FaultRunParameterDefinition): boolean {
  const value = parameter.default;
  if (value === undefined) return true;
  if (parameter.kind === 'string') {
    return typeof value === 'string'
      && value.length > 0
      && (parameter.maxLength === undefined || value.length <= parameter.maxLength)
      && (parameter.options === undefined || parameter.options.includes(value));
  }
  const numericValue = parseParameterNumber(parameter, value);
  return numericValue !== undefined
    && Number.isFinite(numericValue)
    && (parameter.kind !== 'integer' || Number.isSafeInteger(numericValue))
    && (parameter.min === undefined || numericValue >= parameter.min)
    && (parameter.max === undefined || numericValue <= parameter.max);
}

function defaultAsNumber(parameter: FaultRunParameterDefinition): number | undefined {
  if (parameter.default === undefined) return undefined;
  return parseParameterNumber(parameter, parameter.default);
}

function parseParameterNumber(
  parameter: FaultRunParameterDefinition,
  value: unknown,
): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || parameter.unit !== 'bytes') return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(B|KB?|MB?|GB?)?$/iu);
  if (!match) return undefined;
  const multiplier = match[2] === undefined
    ? 1
    : BYTE_UNIT_MULTIPLIERS[match[2].toUpperCase()];
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isValidEvidencePredicate(predicate: unknown): predicate is {
  readonly kind: 'NONE' | 'BOOLEAN_EQUALS' | 'COMPARISON';
  readonly expected?: boolean;
  readonly operator?: string;
  readonly value?: number;
} {
  if (!isRecord(predicate)) return false;
  if (predicate.kind === 'NONE') {
    return hasExactKeys(predicate, ['kind']);
  }
  if (predicate.kind === 'BOOLEAN_EQUALS') {
    return hasExactKeys(predicate, ['kind', 'expected'])
      && typeof predicate.expected === 'boolean';
  }
  return predicate.kind === 'COMPARISON'
    && hasExactKeys(predicate, ['kind', 'operator', 'value'])
    && ['GT', 'GTE', 'LT', 'LTE', 'EQ'].includes(String(predicate.operator))
    && typeof predicate.value === 'number'
    && Number.isFinite(predicate.value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: unknown, expectedKeys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasAllowedKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key));
}

function supportsSummaryEvent(eventType: string): boolean {
  try {
    const normalized = normalizeFaultRunSummaryEventPayload(eventType, {});
    return ['report-worker', 'scenario-worker', 'runner'].includes(String(normalized.source))
      && ['effect', 'worker', 'recovery'].includes(String(normalized.phase))
      && ['COMPLETED', 'DRAINED'].includes(String(normalized.status));
  } catch (error) {
    if (error instanceof FaultRunEventContractError) return false;
    throw error;
  }
}

function supportsRecoveryEvent(eventType: string): boolean {
  if (!SAFE_RECOVERY_EVENT_TYPES.has(eventType)) return false;
  try {
    normalizeFaultRunRecoveryEventPayload(eventType as FaultRunRecoveryEventType, {});
    return true;
  } catch (error) {
    if (error instanceof FaultRunEventContractError) return false;
    throw error;
  }
}

function uniqueDeploymentVariants<T extends { readonly variant: ScenarioContractDeploymentVariant }>(
  facts: readonly T[],
): T[] {
  const compose = facts.filter(({ variant }) => variant === 'COMPOSE');
  const kubernetes = facts.filter(({ variant }) => variant === 'KUBERNETES');
  if (compose.length !== 1 || kubernetes.length !== 1 || facts.length !== 2) return [];
  return [compose[0], kubernetes[0]].filter(isDefined);
}

function normalizeCatalogRevision(value: string): string {
  return VALID_CATALOG_REVISION.test(value) ? value.toLowerCase() : 'INVALID';
}

function normalizeCommitSha(value: string | null): string | null {
  return value !== null && VALID_COMMIT_SHA.test(value) ? value.toLowerCase() : null;
}

function normalizeSha256(value: string | null): string | null {
  return value !== null && VALID_CATALOG_REVISION.test(value) ? value.toLowerCase() : null;
}

function isSha256(value: string | null): boolean {
  return normalizeSha256(value) !== null;
}

function canonicalStringMap(value: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(value)
    .sort(([left], [right]) => compareStrings(left, right)));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length
    || new Set(left).size !== left.length
    || new Set(right).size !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort(compareStrings);
  const sortedRight = [...right].sort(compareStrings);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function hasUniqueItems<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function countBy<T, K>(values: readonly T[], key: (value: T) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);
  return counts;
}

function isPositiveInteger(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isSafeInteger(value) && value > 0;
}

function hasNonEmptyText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeLabelName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}

function isSafeEvidenceRoute(value: string): boolean {
  return /^\/[A-Za-z0-9_{}./:-]+$/u.test(value) && !value.includes('..');
}

function isSafeInternalPath(value: string): boolean {
  return value.startsWith('/internal/')
    && !value.includes('://')
    && !value.includes('..')
    && !value.includes('?')
    && !value.includes('#');
}

function isSafeConsumerRoute(value: string | null): value is string {
  return value !== null
    && value.startsWith('/api/')
    && !value.includes('://')
    && !value.includes('..')
    && !value.includes('?')
    && !value.includes('#');
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function addIssue(
  issues: ScenarioContractValidationIssue[],
  issue: ScenarioContractValidationIssue,
): void {
  issues.push(issue);
}

function sortIssues(
  issues: readonly ScenarioContractValidationIssue[],
): ScenarioContractValidationIssue[] {
  return [...issues].sort((left, right) => (
    compareStrings(left.category, right.category)
    || compareStrings(left.code, right.code)
    || compareStrings(left.scenario ?? '', right.scenario ?? '')
    || compareStrings(left.artifact ?? '', right.artifact ?? '')
    || compareStrings(left.fieldPath ?? '', right.fieldPath ?? '')
    || compareStrings(left.expected ?? '', right.expected ?? '')
    || compareStrings(left.actual ?? '', right.actual ?? '')
    || compareStrings(left.remediation, right.remediation)
  ));
}

function sortReadinessNotes(
  notes: readonly ScenarioContractValidationReport['readinessNotes'][number][],
): ScenarioContractValidationReport['readinessNotes'][number][] {
  return [...notes].sort((left, right) => (
    compareStrings(left.code, right.code)
    || compareStrings(left.scenario ?? '', right.scenario ?? '')
    || compareStrings(left.detail, right.detail)
  ));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
