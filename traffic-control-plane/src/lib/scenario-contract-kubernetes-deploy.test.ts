import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createScenarioContractReleaseAttestation } from './scenario-contract-release-attestation';
import { loadScenarioContractKubernetesDeploymentImages } from './scenario-contract-kubernetes-image-manifests';

const REPOSITORY_ROOT = path.resolve(process.cwd(), '..');
const DEPLOY_SCRIPT = path.resolve(REPOSITORY_ROOT, 'scripts/k8s-deploy.sh');
const CONTROL_PLANE_IMAGE = `castrel/traffic-control-plane@sha256:${'d'.repeat(64)}`;
const SOURCE_COMMIT_SHA = 'a'.repeat(40);
const CATALOG_REVISION = 'b'.repeat(64);

test('Kubernetes deployment stages gate application resources on both Jobs', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fakeKubectl = await createFakeKubectl(directory);
    const resetRecord = path.join(directory, 'external-reset-record.json');
    const stageRecordDir = path.join(directory, 'release-records');
    await writeFile(resetRecord, '{"recorded":"external"}\n', 'utf8');
    const applicationManifests = await createApplicationManifests(directory);
    const releaseArtifacts = await createReleaseArtifacts(directory, applicationManifests);
    const releaseId = 'contract-test';

    assert.equal(runStage(fakeKubectl, directory, 'bootstrap').status, 0);
    assert.equal(runStage(fakeKubectl, directory, 'migrate', [
      '--control-plane-image', CONTROL_PLANE_IMAGE,
      '--release-id', releaseId,
      '--reset-record', resetRecord,
      '--stage-record-dir', stageRecordDir,
    ]).status, 0);
    assert.equal(runStage(fakeKubectl, directory, 'verify', [
      '--control-plane-image', CONTROL_PLANE_IMAGE,
      '--release-id', releaseId,
      '--reset-record', resetRecord,
      '--stage-record-dir', stageRecordDir,
    ]).status, 0);
    assert.equal(runStage(fakeKubectl, directory, 'application', [
      '--control-plane-image', CONTROL_PLANE_IMAGE,
      '--release-id', releaseId,
      '--reset-record', resetRecord,
      '--stage-record-dir', stageRecordDir,
      '--application-manifests', applicationManifests,
      '--final-report', releaseArtifacts.finalReportPath,
      '--release-attestation', releaseArtifacts.attestationPath,
    ]).status, 0);

    const log = (await readFile(path.join(directory, 'kubectl.log'), 'utf8')).split(/\r?\n/u);
    const migrationApply = log.findIndex((line) => (
      line.includes(`traffic-control-plane-migrate-${releaseId}.yaml`)
    ));
    const migrationWait = log.findIndex((line) => (
      line.includes(`job/traffic-control-plane-migrate-${releaseId}`)
        && line.includes('--for=condition=complete')
    ));
    const verificationApply = log.findIndex((line) => (
      line.includes(`traffic-control-plane-verify-${releaseId}.yaml`)
    ));
    const verificationWait = log.findIndex((line) => (
      line.includes(`job/traffic-control-plane-verify-${releaseId}`)
        && line.includes('--for=condition=complete')
    ));
    const applicationServicesPath = `${applicationManifests}${path.sep}services${path.sep}`;
    const applicationApply = log.findIndex((line) => (
      line.includes('apply ')
        && line.includes(applicationServicesPath)
        && line.includes('--recursive')
    ));
    assert.ok(log.some((line) => line.includes('apply -k ')));
    assert.ok(migrationApply >= 0);
    assert.ok(migrationWait > migrationApply);
    assert.ok(verificationApply > migrationWait);
    assert.ok(verificationWait > verificationApply);
    assert.ok(applicationApply > verificationWait);
    assert.deepEqual(
      log.filter((line) => line.trimStart().startsWith('image:')),
      [`          image: ${CONTROL_PLANE_IMAGE}`, `          image: ${CONTROL_PLANE_IMAGE}`],
    );
  });
});

test('migration stage refuses to run without an external reset record', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fakeKubectl = await createFakeKubectl(directory);
    const result = runStage(fakeKubectl, directory, 'migrate', [
      '--control-plane-image', CONTROL_PLANE_IMAGE,
      '--release-id', 'missing-record',
    ]);

    assert.equal(result.status, 1);
    assert.equal(await readFile(path.join(directory, 'kubectl.log'), 'utf8').catch(() => ''), '');
  });
});

test('migration stage does not reuse a release Job after it has completed', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fakeKubectl = await createFakeKubectl(directory);
    const resetRecord = path.join(directory, 'external-reset-record.json');
    const stageRecordDir = path.join(directory, 'release-records');
    await writeFile(resetRecord, '{"recorded":"external"}\n', 'utf8');
    const options = [
      '--control-plane-image', CONTROL_PLANE_IMAGE,
      '--release-id', 'unique-release',
      '--reset-record', resetRecord,
      '--stage-record-dir', stageRecordDir,
    ];
    assert.equal(runStage(fakeKubectl, directory, 'migrate', options).status, 0);
    const priorKubectlCalls = await readFile(path.join(directory, 'kubectl.log'), 'utf8');
    const repeatedMigration = runStage(fakeKubectl, directory, 'migrate', options);

    assert.equal(repeatedMigration.status, 1);
    assert.equal(await readFile(path.join(directory, 'kubectl.log'), 'utf8'), priorKubectlCalls);
  });
});

test('application stage never applies services when verification has not completed', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fakeKubectl = await createFakeKubectl(directory);
    const resetRecord = path.join(directory, 'external-reset-record.json');
    const stageRecordDir = path.join(directory, 'release-records');
    const applicationManifests = await createApplicationManifests(directory);
    const releaseArtifacts = await createReleaseArtifacts(directory, applicationManifests);
    const releaseId = 'verify-fails';
    await writeFile(resetRecord, '{"recorded":"external"}\n', 'utf8');
    assert.equal(runStage(fakeKubectl, directory, 'migrate', [
      '--control-plane-image', CONTROL_PLANE_IMAGE,
      '--release-id', releaseId,
      '--reset-record', resetRecord,
      '--stage-record-dir', stageRecordDir,
    ]).status, 0);
    const failedVerify = runStage(fakeKubectl, directory, 'verify', [
      '--control-plane-image', CONTROL_PLANE_IMAGE,
      '--release-id', releaseId,
      '--reset-record', resetRecord,
      '--stage-record-dir', stageRecordDir,
    ], `traffic-control-plane-verify-${releaseId}`);
    assert.equal(failedVerify.status, 1);

    const result = runStage(fakeKubectl, directory, 'application', [
      '--control-plane-image', CONTROL_PLANE_IMAGE,
      '--release-id', releaseId,
      '--reset-record', resetRecord,
      '--stage-record-dir', stageRecordDir,
      '--application-manifests', applicationManifests,
      '--final-report', releaseArtifacts.finalReportPath,
      '--release-attestation', releaseArtifacts.attestationPath,
    ]);
    const log = await readFile(path.join(directory, 'kubectl.log'), 'utf8');

    assert.equal(result.status, 1);
    assert.equal(log.includes(`${applicationManifests}${path.sep}services${path.sep}`), false);
    assert.equal(log.includes(`${applicationManifests}${path.sep}ingress${path.sep}`), false);
  });
});

test('application stage rejects mutable service images before contacting Kubernetes', async () => {
  await withTemporaryDirectory(async (directory) => {
    const fakeKubectl = await createFakeKubectl(directory);
    const applicationManifests = await createApplicationManifests(directory);
    await writeFile(
      path.join(applicationManifests, 'services', 'gateway', 'deployment.yaml'),
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: gateway-service\nspec:\n  template:\n    spec:\n      containers:\n        - name: gateway-service\n          image: castrel/gateway-service:latest\n',
      'utf8',
    );
    const result = runStage(fakeKubectl, directory, 'application', [
      '--control-plane-image', CONTROL_PLANE_IMAGE,
      '--release-id', 'mutable-image',
      '--reset-record', path.join(directory, 'missing-reset-record.json'),
      '--application-manifests', applicationManifests,
    ]);

    assert.equal(result.status, 1);
    assert.equal(await readFile(path.join(directory, 'kubectl.log'), 'utf8').catch(() => ''), '');
  });
});

async function createApplicationManifests(directory: string): Promise<string> {
  const root = path.join(directory, 'application');
  const controlPlaneDirectory = path.join(root, 'services', 'traffic-control-plane');
  const gatewayDirectory = path.join(root, 'services', 'gateway');
  await mkdir(controlPlaneDirectory, { recursive: true });
  await mkdir(gatewayDirectory, { recursive: true });
  await mkdir(path.join(root, 'ingress'), { recursive: true });
  for (const deploymentName of ['traffic-control-plane', 'traffic-control-plane-worker']) {
    await writeFile(
      path.join(controlPlaneDirectory, deploymentName === 'traffic-control-plane'
        ? 'deployment.yaml'
        : 'worker-deployment.yaml'),
      `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${deploymentName}\nspec:\n  template:\n    spec:\n      containers:\n        - name: ${deploymentName}\n          image: ${CONTROL_PLANE_IMAGE}\n`,
      'utf8',
    );
  }
  await writeFile(
    path.join(gatewayDirectory, 'deployment.yaml'),
    `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: gateway-service\nspec:\n  template:\n    spec:\n      containers:\n        - name: gateway-service\n          image: castrel/gateway-service@sha256:${'e'.repeat(64)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(root, 'ingress', 'gateway-ingress.yaml'),
    'apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: gateway-ingress\nspec:\n  rules: []\n',
    'utf8',
  );
  return root;
}

async function createReleaseArtifacts(
  directory: string,
  applicationManifests: string,
): Promise<{ readonly finalReportPath: string; readonly attestationPath: string }> {
  const finalReportPath = path.join(directory, 'scenario-contract-final.json');
  const attestationPath = path.join(directory, 'scenario-contract-release-attestation.json');
  const finalReportJson = `${JSON.stringify({
    schemaVersion: 'scenario-contract-report.v1',
    stage: 'FINAL',
    scope: 'STATIC_CONTRACT',
    catalogRevision: CATALOG_REVISION,
    status: 'VALID',
    sourceCommitSha: SOURCE_COMMIT_SHA,
    scenarios: [{ scenario: 'EXAMPLE_SCENARIO', status: 'VALID' }],
    requiredChecks: [{
      checkId: 'example.release-check',
      status: 'PASSED',
      catalogRevision: CATALOG_REVISION,
      sourceCommitSha: SOURCE_COMMIT_SHA,
    }],
    blockingIssues: [],
    readinessNotes: [],
  })}\n`;
  const imageDigests = await loadScenarioContractKubernetesDeploymentImages(applicationManifests);
  const attestation = createScenarioContractReleaseAttestation({
    finalReportJson,
    imageDigests,
    requiredCheckRunId: 'kubernetes-stage-test-run',
  });
  await writeFile(finalReportPath, finalReportJson, 'utf8');
  await writeFile(attestationPath, `${JSON.stringify(attestation)}\n`, 'utf8');
  return { finalReportPath, attestationPath };
}

async function createFakeKubectl(directory: string): Promise<string> {
  const binDirectory = path.join(directory, 'bin');
  await mkdir(binDirectory, { recursive: true });
  const kubectlPath = path.join(binDirectory, 'kubectl');
  const fakeKubectl = [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$KUBECTL_LOG"',
    'is_get=0',
    'is_wait=0',
    'job_name=""',
    'for argument in "$@"; do',
    '  [ "$argument" = "get" ] && is_get=1',
    '  [ "$argument" = "wait" ] && is_wait=1',
    '  case "$argument" in job/*) job_name="$argument";; esac',
    '  case "$argument" in *.yaml) if [ -f "$argument" ]; then grep "^[[:space:]]*image:" "$argument" >> "$KUBECTL_LOG"; fi;; esac',
    'done',
    'if [ "$is_get" = "1" ]; then',
    '  case "$*" in *metadata.uid*) printf "uid-%s" "${job_name#job/}";; *) printf "%s" "$EXPECTED_CONTROL_PLANE_IMAGE";; esac',
    'fi',
    'if [ "$is_wait" = "1" ] && [ -n "$FAIL_JOB" ] && [ "$job_name" = "job/$FAIL_JOB" ]; then exit 1; fi',
    'exit 0',
  ].join('\n');
  await writeFile(kubectlPath, fakeKubectl, 'utf8');
  await chmod(kubectlPath, 0o755);
  return kubectlPath;
}

function runStage(
  kubectlPath: string,
  directory: string,
  stage: string,
  options: readonly string[] = [],
  failJob = '',
) {
  return spawnSync('/bin/bash', [DEPLOY_SCRIPT, stage, ...options], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.dirname(kubectlPath)}:${process.env.PATH ?? ''}`,
      KUBECTL_LOG: path.join(directory, 'kubectl.log'),
      EXPECTED_CONTROL_PLANE_IMAGE: CONTROL_PLANE_IMAGE,
      FAIL_JOB: failJob,
      K8S_STAGE_RECORD_DIR: path.join(directory, 'release-records'),
    },
  });
}

async function withTemporaryDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scenario-contract-k8s-deploy-'));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
