import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  migrationChecksum,
  splitSqlStatements,
  verifyFaultRunContractRevisionColumn,
  type MigrationSchemaQuery,
} from './run';
import { SCHEMA_STATEMENTS } from '../fault-run-schema';

test('migration statement splitter preserves executable SQL and drops comment-only fragments', () => {
  assert.deepEqual(
    splitSqlStatements(`
      -- migration comment
      CREATE TABLE example (id INT);

      -- another comment
      INSERT INTO example (id) VALUES (1);
    `),
    [
      '-- migration comment\n      CREATE TABLE example (id INT)',
      '-- another comment\n      INSERT INTO example (id) VALUES (1)',
    ],
  );
});

test('migration checksum is stable for equivalent line endings and changes with content', () => {
  assert.equal(migrationChecksum('CREATE TABLE example (id INT);\r\n'), migrationChecksum('CREATE TABLE example (id INT);\n'));
  assert.notEqual(
    migrationChecksum('CREATE TABLE example (id INT);'),
    migrationChecksum('CREATE TABLE example (id BIGINT);'),
  );
});

test('fresh Fault Run schemas agree on the required contract revision column', async () => {
  const runtimeSchema = SCHEMA_STATEMENTS.find((statement) =>
    statement.includes('CREATE TABLE IF NOT EXISTS fault_runs'));
  assert.ok(runtimeSchema);

  const [migrationSchema, mysqlInitSchema] = await Promise.all([
    readFile(new URL('./001-fault-runs.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../../../infra/mysql/init/04-fault-run-schema.sql', import.meta.url), 'utf8'),
  ]);
  const definitions = [runtimeSchema, migrationSchema, mysqlInitSchema].map((schema) => {
    const match = schema.match(/^\s*contract_revision\s+([^,\n]+)\s*,?\s*$/im);
    assert.ok(match, 'fresh schema must define contract_revision');
    return match[1]?.trim().replace(/\s+/g, ' ').toUpperCase();
  });

  assert.deepEqual(definitions, [
    'VARCHAR(128) NOT NULL',
    'VARCHAR(128) NOT NULL',
    'VARCHAR(128) NOT NULL',
  ]);
});

test('db verification accepts only a required VARCHAR(128) contract revision column', async () => {
  let queryText = '';
  let queryValues: unknown[] | undefined;
  const query: MigrationSchemaQuery = async (sql, values) => {
    queryText = sql;
    queryValues = values;
    return [[{
      data_type: 'varchar',
      character_maximum_length: 128,
      is_nullable: 'NO',
    }], []];
  };

  await verifyFaultRunContractRevisionColumn(query);

  assert.match(queryText, /information_schema\.columns/);
  assert.deepEqual(queryValues, ['fault_runs', 'contract_revision']);
});

test('db verification fails fast for a missing, nullable, or incompatible revision column', async () => {
  const invalidColumns: unknown[][] = [
    [],
    [{ data_type: 'varchar', character_maximum_length: 128, is_nullable: 'YES' }],
    [{ data_type: 'varchar', character_maximum_length: 127, is_nullable: 'NO' }],
    [{ data_type: 'char', character_maximum_length: 128, is_nullable: 'NO' }],
    [{ data_type: 'varchar', character_maximum_length: 128, is_nullable: 'NO' },
      { data_type: 'varchar', character_maximum_length: 128, is_nullable: 'NO' }],
  ];

  for (const rows of invalidColumns) {
    const query: MigrationSchemaQuery = async () => [rows, []];
    await assert.rejects(
      verifyFaultRunContractRevisionColumn(query),
      /MIGRATION_REQUIRED_COLUMN_INVALID:fault_runs\.contract_revision/,
    );
  }
});
