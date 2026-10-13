import {
  EVIDENCE_MANIFEST_SCHEMA_VERSION,
  getEvidenceTimelineHash,
  parseEvidenceManifestDraft,
  type EvidenceManifestDraft,
  type EvidenceStoredContractSnapshotRecord,
  type EvidenceTimeline,
} from './evidence-types';
import { resolveEvidenceWindows } from './evidence-window-resolver';

export function createEvidenceManifestDraft(
  snapshot: EvidenceStoredContractSnapshotRecord,
  timeline: EvidenceTimeline,
): EvidenceManifestDraft {
  const resolved = resolveEvidenceWindows(
    snapshot.evidence,
    timeline,
    snapshot.renderedPlan.windowLimits,
  );
  const limitations = [
    ...resolved.limitations,
    ...resolved.windows.flatMap((window) => window.reasonCode === null
      ? []
      : [{ code: window.reasonCode, window: window.name }]),
  ];
  const uniqueLimitations = [...new Map(limitations.map((limitation) => [
    `${limitation.code}\u0000${limitation.window ?? ''}`,
    limitation,
  ])).values()].sort((left, right) =>
    `${left.window ?? ''}\u0000${left.code}`.localeCompare(`${right.window ?? ''}\u0000${right.code}`));

  return parseEvidenceManifestDraft({
    manifestSchemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    snapshotId: snapshot.snapshotId,
    sourceFaultRunId: snapshot.sourceFaultRunId,
    scenario: snapshot.scenario,
    contractRevision: snapshot.contractRevision,
    contractHash: snapshot.contractHash,
    renderedPlanHash: snapshot.renderedPlanHash,
    timelineHash: getEvidenceTimelineHash(timeline),
    timeline,
    windows: resolved.windows,
    recipes: snapshot.renderedPlan.recipes,
    limitations: uniqueLimitations,
  });
}
