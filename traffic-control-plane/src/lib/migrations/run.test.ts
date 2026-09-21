import assert from 'node:assert/strict';
import test from 'node:test';
import { migrationChecksum, splitSqlStatements } from './run';

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
