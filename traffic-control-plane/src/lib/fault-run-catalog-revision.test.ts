import assert from 'node:assert/strict';
import test from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import {
  canonicalizeCatalogDefinitions,
  getCatalogRevision,
} from './fault-run-catalog-revision';
import { ALERT_RECEIPT_POLICY_ID, type ScenarioContractSupplement } from './scenario-contract';

test('catalog revision is stable when scenarios, parameters, or options are reordered', () => {
  const definitions = listScenarioDefinitions();
  const reordered = definitions
    .map((definition) => ({
      ...definition,
      parameters: [...definition.parameters]
        .reverse()
        .map((parameter) => ({
          ...parameter,
          options: parameter.options ? [...parameter.options].reverse() : parameter.options,
        })),
    }))
    .reverse();

  assert.equal(
    canonicalizeCatalogDefinitions(definitions),
    canonicalizeCatalogDefinitions(reordered),
  );
  assert.equal(getCatalogRevision(definitions), getCatalogRevision(reordered));
  assert.match(getCatalogRevision(), /^[a-f0-9]{64}$/);
});

test('catalog facts change the revision', () => {
  const definitions = listScenarioDefinitions();
  const changed = definitions.map((definition, index) => index === 0
    ? { ...definition, maxDurationSec: definition.maxDurationSec + 1 }
    : definition);

  assert.notEqual(getCatalogRevision(definitions), getCatalogRevision(changed));
});

test('the catalog owns the target prepare plan and its canonical revision', () => {
  const definitions = listScenarioDefinitions();
  assert.deepEqual(
    definitions.filter((definition) => definition.targetPrepare === 'NOT_APPLICABLE')
      .map((definition) => definition.scenario).sort(),
    ['BROWSE_SURGE', 'ORDER_QUERY_SURGE'],
  );
  assert.equal(definitions.filter((definition) => definition.targetPrepare === 'REQUIRED').length,
    definitions.length - 2);
  const first = definitions[0];
  assert.ok(first);
  assert.notEqual(getCatalogRevision(definitions),
    getCatalogRevision(definitions.map((definition) => definition === first
      ? { ...definition, targetPrepare: 'NOT_APPLICABLE' }
      : definition)));
});

test('every recovery policy fact contributes to the catalog revision', () => {
  const definitions = listScenarioDefinitions();
  const definition = definitions[0];
  assert.ok(definition);

  const revisions = [
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      workerDrain: { requirement: 'REQUIRED', owner: 'RUNNER_ENGINE' },
    }),
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      workerDrain: { requirement: 'NOT_APPLICABLE' },
    }),
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      targetRelease: 'NOT_APPLICABLE',
    }),
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      cleanup: 'OPTIONAL_PER_RUN',
    }),
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      verification: 'BEST_EFFORT',
    }),
  ].map((changed) => getCatalogRevision(changed));

  for (const revision of revisions) {
    assert.notEqual(revision, getCatalogRevision(definitions));
  }
});

test('catalog revision includes canonicalized contract supplements', () => {
  const definitions = listScenarioDefinitions();
  const first = definitions[0];
  assert.ok(first);
  const contract = contractSupplement(first);
  const withContract = definitions.map((definition) => definition === first
    ? { ...definition, contract }
    : definition);
  const reorderedContract: ScenarioContractSupplement = {
    ...contract,
    lifecycle: {
      ...contract.lifecycle,
      prepareEventTypes: [...contract.lifecycle.prepareEventTypes].reverse(),
      stopEventTypes: [...contract.lifecycle.stopEventTypes].reverse(),
    },
    evidence: {
      ...contract.evidence,
      recipes: [...contract.evidence.recipes].reverse(),
      effectRule: {
        ...contract.evidence.effectRule,
        recipeIds: [...contract.evidence.effectRule.recipeIds].reverse(),
      },
    },
  };
  const reordered = definitions.map((definition) => definition === first
    ? { ...definition, contract: reorderedContract }
    : definition);

  assert.match(getCatalogRevision(withContract), /^[a-f0-9]{64}$/);
  assert.notEqual(getCatalogRevision(definitions), getCatalogRevision(withContract));
  assert.equal(getCatalogRevision(withContract), getCatalogRevision(reordered));
});

function replaceFirstPolicy(
  definitions: ReturnType<typeof listScenarioDefinitions>,
  recoveryPolicy: ReturnType<typeof listScenarioDefinitions>[number]['recoveryPolicy'],
) {
  return definitions.map((definition, index) => index === 0
    ? { ...definition, recoveryPolicy }
    : definition);
}

function contractSupplement(
  definition: ReturnType<typeof listScenarioDefinitions>[number],
): ScenarioContractSupplement {
  const parameterConsumers: Record<string, readonly ['ADMISSION', 'WORKER_EXECUTION']> = {};
  for (const parameter of definition.parameters) {
    parameterConsumers[parameter.name] = ['ADMISSION', 'WORKER_EXECUTION'];
  }
  return {
    parameterConsumers,
    budgets: [],
    lifecycle: {
      prepareEventTypes: ['TARGET_CONFIRMED', 'CREATED'],
      stopEventTypes: ['DRAIN_COMPLETED', 'STOP_REQUESTED'],
      cleanupActionTypes: [],
      recoveryRecipeIds: [],
      sideEffectRecipeIds: [],
    },
    evidence: {
      schemaVersion: 'evidence-contract.v1',
      windows: {
        baselineBeforeActiveSec: 300,
        activeLeadSec: 30,
        activeTailSec: 30,
        recoveryLeadSec: 30,
        recoveryTailSec: 300,
        cleanupLeadSec: 300,
      },
      recipes: [
        {
          id: 'scenario.prometheus.active',
          source: 'PROMETHEUS',
          window: 'active',
          observationMode: 'WINDOWED',
          required: true,
          template: 'HTTP_RATE',
          scope: { service: definition.targetService },
          predicate: { kind: 'COMPARISON', operator: 'GT', value: 10 },
          projection: 'NUMERIC',
        },
        {
          id: 'scenario.run.timeline',
          source: 'RUN_EVENT',
          window: 'active',
          observationMode: 'WINDOWED',
          required: true,
          template: 'RUN_TIMELINE',
          scope: { service: 'traffic-control-plane' },
          predicate: { kind: 'NONE' },
          projection: 'TIMELINE',
        },
      ],
      effectRule: {
        mode: 'ALL',
        recipeIds: ['scenario.prometheus.active'],
      },
    },
    alert: {
      expectation: 'NOT_EXPECTED',
      reason: 'Revision test fixture.',
      faultRunCorrelation: 'not_required',
      missingAlertTreatment: 'EFFECT_CAN_STILL_BE_OBSERVED',
      receiptPolicyId: ALERT_RECEIPT_POLICY_ID,
    },
  };
}
