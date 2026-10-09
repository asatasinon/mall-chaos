export const EVIDENCE_TABLE_NAMES = [
  'evidence_contract_snapshots',
  'evidence_query_manifests',
  'evidence_query_attempts',
  'evidence_query_attempt_items',
  'evidence_operator_notes',
] as const;

type EvidenceTableName = typeof EVIDENCE_TABLE_NAMES[number];
type SchemaQuery = (sql: string, values?: unknown[]) => Promise<[unknown, unknown]>;

interface EvidenceTableDefinition {
  readonly columns: Readonly<Record<string, string>>;
  readonly constraints: readonly string[];
}

export const EVIDENCE_TABLE_DEFINITIONS: Readonly<Record<EvidenceTableName, EvidenceTableDefinition>> = {
  evidence_contract_snapshots: {
    columns: {
      snapshot_id: 'CHAR(36) NOT NULL PRIMARY KEY',
      source_fault_run_id: 'CHAR(36) NOT NULL',
      scenario: 'VARCHAR(64) NOT NULL',
      contract_schema_version: 'VARCHAR(64) NOT NULL',
      contract_revision: 'VARCHAR(128) NOT NULL',
      contract_hash: 'CHAR(64) NOT NULL',
      contract_json: 'JSON NOT NULL',
      renderer_revision: 'VARCHAR(64) NOT NULL',
      evaluation_revision: 'VARCHAR(64) NOT NULL',
      rendered_plan_hash: 'CHAR(64) NOT NULL',
      rendered_plan_json: 'JSON NOT NULL',
      created_at: 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
    },
    constraints: [
      'UNIQUE KEY uq_evidence_contract_source_run (source_fault_run_id)',
      'INDEX idx_evidence_contract_scenario_revision (scenario, contract_revision)',
    ],
  },
  evidence_query_manifests: {
    columns: {
      manifest_id: 'CHAR(36) NOT NULL PRIMARY KEY',
      snapshot_id: 'CHAR(36) NOT NULL',
      source_fault_run_id: 'CHAR(36) NOT NULL',
      scenario: 'VARCHAR(64) NOT NULL',
      manifest_schema_version: 'VARCHAR(64) NOT NULL',
      contract_revision: 'VARCHAR(128) NOT NULL',
      manifest_revision: 'INT UNSIGNED NOT NULL',
      timeline_hash: 'CHAR(64) NOT NULL',
      manifest_hash: 'CHAR(64) NOT NULL',
      timeline_json: 'JSON NOT NULL',
      windows_json: 'JSON NOT NULL',
      recipes_json: 'JSON NOT NULL',
      limitations_json: 'JSON NOT NULL',
      source_run_retained: 'TINYINT NOT NULL DEFAULT 1',
      materialized_at: 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
    },
    constraints: [
      'UNIQUE KEY uq_evidence_manifest_source_timeline (source_fault_run_id, timeline_hash)',
      'UNIQUE KEY uq_evidence_manifest_source_revision (source_fault_run_id, manifest_revision)',
      'INDEX idx_evidence_manifest_source (source_fault_run_id, manifest_revision)',
      'INDEX idx_evidence_manifest_contract (contract_revision, materialized_at)',
    ],
  },
  evidence_query_attempts: {
    columns: {
      attempt_id: 'CHAR(36) NOT NULL PRIMARY KEY',
      manifest_id: 'CHAR(36) NOT NULL',
      source_fault_run_id: 'CHAR(36) NOT NULL',
      idempotency_key: 'VARCHAR(128) NOT NULL',
      request_hash: 'CHAR(64) NOT NULL',
      state: 'VARCHAR(32) NOT NULL',
      evidence_status: 'VARCHAR(32) NULL',
      operator_audit_id: 'BIGINT NULL',
      requested_at: 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
      deadline_at: 'DATETIME(3) NOT NULL',
      completed_at: 'DATETIME(3) NULL',
      total_duration_ms: 'INT UNSIGNED NULL',
      failure_code: 'VARCHAR(64) NULL',
    },
    constraints: [
      'UNIQUE KEY uq_evidence_attempt_idempotency (source_fault_run_id, idempotency_key)',
      'INDEX idx_evidence_attempt_manifest_time (manifest_id, requested_at)',
      'INDEX idx_evidence_attempt_run_deadline (source_fault_run_id, state, deadline_at)',
      "CHECK (state IN ('RUNNING', 'COMPLETED', 'EVIDENCE_UNAVAILABLE', 'FAILED'))",
      "CHECK (evidence_status IS NULL OR evidence_status IN ('AVAILABLE', 'PARTIAL', 'EVIDENCE_UNAVAILABLE', 'INVALID_QUERY'))",
    ],
  },
  evidence_query_attempt_items: {
    columns: {
      id: 'BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY',
      attempt_id: 'CHAR(36) NOT NULL',
      recipe_id: 'VARCHAR(96) NOT NULL',
      source: 'VARCHAR(24) NOT NULL',
      window_name: 'VARCHAR(24) NOT NULL',
      availability: 'VARCHAR(32) NOT NULL',
      coverage: 'VARCHAR(16) NOT NULL',
      predicate_outcome: 'VARCHAR(16) NOT NULL',
      reason_code: 'VARCHAR(64) NULL',
      duration_ms: 'INT UNSIGNED NULL',
      queried_at: 'DATETIME(3) NULL',
      executed_start_at: 'DATETIME(3) NULL',
      executed_end_at: 'DATETIME(3) NULL',
    },
    constraints: [
      'UNIQUE KEY uq_evidence_attempt_recipe_window (attempt_id, recipe_id, window_name)',
      'INDEX idx_evidence_attempt_item_attempt (attempt_id)',
      "CHECK (source IN ('RUN_EVENT', 'PROMETHEUS', 'LOKI', 'TEMPO', 'BUSINESS_CHECK', 'RESOURCE_CHECK'))",
      "CHECK (availability IN ('AVAILABLE', 'NO_DATA', 'EVIDENCE_UNAVAILABLE', 'INVALID_QUERY', 'NOT_APPLICABLE'))",
      "CHECK (coverage IN ('FULL', 'PARTIAL', 'NONE', 'NOT_APPLICABLE'))",
      "CHECK (predicate_outcome IN ('MET', 'NOT_MET', 'INCONCLUSIVE'))",
    ],
  },
  evidence_operator_notes: {
    columns: {
      note_id: 'CHAR(36) NOT NULL PRIMARY KEY',
      manifest_id: 'CHAR(36) NOT NULL',
      source_fault_run_id: 'CHAR(36) NOT NULL',
      idempotency_key: 'VARCHAR(128) NOT NULL',
      request_hash: 'CHAR(64) NOT NULL',
      operator_audit_id: 'BIGINT NOT NULL',
      note_text: 'VARCHAR(2048) NOT NULL',
      created_at: 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
    },
    constraints: [
      'UNIQUE KEY uq_evidence_note_audit (operator_audit_id)',
      'UNIQUE KEY uq_evidence_note_idempotency (source_fault_run_id, idempotency_key)',
      'INDEX idx_evidence_note_manifest_time (manifest_id, created_at, note_id)',
    ],
  },
};

export const EVIDENCE_SCHEMA_STATEMENTS = EVIDENCE_TABLE_NAMES.map((table) => {
  const definition = EVIDENCE_TABLE_DEFINITIONS[table];
  const fields = [
    ...Object.entries(definition.columns).map(([name, declaration]) => `${name} ${declaration}`),
    ...definition.constraints,
  ];
  return `CREATE TABLE IF NOT EXISTS ${table} (\n  ${fields.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
});

export async function verifyEvidenceSchema(query: SchemaQuery): Promise<void> {
  const placeholders = EVIDENCE_TABLE_NAMES.map(() => '?').join(', ');
  const [columnRows] = await query(
    `SELECT table_name AS table_name, column_name AS column_name,
            data_type AS data_type, column_type AS column_type,
            character_maximum_length AS character_maximum_length,
            is_nullable AS is_nullable, datetime_precision AS datetime_precision,
            column_default AS column_default, extra AS extra
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`,
    [...EVIDENCE_TABLE_NAMES],
  );
  const columns = readRows(columnRows);
  for (const table of EVIDENCE_TABLE_NAMES) {
    const definition = EVIDENCE_TABLE_DEFINITIONS[table];
    const found = columns.filter((row) => row.table_name === table);
    if (found.length !== Object.keys(definition.columns).length) {
      throw new Error(`MIGRATION_EVIDENCE_COLUMNS_INVALID:${table}`);
    }
    for (const [name, declaration] of Object.entries(definition.columns)) {
      const matches = found.filter((row) => row.column_name === name);
      if (matches.length !== 1 || !matchesColumn(matches[0], declaration)) {
        throw new Error(`MIGRATION_EVIDENCE_COLUMN_INVALID:${table}.${name}`);
      }
    }
  }
  const [indexRows] = await query(
    `SELECT table_name AS table_name, index_name AS index_name, column_name AS column_name,
            seq_in_index AS seq_in_index, non_unique AS non_unique, sub_part AS sub_part
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name IN (${placeholders})`,
    [...EVIDENCE_TABLE_NAMES],
  );
  const indexes = readRows(indexRows);
  for (const table of EVIDENCE_TABLE_NAMES) {
    const definition = EVIDENCE_TABLE_DEFINITIONS[table];
    const primaryColumns = Object.entries(definition.columns)
      .filter(([, declaration]) => declaration.includes('PRIMARY KEY'))
      .map(([name]) => name);
    verifyIndex(indexes, table, 'PRIMARY', primaryColumns, true);
    for (const constraint of definition.constraints) {
      const match = /^(UNIQUE KEY|INDEX) (\w+) \(([^)]+)\)$/.exec(constraint);
      if (!match) continue;
      verifyIndex(indexes, table, match[2], match[3].split(',').map((name) => name.trim()), match[1] === 'UNIQUE KEY');
    }
  }
  const [checkRows] = await query(
    `SELECT tc.table_name AS table_name, tc.enforced AS enforced, cc.check_clause AS check_clause
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.check_constraints AS cc
         ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
      WHERE tc.table_schema = DATABASE()
        AND tc.constraint_type = 'CHECK'
        AND tc.table_name IN (${placeholders})`,
    [...EVIDENCE_TABLE_NAMES],
  );
  const checks = readRows(checkRows);
  for (const table of EVIDENCE_TABLE_NAMES) {
    const expected = EVIDENCE_TABLE_DEFINITIONS[table].constraints
      .filter((constraint) => constraint.startsWith('CHECK '))
      .map((constraint) => normalizeCheckClause(constraint.slice(6)))
      .sort();
    const found = checks.filter((row) => row.table_name === table);
    const actual = found.map((row) => normalizeCheckClause(String(row.check_clause))).sort();
    if (found.some((row) => String(row.enforced).toUpperCase() !== 'YES')
      || actual.length !== expected.length
      || actual.some((clause, index) => clause !== expected[index])) {
      throw new Error(`MIGRATION_EVIDENCE_CHECK_INVALID:${table}`);
    }
  }
  const [foreignKeys] = await query(
    `SELECT table_name AS table_name FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name IN (${placeholders})`,
    [...EVIDENCE_TABLE_NAMES],
  );
  if (readRows(foreignKeys).length > 0) throw new Error('MIGRATION_EVIDENCE_FOREIGN_KEY_FORBIDDEN');
}

function normalizeCheckClause(value: string): string {
  return value.replace(/_utf8mb4\s*(?=')/gi, '').replace(/[\s`()]/g, '').toUpperCase();
}

function matchesColumn(row: Record<string, unknown>, declaration: string): boolean {
  const match = /^([A-Z]+)(?:\((\d+)\))?/.exec(declaration);
  if (!match || String(row.data_type).toUpperCase() !== match[1]) return false;
  if (String(row.is_nullable).toUpperCase() !== (declaration.includes('NOT NULL') ? 'NO' : 'YES')) return false;
  if (match[1] === 'CHAR' || match[1] === 'VARCHAR') {
    if (Number(row.character_maximum_length) !== Number(match[2])) return false;
  }
  if (match[1] === 'DATETIME' && Number(row.datetime_precision) !== Number(match[2])) return false;
  if (declaration.includes('DEFAULT CURRENT_TIMESTAMP(3)')
    && String(row.column_default).toLowerCase() !== 'current_timestamp(3)') return false;
  if (declaration.endsWith('DEFAULT 1') && String(row.column_default) !== '1') return false;
  if (/\bunsigned\b/i.test(String(row.column_type)) !== declaration.includes('UNSIGNED')) return false;
  return /\bauto_increment\b/i.test(String(row.extra)) === declaration.includes('AUTO_INCREMENT');
}

function verifyIndex(
  rows: Record<string, unknown>[],
  table: EvidenceTableName,
  name: string,
  columns: string[],
  unique: boolean,
): void {
  const found = rows.filter((row) => row.table_name === table && row.index_name === name)
    .sort((left, right) => Number(left.seq_in_index) - Number(right.seq_in_index));
  if (found.length !== columns.length || found.some((row, index) =>
    row.column_name !== columns[index]
    || Number(row.seq_in_index) !== index + 1
    || row.sub_part !== null
    || Number(row.non_unique) !== (unique ? 0 : 1))) {
    throw new Error(`MIGRATION_EVIDENCE_INDEX_INVALID:${table}.${name}`);
  }
}

function readRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((row) =>
    row === null || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('MIGRATION_EVIDENCE_METADATA_INVALID');
  }
  return value;
}
