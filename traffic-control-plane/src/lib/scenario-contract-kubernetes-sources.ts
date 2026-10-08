import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

export class ScenarioContractKubernetesSourcesError extends Error {
  constructor(readonly code: 'KUSTOMIZATION_INVALID' | 'WORKLOAD_SOURCES_UNAVAILABLE') {
    super(code);
    this.name = 'ScenarioContractKubernetesSourcesError';
  }
}

export async function loadScenarioContractKubernetesWorkloadManifests(
  repositoryRoot: string,
): Promise<string[]> {
  const root = path.resolve(repositoryRoot);
  const kustomizationPath = path.resolve(root, 'k8s/kustomization.yaml');
  let kustomizationText: string;
  try {
    kustomizationText = await readFile(kustomizationPath, 'utf8');
  } catch {
    throw new ScenarioContractKubernetesSourcesError('WORKLOAD_SOURCES_UNAVAILABLE');
  }

  let kustomization: unknown;
  try {
    kustomization = yaml.load(kustomizationText) as unknown;
  } catch {
    throw new ScenarioContractKubernetesSourcesError('KUSTOMIZATION_INVALID');
  }
  const resources = asRecord(kustomization)?.resources;
  if (!Array.isArray(resources) || resources.some((resource) => typeof resource !== 'string')) {
    throw new ScenarioContractKubernetesSourcesError('KUSTOMIZATION_INVALID');
  }

  const exporterPaths = resources
    .filter((resource): resource is string => resource === 'infra/exporters.yaml')
    .map((resource) => path.resolve(root, 'k8s', resource));
  const servicePaths = await listYamlFilesRecursively(path.resolve(root, 'k8s/services'));
  const sourcePaths = [...exporterPaths, ...servicePaths].sort(compareText);
  try {
    return await Promise.all(sourcePaths.map((sourcePath) => readFile(sourcePath, 'utf8')));
  } catch {
    throw new ScenarioContractKubernetesSourcesError('WORKLOAD_SOURCES_UNAVAILABLE');
  }
}

async function listYamlFilesRecursively(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new ScenarioContractKubernetesSourcesError('WORKLOAD_SOURCES_UNAVAILABLE');
  }
  const paths = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listYamlFilesRecursively(entryPath);
    if (entry.isFile() && /\.ya?ml$/iu.test(entry.name)) return [entryPath];
    return [];
  }));
  return paths.flat().sort(compareText);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
