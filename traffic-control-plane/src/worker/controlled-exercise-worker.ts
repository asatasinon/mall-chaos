import { appendFaultRunEvent } from '../lib/fault-run-repository';
import type { FaultRunRecord } from '../lib/fault-run-repository';

export interface ExerciseWorkerStats {
  requests: number;
  successes: number;
  failures: number;
  inFlight: number;
  stopReason: string | null;
  averageLatencyMs: number;
}

export interface ControlledExerciseOptions {
  concurrency: number;
  requestIntervalMs: number;
  request: (signal: AbortSignal) => Promise<void>;
}

export class ControlledExerciseWorker {
  private readonly controller = new AbortController();
  private readonly stats: ExerciseWorkerStats = {
    requests: 0,
    successes: 0,
    failures: 0,
    inFlight: 0,
    stopReason: null,
    averageLatencyMs: 0,
  };
  private totalLatencyMs = 0;
  private running: Promise<void> | null = null;

  constructor(
    private readonly run: FaultRunRecord,
    private readonly options: ControlledExerciseOptions,
    private readonly eventWriter: (runId: string, eventType: string, payload?: unknown) => Promise<void> = appendFaultRunEvent,
  ) {}

  start(): Promise<void> {
    if (!this.running) {
      this.running = this.execute();
    }
    return this.running;
  }

  async stop(reason = 'STOP_REQUESTED'): Promise<ExerciseWorkerStats> {
    if (!this.stats.stopReason) this.stats.stopReason = reason;
    this.controller.abort(reason);
    if (this.running) await this.running;
    return { ...this.stats };
  }

  snapshot(): ExerciseWorkerStats {
    return { ...this.stats };
  }

  private async execute(): Promise<void> {
    await this.eventWriter(this.run.faultRunId, 'EXERCISE_WORKER_STARTED', {
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
      if (this.stats.requests > 0) this.stats.averageLatencyMs = Math.round(this.totalLatencyMs / this.stats.requests);
      await this.eventWriter(this.run.faultRunId, 'EXERCISE_WORKER_STOPPED', this.stats).catch(() => undefined);
    }
  }

  private async requestOnce(): Promise<void> {
    if (this.controller.signal.aborted) return;
    this.stats.requests++;
    this.stats.inFlight++;
    const startedAt = Date.now();
    try {
      await this.options.request(this.controller.signal);
      this.stats.successes++;
    } catch (error) {
      if (!this.controller.signal.aborted) {
        this.stats.failures++;
        await this.eventWriter(this.run.faultRunId, 'EXERCISE_REQUEST_FAILED', {
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
    } finally {
      this.stats.inFlight--;
      this.totalLatencyMs += Date.now() - startedAt;
    }
  }
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
