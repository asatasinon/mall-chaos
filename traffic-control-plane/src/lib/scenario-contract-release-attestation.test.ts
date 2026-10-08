import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  createScenarioContractReleaseAttestation,
  ScenarioContractReleaseAttestationError,
  validateScenarioContractReleaseAttestation,
} from './scenario-contract-release-attestation';

const SOURCE_COMMIT_SHA = 'a'.repeat(40);
const CATALOG_REVISION = 'b'.repeat(64);
const CONTROL_PLANE_IMAGE = `castrel/traffic-control-plane@sha256:${'c'.repeat(64)}`;
const IMAGE_DIGESTS = {
  gateway: `castrel/gateway-service@sha256:${'d'.repeat(64)}`,
  'traffic-control-plane': CONTROL_PLANE_IMAGE,
  'traffic-control-plane-worker': CONTROL_PLANE_IMAGE,
};

function validFinalReport(): string {
  return `${JSON.stringify({
    schemaVersion: 'scenario-contract-report.v1',
    stage: 'FINAL',
    scope: 'STATIC_CONTRACT',
    catalogRevision: CATALOG_REVISION,
    status: 'VALID',
    sourceCommitSha: SOURCE_COMMIT_SHA,
    scenarios: [{ scenario: 'EXAMPLE_SCENARIO', status: 'VALID' }],
    requiredChecks: [{
      checkId: 'example.check',
      status: 'PASSED',
      catalogRevision: CATALOG_REVISION,
      sourceCommitSha: SOURCE_COMMIT_SHA,
    }],
    blockingIssues: [],
    readinessNotes: [],
  })}\n`;
}

test('creates and validates an attestation bound to the raw final report and image map', () => {
  const finalReportJson = validFinalReport();
  const attestation = createScenarioContractReleaseAttestation({
    finalReportJson,
    imageDigests: IMAGE_DIGESTS,
    requiredCheckRunId: 'release-check-run-42',
  });
  const validated = validateScenarioContractReleaseAttestation({
    finalReportJson,
    attestation,
    deployedImageDigests: {
      'traffic-control-plane': CONTROL_PLANE_IMAGE,
      'traffic-control-plane-worker': CONTROL_PLANE_IMAGE,
      gateway: IMAGE_DIGESTS.gateway,
    },
    controlPlaneImage: CONTROL_PLANE_IMAGE,
  });

  assert.equal(attestation.schemaVersion, 'scenario-contract-release-attestation.v1');
  assert.equal(
    attestation.finalReportSha256,
    createHash('sha256').update(finalReportJson, 'utf8').digest('hex'),
  );
  assert.deepEqual(validated.imageDigests, IMAGE_DIGESTS);
});

test('rejects reports that are not final, valid, same-commit check sets', () => {
  for (const update of [
    { stage: 'PREFLIGHT' },
    { status: 'BLOCKED' },
    { sourceCommitSha: null },
    { requiredChecks: [{
      checkId: 'example.check',
      status: 'PASSED',
      catalogRevision: CATALOG_REVISION,
      sourceCommitSha: 'f'.repeat(40),
    }] },
  ]) {
    const finalReportJson = `${JSON.stringify({ ...JSON.parse(validFinalReport()), ...update })}\n`;
    assert.throws(
      () => createScenarioContractReleaseAttestation({
        finalReportJson,
        imageDigests: IMAGE_DIGESTS,
        requiredCheckRunId: 'check-run',
      }),
      (error: unknown) => error instanceof ScenarioContractReleaseAttestationError
        && error.code === 'FINAL_REPORT_INVALID',
    );
  }
});

test('rejects report hash, workload digest, and malformed image-map drift', () => {
  const finalReportJson = validFinalReport();
  const attestation = createScenarioContractReleaseAttestation({
    finalReportJson,
    imageDigests: IMAGE_DIGESTS,
    requiredCheckRunId: 'check-run',
  });

  assert.throws(
    () => validateScenarioContractReleaseAttestation({
      finalReportJson: `${finalReportJson} `,
      attestation,
      deployedImageDigests: IMAGE_DIGESTS,
      controlPlaneImage: CONTROL_PLANE_IMAGE,
    }),
    (error: unknown) => error instanceof ScenarioContractReleaseAttestationError
      && error.code === 'RELEASE_ATTESTATION_MISMATCH',
  );
  assert.throws(
    () => validateScenarioContractReleaseAttestation({
      finalReportJson,
      attestation,
      deployedImageDigests: { gateway: `castrel/gateway-service@sha256:${'e'.repeat(64)}` },
      controlPlaneImage: CONTROL_PLANE_IMAGE,
    }),
    (error: unknown) => error instanceof ScenarioContractReleaseAttestationError
      && error.code === 'RELEASE_ATTESTATION_MISMATCH',
  );
  assert.throws(
    () => createScenarioContractReleaseAttestation({
      finalReportJson,
      imageDigests: { gateway: 'castrel/gateway-service:latest' },
      requiredCheckRunId: 'check-run',
    }),
    (error: unknown) => error instanceof ScenarioContractReleaseAttestationError
      && error.code === 'IMAGE_DIGEST_MAP_INVALID',
  );
});
