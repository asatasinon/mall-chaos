import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { getGatewayClient, GatewayClient, GatewayRequestError } from '../lib/gateway-client';
import { env } from '../lib/env';
import {
  appendFaultRunEvent,
  listActiveFaultRuns,
  loadFaultRunTargetSummary,
  type FaultRunRecord,
  type FaultRunTargetSummary,
} from '../lib/fault-run-repository';
import { getFaultRunCoordinator } from '../lib/fault-run-coordinator';
import {
  ControlledExerciseWorker,
  ExerciseRequestCacheError,
  ExerciseRequestResult,
  ExerciseRequestTimeoutError,
} from './controlled-exercise-worker';

interface ScenarioExerciseWorkerDependencies {
  gateway: GatewayClient;
  listActiveRuns: () => Promise<FaultRunRecord[]>;
  loadTargetSummary: (faultRunId: string) => Promise<FaultRunTargetSummary | null>;
  appendEvent: (faultRunId: string, eventType: string, payload?: unknown) => Promise<void>;
  registerRunDrain: (faultRunId: string, drain: () => Promise<unknown>) => () => void;
}

interface ProductDetailResponse {
  data?: { sku?: unknown };
}

const CACHE_RESULTS = new Set([
  'CACHE_HIT', 'CACHE_MISS_DB_FALLBACK', 'CACHE_INVALID_FALLBACK', 'CACHE_BACKEND_ERROR',
]);
const log = pino({ name: 'scenario-exercise-workers' });

export class ScenarioExerciseWorkers {
  private readonly gateway: GatewayClient;
  private readonly listActiveRuns: ScenarioExerciseWorkerDependencies['listActiveRuns'];
  private readonly loadTargetSummary: ScenarioExerciseWorkerDependencies['loadTargetSummary'];
  private readonly appendEvent: ScenarioExerciseWorkerDependencies['appendEvent'];
  private readonly registerRunDrain: ScenarioExerciseWorkerDependencies['registerRunDrain'];
  private readonly workers = new Map<string, { worker: ControlledExerciseWorker; promise: Promise<void> }>();
  private readonly starting = new Map<string, Promise<void>>();
  private activeRunIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;

  constructor(dependencies: Partial<ScenarioExerciseWorkerDependencies> = {}) {
    this.gateway = dependencies.gateway ?? getGatewayClient();
    this.listActiveRuns = dependencies.listActiveRuns ?? listActiveFaultRuns;
    this.loadTargetSummary = dependencies.loadTargetSummary ?? loadFaultRunTargetSummary;
    this.appendEvent = dependencies.appendEvent ?? appendFaultRunEvent;
    this.registerRunDrain = dependencies.registerRunDrain
      ?? ((faultRunId, drain) => getFaultRunCoordinator().registerRunDrain(faultRunId, drain));
  }

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    void this.scan();
    this.timer = setInterval(() => { void this.scan(); }, 1000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.activeRunIds = new Set();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([
      ...[...this.workers.values()].map(({ worker }) => worker.stop('CONTROL_PLANE_STOP')),
      ...this.starting.values(),
    ]);
  }

  private async scan(): Promise<void> {
    let active: FaultRunRecord[];
    try {
      active = await this.listActiveRuns();
    } catch (error) {
      log.warn({ error }, 'Fault Run scan failed');
      return;
    }
    const eligible = active.filter((run) =>
      run.state === 'ACTIVE'
      && (run.scenario === 'CATALOG_REDIS_LARGE_VALUE'
      || run.scenario === 'PROMOTION_LOCK_CONTENTION'
      || run.scenario === 'INVENTORY_TABLE_EXCLUSIVE'
      || run.scenario === 'INVENTORY_ROW_LOCK'));
    const activeIds = new Set(eligible.map((run) => run.faultRunId));
    this.activeRunIds = activeIds;
    for (const [runId, current] of this.workers) {
      if (!activeIds.has(runId)) void current.worker.stop('RUN_STOPPED');
    }
    for (const run of eligible) {
      if (!this.workers.has(run.faultRunId) && !this.starting.has(run.faultRunId)) {
        const promise = this.startRun(run).finally(() => this.starting.delete(run.faultRunId));
        this.starting.set(run.faultRunId, promise);
      }
    }
  }

  private async startRun(run: FaultRunRecord): Promise<void> {
    if (this.stopping) return;
    const concurrency = boundedInteger(run.parameters.concurrency, 1, 32, 1);
    const requestIntervalMs = boundedInteger(run.parameters.requestIntervalMs, 0, 60_000, 100);
    let targetSummary: FaultRunTargetSummary | null = null;
    try {
      targetSummary = run.scenario === 'CATALOG_REDIS_LARGE_VALUE'
        ? await this.loadTargetSummary(run.faultRunId)
        : null;
    } catch (error) {
      await this.appendEvent(run.faultRunId, 'EXERCISE_WORKER_SETUP_FAILED', {
        reason: 'TARGET_SUMMARY_LOAD_FAILED',
        error: error instanceof Error ? error.message : 'Target summary load failed',
      }).catch(() => undefined);
      return;
    }
    if (run.scenario === 'CATALOG_REDIS_LARGE_VALUE' && !isUsableTargetSummary(targetSummary)) {
      await this.appendEvent(run.faultRunId, 'EXERCISE_WORKER_SETUP_FAILED', {
        reason: 'TARGET_SUMMARY_UNAVAILABLE',
      }).catch(() => undefined);
      return;
    }
    const memberSkus = targetSummary?.memberSkus ?? [];
    if (this.stopping || !this.activeRunIds.has(run.faultRunId)) return;
    let memberIndex = 0;
    const request = async (signal: AbortSignal) => {
      if (run.scenario === 'CATALOG_REDIS_LARGE_VALUE') {
        const sku = memberSkus[memberIndex++ % memberSkus.length];
        return readCatalogProductDetail(
          this.gateway, sku, signal, env.PRODUCT_DETAIL_REQUEST_TIMEOUT_MS);
      }
      const observationPath = run.scenario === 'INVENTORY_TABLE_EXCLUSIVE'
        ? '/internal/gateway/inventory/availability'
        : run.scenario === 'INVENTORY_ROW_LOCK'
          ? '/internal/gateway/inventory/reservations/summary'
          : '/internal/gateway/promotion/consistency';
      await this.gateway.postInternal(observationPath, {
        faultRunId: run.faultRunId,
        expiresAt: run.expiresAt,
        fencingToken: run.fencingToken,
        idempotencyKey: run.idempotencyKey,
      }, run.traceId ?? undefined, signal);
    };
    if (targetSummary) {
      try {
        await this.appendEvent(run.faultRunId, 'EXERCISE_WORKER_TARGET', {
          layout: targetSummary.layout,
          memberCount: targetSummary.memberCount,
          memberSizeBytes: targetSummary.memberSizeBytes,
          probeSku: targetSummary.probeSku,
        });
      } catch (error) {
        await this.appendEvent(run.faultRunId, 'EXERCISE_WORKER_SETUP_FAILED', {
          reason: 'TARGET_EVENT_WRITE_FAILED',
          error: error instanceof Error ? error.message : 'Target event write failed',
        }).catch(() => undefined);
        return;
      }
    }
    if (this.stopping || !this.activeRunIds.has(run.faultRunId)) return;
    const worker = new ControlledExerciseWorker(run, { concurrency, requestIntervalMs, request }, this.appendEvent);
    const unregisterDrain = this.registerRunDrain(
      run.faultRunId, () => worker.stop('COORDINATOR_RECOVERY'));
    const promise = (async () => {
      try {
        await worker.start();
      } catch (error) {
        await appendWorkerFailure(this.appendEvent, run, error);
      } finally {
        unregisterDrain();
        await this.appendEvent(run.faultRunId, 'SCENARIO_WORKER_DRAINED', worker.snapshot()).catch(() => undefined);
        this.workers.delete(run.faultRunId);
      }
    })();
    this.workers.set(run.faultRunId, { worker, promise });
    await promise;
  }
}

async function appendWorkerFailure(
  appendEvent: ScenarioExerciseWorkerDependencies['appendEvent'],
  run: FaultRunRecord,
  error: unknown,
): Promise<void> {
  await appendEvent(run.faultRunId, 'EXERCISE_WORKER_SETUP_FAILED', {
    error: error instanceof Error ? error.message : String(error),
  }).catch(() => undefined);
}

export async function readCatalogProductDetail(
  gateway: ProductDetailGateway,
  sku: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ExerciseRequestResult> {
  const controller = new AbortController();
  let deadlineExceeded = false;
  const abortFromWorker = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abortFromWorker, { once: true });
  const timeout = setTimeout(() => {
    deadlineExceeded = true;
    controller.abort();
  }, boundedRequestTimeout(timeoutMs));
  try {
    const response = await gateway.getWithMetadata(
      `/api/products/${encodeURIComponent(sku)}`,
      undefined,
      { signal: controller.signal, traceId: randomUUID().replace(/-/g, '') },
    );
    const body = response.body as ProductDetailResponse;
    if (body?.data?.sku !== sku) throw new Error('PRODUCT_DETAIL_RESPONSE_INVALID');
    return { cacheResult: normalizeCacheResult(response.cacheResult) };
  } catch (error) {
    if (signal.aborted) throw error;
    if (deadlineExceeded) throw new ExerciseRequestTimeoutError('PRODUCT_DETAIL_TIMEOUT');
    if (error instanceof GatewayRequestError && [502, 503, 504].includes(error.status)) {
      throw new ExerciseRequestCacheError('CACHE_BACKEND_ERROR');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abortFromWorker);
  }
}

function normalizeCacheResult(value: string | undefined): ExerciseRequestResult['cacheResult'] {
  return value && CACHE_RESULTS.has(value)
    ? value as Exclude<ExerciseRequestResult['cacheResult'], undefined>
    : 'CACHE_UNKNOWN';
}

function isUsableTargetSummary(summary: FaultRunTargetSummary | null): summary is FaultRunTargetSummary & { memberSkus: string[] } {
  return Boolean(summary
    && summary.layout === 'HASH'
    && summary.memberCount && summary.memberCount > 0
    && Array.isArray(summary.memberSkus)
    && summary.memberSkus.length === summary.memberCount);
}

function boundedRequestTimeout(value: number): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, 100), 30_000) : 5000;
}

interface ProductDetailGateway {
  getWithMetadata(
    path: string,
    params?: Record<string, string>,
    options?: { signal?: AbortSignal; traceId?: string },
  ): Promise<{ body: unknown; cacheResult?: string }>;
}

function boundedInteger(value: number | string | undefined, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : fallback;
}

let workers: ScenarioExerciseWorkers | null = null;

export function getScenarioExerciseWorkers(): ScenarioExerciseWorkers {
  if (!workers) workers = new ScenarioExerciseWorkers();
  return workers;
}
