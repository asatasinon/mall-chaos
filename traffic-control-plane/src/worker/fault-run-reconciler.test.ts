import assert from 'node:assert/strict';
import test from 'node:test';
import { FaultRunReconciler } from './fault-run-reconciler';
import type { FaultRunExecutionRecord } from '../lib/fault-run-execution-repository';
import type { FaultRunRecord } from '../lib/fault-run-repository';
import type { OwnedFaultRunDriver } from './fault-run-driver';

const run: FaultRunRecord = {
  faultRunId: '123e4567-e89b-12d3-a456-426614174000',
  scenario: 'BROWSE_REPORT_SQL',
  targetService: 'catalog-service',
  targetOperation: 'products-browse-report',
  state: 'ACTIVE',
  parameters: { durationSec: 60 },
  idempotencyKey: 'reconciler-test-key',
  fencingToken: 1,
  startedAt: '2026-09-21T01:00:00.000Z',
  expiresAt: '2026-09-21T02:00:00.000Z',
  stoppedAt: null,
  stopReason: null,
  recoveryResult: null,
  recoveryError: null,
  operatorAuditId: null,
  traceId: 'reconciler-test-trace',
  createdAt: '2026-09-21T01:00:00.000Z',
  updatedAt: '2026-09-21T01:00:00.000Z',
};

function execution(overrides: Partial<FaultRunExecutionRecord> = {}): FaultRunExecutionRecord {
  return {
    faultRunId: run.faultRunId,
    executionMode: 'TAKEOVER',
    ownerId: null,
    ownerEpoch: 0,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    leaseLostAt: null,
    reconciledAt: null,
    reconciliationState: 'IDLE',
    drainState: 'IDLE',
    drainDeadlineAt: null,
    lastAction: null,
    lastActionAt: null,
    lastErrorCode: null,
    createdAt: '2026-09-21T01:00:00.000Z',
    updatedAt: '2026-09-21T01:00:00.000Z',
    ...overrides,
  };
}

function driver(started: string[], stopped: string[]): OwnedFaultRunDriver {
  return {
    name: 'test-driver',
    supports: () => true,
    start: async () => {
      started.push(run.faultRunId);
      return {
        stop: async () => {
          stopped.push(run.faultRunId);
          return { drained: true };
        },
      };
    },
  };
}

test('reconciler claims an initial owner and starts one supported driver', async () => {
  let current = execution();
  const started: string[] = [];
  const stopped: string[] = [];
  const claims: string[] = [];
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadExecution: async () => current,
    claimExecution: async (input) => {
      if (current.ownerId !== null) return null;
      current = execution({
        ownerId: input.ownerId,
        ownerEpoch: 1,
        reconciliationState: input.reconciliationState,
        drainState: 'OWNED',
      });
      claims.push(input.ownerId);
      return current;
    },
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [driver(started, stopped)],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER',
    ownerId: 'worker-a',
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    reconcileIntervalMs: 1_000,
  });

  await reconciler.scan();
  await reconciler.scan();

  assert.deepEqual(claims, ['worker-a']);
  assert.deepEqual(started, [run.faultRunId]);
  assert.deepEqual(reconciler.getOwnedRunIds(), [run.faultRunId]);
  await reconciler.stop();
  assert.deepEqual(stopped, [run.faultRunId]);
});

test('shadow mode records stale takeover without claiming or starting a driver', async () => {
  const updates: string[] = [];
  let claims = 0;
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadExecution: async () => execution({
      ownerId: 'old-worker',
      ownerEpoch: 3,
      leaseExpiresAt: '2026-09-21T00:59:00.000Z',
    }),
    claimExecution: async () => {
      claims++;
      return null;
    },
    heartbeatExecution: async () => true,
    markLeaseLost: async () => true,
    updateExecution: async (input) => {
      updates.push(input.lastAction ?? '');
      return true;
    },
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'SHADOW',
    ownerId: 'worker-new',
    leaseTtlMs: 30_000,
    heartbeatMs: 5_000,
    reconcileIntervalMs: 1_000,
  });

  await reconciler.scan();

  assert.equal(claims, 0);
  assert.deepEqual(updates, ['TAKEOVER_SHADOW_PLANNED']);
  assert.deepEqual(reconciler.getOwnedRunIds(), []);
});

test('heartbeat loss fences and drains the owned driver', async () => {
  let heartbeatCalls = 0;
  let markedLost = 0;
  let stopped = 0;
  let current = execution();
  const reconciler = new FaultRunReconciler({
    listCandidates: async () => [run],
    loadExecution: async () => current,
    claimExecution: async (input) => {
      current = execution({
        ownerId: input.ownerId,
        ownerEpoch: 1,
        reconciliationState: 'OWNED',
        drainState: 'OWNED',
      });
      return current;
    },
    heartbeatExecution: async () => {
      heartbeatCalls++;
      return false;
    },
    markLeaseLost: async () => {
      markedLost++;
      return true;
    },
    updateExecution: async () => true,
    relinquishExecution: async () => true,
    appendEvent: async () => undefined,
    drivers: [{
      name: 'heartbeat-test-driver',
      supports: () => true,
      start: async () => ({
        stop: async () => {
          stopped++;
          return { drained: true };
        },
      }),
    }],
    now: () => new Date('2026-09-21T01:00:00.000Z'),
    logger: { warn: () => undefined, info: () => undefined },
  }, {
    mode: 'TAKEOVER',
    ownerId: 'worker-a',
    leaseTtlMs: 30_000,
    heartbeatMs: 5,
    reconcileIntervalMs: 1000,
  });

  await reconciler.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await reconciler.stop();

  assert.equal(heartbeatCalls > 0, true);
  assert.equal(markedLost, 1);
  assert.equal(stopped, 1);
  assert.deepEqual(reconciler.getOwnedRunIds(), []);
});
