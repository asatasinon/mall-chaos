import { strictBoolean, strictBoundedInteger } from './environment-values';

type EnvironmentSource = Record<string, string | undefined>;

export interface EvidenceSourceConfig {
  readonly baseUrl: string | null;
  readonly retentionSec: number;
}

export interface EvidenceWebConfig {
  readonly captureEnabled: boolean;
  readonly queryEnabled: boolean;
  readonly executionEnabled: boolean;
  readonly prometheus: EvidenceSourceConfig;
  readonly loki: EvidenceSourceConfig;
  readonly tempo: EvidenceSourceConfig;
  readonly observationAuth: {
    readonly username: string;
    readonly password: string;
  } | null;
  readonly sourceTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxParallelRecipes: number;
  readonly maxConcurrentReports: number;
  readonly maxResponseBytes: number;
  readonly maxConcurrentRequestsPerSource: 2;
}

export class EvidenceWebConfigError extends Error {
  constructor(readonly code:
    | 'EVIDENCE_QUERY_EXECUTION_REQUIRES_QUERY'
    | 'EVIDENCE_REPORT_TIMEOUT_TOO_SHORT'
    | 'EVIDENCE_SOURCE_ORIGIN_INVALID'
    | 'EVIDENCE_OBSERVATION_AUTH_INVALID',
  ) {
    super(code);
    this.name = 'EvidenceWebConfigError';
  }
}

export function parseEvidenceWebConfig(source: EnvironmentSource): EvidenceWebConfig {
  const captureEnabled = strictBoolean(
    'EVIDENCE_MANIFEST_CAPTURE_ENABLED', source.EVIDENCE_MANIFEST_CAPTURE_ENABLED, false,
  );
  const queryEnabled = strictBoolean('EVIDENCE_QUERY_ENABLED', source.EVIDENCE_QUERY_ENABLED, false);
  const executionEnabled = strictBoolean(
    'EVIDENCE_QUERY_EXECUTION_ENABLED', source.EVIDENCE_QUERY_EXECUTION_ENABLED, false,
  );
  if (executionEnabled && !queryEnabled) {
    throw new EvidenceWebConfigError('EVIDENCE_QUERY_EXECUTION_REQUIRES_QUERY');
  }
  const sourceTimeoutMs = strictBoundedInteger(
    'EVIDENCE_SOURCE_TIMEOUT_MS', source.EVIDENCE_SOURCE_TIMEOUT_MS, 5000, 100, 8000,
  );
  const totalTimeoutMs = strictBoundedInteger(
    'EVIDENCE_REPORT_TOTAL_TIMEOUT_MS', source.EVIDENCE_REPORT_TOTAL_TIMEOUT_MS, 15_000, 1000, 20_000,
  );
  if (totalTimeoutMs <= sourceTimeoutMs) {
    throw new EvidenceWebConfigError('EVIDENCE_REPORT_TIMEOUT_TOO_SHORT');
  }

  return {
    captureEnabled,
    queryEnabled,
    executionEnabled,
    prometheus: parseSourceConfig(source, 'PROMETHEUS'),
    loki: parseSourceConfig(source, 'LOKI'),
    tempo: parseSourceConfig(source, 'TEMPO'),
    observationAuth: parseObservationAuth(source),
    sourceTimeoutMs,
    totalTimeoutMs,
    maxParallelRecipes: strictBoundedInteger(
      'EVIDENCE_MAX_PARALLEL_RECIPES', source.EVIDENCE_MAX_PARALLEL_RECIPES, 4, 1, 4,
    ),
    maxConcurrentReports: strictBoundedInteger(
      'EVIDENCE_MAX_CONCURRENT_REPORTS', source.EVIDENCE_MAX_CONCURRENT_REPORTS, 1, 1, 2,
    ),
    maxResponseBytes: strictBoundedInteger(
      'EVIDENCE_MAX_RESPONSE_BYTES', source.EVIDENCE_MAX_RESPONSE_BYTES, 1_048_576, 1024, 1_048_576,
    ),
    maxConcurrentRequestsPerSource: 2,
  };
}

export function readEvidenceWebConfig(
  source: EnvironmentSource = process.env,
): EvidenceWebConfig {
  return parseEvidenceWebConfig(source);
}

function parseSourceConfig(
  source: EnvironmentSource,
  backend: 'PROMETHEUS' | 'LOKI' | 'TEMPO',
): EvidenceSourceConfig {
  const urlName = `EVIDENCE_${backend}_BASE_URL`;
  const retentionName = `EVIDENCE_${backend}_RETENTION_SEC`;
  return {
    baseUrl: parseSourceOrigin(source[urlName]),
    retentionSec: strictBoundedInteger(
      retentionName,
      source[retentionName],
      604_800,
      1,
      Math.floor(Number.MAX_SAFE_INTEGER / 1000),
    ),
  };
}

function parseSourceOrigin(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  if (value.trim() !== value || !/^https?:\/\/[^/?#@\s\\]+\/?$/.test(value)) {
    throw new EvidenceWebConfigError('EVIDENCE_SOURCE_ORIGIN_INVALID');
  }
  const url = URL.parse(value);
  if (url === null || !['http:', 'https:'].includes(url.protocol)
    || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new EvidenceWebConfigError('EVIDENCE_SOURCE_ORIGIN_INVALID');
  }
  return url.origin;
}

function parseObservationAuth(
  source: EnvironmentSource,
): EvidenceWebConfig['observationAuth'] {
  const username = source.EVIDENCE_OBS_USERNAME;
  const password = source.EVIDENCE_OBS_PASSWORD;
  if ((username === undefined || username === '') && (password === undefined || password === '')) {
    return null;
  }
  if (!username || !password || username.trim() === ''
    || password.trim() === '' || username.includes(':')
    || /[\u0000-\u001f\u007f]/u.test(username)
    || /[\u0000-\u001f\u007f]/u.test(password)) {
    throw new EvidenceWebConfigError('EVIDENCE_OBSERVATION_AUTH_INVALID');
  }
  return { username, password };
}
