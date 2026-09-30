import {
  canonicalizeEvidenceContractPlan,
  getEvidenceContractHash,
  SCENARIO_CONTRACT_REVISION_PATTERN,
  type EvidenceContractPlan,
} from './scenario-contract';

export interface EvidenceContractSnapshotRecord {
  readonly contractRevision: string;
  readonly contractHash: string;
  readonly evidence: EvidenceContractPlan;
}

export interface SerializedEvidenceContractSnapshot {
  readonly contractRevision: string;
  readonly contractHash: string;
  readonly contractJson: string;
}

export type EvidenceContractSnapshotErrorCode =
  | 'CONTRACT_SNAPSHOT_UNAVAILABLE'
  | 'EVIDENCE_CONTRACT_SNAPSHOT_INVALID_CONTRACT_REVISION'
  | 'EVIDENCE_CONTRACT_SNAPSHOT_HASH_MISMATCH';

export class EvidenceContractSnapshotError extends Error {
  constructor(readonly code: EvidenceContractSnapshotErrorCode) {
    super(code);
    this.name = 'EvidenceContractSnapshotError';
  }
}

export function requireEvidenceContractSnapshot(
  snapshot: EvidenceContractSnapshotRecord | null | undefined,
): EvidenceContractSnapshotRecord {
  if (snapshot === null || snapshot === undefined) {
    throw new EvidenceContractSnapshotError('CONTRACT_SNAPSHOT_UNAVAILABLE');
  }
  serializeEvidenceContractSnapshotRecord(snapshot);
  return snapshot;
}

export function createEvidenceContractSnapshotRecord(
  contractRevision: string,
  evidence: EvidenceContractPlan,
): EvidenceContractSnapshotRecord {
  if (!SCENARIO_CONTRACT_REVISION_PATTERN.test(contractRevision)) {
    throw new EvidenceContractSnapshotError('EVIDENCE_CONTRACT_SNAPSHOT_INVALID_CONTRACT_REVISION');
  }

  const snapshotEvidence = structuredClone(evidence);
  return Object.freeze({
    contractRevision,
    contractHash: getEvidenceContractHash(snapshotEvidence),
    evidence: snapshotEvidence,
  });
}

export function serializeEvidenceContractSnapshotRecord(
  snapshot: EvidenceContractSnapshotRecord,
): SerializedEvidenceContractSnapshot {
  if (!SCENARIO_CONTRACT_REVISION_PATTERN.test(snapshot.contractRevision)) {
    throw new EvidenceContractSnapshotError('EVIDENCE_CONTRACT_SNAPSHOT_INVALID_CONTRACT_REVISION');
  }

  const contractHash = getEvidenceContractHash(snapshot.evidence);
  if (!/^[a-f0-9]{64}$/u.test(snapshot.contractHash) || snapshot.contractHash !== contractHash) {
    throw new EvidenceContractSnapshotError('EVIDENCE_CONTRACT_SNAPSHOT_HASH_MISMATCH');
  }

  return {
    contractRevision: snapshot.contractRevision,
    contractHash,
    contractJson: canonicalizeEvidenceContractPlan(snapshot.evidence),
  };
}
