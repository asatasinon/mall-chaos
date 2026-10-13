import type { EvidenceWebConfig, EvidenceSourceConfig } from './evidence-web-config';
import type { RenderedEvidenceRecipe } from './evidence-types';
import { EvidenceTypeError, parseEvidenceSqlTimestamp } from './evidence-types';
import { isAbortError } from './abort-signal';
import { BoundedJsonResponseError, readBoundedJsonResponse } from './bounded-json-response';

export const EVIDENCE_MAX_SERIES_PER_QUERY = 64;
export const EVIDENCE_MAX_RANGE_POINTS_PER_SERIES = 1500;
export const EVIDENCE_MAX_TEMPO_SEARCH_RESULTS = 100;

export type EvidenceQueryClientErrorCode =
  | 'SOURCE_UNCONFIGURED'
  | 'SOURCE_TIMEOUT'
  | 'SOURCE_UNREACHABLE'
  | 'SOURCE_RATE_LIMITED'
  | 'SOURCE_UNAUTHORIZED'
  | 'SOURCE_RESPONSE_INVALID'
  | 'SOURCE_REDIRECT_REJECTED'
  | 'QUERY_RESULT_TOO_LARGE'
  | 'INVALID_QUERY'
  | 'SEARCH_INCOMPLETE';

export class EvidenceQueryClientError extends Error {
  constructor(readonly code: EvidenceQueryClientErrorCode, readonly retryable = false) {
    super(code);
    this.name = 'EvidenceQueryClientError';
  }
}

export interface EvidenceQueryRange {
  readonly startAt: string;
  readonly endAt: string;
}

export interface NumericSample {
  readonly timestampMs: number;
  readonly value: number | null;
  readonly reasonCode: 'NON_FINITE_SAMPLE' | null;
}

export interface MetricRangeResult {
  readonly source: 'PROMETHEUS' | 'LOKI';
  readonly recipeId: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly stepSec: number;
  readonly hasWarnings: boolean;
  readonly truncated: boolean;
  readonly series: readonly (readonly NumericSample[])[];
}

export interface TempoSearchResult {
  readonly source: 'TEMPO';
  readonly recipeId: string;
  readonly traceCount: number;
  readonly durationsMs: readonly number[];
  readonly truncated: boolean;
  readonly reasonCode: 'SEARCH_INCOMPLETE' | null;
}

export type EvidenceQueryClientResponse = MetricRangeResult | TempoSearchResult;

type FetchFunction = typeof fetch;

const HTTP_SERIES_TEMPLATES = new Set([
  'HTTP_P99',
  'HTTP_ERROR_RATIO',
  'HTTP_RATE',
  'HIKARI_UTILIZATION',
  'JVM_HEAP_RATIO',
  'MYSQL_SLOW_QUERY_RATE',
  'PAYMENT_FAILURE_RATIO',
  'PAYMENT_TIMEOUT_RATE',
  'REDIS_MEMORY_RATIO',
  'NODE_FILESYSTEM_RATIO',
  'NODE_FILESYSTEM_GROWTH_RATE',
]);

const LOKI_TEMPLATES = new Set(['SERVICE_EVENT_COUNT', 'SERVICE_ERROR_COUNT']);
const TEMPO_TEMPLATES = new Set([
  'SERVICE_REQUESTS',
  'SERVICE_ERRORS',
  'SERVICE_SLOW_REQUESTS',
  'SERVICE_ROUTE_REQUESTS',
]);

export class EvidenceQueryClients {
  constructor(
    private readonly config: EvidenceWebConfig,
    private readonly fetchFn: FetchFunction = fetch,
  ) {}

  async query(
    recipe: RenderedEvidenceRecipe,
    range: EvidenceQueryRange,
    signal?: AbortSignal,
  ): Promise<EvidenceQueryClientResponse> {
    if (!this.config.queryEnabled || !this.config.executionEnabled) {
      throw new EvidenceQueryClientError('SOURCE_UNCONFIGURED');
    }
    const bounds = parseRange(range);
    if (recipe.renderedQuery === null
      || recipe.observationMode !== 'WINDOWED'
      || recipe.window === 'cleanup' && recipe.source !== 'PROMETHEUS'
        && recipe.source !== 'LOKI' && recipe.source !== 'TEMPO') {
      throw new EvidenceQueryClientError('INVALID_QUERY');
    }

    switch (recipe.source) {
      case 'PROMETHEUS':
        if (recipe.scopeMode !== 'DECLARED' || !HTTP_SERIES_TEMPLATES.has(recipe.template)) {
          throw new EvidenceQueryClientError('INVALID_QUERY');
        }
        return this.queryMetrics('PROMETHEUS', this.config.prometheus, recipe, bounds, signal);
      case 'LOKI':
        if (!LOKI_TEMPLATES.has(recipe.template) || recipe.scopeMode !== 'SERVICE_ONLY') {
          throw new EvidenceQueryClientError('INVALID_QUERY');
        }
        return this.queryMetrics('LOKI', this.config.loki, recipe, bounds, signal);
      case 'TEMPO':
        if (!TEMPO_TEMPLATES.has(recipe.template)) {
          throw new EvidenceQueryClientError('INVALID_QUERY');
        }
        return this.queryTempo(this.config.tempo, recipe, bounds, signal);
      default:
        throw new EvidenceQueryClientError('INVALID_QUERY');
    }
  }

  private async queryMetrics(
    source: 'PROMETHEUS' | 'LOKI',
    sourceConfig: EvidenceSourceConfig,
    recipe: RenderedEvidenceRecipe,
    bounds: { startMs: number; endMs: number },
    signal?: AbortSignal,
  ): Promise<MetricRangeResult> {
    const stepSec = computeRangeStepSeconds(bounds.startMs, bounds.endMs);
    const url = createSourceUrl(sourceConfig, source === 'PROMETHEUS'
      ? '/api/v1/query_range'
      : '/loki/api/v1/query_range');
    url.searchParams.set('query', recipe.renderedQuery!);
    url.searchParams.set('start', formatProviderTime(source, bounds.startMs));
    url.searchParams.set('end', formatProviderTime(source, bounds.endMs));
    url.searchParams.set('step', `${stepSec}s`);
    if (source === 'LOKI') {
      url.searchParams.set('direction', 'forward');
      url.searchParams.set('limit', String(EVIDENCE_MAX_SERIES_PER_QUERY));
    }
    const payload = await this.requestJson(sourceConfig, url, signal);
    const parsed = parseMetricMatrix(source, payload);
    return {
      source,
      recipeId: recipe.recipeId,
      startAt: new Date(bounds.startMs).toISOString(),
      endAt: new Date(bounds.endMs).toISOString(),
      stepSec,
      hasWarnings: parsed.hasWarnings,
      truncated: parsed.truncated,
      series: parsed.series,
    };
  }

  private async queryTempo(
    sourceConfig: EvidenceSourceConfig,
    recipe: RenderedEvidenceRecipe,
    bounds: { startMs: number; endMs: number },
    signal?: AbortSignal,
  ): Promise<TempoSearchResult> {
    const url = createSourceUrl(sourceConfig, '/api/search');
    url.searchParams.set('q', recipe.renderedQuery!);
    url.searchParams.set('start', String(Math.floor(bounds.startMs / 1000)));
    url.searchParams.set('end', String(Math.floor(bounds.endMs / 1000)));
    url.searchParams.set('limit', String(EVIDENCE_MAX_TEMPO_SEARCH_RESULTS));
    const payload = await this.requestJson(sourceConfig, url, signal);
    const traces = tempoTraces(payload);
    if (traces.length > EVIDENCE_MAX_TEMPO_SEARCH_RESULTS) {
      throw new EvidenceQueryClientError('QUERY_RESULT_TOO_LARGE');
    }
    const durationsMs = traces.map((trace) => {
      if (!isRecord(trace) || typeof trace.durationMs !== 'number'
        || !Number.isFinite(trace.durationMs) || trace.durationMs < 0) {
        throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
      }
      return trace.durationMs;
    });
    const complete = tempoSearchIsComplete(payload);
    const truncated = traces.length >= EVIDENCE_MAX_TEMPO_SEARCH_RESULTS || !complete;
    return {
      source: 'TEMPO',
      recipeId: recipe.recipeId,
      traceCount: traces.length,
      durationsMs,
      truncated,
      reasonCode: truncated ? 'SEARCH_INCOMPLETE' : null,
    };
  }

  private async requestJson(
    sourceConfig: EvidenceSourceConfig,
    url: URL,
    signal?: AbortSignal,
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.requestJsonOnce(sourceConfig, url, signal);
      } catch (error) {
        if (!(error instanceof EvidenceQueryClientError)
          || !error.retryable || attempt === 1 || signal?.aborted) throw error;
      }
    }
    throw new EvidenceQueryClientError('SOURCE_UNREACHABLE');
  }

  private async requestJsonOnce(
    sourceConfig: EvidenceSourceConfig,
    url: URL,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) throw new EvidenceQueryClientError('SOURCE_UNREACHABLE');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.sourceTimeoutMs);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: requestHeaders(this.config),
        signal: controller.signal,
        redirect: 'manual',
        cache: 'no-store',
      });
      if (response.status >= 300 && response.status < 400) {
        throw new EvidenceQueryClientError('SOURCE_REDIRECT_REJECTED');
      }
      if (!response.ok) throw mapHttpStatus(response.status);
      try {
        return await readBoundedJsonResponse(response, this.config.maxResponseBytes);
      } catch (error) {
        if (error instanceof BoundedJsonResponseError) {
          throw new EvidenceQueryClientError(error.code === 'RESPONSE_TOO_LARGE'
            ? 'QUERY_RESULT_TOO_LARGE'
            : 'SOURCE_RESPONSE_INVALID');
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof EvidenceQueryClientError) throw error;
      if (controller.signal.aborted) {
        throw new EvidenceQueryClientError(
          signal?.aborted ? 'SOURCE_UNREACHABLE' : 'SOURCE_TIMEOUT',
          !signal?.aborted,
        );
      }
      if (isAbortError(error)) throw new EvidenceQueryClientError('SOURCE_TIMEOUT', true);
      throw new EvidenceQueryClientError('SOURCE_UNREACHABLE', true);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
}

export function computeRangeStepSeconds(startMs: number, endMs: number): number {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs) {
    throw new EvidenceQueryClientError('INVALID_QUERY');
  }
  const spanSec = Math.ceil((endMs - startMs) / 1000);
  const pointsBoundedStep = Math.ceil(spanSec / (EVIDENCE_MAX_RANGE_POINTS_PER_SERIES - 1));
  return Math.max(15, pointsBoundedStep);
}

function createSourceUrl(source: EvidenceSourceConfig, path: string): URL {
  if (source.baseUrl === null) throw new EvidenceQueryClientError('SOURCE_UNCONFIGURED');
  const url = new URL(path, `${source.baseUrl}/`);
  if (url.origin !== source.baseUrl) throw new EvidenceQueryClientError('INVALID_QUERY');
  return url;
}

function formatProviderTime(source: 'PROMETHEUS' | 'LOKI', timestampMs: number): string {
  return source === 'PROMETHEUS'
    ? (timestampMs / 1000).toFixed(3)
    : new Date(timestampMs).toISOString();
}

function parseRange(range: EvidenceQueryRange): { startMs: number; endMs: number } {
  if (!isRecord(range) || typeof range.startAt !== 'string' || typeof range.endAt !== 'string') {
    throw new EvidenceQueryClientError('INVALID_QUERY');
  }
  let startMs: number;
  let endMs: number;
  try {
    startMs = Date.parse(parseEvidenceSqlTimestamp(range.startAt));
    endMs = Date.parse(parseEvidenceSqlTimestamp(range.endAt));
  } catch (error) {
    if (error instanceof EvidenceTypeError) throw new EvidenceQueryClientError('INVALID_QUERY');
    throw error;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new EvidenceQueryClientError('INVALID_QUERY');
  }
  return { startMs, endMs };
}

function requestHeaders(config: EvidenceWebConfig): HeadersInit {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.observationAuth) {
    const { username, password } = config.observationAuth;
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  }
  return headers;
}

function mapHttpStatus(status: number): EvidenceQueryClientError {
  if (status === 400) return new EvidenceQueryClientError('INVALID_QUERY');
  if (status === 401 || status === 403) return new EvidenceQueryClientError('SOURCE_UNAUTHORIZED');
  if (status === 429) return new EvidenceQueryClientError('SOURCE_RATE_LIMITED', true);
  if (status === 502 || status === 503 || status === 504) {
    return new EvidenceQueryClientError('SOURCE_UNREACHABLE', true);
  }
  if (status >= 500) return new EvidenceQueryClientError('SOURCE_UNREACHABLE');
  return new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
}

function parseMetricMatrix(
  source: 'PROMETHEUS' | 'LOKI',
  payload: unknown,
): {
  readonly series: readonly (readonly NumericSample[])[];
  readonly hasWarnings: boolean;
  readonly truncated: boolean;
} {
  if (!isRecord(payload) || payload.status !== 'success' || !isRecord(payload.data)
    || payload.data.resultType !== 'matrix' || !Array.isArray(payload.data.result)) {
    throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
  }
  const result = payload.data.result;
  const warnings = payload.warnings;
  if (warnings !== undefined
    && (!Array.isArray(warnings) || !warnings.every((warning) => typeof warning === 'string'))) {
    throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
  }
  if (payload.data.result.length > EVIDENCE_MAX_SERIES_PER_QUERY) {
    throw new EvidenceQueryClientError('QUERY_RESULT_TOO_LARGE');
  }
  let truncated = false;
  const seriesResults = result.map((series) => {
    if (!isRecord(series) || !Array.isArray(series.values)
      || (source === 'PROMETHEUS' && !isRecord(series.metric))
      || (source === 'LOKI' && !isRecord(series.stream))) {
      throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
    }
    if (series.values.length > EVIDENCE_MAX_RANGE_POINTS_PER_SERIES) {
      truncated = true;
    }
    return series.values.slice(0, EVIDENCE_MAX_RANGE_POINTS_PER_SERIES).map(parseSample);
  });
  return {
    series: seriesResults,
    hasWarnings: Array.isArray(warnings) && warnings.length > 0,
    truncated,
  };
}

function parseSample(value: unknown): NumericSample {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
  }
  const timestampSec = typeof value[0] === 'number' ? value[0]
    : typeof value[0] === 'string' ? Number(value[0]) : Number.NaN;
  if (!Number.isFinite(timestampSec)) {
    throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
  }
  const sampleValue = typeof value[1] === 'number' ? value[1]
    : typeof value[1] === 'string' ? Number(value[1]) : Number.NaN;
  const nonFiniteSentinel = typeof value[1] === 'string'
    && ['NaN', 'Inf', '+Inf', '-Inf'].includes(value[1]);
  if (!Number.isFinite(sampleValue) && !nonFiniteSentinel) {
    throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
  }
  return {
    timestampMs: Math.round(timestampSec * 1000),
    value: Number.isFinite(sampleValue) ? sampleValue : null,
    reasonCode: Number.isFinite(sampleValue) ? null : 'NON_FINITE_SAMPLE',
  };
}

function tempoTraces(payload: unknown): unknown[] {
  if (!isRecord(payload) || !Array.isArray(payload.traces)) {
    throw new EvidenceQueryClientError('SOURCE_RESPONSE_INVALID');
  }
  return payload.traces;
}

function tempoSearchIsComplete(payload: unknown): boolean {
  if (!isRecord(payload) || !isRecord(payload.metrics)) return false;
  const { completedJobs, totalJobs } = payload.metrics;
  return Number.isSafeInteger(completedJobs)
    && Number.isSafeInteger(totalJobs)
    && typeof completedJobs === 'number'
    && typeof totalJobs === 'number'
    && totalJobs > 0
    && completedJobs === totalJobs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
