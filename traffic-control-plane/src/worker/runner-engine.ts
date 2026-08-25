import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { loadRunnerConfigFromDb, RunnerConfig } from '../lib/runner-config';
import { completeTrafficRun, ensureTrafficRun, recordTrafficAction } from '../lib/runner-persistence';
import { getRunnerControlState, pushActivity, setRunnerStatus } from '../lib/runtime-state';
import {
  RunnerAction,
  RunnerActionResult,
  TrafficActionOrchestrator,
} from './traffic-action-orchestrator';

const log = pino({ name: 'runner-engine' });

interface SlidingEntry {
  ts: number;
  success: boolean;
}

const WINDOW_SECONDS = 60;

export class RunnerEngine {
  private config: RunnerConfig;
  private rateMultiplier = 1.0;
  private paused = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private window: SlidingEntry[] = [];
  private totalRequests = 0;
  private lastConfigCheckAt = 0;
  private trafficRunId: string | null = null;
  private trafficRunPersistence: Promise<void> | null = null;
  private readonly orchestrator = new TrafficActionOrchestrator();

  constructor() {
    this.config = {
      version: 1,
      enabled: true,
      trafficMode: 'CUSTOMER_LIFECYCLE',
      lifecycleIntervalSec: 60,
      maxItems: 3,
      maxItemQuantity: 3,
      successfulPaymentRatio: 1,
      couponUsageRatio: 0,
      backgroundActionsEnabled: false,
    };
  }

  async loadConfigFromDb(): Promise<void> {
    this.config = await loadRunnerConfigFromDb();
    log.info({ config: this.config }, 'Config loaded from DB');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.trafficRunId = uuidv4();
    const trafficRunId = this.trafficRunId;
    this.trafficRunPersistence = ensureTrafficRun(trafficRunId, this.config.version).catch((error) => {
      log.error({ error }, 'Failed to persist runner start');
    });
    this.scheduleTick();
    log.info({ trafficRunId }, 'Runner engine started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const trafficRunId = this.trafficRunId;
    this.trafficRunId = null;
    if (trafficRunId) {
      void (this.trafficRunPersistence ?? Promise.resolve()).then(() => completeTrafficRun(trafficRunId)).catch((error) => {
          log.error({ error, trafficRunId }, 'Failed to persist runner stop');
        });
    }
    this.trafficRunPersistence = null;
    log.info({ trafficRunId }, 'Runner engine stopped');
  }

  pause(): void {
    this.paused = true;
    log.info('Runner paused');
  }

  resume(): void {
    this.paused = false;
    log.info('Runner resumed');
  }

  setRateMultiplier(multiplier: number): void {
    this.rateMultiplier = multiplier;
    log.info({ multiplier }, 'Rate multiplier updated');
  }

  getStatus() {
    const now = Date.now();
    const cutoff = now - WINDOW_SECONDS * 1000;
    this.window = this.window.filter((e) => e.ts >= cutoff);
    const windowTotal = this.window.length;
    const windowSuccess = this.window.filter((e) => e.success).length;
    const windowFail = windowTotal - windowSuccess;

    return {
      running: this.running && this.config.enabled && !this.paused,
      enabled: this.config.enabled,
      paused: this.paused,
      currentQps: windowTotal > 0 ? +(windowTotal / WINDOW_SECONDS).toFixed(2) : 0,
      successRate: windowTotal > 0 ? +(windowSuccess / windowTotal).toFixed(4) : 1,
      failRate: windowTotal > 0 ? +(windowFail / windowTotal).toFixed(4) : 0,
      totalRequests: this.totalRequests,
      windowSeconds: WINDOW_SECONDS,
      rateMultiplier: this.rateMultiplier,
      configVersion: this.config.version,
      trafficRunId: this.trafficRunId,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── Private ──

  private scheduleTick(): void {
    if (!this.running) return;
    const delayMs = Math.max(this.config.lifecycleIntervalSec * 1000, 1000);
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (error) {
        log.error({ error }, 'Runner tick failed');
      }
      this.scheduleTick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    await this.refreshControlState();
    await this.refreshConfigIfNeeded();
    await this.publishStatus();

    if (!this.config.enabled || this.paused) return;
    if (!this.trafficRunId) return;
    const action: RunnerAction = 'BROWSE_PRODUCT';
    const t0 = Date.now();
    const trafficRunId = this.trafficRunId;
    if (this.trafficRunPersistence) await this.trafficRunPersistence;
    const result = await this.orchestrator.execute(action, trafficRunId, {
      maxItems: this.config.maxItems,
      maxItemQuantity: this.config.maxItemQuantity,
      paymentSuccessRatio: this.config.successfulPaymentRatio,
    });
    const latencyMs = Date.now() - t0;
    this.totalRequests++;
    this.window.push({ ts: t0, success: result.success });
    void this.persistAction(result, action, latencyMs, trafficRunId);
    void pushActivity({
      ts: t0,
      action,
      success: result.success,
      latencyMs,
      trafficRunId,
      customerId: result.customerId,
      orderId: result.orderId,
      paymentId: result.paymentId,
      traceId: result.traceId,
      status: result.status,
      errorCode: result.errorCode,
    });
    await this.publishStatus();
  }

  private async persistAction(
    result: RunnerActionResult,
    action: RunnerAction,
    latencyMs: number,
    trafficRunId: string,
  ): Promise<void> {
    if (result.customerId <= 0) return;
    try {
      await recordTrafficAction({
        trafficRunId,
        actionId: result.actionId,
        customerId: result.customerId,
        actionType: action,
        status: result.status,
        orderId: result.orderId,
        paymentId: result.paymentId,
        cartVersion: result.cartVersion,
        resultCode: result.resultCode,
        errorCode: result.errorCode,
        traceId: result.traceId,
        latencyMs,
      });
    } catch (error) {
      log.error({ error, actionId: result.actionId }, 'Failed to persist runner action');
    }
  }

  private async refreshControlState(): Promise<void> {
    const state = await getRunnerControlState();
    this.paused = state.paused;
    this.rateMultiplier = state.rateMultiplier;
  }

  private async refreshConfigIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastConfigCheckAt < 5000) {
      return;
    }
    this.lastConfigCheckAt = now;
    const latest = await loadRunnerConfigFromDb();
    if (latest.version !== this.config.version) {
      this.config = latest;
      log.info({ version: latest.version }, 'Runner config reloaded from DB');
    }
  }

  private async publishStatus(): Promise<void> {
    await setRunnerStatus(this.getStatus());
  }
}

// Singleton
let engine: RunnerEngine | null = null;

export function getRunnerEngine(): RunnerEngine {
  if (!engine) {
    engine = new RunnerEngine();
  }
  return engine;
}
