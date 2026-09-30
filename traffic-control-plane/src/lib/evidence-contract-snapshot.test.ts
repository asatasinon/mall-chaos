import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listScenarioDefinitions } from './fault-run-catalog';
import {
  createEvidenceContractSnapshotRecord,
  EvidenceContractSnapshotError,
  requireEvidenceContractSnapshot,
  serializeEvidenceContractSnapshotRecord,
} from './evidence-contract-snapshot';
import {
  canonicalizeEvidenceContractPlan,
  getEvidenceContractHash,
  getScenarioContractRevision,
  resolveScenarioContract,
  type EvidenceContractPlan,
} from './scenario-contract';

test('snapshot serialization round-trips the Phase 3 Evidence DSL and hashes it independently', () => {
  const observationModes = new Set<string>();
  let effectPredicateCount = 0;

  for (const definition of listScenarioDefinitions()) {
    const contract = resolveScenarioContract(definition);
    const evidence: EvidenceContractPlan = contract.evidence;
    const contractRevision = getScenarioContractRevision(contract);
    const snapshot = createEvidenceContractSnapshotRecord(contractRevision, evidence);
    const serialized = serializeEvidenceContractSnapshotRecord(snapshot);
    const roundTripped: unknown = JSON.parse(serialized.contractJson);
    const canonicalEvidence: unknown = JSON.parse(canonicalizeEvidenceContractPlan(evidence));

    assert.equal(snapshot.contractRevision, contractRevision);
    assert.equal(serialized.contractRevision, contractRevision);
    assert.equal(serialized.contractHash, getEvidenceContractHash(evidence));
    assert.equal(serialized.contractJson, canonicalizeEvidenceContractPlan(evidence));
    assert.deepEqual(roundTripped, canonicalEvidence);
    assert.equal(getEvidenceContractHash(snapshot.evidence), serialized.contractHash);

    for (const recipe of evidence.recipes) {
      observationModes.add(recipe.observationMode);
    }
    for (const recipeId of evidence.effectRule.recipeIds) {
      const effectRecipe = evidence.recipes.find(({ id }) => id === recipeId);
      assert.ok(effectRecipe);
      assert.equal(effectRecipe.observationMode, 'WINDOWED');
      assert.equal(effectRecipe.window, 'active');
      assert.notEqual(effectRecipe.predicate.kind, 'NONE');
      effectPredicateCount += 1;
    }
  }

  assert.deepEqual([...observationModes].sort(), ['CURRENT', 'WINDOWED']);
  assert.ok(effectPredicateCount > 0);
});

test('snapshot serialization rejects invalid revisions and modified Evidence content', () => {
  const contract = resolveScenarioContract(listScenarioDefinitions()[0]!);
  const snapshot = createEvidenceContractSnapshotRecord(
    getScenarioContractRevision(contract),
    contract.evidence,
  );

  assert.throws(
    () => createEvidenceContractSnapshotRecord('invalid-revision', contract.evidence),
    (error: unknown) => error instanceof EvidenceContractSnapshotError
    && error.code === 'EVIDENCE_CONTRACT_SNAPSHOT_INVALID_CONTRACT_REVISION',
  );
  assert.throws(
    () => serializeEvidenceContractSnapshotRecord({
      ...snapshot,
      contractHash: '0'.repeat(64),
    }),
    (error: unknown) => error instanceof EvidenceContractSnapshotError
      && error.code === 'EVIDENCE_CONTRACT_SNAPSHOT_HASH_MISMATCH',
  );

  const changedEvidence: EvidenceContractPlan = {
    ...snapshot.evidence,
    windows: {
      ...snapshot.evidence.windows,
      activeLeadSec: snapshot.evidence.windows.activeLeadSec + 1,
    },
  };
  assert.throws(
    () => serializeEvidenceContractSnapshotRecord({
      ...snapshot,
      evidence: changedEvidence,
    }),
    (error: unknown) => error instanceof EvidenceContractSnapshotError
      && error.code === 'EVIDENCE_CONTRACT_SNAPSHOT_HASH_MISMATCH',
  );
});

test('snapshot resolution reports unavailable instead of rebuilding from the Catalog', () => {
  assert.throws(
    () => requireEvidenceContractSnapshot(null),
    (error: unknown) => error instanceof EvidenceContractSnapshotError
      && error.code === 'CONTRACT_SNAPSHOT_UNAVAILABLE',
  );
});
