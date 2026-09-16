export const BASELINE_CAPTURE_ERROR_CODES = [
  'RUN_NOT_TERMINAL',
  'SOURCE_RUN_NOT_FOUND',
  'DISPATCH_UNVERIFIED',
  'MISSING_RUNTIME_EVENT',
  'COUNTER_INCONSISTENT',
  'OBSERVATION_UNAVAILABLE',
  'CATALOG_REVISION_FAILED',
  'BASELINE_CAPTURE_DISABLED',
] as const;

export type BaselineCaptureErrorCode = typeof BASELINE_CAPTURE_ERROR_CODES[number];

export const BASELINE_CAPTURE_ERROR_STATUS: Record<BaselineCaptureErrorCode, number> = {
  RUN_NOT_TERMINAL: 409,
  SOURCE_RUN_NOT_FOUND: 404,
  DISPATCH_UNVERIFIED: 422,
  MISSING_RUNTIME_EVENT: 422,
  COUNTER_INCONSISTENT: 422,
  OBSERVATION_UNAVAILABLE: 422,
  CATALOG_REVISION_FAILED: 500,
  BASELINE_CAPTURE_DISABLED: 404,
};

export class BaselineCaptureError extends Error {
  readonly code: BaselineCaptureErrorCode;
  readonly status: number;

  constructor(code: BaselineCaptureErrorCode, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = 'BaselineCaptureError';
    this.code = code;
    this.status = BASELINE_CAPTURE_ERROR_STATUS[code];
  }
}

export function assertBaselineSourceRun<T extends { state: string }>(
  run: T | null | undefined,
): asserts run is T {
  if (!run) throw new BaselineCaptureError('SOURCE_RUN_NOT_FOUND');
  if (!['RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'].includes(run.state)) {
    throw new BaselineCaptureError('RUN_NOT_TERMINAL');
  }
}
