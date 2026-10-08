import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createScenarioContractReleaseAttestation } from './scenario-contract-release-attestation';
import { loadScenarioContractKubernetesDeploymentImages } from './scenario-contract-kubernetes-image-manifests';
import { validateScenarioContractReleaseDeployment } from './scenario-contract-release-validator';

const SOURCE_COMMIT_SHA = 'a'.repeat(40);
const CATALOG_REVISION = 'b'.repeat(64);
const CONTROL_PLANE_IMAGE = `castrel/traffic-control-plane@sha256:${'c'.repeat(64)}`;
const CONTROL_PLANE_ROOT = process.cwd();

test('validates final report, attestation and every rendered Deployment image as one release', async () => {
  await withTemporaryDirectory(async (directory) => {
    const applicationManifests = await writeApplicationManifests(directory, CONTROL_PLANE_IMAGE);
    const images = {
      gateway: `castrel/gateway-service@sha256:${'d'.repeat(64)}`,
      'traffic-control-plane': CONTROL_PLANE_IMAGE,
      'traffic-control-plane-worker': CONTROL_PLANE_IMAGE,
    };
    const finalReportJson = validFinalReport();
    const attestation = createScenarioContractReleaseAttestation({
      finalReportJson,
      imageDigests: images,
      requiredCheckRunId: 'ci-check-run-20261008',
    });
    const finalReportPath = path.join(directory, 'final-report.json');
    const attestationPath = path.join(directory, 'release-attestation.json');
    await writeFile(finalReportPath, finalReportJson, 'utf8');
    await writeFile(attestationPath, `${JSON.stringify(attestation)}\n`, 'utf8');

    const result = await validateScenarioContractReleaseDeployment({
      finalReportPath,
      attestationPath,
      applicationManifestDirectory: applicationManifests,
      controlPlaneImage: CONTROL_PLANE_IMAGE,
    });

    assert.equal(result.sourceCommitSha, SOURCE_COMMIT_SHA);
    assert.equal(result.catalogRevision, CATALOG_REVISION);
    assert.equal(result.requiredCheckRunId, 'ci-check-run-20261008');
    assert.equal(result.deploymentCount, 3);
  });
});

test('rejects image-map drift and a modified final report before deployment', async () => {
  await withTemporaryDirectory(async (directory) => {
    const applicationManifests = await writeApplicationManifests(
      directory,
      CONTROL_PLANE_IMAGE,
      { gateway: `castrel/gateway-service@sha256:${'e'.repeat(64)}` },
    );
    const finalReportJson = validFinalReport();
    const attestation = createScenarioContractReleaseAttestation({
      finalReportJson,
      imageDigests: {
        gateway: `castrel/gateway-service@sha256:${'d'.repeat(64)}`,
        'traffic-control-plane': CONTROL_PLANE_IMAGE,
        'traffic-control-plane-worker': CONTROL_PLANE_IMAGE,
      },
      requiredCheckRunId: 'ci-check-run',
    });
    const finalReportPath = path.join(directory, 'final-report.json');
    const attestationPath = path.join(directory, 'release-attestation.json');
    await writeFile(finalReportPath, finalReportJson, 'utf8');
    await writeFile(attestationPath, `${JSON.stringify(attestation)}\n`, 'utf8');

    await assert.rejects(
      () => validateScenarioContractReleaseDeployment({
        finalReportPath,
        attestationPath,
        applicationManifestDirectory: applicationManifests,
        controlPlaneImage: CONTROL_PLANE_IMAGE,
      }),
      /SCENARIO_CONTRACT_RELEASE_ATTESTATION_INVALID/u,
    );

    await writeFile(finalReportPath, `${finalReportJson} `, 'utf8');
    await assert.rejects(
      async () => validateScenarioContractReleaseDeployment({
        finalReportPath,
        attestationPath,
        applicationManifestDirectory: await writeApplicationManifests(
          directory,
          CONTROL_PLANE_IMAGE,
          { gateway: `castrel/gateway-service@sha256:${'d'.repeat(64)}` },
        ),
        controlPlaneImage: CONTROL_PLANE_IMAGE,
      }),
      /SCENARIO_CONTRACT_RELEASE_ATTESTATION_INVALID/u,
    );
  });
});

test('provider-neutral attestation CLIs create and verify a release bundle', async () => {
  await withTemporaryDirectory(async (directory) => {
    const applicationManifests = await writeApplicationManifests(directory, CONTROL_PLANE_IMAGE);
    const imageDigests = await loadScenarioContractKubernetesDeploymentImages(applicationManifests);
    const finalReportPath = path.join(directory, 'final-report.json');
    const imageDigestsPath = path.join(directory, 'image-digests.json');
    const attestationPath = path.join(directory, 'release-attestation.json');
    await writeFile(finalReportPath, validFinalReport(), 'utf8');
    await writeFile(imageDigestsPath, JSON.stringify(imageDigests), 'utf8');

    const created = spawnSync('pnpm', [
      'create:contract:attestation',
      '--',
      '--final-report', finalReportPath,
      '--image-digests', imageDigestsPath,
      '--required-check-run-id', 'provider-neutral-test-run',
      '--out', attestationPath,
    ], { cwd: CONTROL_PLANE_ROOT, encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);

    const validated = spawnSync('pnpm', [
      'validate:contract:release',
      '--',
      '--final-report', finalReportPath,
      '--release-attestation', attestationPath,
      '--application-manifests', applicationManifests,
      '--control-plane-image', CONTROL_PLANE_IMAGE,
    ], { cwd: CONTROL_PLANE_ROOT, encoding: 'utf8' });
    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /SCENARIO_CONTRACT_RELEASE_ATTESTATION_VALID/u);
  });
});

async function writeApplicationManifests(
  directory: string,
  controlPlaneImage: string,
  override: Readonly<Record<string, string>> = {},
): Promise<string> {
  const root = path.join(directory, `application-${Object.keys(override).length}`);
  const deploymentImages: Readonly<Record<string, string>> = {
    gateway: `castrel/gateway-service@sha256:${'d'.repeat(64)}`,
    'traffic-control-plane': controlPlaneImage,
    'traffic-control-plane-worker': controlPlaneImage,
    ...override,
  };
  for (const [service, image] of Object.entries(deploymentImages)) {
    const directoryName = service.startsWith('traffic-control-plane') ? 'traffic-control-plane' : service;
    const fileName = service === 'traffic-control-plane-worker' ? 'worker-deployment.yaml' : 'deployment.yaml';
    const serviceDirectory = path.join(root, 'services', directoryName);
    await mkdir(serviceDirectory, { recursive: true });
    await writeFile(
      path.join(serviceDirectory, fileName),
      `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${service}\nspec:\n  template:\n    spec:\n      containers:\n        - name: ${service}\n          image: ${image}\n`,
      'utf8',
    );
  }
  await mkdir(path.join(root, 'ingress'), { recursive: true });
  await writeFile(path.join(root, 'ingress', 'ingress.yaml'), 'kind: Ingress\nmetadata:\n  name: test\n', 'utf8');
  return root;
}

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
      checkId: 'example.release-check',
      status: 'PASSED',
      catalogRevision: CATALOG_REVISION,
      sourceCommitSha: SOURCE_COMMIT_SHA,
    }],
    blockingIssues: [],
    readinessNotes: [],
  })}\n`;
}

async function withTemporaryDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'scenario-contract-attestation-'));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
