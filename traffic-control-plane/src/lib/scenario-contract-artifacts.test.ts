import assert from 'node:assert/strict';
import test from 'node:test';
import { getCatalogRevision } from './fault-run-catalog-revision';
import { listScenarioDefinitions } from './fault-run-catalog';
import { RUNBOOK_METADATA } from './runbook';
import type { FaultRunScenario } from './fault-run-catalog';
import {
  ALERT_RECEIPT_POLICY_ID,
  resolveScenarioContract,
  type ResolvedScenarioContract,
} from './scenario-contract';
import {
  generateScenarioContractArtifacts,
  generateScenarioContractRunbookChecklist,
  generateScenarioContractTerminologyInput,
} from './scenario-contract-artifacts';
import type { ScenarioContractValidationInput } from './scenario-contract-validator';

const DEFINITIONS = listScenarioDefinitions();
const CONTRACTS = DEFINITIONS.map((definition) => resolveScenarioContract(definition));
const CATALOG_REVISION = getCatalogRevision(DEFINITIONS);
const RUNBOOK_ARTICLES = DEFINITIONS.map(({ scenario }) => ({
  scenario,
  articleFile: RUNBOOK_METADATA[scenario].articleFile,
}));

function preflightInput(
  contracts: readonly ResolvedScenarioContract[] = CONTRACTS,
): ScenarioContractValidationInput {
  return {
    stage: 'PREFLIGHT',
    scope: 'STATIC_CONTRACT',
    catalogRevision: CATALOG_REVISION,
    sourceCommitSha: null,
    catalogScenarios: DEFINITIONS.map(({ scenario }) => scenario),
    contracts,
    dispatchCapabilities: [],
    targetFacts: [],
    parameterValidationFacts: [],
    parameterGuardFacts: [],
    evidenceTemplateIds: [],
    runbookFacts: [],
    i18nFacts: [],
    alertConfiguration: {
      prometheus: [],
      alertmanager: [],
      agentDeliveryReadiness: { state: 'NOT_ENABLED_YET' },
    },
    requiredCheckIds: [],
    checkResults: [],
  };
}

test('generates deterministic schema-versioned artifacts without mutating inputs', () => {
  const input = preflightInput();
  const before = structuredClone(input);
  const artifactInput = { preflightInput: input, runbookArticles: RUNBOOK_ARTICLES };
  const first = generateScenarioContractArtifacts(artifactInput);
  const second = generateScenarioContractArtifacts(artifactInput);

  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 'scenario-contract-artifacts.v1');
  assert.equal(first.manifest.schemaVersion, 'scenario-contract-manifest.v1');
  assert.equal(first.formMetadata.schemaVersion, 'scenario-contract-form.v1');
  assert.equal(first.runbookChecklist.schemaVersion, 'scenario-contract-runbook-checklist.v1');
  assert.equal(first.smokeMatrix.schemaVersion, 'scenario-contract-smoke-matrix.v1');
  assert.equal(first.terminologyInput.schemaVersion, 'scenario-contract-terminology.v1');
  assert.equal(first.contractTestScaffold.schemaVersion, 'scenario-contract-test-scaffold.v1');
  assert.equal(first.preflightReport.stage, 'PREFLIGHT');
  assert.equal(first.preflightReport.schemaVersion, 'scenario-contract-report.v1');
  assert.equal(first.preflightReport.status, 'BLOCKED');
  assert.equal(first.manifest.catalogRevision, CATALOG_REVISION);
  assert.equal(first.manifest.scenarios.length, DEFINITIONS.length);
  assert.equal(first.contractTestScaffold.suites.length, DEFINITIONS.length);

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes('generatedAt'), false);
  assert.equal(serialized.includes('sum(rate('), false);
  assert.equal(serialized.includes('http://'), false);
  assert.equal(serialized.includes('secret-token-fixture'), false);
  assert.equal(serialized.includes('password'), false);
  assert.deepEqual(JSON.parse(serialized), first);
});

test('generates a catalog-driven runbook checklist and smoke matrix without claiming execution', () => {
  const checklist = generateScenarioContractRunbookChecklist(CONTRACTS, RUNBOOK_ARTICLES);
  const artifacts = generateScenarioContractArtifacts({
    preflightInput: preflightInput(),
    runbookArticles: RUNBOOK_ARTICLES,
  });

  assert.deepEqual(checklist, artifacts.runbookChecklist);
  assert.deepEqual(checklist.scenarios.map(({ scenario }) => scenario),
    DEFINITIONS.map(({ scenario }) => scenario).sort());
  for (const item of checklist.scenarios) {
    const contract = CONTRACTS.find(({ scenario }) => scenario === item.scenario);
    assert.ok(contract);
    assert.equal(item.articleFile, RUNBOOK_METADATA[item.scenario].articleFile);
    assert.equal(item.targetService, contract.targetService);
    assert.equal(item.targetOperation, contract.targetOperation);
    assert.ok(item.requiredHeadings.includes('ALERTS'));
    assert.deepEqual(item.lifecycle.evidenceRecipeIds,
      contract.evidence.recipes.map(({ id }) => id).sort());
    assert.equal(item.lifecycle.receiptPolicyId, contract.alert.receiptPolicyId);
  }

  for (const smokeScenario of artifacts.smokeMatrix.scenarios) {
    assert.equal(smokeScenario.executionState, 'NOT_EXECUTED_BY_GENERATOR');
    assert.deepEqual(
      smokeScenario.minimumLifecycleAssertions.activeEffectRecipeIds,
      CONTRACTS.find(({ scenario }) => scenario === smokeScenario.scenario)?.evidence.effectRule.recipeIds
        .slice().sort(),
    );
  }
  assert.equal(
    artifacts.smokeMatrix.scenarios.find(({ scenario }) => scenario === 'NOTIFICATION_HEAP_PRESSURE')
      ?.liveSmokeEligibility,
    'DISPOSABLE_ONLY',
  );
});

test('form metadata and contract-test scaffold are derived from the resolved contracts', () => {
  const artifacts = generateScenarioContractArtifacts({
    preflightInput: preflightInput(),
    runbookArticles: RUNBOOK_ARTICLES,
  });
  const browseForm = artifacts.formMetadata.scenarios.find(({ scenario }) => scenario === 'BROWSE_SURGE');
  const browseSuite = artifacts.contractTestScaffold.suites.find(({ scenario }) => scenario === 'BROWSE_SURGE');
  const browseContract = CONTRACTS.find(({ scenario }) => scenario === 'BROWSE_SURGE');
  assert.ok(browseForm);
  assert.ok(browseSuite);
  assert.ok(browseContract);
  assert.deepEqual(browseForm.parameters.map(({ name }) => name),
    browseContract.parameters.map(({ name }) => name));
  assert.deepEqual(browseSuite.expected.parameterNames,
    browseContract.parameters.map(({ name }) => name).sort());
  assert.equal(browseForm.parameters.find(({ name }) => name === 'concurrency')?.max, 128);
  assert.equal(browseSuite.expected.receiptPolicyId, ALERT_RECEIPT_POLICY_ID);
  assert.equal(browseSuite.expected.targetService, browseContract.targetService);
  assert.ok(browseSuite.assertions.includes('evidence-plan-hash-is-stable'));
});

test('Catalog-derived terminology patterns catch an added scenario ID without a hardcoded list', () => {
  const futureScenario = 'FUTURE.P3+SCENARIO' as FaultRunScenario;
  const terminology = generateScenarioContractTerminologyInput([
    ...CONTRACTS,
    { scenario: futureScenario },
  ]);
  const generatedPattern = terminology.scenarioIdPatterns.find((pattern) => (
    new RegExp(pattern, 'iu').test(futureScenario)
  ));
  assert.ok(generatedPattern);
  assert.ok(new RegExp(generatedPattern, 'iu').test(
    'const marker = "FUTURE.P3+SCENARIO";',
  ));
  assert.equal(new RegExp(generatedPattern, 'iu').test(
    'const marker = "FUTUREXP3SCENARIO";',
  ), false);
  assert.deepEqual(terminology.scenarioIds,
    [...CONTRACTS.map(({ scenario }) => scenario), futureScenario].sort());
});

test('rejects unsupported preflight stages, duplicate scenarios, and secret-like parameter names', () => {
  assert.throws(
    () => generateScenarioContractArtifacts({
      preflightInput: { ...preflightInput(), stage: 'FINAL' },
      runbookArticles: RUNBOOK_ARTICLES,
    }),
    { message: 'SCENARIO_CONTRACT_ARTIFACT_INPUT_INVALID' },
  );
  assert.throws(
    () => generateScenarioContractArtifacts({
      preflightInput: preflightInput([CONTRACTS[0] as ResolvedScenarioContract, CONTRACTS[0] as ResolvedScenarioContract]),
      runbookArticles: RUNBOOK_ARTICLES,
    }),
    { message: 'SCENARIO_CONTRACT_ARTIFACT_INPUT_INVALID' },
  );
  const contract = CONTRACTS[0];
  assert.ok(contract);
  const secretParameterContract: ResolvedScenarioContract = {
    ...contract,
    parameters: [
      ...contract.parameters,
      { name: 'secretToken', kind: 'string', required: false },
    ],
  };
  assert.throws(
    () => generateScenarioContractArtifacts({
      preflightInput: preflightInput([secretParameterContract]),
      runbookArticles: RUNBOOK_ARTICLES,
    }),
    { message: 'SCENARIO_CONTRACT_ARTIFACT_INPUT_INVALID' },
  );
});
