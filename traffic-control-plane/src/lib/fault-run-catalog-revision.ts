import { createHash } from 'node:crypto';
import {
  listScenarioDefinitions,
  type FaultRunParameterDefinition,
  type FaultRunRecoveryPolicy,
  type FaultRunScenarioDefinition,
} from './fault-run-catalog';

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CATALOG_REVISION_FAILED');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`;
  }
  throw new Error('CATALOG_REVISION_FAILED');
}

function canonicalParameter(parameter: FaultRunParameterDefinition): Record<string, unknown> {
  return {
    default: parameter.default ?? null,
    kind: parameter.kind,
    max: parameter.max ?? null,
    maxLength: parameter.maxLength ?? null,
    min: parameter.min ?? null,
    name: parameter.name,
    options: parameter.options ? [...parameter.options].sort() : null,
    required: parameter.required === true,
    unit: parameter.unit ?? null,
  };
}

function canonicalRecoveryPolicy(policy: FaultRunRecoveryPolicy): Record<string, unknown> {
  return {
    cleanup: policy.cleanup,
    targetRelease: policy.targetRelease,
    verification: policy.verification,
    workerDrain: {
      owner: policy.workerDrain.requirement === 'REQUIRED' ? policy.workerDrain.owner : null,
      requirement: policy.workerDrain.requirement,
    },
  };
}

function canonicalDefinition(definition: FaultRunScenarioDefinition): Record<string, unknown> {
  return {
    allowManualCleanup: definition.allowManualCleanup,
    maxDurationSec: definition.maxDurationSec,
    parameters: [...definition.parameters]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(canonicalParameter),
    recoveryPolicy: canonicalRecoveryPolicy(definition.recoveryPolicy),
    recoveryStrategy: definition.recoveryStrategy,
    scenario: definition.scenario,
    targetOperation: definition.targetOperation,
    targetPrepare: definition.targetPrepare,
    targetService: definition.targetService,
  };
}

export function canonicalizeCatalogDefinitions(
  definitions: readonly FaultRunScenarioDefinition[] = listScenarioDefinitions(),
): string {
  return canonicalize(
    [...definitions]
      .sort((left, right) => left.scenario.localeCompare(right.scenario))
      .map(canonicalDefinition),
  );
}

export function getCatalogRevision(
  definitions: readonly FaultRunScenarioDefinition[] = listScenarioDefinitions(),
): string {
  return createHash('sha256')
    .update(canonicalizeCatalogDefinitions(definitions), 'utf8')
    .digest('hex');
}
