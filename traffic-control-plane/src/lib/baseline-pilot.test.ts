import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPilotSelectionEligible,
  BaselinePilotValidationError,
  parsePilotReviewInput,
} from './baseline-pilot';
import type { ScenarioBaseline } from './baseline-schema';

const catalogRevision = 'a'.repeat(64);

test('parses bounded pilot review input without accepting executable remediation text', () => {
  const input = parsePilotReviewInput('BROWSE_REPORT_SQL', {
    confirmed: true,
    catalogRevision,
    decision: 'CANDIDATE',
    alertRules: [{
      name: 'report latency',
      threshold: '1s',
      duration: '5m',
      declared: true,
      observed: 'UNKNOWN',
    }],
    evidenceRequirements: [{ code: 'RETENTION_CHECK', detail: 'Verify the query window.' }],
    retentionSnapshot: { prometheus: 'UNKNOWN', checked: false },
    remediationBoundary: 'Restore the business dependency and verify the customer operation.',
    decisionReason: 'Candidate remains subject to runtime evidence.',
  }, catalogRevision);

  assert.equal(input.scenario, 'BROWSE_REPORT_SQL');
  assert.equal(input.alertRules[0]?.observed, 'UNKNOWN');
  assert.throws(
    () => parsePilotReviewInput('BROWSE_REPORT_SQL', {
      confirmed: true,
      catalogRevision,
      decision: 'CANDIDATE',
      alertRules: [],
      evidenceRequirements: [],
      retentionSnapshot: {},
      remediationBoundary: 'Stop the Fault Run and cleanup the resource.',
      decisionReason: 'Not allowed',
    }, catalogRevision),
    (error: unknown) => error instanceof BaselinePilotValidationError
      && error.code === 'INVALID_REMEDIATION_BOUNDARY',
  );
  assert.throws(
    () => parsePilotReviewInput('BROWSE_REPORT_SQL', {
      confirmed: true,
      catalogRevision,
      decision: 'CANDIDATE',
      alertRules: [],
      evidenceRequirements: [],
      retentionSnapshot: {},
      remediationBoundary: 'kubectl delete deployment catalog-service',
      decisionReason: 'Not allowed',
    }, catalogRevision),
    (error: unknown) => error instanceof BaselinePilotValidationError
      && error.code === 'INVALID_REMEDIATION_BOUNDARY',
  );
});

test('requires the current Catalog revision before saving a pilot review', () => {
  assert.throws(
    () => parsePilotReviewInput('BROWSE_REPORT_SQL', {
      confirmed: true,
      catalogRevision: 'b'.repeat(64),
      decision: 'REJECTED',
      alertRules: [],
      evidenceRequirements: [],
      retentionSnapshot: {},
      remediationBoundary: 'Document the business remediation boundary.',
      decisionReason: 'Evidence is not sufficient.',
    }, catalogRevision),
    (error: unknown) => error instanceof BaselinePilotValidationError
      && error.code === 'PILOT_REVIEW_CONFLICT',
  );
});

test('blocks SELECTED when baseline observation and alert evidence are unknown', () => {
  const baseline = {
    captureStatus: 'COMPLETE_WITH_LIMITATIONS',
    knownLimitations: [],
    outcome: {
      businessRecovered: 'YES',
      resourceCleanup: 'COMPLETED',
    },
    observationSummary: {
      prometheus: { status: 'UNKNOWN' },
      loki: { status: 'AVAILABLE' },
      tempo: { status: 'AVAILABLE' },
      retention: 'UNKNOWN',
    },
    alertSummary: { status: 'UNKNOWN', rules: [] },
  } as unknown as ScenarioBaseline;

  assert.throws(
    () => assertPilotSelectionEligible([baseline]),
    (error: unknown) => error instanceof BaselinePilotValidationError
      && error.code === 'PILOT_EVIDENCE_UNAVAILABLE',
  );
});

test('rejects sensitive, raw, executable, and oversized review payloads', () => {
  const baseReview = {
    confirmed: true,
    catalogRevision,
    decision: 'CANDIDATE',
    alertRules: [],
    evidenceRequirements: [],
    retentionSnapshot: { prometheus: 'UNKNOWN' },
    remediationBoundary: 'Restore the business dependency and verify the customer operation.',
    decisionReason: 'Evidence remains subject to runtime verification.',
  };
  const assertRejected = (body: unknown, code: string) => {
    assert.throws(
      () => parsePilotReviewInput('BROWSE_REPORT_SQL', body, catalogRevision),
      (error: unknown) => error instanceof BaselinePilotValidationError && error.code === code,
    );
  };

  assertRejected({ ...baseReview, rawResponse: '{"headers":{"Authorization":"secret"}}' }, 'INVALID_PILOT_REVIEW');
  assertRejected({
    ...baseReview,
    alertRules: [{ name: 'availability', rawResponse: 'full HTTP response' }],
  }, 'INVALID_PILOT_ALERT_RULES');
  assertRejected({
    ...baseReview,
    evidenceRequirements: [{ code: 'OBSERVATION', detail: 'Authorization: bearer secret' }],
  }, 'INVALID_PILOT_EVIDENCE');
  assertRejected({
    ...baseReview,
    retentionSnapshot: { password: 'secret' },
  }, 'INVALID_PILOT_RETENTION');
  assertRejected({
    ...baseReview,
    decisionReason: 'curl https://example.invalid/health',
  }, 'INVALID_PILOT_REVIEW_REASON');
  assertRejected({
    ...baseReview,
    evidenceRequirements: Array.from({ length: 64 }, () => ({
      code: 'OBSERVATION',
      detail: 'x'.repeat(200),
    })),
  }, 'INVALID_PILOT_REVIEW');
});
