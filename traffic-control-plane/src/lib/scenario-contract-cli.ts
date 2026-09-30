import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  generateScenarioContractArtifacts,
  type ScenarioContractArtifactBundle,
} from './scenario-contract-artifacts';
import {
  createScenarioContractGatewayExpectation,
  createScenarioContractValidationInput,
  loadScenarioContractCliFacts,
  SCENARIO_CONTRACT_REPOSITORY_ROOT,
  type ScenarioContractCliFacts,
} from './scenario-contract-cli-facts';
import {
  validateScenarioContracts,
  type ScenarioContractCheckResult,
  type ScenarioContractValidationReport,
} from './scenario-contract-validator';

export const SCENARIO_CONTRACT_CHECK_RESULT_SCHEMA_VERSION =
  'scenario-contract-check-result.v1' as const;
export const SCENARIO_CONTRACT_REQUIRED_CHECK_IDS = Object.freeze([
  'traffic-control-plane.contract-tests',
  'traffic-control-plane.preflight',
  'traffic-control-plane.runbook',
  'traffic-control-plane.i18n',
  'traffic-control-plane.terminology',
  'traffic-control-plane.typecheck',
  'traffic-control-plane.lint',
  'gateway-service.operation-dispatch',
  'catalog-service.scenario-targets',
  'order-service.scenario-targets',
  'notification-service.scenario-targets',
  'promotion-service.scenario-targets',
  'inventory-service.scenario-targets',
  'psp-simulator.scenario-targets',
] as const);

const GATEWAY_DISPATCH_CHECK_ID = 'gateway-service.operation-dispatch';
const MAX_CHECK_RESULT_BYTES = 64 * 1024;
const OUTPUT_FILE_NAMES = {
  artifacts: 'scenario-contract-artifacts.json',
  manifest: 'scenario-contract-manifest.json',
  gatewayExpectation: 'scenario-contract-gateway.json',
  preflightJson: 'scenario-contract-preflight.json',
  preflightText: 'scenario-contract-preflight.txt',
  finalJson: 'scenario-contract-final.json',
  finalText: 'scenario-contract-final.txt',
} as const;

export type ScenarioContractCliStage = 'preflight' | 'finalize';

export interface ScenarioContractCliOptions {
  readonly stage: ScenarioContractCliStage;
  readonly outputDirectory: string;
  readonly checksDirectory?: string;
  readonly sourceCommitSha: string | null;
  readonly scope: 'STATIC_CONTRACT';
}

export interface ScenarioContractCliResult {
  readonly exitCode: 0 | 1;
  readonly report: ScenarioContractValidationReport;
  readonly textReport: string;
}

export type ScenarioContractCliErrorCode =
  | 'INVALID_ARGUMENTS'
  | 'OUTPUT_WRITE_FAILED';

export class ScenarioContractCliError extends Error {
  constructor(readonly code: ScenarioContractCliErrorCode) {
    super(code);
    this.name = 'ScenarioContractCliError';
  }
}

export function parseScenarioContractCliArguments(
  argv: readonly string[],
): ScenarioContractCliOptions {
  const values = new Map<string, string>();
  let separatorSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      if (separatorSeen) throw new ScenarioContractCliError('INVALID_ARGUMENTS');
      separatorSeen = true;
      continue;
    }
    if (argument === undefined || !argument.startsWith('--')) {
      throw new ScenarioContractCliError('INVALID_ARGUMENTS');
    }
    const separator = argument.indexOf('=');
    const name = separator === -1 ? argument : argument.slice(0, separator);
    let value = separator === -1 ? undefined : argument.slice(separator + 1);
    if (!['--stage', '--out', '--checks', '--scope', '--source-commit-sha'].includes(name)
      || values.has(name)) {
      throw new ScenarioContractCliError('INVALID_ARGUMENTS');
    }
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value.length === 0 || value.startsWith('--')) {
      throw new ScenarioContractCliError('INVALID_ARGUMENTS');
    }
    values.set(name, value);
  }

  const stage = values.get('--stage');
  if (stage !== 'preflight' && stage !== 'finalize') {
    throw new ScenarioContractCliError('INVALID_ARGUMENTS');
  }
  const scope = values.get('--scope') ?? 'STATIC_CONTRACT';
  if (scope !== 'STATIC_CONTRACT') {
    throw new ScenarioContractCliError('INVALID_ARGUMENTS');
  }
  const resolveFromRepositoryRoot = (value: string | undefined): string | undefined => (
    value === undefined
      ? undefined
      : path.resolve(SCENARIO_CONTRACT_REPOSITORY_ROOT, value)
  );
  const checksDirectory = resolveFromRepositoryRoot(values.get('--checks'));

  return {
    stage,
    scope,
    outputDirectory: resolveFromRepositoryRoot(values.get('--out'))
      ?? path.resolve(SCENARIO_CONTRACT_REPOSITORY_ROOT, 'tmp/scenario-contract'),
    ...(checksDirectory === undefined ? {} : { checksDirectory }),
    sourceCommitSha: values.get('--source-commit-sha') ?? null,
  };
}

export async function executeScenarioContractCli(
  options: ScenarioContractCliOptions,
  loadFacts: (repositoryRoot?: string) => Promise<ScenarioContractCliFacts> = loadScenarioContractCliFacts,
): Promise<ScenarioContractCliResult> {
  const facts = await loadFacts();
  const preflightInput = createScenarioContractValidationInput(facts, {
    stage: 'PREFLIGHT',
    sourceCommitSha: options.sourceCommitSha,
    requiredCheckIds: [],
    checkResults: [],
  });
  const artifacts = generateScenarioContractArtifacts({
    preflightInput,
    runbookArticles: facts.runbookArticles,
  });
  const gatewayExpectation = createScenarioContractGatewayExpectation(facts);

  if (options.stage === 'preflight') {
    const report = artifacts.preflightReport;
    const textReport = renderScenarioContractReport(report);
    await writeGeneratedArtifacts(options.outputDirectory, artifacts, gatewayExpectation, {
      reportFile: OUTPUT_FILE_NAMES.preflightJson,
      textFile: OUTPUT_FILE_NAMES.preflightText,
      report,
      textReport,
    });
    return {
      exitCode: report.status === 'BLOCKED' ? 1 : 0,
      report,
      textReport,
    };
  }

  const checkResults = await readScenarioContractCheckResults(
    options.checksDirectory,
    gatewayExpectation,
  );
  checkResults.push(await readPreflightCheckResult(
    options.outputDirectory,
    artifacts.preflightReport.catalogRevision,
  ));
  const finalInput = createScenarioContractValidationInput(facts, {
    stage: 'FINAL',
    sourceCommitSha: options.sourceCommitSha,
    requiredCheckIds: SCENARIO_CONTRACT_REQUIRED_CHECK_IDS,
    checkResults,
  });
  const report = validateScenarioContracts(finalInput);
  const textReport = renderScenarioContractReport(report);
  await writeGeneratedArtifacts(options.outputDirectory, artifacts, gatewayExpectation, {
    reportFile: OUTPUT_FILE_NAMES.finalJson,
    textFile: OUTPUT_FILE_NAMES.finalText,
    report,
    textReport,
  });
  return {
    exitCode: report.status === 'VALID' ? 0 : 1,
    report,
    textReport,
  };
}

export function renderScenarioContractReport(
  report: ScenarioContractValidationReport,
): string {
  const lines = [
    report.stage === 'PREFLIGHT'
      ? 'Scenario Contract PREFLIGHT (not a release validation)'
      : 'Scenario Contract FINAL',
    `Scope: ${report.scope}`,
    `Overall status: ${report.status}`,
    `Catalog revision: ${report.catalogRevision}`,
    `Source commit: ${report.sourceCommitSha ?? 'MISSING'}`,
  ];

  if (report.stage === 'PREFLIGHT') {
    lines.push('External required checks: not evaluated during preflight');
  } else {
    lines.push('Required checks:');
    for (const check of report.requiredChecks) {
      lines.push(`  ${check.checkId}: ${check.status}`);
    }
  }

  lines.push(`Blocking issues: ${report.blockingIssues.length}`);
  for (const issue of report.blockingIssues) {
    lines.push(`  ${issue.category} ${issue.code}${issue.scenario ? ` [${issue.scenario}]` : ''}`);
  }
  lines.push(`Readiness notes: ${report.readinessNotes.length}`);
  for (const note of report.readinessNotes) {
    lines.push(`  ${note.code}${note.scenario ? ` [${note.scenario}]` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

async function readScenarioContractCheckResults(
  checksDirectory: string | undefined,
  gatewayExpectation: ReturnType<typeof createScenarioContractGatewayExpectation>,
): Promise<ScenarioContractCheckResult[]> {
  if (checksDirectory === undefined) return [];
  const results: ScenarioContractCheckResult[] = [];
  for (const checkId of SCENARIO_CONTRACT_REQUIRED_CHECK_IDS) {
    if (checkId === 'traffic-control-plane.preflight') continue;
    const fileName = checkId === GATEWAY_DISPATCH_CHECK_ID
      ? 'gateway-operation-dispatch.json'
      : `${checkId}.json`;
    const filePath = path.join(checksDirectory, fileName);
    let contents: string;
    try {
      const info = await lstat(filePath);
      if (!info.isFile() || info.size > MAX_CHECK_RESULT_BYTES) {
        results.push(failedCheckResult(checkId));
        continue;
      }
      contents = await readFile(filePath, 'utf8');
    } catch (error: unknown) {
      if (hasErrorCode(error, 'ENOENT')) continue;
      results.push(failedCheckResult(checkId));
      continue;
    }

    results.push(parseCheckResult(contents, checkId, gatewayExpectation));
  }
  return results;
}

async function readPreflightCheckResult(
  outputDirectory: string,
  expectedCatalogRevision: string,
): Promise<ScenarioContractCheckResult> {
  let contents: string;
  try {
    contents = await readFile(path.join(outputDirectory, OUTPUT_FILE_NAMES.preflightJson), 'utf8');
  } catch {
    return failedCheckResult('traffic-control-plane.preflight');
  }

  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    return failedCheckResult('traffic-control-plane.preflight');
  }
  const preflight = asRecord(value);
  if (!preflight
    || preflight.schemaVersion !== 'scenario-contract-report.v1'
    || preflight.stage !== 'PREFLIGHT'
    || preflight.scope !== 'STATIC_CONTRACT'
    || typeof preflight.catalogRevision !== 'string'
    || (preflight.sourceCommitSha !== null && typeof preflight.sourceCommitSha !== 'string')) {
    return failedCheckResult('traffic-control-plane.preflight');
  }

  return {
    checkId: 'traffic-control-plane.preflight',
    status: preflight.status === 'VALID'
      && preflight.catalogRevision === expectedCatalogRevision
      ? 'PASSED'
      : 'FAILED',
    catalogRevision: preflight.catalogRevision,
    sourceCommitSha: typeof preflight.sourceCommitSha === 'string'
      ? preflight.sourceCommitSha
      : null,
  };
}

function parseCheckResult(
  contents: string,
  expectedCheckId: string,
  gatewayExpectation: ReturnType<typeof createScenarioContractGatewayExpectation>,
): ScenarioContractCheckResult {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    return failedCheckResult(expectedCheckId);
  }
  const result = asRecord(value);
  if (!result
    || result.schemaVersion !== SCENARIO_CONTRACT_CHECK_RESULT_SCHEMA_VERSION
    || result.checkId !== expectedCheckId
    || (result.status !== 'PASSED' && result.status !== 'FAILED')
    || typeof result.catalogRevision !== 'string'
    || (result.sourceCommitSha !== undefined
      && result.sourceCommitSha !== null
      && typeof result.sourceCommitSha !== 'string')) {
    return failedCheckResult(expectedCheckId);
  }

  const expectedOperationCount = getExpectedOperationCount(expectedCheckId, gatewayExpectation);
  const operationCountValid = expectedOperationCount === null
    || (expectedOperationCount > 0 && result.operationCount === expectedOperationCount);
  return {
    checkId: expectedCheckId,
    status: result.status === 'PASSED' && operationCountValid ? 'PASSED' : 'FAILED',
    catalogRevision: result.catalogRevision,
    sourceCommitSha: typeof result.sourceCommitSha === 'string'
      ? result.sourceCommitSha
      : null,
  };
}

function getExpectedOperationCount(
  checkId: string,
  gatewayExpectation: ReturnType<typeof createScenarioContractGatewayExpectation>,
): number | null {
  if (checkId === GATEWAY_DISPATCH_CHECK_ID) return gatewayExpectation.operations.length;
  const targetSuffix = '.scenario-targets';
  if (!checkId.endsWith(targetSuffix)) return null;
  const service = checkId.slice(0, -targetSuffix.length);
  return gatewayExpectation.operations.filter(({ service: operationService }) => (
    operationService === service
  )).length;
}

function failedCheckResult(checkId: string): ScenarioContractCheckResult {
  return {
    checkId,
    status: 'FAILED',
    catalogRevision: 'INVALID',
    sourceCommitSha: null,
  };
}

async function writeGeneratedArtifacts(
  outputDirectory: string,
  artifacts: ScenarioContractArtifactBundle,
  gatewayExpectation: ReturnType<typeof createScenarioContractGatewayExpectation>,
  reportOutput: {
    readonly reportFile: string;
    readonly textFile: string;
    readonly report: ScenarioContractValidationReport;
    readonly textReport: string;
  },
): Promise<void> {
  try {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      path.join(outputDirectory, OUTPUT_FILE_NAMES.artifacts),
      stableJson(artifacts),
      'utf8',
    );
    await writeFile(
      path.join(outputDirectory, OUTPUT_FILE_NAMES.manifest),
      stableJson(artifacts.manifest),
      'utf8',
    );
    await writeFile(
      path.join(outputDirectory, OUTPUT_FILE_NAMES.gatewayExpectation),
      stableJson(gatewayExpectation),
      'utf8',
    );
    await writeFile(
      path.join(outputDirectory, reportOutput.reportFile),
      stableJson(reportOutput.report),
      'utf8',
    );
    await writeFile(
      path.join(outputDirectory, reportOutput.textFile),
      reportOutput.textReport,
      'utf8',
    );
  } catch {
    throw new ScenarioContractCliError('OUTPUT_WRITE_FAILED');
  }
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error
    && error.code === code;
}
