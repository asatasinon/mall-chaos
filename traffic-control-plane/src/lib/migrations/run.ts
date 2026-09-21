import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool } from '../db';

const MIGRATION_LOCK = 'castrel:traffic-control-plane:migrations';
const HISTORY_TABLE = 'traffic_control_plane_schema_migrations';
const MIGRATION_APPLIER = 'traffic-control-plane';

const MIGRATION_FILES = [
  '001-fault-runs.sql',
  '002-fault-run-baseline.sql',
  '003-data-warmup-config.sql',
  '004-alert-receipts.sql',
  '005-fault-run-worker-ownership.sql',
] as const;

const REQUIRED_TABLES = [
  'fault_run_sequence',
  'fault_runs',
  'fault_run_events',
  'scenario_baselines',
  'baseline_pilot_reviews',
  'data_warmup_config',
  'alert_receipts',
  'fault_run_executions',
  'fault_run_actions',
] as const;

export interface MigrationResult {
  applied: string[];
  verified: string[];
}

interface MigrationHistoryRow {
  migration_id: string;
  checksum: string;
}

interface MigrationConnection {
  query: (sql: string, values?: unknown[]) => Promise<[unknown, unknown]>;
}

export async function applyMigrations(): Promise<MigrationResult> {
  const connection = await getPool().getConnection();
  let lockAcquired = false;
  try {
    await ensureHistoryTable(connection);
    lockAcquired = await acquireLock(connection);
    if (!lockAcquired) throw new Error('MIGRATION_LOCK_TIMEOUT');

    const applied: string[] = [];
    const verified: string[] = [];
    for (const fileName of MIGRATION_FILES) {
      const migration = await loadMigration(fileName);
      const existing = await loadHistory(connection, migration.id);
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.id}`);
        }
        verified.push(migration.id);
        continue;
      }

      for (const statement of splitSqlStatements(migration.sql)) {
        await connection.query(statement);
      }
      await connection.query(
        `INSERT INTO ${HISTORY_TABLE} (migration_id, checksum, applied_by)
         VALUES (?, ?, ?)`,
        [migration.id, migration.checksum, MIGRATION_APPLIER],
      );
      applied.push(migration.id);
    }

    await verifyRequiredTables(connection);
    return { applied, verified };
  } finally {
    if (lockAcquired) await releaseLock(connection);
    connection.release();
  }
}

export async function verifyMigrations(): Promise<MigrationResult> {
  const connection = await getPool().getConnection();
  try {
    const history = await loadAllHistory(connection);
    const verified: string[] = [];
    for (const fileName of MIGRATION_FILES) {
      const migration = await loadMigration(fileName);
      const existing = history.get(migration.id);
      if (!existing) throw new Error(`MIGRATION_NOT_APPLIED:${migration.id}`);
      if (existing !== migration.checksum) {
        throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.id}`);
      }
      verified.push(migration.id);
    }
    await verifyRequiredTables(connection);
    return { applied: [], verified };
  } finally {
    connection.release();
  }
}

export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.split('\n').every((line) => line.trim().startsWith('--')));
}

export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(normalizeSql(sql)).digest('hex');
}

async function loadMigration(fileName: string): Promise<{ id: string; sql: string; checksum: string }> {
  const sql = await readFile(new URL(`./${fileName}`, import.meta.url), 'utf8');
  return {
    id: fileName.replace(/\.sql$/, ''),
    sql,
    checksum: migrationChecksum(sql),
  };
}

async function ensureHistoryTable(connection: MigrationConnection): Promise<void> {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
      migration_id VARCHAR(128) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      applied_by VARCHAR(128) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

async function acquireLock(connection: MigrationConnection): Promise<boolean> {
  const [rows] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [MIGRATION_LOCK]);
  const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined;
  return Number(row?.acquired) === 1;
}

async function releaseLock(connection: MigrationConnection): Promise<void> {
  await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK]);
}

async function loadHistory(
  connection: MigrationConnection,
  migrationId: string,
): Promise<MigrationHistoryRow | null> {
  const [rows] = await connection.query(
    `SELECT migration_id, checksum FROM ${HISTORY_TABLE} WHERE migration_id = ?`,
    [migrationId],
  );
  const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined;
  return row
    ? { migration_id: String(row.migration_id), checksum: String(row.checksum) }
    : null;
}

async function loadAllHistory(
  connection: MigrationConnection,
): Promise<Map<string, string>> {
  let rows: unknown;
  try {
    [rows] = await connection.query(
      `SELECT migration_id, checksum FROM ${HISTORY_TABLE}`,
    );
  } catch (error) {
    if (isMissingTableError(error)) throw new Error('MIGRATION_HISTORY_MISSING');
    throw error;
  }
  const history = new Map<string, string>();
  if (!Array.isArray(rows)) return history;
  for (const raw of rows as Record<string, unknown>[]) {
    history.set(String(raw.migration_id), String(raw.checksum));
  }
  return history;
}

async function verifyRequiredTables(
  connection: MigrationConnection,
): Promise<void> {
  const [rows] = await connection.query(
    `SELECT table_name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN (${REQUIRED_TABLES.map(() => '?').join(', ')})`,
    [...REQUIRED_TABLES],
  );
  const found = new Set(
    Array.isArray(rows)
      ? (rows as Record<string, unknown>[]).map((row) =>
        String(row.table_name ?? row.TABLE_NAME))
      : [],
  );
  const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
  if (missing.length > 0) throw new Error(`MIGRATION_REQUIRED_TABLE_MISSING:${missing.join(',')}`);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\r\n/g, '\n').trim() + '\n';
}

function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ER_NO_SUCH_TABLE';
}
