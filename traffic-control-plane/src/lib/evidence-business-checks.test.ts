import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import { EvidenceBusinessCheckError, EvidenceBusinessChecks } from './evidence-business-checks';
import { parseEvidenceWebConfig } from './evidence-web-config';
import { renderEvidenceQueryPlan } from './evidence-query-plan-renderer';
import { resolveScenarioContract } from './scenario-contract';
import type { RenderedEvidenceRecipe } from './evidence-types';
import type {
  GatewayClient,
  GatewayEvidenceReadPath,
  GatewayRequestOptions,
  GatewayResponse,
} from './gateway-client';

const CHECKED_AT = '2026-10-09T06:00:00.000Z';

test('fixed Catalog product check passes only bounded page metadata and never returns rows', async () => {
  const calls: Array<{ path: GatewayEvidenceReadPath; params: Record<string, string> | undefined }> = [];
  const adapter = new EvidenceBusinessChecks(config(), fakeGateway(calls, {
    code: 200,
    message: 'OK',
    data: {
      content: [{ sku: 'SKU-001', name: 'private product' }],
      totalElements: 4321,
    },
  }));
  const result = await adapter.check(recipe('CATALOG_PRODUCT_LIST'), CHECKED_AT);

  assert.deepEqual(calls, [{
    path: '/api/products',
    params: { sort: 'latest', page: '0', size: '1' },
  }]);
  assert.deepEqual(result, {
    source: 'BUSINESS_CHECK',
    recipeId: recipe('CATALOG_PRODUCT_LIST').recipeId,
    businessCheckId: 'CATALOG_PRODUCT_LIST',
    status: 'PASS',
    checkedAt: CHECKED_AT,
    reasonCode: null,
  });
  assert.equal(JSON.stringify(result).includes('SKU-001'), false);
  assert.equal(JSON.stringify(result).includes('private product'), false);
});

test('fixed browse report check distinguishes empty and business-envelope failure', async () => {
  const calls: Array<{ path: GatewayEvidenceReadPath; params: Record<string, string> | undefined }> = [];
  const empty = new EvidenceBusinessChecks(config(), fakeGateway(calls, {
    code: 200,
    message: 'OK',
    data: [],
  }));
  const noData = await empty.check(recipe('CATALOG_BROWSE_REPORT'), CHECKED_AT);
  assert.equal(noData.status, 'NO_DATA');
  assert.equal(calls[0]?.path, '/api/reports/product-browse');
  assert.equal(calls[0]?.params, undefined);

  const failed = new EvidenceBusinessChecks(config(), fakeGateway(calls, {
    code: 503,
    message: 'private service text',
    data: null,
  }));
  const failure = await failed.check(recipe('CATALOG_BROWSE_REPORT'), CHECKED_AT);
  assert.equal(failure.status, 'FAIL');
  assert.equal(failure.reasonCode, 'BUSINESS_CHECK_FAILED');
  assert.equal(JSON.stringify(failure).includes('private service text'), false);
});

test('rejects malformed envelopes, wrong fixed shapes, and uncatalogued recipe IDs', async () => {
  const calls: Array<{ path: GatewayEvidenceReadPath; params: Record<string, string> | undefined }> = [];
  for (const body of [
    null,
    { code: '200', message: 'OK', data: [] },
    { code: 200, message: 'OK', data: { content: [{ sku: 'one' }, { sku: 'two' }] } },
    { code: 200, message: 'OK', data: { rows: [] } },
  ]) {
    const adapter = new EvidenceBusinessChecks(config(), fakeGateway(calls, body));
    await assert.rejects(
      adapter.check(recipe('CATALOG_PRODUCT_LIST'), CHECKED_AT),
      (error: unknown) => error instanceof EvidenceBusinessCheckError
        && error.code === 'BUSINESS_CHECK_RESPONSE_INVALID',
    );
  }
  const invalidRecipe = {
    ...recipe('CATALOG_PRODUCT_LIST'),
    template: 'CATALOG_BROWSE_REPORT' as const,
  };
  await assert.rejects(
    new EvidenceBusinessChecks(config(), fakeGateway(calls, {})).check(invalidRecipe, CHECKED_AT),
    (error: unknown) => error instanceof EvidenceBusinessCheckError
      && error.code === 'BUSINESS_CHECK_INVALID_RECIPE',
  );
});

test('disabled checks, provider failures and deadlines return fixed errors without payloads', async () => {
  const recipeValue = recipe('CATALOG_PRODUCT_LIST');
  const disabledCalls: Array<{ path: GatewayEvidenceReadPath; params: Record<string, string> | undefined }> = [];
  await assert.rejects(
    new EvidenceBusinessChecks(config({
      EVIDENCE_QUERY_ENABLED: 'false',
      EVIDENCE_QUERY_EXECUTION_ENABLED: 'false',
    }), fakeGateway(disabledCalls, {})).check(recipeValue, CHECKED_AT),
    (error: unknown) => error instanceof EvidenceBusinessCheckError
      && error.code === 'BUSINESS_CHECK_DISABLED',
  );
  assert.equal(disabledCalls.length, 0);

  const gatewayError = Object.assign(new Error('raw body must not escape'), { status: 503 });
  await assert.rejects(
    new EvidenceBusinessChecks(config(), {
      getBoundedEvidenceRead: async () => { throw gatewayError; },
    }).check(recipeValue, CHECKED_AT),
    (error: unknown) => error instanceof EvidenceBusinessCheckError
      && error.code === 'BUSINESS_CHECK_UNAVAILABLE'
      && !error.message.includes('raw body'),
  );

  const stalled: Pick<GatewayClient, 'getBoundedEvidenceRead'> = {
    getBoundedEvidenceRead: async (_path, _params, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('private response body', 'AbortError')),
        { once: true },
      );
    }),
  };
  await assert.rejects(
    new EvidenceBusinessChecks(config({ EVIDENCE_SOURCE_TIMEOUT_MS: '100' }), stalled)
      .check(recipeValue, CHECKED_AT),
    (error: unknown) => error instanceof EvidenceBusinessCheckError
      && error.code === 'BUSINESS_CHECK_TIMEOUT',
  );
});

function recipe(checkId: 'CATALOG_PRODUCT_LIST' | 'CATALOG_BROWSE_REPORT'): RenderedEvidenceRecipe {
  const scenario = checkId === 'CATALOG_PRODUCT_LIST' ? 'BROWSE_SURGE' : 'BROWSE_REPORT_SQL';
  const definition = listScenarioDefinitions().find((candidate) => candidate.scenario === scenario)!;
  const contract = resolveScenarioContract(definition);
  const plan = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900,
    active: definition.maxDurationSec + 60,
    recovery: 2100,
    cleanup: 600,
  });
  const result = plan.recipes.find((candidate) =>
    candidate.source === 'BUSINESS_CHECK' && candidate.businessCheckId === checkId);
  if (!result) throw new Error(`MISSING_EVIDENCE_CHECK:${checkId}`);
  return result;
}

function config(overrides: Record<string, string | undefined> = {}) {
  return parseEvidenceWebConfig({
    EVIDENCE_QUERY_ENABLED: 'true',
    EVIDENCE_QUERY_EXECUTION_ENABLED: 'true',
    ...overrides,
  });
}

function fakeGateway(
  calls: Array<{ path: GatewayEvidenceReadPath; params: Record<string, string> | undefined }>,
  body: unknown,
): Pick<GatewayClient, 'getBoundedEvidenceRead'> {
  return {
    getBoundedEvidenceRead: async <T = unknown>(
      path: string,
      params: Record<string, string> | undefined,
      _options: GatewayRequestOptions & { readonly maxResponseBytes: number },
    ): Promise<GatewayResponse<T>> => {
      void _options;
      if (path !== '/api/products' && path !== '/api/reports/product-browse') {
        throw new Error('UNEXPECTED_GATEWAY_PATH');
      }
      calls.push({ path, params });
      return { body: body as T };
    },
  };
}
