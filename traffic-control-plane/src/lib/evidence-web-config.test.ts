import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { register } from '../instrumentation';
import {
  EvidenceWebConfigError,
  parseEvidenceWebConfig,
  readEvidenceWebConfig,
} from './evidence-web-config';

test('Evidence Web config is default-off, unconfigured and bounded without telemetry access', () => {
  assert.deepEqual(parseEvidenceWebConfig({}), {
    captureEnabled: false,
    queryEnabled: false,
    executionEnabled: false,
    prometheus: { baseUrl: null, retentionSec: 604_800 },
    loki: { baseUrl: null, retentionSec: 604_800 },
    tempo: { baseUrl: null, retentionSec: 604_800 },
    observationAuth: null,
    sourceTimeoutMs: 5000,
    totalTimeoutMs: 15_000,
    maxParallelRecipes: 4,
    maxConcurrentReports: 1,
    maxResponseBytes: 1_048_576,
    maxConcurrentRequestsPerSource: 2,
  });
});

test('capture-only, existing-manifest viewing and explicit execution are independent modes', () => {
  const captureOnly = parseEvidenceWebConfig({ EVIDENCE_MANIFEST_CAPTURE_ENABLED: 'true' });
  assert.equal(captureOnly.captureEnabled, true);
  assert.equal(captureOnly.queryEnabled, false);
  assert.equal(captureOnly.executionEnabled, false);

  const viewing = parseEvidenceWebConfig({ EVIDENCE_QUERY_ENABLED: 'true' });
  assert.equal(viewing.captureEnabled, false);
  assert.equal(viewing.queryEnabled, true);
  assert.equal(viewing.executionEnabled, false);

  const execution = parseEvidenceWebConfig({
    EVIDENCE_QUERY_ENABLED: 'true',
    EVIDENCE_QUERY_EXECUTION_ENABLED: 'true',
  });
  assert.equal(execution.executionEnabled, true);
  assert.equal(execution.captureEnabled, false);
  assert.equal(execution.prometheus.baseUrl, null);
  assert.throws(
    () => parseEvidenceWebConfig({ EVIDENCE_QUERY_EXECUTION_ENABLED: 'true' }),
    (error: unknown) => error instanceof EvidenceWebConfigError
      && error.code === 'EVIDENCE_QUERY_EXECUTION_REQUIRES_QUERY',
  );
});

test('explicit flags accept only true/false and never echo the supplied value', () => {
  for (const name of [
    'EVIDENCE_MANIFEST_CAPTURE_ENABLED',
    'EVIDENCE_QUERY_ENABLED',
    'EVIDENCE_QUERY_EXECUTION_ENABLED',
  ]) {
    for (const value of ['', 'TRUE', '0', 'yes', 'false ', 'credential-value']) {
      assert.throws(
        () => parseEvidenceWebConfig({ [name]: value }),
        (error: unknown) => error instanceof Error
          && error.message === `INVALID_BOOLEAN_ENV:${name}`,
      );
    }
  }
});

test('source configuration accepts exact HTTP(S) origins without deep-link fallbacks', () => {
  const configured = parseEvidenceWebConfig({
    EVIDENCE_PROMETHEUS_BASE_URL: 'http://prometheus:9090/',
    EVIDENCE_LOKI_BASE_URL: 'https://loki.internal:3100',
    EVIDENCE_TEMPO_BASE_URL: 'http://[::1]:3200',
    EVIDENCE_PROMETHEUS_RETENTION_SEC: '3600',
    EVIDENCE_LOKI_RETENTION_SEC: '7200',
    EVIDENCE_TEMPO_RETENTION_SEC: '86400',
  });
  assert.deepEqual(configured.prometheus, { baseUrl: 'http://prometheus:9090', retentionSec: 3600 });
  assert.deepEqual(configured.loki, { baseUrl: 'https://loki.internal:3100', retentionSec: 7200 });
  assert.deepEqual(configured.tempo, { baseUrl: 'http://[::1]:3200', retentionSec: 86_400 });
  for (const baseUrl of [undefined, '']) {
    const unconfigured = parseEvidenceWebConfig({
      EVIDENCE_PROMETHEUS_BASE_URL: baseUrl,
      GRAFANA_BASE_URL: 'https://grafana.invalid',
      TEMPO_BASE_URL: 'https://tempo.invalid',
      PROMETHEUS_RELOAD_URL: 'https://reload.invalid',
    });
    assert.equal(unconfigured.prometheus.baseUrl, null);
    assert.equal(unconfigured.tempo.baseUrl, null);
  }
});

test('source origin rejects credentials, paths, redirects-as-config and malformed URL syntax', () => {
  const values = [
    'https://operator:secret@prometheus:9090',
    'http://@prometheus:9090',
    'http://prometheus:9090/api/v1/query_range',
    'http://prometheus:9090/?token=private',
    'http://prometheus:9090/#private',
    'http://prometheus:9090/?',
    'http://prometheus:9090/#',
    'file:///tmp/metrics',
    'ftp://prometheus',
    'http://', 'http://[', 'http://prometheus:70000',
    ' http://prometheus:9090', 'http://prometheus:9090 ',
    'http://prometheus\\private', 'http://prometheus:9090\n',
  ];
  for (const name of [
    'EVIDENCE_PROMETHEUS_BASE_URL', 'EVIDENCE_LOKI_BASE_URL', 'EVIDENCE_TEMPO_BASE_URL',
  ]) {
    for (const value of values) {
      assert.throws(
        () => parseEvidenceWebConfig({ [name]: value }),
        (error: unknown) => error instanceof EvidenceWebConfigError
          && error.code === 'EVIDENCE_SOURCE_ORIGIN_INVALID',
        `${name} must reject malformed origins`,
      );
    }
  }
});

test('query budgets reject malformed and out-of-bound values rather than silently clamping', () => {
  const settings = [
    { name: 'EVIDENCE_SOURCE_TIMEOUT_MS', minimum: 100, maximum: 8000 },
    { name: 'EVIDENCE_REPORT_TOTAL_TIMEOUT_MS', minimum: 1000, maximum: 20_000 },
    { name: 'EVIDENCE_MAX_PARALLEL_RECIPES', minimum: 1, maximum: 4 },
    { name: 'EVIDENCE_MAX_CONCURRENT_REPORTS', minimum: 1, maximum: 2 },
    { name: 'EVIDENCE_MAX_RESPONSE_BYTES', minimum: 1024, maximum: 1_048_576 },
    ...['PROMETHEUS', 'LOKI', 'TEMPO'].map((backend) => ({
      name: `EVIDENCE_${backend}_RETENTION_SEC`,
      minimum: 1,
      maximum: Math.floor(Number.MAX_SAFE_INTEGER / 1000),
    })),
  ];
  for (const setting of settings) {
    for (const value of [
      '', ' 1', '1 ', '1.5', '01', '1e3', '1ms', '-1',
      String(setting.minimum - 1), String(setting.maximum + 1),
    ]) {
      assert.throws(
        () => parseEvidenceWebConfig({ [setting.name]: value }),
        (error: unknown) => error instanceof Error
          && error.message === `INVALID_INTEGER_ENV:${setting.name}`,
      );
    }
  }
});

test('total budget must exceed source budget, including explicit default-off configuration', () => {
  for (const totalTimeoutMs of ['4999', '5000']) {
    assert.throws(
      () => parseEvidenceWebConfig({ EVIDENCE_REPORT_TOTAL_TIMEOUT_MS: totalTimeoutMs }),
      (error: unknown) => error instanceof EvidenceWebConfigError
        && error.code === 'EVIDENCE_REPORT_TIMEOUT_TOO_SHORT',
    );
  }
  const configured = parseEvidenceWebConfig({
    EVIDENCE_SOURCE_TIMEOUT_MS: '100',
    EVIDENCE_REPORT_TOTAL_TIMEOUT_MS: '1000',
    EVIDENCE_MAX_PARALLEL_RECIPES: '1',
    EVIDENCE_MAX_CONCURRENT_REPORTS: '2',
    EVIDENCE_MAX_RESPONSE_BYTES: '1024',
  });
  assert.equal(configured.sourceTimeoutMs, 100);
  assert.equal(configured.totalTimeoutMs, 1000);
  assert.equal(configured.maxParallelRecipes, 1);
  assert.equal(configured.maxConcurrentReports, 2);
  assert.equal(configured.maxResponseBytes, 1024);
});

test('upper query bounds and source-specific retention are accepted without expanding fixed source concurrency', () => {
  const maximumRetention = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
  const configured = parseEvidenceWebConfig({
    EVIDENCE_SOURCE_TIMEOUT_MS: '8000',
    EVIDENCE_REPORT_TOTAL_TIMEOUT_MS: '20000',
    EVIDENCE_MAX_PARALLEL_RECIPES: '4',
    EVIDENCE_MAX_CONCURRENT_REPORTS: '2',
    EVIDENCE_MAX_RESPONSE_BYTES: '1048576',
    EVIDENCE_PROMETHEUS_RETENTION_SEC: String(maximumRetention),
    EVIDENCE_LOKI_RETENTION_SEC: '1',
    EVIDENCE_TEMPO_RETENTION_SEC: '604800',
  });
  assert.equal(configured.sourceTimeoutMs, 8000);
  assert.equal(configured.totalTimeoutMs, 20_000);
  assert.equal(configured.maxParallelRecipes, 4);
  assert.equal(configured.maxConcurrentReports, 2);
  assert.equal(configured.maxResponseBytes, 1_048_576);
  assert.equal(configured.maxConcurrentRequestsPerSource, 2);
  assert.equal(configured.prometheus.retentionSec, maximumRetention);
  assert.ok(Number.isSafeInteger(configured.prometheus.retentionSec * 1000));
  assert.equal(configured.loki.retentionSec, 1);
});

test('optional observation credentials must be paired, header-safe and never echoed in errors', () => {
  assert.equal(parseEvidenceWebConfig({
    EVIDENCE_OBS_USERNAME: '', EVIDENCE_OBS_PASSWORD: '',
  }).observationAuth, null);
  assert.deepEqual(parseEvidenceWebConfig({
    EVIDENCE_OBS_USERNAME: 'reader',
    EVIDENCE_OBS_PASSWORD: 'private:password',
  }).observationAuth, { username: 'reader', password: 'private:password' });
  for (const values of [
    { EVIDENCE_OBS_USERNAME: 'reader' },
    { EVIDENCE_OBS_PASSWORD: 'private-secret' },
    { EVIDENCE_OBS_USERNAME: 'reader', EVIDENCE_OBS_PASSWORD: '' },
    { EVIDENCE_OBS_USERNAME: 'reader:admin', EVIDENCE_OBS_PASSWORD: 'private' },
    { EVIDENCE_OBS_USERNAME: 'reader\n', EVIDENCE_OBS_PASSWORD: 'private' },
    { EVIDENCE_OBS_USERNAME: 'reader', EVIDENCE_OBS_PASSWORD: 'private\r\n' },
    { EVIDENCE_OBS_USERNAME: 'reader', EVIDENCE_OBS_PASSWORD: '\u0000private' },
    { EVIDENCE_OBS_USERNAME: 'reader', EVIDENCE_OBS_PASSWORD: '   ' },
  ]) {
    assert.throws(
      () => parseEvidenceWebConfig(values),
      (error: unknown) => error instanceof EvidenceWebConfigError
        && error.message === 'EVIDENCE_OBSERVATION_AUTH_INVALID',
    );
  }
});

test('explicit read honors kill switches without caching previous flags', () => {
  const environment = {
    EVIDENCE_MANIFEST_CAPTURE_ENABLED: 'true',
    EVIDENCE_QUERY_ENABLED: 'true',
    EVIDENCE_QUERY_EXECUTION_ENABLED: 'true',
  };
  assert.equal(readEvidenceWebConfig(environment).executionEnabled, true);
  environment.EVIDENCE_QUERY_EXECUTION_ENABLED = 'false';
  const disabled = readEvidenceWebConfig(environment);
  assert.equal(disabled.executionEnabled, false);
  assert.equal(disabled.queryEnabled, true);
  assert.equal(disabled.captureEnabled, true);
});

test('Web instrumentation validates Evidence config while Edge registration skips server config', async () => {
  const original = {
    runtime: process.env.NEXT_RUNTIME,
    flag: process.env.EVIDENCE_QUERY_ENABLED,
  };
  try {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.EVIDENCE_QUERY_ENABLED = 'private-invalid-flag';
    await assert.rejects(register(), /INVALID_BOOLEAN_ENV:EVIDENCE_QUERY_ENABLED/);
    process.env.NEXT_RUNTIME = 'edge';
    await register();
  } finally {
    if (original.runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = original.runtime;
    if (original.flag === undefined) delete process.env.EVIDENCE_QUERY_ENABLED;
    else process.env.EVIDENCE_QUERY_ENABLED = original.flag;
  }
});

test('shared env and Worker import graph do not parse invalid Web-only Evidence values', async () => {
  const sharedSource = await readFile(path.resolve('src/lib/env.ts'), 'utf8');
  const workerSource = await readFile(path.resolve('src/worker/worker-runtime.ts'), 'utf8');
  assert.equal(sharedSource.includes('EVIDENCE_'), false);
  assert.equal(sharedSource.includes('evidence-web-config'), false);
  assert.equal(workerSource.includes('evidence-web-config'), false);
  const child = spawnSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e',
    "import './src/lib/env.ts'; import './src/worker/worker-runtime.ts';",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      EVIDENCE_MANIFEST_CAPTURE_ENABLED: 'invalid',
      EVIDENCE_QUERY_ENABLED: 'invalid',
      EVIDENCE_QUERY_EXECUTION_ENABLED: 'invalid',
      EVIDENCE_PROMETHEUS_BASE_URL: 'invalid-origin',
      EVIDENCE_OBS_USERNAME: 'private-reader-without-password',
    },
    timeout: 10_000,
    encoding: 'utf8',
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});
