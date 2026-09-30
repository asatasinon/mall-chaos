import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCatalogRevision,
} from './fault-run-catalog-revision';
import {
  getScenarioDefinition,
  listScenarioDefinitions,
  NOTIFICATION_STORAGE_MAX_FREE_BYTES,
  NOTIFICATION_STORAGE_MIN_FREE_BYTES,
  validateScenarioParameters,
} from './fault-run-catalog';
import {
  resolveScenarioContract,
  type ResolvedScenarioContract,
} from './scenario-contract';
import {
  SCENARIO_CONTRACT_REPORT_SCHEMA_VERSION,
  validateScenarioContracts,
  type ScenarioAlertConfigurationFacts,
  type ScenarioContractValidationInput,
  type ScenarioDispatchValidationDescriptor,
  type ScenarioParameterGuardFact,
  type ScenarioRunbookHeadingId,
  type ScenarioTargetContractFact,
} from './scenario-contract-validator';
import { getTrafficScenarioTarget } from './fault-run-targets';
import type { FaultRunRecord } from './fault-run-repository';
import { getFaultRunDriverDescriptors } from '../worker/fault-run-driver-registry';

const DEFINITIONS = listScenarioDefinitions();
const CONTRACTS = DEFINITIONS.map((definition) => resolveScenarioContract(definition));
const CATALOG_REVISION = getCatalogRevision(DEFINITIONS);
const SOURCE_COMMIT_SHA = 'a'.repeat(40);
const REQUIRED_HEADINGS: readonly ScenarioRunbookHeadingId[] = [
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

function fixture(
  overrides: Partial<ScenarioContractValidationInput> = {},
): ScenarioContractValidationInput {
  const contracts = overrides.contracts ?? CONTRACTS;
  return {
    stage: 'PREFLIGHT',
    scope: 'STATIC_CONTRACT',
    catalogRevision: CATALOG_REVISION,
    sourceCommitSha: null,
    catalogScenarios: overrides.catalogScenarios ?? DEFINITIONS.map(({ scenario }) => scenario),
    dispatchCapabilities: makeDispatchFacts(contracts),
    targetFacts: makeTargetFacts(contracts),
    parameterValidationFacts: makeParameterValidationFacts(contracts),
    parameterGuardFacts: makeGuardFacts(contracts),
    evidenceTemplateIds: [...new Set(CONTRACTS.flatMap(
      (contract) => contract.evidence.recipes.map(({ template }) => template),
    ))],
    runbookFacts: contracts.map((contract) => ({
      scenario: contract.scenario,
      metadataPresent: true,
      metadataEntryCount: 1,
      targetService: contract.targetService,
      targetOperation: contract.targetOperation,
      locales: (['en', 'zh-CN'] as const).map((locale) => ({
        locale,
        allowlisted: true,
        contentAvailable: true,
        headingIds: REQUIRED_HEADINGS,
      })),
    })),
    i18nFacts: contracts.map((contract) => ({
      scenario: contract.scenario,
      scenarioMetaPresent: true,
      groupMembershipCount: 1,
      locales: (['en', 'zh-CN'] as const).map((locale) => ({
        locale,
        scenarioLabelPresent: true,
        scenarioDescriptionPresent: true,
        recoveryStrategyLabelPresent: true,
        groupLabelPresent: true,
        parameters: contract.parameters.map(({ name }) => ({
          name,
          labelPresent: true,
          descriptionPresent: true,
        })),
      })),
    })),
    alertConfiguration: makeAlertConfiguration(contracts),
    requiredCheckIds: [],
    checkResults: [],
    ...overrides,
    contracts,
  };
}

function makeDispatchFacts(
  contracts: readonly ResolvedScenarioContract[],
): ScenarioDispatchValidationDescriptor[] {
  return getFaultRunDriverDescriptors().map((descriptor) => ({
    name: descriptor.name,
    drainOwner: descriptor.drainOwner,
    supportedScenarios: contracts
      .filter((contract) => descriptor.supports(runForScenario(contract)))
      .map(({ scenario }) => scenario),
    executionState: descriptor.executionState,
    summaryEventType: descriptor.summaryEventType,
    terminalSummaryEvent: descriptor.terminalSummaryEvent,
    drainParticipantRegistered: true,
  }));
}

function runForScenario(contract: ResolvedScenarioContract): FaultRunRecord {
  const parameters: Record<string, number | string> = {};
  for (const parameter of contract.parameters) {
    if (parameter.default !== undefined) parameters[parameter.name] = parameter.default;
  }
  const timestamp = '2026-09-29T00:00:00.000Z';
  return {
    faultRunId: '123e4567-e89b-12d3-a456-426614174001',
    scenario: contract.scenario,
    targetService: contract.targetService,
    targetOperation: contract.targetOperation,
    state: 'ACTIVE',
    parameters,
    idempotencyKey: 'scenario-contract-validator-001',
    fencingToken: 1,
    startedAt: timestamp,
    expiresAt: '2030-01-01T00:00:00.000Z',
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'validator-fixture',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function makeParameterValidationFacts(
  contracts: readonly ResolvedScenarioContract[],
): ScenarioContractValidationInput['parameterValidationFacts'] {
  return contracts.map(({ scenario }) => {
    const definition = getScenarioDefinition(scenario);
    const parameters: Record<string, number | string> = {};
    for (const parameter of definition.parameters) {
      if (parameter.default !== undefined) parameters[parameter.name] = parameter.default;
    }
    validateScenarioParameters(scenario, parameters);
    return { scenario, status: 'PASSED' as const };
  });
}

function makeTargetFacts(
  contracts: readonly ResolvedScenarioContract[],
): ScenarioTargetContractFact[] {
  return contracts.map((contract) => {
    if (contract.targetLifecycleMode === 'LOCAL_WORKER') {
      const localTarget = getTrafficScenarioTarget(contract.scenario);
      return {
        scenario: contract.scenario,
        gateway: {
          status: 'ABSENT',
          service: null,
          operation: null,
          paths: { prepare: null, release: null, cleanup: null },
        },
        target: {
          status: 'NOT_APPLICABLE',
          service: null,
          operation: null,
          paths: { prepare: null, release: null, cleanup: null },
        },
        localWorker: {
          status: 'PASSED',
          scenario: contract.scenario,
          source: 'TRAFFIC_SCENARIO_TARGETS',
          service: contract.targetService,
          path: localTarget.path,
        },
        cleanupCapability: {
          status: 'NOT_APPLICABLE',
          policy: 'NONE',
          runScoped: false,
          fenced: false,
          confirmationSupported: false,
          actionOwnerVerified: false,
        },
      };
    }

    const paths = {
      prepare: contract.targetPrepare === 'REQUIRED'
        ? `/internal/${contract.targetOperation}/prepare`
        : null,
      release: contract.recoveryPolicy.targetRelease === 'REQUIRED'
        ? `/internal/${contract.targetOperation}/release`
        : null,
      cleanup: contract.recoveryPolicy.cleanup !== 'NONE'
        ? `/internal/${contract.targetOperation}/cleanup`
        : null,
    };
    return {
      scenario: contract.scenario,
      gateway: {
        status: 'PASSED',
        service: contract.targetService,
        operation: contract.targetOperation,
        paths,
      },
      target: {
        status: 'PASSED',
        service: contract.targetService,
        operation: contract.targetOperation,
        paths: { ...paths },
      },
      localWorker: {
        status: 'NOT_APPLICABLE',
        scenario: null,
        source: null,
        service: null,
        path: null,
      },
      cleanupCapability: contract.recoveryPolicy.cleanup === 'NONE'
        ? {
          status: 'NOT_APPLICABLE',
          policy: 'NONE',
          runScoped: false,
          fenced: false,
          confirmationSupported: false,
          actionOwnerVerified: false,
        }
        : {
          status: 'PASSED',
          policy: contract.recoveryPolicy.cleanup,
          runScoped: true,
          fenced: true,
          confirmationSupported: true,
          actionOwnerVerified: true,
        },
    };
  });
}

function makeGuardFacts(
  contracts: readonly ResolvedScenarioContract[],
): ScenarioParameterGuardFact[] {
  const facts: ScenarioParameterGuardFact[] = [];
  for (const contract of contracts) {
    for (const budget of contract.budgets) {
      if (budget.boundary.kind === 'CATALOG_RULE') {
        facts.push({
          scenario: contract.scenario,
          guardId: budget.boundary.ruleId,
          status: 'PASSED',
          parameterNames: [...budget.boundary.parameterNames],
        });
      } else if (budget.boundary.kind === 'TARGET_CAPACITY_GUARD') {
        const capacityBoundary = budget.boundary;
        const reserveParameter = contract.parameters.find(
          ({ name }) => name === capacityBoundary.reserveBytesParameter,
        );
        facts.push({
          scenario: contract.scenario,
          guardId: capacityBoundary.guardId,
          status: 'PASSED',
          parameterNames: ['totalBytes', 'minFreeBytes'],
          minimum: reserveParameter?.min,
          maximum: reserveParameter?.max,
        });
      }
    }

    if (contract.targetLifecycleMode === 'LOCAL_WORKER') {
      const concurrency = contract.parameters.find(({ name }) => name === 'concurrency');
      facts.push({
        scenario: contract.scenario,
        guardId: 'TRAFFIC_SURGE_MAX_CONCURRENCY',
        status: 'PASSED',
        parameterNames: ['concurrency'],
        minimum: concurrency?.min,
        maximum: concurrency?.max,
      });
    }
  }
  return facts;
}

function makeAlertConfiguration(
  contracts: readonly ResolvedScenarioContract[],
): ScenarioAlertConfigurationFacts {
  const alertRules = new Map<string, {
    severity: string;
    labelNames: Set<string>;
    services: Set<string>;
  }>();
  for (const contract of contracts) {
    if (contract.alert.expectation === 'NOT_EXPECTED') continue;
    for (const alert of contract.alert.allowedAlerts) {
      const existing = alertRules.get(alert.alertName) ?? {
        severity: alert.severity,
        labelNames: new Set<string>(['service']),
        services: new Set<string>(),
      };
      Object.keys(alert.requiredLabels).forEach((name) => existing.labelNames.add(name));
      alert.incidentKeyLabels.forEach((name) => existing.labelNames.add(name));
      existing.services.add(alert.service);
      alertRules.set(alert.alertName, existing);
    }
  }

  const rules = [...alertRules.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([alertName, value]) => ({
      alertName,
      severity: value.severity,
      staticLabels: { severity: value.severity },
      outputLabelNames: [...value.labelNames].sort(),
      serviceLabelName: 'service',
      forSeconds: 60,
      groupIntervalSeconds: 30,
      expressionSha256: 'c'.repeat(64),
    }));
  const serviceLabelValues = [...new Set([
    ...contracts.map(({ targetService }) => targetService),
    ...[...alertRules.values()].flatMap(({ services }) => [...services]),
  ])].sort();
  const prometheus = (['COMPOSE', 'KUBERNETES'] as const).map((variant) => ({
    variant,
    serviceLabelValues,
    rules,
  }));
  const alertmanager = (['COMPOSE', 'KUBERNETES'] as const).map((variant) => ({
    variant,
    internalReceipt: {
      routeConfigured: true,
      receiverConfigured: true,
      receiptPolicyId: 'alert-receipt.v1',
      sendResolved: true,
      routeTreeSha256: 'd'.repeat(64),
    },
    externalAgent: {
      childRouteConfigured: false,
      receiverConfigured: false,
      childRouteName: null,
      receiverName: null,
      credentialSource: null,
      sendResolved: null,
      routeTreeSha256: null,
    },
  }));
  return {
    prometheus,
    alertmanager,
    agentDeliveryReadiness: { state: 'NOT_ENABLED_YET' },
  };
}

function replaceScenario(
  scenario: ResolvedScenarioContract['scenario'],
  update: (contract: ResolvedScenarioContract) => ResolvedScenarioContract,
): ResolvedScenarioContract[] {
  return CONTRACTS.map((contract) => (
    contract.scenario === scenario ? update(structuredClone(contract)) : structuredClone(contract)
  ));
}

function scenarioContract(
  scenario: ResolvedScenarioContract['scenario'],
  contracts: readonly ResolvedScenarioContract[] = CONTRACTS,
): ResolvedScenarioContract {
  const contract = contracts.find((candidate) => candidate.scenario === scenario);
  assert.ok(contract);
  return contract;
}

function scenarioIndex(
  facts: readonly { readonly scenario: ResolvedScenarioContract['scenario'] }[],
  scenario: ResolvedScenarioContract['scenario'],
): number {
  const index = facts.findIndex((fact) => fact.scenario === scenario);
  assert.notEqual(index, -1);
  return index;
}

function assertIssue(
  report: ReturnType<typeof validateScenarioContracts>,
  category: string,
  scenario?: ResolvedScenarioContract['scenario'],
): void {
  assert.ok(
    report.blockingIssues.some((issue) => (
      issue.category === category && (scenario === undefined || issue.scenario === scenario)
    )),
    `Expected ${category} issue for ${scenario ?? 'the report'}`,
  );
}

test('validates all resolved contracts deterministically without claiming release validity', () => {
  const input = fixture();
  const before = structuredClone(input);
  const report = validateScenarioContracts(input);

  assert.equal(report.schemaVersion, SCENARIO_CONTRACT_REPORT_SCHEMA_VERSION);
  assert.equal(report.stage, 'PREFLIGHT');
  assert.equal(report.scope, 'STATIC_CONTRACT');
  assert.equal(report.status, 'VALID', JSON.stringify(report.blockingIssues));
  assert.deepEqual(report.blockingIssues, []);
  assert.deepEqual(report.scenarios.map(({ scenario }) => scenario), [...report.scenarios]
    .map(({ scenario }) => scenario)
    .sort());
  assert.equal('releaseValid' in report, false);
  assert.deepEqual(input, before);
  assert.deepEqual(validateScenarioContracts(input), report);
});

test('blocks when an authoritative Catalog scenario has no resolved contract', () => {
  const input = fixture();
  const contracts = input.contracts.filter(({ scenario }) => scenario !== 'PSP_PROVIDER_OUTCOME');

  const report = validateScenarioContracts({ ...input, contracts });

  assertIssue(report, 'invalidParameters', 'PSP_PROVIDER_OUTCOME');
  assert.equal(
    report.scenarios.find(({ scenario }) => scenario === 'PSP_PROVIDER_OUTCOME')?.status,
    'BLOCKED',
  );
});

test('reports missing target mappings and keeps local Worker bypass separate from Gateway', () => {
  const input = fixture();
  const targetFacts = [...input.targetFacts];
  const browseIndex = scenarioIndex(targetFacts, 'BROWSE_SURGE');
  const browseTarget = targetFacts[browseIndex];
  assert.ok(browseTarget);
  targetFacts[browseIndex] = {
    ...browseTarget,
    gateway: { ...browseTarget.gateway, status: 'PASSED', operation: 'wrong-operation' },
  };
  const missingTarget = validateScenarioContracts({ ...input, targetFacts });
  assertIssue(missingTarget, 'missingTarget', 'BROWSE_SURGE');

  const surge = input.targetFacts[scenarioIndex(input.targetFacts, 'BROWSE_SURGE')];
  assert.ok(surge);
  assert.equal(surge.gateway.status, 'ABSENT');
  assert.equal(surge.localWorker.status, 'PASSED');
  const report = validateScenarioContracts(input);
  assert.equal(report.blockingIssues.some((issue) => (
    issue.category === 'missingTarget' && issue.scenario === 'BROWSE_SURGE'
  )), false);

  const unsafeLocalTargetFacts = [...input.targetFacts];
  const unsafeIndex = scenarioIndex(unsafeLocalTargetFacts, 'BROWSE_SURGE');
  const unsafeTarget = unsafeLocalTargetFacts[unsafeIndex];
  assert.ok(unsafeTarget);
  unsafeLocalTargetFacts[unsafeIndex] = {
    ...unsafeTarget,
    localWorker: { ...unsafeTarget.localWorker, path: 'https://untrusted.invalid/api/products' },
  };
  assertIssue(
    validateScenarioContracts({ ...input, targetFacts: unsafeLocalTargetFacts }),
    'missingTarget',
    'BROWSE_SURGE',
  );
});

test('reports missing, duplicate, and orphan driver capabilities', () => {
  const input = fixture();
  const missing = input.dispatchCapabilities.filter((descriptor) => (
    !descriptor.supportedScenarios.includes('BROWSE_SURGE')
  ));
  assertIssue(
    validateScenarioContracts({ ...input, dispatchCapabilities: missing }),
    'missingDispatch',
    'BROWSE_SURGE',
  );

  const incompleteSummary = input.dispatchCapabilities.map((descriptor) => (
    descriptor.supportedScenarios.includes('BROWSE_SURGE')
      ? { ...descriptor, summaryEventType: 'SCENARIO_WORKER_STARTED' }
      : descriptor
  ));
  assertIssue(
    validateScenarioContracts({ ...input, dispatchCapabilities: incompleteSummary }),
    'missingDispatch',
    'BROWSE_SURGE',
  );

  const surgeDriver = input.dispatchCapabilities.find((descriptor) => (
    descriptor.supportedScenarios.includes('BROWSE_SURGE')
  ));
  assert.ok(surgeDriver);
  const duplicated = validateScenarioContracts({
    ...input,
    dispatchCapabilities: [...input.dispatchCapabilities, structuredClone(surgeDriver)],
  });
  assertIssue(duplicated, 'missingDispatch', 'BROWSE_SURGE');
  assertIssue(duplicated, 'missingDispatch');

  const startedEventDescriptor = input.dispatchCapabilities.map((descriptor) => (
    descriptor.supportedScenarios.includes('BROWSE_SURGE')
      ? { ...descriptor, summaryEventType: 'SCENARIO_WORKER_STARTED' }
      : descriptor
  ));
  assertIssue(
    validateScenarioContracts({ ...input, dispatchCapabilities: startedEventDescriptor }),
    'missingDispatch',
    'BROWSE_SURGE',
  );

  const orphaned = validateScenarioContracts({
    ...input,
    dispatchCapabilities: [...input.dispatchCapabilities, {
      name: 'ORPHAN_DRIVER',
      drainOwner: 'ORPHAN_DRIVER',
      supportedScenarios: [],
      executionState: 'ACTIVE_ONLY',
      summaryEventType: 'SCENARIO_WORKER_STOPPED',
      terminalSummaryEvent: 'DRAIN_COMPLETED',
      drainParticipantRegistered: true,
    }],
  });
  assertIssue(orphaned, 'missingDispatch');
});

test('rejects malformed parameter definitions and consumer coverage', () => {
  const contracts = replaceScenario('BROWSE_SURGE', (contract) => ({
    ...contract,
    parameters: [...contract.parameters, structuredClone(contract.parameters[1]!)],
  }));
  const report = validateScenarioContracts(fixture({ contracts }));
  assertIssue(report, 'invalidParameters', 'BROWSE_SURGE');

  const missingConsumer = replaceScenario('PSP_PROVIDER_OUTCOME', (contract) => ({
    ...contract,
    parameterConsumers: {
      ...contract.parameterConsumers,
      providerOutcome: ['ADMISSION'],
    },
  }));
  assertIssue(
    validateScenarioContracts(fixture({ contracts: missingConsumer })),
    'invalidParameters',
    'PSP_PROVIDER_OUTCOME',
  );

  const invalidDuration = replaceScenario('BROWSE_SURGE', (contract) => ({
    ...contract,
    parameters: contract.parameters.map((parameter) => (
      parameter.name === 'durationSec' ? { ...parameter, max: 100 } : parameter
    )),
  }));
  assertIssue(
    validateScenarioContracts(fixture({ contracts: invalidDuration })),
    'invalidParameters',
    'BROWSE_SURGE',
  );

  const withoutParameterTest = fixture();
  assertIssue(
    validateScenarioContracts({
      ...withoutParameterTest,
      parameterValidationFacts: withoutParameterTest.parameterValidationFacts
        .filter(({ scenario }) => scenario !== 'BROWSE_SURGE'),
    }),
    'invalidParameters',
    'BROWSE_SURGE',
  );
});

test('rejects resource guard and disposable heap exception misuse', () => {
  const input = fixture();
  const heapContracts = replaceScenario('NOTIFICATION_HEAP_PRESSURE', (contract) => ({
    ...contract,
    budgets: contract.budgets.map((budget) => (
      budget.boundary.kind === 'APPROVED_NON_RELEASING_EXCEPTION'
        ? {
          ...budget,
          boundary: {
            ...budget.boundary,
            allowedEnvironment: 'RETAINED' as never,
          },
        }
        : budget
    )),
  }));
  assertIssue(
    validateScenarioContracts(fixture({ contracts: heapContracts })),
    'invalidParameters',
    'NOTIFICATION_HEAP_PRESSURE',
  );

  const storageIndex = scenarioIndex(input.parameterGuardFacts, 'NOTIFICATION_STORAGE_APPEND');
  const storageGuard = input.parameterGuardFacts[storageIndex];
  assert.ok(storageGuard);
  const parameterGuardFacts = [...input.parameterGuardFacts];
  parameterGuardFacts[storageIndex] = { ...storageGuard, maximum: (storageGuard.maximum ?? 0) + 1 };
  assertIssue(
    validateScenarioContracts({ ...input, parameterGuardFacts }),
    'invalidParameters',
    'NOTIFICATION_STORAGE_APPEND',
  );

  assertIssue(
    validateScenarioContracts({ ...input, deploymentScope: 'retained' }),
    'invalidParameters',
    'NOTIFICATION_HEAP_PRESSURE',
  );

  const invalidSurgeLimit = replaceScenario('BROWSE_SURGE', (contract) => ({
    ...contract,
    parameters: contract.parameters.map((parameter) => (
      parameter.name === 'concurrency' ? { ...parameter, max: 129 } : parameter
    )),
  }));
  assertIssue(
    validateScenarioContracts(fixture({ contracts: invalidSurgeLimit })),
    'invalidParameters',
    'BROWSE_SURGE',
  );

  for (const [parameterName, bound, value] of [
    ['minFreeBytes', 'min', NOTIFICATION_STORAGE_MIN_FREE_BYTES - 1],
    ['minFreeBytes', 'max', NOTIFICATION_STORAGE_MAX_FREE_BYTES + 1],
  ] as const) {
    const contracts = replaceScenario('NOTIFICATION_STORAGE_APPEND', (contract) => ({
      ...contract,
      parameters: contract.parameters.map((parameter) => (
        parameter.name === parameterName ? { ...parameter, [bound]: value } : parameter
      )),
    }));
    assertIssue(
      validateScenarioContracts(fixture({ contracts })),
      'invalidParameters',
      'NOTIFICATION_STORAGE_APPEND',
    );
  }
});

test('rejects invalid Evidence windows, unsupported templates, and effectRule references', () => {
  const invalidWindow = replaceScenario('BROWSE_SURGE', (contract) => ({
    ...contract,
    evidence: {
      ...contract.evidence,
      windows: { ...contract.evidence.windows, activeLeadSec: -1 },
    },
  }));
  assertIssue(
    validateScenarioContracts(fixture({ contracts: invalidWindow })),
    'missingEvidenceQuery',
    'BROWSE_SURGE',
  );

  const invalidTemplate = replaceScenario('ORDER_QUERY_SURGE', (contract) => ({
    ...contract,
    evidence: {
      ...contract.evidence,
      recipes: contract.evidence.recipes.map((recipe, index) => (
        index === 0 ? { ...recipe, template: 'ARBITRARY_QUERY' as never } : recipe
      )),
    },
  }));
  assertIssue(
    validateScenarioContracts(fixture({ contracts: invalidTemplate })),
    'missingEvidenceQuery',
    'ORDER_QUERY_SURGE',
  );

  const invalidEffectRule = replaceScenario('CART_CATALOG_DEPENDENCY', (contract) => ({
    ...contract,
    evidence: {
      ...contract.evidence,
      effectRule: { ...contract.evidence.effectRule, recipeIds: ['missing-recipe'] },
    },
  }));
  assertIssue(
    validateScenarioContracts(fixture({ contracts: invalidEffectRule })),
    'missingEvidenceQuery',
    'CART_CATALOG_DEPENDENCY',
  );

  const controlEventAsEffect = replaceScenario('BROWSE_REPORT_SQL', (contract) => {
    const activeTimeline = contract.evidence.recipes.find((recipe) => (
      recipe.source === 'RUN_EVENT' && recipe.window === 'active'
    ));
    assert.ok(activeTimeline);
    return {
      ...contract,
      evidence: {
        ...contract.evidence,
        effectRule: { ...contract.evidence.effectRule, recipeIds: [activeTimeline.id] },
      },
      lifecycle: {
        ...contract.lifecycle,
        sideEffectRecipeIds: [activeTimeline.id],
      },
    };
  });
  assertIssue(
    validateScenarioContracts(fixture({ contracts: controlEventAsEffect })),
    'missingEvidenceQuery',
    'BROWSE_REPORT_SQL',
  );

  const arbitraryQuery = replaceScenario('BROWSE_SURGE', (contract) => ({
    ...contract,
    evidence: {
      ...contract.evidence,
      recipes: contract.evidence.recipes.map((recipe, index) => (
        index === 0
          ? { ...recipe, query: 'arbitrary datasource query' } as unknown as typeof recipe
          : recipe
      )),
    },
  }));
  assertIssue(
    validateScenarioContracts(fixture({ contracts: arbitraryQuery })),
    'missingEvidenceQuery',
    'BROWSE_SURGE',
  );
});

test('requires the approved 900-second alert correlation timing', () => {
  const contracts = replaceScenario('BROWSE_SURGE', (contract) => {
    if (contract.alert.expectation === 'NOT_EXPECTED') return contract;
    return {
      ...contract,
      alert: {
        ...contract.alert,
        allowedAlerts: contract.alert.allowedAlerts.map((alert) => ({
          ...alert,
          recentGraceAfterSec: alert.recentGraceAfterSec - 1,
        })),
      },
    };
  });

  assertIssue(
    validateScenarioContracts(fixture({ contracts })),
    'invalidAlertContract',
    'BROWSE_SURGE',
  );
});

test('keeps release, business recovery, and cleanup hooks distinct', () => {
  const releaseMismatch = replaceScenario('NOTIFICATION_STORAGE_APPEND', (contract) => ({
    ...contract,
    recoveryPolicy: { ...contract.recoveryPolicy, targetRelease: 'NOT_APPLICABLE' },
  }));
  assertIssue(
    validateScenarioContracts(fixture({ contracts: releaseMismatch })),
    'invalidRecoveryHook',
    'NOTIFICATION_STORAGE_APPEND',
  );

  const cleanupMismatch = replaceScenario('CATALOG_REDIS_LARGE_VALUE', (contract) => ({
    ...contract,
    lifecycle: { ...contract.lifecycle, cleanupActionTypes: [] },
  }));
  const cleanupReport = validateScenarioContracts(fixture({ contracts: cleanupMismatch }));
  assertIssue(cleanupReport, 'invalidRecoveryHook', 'CATALOG_REDIS_LARGE_VALUE');

  const input = fixture();
  const targetFacts = [...input.targetFacts];
  const targetIndex = scenarioIndex(targetFacts, 'CATALOG_REDIS_LARGE_VALUE');
  const target = targetFacts[targetIndex];
  assert.ok(target);
  targetFacts[targetIndex] = {
    ...target,
    cleanupCapability: {
      ...target.cleanupCapability,
      policy: 'SCENARIO_WIDE',
    },
  };
  const targetCleanupMismatch = validateScenarioContracts({ ...input, targetFacts });
  assertIssue(targetCleanupMismatch, 'invalidRecoveryHook', 'CATALOG_REDIS_LARGE_VALUE');
  assert.ok(targetCleanupMismatch.blockingIssues.some(
    (issue) => issue.code === 'RECOVERY_POLICY_HOOK_MISMATCH',
  ));

  const controlEvidenceInRecovery = replaceScenario('INVENTORY_ROW_LOCK', (contract) => {
    const recoveryTimeline = contract.evidence.recipes.find((recipe) => (
      recipe.source === 'RUN_EVENT' && recipe.window === 'recovery'
    ));
    assert.ok(recoveryTimeline);
    return {
      ...contract,
      lifecycle: {
        ...contract.lifecycle,
        recoveryRecipeIds: [...contract.lifecycle.recoveryRecipeIds, recoveryTimeline.id],
      },
    };
  });
  assertIssue(
    validateScenarioContracts(fixture({ contracts: controlEvidenceInRecovery })),
    'invalidRecoveryHook',
    'INVENTORY_ROW_LOCK',
  );
});

test('requires bilingual allowlisted runbook metadata and required headings', () => {
  const input = fixture();
  const runbookFacts = [...input.runbookFacts];
  const index = scenarioIndex(runbookFacts, 'ORDER_REPORT_SQL');
  const fact = runbookFacts[index];
  assert.ok(fact);
  runbookFacts[index] = {
    ...fact,
    locales: fact.locales.map((locale) => (
      locale.locale === 'zh-CN'
        ? { ...locale, headingIds: locale.headingIds.filter((heading) => heading !== 'ALERTS') }
        : locale
    )),
  };
  assertIssue(
    validateScenarioContracts({ ...input, runbookFacts }),
    'missingRunbook',
    'ORDER_REPORT_SQL',
  );
});

test('requires bilingual i18n coverage and exactly one scenario group', () => {
  const input = fixture();
  const i18nFacts = [...input.i18nFacts];
  const index = scenarioIndex(i18nFacts, 'PSP_PROVIDER_OUTCOME');
  const fact = i18nFacts[index];
  assert.ok(fact);
  i18nFacts[index] = {
    ...fact,
    groupMembershipCount: 2,
    locales: fact.locales.map((locale) => (
      locale.locale === 'en'
        ? { ...locale, parameters: locale.parameters.map((parameter) => (
          parameter.name === 'providerOutcome'
            ? { ...parameter, descriptionPresent: false }
            : parameter
        )) }
        : locale
    )),
  };
  assertIssue(
    validateScenarioContracts({ ...input, i18nFacts }),
    'missingI18n',
    'PSP_PROVIDER_OUTCOME',
  );
});

test('rejects alert contract/config mismatches and enabled Agent routes without a receiver', () => {
  const input = fixture();
  const alertConfiguration = structuredClone(input.alertConfiguration);
  const compose = alertConfiguration.prometheus.find(({ variant }) => variant === 'COMPOSE');
  assert.ok(compose);
  const alertContract = scenarioContract('BROWSE_SURGE').alert;
  assert.equal(alertContract.expectation, 'CONDITIONAL');
  const expectedRule = compose.rules.find(({ alertName }) => (
    alertName === alertContract.allowedAlerts[0]?.alertName
  ));
  assert.ok(expectedRule);
  const prometheus = alertConfiguration.prometheus.map((deployment) => (
    deployment.variant === 'COMPOSE'
      ? {
        ...deployment,
        rules: deployment.rules.map((rule) => (
          rule.alertName === expectedRule.alertName
            ? { ...rule, severity: 'critical' }
            : rule
        )),
      }
      : deployment
  ));
  assertIssue(
    validateScenarioContracts({ ...input, alertConfiguration: { ...alertConfiguration, prometheus } }),
    'invalidAlertContract',
    'BROWSE_SURGE',
  );

  const missingAlertFieldConfig: ScenarioAlertConfigurationFacts = {
    ...input.alertConfiguration,
    prometheus: input.alertConfiguration.prometheus.map((deployment) => ({
      ...deployment,
      rules: deployment.rules.map((rule) => (
        rule.alertName === expectedRule.alertName
          ? { ...rule, outputLabelNames: rule.outputLabelNames.filter((name) => name !== 'uri') }
          : rule
      )),
    })),
  };
  assertIssue(
    validateScenarioContracts({ ...input, alertConfiguration: missingAlertFieldConfig }),
    'invalidAlertContract',
    'BROWSE_SURGE',
  );

  const badInternalReceipt = structuredClone(input.alertConfiguration);
  const badInternalConfig: ScenarioAlertConfigurationFacts = {
    ...badInternalReceipt,
    alertmanager: badInternalReceipt.alertmanager.map((deployment) => ({
      ...deployment,
      internalReceipt: { ...deployment.internalReceipt, sendResolved: false },
    })),
  };
  assertIssue(
    validateScenarioContracts({ ...input, alertConfiguration: badInternalConfig }),
    'invalidAlertContract',
  );

  const enabledConfig = structuredClone(input.alertConfiguration);
  const enabledAgentConfig: ScenarioAlertConfigurationFacts = {
    ...enabledConfig,
    agentDeliveryReadiness: {
      state: 'ENABLED',
      childRouteName: 'castrel-agent',
      externalReceiverName: 'castrel-agent-receiver',
      credentialSource: 'DEPLOYMENT_MANAGED_SECRET',
      sendResolved: false,
    },
    alertmanager: enabledConfig.alertmanager.map((deployment) => ({
      ...deployment,
      externalAgent: {
        ...deployment.externalAgent,
        childRouteConfigured: true,
        receiverConfigured: false,
        childRouteName: 'castrel-agent',
        receiverName: 'castrel-agent-receiver',
        credentialSource: 'DEPLOYMENT_MANAGED_SECRET',
        sendResolved: false,
        routeTreeSha256: 'e'.repeat(64),
      },
    })),
  };
  assertIssue(
    validateScenarioContracts({ ...input, alertConfiguration: enabledAgentConfig }),
    'invalidAlertContract',
  );
});

test('keeps NOT_ENABLED_YET as static readiness and separates unavailable evidence', () => {
  const staticReport = validateScenarioContracts(fixture());
  assert.equal(staticReport.status, 'VALID');
  assert.ok(staticReport.readinessNotes.some((note) => note.code === 'AGENT_DELIVERY_NOT_ENABLED'));
  assert.equal(staticReport.blockingIssues.some((issue) => issue.category === 'invalidAlertContract'), false);

  const input = fixture({
    scope: 'DISPOSABLE_CANARY',
    deploymentScope: 'disposable',
    coverageFacts: CONTRACTS.map(({ scenario }) => ({
      scenario,
      status: scenario === 'BROWSE_SURGE' ? 'EVIDENCE_UNAVAILABLE' : 'COVERED',
    })),
  });
  const report = validateScenarioContracts(input);
  assert.equal(report.status, 'LIMITED');
  assert.ok(report.readinessNotes.some((note) => (
    note.code === 'EVIDENCE_UNAVAILABLE' && note.scenario === 'BROWSE_SURGE'
  )));
  assert.equal(report.blockingIssues.some((issue) => issue.category === 'missingEvidenceQuery'), false);

  const failedCoverage = validateScenarioContracts(fixture({
    scope: 'LIVE_SCENARIO_MATRIX',
    coverageFacts: CONTRACTS.map(({ scenario }) => ({
      scenario,
      status: scenario === 'BROWSE_SURGE' ? 'FAILED' as const : 'COVERED' as const,
    })),
  }));
  assert.equal(failedCoverage.status, 'BLOCKED');
  assert.equal(failedCoverage.scenarios.find(
    ({ scenario }) => scenario === 'BROWSE_SURGE',
  )?.status, 'BLOCKED');
  assert.ok(failedCoverage.readinessNotes.some(
    (note) => note.code === 'SCENARIO_COVERAGE_FAILED' && note.scenario === 'BROWSE_SURGE',
  ));

  const requiredAgentReport = validateScenarioContracts({
    ...input,
    requireAgentDeliveryLive: true,
    coverageFacts: CONTRACTS.map(({ scenario }) => ({ scenario, status: 'COVERED' })),
  });
  assert.equal(requiredAgentReport.status, 'LIMITED');
  assert.ok(requiredAgentReport.readinessNotes.some(
    (note) => note.code === 'AGENT_DELIVERY_LIVE_COVERAGE_MISSING',
  ));
});

test('sorts diagnostics and check rows, and blocks final reports on check drift', () => {
  const input = fixture();
  const targetFacts = [...input.targetFacts];
  const targetIndex = scenarioIndex(targetFacts, 'BROWSE_SURGE');
  const target = targetFacts[targetIndex];
  assert.ok(target);
  targetFacts[targetIndex] = {
    ...target,
    localWorker: { ...target.localWorker, status: 'MISSING' },
  };
  const runbookFacts = [...input.runbookFacts];
  const runbookIndex = scenarioIndex(runbookFacts, 'ORDER_REPORT_SQL');
  const runbook = runbookFacts[runbookIndex];
  assert.ok(runbook);
  runbookFacts[runbookIndex] = { ...runbook, metadataPresent: false };
  const disorderly = {
    ...input,
    contracts: [...input.contracts].reverse(),
    targetFacts,
    runbookFacts,
  };
  const reversed = {
    ...disorderly,
    contracts: [...disorderly.contracts].reverse(),
    targetFacts: [...disorderly.targetFacts].reverse(),
    runbookFacts: [...disorderly.runbookFacts].reverse(),
  };
  const report = validateScenarioContracts(disorderly);
  assert.deepEqual(report, validateScenarioContracts(reversed));
  assert.deepEqual(
    report.blockingIssues.map(({ category }) => category),
    [...report.blockingIssues.map(({ category }) => category)].sort(),
  );

  const finalBase = {
    ...input,
    stage: 'FINAL' as const,
    sourceCommitSha: SOURCE_COMMIT_SHA,
    requiredCheckIds: ['TS', 'JAVA'],
    checkResults: [{
      checkId: 'TS',
      status: 'PASSED' as const,
      catalogRevision: CATALOG_REVISION,
      sourceCommitSha: SOURCE_COMMIT_SHA,
    }],
  };
  const missingCheckReport = validateScenarioContracts(finalBase);
  assert.equal(missingCheckReport.status, 'BLOCKED');
  assert.deepEqual(missingCheckReport.requiredChecks
    .filter(({ checkId }) => ['JAVA', 'TS'].includes(checkId))
    .map(({ checkId, status }) => (
    [checkId, status]
  )), [['JAVA', 'MISSING'], ['TS', 'PASSED']]);

  const driftedReport = validateScenarioContracts({
    ...finalBase,
    checkResults: [
      ...finalBase.checkResults,
      {
        checkId: 'JAVA',
        status: 'PASSED',
        catalogRevision: 'b'.repeat(64),
        sourceCommitSha: 'f'.repeat(40),
      },
    ],
  });
  assert.equal(driftedReport.status, 'BLOCKED');
  assert.equal(driftedReport.requiredChecks.find(({ checkId }) => checkId === 'JAVA')?.status, 'FAILED');

  const allPassedReport = validateScenarioContracts({
    ...finalBase,
    checkResults: [
      ...finalBase.checkResults,
      {
        checkId: 'JAVA',
        status: 'PASSED',
        catalogRevision: CATALOG_REVISION,
        sourceCommitSha: SOURCE_COMMIT_SHA,
      },
    ],
  });
  assert.equal(allPassedReport.status, 'VALID');
});

test('does not echo arbitrary source text, paths, credentials, or payloads', () => {
  const input = fixture();
  const targetFacts = [...input.targetFacts];
  const index = scenarioIndex(targetFacts, 'BROWSE_SURGE');
  const fact = targetFacts[index];
  assert.ok(fact);
  targetFacts[index] = {
    ...fact,
    gateway: {
      ...fact.gateway,
      operation: 'Authorization: Bearer sample-secret; SELECT customer_data FROM orders',
    },
  };
  const report = validateScenarioContracts({
    ...input,
    targetFacts,
    sourceCommitSha: 'not-a-commit-/Users/raven',
    stage: 'FINAL',
    requiredCheckIds: ['../../private/secret'],
  });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('sample-secret'), false);
  assert.equal(serialized.includes('customer_data'), false);
  assert.equal(serialized.includes('/Users/raven'), false);
  assert.equal(serialized.includes('../../private/secret'), false);
  assert.equal(serialized.includes('INVALID_CHECK_ID'), true);
});

test('preflight status is scoped and does not replace final required checks', () => {
  const report = validateScenarioContracts(fixture());
  assert.equal(report.stage, 'PREFLIGHT');
  assert.equal(report.scope, 'STATIC_CONTRACT');
  assert.equal(report.status, 'VALID');
  assert.equal(report.requiredChecks.find(
    ({ checkId }) => checkId === 'scenario-contract.catalog-revision',
  )?.status, 'PASSED');
  assert.equal('releaseValid' in report, false);

  const missingPreflightCheck = validateScenarioContracts(fixture({
    requiredCheckIds: ['TYPECHECK'],
  }));
  assert.equal(missingPreflightCheck.status, 'BLOCKED');
  assert.equal(missingPreflightCheck.requiredChecks.find(
    ({ checkId }) => checkId === 'TYPECHECK',
  )?.status, 'MISSING');

  const invalidRevision = validateScenarioContracts(fixture({ catalogRevision: 'invalid' }));
  assert.equal(invalidRevision.status, 'BLOCKED');
  assert.equal(invalidRevision.requiredChecks.find(
    ({ checkId }) => checkId === 'scenario-contract.catalog-revision',
  )?.status, 'FAILED');

  const finalWithoutCheckPlan = validateScenarioContracts(fixture({
    stage: 'FINAL',
    sourceCommitSha: SOURCE_COMMIT_SHA,
  }));
  assert.equal(finalWithoutCheckPlan.status, 'BLOCKED');
  assert.equal(finalWithoutCheckPlan.requiredChecks.find(
    ({ checkId }) => checkId === 'scenario-contract.required-check-plan',
  )?.status, 'MISSING');
});

test('reports check failures, invalid revisions, and missing commit identity as blocked', () => {
  const input = fixture({
    stage: 'FINAL',
    sourceCommitSha: SOURCE_COMMIT_SHA,
    requiredCheckIds: ['TYPECHECK'],
  });
  const failed = validateScenarioContracts({
    ...input,
    checkResults: [{
      checkId: 'TYPECHECK',
      status: 'FAILED',
      catalogRevision: CATALOG_REVISION,
      sourceCommitSha: SOURCE_COMMIT_SHA,
    }],
  });
  assert.equal(failed.status, 'BLOCKED');

  const invalidRevision = validateScenarioContracts({
    ...input,
    catalogRevision: 'invalid',
    checkResults: [{
      checkId: 'TYPECHECK',
      status: 'PASSED',
      catalogRevision: 'invalid',
      sourceCommitSha: SOURCE_COMMIT_SHA,
    }],
  });
  assert.equal(invalidRevision.status, 'BLOCKED');

  const revisionMismatch = validateScenarioContracts({
    ...input,
    checkResults: [{
      checkId: 'TYPECHECK',
      status: 'PASSED',
      catalogRevision: 'b'.repeat(64),
      sourceCommitSha: SOURCE_COMMIT_SHA,
    }],
  });
  assert.equal(revisionMismatch.status, 'BLOCKED');
  assert.equal(revisionMismatch.requiredChecks[0]?.status, 'FAILED');

  const commitMismatch = validateScenarioContracts({
    ...input,
    checkResults: [{
      checkId: 'TYPECHECK',
      status: 'PASSED',
      catalogRevision: CATALOG_REVISION,
      sourceCommitSha: 'f'.repeat(40),
    }],
  });
  assert.equal(commitMismatch.status, 'BLOCKED');
  assert.equal(commitMismatch.requiredChecks[0]?.status, 'FAILED');

  const missingCommit = validateScenarioContracts({
    ...input,
    sourceCommitSha: null,
    checkResults: [{
      checkId: 'TYPECHECK',
      status: 'PASSED',
      catalogRevision: CATALOG_REVISION,
      sourceCommitSha: null,
    }],
  });
  assert.equal(missingCommit.status, 'BLOCKED');
});
