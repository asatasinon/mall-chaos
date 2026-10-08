import { pathToFileURL } from 'node:url';
import {
  ScenarioContractReleaseValidationError,
  validateScenarioContractReleaseDeployment,
} from '../src/lib/scenario-contract-release-validator';

export async function mainValidateScenarioContractRelease(argv: readonly string[]): Promise<void> {
  try {
    const args = parseArguments(argv);
    const result = await validateScenarioContractReleaseDeployment(args);
    process.stdout.write(
      `SCENARIO_CONTRACT_RELEASE_ATTESTATION_VALID ${result.sourceCommitSha} ${result.catalogRevision}\n`,
    );
  } catch (error: unknown) {
    if (error instanceof ScenarioContractReleaseValidationError) {
      process.stderr.write(`${error.code}\n`);
    } else {
      process.stderr.write('SCENARIO_CONTRACT_RELEASE_ATTESTATION_INVALID\n');
    }
    process.exitCode = 1;
  }
}

function parseArguments(argv: readonly string[]): {
  readonly finalReportPath: string;
  readonly attestationPath: string;
  readonly applicationManifestDirectory: string;
  readonly controlPlaneImage: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token === undefined || !token.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    const separator = token.indexOf('=');
    const name = separator < 0 ? token : token.slice(0, separator);
    let value = separator < 0 ? undefined : token.slice(separator + 1);
    if (![
      '--final-report',
      '--release-attestation',
      '--application-manifests',
      '--control-plane-image',
    ].includes(name) || values.has(name)) {
      throw new Error('INVALID_ARGUMENTS');
    }
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (!value || value.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    values.set(name, value);
  }

  const finalReportPath = values.get('--final-report');
  const attestationPath = values.get('--release-attestation');
  const applicationManifestDirectory = values.get('--application-manifests');
  const controlPlaneImage = values.get('--control-plane-image');
  if (!finalReportPath || !attestationPath || !applicationManifestDirectory || !controlPlaneImage) {
    throw new Error('INVALID_ARGUMENTS');
  }
  return { finalReportPath, attestationPath, applicationManifestDirectory, controlPlaneImage };
}

if (process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void mainValidateScenarioContractRelease(process.argv.slice(2));
}
