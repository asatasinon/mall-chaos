import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

export class ScenarioContractKubernetesImageManifestError extends Error {
  constructor(readonly code:
    | 'APPLICATION_MANIFEST_DIRECTORY_INVALID'
    | 'APPLICATION_MANIFEST_UNREADABLE'
    | 'APPLICATION_MANIFEST_INVALID') {
    super(code);
    this.name = 'ScenarioContractKubernetesImageManifestError';
  }
}

export async function loadScenarioContractKubernetesDeploymentImages(
  applicationManifestDirectory: string,
): Promise<Record<string, string>> {
  const root = path.resolve(applicationManifestDirectory);
  const servicesDirectory = path.resolve(root, 'services');
  const ingressDirectory = path.resolve(root, 'ingress');
  if (!isWithinRoot(root, servicesDirectory) || !isWithinRoot(root, ingressDirectory)) {
    throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_DIRECTORY_INVALID');
  }

  const serviceManifestPaths = await listYamlFiles(servicesDirectory);
  const ingressManifestPaths = await listYamlFiles(ingressDirectory);
  if (serviceManifestPaths.length === 0 || ingressManifestPaths.length === 0) {
    throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_DIRECTORY_INVALID');
  }

  const documents = await Promise.all(serviceManifestPaths.map(async (manifestPath) => {
    let source: string;
    try {
      source = await readFile(manifestPath, 'utf8');
    } catch {
      throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_UNREADABLE');
    }
    try {
      return yaml.loadAll(source) as unknown[];
    } catch {
      throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_INVALID');
    }
  }));

  const deploymentImages: Record<string, string> = {};
  for (const document of documents.flat()) {
    const record = asRecord(document);
    if (record?.kind !== 'Deployment') continue;
    const deploymentName = asRecord(record.metadata)?.name;
    const template = asRecord(asRecord(record.spec)?.template);
    const podSpec = asRecord(template?.spec);
    if (typeof deploymentName !== 'string' || !isKubernetesName(deploymentName) || !podSpec) {
      throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_INVALID');
    }
    addContainerImages(
      deploymentImages,
      deploymentName,
      podSpec.containers,
      'containers',
    );
    addContainerImages(
      deploymentImages,
      `${deploymentName}/init`,
      podSpec.initContainers ?? [],
      'initContainers',
    );
  }

  if (Object.keys(deploymentImages).length === 0) {
    throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_INVALID');
  }
  return Object.fromEntries(
    Object.entries(deploymentImages).sort(([left], [right]) => compareText(left, right)),
  );
}

async function listYamlFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_DIRECTORY_INVALID');
  }

  const paths = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.resolve(directory, entry.name);
    if (!isWithinRoot(directory, entryPath)) {
      throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_DIRECTORY_INVALID');
    }
    if (entry.isDirectory()) return listYamlFiles(entryPath);
    if (entry.isFile() && /\.ya?ml$/iu.test(entry.name)) return [entryPath];
    return [];
  }));
  return paths.flat().sort(compareText);
}

function addContainerImages(
  target: Record<string, string>,
  prefix: string,
  value: unknown,
  field: 'containers' | 'initContainers',
): void {
  if (!Array.isArray(value)) {
    throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_INVALID');
  }
  for (const containerValue of value) {
    const container = asRecord(containerValue);
    if (typeof container?.name !== 'string'
      || !isKubernetesName(container.name)
      || typeof container.image !== 'string') {
      throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_INVALID');
    }
    const key = field === 'containers' && value.length === 1
      ? prefix
      : `${prefix}/${container.name}`;
    if (Object.hasOwn(target, key)) {
      throw new ScenarioContractKubernetesImageManifestError('APPLICATION_MANIFEST_INVALID');
    }
    target[key] = container.image;
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isKubernetesName(value: string): boolean {
  return /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/u.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
