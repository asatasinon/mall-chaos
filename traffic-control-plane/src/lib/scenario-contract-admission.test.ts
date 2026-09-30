import assert from 'node:assert/strict';
import test from 'node:test';
import { getScenarioDefinition, validateScenarioParameters } from './fault-run-catalog';
import {
  admitScenarioContract,
  ScenarioContractAdmissionError,
  type ScenarioContractAdmissionLogger,
  validateRuntimeContract,
} from './scenario-contract-admission';
import {
  parseScenarioContractWebConfig,
  readScenarioContractWebConfig,
  ScenarioContractWebConfigError,
} from './scenario-contract-web-config';

test('runtime Contract validation uses the selected resolved Contract and normalized parameters', () => {
  const definition = getScenarioDefinition('BROWSE_REPORT_SQL');
  const parameters = validateScenarioParameters(definition.scenario, { durationSec: 30 });
  const validation = validateRuntimeContract(definition, parameters);

  assert.match(validation.contractRevision, /^sc\.v1:sha256:[a-f0-9]{64}$/);
  assert.match(validation.catalogRevision, /^[a-f0-9]{64}$/);
  assert.deepEqual(validation.issues, []);
});

test('warn mode logs only low-cardinality Contract admission fields; enforce rejects', () => {
  const definition = getScenarioDefinition('BROWSE_REPORT_SQL');
  const invalidDefinition = {
    ...definition,
    contract: {
      ...definition.contract,
      parameterConsumers: {},
    },
  };
  const parameters = validateScenarioParameters(definition.scenario, { durationSec: 30 });
  const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];
  const logger: ScenarioContractAdmissionLogger = {
    warn(fields, message) {
      warnings.push({ fields, message });
    },
  };

  const warned = admitScenarioContract(
    invalidDefinition,
    parameters,
    { validationMode: 'warn', deploymentScope: 'retained' },
    logger,
  );

  assert.deepEqual(warnings, [{
    fields: {
      category: 'invalidParameters',
      scenario: definition.scenario,
      contractRevision: warned.contractRevision,
      mode: 'warn',
    },
    message: 'Scenario contract validation warning',
  }]);
  assert.throws(
    () => admitScenarioContract(
      invalidDefinition,
      parameters,
      { validationMode: 'enforce', deploymentScope: 'retained' },
      logger,
    ),
    (error: unknown) => error instanceof ScenarioContractAdmissionError
      && error.code === 'SCENARIO_CONTRACT_INVALID',
  );
});

test('heap scope rejection is independent of validation mode', () => {
  const definition = getScenarioDefinition('NOTIFICATION_HEAP_PRESSURE');
  const parameters = validateScenarioParameters(definition.scenario, { durationSec: 30 });

  for (const validationMode of ['warn', 'enforce'] as const) {
    assert.throws(
      () => admitScenarioContract(
        definition,
        parameters,
        { validationMode, deploymentScope: 'retained' },
      ),
      (error: unknown) => error instanceof ScenarioContractAdmissionError
        && error.code === 'SCENARIO_CONTRACT_DEPLOYMENT_SCOPE_RESTRICTED',
    );
  }
  assert.match(
    admitScenarioContract(
      definition,
      parameters,
      { validationMode: 'warn', deploymentScope: 'disposable' },
    ).contractRevision,
    /^sc\.v1:sha256:[a-f0-9]{64}$/,
  );
});

test('Web-only admission config has strict defaults and rejects invalid values without echoing them', () => {
  assert.deepEqual(parseScenarioContractWebConfig({}), {
    validationMode: 'warn',
    deploymentScope: 'retained',
  });

  assert.deepEqual(parseScenarioContractWebConfig({
    SCENARIO_CONTRACT_VALIDATION_MODE: 'enforce',
    SCENARIO_CONTRACT_DEPLOYMENT_SCOPE: 'disposable',
  }), {
    validationMode: 'enforce',
    deploymentScope: 'disposable',
  });
  assert.throws(() => parseScenarioContractWebConfig({
    SCENARIO_CONTRACT_VALIDATION_MODE: 'enforce-with-details',
  }), (error: unknown) => error instanceof ScenarioContractWebConfigError
    && error.code === 'SCENARIO_CONTRACT_VALIDATION_MODE_INVALID'
    && !error.message.includes('enforce-with-details'));
  assert.throws(() => parseScenarioContractWebConfig({
    SCENARIO_CONTRACT_DEPLOYMENT_SCOPE: 'shared-with-credentials',
  }), (error: unknown) => error instanceof ScenarioContractWebConfigError
    && error.code === 'SCENARIO_CONTRACT_DEPLOYMENT_SCOPE_INVALID'
    && !error.message.includes('shared-with-credentials'));
});

test('Web bootstrap reads one validated configuration without adding it to shared Worker env', () => {
  assert.deepEqual(readScenarioContractWebConfig({}), {
    validationMode: 'warn',
    deploymentScope: 'retained',
  });
  assert.deepEqual(readScenarioContractWebConfig({
    SCENARIO_CONTRACT_VALIDATION_MODE: 'enforce',
    SCENARIO_CONTRACT_DEPLOYMENT_SCOPE: 'disposable',
  }), {
    validationMode: 'enforce',
    deploymentScope: 'disposable',
  });
});
