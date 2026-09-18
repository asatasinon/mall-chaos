import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NotificationRestartBrokerError,
  parseNotificationRestartResult,
  parseNotificationRestartSummary,
  summarizeNotificationRestartResult,
} from './notification-restart-broker';

test('notification restart parsing keeps only the closed broker response contract', () => {
  const result = parseNotificationRestartResult({
    accepted: true,
    target: 'notification-service',
    mode: 'compose',
    restarted: true,
    healthy: true,
    healthStatus: 'UP',
    elapsedMs: 321,
    rawTargetPayload: 'must-not-be-persisted',
  });

  assert.deepEqual(result, {
    accepted: true,
    target: 'notification-service',
    mode: 'compose',
    restarted: true,
    healthy: true,
    healthStatus: 'UP',
    elapsedMs: 321,
  });
});

test('notification restart parsing rejects invalid broker response fields', () => {
  assert.throws(
    () => parseNotificationRestartResult({
      accepted: true,
      target: 'notification-service',
      mode: 'compose',
      restarted: true,
      healthy: true,
      healthStatus: 'target response body',
      elapsedMs: 321,
    }),
    NotificationRestartBrokerError,
  );
});

test('restart summaries exclude deployment mode, timing, and untrusted response fields', () => {
  const summary = summarizeNotificationRestartResult(parseNotificationRestartResult({
    accepted: true,
    target: 'notification-service',
    mode: 'compose',
    restarted: true,
    healthy: true,
    healthStatus: 'UP',
    elapsedMs: 321,
  }));

  assert.deepEqual(summary, {
    restarted: true,
    healthy: true,
    healthStatus: 'UP',
  });
  assert.deepEqual(parseNotificationRestartSummary({
    ...summary,
    rawTargetPayload: 'must-not-be-returned',
  }), summary);
  assert.throws(
    () => parseNotificationRestartSummary({
      restarted: true,
      healthy: true,
      healthStatus: 'target response body',
    }),
    NotificationRestartBrokerError,
  );
});
