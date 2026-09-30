import {
  ALERT_RECEIPT_POLICY_ID,
  getEvidenceContractHash,
  getScenarioContractRevision,
  type ResolvedScenarioContract,
} from './scenario-contract';
import type { FaultRunScenario } from './fault-run-catalog';
import {
  SCENARIO_CONTRACT_REQUIRED_RUNBOOK_HEADINGS,
  validateScenarioContracts,
  type ScenarioContractValidationInput,
  type ScenarioContractValidationReport,
} from './scenario-contract-validator';

export const SCENARIO_CONTRACT_ARTIFACT_SCHEMA_VERSION = 'scenario-contract-artifacts.v1' as const;
export const SCENARIO_CONTRACT_MANIFEST_SCHEMA_VERSION = 'scenario-contract-manifest.v1' as const;
export const SCENARIO_CONTRACT_FORM_SCHEMA_VERSION = 'scenario-contract-form.v1' as const;
export const SCENARIO_CONTRACT_RUNBOOK_CHECKLIST_SCHEMA_VERSION = 'scenario-contract-runbook-checklist.v1' as const;
export const SCENARIO_CONTRACT_SMOKE_MATRIX_SCHEMA_VERSION = 'scenario-contract-smoke-matrix.v1' as const;
export const SCENARIO_CONTRACT_TERMINOLOGY_SCHEMA_VERSION = 'scenario-contract-terminology.v1' as const;
export const SCENARIO_CONTRACT_TEST_SCAFFOLD_SCHEMA_VERSION = 'scenario-contract-test-scaffold.v1' as const;

export const SCENARIO_CONTRACT_REVIEWED_RUNTIME_TERM_PATTERNS = [
  '故障注入',
  '故障演练',
  '故障场景',
  '场景码',
  'fault[ -]?injection',
  'fault[ -]?exercise',
  'fault[ -]?scenario',
  'chaos[ -]?scenario',
  'fault[ -]?run',
  'faultRunId',
  'fault_run_id',
  'recovery[_-]?result',
  'recovery[_-]?error',
] as const;

export interface ScenarioContractRunbookArticleFact {
  readonly scenario: FaultRunScenario;
  readonly articleFile: string;
}

export interface ScenarioContractTerminologyInput {
  readonly schemaVersion: typeof SCENARIO_CONTRACT_TERMINOLOGY_SCHEMA_VERSION;
  readonly scenarioIds: readonly FaultRunScenario[];
  readonly scenarioIdPatterns: readonly string[];
  readonly reviewedTermPatterns: typeof SCENARIO_CONTRACT_REVIEWED_RUNTIME_TERM_PATTERNS;
}

export interface ScenarioContractRunbookChecklist {
  readonly schemaVersion: typeof SCENARIO_CONTRACT_RUNBOOK_CHECKLIST_SCHEMA_VERSION;
  readonly scenarios: readonly {
    readonly scenario: FaultRunScenario;
    readonly articleFile: string | null;
    readonly targetService: string;
    readonly targetOperation: string;
    readonly requiredHeadings: typeof SCENARIO_CONTRACT_REQUIRED_RUNBOOK_HEADINGS;
    readonly lifecycle: {
      readonly prepareEventTypes: readonly string[];
      readonly activeEffectRecipeIds: readonly string[];
      readonly stopEventTypes: readonly string[];
      readonly targetRelease: string;
      readonly cleanupPolicy: string;
      readonly cleanupActionTypes: readonly string[];
      readonly recoveryRecipeIds: readonly string[];
      readonly evidenceRecipeIds: readonly string[];
      readonly alertSectionRequired: true;
      readonly receiptPolicyId: string;
    };
  }[];
}

export interface ScenarioContractArtifactBundle {
  readonly schemaVersion: typeof SCENARIO_CONTRACT_ARTIFACT_SCHEMA_VERSION;
  readonly manifest: {
    readonly schemaVersion: typeof SCENARIO_CONTRACT_MANIFEST_SCHEMA_VERSION;
    readonly catalogRevision: string;
    readonly scenarios: readonly {
      readonly scenario: FaultRunScenario;
      readonly contractRevision: string;
      readonly evidenceContractHash: string;
      readonly targetService: string;
      readonly targetOperation: string;
      readonly parameterNames: readonly string[];
      readonly evidenceRecipeCount: number;
      readonly effectRecipeIds: readonly string[];
      readonly alertExpectation: ResolvedScenarioContract['alert']['expectation'];
    }[];
  };
  readonly preflightReport: ScenarioContractValidationReport;
  readonly formMetadata: {
    readonly schemaVersion: typeof SCENARIO_CONTRACT_FORM_SCHEMA_VERSION;
    readonly catalogRevision: string;
    readonly scenarios: readonly {
      readonly scenario: FaultRunScenario;
      readonly contractRevision: string;
      readonly parameters: readonly {
        readonly name: string;
        readonly kind: string;
        readonly required: boolean;
        readonly unit?: string;
        readonly default?: number | string;
        readonly min?: number;
        readonly max?: number;
        readonly maxLength?: number;
        readonly options?: readonly string[];
      }[];
    }[];
  };
  readonly runbookChecklist: ScenarioContractRunbookChecklist;
  readonly smokeMatrix: {
    readonly schemaVersion: typeof SCENARIO_CONTRACT_SMOKE_MATRIX_SCHEMA_VERSION;
    readonly catalogRevision: string;
    readonly scenarios: readonly {
      readonly scenario: FaultRunScenario;
      readonly targetService: string;
      readonly targetOperation: string;
      readonly targetLifecycleMode: ResolvedScenarioContract['targetLifecycleMode'];
      readonly dispatchOwner: ResolvedScenarioContract['dispatchOwner'];
      readonly recoveryStrategy: ResolvedScenarioContract['recoveryStrategy'];
      readonly liveSmokeEligibility: 'DISPOSABLE_ONLY' | 'REQUIRES_OPERATOR_REVIEW';
      readonly prerequisites: readonly string[];
      readonly minimumLifecycleAssertions: {
        readonly prepareEventTypes: readonly string[];
        readonly activeEffectRecipeIds: readonly string[];
        readonly stopEventTypes: readonly string[];
        readonly recoveryRecipeIds: readonly string[];
        readonly cleanupActionTypes: readonly string[];
      };
      readonly executionState: 'NOT_EXECUTED_BY_GENERATOR';
    }[];
  };
  readonly terminologyInput: ScenarioContractTerminologyInput;
  readonly contractTestScaffold: {
    readonly schemaVersion: typeof SCENARIO_CONTRACT_TEST_SCAFFOLD_SCHEMA_VERSION;
    readonly catalogRevision: string;
    readonly suites: readonly {
      readonly scenario: FaultRunScenario;
      readonly contractRevision: string;
      readonly assertions: readonly string[];
      readonly expected: {
        readonly targetService: string;
        readonly targetOperation: string;
        readonly parameterNames: readonly string[];
        readonly evidenceRecipeIds: readonly string[];
        readonly effectRecipeIds: readonly string[];
        readonly alertNames: readonly string[];
        readonly receiptPolicyId: string;
      };
    }[];
  };
}

export interface ScenarioContractArtifactInput {
  readonly preflightInput: ScenarioContractValidationInput;
  readonly runbookArticles: readonly ScenarioContractRunbookArticleFact[];
}

export function generateScenarioContractTerminologyInput(
  contracts: readonly Pick<ResolvedScenarioContract, 'scenario'>[],
): ScenarioContractTerminologyInput {
  const scenarioIds = uniqueSorted(contracts.map(({ scenario }) => scenario));
  return {
    schemaVersion: SCENARIO_CONTRACT_TERMINOLOGY_SCHEMA_VERSION,
    scenarioIds,
    scenarioIdPatterns: scenarioIds.map(scenarioIdPattern),
    reviewedTermPatterns: SCENARIO_CONTRACT_REVIEWED_RUNTIME_TERM_PATTERNS,
  };
}

export function generateScenarioContractRunbookChecklist(
  contracts: readonly ResolvedScenarioContract[],
  runbookArticles: readonly ScenarioContractRunbookArticleFact[],
): ScenarioContractRunbookChecklist {
  const articlesByScenario = new Map<FaultRunScenario, string>();
  const duplicateScenarios = new Set<FaultRunScenario>();
  for (const article of runbookArticles) {
    if (articlesByScenario.has(article.scenario)) duplicateScenarios.add(article.scenario);
    else if (isAllowlistedArticleFile(article.articleFile)) {
      articlesByScenario.set(article.scenario, article.articleFile);
    }
  }
  const duplicateContracts = findDuplicates(contracts.map(({ scenario }) => scenario));
  const scenarios = [...contracts]
    .sort((left, right) => compareText(left.scenario, right.scenario))
    .map((contract) => ({
      scenario: contract.scenario,
      articleFile: duplicateContracts.has(contract.scenario)
        || duplicateScenarios.has(contract.scenario)
        ? null
        : articlesByScenario.get(contract.scenario) ?? null,
      targetService: contract.targetService,
      targetOperation: contract.targetOperation,
      requiredHeadings: SCENARIO_CONTRACT_REQUIRED_RUNBOOK_HEADINGS,
      lifecycle: {
        prepareEventTypes: sorted(contract.lifecycle.prepareEventTypes),
        activeEffectRecipeIds: sorted(contract.evidence.effectRule.recipeIds),
        stopEventTypes: sorted(contract.lifecycle.stopEventTypes),
        targetRelease: contract.recoveryPolicy.targetRelease,
        cleanupPolicy: contract.recoveryPolicy.cleanup,
        cleanupActionTypes: sorted(contract.lifecycle.cleanupActionTypes),
        recoveryRecipeIds: sorted(contract.lifecycle.recoveryRecipeIds),
        evidenceRecipeIds: sorted(contract.evidence.recipes.map(({ id }) => id)),
        alertSectionRequired: true as const,
        receiptPolicyId: contract.alert.receiptPolicyId,
      },
    }));
  return {
    schemaVersion: SCENARIO_CONTRACT_RUNBOOK_CHECKLIST_SCHEMA_VERSION,
    scenarios,
  };
}

export function generateScenarioContractArtifacts(
  input: ScenarioContractArtifactInput,
): ScenarioContractArtifactBundle {
  if (input.preflightInput.stage !== 'PREFLIGHT') {
    throw new Error('SCENARIO_CONTRACT_ARTIFACT_INPUT_INVALID');
  }
  const contracts = [...input.preflightInput.contracts]
    .sort((left, right) => compareText(left.scenario, right.scenario));
  if (findDuplicates(contracts.map(({ scenario }) => scenario)).size > 0) {
    throw new Error('SCENARIO_CONTRACT_ARTIFACT_INPUT_INVALID');
  }
  for (const contract of contracts) {
    if (contract.parameters.some(({ name }) => /(?:password|secret|token|credential)/iu.test(name))) {
      throw new Error('SCENARIO_CONTRACT_ARTIFACT_INPUT_INVALID');
    }
  }

  const validationReport = validateScenarioContracts(input.preflightInput);
  const catalogRevision = validationReport.catalogRevision;
  const runbookChecklist = generateScenarioContractRunbookChecklist(
    contracts,
    input.runbookArticles,
  );
  const terminologyInput = generateScenarioContractTerminologyInput(contracts);

  return {
    schemaVersion: SCENARIO_CONTRACT_ARTIFACT_SCHEMA_VERSION,
    manifest: {
      schemaVersion: SCENARIO_CONTRACT_MANIFEST_SCHEMA_VERSION,
      catalogRevision,
      scenarios: contracts.map((contract) => ({
        scenario: contract.scenario,
        contractRevision: getScenarioContractRevision(contract),
        evidenceContractHash: getEvidenceContractHash(contract.evidence),
        targetService: contract.targetService,
        targetOperation: contract.targetOperation,
        parameterNames: sorted(contract.parameters.map(({ name }) => name)),
        evidenceRecipeCount: contract.evidence.recipes.length,
        effectRecipeIds: sorted(contract.evidence.effectRule.recipeIds),
        alertExpectation: contract.alert.expectation,
      })),
    },
    preflightReport: validationReport,
    formMetadata: {
      schemaVersion: SCENARIO_CONTRACT_FORM_SCHEMA_VERSION,
      catalogRevision,
      scenarios: contracts.map((contract) => ({
        scenario: contract.scenario,
        contractRevision: getScenarioContractRevision(contract),
        parameters: contract.parameters.map((parameter) => ({
          name: parameter.name,
          kind: parameter.kind,
          required: parameter.required === true,
          ...(parameter.unit === undefined ? {} : { unit: parameter.unit }),
          ...(parameter.default === undefined ? {} : { default: parameter.default }),
          ...(parameter.min === undefined ? {} : { min: parameter.min }),
          ...(parameter.max === undefined ? {} : { max: parameter.max }),
          ...(parameter.maxLength === undefined ? {} : { maxLength: parameter.maxLength }),
          ...(parameter.options === undefined ? {} : { options: [...parameter.options] }),
        })),
      })),
    },
    runbookChecklist,
    smokeMatrix: {
      schemaVersion: SCENARIO_CONTRACT_SMOKE_MATRIX_SCHEMA_VERSION,
      catalogRevision,
      scenarios: contracts.map((contract) => ({
        scenario: contract.scenario,
        targetService: contract.targetService,
        targetOperation: contract.targetOperation,
        targetLifecycleMode: contract.targetLifecycleMode,
        dispatchOwner: contract.dispatchOwner,
        recoveryStrategy: contract.recoveryStrategy,
        liveSmokeEligibility: contract.budgets.some(({ boundary }) => (
          boundary.kind === 'APPROVED_NON_RELEASING_EXCEPTION'
          && boundary.allowedEnvironment === 'DISPOSABLE_ONLY'
        )) ? 'DISPOSABLE_ONLY' : 'REQUIRES_OPERATOR_REVIEW',
        prerequisites: sorted([
          ...(contract.targetLifecycleMode === 'GATEWAY' ? ['gateway-service'] : []),
          ...(contract.dispatchOwner === null ? [] : [contract.dispatchOwner]),
        ]),
        minimumLifecycleAssertions: {
          prepareEventTypes: sorted(contract.lifecycle.prepareEventTypes),
          activeEffectRecipeIds: sorted(contract.evidence.effectRule.recipeIds),
          stopEventTypes: sorted(contract.lifecycle.stopEventTypes),
          recoveryRecipeIds: sorted(contract.lifecycle.recoveryRecipeIds),
          cleanupActionTypes: sorted(contract.lifecycle.cleanupActionTypes),
        },
        executionState: 'NOT_EXECUTED_BY_GENERATOR',
      })),
    },
    terminologyInput,
    contractTestScaffold: {
      schemaVersion: SCENARIO_CONTRACT_TEST_SCAFFOLD_SCHEMA_VERSION,
      catalogRevision,
      suites: contracts.map((contract) => ({
        scenario: contract.scenario,
        contractRevision: getScenarioContractRevision(contract),
        assertions: [
          'target-mapping-matches-contract',
          'parameter-consumers-cover-catalog',
          'lifecycle-hooks-resolve',
          'evidence-plan-hash-is-stable',
          'alert-receipt-policy-is-shared',
        ],
        expected: {
          targetService: contract.targetService,
          targetOperation: contract.targetOperation,
          parameterNames: sorted(contract.parameters.map(({ name }) => name)),
          evidenceRecipeIds: sorted(contract.evidence.recipes.map(({ id }) => id)),
          effectRecipeIds: sorted(contract.evidence.effectRule.recipeIds),
          alertNames: contract.alert.expectation === 'NOT_EXPECTED'
            ? []
            : sorted(contract.alert.allowedAlerts.map(({ alertName }) => alertName)),
          receiptPolicyId: ALERT_RECEIPT_POLICY_ID,
        },
      })),
    },
  };
}

function scenarioIdPattern(scenario: string): string {
  const escaped = scenario.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return `(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`;
}

function isAllowlistedArticleFile(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(value);
}

function findDuplicates<T extends string>(values: readonly T[]): Set<T> {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function sorted<T extends string>(values: readonly T[]): T[] {
  return [...values].sort(compareText);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
