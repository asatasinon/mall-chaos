import type { FaultRunRecord } from './fault-run-repository';

export interface FaultRunContext {
  faultRunId: string;
  expiresAt: string;
  fencingToken: number;
  idempotencyKey: string;
}

export function createFaultRunContext(run: FaultRunRecord): FaultRunContext {
  return {
    faultRunId: run.faultRunId,
    expiresAt: run.expiresAt,
    fencingToken: run.fencingToken,
    idempotencyKey: run.idempotencyKey,
  };
}

export function validateFaultRunContext(
  value: unknown,
  options: { now?: Date; allowExpired?: boolean } = {},
): FaultRunContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_FAULT_RUN_CONTEXT');
  }
  const context = value as Record<string, unknown>;
  if (typeof context.faultRunId !== 'string' || !/^[0-9a-f-]{36}$/i.test(context.faultRunId)
      || typeof context.expiresAt !== 'string' || Number.isNaN(Date.parse(context.expiresAt))
      || typeof context.fencingToken !== 'number' || !Number.isSafeInteger(context.fencingToken)
      || context.fencingToken < 1
      || typeof context.idempotencyKey !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(context.idempotencyKey)) {
    throw new Error('INVALID_FAULT_RUN_CONTEXT');
  }
  if (!options.allowExpired && new Date(context.expiresAt).getTime() <= (options.now ?? new Date()).getTime()) {
    throw new Error('FAULT_RUN_CONTEXT_EXPIRED');
  }
  return {
    faultRunId: context.faultRunId,
    expiresAt: context.expiresAt,
    fencingToken: context.fencingToken,
    idempotencyKey: context.idempotencyKey,
  };
}
