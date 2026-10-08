import { createHash } from 'node:crypto';

export const SCENARIO_CONTRACT_RELEASE_ATTESTATION_SCHEMA_VERSION =
  'scenario-contract-release-attestation.v1' as const;

export interface ScenarioContractReleaseAttestation {
  readonly schemaVersion: typeof SCENARIO_CONTRACT_RELEASE_ATTESTATION_SCHEMA_VERSION;
  readonly sourceCommitSha: string;
  readonly catalogRevision: string;
  readonly finalReportSha256: string;
  readonly imageDigests: Readonly<Record<string, string>>;
  readonly requiredCheckRunId: string;
}

export type ScenarioContractReleaseAttestationErrorCode =
  | 'FINAL_REPORT_INVALID'
  | 'RELEASE_ATTESTATION_INVALID'
  | 'RELEASE_ATTESTATION_MISMATCH'
  | 'IMAGE_DIGEST_MAP_INVALID'
  | 'APPLICATION_IMAGE_SET_MISMATCH';

export class ScenarioContractReleaseAttestationError extends Error {
  constructor(readonly code: ScenarioContractReleaseAttestationErrorCode) {
    super(code);
    this.name = 'ScenarioContractReleaseAttestationError';
  }
}

const COMMIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CATALOG_REVISION_PATTERN = /^[a-f0-9]{64}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SERVICE_NAME_PATTERN =
  /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?(?:\/[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?)*$/u;
const IMAGE_DIGEST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/u;
const CHECK_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export function createScenarioContractReleaseAttestation(input: {
  readonly finalReportJson: string;
  readonly imageDigests: Readonly<Record<string, string>>;
  readonly requiredCheckRunId: string;
}): ScenarioContractReleaseAttestation {
  const finalReport = parseFinalReleaseReport(input.finalReportJson);
  if (!CHECK_RUN_ID_PATTERN.test(input.requiredCheckRunId)) {
    throw new ScenarioContractReleaseAttestationError('RELEASE_ATTESTATION_INVALID');
  }
  const imageDigests = normalizeImageDigests(input.imageDigests);

  return Object.freeze({
    schemaVersion: SCENARIO_CONTRACT_RELEASE_ATTESTATION_SCHEMA_VERSION,
    sourceCommitSha: finalReport.sourceCommitSha,
    catalogRevision: finalReport.catalogRevision,
    finalReportSha256: createHash('sha256')
      .update(input.finalReportJson, 'utf8')
      .digest('hex'),
    imageDigests: Object.freeze(imageDigests),
    requiredCheckRunId: input.requiredCheckRunId,
  });
}

export function validateScenarioContractReleaseAttestation(input: {
  readonly finalReportJson: string;
  readonly attestation: unknown;
  readonly deployedImageDigests: Readonly<Record<string, string>>;
  readonly controlPlaneImage: string;
}): ScenarioContractReleaseAttestation {
  const finalReport = parseFinalReleaseReport(input.finalReportJson);
  const attestation = asRecord(input.attestation);
  if (!attestation
    || !hasExactKeys(attestation, [
      'schemaVersion',
      'sourceCommitSha',
      'catalogRevision',
      'finalReportSha256',
      'imageDigests',
      'requiredCheckRunId',
    ])
    || attestation.schemaVersion !== SCENARIO_CONTRACT_RELEASE_ATTESTATION_SCHEMA_VERSION
    || typeof attestation.sourceCommitSha !== 'string'
    || !COMMIT_SHA_PATTERN.test(attestation.sourceCommitSha)
    || typeof attestation.catalogRevision !== 'string'
    || !CATALOG_REVISION_PATTERN.test(attestation.catalogRevision)
    || typeof attestation.finalReportSha256 !== 'string'
    || !SHA256_PATTERN.test(attestation.finalReportSha256)
    || typeof attestation.requiredCheckRunId !== 'string'
    || !CHECK_RUN_ID_PATTERN.test(attestation.requiredCheckRunId)) {
    throw new ScenarioContractReleaseAttestationError('RELEASE_ATTESTATION_INVALID');
  }

  const imageDigests = normalizeImageDigests(attestation.imageDigests);
  const reportHash = createHash('sha256').update(input.finalReportJson, 'utf8').digest('hex');
  if (attestation.sourceCommitSha !== finalReport.sourceCommitSha
    || attestation.catalogRevision !== finalReport.catalogRevision
    || attestation.finalReportSha256 !== reportHash
    || imageDigests['traffic-control-plane'] !== input.controlPlaneImage
    || imageDigests['traffic-control-plane-worker'] !== input.controlPlaneImage
    || !sameImageDigestSubset(input.deployedImageDigests, imageDigests)) {
    throw new ScenarioContractReleaseAttestationError('RELEASE_ATTESTATION_MISMATCH');
  }

  return Object.freeze({
    schemaVersion: SCENARIO_CONTRACT_RELEASE_ATTESTATION_SCHEMA_VERSION,
    sourceCommitSha: attestation.sourceCommitSha,
    catalogRevision: attestation.catalogRevision,
    finalReportSha256: attestation.finalReportSha256,
    imageDigests: Object.freeze(imageDigests),
    requiredCheckRunId: attestation.requiredCheckRunId,
  });
}

function parseFinalReleaseReport(finalReportJson: string): {
  readonly sourceCommitSha: string;
  readonly catalogRevision: string;
} {
  let reportValue: unknown;
  try {
    reportValue = JSON.parse(finalReportJson) as unknown;
  } catch {
    throw new ScenarioContractReleaseAttestationError('FINAL_REPORT_INVALID');
  }
  const report = asRecord(reportValue);
  const checks = Array.isArray(report?.requiredChecks) ? report.requiredChecks : [];
  const scenarios = Array.isArray(report?.scenarios) ? report.scenarios : [];
  if (!report
    || report.schemaVersion !== 'scenario-contract-report.v1'
    || report.stage !== 'FINAL'
    || report.scope !== 'STATIC_CONTRACT'
    || report.status !== 'VALID'
    || typeof report.sourceCommitSha !== 'string'
    || !COMMIT_SHA_PATTERN.test(report.sourceCommitSha)
    || typeof report.catalogRevision !== 'string'
    || !CATALOG_REVISION_PATTERN.test(report.catalogRevision)
    || !Array.isArray(report.blockingIssues)
    || report.blockingIssues.length !== 0
    || scenarios.length === 0
    || scenarios.some((scenario) => asRecord(scenario)?.status !== 'VALID')
    || checks.length === 0
    || checks.some((checkValue) => {
      const check = asRecord(checkValue);
      return !check
        || check.status !== 'PASSED'
        || check.catalogRevision !== report.catalogRevision
        || check.sourceCommitSha !== report.sourceCommitSha;
    })) {
    throw new ScenarioContractReleaseAttestationError('FINAL_REPORT_INVALID');
  }

  return {
    sourceCommitSha: report.sourceCommitSha,
    catalogRevision: report.catalogRevision,
  };
}

function normalizeImageDigests(value: unknown): Record<string, string> {
  const input = asRecord(value);
  if (!input || Object.keys(input).length === 0) {
    throw new ScenarioContractReleaseAttestationError('IMAGE_DIGEST_MAP_INVALID');
  }
  const imageDigests: Record<string, string> = {};
  for (const service of Object.keys(input).sort(compareText)) {
    const image = input[service];
    if (!SERVICE_NAME_PATTERN.test(service)
      || typeof image !== 'string'
      || !IMAGE_DIGEST_PATTERN.test(image)) {
      throw new ScenarioContractReleaseAttestationError('IMAGE_DIGEST_MAP_INVALID');
    }
    imageDigests[service] = image;
  }
  return imageDigests;
}

function sameImageDigestSubset(
  deployedImagesValue: Readonly<Record<string, string>>,
  attestedImages: Readonly<Record<string, string>>,
): boolean {
  let deployedImages: Record<string, string>;
  try {
    deployedImages = normalizeImageDigests(deployedImagesValue);
  } catch {
    return false;
  }
  return Object.entries(deployedImages)
    .every(([service, image]) => attestedImages[service] === image);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const expected = new Set(expectedKeys);
  return Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
