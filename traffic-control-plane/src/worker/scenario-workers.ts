import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { forwardAbortSignal, throwIfAborted } from '../lib/abort-signal';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import {
  CustomerRequestContext,
  GatewayClient,
  GatewayRequestError,
  getGatewayClient,
} from '../lib/gateway-client';
import { env } from '../lib/env';
import {
  appendFaultRunEvent,
  listRunnableFaultRuns,
  loadFaultRunTargetSummary,
  type FaultRunRecord,
  type FaultRunTargetSummary,
} from '../lib/fault-run-repository';
import { getLegacyFaultRunRecovery } from '../lib/legacy-fault-run-recovery';
import { normalizeFaultRunSummaryEventPayload } from '../lib/fault-run-event-contract';
import { CustomerSessionManager } from './customer-session-manager';
import {
  ControlledScenarioWorker,
  ScenarioRequestCacheError,
  ScenarioRequestResult,
  ScenarioRequestTimeoutError,
} from './controlled-scenario-worker';
import type { OwnedFaultRunDriver, OwnedRunHandle } from './fault-run-driver';
import {
  getFaultRunDrainRegistry,
  type FaultRunDrainParticipant,
  type FaultRunDrainRegistry,
  type FaultRunWorkPermit,
} from './fault-run-drain-registry';

interface ScenarioWorkerDependencies {
  gateway: GatewayClient;
  listRunnableRuns: () => Promise<FaultRunRecord[]>;
  listActiveRuns: () => Promise<FaultRunRecord[]>;
  loadTargetSummary: (faultRunId: string) => Promise<FaultRunTargetSummary | null>;
  appendEvent: (faultRunId: string, eventType: string, payload?: unknown) => Promise<void>;
  registerRunDrain: (faultRunId: string, drain: () => Promise<unknown>) => () => void;
  sessions: CustomerSessionManagerLike;
  drainRegistry: Pick<FaultRunDrainRegistry, 'register' | 'tryAcquire'>;
  safeRuntimeEnabled: boolean;
}

interface ProductDetailResponse {
  data?: { sku?: unknown };
}

interface CustomerApiResponse<T> {
  code?: number;
  data?: T;
}

interface ProductPage {
  content?: ProductData[];
}

interface ProductData {
  sku?: string;
  status?: number | boolean;
  availableQty?: number;
  price?: number | string;
}

interface CartData {
  items?: Array<{ sku?: string }>;
}

interface CustomerSessionManagerLike {
  openSession(
    trafficRunId: string,
    lifecycleId: string,
    traceId: string,
    options?: { signal?: AbortSignal },
  ): Promise<CustomerRequestContext>;
  closeSession(lifecycleId: string, traceId: string, signal?: AbortSignal): Promise<void>;
}

const CACHE_RESULTS = new Set([
  'CACHE_HIT', 'CACHE_MISS_DB_FALLBACK', 'CACHE_INVALID_FALLBACK', 'CACHE_BACKEND_ERROR',
]);
const log = pino({ name: 'scenario-workers' });

export class ScenarioWorkers {
  private readonly gateway: GatewayClient;
  private readonly listRunnableRuns: ScenarioWorkerDependencies['listRunnableRuns'];
  private readonly loadTargetSummary: ScenarioWorkerDependencies['loadTargetSummary'];
  private readonly appendEvent: ScenarioWorkerDependencies['appendEvent'];
  private readonly registerRunDrain: ScenarioWorkerDependencies['registerRunDrain'];
  private readonly sessions: CustomerSessionManagerLike;
  private readonly drainRegistry: ScenarioWorkerDependencies['drainRegistry'];
  private readonly safeRuntimeEnabled: boolean;
  private readonly workers = new Map<string, { worker: ControlledScenarioWorker; promise: Promise<void> }>();
  private readonly starting = new Map<string, Promise<void>>();
  private readonly blockedRunIds = new Set<string>();
  private activeRunIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopping = false;

  constructor(dependencies: Partial<ScenarioWorkerDependencies> = {}) {
    this.gateway = dependencies.gateway ?? getGatewayClient();
    this.listRunnableRuns = dependencies.listRunnableRuns
      ?? dependencies.listActiveRuns
      ?? listRunnableFaultRuns;
    this.loadTargetSummary = dependencies.loadTargetSummary ?? loadFaultRunTargetSummary;
    this.appendEvent = dependencies.appendEvent ?? appendFaultRunEvent;
    this.registerRunDrain = dependencies.registerRunDrain
      ?? ((faultRunId, drain) => getLegacyFaultRunRecovery().registerRunDrain(faultRunId, drain));
    this.sessions = dependencies.sessions ?? new CustomerSessionManager({ gateway: this.gateway });
    this.drainRegistry = dependencies.drainRegistry ?? getFaultRunDrainRegistry();
    this.safeRuntimeEnabled = dependencies.safeRuntimeEnabled ?? env.FAULT_RUN_SAFE_RUNTIME_ENABLED;
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
    this.blockedRunIds.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const activeWorkers = [...this.workers.values()];
    await Promise.all([
      ...activeWorkers.map(({ worker }) => worker.stop('CONTROL_PLANE_STOP')),
      ...activeWorkers.map(({ promise }) => promise),
      ...this.starting.values(),
    ]);
  }

  async startOwned(run: FaultRunRecord, fence: FaultRunOwnerFence): Promise<OwnedRunHandle> {
    throwIfAborted(fence.signal);
    const concurrency = boundedInteger(run.parameters.concurrency, 1, 32, 1);
    const requestIntervalMs = boundedInteger(run.parameters.requestIntervalMs, 0, 60_000, 100);
    let targetSummary: FaultRunTargetSummary | null = null;
    if (run.scenario === 'CATALOG_REDIS_LARGE_VALUE') {
      targetSummary = await this.loadTargetSummary(run.faultRunId);
      if (!isUsableTargetSummary(targetSummary)) {
        throw new Error('TARGET_SUMMARY_UNAVAILABLE');
      }
    }

    let customerSession: CustomerRequestContext | null = null;
    let customerLifecycleId: string | null = null;
    let cartSku: string | null = null;
    if (run.scenario === 'CART_CATALOG_DEPENDENCY') {
      customerLifecycleId = randomUUID();
      customerSession = await this.sessions.openSession(
        run.faultRunId,
        customerLifecycleId,
        run.traceId ?? randomUUID().replace(/-/g, ''),
        { signal: fence.signal },
      );
      cartSku = await selectCartProduct(this.gateway, customerSession, fence.signal);
    }

    const closeCustomerSession = async () => {
      if (customerLifecycleId && customerSession) {
        await this.sessions.closeSession(
          customerLifecycleId,
          customerSession.traceId,
          fence.signal,
        ).catch(() => undefined);
      }
    };
    const memberSkus = targetSummary?.memberSkus ?? [];
    let memberIndex = 0;
    const request = async (signal: AbortSignal): Promise<ScenarioRequestResult> => {
      throwIfAborted(signal);
      if (run.scenario === 'CATALOG_REDIS_LARGE_VALUE') {
        const sku = memberSkus[memberIndex++ % memberSkus.length];
        return readCatalogProductDetail(
          this.gateway, sku, signal, env.PRODUCT_DETAIL_REQUEST_TIMEOUT_MS);
      }
      if (run.scenario === 'CART_CATALOG_DEPENDENCY') {
        if (!customerSession || !cartSku) throw new Error('CART_WORKER_NOT_READY');
        const response = await this.gateway.customerPost<CustomerApiResponse<CartData>>(
          '/api/cart/items',
          {
            sku: cartSku,
            quantity: 1,
            operationId: `fault-run-${run.faultRunId}-${randomUUID()}`,
          },
          customerSession,
          signal,
        );
        if (response?.code !== 200 || !response.data) throw new Error('CART_ADD_ITEM_FAILED');
        return {};
      }
      const observationPath = run.scenario === 'INVENTORY_TABLE_EXCLUSIVE'
        ? '/internal/gateway/inventory/availability'
        : run.scenario === 'INVENTORY_ROW_LOCK'
          ? '/internal/gateway/inventory/reservations/summary'
          : '/internal/gateway/promotion/consistency';
      await this.gateway.postInternal(observationPath, {
        runId: run.faultRunId,
        expiresAt: run.expiresAt,
        fencingToken: run.fencingToken,
        idempotencyKey: run.idempotencyKey,
      }, run.traceId ?? undefined, signal);
      return {};
    };

    if (targetSummary) {
      await this.appendEvent(run.faultRunId, 'SCENARIO_WORKER_TARGET', {
        layout: targetSummary.layout,
        memberCount: targetSummary.memberCount,
        memberSizeBytes: targetSummary.memberSizeBytes,
        probeSku: targetSummary.probeSku,
      });
    }
    const worker = new ControlledScenarioWorker(
      run,
      { concurrency, requestIntervalMs, request, signal: fence.signal },
      this.appendEvent,
    );
    const task = worker.start().finally(closeCustomerSession);
    return {
      stop: async ({ reason }) => {
        fence.lose(reason);
        const stats = await worker.stop(reason);
        await task.catch(() => undefined);
        return {
          drained: stats.inFlight === 0,
          inFlight: stats.inFlight,
        };
      },
    };
  }

  private async scan(): Promise<void> {
    let active: FaultRunRecord[];
    try {
      active = await this.listRunnableRuns();
    } catch (error) {
      log.warn({ error }, 'Fault Run scan failed');
      return;
    }

    if (this.stopping) return;
    const eligible = active.filter((run) =>
      run.state === 'ACTIVE'
      && Date.parse(run.expiresAt) > Date.now()
      && (run.scenario === 'CATALOG_REDIS_LARGE_VALUE'
      || run.scenario === 'PROMOTION_LOCK_CONTENTION'
      || run.scenario === 'INVENTORY_TABLE_EXCLUSIVE'
      || run.scenario === 'INVENTORY_ROW_LOCK'
      || run.scenario === 'CART_CATALOG_DEPENDENCY'));
    const activeIds = new Set(eligible.map((run) => run.faultRunId));
    this.activeRunIds = activeIds;
    for (const runId of this.blockedRunIds) {
      if (!activeIds.has(runId)) this.blockedRunIds.delete(runId);
    }
    for (const [runId, current] of this.workers) {
      if (!activeIds.has(runId)) void current.worker.stop('RUN_STOPPED');
    }
    for (const run of eligible) {
      if (!this.workers.has(run.faultRunId)
          && !this.starting.has(run.faultRunId)
          && !this.blockedRunIds.has(run.faultRunId)) {
        const promise = this.startRun(run).finally(() => this.starting.delete(run.faultRunId));
        this.starting.set(run.faultRunId, promise);
      }
    }
  }

  private async startRun(run: FaultRunRecord): Promise<void> {
    if (this.stopping) return;
    const concurrency = boundedInteger(run.parameters.concurrency, 1, 32, 1);
    const requestIntervalMs = boundedInteger(run.parameters.requestIntervalMs, 0, 60_000, 100);
    const runController = new AbortController();
    const completion = deferredVoid();
    let controlledWorker: ControlledScenarioWorker | null = null;
    let unregisterParticipant = () => {};
    let permit: FaultRunWorkPermit | null = null;
    let removePermitAbortListener = () => {};
    if (this.safeRuntimeEnabled) {
      const participant: FaultRunDrainParticipant = {
        kind: 'SCENARIO',
        requestStop: () => {
          runController.abort();
          return controlledWorker?.stop('COORDINATOR_RECOVERY').then(() => undefined);
        },
        settled: () => completion.promise,
      };
      unregisterParticipant = this.drainRegistry.register(run.faultRunId, participant);
      permit = this.drainRegistry.tryAcquire(run.faultRunId, 'SCENARIO');
      if (!permit) {
        this.blockedRunIds.add(run.faultRunId);
        completion.resolve();
        unregisterParticipant();
        return;
      }
      removePermitAbortListener = forwardAbortSignal(permit.signal, runController);
    }
    let targetSummary: FaultRunTargetSummary | null = null;
    let customerSession: CustomerRequestContext | null = null;
    let customerLifecycleId: string | null = null;
    let cartSku: string | null = null;
    const closeCustomerSession = async () => {
      if (customerLifecycleId && customerSession) {
        await this.sessions.closeSession(
          customerLifecycleId,
          customerSession.traceId,
          runController.signal,
        ).catch(() => undefined);
      }
    };
    const completeAdmission = () => {
      removePermitAbortListener();
      permit?.complete();
      completion.resolve();
      unregisterParticipant();
    };
    try {
      throwIfAborted(runController.signal);
      targetSummary = run.scenario === 'CATALOG_REDIS_LARGE_VALUE'
        ? await this.loadTargetSummary(run.faultRunId)
        : null;
      throwIfAborted(runController.signal);
      if (run.scenario === 'CART_CATALOG_DEPENDENCY') {
        customerLifecycleId = randomUUID();
        customerSession = await this.sessions.openSession(
          run.faultRunId,
          customerLifecycleId,
          run.traceId ?? randomUUID().replace(/-/g, ''),
          { signal: runController.signal },
        );
        cartSku = await selectCartProduct(this.gateway, customerSession, runController.signal);
      }
    } catch (error) {
      if (!runController.signal.aborted) {
        await appendScenarioWorkerSetupFailure(this.appendEvent, run, error);
      }
      await closeCustomerSession();
      completeAdmission();
      return;
    }
    if (run.scenario === 'CATALOG_REDIS_LARGE_VALUE' && !isUsableTargetSummary(targetSummary)) {
      await appendScenarioWorkerSetupFailure(this.appendEvent, run, new Error('TARGET_SUMMARY_UNAVAILABLE'));
      await closeCustomerSession();
      completeAdmission();
      return;
    }
    const memberSkus = targetSummary?.memberSkus ?? [];
    if (this.stopping || !this.activeRunIds.has(run.faultRunId) || runController.signal.aborted) {
      await closeCustomerSession();
      completeAdmission();
      return;
    }
    let memberIndex = 0;
    const request = async (signal: AbortSignal) => {
      if (run.scenario === 'CATALOG_REDIS_LARGE_VALUE') {
        const sku = memberSkus[memberIndex++ % memberSkus.length];
        return readCatalogProductDetail(
          this.gateway, sku, signal, env.PRODUCT_DETAIL_REQUEST_TIMEOUT_MS);
      }
      if (run.scenario === 'CART_CATALOG_DEPENDENCY') {
        if (!customerSession || !cartSku) throw new Error('CART_WORKER_NOT_READY');
        const response = await this.gateway.customerPost<CustomerApiResponse<CartData>>(
          '/api/cart/items',
          {
            sku: cartSku,
            quantity: 1,
            operationId: `fault-run-${run.faultRunId}-${randomUUID()}`,
          },
          customerSession,
          signal,
        );
        if (response?.code !== 200 || !response.data) throw new Error('CART_ADD_ITEM_FAILED');
        return {};
      }
      const observationPath = run.scenario === 'INVENTORY_TABLE_EXCLUSIVE'
        ? '/internal/gateway/inventory/availability'
        : run.scenario === 'INVENTORY_ROW_LOCK'
          ? '/internal/gateway/inventory/reservations/summary'
          : '/internal/gateway/promotion/consistency';
      await this.gateway.postInternal(observationPath, {
        runId: run.faultRunId,
        expiresAt: run.expiresAt,
        fencingToken: run.fencingToken,
        idempotencyKey: run.idempotencyKey,
      }, run.traceId ?? undefined, signal);
    };
    if (targetSummary) {
      try {
        await this.appendEvent(run.faultRunId, 'SCENARIO_WORKER_TARGET', {
          layout: targetSummary.layout,
          memberCount: targetSummary.memberCount,
          memberSizeBytes: targetSummary.memberSizeBytes,
          probeSku: targetSummary.probeSku,
        });
      } catch (error) {
        await this.appendEvent(run.faultRunId, 'SCENARIO_WORKER_SETUP_FAILED', {
          reason: 'TARGET_EVENT_WRITE_FAILED',
          error: error instanceof Error ? error.message : 'Target event write failed',
        }).catch(() => undefined);
        await closeCustomerSession();
        completeAdmission();
        return;
      }
    }
    if (this.stopping || !this.activeRunIds.has(run.faultRunId) || runController.signal.aborted) {
      await closeCustomerSession();
      completeAdmission();
      return;
    }
    const worker = new ControlledScenarioWorker(
      run,
      {
        concurrency,
        requestIntervalMs,
        request,
        signal: runController.signal,
      },
      this.appendEvent,
    );
    controlledWorker = worker;
    const unregisterDrain = this.safeRuntimeEnabled
      ? () => {}
      : this.registerRunDrain(run.faultRunId, () => worker.stop('COORDINATOR_RECOVERY'));
    const promise = (async () => {
      try {
        await worker.start();
      } catch (error) {
        await appendWorkerFailure(this.appendEvent, run, error);
      } finally {
        unregisterDrain();
        await this.appendEvent(
          run.faultRunId,
          'SCENARIO_WORKER_DRAINED',
          normalizeFaultRunSummaryEventPayload('SCENARIO_WORKER_DRAINED', worker.snapshot()),
        ).catch(() => undefined);
        await closeCustomerSession();
        this.workers.delete(run.faultRunId);
        completeAdmission();
      }
    })();
    this.workers.set(run.faultRunId, { worker, promise });
    await promise;
  }
}

export class ScenarioFaultRunDriver implements OwnedFaultRunDriver {
  readonly name = 'SCENARIO_WORKERS';
  readonly drainOwner = 'SCENARIO_WORKERS' as const;

  constructor(private readonly workers: ScenarioWorkers = new ScenarioWorkers()) {}

  supports(run: FaultRunRecord): boolean {
    return run.scenario === 'CATALOG_REDIS_LARGE_VALUE'
      || run.scenario === 'PROMOTION_LOCK_CONTENTION'
      || run.scenario === 'INVENTORY_TABLE_EXCLUSIVE'
      || run.scenario === 'INVENTORY_ROW_LOCK'
      || run.scenario === 'CART_CATALOG_DEPENDENCY';
  }

  start(input: { run: FaultRunRecord; fence: FaultRunOwnerFence }): Promise<OwnedRunHandle> {
    return this.workers.startOwned(input.run, input.fence);
  }
}

async function appendWorkerFailure(
  appendEvent: ScenarioWorkerDependencies['appendEvent'],
  run: FaultRunRecord,
  error: unknown,
): Promise<void> {
  await appendEvent(
    run.faultRunId,
    'SCENARIO_WORKER_SETUP_FAILED',
    normalizeFaultRunSummaryEventPayload('SCENARIO_WORKER_SETUP_FAILED', {
      failureCode: 'WORKER_SETUP_FAILED',
      error: error instanceof Error ? error.message : String(error),
    }),
  ).catch(() => undefined);
}

async function appendScenarioWorkerSetupFailure(
  appendEvent: ScenarioWorkerDependencies['appendEvent'],
  run: FaultRunRecord,
  error: unknown,
): Promise<void> {
  await appendEvent(
    run.faultRunId,
    'SCENARIO_WORKER_SETUP_FAILED',
    normalizeFaultRunSummaryEventPayload('SCENARIO_WORKER_SETUP_FAILED', {
      failureCode: error instanceof Error && /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(error.message)
        ? error.message : 'WORKER_SETUP_FAILED',
    }),
  ).catch(() => undefined);
}

async function selectCartProduct(
  gateway: GatewayClient,
  context: CustomerRequestContext,
  signal?: AbortSignal,
): Promise<string> {
  const products = await gateway.customerGet<CustomerApiResponse<ProductPage>>(
    '/api/products',
    { page: '0', size: '20', sort: 'latest' },
    context,
    signal,
  );
  if (products?.code !== 200 || !Array.isArray(products.data?.content)) {
    throw new Error('CART_PRODUCT_LIST_FAILED');
  }
  const cart = await gateway.customerGet<CustomerApiResponse<CartData>>(
    '/api/cart',
    undefined,
    context,
    signal,
  );
  if (cart?.code !== 200 || !Array.isArray(cart.data?.items)) {
    throw new Error('CART_READ_FAILED');
  }
  const existingSkus = new Set(
    cart.data.items
      .map((item) => item.sku)
      .filter((sku): sku is string => typeof sku === 'string' && sku.length > 0),
  );
  const product = products.data.content.find((candidate) =>
    typeof candidate.sku === 'string'
      && candidate.sku.length > 0
      && !existingSkus.has(candidate.sku)
      && (candidate.status === 1 || candidate.status === true)
      && typeof candidate.availableQty === 'number'
      && candidate.availableQty > 0
      && Number(candidate.price ?? 0) > 0);
  if (!product?.sku) throw new Error('CART_PRODUCT_UNAVAILABLE');
  return product.sku;
}

export async function readCatalogProductDetail(
  gateway: ProductDetailGateway,
  sku: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ScenarioRequestResult> {
  throwIfAborted(signal);
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
    if (deadlineExceeded) throw new ScenarioRequestTimeoutError('PRODUCT_DETAIL_TIMEOUT');
    if (error instanceof GatewayRequestError && [502, 503, 504].includes(error.status)) {
      throw new ScenarioRequestCacheError('CACHE_BACKEND_ERROR');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abortFromWorker);
  }
}

function normalizeCacheResult(value: string | undefined): ScenarioRequestResult['cacheResult'] {
  return value && CACHE_RESULTS.has(value)
    ? value as Exclude<ScenarioRequestResult['cacheResult'], undefined>
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

function deferredVoid(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let workers: ScenarioWorkers | null = null;

export function getScenarioWorkers(): ScenarioWorkers {
  if (!workers) workers = new ScenarioWorkers();
  return workers;
}
