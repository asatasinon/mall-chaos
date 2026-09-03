import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  buildTempoQueries,
  DEFAULT_RUNBOOK_SCENARIO,
  getRunbookEntry,
  listRunbookEntries,
  resolveRunbookScenario,
  RUNBOOK_METADATA,
} from './runbook';
import {
  getRunbookContentPath,
  loadRunbookMarkdown,
  RunbookContentError,
} from './runbook-content';

const REQUIRED_ARTICLE_HEADINGS = {
  en: [
    'Purpose and fixed target',
    'Actual implementation',
    'Parameters and lifecycle',
    'Impact and exclusions',
    'Evidence',
    'Tempo investigation',
    'Recovery and verification',
    'Limits and safe interpretation',
  ],
  'zh-CN': [
    '目的与固定目标',
    '实际实现逻辑',
    '参数与生命周期',
    '影响范围与排除项',
    '证据与判断',
    'Tempo 排障',
    '恢复与验证',
    '限制与安全解释',
  ],
} as const;
import {
  getScenarioDefinition,
  listScenarioDefinitions,
} from './fault-run-catalog';
import { getMarkdownCodeLanguage, isMermaidCodeBlock } from '@/components/runbook/RunbookArticle';

test('runbook metadata covers the catalog exactly once', () => {
  const definitions = listScenarioDefinitions();
  const entries = listRunbookEntries();

  assert.equal(entries.length, definitions.length);
  assert.equal(entries.length, 12);
  assert.deepEqual(
    entries.map(({ scenario }) => scenario),
    definitions.map(({ scenario }) => scenario),
  );
  assert.equal(new Set(entries.map(({ scenario }) => scenario)).size, entries.length);

  for (const definition of definitions) {
    const entry = getRunbookEntry(definition.scenario);
    assert.equal(entry.targetService, definition.targetService, definition.scenario);
    assert.equal(entry.targetOperation, definition.targetOperation, definition.scenario);
    assert.equal(entry.maxDurationSec, definition.maxDurationSec, definition.scenario);
    assert.equal(entry.recoveryStrategy, definition.recoveryStrategy, definition.scenario);
    assert.equal(entry.allowManualCleanup, definition.allowManualCleanup, definition.scenario);
    assert.equal(entry.articleFile.endsWith('.md'), true, definition.scenario);
    assert.equal(entry.articleFile.includes('/'), false, definition.scenario);
    assert.equal(entry.articleFile.includes('\\'), false, definition.scenario);
  }
});

test('runbook metadata does not contain external destinations or trace identifiers', () => {
  const serialized = JSON.stringify(RUNBOOK_METADATA);

  assert.equal(/https?:\/\//.test(serialized), false);
  assert.equal(/(?:^|[^A-Za-z])traceId(?:[^A-Za-z]|$)/i.test(serialized), false);
  assert.equal(serialized.includes('GRAFANA_BASE_URL'), false);
  assert.equal(serialized.includes('TEMPO_BASE_URL'), false);
});

test('scenario query resolution only accepts a known scalar scenario', () => {
  assert.equal(resolveRunbookScenario(DEFAULT_RUNBOOK_SCENARIO), DEFAULT_RUNBOOK_SCENARIO);
  assert.equal(resolveRunbookScenario('INVENTORY_ROW_LOCK'), 'INVENTORY_ROW_LOCK');
  assert.equal(resolveRunbookScenario(undefined), DEFAULT_RUNBOOK_SCENARIO);
  assert.equal(resolveRunbookScenario('unknown'), DEFAULT_RUNBOOK_SCENARIO);
  assert.equal(resolveRunbookScenario(['INVENTORY_ROW_LOCK']), DEFAULT_RUNBOOK_SCENARIO);
  assert.equal(resolveRunbookScenario(['../../etc/passwd']), DEFAULT_RUNBOOK_SCENARIO);
});

test('Tempo queries are derived from static service targets', () => {
  for (const definition of listScenarioDefinitions()) {
    const entry = getRunbookEntry(definition.scenario);
    assert.equal(entry.tempoQueries.length, entry.tempo.targets.length, definition.scenario);
    assert.equal(entry.tempo.timeRange, 'now-1h to now', definition.scenario);
    assert.match(entry.tempo.slowThreshold, /^\d+(?:ms|s)$/u, definition.scenario);
    assert.ok(entry.tempo.businessPath.length > 0, definition.scenario);
    assert.ok(entry.tempo.waterfallChecks.length > 0, definition.scenario);

    for (const query of entry.tempoQueries) {
      assert.match(query.serviceQuery, /^\{ resource\.service\.name = ".+" \}$/u, definition.scenario);
      assert.match(query.errorQuery, /status = error/u, definition.scenario);
      assert.match(query.slowQuery, /duration > \d+(?:ms|s)/u, definition.scenario);
      if (query.route !== undefined) {
        assert.match(query.routeQuery || '', /span\.http\.route/u, definition.scenario);
      }
      assert.equal(/https?:\/\//.test(query.serviceQuery), false, definition.scenario);
    }
  }
});

test('Tempo query builder does not accept user query text', () => {
  const queries = buildTempoQueries({
    targets: [{ serviceName: 'catalog-service', route: '/api/products/{sku}' }],
    businessPath: ['GET /api/products/{sku}'],
    timeRange: 'now-1h to now',
    slowThreshold: '2s',
    waterfallChecks: ['HTTP'],
  });

  assert.deepEqual(queries, [{
    serviceName: 'catalog-service',
    route: '/api/products/{sku}',
    serviceQuery: '{ resource.service.name = "catalog-service" }',
    errorQuery: '{ resource.service.name = "catalog-service" && status = error }',
    slowQuery: '{ resource.service.name = "catalog-service" && duration > 2s }',
    routeQuery: '{ resource.service.name = "catalog-service" && span.http.route = "/api/products/{sku}" }',
  }]);
});

test('catalog lookup remains the source of fixed target data', () => {
  assert.equal(getRunbookEntry('CATALOG_REDIS_LARGE_VALUE').targetService,
    getScenarioDefinition('CATALOG_REDIS_LARGE_VALUE').targetService);
  assert.equal(getRunbookEntry('INVENTORY_TABLE_EXCLUSIVE').targetOperation,
    getScenarioDefinition('INVENTORY_TABLE_EXCLUSIVE').targetOperation);
});

test('content paths use the locale root and allowlisted article file', () => {
  const contentPath = getRunbookContentPath('en', ['../../etc/passwd']);

  assert.equal(
    contentPath,
    path.resolve(process.cwd(), 'src', 'content', 'runbook', 'en', 'browse-report-sql.md'),
  );
  assert.equal(contentPath.includes('etc/passwd'), false);
});

test('content loader rejects unsupported locales without reading a file', async () => {
  await assert.rejects(
    () => loadRunbookMarkdown('fr', 'BROWSE_REPORT_SQL'),
    (error: unknown) => error instanceof RunbookContentError && error.code === 'INVALID_LOCALE',
  );
});

test('content loader reads allowlisted content without exposing its path', async () => {
  const markdown = await loadRunbookMarkdown('en', 'BROWSE_REPORT_SQL');

  assert.match(markdown, /^# /u);
  assert.equal(markdown.includes('src/content/runbook'), false);
  assert.equal(markdown.includes('/Users/'), false);
});

test('all bilingual articles are complete, paired, and use balanced Mermaid fences', async () => {
  const entries = listRunbookEntries();
  assert.equal(entries.length, 12);

  for (const entry of entries) {
    for (const locale of ['en', 'zh-CN'] as const) {
      const markdown = await loadRunbookMarkdown(locale, entry.scenario);
      assert.ok(markdown.trim().length > 0, `${locale}:${entry.scenario}`);
      assert.match(markdown, new RegExp(entry.scenario, 'u'), `${locale}:${entry.scenario}`);
      assert.match(markdown, new RegExp(entry.targetService.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), `${locale}:${entry.scenario}`);
      for (const heading of REQUIRED_ARTICLE_HEADINGS[locale]) {
        assert.equal(markdown.includes(`## ${heading}`), true, `${locale}:${entry.scenario}:${heading}`);
      }
      assert.match(markdown, /^```mermaid$/mu, `${locale}:${entry.scenario}`);
      assert.equal((markdown.match(/^```/gmu) || []).length % 2, 0, `${locale}:${entry.scenario}`);
      assert.equal(markdown.includes('https://'), false, `${locale}:${entry.scenario}`);
    }
  }
});

test('bilingual article file sets match the metadata allowlist', async () => {
  const expectedFiles = new Set(listRunbookEntries().map(({ articleFile }) => articleFile));

  for (const locale of ['en', 'zh-CN'] as const) {
    const entries = await import('node:fs/promises').then(({ readdir }) => readdir(
      path.resolve(process.cwd(), 'src', 'content', 'runbook', locale),
    ));
    assert.deepEqual(new Set(entries), expectedFiles, locale);
  }
});

test('Markdown code classification isolates Mermaid from ordinary code', () => {
  assert.equal(getMarkdownCodeLanguage('language-mermaid'), 'mermaid');
  assert.equal(isMermaidCodeBlock('language-mermaid'), true);
  assert.equal(isMermaidCodeBlock('language-sql'), false);
  assert.equal(isMermaidCodeBlock('language-traceql'), false);
  assert.equal(isMermaidCodeBlock('language-json'), false);
  assert.equal(isMermaidCodeBlock('language-bash'), false);
  assert.equal(isMermaidCodeBlock(undefined), false);
  assert.equal(isMermaidCodeBlock('language-mermaid-extra'), false);
  assert.equal(isMermaidCodeBlock('language-sql language-mermaid'), true);
});