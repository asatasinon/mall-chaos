import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GatewayRequestError,
  type GatewayResponse,
  type GatewayClient,
} from '../lib/gateway-client';
import { extractFaultRunTargetSummary } from '../lib/fault-run-repository';
import {
  ExerciseRequestCacheError,
  ExerciseRequestTimeoutError,
} from './controlled-exercise-worker';
import { readCatalogProductDetail, ScenarioExerciseWorkers } from './scenario-exercise-workers';

test('catalog reader returns the low-cardinality cache result from Gateway metadata', async () => {
  let requestedPath = '';
  const gateway = {
    async getWithMetadata(path: string): Promise<GatewayResponse<{ data: { sku: string } }>> {
      requestedPath = path;
      return { body: { data: { sku: 'SKU-001' } }, cacheResult: 'CACHE_HIT' };
    },
  };

  const result = await readCatalogProductDetail(gateway, 'SKU-001', new AbortController().signal, 5000);

  assert.equal(requestedPath, '/api/products/SKU-001');
  assert.deepEqual(result, { cacheResult: 'CACHE_HIT' });
});

test('catalog reader maps an HTTP cache backend failure to a stable cache result', async () => {
  const gateway = {
    async getWithMetadata(): Promise<GatewayResponse<unknown>> {
      throw new GatewayRequestError('GET', '/api/products/SKU-001', 503);
    },
  };

  await assert.rejects(
    () => readCatalogProductDetail(gateway, 'SKU-001', new AbortController().signal, 5000),
    (error: unknown) => error instanceof ExerciseRequestCacheError
      && error.cacheResult === 'CACHE_BACKEND_ERROR',
  );
});

test('catalog reader distinguishes response mismatch from timeout', async () => {
  const mismatchGateway = {
    async getWithMetadata(): Promise<GatewayResponse<{ data: { sku: string } }>> {
      return { body: { data: { sku: 'SKU-002' } } };
    },
  };
  await assert.rejects(
    () => readCatalogProductDetail(mismatchGateway, 'SKU-001', new AbortController().signal, 5000),
    /PRODUCT_DETAIL_RESPONSE_INVALID/,
  );

  const timeoutGateway = {
    async getWithMetadata(_path: string, _params: unknown, options: { signal?: AbortSignal }) {
      return new Promise<GatewayResponse<unknown>>((_, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  };
  await assert.rejects(
    () => readCatalogProductDetail(timeoutGateway, 'SKU-001', new AbortController().signal, 100),
    (error: unknown) => error instanceof ExerciseRequestTimeoutError
      && error.message === 'PRODUCT_DETAIL_TIMEOUT',
  );
});

test('target summary parser accepts only a complete Hash member set', () => {
  const faultRunId = '123e4567-e89b-12d3-a456-426614174000';
  const valid = extractFaultRunTargetSummary(faultRunId, {
    targetSummary: {
      layout: 'HASH',
      hashKey: `catalog:product-detail:exercise:${faultRunId}`,
      memberCount: 2,
      memberSizeBytes: 1024,
      logicalBytes: 2048,
      keyTtlSec: 900,
      probeSku: 'SKU-003',
      memberSkus: ['SKU-001', 'SKU-002'],
      value: 'must not be returned',
    },
  });
  assert.deepEqual(valid?.memberSkus, ['SKU-001', 'SKU-002']);
  assert.equal('value' in (valid ?? {}), false);

  assert.equal(extractFaultRunTargetSummary(faultRunId, {
    targetSummary: {
      layout: 'HASH',
      hashKey: `catalog:product-detail:exercise:${faultRunId}`,
      memberCount: 2,
      memberSizeBytes: 1024,
      logicalBytes: 2048,
      keyTtlSec: 900,
      probeSku: 'SKU-002',
      memberSkus: ['SKU-001', 'SKU-002'],
    },
  }), null);
});

test('scenario worker reads only persisted member SKUs and does not create a customer session', async () => {
  const run = {
    faultRunId: '123e4567-e89b-12d3-a456-426614174000',
    scenario: 'CATALOG_REDIS_LARGE_VALUE',
    targetService: 'catalog-service',
    targetOperation: 'catalog-product-detail-large-value',
    state: 'ACTIVE',
    parameters: { concurrency: 1, requestIntervalMs: 0 },
    idempotencyKey: 'phase-e-worker-001',
    fencingToken: 1,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 40).toISOString(),
    stoppedAt: null,
    stopReason: null,
    recoveryResult: null,
    recoveryError: null,
    operatorAuditId: null,
    traceId: 'trace-phase-e',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as const;
  const requested: string[] = [];
  const events: Array<{ type: string; payload?: unknown }> = [];
  const worker = new ScenarioExerciseWorkers({
    gateway: {
      async getWithMetadata(path: string): Promise<GatewayResponse<{ data: { sku: string } }>> {
        requested.push(path);
        return { body: { data: { sku: path.split('/').pop()! } }, cacheResult: 'CACHE_HIT' };
      },
    } as unknown as GatewayClient,
    listActiveRuns: async () => [run],
    loadTargetSummary: async () => ({
      layout: 'HASH',
      hashKey: `catalog:product-detail:exercise:${run.faultRunId}`,
      memberCount: 1,
      memberSizeBytes: 1024,
      logicalBytes: 1024,
      keyTtlSec: 120,
      probeSku: 'SKU-002',
      memberSkus: ['SKU-001'],
    }),
    appendEvent: async (faultRunId, type, payload) => {
      events.push({ type, payload });
      assert.equal(faultRunId, run.faultRunId);
    },
    registerRunDrain: (_faultRunId, drain) => {
      void drain;
      return () => undefined;
    },
  });

  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  await worker.stop();

  assert.equal(requested.some((path) => path === '/api/products/SKU-001'), true);
  assert.equal(requested.some((path) => path === '/api/products/SKU-002'), false);
  assert.equal(events.some((event) => event.type === 'EXERCISE_WORKER_STARTED'), true);
  assert.equal(events.some((event) => event.type === 'SCENARIO_WORKER_DRAINED'), true);
});