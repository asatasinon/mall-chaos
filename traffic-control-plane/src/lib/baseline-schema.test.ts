import assert from 'node:assert/strict';
import test from 'node:test';
import { BASELINE_SCHEMA_STATEMENTS } from './baseline-schema';

test('keeps baseline summaries independent from Fault Run retention', () => {
  const ddl = BASELINE_SCHEMA_STATEMENTS.join('\n');

  assert.doesNotMatch(ddl, /\bREFERENCES\s+fault_runs\b/i);
  assert.doesNotMatch(ddl, /\bON\s+DELETE\s+CASCADE\b/i);
  assert.match(ddl, /UNIQUE KEY uq_baseline_source_run \(source_fault_run_id\)/);
  assert.match(ddl, /retention_snapshot\s+JSON\s+NOT NULL/);
  assert.match(ddl, /observation_summary_json\s+JSON\s+NOT NULL/);
});
