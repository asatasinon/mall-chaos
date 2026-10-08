import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createScenarioContractReleaseAttestation } from '../src/lib/scenario-contract-release-attestation';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

export async function mainCreateScenarioContractReleaseAttestation(
  argv: readonly string[],
): Promise<void> {
  try {
    const args = parseArguments(argv);
    const finalReportJson = await readBounded(args.finalReport, 'FINAL_REPORT_UNREADABLE');
    const imageDigestsJson = await readBounded(args.imageDigests, 'IMAGE_DIGEST_MAP_UNREADABLE');
    let imageDigests: unknown;
    try {
      imageDigests = JSON.parse(imageDigestsJson) as unknown;
    } catch {
      throw new Error('IMAGE_DIGEST_MAP_INVALID');
    }
    if (!isStringRecord(imageDigests)) throw new Error('IMAGE_DIGEST_MAP_INVALID');
    const attestation = createScenarioContractReleaseAttestation({
      finalReportJson,
      imageDigests,
      requiredCheckRunId: args.requiredCheckRunId,
    });
    const outputPath = path.resolve(args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
    process.stdout.write('SCENARIO_CONTRACT_RELEASE_ATTESTATION_CREATED\n');
  } catch (error: unknown) {
    process.stderr.write(`${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  }
}

function parseArguments(argv: readonly string[]): {
  readonly finalReport: string;
  readonly imageDigests: string;
  readonly requiredCheckRunId: string;
  readonly output: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token === undefined || !token.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    const separator = token.indexOf('=');
    const name = separator < 0 ? token : token.slice(0, separator);
    let value = separator < 0 ? undefined : token.slice(separator + 1);
    if (!['--final-report', '--image-digests', '--required-check-run-id', '--out'].includes(name)
      || values.has(name)) {
      throw new Error('INVALID_ARGUMENTS');
    }
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (!value || value.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    values.set(name, value);
  }

  const finalReport = values.get('--final-report');
  const imageDigests = values.get('--image-digests');
  const requiredCheckRunId = values.get('--required-check-run-id');
  const output = values.get('--out');
  if (!finalReport || !imageDigests || !requiredCheckRunId || !output) {
    throw new Error('INVALID_ARGUMENTS');
  }
  return { finalReport, imageDigests, requiredCheckRunId, output };
}

async function readBounded(filePath: string, errorCode: string): Promise<string> {
  let content: string;
  try {
    content = await readFile(path.resolve(filePath), 'utf8');
  } catch {
    throw new Error(errorCode);
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error('INPUT_TOO_LARGE');
  }
  return content;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)) return error.message;
  return 'SCENARIO_CONTRACT_RELEASE_ATTESTATION_FAILED';
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string');
}

if (process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void mainCreateScenarioContractReleaseAttestation(process.argv.slice(2));
}
