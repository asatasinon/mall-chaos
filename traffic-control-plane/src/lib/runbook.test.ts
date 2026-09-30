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

import {
  getScenarioDefinition,
  listScenarioDefinitions,
} from './fault-run-catalog';
import { generateScenarioContractRunbookChecklist } from './scenario-contract-artifacts';
import { resolveScenarioContract } from './scenario-contract';
import { SCENARIO_CONTRACT_RUNBOOK_HEADING_TEXT } from './scenario-contract-runbook-headings';
import { SCENARIO_CONTRACT_REQUIRED_RUNBOOK_HEADINGS } from './scenario-contract-validator';
import { getMarkdownCodeLanguage, isMermaidCodeBlock } from '@/components/runbook/RunbookArticle';

const REQUIRED_ARTICLE_HEADINGS = {
  en: Object.values(SCENARIO_CONTRACT_RUNBOOK_HEADING_TEXT.en),
  'zh-CN': Object.values(SCENARIO_CONTRACT_RUNBOOK_HEADING_TEXT['zh-CN']),
} as const;

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
    assert.deepEqual(entry.recoveryPolicy, definition.recoveryPolicy, definition.scenario);
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

test('Tempo queries are derived from active Catalog recipes and typed predicates', () => {
  for (const definition of listScenarioDefinitions()) {
    const entry = getRunbookEntry(definition.scenario);
    const contract = resolveScenarioContract(definition);
    const tempoRecipes = contract.evidence.recipes.filter(
      ({ source, window }) => source === 'TEMPO' && window === 'active',
    );
    assert.equal(entry.tempoQueries.length, tempoRecipes.length, definition.scenario);
    assert.equal(entry.tempo.timeRange, 'now-1h to now', definition.scenario);
    assert.ok(entry.tempo.businessPath.length > 0, definition.scenario);
    assert.ok(entry.tempo.waterfallChecks.length > 0, definition.scenario);

    for (const query of entry.tempoQueries) {
      const recipe = tempoRecipes.find(({ id }) => id === query.recipeId);
      assert.ok(recipe, `${definition.scenario}:${query.recipeId}`);
      assert.equal(query.template, recipe.template, definition.scenario);
      assert.equal(query.serviceName, recipe.scope.service, definition.scenario);
      assert.equal(query.route, recipe.scope.route, definition.scenario);
      assert.deepEqual(query.predicate, recipe.predicate, definition.scenario);
      assert.match(query.query, /^\{ resource\.service\.name = ".+"(?: && .+)? \}$/u, definition.scenario);
      assert.equal(/https?:\/\//.test(query.query), false, definition.scenario);
      if (recipe.template === 'SERVICE_SLOW_REQUESTS') {
        assert.equal(recipe.predicate.kind, 'COMPARISON', definition.scenario);
        if (recipe.predicate.kind === 'COMPARISON') {
          const threshold = Number.isSafeInteger(recipe.predicate.value * 1000)
            && recipe.predicate.value * 1000 < 1000
            ? `${recipe.predicate.value * 1000}ms`
            : `${recipe.predicate.value}s`;
          assert.ok(query.query.includes(`duration ${{
            GT: '>',
            GTE: '>=',
            LT: '<',
            LTE: '<=',
            EQ: '=',
          }[recipe.predicate.operator]} ${threshold}`), definition.scenario);
        }
      }
    }
  }
});

test('Tempo query builder consumes only resolved recipes, not ad hoc query text', () => {
  const contract = resolveScenarioContract(getScenarioDefinition('BROWSE_REPORT_SQL'));
  const queries = buildTempoQueries(contract);
  const recipe = contract.evidence.recipes.find(({ source, template, window }) => (
    source === 'TEMPO' && template === 'SERVICE_SLOW_REQUESTS' && window === 'active'
  ));

  assert.ok(recipe);
  assert.equal(queries.length, contract.evidence.recipes.filter(
    ({ source, window }) => source === 'TEMPO' && window === 'active',
  ).length);
  assert.deepEqual(queries.find(({ recipeId }) => recipeId === recipe.id), {
    recipeId: recipe.id,
    template: recipe.template,
    serviceName: recipe.scope.service,
    route: recipe.scope.route,
    predicate: recipe.predicate,
    query: '{ resource.service.name = "catalog-service" && span.http.route = "/api/reports/product-browse" && duration > 2s }',
  });
  assert.equal(JSON.stringify(RUNBOOK_METADATA.BROWSE_REPORT_SQL).includes('slowThreshold'), false);
  assert.equal(JSON.stringify(RUNBOOK_METADATA.BROWSE_REPORT_SQL).includes('serviceName'), false);
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
      assert.ok(markdown.includes(entry.scenario), `${locale}:${entry.scenario}:scenario`);
      assert.ok(markdown.includes(entry.targetService), `${locale}:${entry.scenario}:targetService`);
      assert.ok(markdown.includes(entry.targetOperation), `${locale}:${entry.scenario}:targetOperation`);
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

test('generated manual checklist covers each resolved Catalog contract and allowlisted article', () => {
  const entries = listRunbookEntries();
  const contracts = listScenarioDefinitions().map((definition) => resolveScenarioContract(definition));
  const checklist = generateScenarioContractRunbookChecklist(
    contracts,
    entries.map(({ scenario, articleFile }) => ({ scenario, articleFile })),
  );

  assert.equal(checklist.scenarios.length, contracts.length);
  assert.deepEqual(checklist.scenarios.map(({ scenario }) => scenario),
    contracts.map(({ scenario }) => scenario).sort());
  for (const item of checklist.scenarios) {
    const contract = contracts.find(({ scenario }) => scenario === item.scenario);
    const entry = entries.find(({ scenario }) => scenario === item.scenario);
    assert.ok(contract);
    assert.ok(entry);
    assert.equal(item.articleFile, entry.articleFile, item.scenario);
    assert.equal(item.targetService, contract.targetService, item.scenario);
    assert.equal(item.targetOperation, contract.targetOperation, item.scenario);
    assert.deepEqual(item.requiredHeadings, SCENARIO_CONTRACT_REQUIRED_RUNBOOK_HEADINGS);
    assert.equal(item.lifecycle.alertSectionRequired, true, item.scenario);
    assert.deepEqual(item.lifecycle.activeEffectRecipeIds, contract.evidence.effectRule.recipeIds.slice().sort());
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