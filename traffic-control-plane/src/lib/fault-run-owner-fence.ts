import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

export class FaultRunOwnerFence {
  private readonly controller = new AbortController();
  private current = true;

  constructor(
    public readonly faultRunId: string,
    public readonly ownerId: string,
    public readonly ownerEpoch: number,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  isLocallyCurrent(): boolean {
    return this.current;
  }

  assertLocallyCurrent(): void {
    if (!this.current) throw new Error('OWNER_LEASE_LOST');
  }

  lose(reason = 'OWNER_LEASE_LOST'): void {
    if (!this.current) return;
    this.current = false;
    this.controller.abort(reason);
  }
}

export function createWorkerOwnerId(
  prefix: string,
  host = hostname(),
  bootId = randomUUID(),
): string {
  const ownerId = `${prefix}/${host}/${bootId}`;
  if (ownerId.length > 192) throw new Error('OWNER_ID_TOO_LONG');
  return ownerId;
}
