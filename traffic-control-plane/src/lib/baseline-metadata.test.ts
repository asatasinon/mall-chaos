import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDeploymentMode,
  normalizeReleaseRevision,
  UNKNOWN_RELEASE_REVISION,
} from './baseline-metadata';

test('normalizes valid release revisions without guessing from runtime mode', () => {
  assert.deepEqual(normalizeReleaseRevision('sha256:abc123'), {
    value: 'sha256:abc123',
    limitation: null,
  });
  assert.deepEqual(normalizeReleaseRevision(' production '), {
    value: 'production',
    limitation: null,
  });
  assert.deepEqual(normalizeReleaseRevision(''), {
    value: UNKNOWN_RELEASE_REVISION,
    limitation: 'RELEASE_REVISION_UNKNOWN',
  });
  assert.deepEqual(normalizeReleaseRevision('not valid revision'), {
    value: UNKNOWN_RELEASE_REVISION,
    limitation: 'RELEASE_REVISION_UNKNOWN',
  });
});

test('accepts only explicit deployment modes', () => {
  assert.deepEqual(normalizeDeploymentMode('compose'), { value: 'compose', limitation: null });
  assert.deepEqual(normalizeDeploymentMode('kubernetes'), { value: 'kubernetes', limitation: null });
  assert.deepEqual(normalizeDeploymentMode('docker'), {
    value: 'unknown',
    limitation: 'DEPLOYMENT_MODE_UNKNOWN',
  });
});

