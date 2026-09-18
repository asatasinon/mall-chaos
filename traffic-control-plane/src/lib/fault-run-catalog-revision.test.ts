import assert from 'node:assert/strict';
import test from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import {
  canonicalizeCatalogDefinitions,
  getCatalogRevision,
} from './fault-run-catalog-revision';

test('catalog revision is stable when scenarios, parameters, or options are reordered', () => {
  const definitions = listScenarioDefinitions();
  const reordered = definitions
    .map((definition) => ({
      ...definition,
      parameters: [...definition.parameters]
        .reverse()
        .map((parameter) => ({
          ...parameter,
          options: parameter.options ? [...parameter.options].reverse() : parameter.options,
        })),
    }))
    .reverse();

  assert.equal(
    canonicalizeCatalogDefinitions(definitions),
    canonicalizeCatalogDefinitions(reordered),
  );
  assert.equal(getCatalogRevision(definitions), getCatalogRevision(reordered));
  assert.match(getCatalogRevision(), /^[a-f0-9]{64}$/);
});

test('catalog facts change the revision', () => {
  const definitions = listScenarioDefinitions();
  const changed = definitions.map((definition, index) => index === 0
    ? { ...definition, maxDurationSec: definition.maxDurationSec + 1 }
    : definition);

  assert.notEqual(getCatalogRevision(definitions), getCatalogRevision(changed));
});

test('every recovery policy fact contributes to the catalog revision', () => {
  const definitions = listScenarioDefinitions();
  const definition = definitions[0];
  assert.ok(definition);

  const revisions = [
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      workerDrain: { requirement: 'REQUIRED', owner: 'RUNNER_ENGINE' },
    }),
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      workerDrain: { requirement: 'NOT_APPLICABLE' },
    }),
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      targetRelease: 'NOT_APPLICABLE',
    }),
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      cleanup: 'OPTIONAL_PER_RUN',
    }),
    replaceFirstPolicy(definitions, {
      ...definition.recoveryPolicy,
      verification: 'BEST_EFFORT',
    }),
  ].map((changed) => getCatalogRevision(changed));

  for (const revision of revisions) {
    assert.notEqual(revision, getCatalogRevision(definitions));
  }
});

function replaceFirstPolicy(
  definitions: ReturnType<typeof listScenarioDefinitions>,
  recoveryPolicy: ReturnType<typeof listScenarioDefinitions>[number]['recoveryPolicy'],
) {
  return definitions.map((definition, index) => index === 0
    ? { ...definition, recoveryPolicy }
    : definition);
}
