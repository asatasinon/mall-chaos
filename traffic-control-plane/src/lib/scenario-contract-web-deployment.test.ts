import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import yaml from 'js-yaml';

const REPOSITORY_ROOT = path.resolve(process.cwd(), '..');
const WEB_ONLY_ENVIRONMENT_NAMES = [
  'SCENARIO_CONTRACT_VALIDATION_MODE',
  'SCENARIO_CONTRACT_DEPLOYMENT_SCOPE',
] as const;

test('Compose assigns admission defaults to Web/API only', async () => {
  const compose = asRecord(yaml.load(await readRepoFile('docker-compose.yml')));
  const services = asRecord(compose?.services);
  const web = asRecord(services?.['traffic-control-plane']);
  const worker = asRecord(services?.['traffic-control-plane-worker']);
  const webEnvironment = asRecord(web?.environment);
  const workerEnvironment = asRecord(worker?.environment);

  assert.ok(webEnvironment);
  assert.equal(
    webEnvironment.SCENARIO_CONTRACT_VALIDATION_MODE,
    '${SCENARIO_CONTRACT_VALIDATION_MODE-warn}',
  );
  assert.equal(
    webEnvironment.SCENARIO_CONTRACT_DEPLOYMENT_SCOPE,
    '${SCENARIO_CONTRACT_DEPLOYMENT_SCOPE-retained}',
  );
  for (const variable of WEB_ONLY_ENVIRONMENT_NAMES) {
    assert.equal(Object.hasOwn(workerEnvironment ?? {}, variable), false, variable);
  }
});

test('Kubernetes assigns admission settings to the Web Deployment and not the Worker', async () => {
  const webEnvironment = kubernetesContainerEnvironment(
    await readRepoFile('k8s/services/traffic-control-plane/deployment.yaml'),
    'Deployment',
    'traffic-control-plane',
    'traffic-control-plane',
  );
  const workerEnvironment = kubernetesContainerEnvironment(
    await readRepoFile('k8s/services/traffic-control-plane/worker-deployment.yaml'),
    'Deployment',
    'traffic-control-plane-worker',
    'traffic-control-plane-worker',
  );
  const sharedConfig = asRecord(yaml.load(
    await readRepoFile('k8s/configmap/app-config.yaml'),
  ));
  const sharedData = asRecord(sharedConfig?.data);

  assert.equal(webEnvironment.get('SCENARIO_CONTRACT_VALIDATION_MODE'), 'warn');
  assert.equal(webEnvironment.get('SCENARIO_CONTRACT_DEPLOYMENT_SCOPE'), 'retained');
  for (const variable of WEB_ONLY_ENVIRONMENT_NAMES) {
    assert.equal(workerEnvironment.has(variable), false, variable);
    assert.equal(sharedData?.[variable], undefined, variable);
  }
});

test('Kubernetes migration Job does not receive Web-only admission settings', async () => {
  const migrationEnvironment = kubernetesContainerEnvironment(
    await readRepoFile('k8s/jobs/traffic-control-plane-migrate.yaml'),
    'Job',
    'traffic-control-plane-migrate',
    'traffic-control-plane-migrate',
  );
  for (const variable of WEB_ONLY_ENVIRONMENT_NAMES) {
    assert.equal(migrationEnvironment.has(variable), false, variable);
  }
});

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.resolve(REPOSITORY_ROOT, relativePath), 'utf8');
}

function kubernetesContainerEnvironment(
  source: string,
  workloadKind: 'Deployment' | 'Job',
  workloadName: string,
  containerName: string,
): Map<string, string> {
  const documents = yaml.loadAll(source) as unknown[];
  const workload = documents
    .map(asRecord)
    .find((document) => (
      document?.kind === workloadKind
      && asRecord(document.metadata)?.name === workloadName
    ));
  const template = asRecord(asRecord(workload?.spec)?.template);
  const podSpec = asRecord(template?.spec);
  const containers = Array.isArray(podSpec?.containers) ? podSpec.containers : [];
  const container = containers
    .map(asRecord)
    .find((candidate) => candidate?.name === containerName);
  const environment = Array.isArray(container?.env) ? container.env : [];
  return new Map(environment.flatMap((value) => {
    const entry = asRecord(value);
    return typeof entry?.name === 'string' && typeof entry.value === 'string'
      ? [[entry.name, entry.value] as const]
      : [];
  }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
