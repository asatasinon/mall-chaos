import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import { renderEvidenceQueryPlan } from './evidence-query-plan-renderer';
import {
  EVIDENCE_MAX_RANGE_POINTS_PER_SERIES,
  EVIDENCE_MAX_SERIES_PER_QUERY,
  EvidenceQueryClientError,
  EvidenceQueryClients,
} from './evidence-query-clients';
import { parseEvidenceWebConfig } from './evidence-web-config';
import { resolveScenarioContract } from './scenario-contract';
import type { RenderedEvidenceRecipe } from './evidence-types';

const RANGE = {
  startAt: '2026-10-09T05:00:00.000Z',
  endAt: '2026-10-09T06:00:00.000Z',
};

test('Prometheus adapter builds only the fixed range request and drops labels from its projection', async () => {
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const clients = new EvidenceQueryClients(config(), async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return jsonResponse({
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [{
          metric: { service: 'order-service', uri: '/api/orders', privateLabel: 'must-not-escape' },
          values: [[1_791_522_000, '2.5'], [1_791_522_015, 'NaN'], [1_791_522_030, '+Inf']],
        }],
      },
    });
  });

  const result = await clients.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE);
  assert.deepEqual(result, {
    source: 'PROMETHEUS',
    recipeId: recipe('PROMETHEUS', 'HTTP_P99').recipeId,
    startAt: RANGE.startAt,
    endAt: RANGE.endAt,
    stepSec: 15,
    hasWarnings: false,
    truncated: false,
    series: [[
      { timestampMs: 1_791_522_000_000, value: 2.5, reasonCode: null },
      { timestampMs: 1_791_522_015_000, value: null, reasonCode: 'NON_FINITE_SAMPLE' },
      { timestampMs: 1_791_522_030_000, value: null, reasonCode: 'NON_FINITE_SAMPLE' },
    ]],
  });
  assert.equal(requests[0]?.url.pathname, '/api/v1/query_range');
  assert.equal(requests[0]?.url.searchParams.get('query'),
    recipe('PROMETHEUS', 'HTTP_P99').renderedQuery);
  assert.equal(requests[0]?.url.searchParams.get('start'), '1791522000.000');
  assert.equal(requests[0]?.url.searchParams.get('end'), '1791525600.000');
  assert.equal(requests[0]?.url.searchParams.get('step'), '15s');
  assert.equal(EVIDENCE_MAX_SERIES_PER_QUERY, 64);
  assert.equal(EVIDENCE_MAX_RANGE_POINTS_PER_SERIES, 1500);
  assert.equal(requests[0]?.init?.redirect, 'manual');
  assert.equal(requests[0]?.init?.cache, 'no-store');
  assert.equal(JSON.stringify(result).includes('privateLabel'), false);

  const warned = new EvidenceQueryClients(config(), async () => jsonResponse({
    status: 'success',
    warnings: ['private warning text'],
    data: { resultType: 'matrix', result: [] },
  }));
  const warnedResult = await warned.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE);
  assert.equal(warnedResult.source, 'PROMETHEUS');
  if (warnedResult.source === 'PROMETHEUS') {
    assert.equal(warnedResult.hasWarnings, true);
  }
  assert.equal(JSON.stringify(warnedResult).includes('private warning text'), false);
});

test('Loki adapter uses bounded service-only aggregate queries and checks series count', async () => {
  const requestUrls: URL[] = [];
  const clients = new EvidenceQueryClients(config(), async (input) => {
    requestUrls.push(new URL(String(input)));
    return jsonResponse({
      status: 'success',
      data: { resultType: 'matrix', result: [{ stream: { service: 'catalog-service' }, values: [[1_791_522_000, '1']] }] },
    });
  });
  const lokiRecipe = recipe('LOKI', 'SERVICE_ERROR_COUNT');
  assert.equal(lokiRecipe.scopeMode, 'SERVICE_ONLY');
  const result = await clients.query(lokiRecipe, RANGE);
  assert.equal(result.source, 'LOKI');
  assert.equal(requestUrls[0]?.pathname, '/loki/api/v1/query_range');
  assert.equal(requestUrls[0]?.searchParams.get('limit'), '64');
  assert.equal(requestUrls[0]?.searchParams.get('direction'), 'forward');
  assert.equal(requestUrls[0]?.searchParams.get('query'), lokiRecipe.renderedQuery);
  assert.equal(requestUrls[0]?.searchParams.get('query')?.includes('/api/'), false);
});

test('Tempo adapter caps results and marks a limit-sized search as incomplete', async () => {
  const requestUrls: URL[] = [];
  const traces = Array.from({ length: 100 }, (_, index) => ({
    traceID: `private-trace-${index}`,
    durationMs: index * 10,
    rootServiceName: 'catalog-service',
  }));
  const clients = new EvidenceQueryClients(config(), async (input) => {
    requestUrls.push(new URL(String(input)));
    return jsonResponse({ traces });
  });
  const tempoRecipe = recipe('TEMPO', 'SERVICE_SLOW_REQUESTS');
  const result = await clients.query(tempoRecipe, RANGE);
  assert.deepEqual(requestUrls[0]?.pathname, '/api/search');
  assert.equal(requestUrls[0]?.searchParams.get('limit'), '100');
  assert.equal(requestUrls[0]?.searchParams.get('q'), tempoRecipe.renderedQuery);
  assert.equal(result.source, 'TEMPO');
  if (result.source !== 'TEMPO') assert.fail('Expected a Tempo result');
  assert.equal(result.traceCount, 100);
  assert.equal(result.truncated, true);
  assert.equal(result.reasonCode, 'SEARCH_INCOMPLETE');
  assert.equal(result.durationsMs[1], 10);
  assert.equal(JSON.stringify(result).includes('private-trace'), false);
});

test('Tempo only reports a complete empty result when search job completeness is explicit', async () => {
  for (const [payload, expectedIncomplete] of [
    [{ traces: [] }, true],
    [{ traces: [], metrics: { completedJobs: 1, totalJobs: 2 } }, true],
    [{ traces: [], metrics: { completedJobs: 1, totalJobs: 1 } }, false],
  ] as const) {
    const clients = new EvidenceQueryClients(config(), async () => jsonResponse(payload));
    const result = await clients.query(recipe('TEMPO', 'SERVICE_SLOW_REQUESTS'), RANGE);
    assert.equal(result.source, 'TEMPO');
    if (result.source !== 'TEMPO') assert.fail('Expected a Tempo result');
    assert.equal(result.traceCount, 0);
    assert.equal(result.truncated, expectedIncomplete);
    assert.equal(result.reasonCode, expectedIncomplete ? 'SEARCH_INCOMPLETE' : null);
  }
});

test('zero-length windows and disabled or unconfigured sources never send a request', async () => {
  let requests = 0;
  const enabled = new EvidenceQueryClients(config({ EVIDENCE_PROMETHEUS_BASE_URL: undefined }), async () => {
    requests++;
    return jsonResponse({});
  });
  await assert.rejects(
    enabled.query(recipe('PROMETHEUS', 'HTTP_P99'), {
      startAt: RANGE.startAt, endAt: RANGE.startAt,
    }),
    queryError('INVALID_QUERY'),
  );
  await assert.rejects(
    enabled.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE),
    queryError('SOURCE_UNCONFIGURED'),
  );

  const disabled = new EvidenceQueryClients(config({
    EVIDENCE_QUERY_ENABLED: 'false',
    EVIDENCE_QUERY_EXECUTION_ENABLED: 'false',
  }), async () => {
    requests++;
    return jsonResponse({});
  });
  await assert.rejects(
    disabled.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE),
    queryError('SOURCE_UNCONFIGURED'),
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    new EvidenceQueryClients(config(), async () => {
      requests++;
      return jsonResponse({});
    }).query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE, aborted.signal),
    queryError('SOURCE_UNREACHABLE'),
  );
  assert.equal(requests, 0);
});

test('provider errors map to safe stable codes and redirects are not followed', async () => {
  for (const [status, code] of [
    [400, 'INVALID_QUERY'],
    [401, 'SOURCE_UNAUTHORIZED'],
    [403, 'SOURCE_UNAUTHORIZED'],
    [429, 'SOURCE_RATE_LIMITED'],
    [503, 'SOURCE_UNREACHABLE'],
    [302, 'SOURCE_REDIRECT_REJECTED'],
  ] as const) {
    const clients = new EvidenceQueryClients(config(), async () => new Response('private error detail', {
      status,
      headers: { 'content-type': 'text/plain', location: 'http://internal-redirect/' },
    }));
    await assert.rejects(
      clients.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE),
      queryError(code),
    );
  }
});

test('content type, malformed payload, series count and byte caps fail closed', async () => {
  const boundaryClients = new EvidenceQueryClients(config(), async () => jsonResponse({
    status: 'success',
    data: {
      resultType: 'matrix',
      result: Array.from({ length: EVIDENCE_MAX_SERIES_PER_QUERY }, (_, index) => ({
        metric: { series: String(index) },
        values: [],
      })),
    },
  }));
  const boundary = await boundaryClients.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE);
  assert.equal(boundary.source, 'PROMETHEUS');
  if (boundary.source === 'PROMETHEUS') {
    assert.equal(boundary.series.length, EVIDENCE_MAX_SERIES_PER_QUERY);
  }

  const invalidResponses = [
    new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
    jsonResponse({
      status: 'success',
      data: {
        resultType: 'matrix',
        result: Array.from({ length: 65 }, () => ({ metric: {}, values: [] })),
      },
    }),
    new Response('x'.repeat(2048), { headers: { 'content-type': 'application/json' } }),
  ];
  const expected = [
    'SOURCE_RESPONSE_INVALID',
    'SOURCE_RESPONSE_INVALID',
    'SOURCE_RESPONSE_INVALID',
    'QUERY_RESULT_TOO_LARGE',
    'QUERY_RESULT_TOO_LARGE',
  ] as const;
  for (const [index, response] of invalidResponses.entries()) {
    const clients = new EvidenceQueryClients(config({ EVIDENCE_MAX_RESPONSE_BYTES: '1024' }), async () => response);
    await assert.rejects(
      clients.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE),
      queryError(expected[index]!),
    );
  }

  const pointOverflow = new EvidenceQueryClients(config(), async () => jsonResponse({
    status: 'success',
    data: {
      resultType: 'matrix',
      result: [{
        metric: {},
        values: Array.from({ length: 1501 }, (_, index) => [1_791_522_000 + index * 15, '1']),
      }],
    },
  }));
  const boundedPoints = await pointOverflow.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE);
  assert.equal(boundedPoints.source, 'PROMETHEUS');
  if (boundedPoints.source === 'PROMETHEUS') {
    assert.equal(boundedPoints.series[0]?.length, EVIDENCE_MAX_RANGE_POINTS_PER_SERIES);
    assert.equal(boundedPoints.truncated, true);
  }
});

test('source timeouts abort the request and return a provider-safe timeout code', async () => {
  const clients = new EvidenceQueryClients(
    config({ EVIDENCE_SOURCE_TIMEOUT_MS: '100' }),
    async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }),
  );
  await assert.rejects(
    clients.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE),
    queryError('SOURCE_TIMEOUT'),
  );
});

test('retries only bounded transient failures once and stops on non-retryable server errors', async () => {
  let retries = 0;
  const retried = new EvidenceQueryClients(config(), async () => {
    retries++;
    return retries === 1
      ? new Response('rate limited', { status: 429 })
      : jsonResponse({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      });
  });
  const result = await retried.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE);
  assert.equal(result.source, 'PROMETHEUS');
  assert.equal(retries, 2);

  let serverErrors = 0;
  const notRetried = new EvidenceQueryClients(config(), async () => {
    serverErrors++;
    return new Response('server error', { status: 500 });
  });
  await assert.rejects(
    notRetried.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE),
    queryError('SOURCE_UNREACHABLE'),
  );
  assert.equal(serverErrors, 1);

  let disconnectedCalls = 0;
  const disconnected = new EvidenceQueryClients(config(), async () => {
    disconnectedCalls++;
    if (disconnectedCalls === 1) throw new TypeError('private network detail');
    return jsonResponse({ status: 'success', data: { resultType: 'matrix', result: [] } });
  });
  const afterDisconnect = await disconnected.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE);
  assert.equal(afterDisconnect.source, 'PROMETHEUS');
  assert.equal(disconnectedCalls, 2);

  for (const status of [400, 401, 403]) {
    let calls = 0;
    const client = new EvidenceQueryClients(config(), async () => {
      calls++;
      return new Response('denied', { status });
    });
    await assert.rejects(
      client.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE),
      queryError(status === 400 ? 'INVALID_QUERY' : 'SOURCE_UNAUTHORIZED'),
    );
    assert.equal(calls, 1, `status ${status} must not retry`);
  }

  let gatewayFailures = 0;
  const gatewayRetry = new EvidenceQueryClients(config(), async () => {
    gatewayFailures++;
    return gatewayFailures === 1
      ? new Response('temporarily unavailable', { status: 503 })
      : jsonResponse({ status: 'success', data: { resultType: 'matrix', result: [] } });
  });
  await gatewayRetry.query(recipe('PROMETHEUS', 'HTTP_P99'), RANGE);
  assert.equal(gatewayFailures, 2);
});

function config(overrides: Record<string, string | undefined> = {}) {
  return parseEvidenceWebConfig({
    EVIDENCE_QUERY_ENABLED: 'true',
    EVIDENCE_QUERY_EXECUTION_ENABLED: 'true',
    EVIDENCE_PROMETHEUS_BASE_URL: 'http://prometheus.internal',
    EVIDENCE_LOKI_BASE_URL: 'http://loki.internal',
    EVIDENCE_TEMPO_BASE_URL: 'http://tempo.internal',
    ...overrides,
  });
}

function recipe(source: 'PROMETHEUS' | 'LOKI' | 'TEMPO', template: string): RenderedEvidenceRecipe {
  const definition = listScenarioDefinitions().find(({ scenario }) => scenario === 'ORDER_QUERY_SURGE')!;
  const contract = resolveScenarioContract(definition);
  const plan = renderEvidenceQueryPlan(contract.evidence, {
    baseline: 900, active: definition.maxDurationSec + 60, recovery: 2100, cleanup: 600,
  });
  const rendered = plan.recipes.find((candidate) =>
    candidate.source === source && candidate.template === template && candidate.window === 'active');
  if (!rendered) throw new Error(`MISSING_EVIDENCE_RECIPE:${source}:${template}`);
  return rendered;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function queryError(code: string) {
  return (error: unknown) => error instanceof EvidenceQueryClientError && error.code === code;
}
