import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SCHEMA_STATEMENTS } from './fault-run-schema';
import { splitSqlStatements } from './migrations/run';
import {
  EVIDENCE_SCHEMA_STATEMENTS,
  EVIDENCE_TABLE_DEFINITIONS,
  EVIDENCE_TABLE_NAMES,
  verifyEvidenceSchema,
} from './evidence-schema';

type Metadata = Record<string, unknown>[];

test('runtime declarations, clean migration and fresh-init SQL create equivalent Evidence schemas', async () => {
  const [migration, init] = await Promise.all([
    readFile(new URL('./migrations/006-evidence-query.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../../infra/mysql/init/10-evidence-query-schema.sql', import.meta.url), 'utf8'),
  ]);
  const normalize = (statement: string) => statement.replace(/^\s*--.*$/gm, '').replace(/\s+/g, ' ').trim();
  const runtime = EVIDENCE_SCHEMA_STATEMENTS.map(normalize);
  assert.deepEqual(splitSqlStatements(migration).map(normalize), runtime);
  assert.deepEqual(splitSqlStatements(init).map(normalize), runtime);
  for (const statement of EVIDENCE_SCHEMA_STATEMENTS) assert.ok(SCHEMA_STATEMENTS.includes(statement));
});

test('Evidence schema declares five independent protocol and metadata tables without telemetry payloads', () => {
  assert.equal(EVIDENCE_SCHEMA_STATEMENTS.length, 5);
  const ddl = EVIDENCE_SCHEMA_STATEMENTS.join('\n');
  for (const table of EVIDENCE_TABLE_NAMES) {
    assert.ok(ddl.includes(`CREATE TABLE IF NOT EXISTS ${table} (`));
  }
  assert.equal(/FOREIGN KEY|ON DELETE CASCADE|ALTER TABLE/i.test(ddl), false);
  assert.equal(/\b(?:result_json|summary_json|raw_error|response_body|credential|endpoint)\b/i.test(ddl), false);
  assert.match(ddl, /rendered_plan_json JSON NOT NULL/);
  assert.match(ddl, /deadline_at DATETIME\(3\) NOT NULL/);
  assert.match(ddl, /uq_evidence_attempt_idempotency \(source_fault_run_id, idempotency_key\)/);
  assert.match(ddl, /uq_evidence_note_idempotency \(source_fault_run_id, idempotency_key\)/);
  assert.match(ddl, /uq_evidence_attempt_recipe_window \(attempt_id, recipe_id, window_name\)/);
});

test('schema verification is read-only and accepts complete typed metadata with required unique indexes', async () => {
  const fixture = createFixture();
  const statements: string[] = [];
  await verifyEvidenceSchema(async (sql, values) => {
    statements.push(sql);
    assert.deepEqual(values, [...EVIDENCE_TABLE_NAMES]);
    return fixtureQuery(fixture)(sql);
  });
  assert.equal(statements.length, 4);
  assert.ok(statements.every((statement) => statement.trim().startsWith('SELECT')));
});

test('schema verification rejects missing, nullable, incompatible or extra columns', async () => {
  const mutations: Array<(columns: Metadata) => void> = [
    (rows) => { rows.pop(); },
    (rows) => { rows[0].is_nullable = 'YES'; },
    (rows) => { rows[0].character_maximum_length = 35; },
    (rows) => { rows[0].data_type = 'varchar'; },
    (rows) => { rows.find((row) => row.column_name === 'manifest_revision')!.column_type = 'int'; },
    (rows) => { rows.find((row) => row.column_name === 'deadline_at')!.datetime_precision = 0; },
    (rows) => { rows.find((row) => row.column_name === 'created_at')!.column_default = null; },
    (rows) => { rows.find((row) => row.column_name === 'source_run_retained')!.column_default = '0'; },
    (rows) => { rows.find((row) => row.column_name === 'id')!.extra = ''; },
    (rows) => { rows.push({ ...rows[0], column_name: 'raw_error' }); },
  ];
  for (const mutate of mutations) {
    const fixture = createFixture();
    mutate(fixture.columns);
    await assert.rejects(verifyEvidenceSchema(fixtureQuery(fixture)), /MIGRATION_EVIDENCE_COLUMN/);
  }
});

test('schema verification rejects lost, non-unique, reordered and truncated idempotency indexes', async () => {
  const mutations: Array<(indexes: Metadata) => void> = [
    (rows) => { rows.splice(0, 1); },
    (rows) => { rows.find((row) => row.index_name === 'uq_evidence_attempt_idempotency')!.non_unique = 1; },
    (rows) => { rows.find((row) => row.index_name === 'uq_evidence_attempt_idempotency')!.column_name = 'manifest_id'; },
    (rows) => { rows.find((row) => row.index_name === 'uq_evidence_attempt_idempotency')!.seq_in_index = 2; },
    (rows) => { rows.find((row) => row.index_name === 'uq_evidence_attempt_idempotency')!.sub_part = 8; },
  ];
  for (const mutate of mutations) {
    const fixture = createFixture();
    mutate(fixture.indexes);
    await assert.rejects(verifyEvidenceSchema(fixtureQuery(fixture)), /MIGRATION_EVIDENCE_INDEX_INVALID/);
  }
});

test('schema verification rejects foreign keys and malformed provider metadata without repair', async () => {
  const fixture = createFixture();
  fixture.foreignKeys.push({ table_name: 'evidence_query_manifests' });
  await assert.rejects(verifyEvidenceSchema(fixtureQuery(fixture)), /MIGRATION_EVIDENCE_FOREIGN_KEY_FORBIDDEN/);
  await assert.rejects(verifyEvidenceSchema(async () => [null, []]), /MIGRATION_EVIDENCE_METADATA_INVALID/);
  await assert.rejects(verifyEvidenceSchema(async () => [[null], []]), /MIGRATION_EVIDENCE_METADATA_INVALID/);
});

test('schema verification requires the enforced state, availability and predicate CHECK clauses', async () => {
  for (const mutate of [
    (rows: Metadata) => { rows.pop(); },
    (rows: Metadata) => { rows[0].enforced = 'NO'; },
    (rows: Metadata) => { rows[0].check_clause = "state IN ('RUNNING', 'COMPLETED')"; },
  ]) {
    const fixture = createFixture();
    mutate(fixture.checks);
    await assert.rejects(verifyEvidenceSchema(fixtureQuery(fixture)), /MIGRATION_EVIDENCE_CHECK_INVALID/);
  }
  const fixture = createFixture();
  fixture.checks[0].check_clause = "(`state` in (_utf8mb4'RUNNING',_utf8mb4'COMPLETED',_utf8mb4'EVIDENCE_UNAVAILABLE',_utf8mb4'FAILED'))";
  await verifyEvidenceSchema(fixtureQuery(fixture));
});

function fixtureQuery(fixture: ReturnType<typeof createFixture>) {
  return async (sql: string): Promise<[unknown, unknown]> => {
    if (sql.includes('information_schema.columns')) return [fixture.columns, []];
    if (sql.includes('information_schema.statistics')) return [fixture.indexes, []];
    if (sql.includes('information_schema.table_constraints')) return [fixture.checks, []];
    if (sql.includes('information_schema.referential_constraints')) return [fixture.foreignKeys, []];
    throw new Error('UNEXPECTED_EVIDENCE_SCHEMA_QUERY');
  };
}

function createFixture(): { columns: Metadata; indexes: Metadata; checks: Metadata; foreignKeys: Metadata } {
  const columns: Metadata = [];
  const indexes: Metadata = [];
  const checks: Metadata = [];
  for (const table of EVIDENCE_TABLE_NAMES) {
    const definition = EVIDENCE_TABLE_DEFINITIONS[table];
    for (const [column, declaration] of Object.entries(definition.columns)) {
      const match = /^([A-Z]+)(?:\((\d+)\))?/.exec(declaration)!;
      columns.push({
        table_name: table,
        column_name: column,
        data_type: match[1].toLowerCase(),
        column_type: declaration.includes('UNSIGNED') ? `${match[1].toLowerCase()} unsigned` : match[1].toLowerCase(),
        is_nullable: declaration.includes('NOT NULL') ? 'NO' : 'YES',
        character_maximum_length: ['CHAR', 'VARCHAR'].includes(match[1]) ? Number(match[2]) : null,
        datetime_precision: match[1] === 'DATETIME' ? Number(match[2]) : null,
        column_default: declaration.includes('DEFAULT CURRENT_TIMESTAMP(3)')
          ? 'current_timestamp(3)' : declaration.endsWith('DEFAULT 1') ? '1' : null,
        extra: declaration.includes('AUTO_INCREMENT') ? 'auto_increment' : '',
      });
      if (declaration.includes('PRIMARY KEY')) {
        indexes.push({ table_name: table, index_name: 'PRIMARY', column_name: column, seq_in_index: 1, non_unique: 0, sub_part: null });
      }
    }
    for (const constraint of definition.constraints) {
      if (constraint.startsWith('CHECK ')) {
        checks.push({ table_name: table, enforced: 'YES', check_clause: constraint.slice(6) });
        continue;
      }
      const match = /^(UNIQUE KEY|INDEX) (\w+) \(([^)]+)\)$/.exec(constraint);
      if (!match) continue;
      match[3].split(',').forEach((column, index) => {
        indexes.push({
          table_name: table, index_name: match[2], column_name: column.trim(),
          seq_in_index: index + 1, non_unique: match[1] === 'UNIQUE KEY' ? 0 : 1,
          sub_part: null,
        });
      });
    }
  }
  return { columns, indexes, checks, foreignKeys: [] };
}
