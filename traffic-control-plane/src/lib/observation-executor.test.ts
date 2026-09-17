import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ObservationAdapterError,
  ObservationExecutor,
} from './observation-executor';

const windowStart = new Date('2026-09-16T10:00:00.000Z');
const windowEnd = new Date('2026-09-16T10:05:00.000Z');

test('keeps the default executor unknown without executing arbitrary queries', async () => {
  const executor = new ObservationExecutor({
    now: () => new Date('2026-09-16T10:06:00.000Z'),
  });
  const result = await executor.execute({ windowStart, windowEnd });

  assert.equal(result.summary.prometheus.status, 'UNKNOWN');
  assert.equal(result.summary.loki.status, 'UNKNOWN');
  assert.equal(result.summary.tempo.status, 'UNKNOWN');
  assert.equal(result.summary.retention, 'UNKNOWN');
  assert.deepEqual(result.limitations, [
    { code: 'OBSERVATION_ADAPTER_NOT_CONFIGURED', detail: 'prometheus' },
    { code: 'OBSERVATION_ADAPTER_NOT_CONFIGURED', detail: 'loki' },
    { code: 'OBSERVATION_ADAPTER_NOT_CONFIGURED', detail: 'tempo' },
    { code: 'OBSERVATION_ADAPTER_NOT_CONFIGURED', detail: 'retention' },
  ]);
});

test('normalizes adapter timeout, network, and authentication failures', async () => {
  const executor = new ObservationExecutor({
    now: () => new Date('2026-09-16T10:06:00.000Z'),
    adapters: {
      prometheus: { check: async () => { throw new ObservationAdapterError('TIMEOUT'); } },
      loki: { check: async () => { throw new ObservationAdapterError('NETWORK'); } },
      tempo: { check: async () => { throw new ObservationAdapterError('AUTHENTICATION'); } },
      retention: {
        check: async () => ({ status: 'AVAILABLE' }),
      },
    },
  });

  const result = await executor.execute({ windowStart, windowEnd });

  assert.equal(result.summary.prometheus.status, 'UNAVAILABLE');
  assert.equal(result.summary.loki.status, 'UNAVAILABLE');
  assert.equal(result.summary.tempo.status, 'UNAVAILABLE');
  assert.equal(result.summary.retention, 'CHECKED');
  assert.deepEqual(result.limitations.slice(0, 3), [
    { code: 'OBSERVATION_TIMEOUT', detail: 'prometheus' },
    { code: 'OBSERVATION_NETWORK_FAILURE', detail: 'loki' },
    { code: 'OBSERVATION_AUTHENTICATION_FAILED', detail: 'tempo' },
  ]);
});

test('normalizes expired and future windows without invoking adapters', async () => {
  let calls = 0;
  const executor = new ObservationExecutor({
    now: () => new Date('2026-09-24T10:06:00.000Z'),
    adapters: {
      prometheus: { check: async () => { calls++; return { status: 'AVAILABLE' }; } },
    },
  });

  const expired = await executor.execute({ windowStart, windowEnd });
  assert.equal(expired.summary.prometheus.status, 'UNKNOWN');
  assert.deepEqual(expired.limitations, [{ code: 'OBSERVATION_WINDOW_EXPIRED', detail: null }]);

  const future = await new ObservationExecutor({
    now: () => new Date('2026-09-16T10:04:00.000Z'),
  }).execute({ windowStart, windowEnd });
  assert.equal(future.summary.tempo.status, 'UNKNOWN');
  assert.deepEqual(future.limitations, [{ code: 'OBSERVATION_WINDOW_FUTURE', detail: null }]);
  assert.equal(calls, 0);
});
