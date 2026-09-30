import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import type { FaultRunRecord } from '@/lib/fault-run-repository';
import {
  createFaultRunCreateRouteHandler,
  type FaultRunCreateRouteDependencies,
} from '@/lib/fault-run-create-route-handler';
import { ScenarioContractAdmissionError } from '@/lib/scenario-contract-admission';

const contractRevision = 'sc.v1:sha256:' + 'a'.repeat(64);
const run: FaultRunRecord = {
  faultRunId: '123e4567-e89b-12d3-a456-426614174000',
  scenario: 'BROWSE_REPORT_SQL',
  targetService: 'catalog-service',
  targetOperation: 'products-browse-report',
  state: 'CREATING',
  parameters: { durationSec: 30 },
  contractRevision,
  idempotencyKey: 'route-create-key-001',
  fencingToken: 1,
  startedAt: null,
  expiresAt: '2026-09-30T12:00:00.000Z',
  stoppedAt: null,
  stopReason: null,
  recoveryResult: null,
  recoveryError: null,
  operatorAuditId: null,
  traceId: 'trace-route',
  createdAt: '2026-09-30T11:00:00.000Z',
  updatedAt: '2026-09-30T11:00:00.000Z',
};

function request() {
  return new NextRequest('http://localhost/internal/fault-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenario: 'BROWSE_REPORT_SQL',
      parameters: { durationSec: 30 },
      idempotencyKey: 'route-create-key-001',
      confirmed: true,
    }),
  });
}

function createDependencies(
  overrides: Partial<FaultRunCreateRouteDependencies> = {},
): FaultRunCreateRouteDependencies {
  return {
    safeRuntimeEnabled: () => false,
    reconciliationMode: () => 'OFF',
    admissionConfig: () => ({ validationMode: 'warn', deploymentScope: 'retained' }),
    createRun: async () => ({ run, created: true, action: null }),
    verifyOwnershipSchema: async () => undefined,
    recordAudit: async () => 1,
    attachAudit: async () => undefined,
    traceId: () => 'trace-route',
    csrfValid: () => true,
    ...overrides,
  };
}

test('maps named admission errors to fixed safe Operator envelopes and audit codes', async () => {
  for (const [code, status, message] of [
    [
      'SCENARIO_CONTRACT_INVALID',
      503,
      'Scenario contract is temporarily unavailable',
    ],
    [
      'SCENARIO_CONTRACT_DEPLOYMENT_SCOPE_RESTRICTED',
      409,
      'This scenario is not available in the configured deployment scope',
    ],
  ] as const) {
    const auditRecords: Array<Parameters<FaultRunCreateRouteDependencies['recordAudit']>[0]> = [];
    const runCommands: Parameters<FaultRunCreateRouteDependencies['createRun']>[0][] = [];
    const handler = createFaultRunCreateRouteHandler(createDependencies({
      createRun: async (command) => {
        runCommands.push(command);
        const admissionError = Object.assign(new ScenarioContractAdmissionError(code), {
          validatorDetails: 'RAW_VALIDATOR_DETAIL',
        });
        admissionError.stack = 'RAW_VALIDATOR_STACK';
        throw admissionError;
      },
      recordAudit: async (input) => {
        auditRecords.push(input);
        return 1;
      },
    }));

    const response = await handler(request());
    const body = await response.json();

    assert.equal(response.status, status);
    assert.deepEqual(body, { code: status, message, data: null });
    assert.deepEqual(runCommands[0]?.scenarioContractAdmission, {
      validationMode: 'warn',
      deploymentScope: 'retained',
    });
    assert.equal(auditRecords.length, 1);
    assert.equal(auditRecords[0]?.action, code);
    assert.equal(auditRecords[0]?.target, 'BROWSE_REPORT_SQL');
    assert.equal(auditRecords[0]?.parameters, undefined);
    assert.equal(auditRecords[0]?.correlationId, 'trace-route');
    assert.equal(JSON.stringify(body).includes('diagnostic'), false);
    assert.equal(JSON.stringify(body).includes('stack'), false);
    assert.equal(JSON.stringify(body).includes('RAW_VALIDATOR_DETAIL'), false);
    assert.equal(JSON.stringify(body).includes('RAW_VALIDATOR_STACK'), false);
  }
});

test('exact replay returns the Operator revision without writing success audit', async () => {
  let auditWrites = 0;
  let auditAttachments = 0;
  const handler = createFaultRunCreateRouteHandler(createDependencies({
    createRun: async () => ({ run, created: false, action: null }),
    recordAudit: async () => {
      auditWrites++;
      return 1;
    },
    attachAudit: async () => {
      auditAttachments++;
    },
  }));

  const response = await handler(request());
  const body = await response.json() as {
    data?: { state?: string; contractRevision?: string };
  };

  assert.equal(response.status, 200);
  assert.equal(body.data?.state, 'CREATING');
  assert.equal(body.data?.contractRevision, contractRevision);
  assert.equal(auditWrites, 0);
  assert.equal(auditAttachments, 0);
});
