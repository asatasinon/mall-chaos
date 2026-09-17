import { env } from './env';
import {
  BASELINE_OBSERVATION_STATUSES,
  BASELINE_RETENTION_STATUSES,
  type BaselineObservationCheck,
  type BaselineObservationStatus,
  type BaselineObservationSummary,
  type BaselineRetentionStatus,
} from './baseline-schema';

export const OBSERVATION_CHECKS = {
  prometheus: 'PROMETHEUS_ALERTS',
  loki: 'LOKI_SERVICE_ERRORS',
  tempo: 'TEMPO_SERVICE_TRACES',
  retention: 'OBSERVABILITY_RETENTION',
} as const;

export type ObservationCheckName = keyof typeof OBSERVATION_CHECKS;
export type ObservationResultStatus = BaselineObservationStatus | BaselineRetentionStatus;
export type ObservationFailureCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'AUTHENTICATION'
  | 'EXPIRED_WINDOW'
  | 'INVALID_WINDOW';

export interface ObservationWindow {
  windowStart: Date;
  windowEnd: Date;
}

export interface ObservationAdapterContext extends ObservationWindow {
  check: ObservationCheckName;
  reference: string;
  signal: AbortSignal;
}

export interface ObservationAdapterResult {
  status: ObservationResultStatus;
  limitation?: string | null;
}

export interface ObservationAdapter {
  check(context: ObservationAdapterContext): Promise<ObservationAdapterResult>;
}

export interface ObservationExecutorOptions {
  adapters?: Partial<Record<ObservationCheckName, ObservationAdapter>>;
  checkTimeoutMs?: number;
  maxWindowAgeMs?: number;
  now?: () => Date;
}

export interface ObservationExecutionInput extends ObservationWindow {
  signal?: AbortSignal;
}

export interface ObservationExecutionResult {
  summary: BaselineObservationSummary;
  limitations: Array<{ code: string; detail: string | null }>;
}

export class ObservationAdapterError extends Error {
  constructor(public readonly code: ObservationFailureCode) {
    super(`OBSERVATION_${code}`);
    this.name = 'ObservationAdapterError';
  }
}

export class ObservationExecutor {
  private readonly adapters: Partial<Record<ObservationCheckName, ObservationAdapter>>;
  private readonly checkTimeoutMs: number;
  private readonly maxWindowAgeMs: number;
  private readonly now: () => Date;

  constructor(options: ObservationExecutorOptions = {}) {
    this.adapters = options.adapters ?? {};
    this.checkTimeoutMs = boundedTimeout(options.checkTimeoutMs ?? env.BASELINE_OBSERVATION_CHECK_TIMEOUT_MS);
    this.maxWindowAgeMs = options.maxWindowAgeMs ?? 168 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  async execute(input: ObservationExecutionInput): Promise<ObservationExecutionResult> {
    const now = this.now();
    const windowError = validateWindow(input, now, this.maxWindowAgeMs);
    if (windowError) return unknownExecution(input, windowError);

    const results = new Map<ObservationCheckName, BaselineObservationCheck>();
    const limitations: Array<{ code: string; detail: string | null }> = [];
    for (const check of Object.keys(OBSERVATION_CHECKS) as ObservationCheckName[]) {
      const result = await this.executeCheck(check, input, now);
      results.set(check, result.check);
      if (result.limitation) addLimitation(limitations, result.limitation, check);
    }

    return {
      summary: {
        prometheus: results.get('prometheus')!,
        loki: results.get('loki')!,
        tempo: results.get('tempo')!,
        retention: toRetentionStatus(results.get('retention')!.status),
      },
      limitations,
    };
  }

  private async executeCheck(
    check: ObservationCheckName,
    input: ObservationExecutionInput,
    now: Date,
  ): Promise<{ check: BaselineObservationCheck; limitation: string | null }> {
    const adapter = this.adapters[check];
    if (!adapter) {
      return {
        check: unknownCheck(input, null, 'OBSERVATION_ADAPTER_NOT_CONFIGURED'),
        limitation: 'OBSERVATION_ADAPTER_NOT_CONFIGURED',
      };
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.checkTimeoutMs);
    const abortInput = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', abortInput, { once: true });
    try {
      const result = await adapter.check({
        check,
        reference: OBSERVATION_CHECKS[check],
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        signal: controller.signal,
      });
      validateAdapterResult(result, check);
      const status = check === 'retention' && result.status === 'CHECKED'
        ? 'AVAILABLE' : result.status;
      return {
        check: {
          status: status as BaselineObservationStatus,
          checkedAt: now.toISOString(),
          windowStart: input.windowStart.toISOString(),
          windowEnd: input.windowEnd.toISOString(),
          queryReference: OBSERVATION_CHECKS[check],
          limitation: result.limitation ?? null,
        },
        limitation: result.limitation ?? null,
      };
    } catch (error) {
      if (timedOut) return failedCheck(check, input, now, 'OBSERVATION_TIMEOUT');
      if (error instanceof ObservationAdapterError) {
        return failedCheck(check, input, now, normalizeFailure(error.code));
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abortInput);
    }
  }
}

function validateWindow(
  input: ObservationExecutionInput,
  now: Date,
  maxWindowAgeMs: number,
): string | null {
  const start = input.windowStart.getTime();
  const end = input.windowEnd.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'OBSERVATION_WINDOW_INVALID';
  if (end > now.getTime()) return 'OBSERVATION_WINDOW_FUTURE';
  if (end < now.getTime() - maxWindowAgeMs) return 'OBSERVATION_WINDOW_EXPIRED';
  return null;
}

function unknownExecution(
  input: ObservationExecutionInput,
  limitation: string,
): ObservationExecutionResult {
  const check = (name: ObservationCheckName): BaselineObservationCheck => unknownCheck(input, name, limitation);
  return {
    summary: {
      prometheus: check('prometheus'),
      loki: check('loki'),
      tempo: check('tempo'),
      retention: 'UNKNOWN',
    },
    limitations: [{ code: limitation, detail: null }],
  };
}

function unknownCheck(
  input: ObservationExecutionInput,
  reference: ObservationCheckName | null,
  limitation: string | null,
): BaselineObservationCheck {
  return {
    status: 'UNKNOWN',
    checkedAt: null,
    windowStart: validDate(input.windowStart) ? input.windowStart.toISOString() : null,
    windowEnd: validDate(input.windowEnd) ? input.windowEnd.toISOString() : null,
    queryReference: reference ? OBSERVATION_CHECKS[reference] : null,
    limitation,
  };
}

function failedCheck(
  check: ObservationCheckName,
  input: ObservationExecutionInput,
  now: Date,
  limitation: string,
): { check: BaselineObservationCheck; limitation: string } {
  return {
    check: {
      status: 'UNAVAILABLE',
      checkedAt: now.toISOString(),
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
      queryReference: OBSERVATION_CHECKS[check],
      limitation,
    },
    limitation,
  };
}

function normalizeFailure(code: ObservationFailureCode): string {
  switch (code) {
    case 'TIMEOUT': return 'OBSERVATION_TIMEOUT';
    case 'NETWORK': return 'OBSERVATION_NETWORK_FAILURE';
    case 'AUTHENTICATION': return 'OBSERVATION_AUTHENTICATION_FAILED';
    case 'EXPIRED_WINDOW': return 'OBSERVATION_WINDOW_EXPIRED';
    case 'INVALID_WINDOW': return 'OBSERVATION_WINDOW_INVALID';
  }
}

function toRetentionStatus(status: ObservationResultStatus): BaselineRetentionStatus {
  if (status === 'AVAILABLE') return 'CHECKED';
  if (BASELINE_RETENTION_STATUSES.includes(status as BaselineRetentionStatus)) {
    return status as BaselineRetentionStatus;
  }
  return 'UNKNOWN';
}

function validateAdapterResult(result: ObservationAdapterResult, check: ObservationCheckName): void {
  if (!result || !BASELINE_OBSERVATION_STATUSES.includes(result.status as BaselineObservationStatus)
      && !(check === 'retention' && BASELINE_RETENTION_STATUSES.includes(result.status as BaselineRetentionStatus))) {
    throw new Error(`INVALID_OBSERVATION_RESULT:${check}`);
  }
  if (result.limitation !== undefined
      && result.limitation !== null
      && !/^[A-Z][A-Z0-9_.:-]{0,63}$/.test(result.limitation)) {
    throw new Error(`INVALID_OBSERVATION_LIMITATION:${check}`);
  }
}

function addLimitation(
  limitations: Array<{ code: string; detail: string | null }>,
  code: string,
  detail: string | null,
): void {
  if (!limitations.some((item) => item.code === code && item.detail === detail)) {
    limitations.push({ code, detail });
  }
}

function validDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function boundedTimeout(value: number): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, 1000), 60_000) : 5000;
}
