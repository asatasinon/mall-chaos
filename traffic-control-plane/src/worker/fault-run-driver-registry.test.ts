import assert from 'node:assert/strict';
import test from 'node:test';
import { listScenarioDefinitions, validateScenarioParameters } from '../lib/fault-run-catalog';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import {
  FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE,
  normalizeFaultRunRecoveryEventPayload,
  normalizeFaultRunSummaryEventPayload,
} from '../lib/fault-run-event-contract';
import { resolveScenarioContract } from '../lib/scenario-contract';
import { getTrafficScenarioTarget, TRAFFIC_SCENARIO_TARGETS } from '../lib/fault-run-targets';
import { getFaultRunDriverDescriptors, getFaultRunDrivers } from './fault-run-driver-registry';
import { FAULT_RUN_DRIVER_EXECUTION } from './fault-run-reconciler';
import { faultRunDrainParticipantForOwner } from './fault-run-drain-registry';
import { FAULT_RUN_DRIVER_CAPABILITIES } from './fault-run-driver-capabilities';

test('driver registry contains distinct real-path owners', () => {
  const drivers = getFaultRunDrivers();
  assert.deepEqual(
    drivers.map((driver) => driver.name),
    ['REPORT_SCENARIO_WORKER', 'TRAFFIC_SURGE_EXECUTOR', 'SCENARIO_WORKERS', 'RUNNER_ENGINE'],
  );
});

test('real driver coverage matches resolved Catalog owner and summary capability', () => {
  const descriptors = getFaultRunDriverDescriptors();
  const definitions = listScenarioDefinitions();
  assert.equal(new Set(descriptors.map((descriptor) => descriptor.name)).size, descriptors.length);
  assert.deepEqual(
    descriptors.map(({ name }) => name),
    FAULT_RUN_DRIVER_CAPABILITIES.map(({ name }) => name),
  );

  for (const definition of definitions) {
    const run = runForScenario(definition.scenario);
    const matches = descriptors.filter((descriptor) => descriptor.supports(run));
    assert.equal(matches.length, 1, `${definition.scenario} must have exactly one driver`);
    const descriptor = matches[0];
    assert.ok(descriptor);
    const contract = resolveScenarioContract(definition);
    assert.equal(descriptor.name, contract.dispatchOwner);
    assert.equal(descriptor.drainOwner, contract.recoveryPolicy.workerDrain.owner);
    assert.equal(descriptor.executionState, FAULT_RUN_DRIVER_EXECUTION.mode);
    assert.equal(descriptor.terminalSummaryEvent, FAULT_RUN_DRAIN_COMPLETED_EVENT_TYPE);
    assert.ok(faultRunDrainParticipantForOwner(descriptor.drainOwner));
    assert.doesNotThrow(() => normalizeFaultRunSummaryEventPayload(descriptor.summaryEventType, {}));
    assert.doesNotThrow(() => normalizeFaultRunRecoveryEventPayload(
      descriptor.terminalSummaryEvent,
      { participants: 1, completed: 1, inFlightAtFinish: 0 },
    ));
  }

  for (const capability of FAULT_RUN_DRIVER_CAPABILITIES) {
    const descriptor = descriptors.find(({ name }) => name === capability.name);
    assert.ok(descriptor);
    const actualScenarios = definitions
      .filter(({ scenario }) => descriptor.supports(runForScenario(scenario)))
      .map(({ scenario }) => scenario)
      .sort();
    assert.deepEqual(actualScenarios, [...capability.supportedScenarios].sort());
    assert.equal(descriptor.drainOwner, capability.drainOwner);
    assert.equal(descriptor.executionState, capability.executionState);
    assert.equal(descriptor.summaryEventType, capability.summaryEventType);
    assert.equal(descriptor.terminalSummaryEvent, capability.terminalSummaryEvent);
  }
});

test('local surge scenarios stay on their Worker target map outside Gateway operations', () => {
  const localScenarios = listScenarioDefinitions()
    .filter((definition) => resolveScenarioContract(definition).targetLifecycleMode === 'LOCAL_WORKER')
    .map(({ scenario }) => scenario)
    .sort();

  assert.deepEqual(localScenarios, Object.keys(TRAFFIC_SCENARIO_TARGETS).sort());
  for (const scenario of localScenarios) {
    const target = getTrafficScenarioTarget(scenario);
    assert.equal(target.scenario, scenario);
    assert.match(target.path, /^\/api\//);
  }
});

function runForScenario(scenario: FaultRunRecord['scenario']): FaultRunRecord {
  const definition = listScenarioDefinitions().find((candidate) => candidate.scenario === scenario);
  assert.ok(definition);
  return {
    faultRunId: '123e4567-e89b-12d3-a456-426614174000',
    scenario,
    targetService: definition.targetService,
    targetOperation: definition.targetOperation,
    state: 'ACTIVE',
    parameters: validateScenarioParameters(scenario, {
      durationSec: 30,
      ...(scenario === 'PSP_PROVIDER_OUTCOME' ? { providerOutcome: 'TIMEOUT' } : {}),
    }),
    contractRevision: 'sc.v1:sha256:' + '0'.repeat(64),
    idempotencyKey: `driver-contract-${scenario.toLowerCase()}`,
    fencingToken: 1,
    startedAt: '2026-09-29T00:00:00.000Z',
    expiresAt: '2026-09-29T01:00:00.000Z',
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: null,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  };
}
