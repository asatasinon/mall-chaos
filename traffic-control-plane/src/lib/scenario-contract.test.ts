import assert from 'node:assert/strict';
import test from 'node:test';
import { getCatalogRevision } from './fault-run-catalog-revision';
import { getScenarioDefinition, listScenarioDefinitions } from './fault-run-catalog';
import {
  getEvidenceContractHash,
  getScenarioContractRevision,
  resolveScenarioContract,
  type ParameterConsumer,
  type ScenarioContractCatalogDefinition,
  type ScenarioContractSupplement,
  type ResolvedScenarioContract,
} from './scenario-contract';

test('resolved contract derives dispatch and target lifecycle from Catalog policy', () => {
  const surge = contractDefinition('BROWSE_SURGE');
  const targetBacked = contractDefinition('CATALOG_REDIS_LARGE_VALUE');

  const resolvedSurge = resolveScenarioContract(surge);
  const resolvedTargetBacked = resolveScenarioContract(targetBacked);

  assert.equal(resolvedSurge.dispatchOwner, 'TRAFFIC_SURGE_EXECUTOR');
  assert.equal(resolvedSurge.targetLifecycleMode, 'LOCAL_WORKER');
  assert.equal(resolvedTargetBacked.dispatchOwner, 'SCENARIO_WORKERS');
  assert.equal(resolvedTargetBacked.targetLifecycleMode, 'GATEWAY');
  assert.equal(resolvedTargetBacked.recoveryPolicy.targetRelease, 'REQUIRED');
  assert.deepEqual(resolvedTargetBacked.recoveryPolicy, targetBacked.recoveryPolicy);
});

test('resolved contract owns frozen copies of Catalog parameters and supplement data', () => {
  const definition = contractDefinition('BROWSE_SURGE');
  const resolved = resolveScenarioContract(definition);

  assert.notStrictEqual(resolved.parameters, definition.parameters);
  assert.notStrictEqual(resolved.evidence, definition.contract.evidence);
  assert.ok(Object.isFrozen(resolved));
  assert.ok(Object.isFrozen(resolved.parameters));
  assert.ok(Object.isFrozen(resolved.parameters[0]));
  assert.ok(Object.isFrozen(resolved.evidence.recipes));
  assert.ok(Object.isFrozen(resolved.lifecycle.stopEventTypes));
});

test('contract revision covers the full resolved contract and ignores parameter order', () => {
  const resolved = resolveScenarioContract(contractDefinition('BROWSE_SURGE'));
  const reordered = {
    ...resolved,
    parameters: [...resolved.parameters].reverse(),
    budgets: resolved.budgets.map((budget) => (
      budget.boundary.kind === 'PARAMETER_BOUNDS'
        ? {
          ...budget,
          boundary: {
            ...budget.boundary,
            parameterNames: [...budget.boundary.parameterNames].reverse(),
          },
        }
        : budget
    )),
  };

  assert.match(getScenarioContractRevision(resolved), /^sc\.v1:sha256:[a-f0-9]{64}$/);
  assert.equal(getScenarioContractRevision(resolved), getScenarioContractRevision(reordered));
  assert.notEqual(
    getScenarioContractRevision(resolved),
    getScenarioContractRevision({ ...resolved, maxDurationSec: resolved.maxDurationSec + 1 }),
  );
  assert.notEqual(
    getScenarioContractRevision(resolved),
    getScenarioContractRevision({
      ...resolved,
      evidence: {
        ...resolved.evidence,
        windows: { ...resolved.evidence.windows, activeLeadSec: 31 },
      },
    }),
  );
  assert.equal(
    getEvidenceContractHash(resolved.evidence),
    getEvidenceContractHash({
      ...resolved,
      maxDurationSec: resolved.maxDurationSec + 1,
    }.evidence),
  );
});

test('contract revision ignores ordering of unordered Catalog collections', () => {
  const resolved = resolveScenarioContract(getScenarioDefinition('BROWSE_SURGE'));
  assert.equal(resolved.alert.expectation, 'CONDITIONAL');

  const reordered: ResolvedScenarioContract = {
    ...resolved,
    parameters: [...resolved.parameters].reverse(),
    budgets: resolved.budgets.map((budget) => (
      budget.boundary.kind === 'PARAMETER_BOUNDS'
        ? {
          ...budget,
          boundary: {
            ...budget.boundary,
            parameterNames: [...budget.boundary.parameterNames].reverse(),
          },
        }
        : budget
    )),
    lifecycle: {
      ...resolved.lifecycle,
      prepareEventTypes: [...resolved.lifecycle.prepareEventTypes].reverse(),
      stopEventTypes: [...resolved.lifecycle.stopEventTypes].reverse(),
      cleanupActionTypes: [...resolved.lifecycle.cleanupActionTypes].reverse(),
      recoveryRecipeIds: [...resolved.lifecycle.recoveryRecipeIds].reverse(),
      sideEffectRecipeIds: [...resolved.lifecycle.sideEffectRecipeIds].reverse(),
    },
    evidence: {
      ...resolved.evidence,
      recipes: [...resolved.evidence.recipes].reverse(),
      effectRule: {
        ...resolved.evidence.effectRule,
        recipeIds: [...resolved.evidence.effectRule.recipeIds].reverse(),
      },
    },
    alert: {
      ...resolved.alert,
      allowedAlerts: [...resolved.alert.allowedAlerts]
        .reverse()
        .map((alert) => ({
          ...alert,
          incidentKeyLabels: [...alert.incidentKeyLabels].reverse(),
        })),
    },
  };

  assert.equal(getScenarioContractRevision(resolved), getScenarioContractRevision(reordered));
});

test('Evidence contract hash is stable for unordered recipe inputs and changes with Evidence content', () => {
  const evidence = resolveScenarioContract(contractDefinition('BROWSE_SURGE')).evidence;
  const reordered = {
    ...evidence,
    recipes: [...evidence.recipes].reverse(),
    effectRule: {
      ...evidence.effectRule,
      recipeIds: [...evidence.effectRule.recipeIds].reverse(),
    },
  };

  assert.match(getEvidenceContractHash(evidence), /^[a-f0-9]{64}$/);
  assert.equal(getEvidenceContractHash(evidence), getEvidenceContractHash(reordered));
  assert.notEqual(
    getEvidenceContractHash(evidence),
    getEvidenceContractHash({
      ...evidence,
      windows: { ...evidence.windows, activeLeadSec: 31 },
    }),
  );
});

test('contract revisions are per-scenario while the global Catalog revision covers every supplement', () => {
  const definitions = listScenarioDefinitions();
  const first = definitions[0];
  const second = definitions[1];
  assert.ok(first);
  assert.ok(second);
  const firstRevision = getScenarioContractRevision(resolveScenarioContract(first));
  const secondRevision = getScenarioContractRevision(resolveScenarioContract(second));
  const changedSecond = {
    ...second,
    contract: {
      ...second.contract,
      evidence: {
        ...second.contract.evidence,
        windows: {
          ...second.contract.evidence.windows,
          activeLeadSec: second.contract.evidence.windows.activeLeadSec + 1,
        },
      },
    },
  };
  const changedDefinitions = definitions.map((definition) => (
    definition === second ? changedSecond : definition
  ));

  assert.notEqual(getCatalogRevision(definitions), getCatalogRevision(changedDefinitions));
  assert.equal(
    getScenarioContractRevision(resolveScenarioContract(first)),
    firstRevision,
  );
  assert.notEqual(
    getScenarioContractRevision(resolveScenarioContract(changedSecond)),
    secondRevision,
  );

  const externalReadinessInput = {
    ...first,
    agentDeliveryReadiness: { state: 'NOT_ENABLED_YET' as const },
  };
  assert.equal(
    getScenarioContractRevision(resolveScenarioContract(externalReadinessInput)),
    firstRevision,
  );
});

function contractDefinition(
  scenario: Parameters<typeof getScenarioDefinition>[0],
): ScenarioContractCatalogDefinition {
  const definition = getScenarioDefinition(scenario);
  const parameterConsumers: Record<string, readonly ParameterConsumer[]> = {};
  for (const parameter of definition.parameters) {
    parameterConsumers[parameter.name] = ['ADMISSION'];
  }

  const contract: ScenarioContractSupplement = {
    parameterConsumers,
    budgets: [{
      resource: 'REQUEST_CONCURRENCY',
      boundary: {
        kind: 'PARAMETER_BOUNDS',
        parameterNames: definition.parameters.map(({ name }) => name),
      },
    }],
    lifecycle: {
      prepareEventTypes: [],
      stopEventTypes: ['STOP_REQUESTED'],
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
          id: `${scenario.toLowerCase()}.prometheus.active-rate`,
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
          id: `${scenario.toLowerCase()}.run.timeline`,
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
        recipeIds: [`${scenario.toLowerCase()}.prometheus.active-rate`],
      },
    },
    alert: {
      expectation: 'NOT_EXPECTED',
      reason: 'No scenario-specific alert is required by this resolver fixture.',
      faultRunCorrelation: 'not_required',
      missingAlertTreatment: 'EFFECT_CAN_STILL_BE_OBSERVED',
      receiptPolicyId: 'alert-receipt.v1',
    },
  };
  return { ...definition, contract };
}
