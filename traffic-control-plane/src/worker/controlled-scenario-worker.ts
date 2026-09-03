import { appendFaultRunEvent } from '../lib/fault-run-repository';
import type { FaultRunRecord } from '../lib/fault-run-repository';

export interface ScenarioWorkerStats {
  requests: number;
  successes: number;
  failures: number;
  timeouts: number;
  inFlight: number;
  stopReason: string | null;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  cacheResults: Record<CacheResult, number>;
}

export type CacheResult =
  | 'CACHE_HIT'
  | 'CACHE_MISS_DB_FALLBACK'
  | 'CACHE_INVALID_FALLBACK'
  | 'CACHE_BACKEND_ERROR'
  | 'CACHE_UNKNOWN';

export interface ScenarioRequestResult {
  cacheResult?: CacheResult;
}

export class ScenarioRequestTimeoutError extends Error {
  constructor(message = 'SCENARIO_REQUEST_TIMEOUT') {
    super(message);
    this.name = 'ScenarioRequestTimeoutError';
  }
}

export class ScenarioRequestCacheError extends Error {
  constructor(public readonly cacheResult: Exclude<CacheResult, 'CACHE_UNKNOWN'> = 'CACHE_BACKEND_ERROR') {
    super(cacheResult);
    this.name = 'ScenarioRequestCacheError';
  }
}

export interface ControlledScenarioOptions {
  concurrency: number;
  requestIntervalMs: number;
  request: (signal: AbortSignal) => Promise<void | ScenarioRequestResult>;
}

export class ControlledScenarioWorker {
  private readonly controller = new AbortController();
  private readonly stats: ScenarioWorkerStats = {
    requests: 0,
    successes: 0,
    failures: 0,
    timeouts: 0,
    inFlight: 0,
    stopReason: null,
    averageLatencyMs: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    p99LatencyMs: 0,
    cacheResults: {
      CACHE_HIT: 0,
      CACHE_MISS_DB_FALLBACK: 0,
      CACHE_INVALID_FALLBACK: 0,
      CACHE_BACKEND_ERROR: 0,
      CACHE_UNKNOWN: 0,
    },
  };
  private totalLatencyMs = 0;
  private readonly latencySamples: number[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private readonly run: FaultRunRecord,
    private readonly options: ControlledScenarioOptions,
    private readonly eventWriter: (runId: string, eventType: string, payload?: unknown) => Promise<void> = appendFaultRunEvent,
  ) {}

  start(): Promise<void> {
    if (!this.running) {
      this.running = this.execute();
    }
    return this.running;
  }

  async stop(reason = 'STOP_REQUESTED'): Promise<ScenarioWorkerStats> {
    if (!this.stats.stopReason) this.stats.stopReason = reason;
    this.controller.abort(reason);
    if (this.running) await this.running;
    return { ...this.stats };
  }

  snapshot(): ScenarioWorkerStats {
    return {
      ...this.stats,
      cacheResults: { ...this.stats.cacheResults },
    };
  }

  private async execute(): Promise<void> {
    await this.eventWriter(this.run.faultRunId, 'SCENARIO_WORKER_STARTED', {
      scenario: this.run.scenario,
      concurrency: this.options.concurrency,
      requestIntervalMs: this.options.requestIntervalMs,
    });
    try {
      while (!this.controller.signal.aborted && Date.now() < new Date(this.run.expiresAt).getTime()) {
        const batch = Array.from({ length: this.options.concurrency }, () => this.requestOnce());
        await Promise.all(batch);
        if (!this.controller.signal.aborted) await abortableDelay(this.options.requestIntervalMs, this.controller.signal);
      }
      if (!this.stats.stopReason) this.stats.stopReason = Date.now() >= new Date(this.run.expiresAt).getTime()
        ? 'EXPIRED'
        : 'STOP_REQUESTED';
    } finally {
      this.updateLatencySummary();
      await this.eventWriter(this.run.faultRunId, 'SCENARIO_WORKER_STOPPED', this.stats).catch(() => undefined);
    }
  }

  private async requestOnce(): Promise<void> {
    if (this.controller.signal.aborted) return;
    this.stats.requests++;
    this.stats.inFlight++;
    const startedAt = Date.now();
    try {
      const result = await this.options.request(this.controller.signal);
      this.stats.successes++;
      const cacheResult = result?.cacheResult ?? 'CACHE_UNKNOWN';
      this.stats.cacheResults[cacheResult]++;
    } catch (error) {
      if (!this.controller.signal.aborted) {
        this.stats.failures++;
        const timeout = error instanceof ScenarioRequestTimeoutError;
        if (timeout) this.stats.timeouts++;
        if (error instanceof ScenarioRequestCacheError) this.stats.cacheResults[error.cacheResult]++;
        await this.eventWriter(this.run.faultRunId, 'SCENARIO_REQUEST_FAILED', {
          error: timeout ? 'SCENARIO_REQUEST_TIMEOUT' : error instanceof Error ? error.message : String(error),
          errorCode: timeout ? 'SCENARIO_REQUEST_TIMEOUT' : 'SCENARIO_REQUEST_FAILED',
          timeout,
          ...(error instanceof ScenarioRequestCacheError ? { cacheResult: error.cacheResult } : {}),
        }).catch(() => undefined);
      }
    } finally {
      this.stats.inFlight--;
      const latencyMs = Date.now() - startedAt;
      this.totalLatencyMs += latencyMs;
      this.latencySamples.push(latencyMs);
      if (this.latencySamples.length > 1000) this.latencySamples.shift();
    }
  }

  private updateLatencySummary(): void {
    this.stats.averageLatencyMs = this.stats.requests === 0
      ? 0 : Math.round(this.totalLatencyMs / this.stats.requests);
    if (this.latencySamples.length === 0) {
      this.stats.p50LatencyMs = 0;
      this.stats.p95LatencyMs = 0;
      this.stats.p99LatencyMs = 0;
      return;
    }
    const sorted = [...this.latencySamples].sort((left, right) => left - right);
    this.stats.p50LatencyMs = percentile(sorted, 0.50);
    this.stats.p95LatencyMs = percentile(sorted, 0.95);
    this.stats.p99LatencyMs = percentile(sorted, 0.99);
  }
}

function percentile(sorted: number[], ratio: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
