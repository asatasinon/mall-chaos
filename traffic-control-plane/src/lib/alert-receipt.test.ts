import assert from 'node:assert/strict';
import test from 'node:test';
import { createReceiptKey } from './alert-receipt';
import {
  hasServiceKey,
  parseAlertmanagerWebhook,
  parseAlertmanagerWebhookBody,
} from './alertmanager-webhook';

const baseAlert = {
  labels: {
    alertname: 'HighErrorRate',
    severity: 'critical',
    service: 'cart-service',
  },
  startsAt: '2026-09-16T10:00:00.000Z',
  endsAt: '0001-01-01T00:00:00Z',
  fingerprint: 'abc123',
};

test('parses firing and resolved Alertmanager alerts into low-cardinality receipts', () => {
  const firing = parseAlertmanagerWebhook({
    status: 'firing',
    receiver: 'critical-receiver',
    alerts: [{ ...baseAlert, status: 'firing' }],
  });
  const resolved = parseAlertmanagerWebhook({
    status: 'resolved',
    receiver: 'critical-receiver',
    alerts: [{
      ...baseAlert,
      status: 'resolved',
      endsAt: '2026-09-16T10:05:00.000Z',
      annotations: { description: 'raw text is intentionally ignored' },
    }],
  });

  assert.equal(firing.length, 1);
  assert.deepEqual(firing[0], {
    fingerprint: 'abc123',
    status: 'firing',
    receiver: 'critical-receiver',
    alertName: 'HighErrorRate',
    severity: 'critical',
    service: 'cart-service',
    startsAt: new Date('2026-09-16T10:00:00.000Z'),
    endsAt: null,
  });
  assert.equal(resolved[0].status, 'resolved');
  assert.equal(resolved[0].endsAt?.toISOString(), '2026-09-16T10:05:00.000Z');
  assert.equal(Object.keys(resolved[0]).includes('annotations'), false);
  assert.notEqual(createReceiptKey(firing[0]), createReceiptKey(resolved[0]));
});

test('rejects unbounded or incomplete Alertmanager labels', () => {
  assert.throws(
    () => parseAlertmanagerWebhook({
      status: 'firing',
      receiver: 'critical-receiver',
      alerts: [{ ...baseAlert, fingerprint: 'x'.repeat(129) }],
    }),
    (error: unknown) => typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'INVALID_ALERTMANAGER_FINGERPRINT',
  );
  assert.throws(
    () => parseAlertmanagerWebhook({
      status: 'firing',
      receiver: 'critical-receiver',
      alerts: [{ ...baseAlert, labels: { severity: 'critical' } }],
    }),
    (error: unknown) => typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'INVALID_ALERTMANAGER_ALERTNAME',
  );
  assert.throws(
    () => parseAlertmanagerWebhook({
      status: 'resolved',
      receiver: 'critical-receiver',
      alerts: [{
        ...baseAlert,
        status: 'resolved',
        endsAt: '2026-09-16T09:59:00.000Z',
      }],
    }),
    (error: unknown) => typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'INVALID_ALERTMANAGER_TIMESTAMP',
  );
});

test('accepts the protected service key through either supported header', () => {
  assert.equal(hasServiceKey(new Request('http://localhost', {
    headers: { authorization: 'Bearer internal-key' },
  }), 'internal-key'), true);
  assert.equal(hasServiceKey(new Request('http://localhost', {
    headers: { 'x-internal-service-key': 'internal-key' },
  }), 'internal-key'), true);
  assert.equal(hasServiceKey(new Request('http://localhost', {
    headers: { authorization: 'Bearer wrong-key' },
  }), 'internal-key'), false);
  assert.equal(hasServiceKey(new Request('http://localhost'), 'internal-key'), false);
});

test('rejects malformed and oversized webhook bodies before persistence', () => {
  assert.throws(
    () => parseAlertmanagerWebhookBody('{not-json'),
    (error: unknown) => typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'INVALID_ALERTMANAGER_PAYLOAD',
  );
  assert.throws(
    () => parseAlertmanagerWebhookBody('x'.repeat(256 * 1024 + 1)),
    (error: unknown) => typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'ALERT_RECEIPT_PAYLOAD_TOO_LARGE',
  );
});
