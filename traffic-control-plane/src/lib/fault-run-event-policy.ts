export const MAX_FAULT_RUN_EVENT_PAYLOAD_BYTES = 8 * 1024;

export const RETIRED_HIGH_FREQUENCY_FAULT_RUN_EVENTS = [
  'REPORT_REQUEST',
  'REPORT_REQUEST_FAILED',
  'SCENARIO_REQUEST_FAILED',
] as const;

export class FaultRunEventPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultRunEventPolicyError';
  }
}

export function serializeFaultRunEventPayload(
  eventType: string,
  payload: unknown,
): string {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(eventType)) {
    throw new FaultRunEventPolicyError('INVALID_EVENT_TYPE');
  }
  if ((RETIRED_HIGH_FREQUENCY_FAULT_RUN_EVENTS as readonly string[]).includes(eventType)) {
    throw new FaultRunEventPolicyError(`RETIRED_HIGH_FREQUENCY_EVENT:${eventType}`);
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload ?? {});
  } catch {
    throw new FaultRunEventPolicyError('EVENT_PAYLOAD_NOT_SERIALIZABLE');
  }
  if (serialized === undefined) throw new FaultRunEventPolicyError('EVENT_PAYLOAD_NOT_SERIALIZABLE');
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FAULT_RUN_EVENT_PAYLOAD_BYTES) {
    throw new FaultRunEventPolicyError('EVENT_PAYLOAD_TOO_LARGE');
  }
  return serialized;
}
