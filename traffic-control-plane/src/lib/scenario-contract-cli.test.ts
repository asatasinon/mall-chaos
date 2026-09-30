import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  executeScenarioContractCli,
  parseScenarioContractCliArguments,
  SCENARIO_CONTRACT_CHECK_RESULT_SCHEMA_VERSION,
  SCENARIO_CONTRACT_REQUIRED_CHECK_IDS,
  ScenarioContractCliError,
} from './scenario-contract-cli';
import {
  createScenarioContractGatewayExpectation,
  loadScenarioContractCliFacts,
  SCENARIO_CONTRACT_REPOSITORY_ROOT,
  type ScenarioContractGatewayExpectation,
} from './scenario-contract-cli-facts';

const SOURCE_COMMIT_SHA = 'a'.repeat(40);

test('CLI arguments are strict and resolve output paths from the repository root', () => {
  const options = parseScenarioContractCliArguments([
    '--stage=preflight',
    '--out',
    'tmp/custom-contract-output',
  ]);
  assert.equal(options.stage, 'preflight');
  assert.equal(options.scope, 'STATIC_CONTRACT');
  assert.ok(options.outputDirectory.endsWith(path.join('tmp', 'custom-contract-output')));
  assert.throws(
    () => parseScenarioContractCliArguments(['--stage=finalize', '--scope=LIVE_SCENARIO_MATRIX']),
    (error: unknown) => error instanceof ScenarioContractCliError
      && error.code === 'INVALID_ARGUMENTS',
  );
  assert.throws(
    () => parseScenarioContractCliArguments(['--stage=preflight', '--unchecked']),
    (error: unknown) => error instanceof ScenarioContractCliError
      && error.code === 'INVALID_ARGUMENTS',
  );
});

test('preflight writes deterministic artifacts and labels itself as non-release output', async () => {
  await withTemporaryDirectory(async (directory) => {
    const outputDirectory = path.join(directory, 'out');
    const options = {
      stage: 'preflight' as const,
      outputDirectory,
      sourceCommitSha: null,
      scope: 'STATIC_CONTRACT' as const,
    };
    const first = await executeScenarioContractCli(options);
    const firstArtifacts = await readFile(
      path.join(outputDirectory, 'scenario-contract-artifacts.json'),
      'utf8',
    );
    const second = await executeScenarioContractCli(options);
    const secondArtifacts = await readFile(
      path.join(outputDirectory, 'scenario-contract-artifacts.json'),
      'utf8',
    );
    const gatewayExpectation = JSON.parse(await readFile(
      path.join(outputDirectory, 'scenario-contract-gateway.json'),
      'utf8',
    )) as { schemaVersion: string; operations: readonly unknown[] };

    assert.equal(first.report.stage, 'PREFLIGHT');
    assert.match(first.textReport, /not a release validation/u);
    assert.doesNotMatch(first.textReport, /12\/12\s+valid/iu);
    assert.equal(first.textReport, second.textReport);
    assert.equal(firstArtifacts, secondArtifacts);
    assert.equal(gatewayExpectation.schemaVersion, 'scenario-contract-gateway.v1');
    assert.ok(gatewayExpectation.operations.length > 0);
  });
});

test('preflight package command does not parse Worker environment configuration', async () => {
  await withTemporaryDirectory(async (directory) => {
    const outputDirectory = path.join(directory, 'out');
    const controlPlaneRoot = path.join(SCENARIO_CONTRACT_REPOSITORY_ROOT, 'traffic-control-plane');
    const result = spawnSync(
      'pnpm',
      ['validate:contract:preflight', '--', '--out', outputDirectory],
      {
        cwd: controlPlaneRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          FAULT_RUN_RECONCILIATION_MODE: 'INVALID',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /not a release validation/u);
    assert.match(
      await readFile(path.join(outputDirectory, 'scenario-contract-preflight.json'), 'utf8'),
      /"stage": "PREFLIGHT"/u,
    );
  });
});

test('finalize writes BLOCKED output and exits non-zero when required checks are missing', async () => {
  await withTemporaryDirectory(async (directory) => {
    const result = await executeScenarioContractCli({
      stage: 'finalize',
      outputDirectory: path.join(directory, 'out'),
      checksDirectory: path.join(directory, 'missing-checks'),
      sourceCommitSha: SOURCE_COMMIT_SHA,
      scope: 'STATIC_CONTRACT',
    });
    const writtenReport = JSON.parse(await readFile(
      path.join(directory, 'out', 'scenario-contract-final.json'),
      'utf8',
    )) as { stage: string; status: string; requiredChecks: readonly { status: string }[] };

    assert.equal(result.exitCode, 1);
    assert.equal(result.report.stage, 'FINAL');
    assert.equal(result.report.status, 'BLOCKED');
    assert.equal(writtenReport.stage, 'FINAL');
    assert.equal(writtenReport.status, 'BLOCKED');
    assert.ok(writtenReport.requiredChecks.some(({ status }) => status === 'MISSING'));
  });
});

test('finalize accepts only complete checks matching Catalog revision and source commit', async () => {
  await withTemporaryDirectory(async (directory) => {
    const facts = await loadScenarioContractCliFacts();
    const gatewayExpectation = createScenarioContractGatewayExpectation(facts);
    const checksDirectory = path.join(directory, 'checks');
    const outputDirectory = path.join(directory, 'valid');
    const preflight = await executeScenarioContractCli({
      stage: 'preflight',
      outputDirectory,
      sourceCommitSha: SOURCE_COMMIT_SHA,
      scope: 'STATIC_CONTRACT',
    });
    assert.equal(preflight.report.status, 'VALID');
    await writeCompleteCheckSet(
      checksDirectory,
      facts.validationFacts.catalogRevision,
      gatewayExpectation,
    );
    const valid = await executeScenarioContractCli({
      stage: 'finalize',
      outputDirectory,
      checksDirectory,
      sourceCommitSha: SOURCE_COMMIT_SHA,
      scope: 'STATIC_CONTRACT',
    });

    assert.equal(valid.exitCode, 0);
    assert.equal(valid.report.status, 'VALID');
    assert.equal(valid.report.scenarios.length, facts.validationFacts.catalogScenarios.length);
    assert.ok(valid.report.scenarios.every(({ status }) => status === 'VALID'));
    assert.ok(valid.report.readinessNotes.some(
      ({ code }) => code === 'AGENT_DELIVERY_NOT_ENABLED',
    ));
    assert.doesNotMatch(valid.textReport, /12\/12\s+valid/iu);

    await writeFile(
      path.join(checksDirectory, 'traffic-control-plane.typecheck.json'),
      JSON.stringify({
        schemaVersion: SCENARIO_CONTRACT_CHECK_RESULT_SCHEMA_VERSION,
        checkId: 'traffic-control-plane.typecheck',
        status: 'PASSED',
        catalogRevision: 'b'.repeat(64),
        sourceCommitSha: SOURCE_COMMIT_SHA,
      }),
      'utf8',
    );
    const mismatchedOutput = path.join(directory, 'mismatched');
    await executeScenarioContractCli({
      stage: 'preflight',
      outputDirectory: mismatchedOutput,
      sourceCommitSha: SOURCE_COMMIT_SHA,
      scope: 'STATIC_CONTRACT',
    });
    const mismatched = await executeScenarioContractCli({
      stage: 'finalize',
      outputDirectory: mismatchedOutput,
      checksDirectory,
      sourceCommitSha: SOURCE_COMMIT_SHA,
      scope: 'STATIC_CONTRACT',
    });

    assert.equal(mismatched.exitCode, 1);
    assert.equal(mismatched.report.status, 'BLOCKED');
    assert.equal(
      mismatched.report.requiredChecks.find(
        ({ checkId }) => checkId === 'traffic-control-plane.typecheck',
      )?.status,
      'FAILED',
    );
  });
});

async function writeCompleteCheckSet(
  checksDirectory: string,
  catalogRevision: string,
  gatewayExpectation: ScenarioContractGatewayExpectation,
): Promise<void> {
  await mkdir(checksDirectory, { recursive: true });
  for (const checkId of SCENARIO_CONTRACT_REQUIRED_CHECK_IDS) {
    if (checkId === 'traffic-control-plane.preflight') continue;
    const fileName = checkId === 'gateway-service.operation-dispatch'
      ? 'gateway-operation-dispatch.json'
      : `${checkId}.json`;
    const expectedOperationCount = checkId === 'gateway-service.operation-dispatch'
      ? gatewayExpectation.operations.length
      : checkId.endsWith('.scenario-targets')
        ? gatewayExpectation.operations.filter(({ service }) => service === checkId.replace(/\.scenario-targets$/u, '')).length
        : undefined;
    await writeFile(path.join(checksDirectory, fileName), JSON.stringify({
      schemaVersion: SCENARIO_CONTRACT_CHECK_RESULT_SCHEMA_VERSION,
      checkId,
      status: 'PASSED',
      catalogRevision,
      sourceCommitSha: SOURCE_COMMIT_SHA,
      ...(expectedOperationCount === undefined ? {} : { operationCount: expectedOperationCount }),
    }), 'utf8');
  }
}

async function withTemporaryDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scenario-contract-cli-'));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
