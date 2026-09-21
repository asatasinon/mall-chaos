import { randomUUID } from 'node:crypto';
import { forwardAbortSignal, throwIfAborted } from '../lib/abort-signal';
import { createFaultRunContext } from '../lib/fault-run-context';
import { normalizeFaultRunSummaryEventPayload } from '../lib/fault-run-event-contract';
import { loadRunnerConfigFromDb, type RunnerConfig } from '../lib/runner-config';
import { appendFaultRunEvent, type FaultRunRecord } from '../lib/fault-run-repository';
import { FaultRunOwnerFence } from '../lib/fault-run-owner-fence';
import type { OwnedFaultRunDriver, OwnedRunHandle } from './fault-run-driver';
import type { RunnerExecutionConfig, RunnerActionResult, TrafficActionOrchestrator } from './traffic-action-orchestrator';
import { TrafficActionOrchestrator as DefaultTrafficActionOrchestrator } from './traffic-action-orchestrator';

interface RunnerBackedDriverDependencies {
  loadConfig: typeof loadRunnerConfigFromDb;
  orchestrator: Pick<TrafficActionOrchestrator, 'executeLifecycle' | 'executeStorageGrowth'>;
  appendEvent: typeof appendFaultRunEvent;
}

export class RunnerBackedFaultRunDriver implements OwnedFaultRunDriver {
  readonly name = 'RUNNER_ENGINE';
  readonly drainOwner = 'RUNNER_ENGINE' as const;
  private readonly loadConfig: RunnerBackedDriverDependencies['loadConfig'];
  private readonly orchestrator: RunnerBackedDriverDependencies['orchestrator'];
  private readonly appendEvent: RunnerBackedDriverDependencies['appendEvent'];

  constructor(dependencies: Partial<RunnerBackedDriverDependencies> = {}) {
    this.loadConfig = dependencies.loadConfig ?? loadRunnerConfigFromDb;
    this.orchestrator = dependencies.orchestrator ?? new DefaultTrafficActionOrchestrator();
    this.appendEvent = dependencies.appendEvent ?? appendFaultRunEvent;
  }

  supports(run: FaultRunRecord): boolean {
    return run.scenario === 'NOTIFICATION_HEAP_PRESSURE'
      || run.scenario === 'NOTIFICATION_STORAGE_APPEND'
      || run.scenario === 'PSP_PROVIDER_OUTCOME';
  }

  async start(input: { run: FaultRunRecord; fence: FaultRunOwnerFence }): Promise<OwnedRunHandle> {
    const controller = new AbortController();
    const removeFenceAbortListener = forwardAbortSignal(input.fence.signal, controller);
    const trafficRunId = `fault-run-${input.run.faultRunId}`;
    const task = this.execute(input.run, trafficRunId, controller.signal);
    return {
      stop: async ({ reason }) => {
        controller.abort(reason);
        try {
          await task;
          return { drained: true, inFlight: 0 };
        } catch {
          return { drained: false, inFlight: 0, errorCode: 'RUNNER_DRIVER_FAILED' };
        } finally {
          removeFenceAbortListener();
        }
      },
    };
  }

  private async execute(
    run: FaultRunRecord,
    trafficRunId: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (run.scenario === 'NOTIFICATION_STORAGE_APPEND') {
      const result = await this.orchestrator.executeStorageGrowth(
        trafficRunId,
        createFaultRunContext(run),
        {
          signal,
          requestIntervalMs: Number(run.parameters.requestIntervalMs ?? 100),
          totalBytes: Number(run.parameters.totalBytes ?? 10 * 1024 ** 3),
        },
      );
      await this.recordSummary(run, result);
      return;
    }

    const config = await this.loadConfig();
    while (!signal.aborted && Date.parse(run.expiresAt) > Date.now()) {
      throwIfAborted(signal);
      const startedAt = Date.now();
      const result = await this.orchestrator.executeLifecycle(
        trafficRunId,
        toExecutionConfig(config),
        { signal },
      );
      await this.recordSummary(run, result, Date.now() - startedAt);
      if (signal.aborted) break;
      await abortableDelay(Math.max(config.lifecycleIntervalSec * 1000, 1000), signal);
    }
  }

  private async recordSummary(
    run: FaultRunRecord,
    result: RunnerActionResult,
    latencyMs = 0,
  ): Promise<void> {
    await this.appendEvent(
      run.faultRunId,
      'RUNNER_LIFECYCLE_SUMMARY',
      normalizeFaultRunSummaryEventPayload('RUNNER_LIFECYCLE_SUMMARY', {
        resultStatus: result.status,
        success: result.success,
        latencyMs,
        errorCode: result.errorCode,
      }),
    );
  }
}

function toExecutionConfig(config: RunnerConfig): RunnerExecutionConfig {
  return {
    maxItems: config.maxItems,
    maxItemQuantity: config.maxItemQuantity,
    paymentSuccessRatio: config.successfulPaymentRatio,
    couponUsageRatio: config.couponUsageRatio,
  };
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
