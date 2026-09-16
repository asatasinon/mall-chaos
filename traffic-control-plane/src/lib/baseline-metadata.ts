import { env } from './env';
import {
  BASELINE_DEPLOYMENT_MODES,
  BASELINE_SCHEMA_REVISION,
  type BaselineDeploymentMode,
} from './baseline-schema';
import { getCatalogRevision } from './fault-run-catalog-revision';
import { loadDataWarmupConfig, type DataWarmupConfig } from './data-warmup-config';
import { loadWarmupProgress, type WarmupProgress } from '../worker/data-warmup';

export const UNKNOWN_RELEASE_REVISION = 'UNKNOWN' as const;
const RELEASE_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$/;

export interface NormalizedReleaseRevision {
  value: string;
  limitation: string | null;
}

export interface NormalizedDeploymentMode {
  value: BaselineDeploymentMode;
  limitation: string | null;
}

export interface BaselineMetadata {
  catalogRevision: string;
  releaseRevision: string;
  deploymentMode: BaselineDeploymentMode;
  schemaRevision: typeof BASELINE_SCHEMA_REVISION;
  limitations: string[];
}

export interface BaselineWarmupMetadata {
  dataWarmupEnabled: boolean | null;
  config: DataWarmupConfig | null;
  observedProgress: Array<Pick<WarmupProgress,
    'tableName' | 'status' | 'actualRows' | 'currentDate' | 'dayCompletedRows' | 'currentDateRows'
    | 'earliestTime' | 'latestTime' | 'tableBytes' | 'guardReason' | 'lastSuccessAt'>>;
  limitations: string[];
}

export function normalizeReleaseRevision(value: unknown): NormalizedReleaseRevision {
  if (typeof value === 'string' && RELEASE_REVISION_PATTERN.test(value.trim())) {
    return { value: value.trim(), limitation: null };
  }
  return {
    value: UNKNOWN_RELEASE_REVISION,
    limitation: 'RELEASE_REVISION_UNKNOWN',
  };
}

export function normalizeDeploymentMode(value: unknown): NormalizedDeploymentMode {
  if (typeof value === 'string' && BASELINE_DEPLOYMENT_MODES.includes(value as BaselineDeploymentMode)) {
    return { value: value as BaselineDeploymentMode, limitation: null };
  }
  return {
    value: 'unknown',
    limitation: 'DEPLOYMENT_MODE_UNKNOWN',
  };
}

export function getBaselineMetadata(): BaselineMetadata {
  const release = normalizeReleaseRevision(env.CASTREL_RELEASE_REVISION);
  const deployment = normalizeDeploymentMode(env.CASTREL_DEPLOYMENT_MODE);
  return {
    catalogRevision: getCatalogRevision(),
    releaseRevision: release.value,
    deploymentMode: deployment.value,
    schemaRevision: BASELINE_SCHEMA_REVISION,
    limitations: [release.limitation, deployment.limitation].filter(
      (limitation): limitation is string => limitation !== null,
    ),
  };
}

export async function loadBaselineWarmupMetadata(): Promise<BaselineWarmupMetadata> {
  const limitations: string[] = [];
  let config: DataWarmupConfig | null = null;
  let progress: WarmupProgress[] = [];

  try {
    config = await loadDataWarmupConfig();
  } catch {
    limitations.push('DATA_WARMUP_CONFIG_UNAVAILABLE');
  }
  try {
    progress = await loadWarmupProgress();
  } catch {
    limitations.push('DATA_WARMUP_PROGRESS_UNAVAILABLE');
  }

  return {
    dataWarmupEnabled: config?.enabled ?? null,
    config,
    observedProgress: progress.map((item) => ({
      tableName: item.tableName,
      status: item.status,
      actualRows: item.actualRows,
      currentDate: item.currentDate,
      dayCompletedRows: item.dayCompletedRows,
      currentDateRows: item.currentDateRows,
      earliestTime: item.earliestTime,
      latestTime: item.latestTime,
      tableBytes: item.tableBytes,
      guardReason: item.guardReason,
      lastSuccessAt: item.lastSuccessAt,
    })),
    limitations,
  };
}
