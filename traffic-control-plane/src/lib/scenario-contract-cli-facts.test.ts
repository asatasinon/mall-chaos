import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import {
  createScenarioContractGatewayExpectation,
  createScenarioContractValidationInput,
  loadScenarioContractCliFacts,
} from './scenario-contract-cli-facts';
import { validateScenarioContracts } from './scenario-contract-validator';

test('CLI facts load checked-in inputs without runtime or database facts', async () => {
  const facts = await loadScenarioContractCliFacts();
  const input = createScenarioContractValidationInput(facts, {
    stage: 'PREFLIGHT',
    sourceCommitSha: null,
    requiredCheckIds: [],
    checkResults: [],
  });
  const report = validateScenarioContracts(input);
  const gatewayExpectation = createScenarioContractGatewayExpectation(facts);

  assert.equal(input.scope, 'STATIC_CONTRACT');
  assert.equal(input.catalogScenarios.length, listScenarioDefinitions().length);
  assert.equal(input.contracts.length, listScenarioDefinitions().length);
  assert.equal(input.targetFacts.length, listScenarioDefinitions().length);
  assert.deepEqual(
    input.targetFacts.filter(({ localWorker }) => localWorker.status === 'PASSED')
      .map(({ scenario }) => scenario)
      .sort(),
    ['BROWSE_SURGE', 'ORDER_QUERY_SURGE'],
  );
  assert.equal(gatewayExpectation.schemaVersion, 'scenario-contract-gateway.v1');
  assert.equal(gatewayExpectation.catalogRevision, input.catalogRevision);
  assert.equal(
    gatewayExpectation.operations.length,
    input.contracts.filter(({ targetLifecycleMode }) => targetLifecycleMode === 'GATEWAY').length,
  );
  assert.equal(report.status, 'VALID');
  assert.equal(report.stage, 'PREFLIGHT');
  assert.equal(report.requiredChecks.some(({ checkId }) => checkId.includes('gateway-service')), false);
});
