import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  validateScenarioContractReleaseAttestation,
  ScenarioContractReleaseAttestationError,
} from './scenario-contract-release-attestation';
import { loadScenarioContractKubernetesDeploymentImages } from './scenario-contract-kubernetes-image-manifests';

const MAX_RELEASE_ARTIFACT_BYTES = 8 * 1024 * 1024;

export type ScenarioContractReleaseValidationErrorCode =
  | 'FINAL_REPORT_UNREADABLE'
  | 'RELEASE_ATTESTATION_UNREADABLE'
  | 'RELEASE_ATTESTATION_JSON_INVALID'
  | 'FINAL_REPORT_TOO_LARGE'
  | 'RELEASE_ATTESTATION_TOO_LARGE'
  | 'KUBERNETES_APPLICATION_MANIFEST_INVALID'
  | 'SCENARIO_CONTRACT_RELEASE_ATTESTATION_INVALID';

export class ScenarioContractReleaseValidationError extends Error {
  constructor(readonly code: ScenarioContractReleaseValidationErrorCode) {
    super(code);
    this.name = 'ScenarioContractReleaseValidationError';
  }
}

export interface ScenarioContractReleaseValidationResult {
  readonly sourceCommitSha: string;
  readonly catalogRevision: string;
  readonly finalReportSha256: string;
  readonly requiredCheckRunId: string;
  readonly deploymentCount: number;
}

export async function validateScenarioContractReleaseDeployment(input: {
  readonly finalReportPath: string;
  readonly attestationPath: string;
  readonly applicationManifestDirectory: string;
  readonly controlPlaneImage: string;
}): Promise<ScenarioContractReleaseValidationResult> {
  const [finalReportBytes, attestationBytes, deployedImageDigests] = await Promise.all([
    readBoundedFile(input.finalReportPath, 'FINAL_REPORT_UNREADABLE'),
    readBoundedFile(input.attestationPath, 'RELEASE_ATTESTATION_UNREADABLE'),
    loadScenarioContractKubernetesDeploymentImages(input.applicationManifestDirectory)
      .catch((error: unknown) => {
        if (error instanceof ScenarioContractReleaseAttestationError) throw error;
        throw new ScenarioContractReleaseValidationError('KUBERNETES_APPLICATION_MANIFEST_INVALID');
      }),
  ]);

  let attestation: unknown;
  try {
    attestation = JSON.parse(attestationBytes) as unknown;
  } catch {
    throw new ScenarioContractReleaseValidationError('RELEASE_ATTESTATION_JSON_INVALID');
  }

  try {
    const validated = validateScenarioContractReleaseAttestation({
      finalReportJson: finalReportBytes,
      attestation,
      deployedImageDigests,
      controlPlaneImage: input.controlPlaneImage,
    });
    return {
      sourceCommitSha: validated.sourceCommitSha,
      catalogRevision: validated.catalogRevision,
      finalReportSha256: validated.finalReportSha256,
      requiredCheckRunId: validated.requiredCheckRunId,
      deploymentCount: new Set(Object.keys(deployedImageDigests).map((key) => key.split('/')[0])).size,
    };
  } catch {
    throw new ScenarioContractReleaseValidationError('SCENARIO_CONTRACT_RELEASE_ATTESTATION_INVALID');
  }
}

async function readBoundedFile(
  filePath: string,
  unreadableCode: 'FINAL_REPORT_UNREADABLE' | 'RELEASE_ATTESTATION_UNREADABLE',
): Promise<string> {
  let contents: string;
  try {
    contents = await readFile(path.resolve(filePath), 'utf8');
  } catch {
    throw new ScenarioContractReleaseValidationError(unreadableCode);
  }
  if (Buffer.byteLength(contents, 'utf8') > MAX_RELEASE_ARTIFACT_BYTES) {
    throw new ScenarioContractReleaseValidationError(
      unreadableCode === 'FINAL_REPORT_UNREADABLE'
        ? 'FINAL_REPORT_TOO_LARGE'
        : 'RELEASE_ATTESTATION_TOO_LARGE',
    );
  }
  return contents;
}
