import { getPool } from './db';

export const DATA_WARMUP_CONFIG_ID = 1 as const;
export const DATA_WARMUP_CONFIG_SCHEMA_REVISION = 'warmup-config.v1' as const;

export const DATA_WARMUP_CONFIG_LIMITS = {
  maxWindowDays: 365,
  maxRowsPerDay: 1_000_000,
  maxBatchSize: 5_000,
  maxBatchIntervalMs: 60_000,
  maxConcurrency: 4,
} as const;

export interface DataWarmupConfig {
  enabled: boolean;
  windowDays: number;
  rowsPerDay: number;
  targetRows: number;
  batchSize: number;
  batchIntervalMs: number;
  maxConcurrency: number;
  dbConcurrency: number;
  version: number;
  updatedByOperatorId: number | null;
  updatedAt: string;
}

export interface DataWarmupConfigUpdate {
  version: number;
  windowDays?: number;
  rowsPerDay?: number;
  targetRows?: number;
  batchSize?: number;
  batchIntervalMs?: number;
  maxConcurrency?: number;
  dbConcurrency?: number;
}

export interface DataWarmupEnabledUpdate {
  version: number;
  enabled: boolean;
}

const CONFIG_UPDATE_FIELDS = new Set([
  'version',
  'windowDays',
  'rowsPerDay',
  'targetRows',
  'batchSize',
  'batchIntervalMs',
  'maxConcurrency',
  'dbConcurrency',
]);

const CONFIG_TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS data_warmup_config (
  config_id             TINYINT      NOT NULL PRIMARY KEY,
  enabled               TINYINT      NOT NULL,
  window_days           INT          NOT NULL,
  rows_per_day          INT          NOT NULL,
  target_rows           BIGINT       NOT NULL,
  batch_size            INT          NOT NULL,
  batch_interval_ms     INT          NOT NULL,
  max_concurrency       TINYINT      NOT NULL,
  db_concurrency        TINYINT      NOT NULL,
  version               BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_operator_id BIGINT      NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CHECK (config_id = 1),
  CHECK (enabled IN (0, 1)),
  CHECK (window_days BETWEEN 1 AND 365),
  CHECK (rows_per_day BETWEEN 1 AND 1000000),
  CHECK (target_rows = window_days * rows_per_day),
  CHECK (batch_size BETWEEN 1 AND 5000),
  CHECK (batch_interval_ms BETWEEN 0 AND 60000),
  CHECK (max_concurrency BETWEEN 1 AND 4),
  CHECK (db_concurrency BETWEEN 1 AND 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

let schemaPromise: Promise<void> | null = null;

export function ensureDataWarmupConfigSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = getPool().query(CONFIG_TABLE_STATEMENT).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function loadDataWarmupConfig(): Promise<DataWarmupConfig> {
  await ensureDataWarmupConfigSchema();
  const pool = getPool();
  const selectConfig = async (): Promise<DataWarmupConfig | null> => {
    const [rows] = await pool.query(
      `SELECT enabled, window_days, rows_per_day, target_rows, batch_size,
              batch_interval_ms, max_concurrency, db_concurrency, version,
              updated_by_operator_id, updated_at
         FROM data_warmup_config
        WHERE config_id = 1`,
    );
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return null;
    const config = toDataWarmupConfig(row);
    validateDataWarmupConfig(config);
    return config;
  };
  const existing = await selectConfig();
  if (existing) return existing;

  const defaults = getDataWarmupBootstrapConfig();
  await pool.execute(
    `INSERT IGNORE INTO data_warmup_config
      (config_id, enabled, window_days, rows_per_day, target_rows, batch_size,
       batch_interval_ms, max_concurrency, db_concurrency)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      defaults.enabled ? 1 : 0,
      defaults.windowDays,
      defaults.rowsPerDay,
      defaults.targetRows,
      defaults.batchSize,
      defaults.batchIntervalMs,
      defaults.maxConcurrency,
      defaults.dbConcurrency,
    ],
  );
  const initialized = await selectConfig();
  if (!initialized) throw new Error('DATA_WARMUP_CONFIG_NOT_FOUND');
  return initialized;
}

export async function updateDataWarmupConfig(
  input: DataWarmupConfigUpdate,
  updatedByOperatorId: number | null,
): Promise<DataWarmupConfig> {
  const current = await loadDataWarmupConfig();
  validateDataWarmupConfigUpdate(input, current);
  const next = {
    enabled: current.enabled,
    windowDays: input.windowDays ?? current.windowDays,
    rowsPerDay: input.rowsPerDay ?? current.rowsPerDay,
    targetRows: input.targetRows ?? current.targetRows,
    batchSize: input.batchSize ?? current.batchSize,
    batchIntervalMs: input.batchIntervalMs ?? current.batchIntervalMs,
    maxConcurrency: input.maxConcurrency ?? current.maxConcurrency,
    dbConcurrency: input.dbConcurrency ?? current.dbConcurrency,
  };
  validateDataWarmupConfig(next);

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE data_warmup_config
          SET enabled = ?, window_days = ?, rows_per_day = ?, target_rows = ?,
              batch_size = ?, batch_interval_ms = ?, max_concurrency = ?,
              db_concurrency = ?, updated_by_operator_id = ?, version = version + 1
        WHERE config_id = 1 AND version = ?`,
      [
        next.enabled ? 1 : 0,
        next.windowDays,
        next.rowsPerDay,
        next.targetRows,
        next.batchSize,
        next.batchIntervalMs,
        next.maxConcurrency,
        next.dbConcurrency,
        updatedByOperatorId,
        input.version,
      ],
    );
    if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
      throw new Error('VERSION_CONFLICT');
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return loadDataWarmupConfig();
}

export async function updateDataWarmupEnabled(
  input: DataWarmupEnabledUpdate,
  updatedByOperatorId: number | null,
): Promise<DataWarmupConfig> {
  validateDataWarmupEnabledUpdate(input);
  await loadDataWarmupConfig();

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE data_warmup_config
          SET enabled = ?, updated_by_operator_id = ?, version = version + 1
        WHERE config_id = 1 AND version = ?`,
      [input.enabled ? 1 : 0, updatedByOperatorId, input.version],
    );
    if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
      throw new Error('VERSION_CONFLICT');
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return loadDataWarmupConfig();
}

export function getDataWarmupBootstrapConfig(): Omit<DataWarmupConfig, 'version' | 'updatedByOperatorId' | 'updatedAt'> {
  const config = {
    enabled: readBooleanEnvironment('DATA_WARMUP_ENABLED', true),
    windowDays: readIntegerEnvironment('DATA_WARMUP_WINDOW_DAYS', 180),
    rowsPerDay: readIntegerEnvironment('DATA_WARMUP_ROWS_PER_DAY', 300_000),
    targetRows: readIntegerEnvironment('DATA_WARMUP_TARGET_ROWS', 54_000_000),
    batchSize: readIntegerEnvironment('DATA_WARMUP_BATCH_SIZE', 1_000),
    batchIntervalMs: readIntegerEnvironment('DATA_WARMUP_BATCH_INTERVAL_MS', 1_000),
    maxConcurrency: readIntegerEnvironment('DATA_WARMUP_MAX_CONCURRENCY', 2),
    dbConcurrency: readIntegerEnvironment('DATA_WARMUP_DB_CONCURRENCY', 2),
  };
  validateDataWarmupConfig(config);
  return config;
}

export function validateDataWarmupConfig(
  config: Pick<DataWarmupConfig, 'enabled' | 'windowDays' | 'rowsPerDay' | 'targetRows'
    | 'batchSize' | 'batchIntervalMs' | 'maxConcurrency' | 'dbConcurrency'>,
): void {
  if (typeof config.enabled !== 'boolean'
      || !Number.isInteger(config.windowDays)
      || config.windowDays < 1
      || config.windowDays > DATA_WARMUP_CONFIG_LIMITS.maxWindowDays
      || !Number.isInteger(config.rowsPerDay)
      || config.rowsPerDay < 1
      || config.rowsPerDay > DATA_WARMUP_CONFIG_LIMITS.maxRowsPerDay
      || !Number.isInteger(config.targetRows)
      || config.targetRows !== config.windowDays * config.rowsPerDay
      || !Number.isInteger(config.batchSize)
      || config.batchSize < 1
      || config.batchSize > DATA_WARMUP_CONFIG_LIMITS.maxBatchSize
      || !Number.isInteger(config.batchIntervalMs)
      || config.batchIntervalMs < 0
      || config.batchIntervalMs > DATA_WARMUP_CONFIG_LIMITS.maxBatchIntervalMs
      || !Number.isInteger(config.maxConcurrency)
      || config.maxConcurrency < 1
      || config.maxConcurrency > DATA_WARMUP_CONFIG_LIMITS.maxConcurrency
      || !Number.isInteger(config.dbConcurrency)
      || config.dbConcurrency < 1
      || config.dbConcurrency > DATA_WARMUP_CONFIG_LIMITS.maxConcurrency) {
    throw new Error('INVALID_DATA_WARMUP_CONFIGURATION');
  }
}

export function validateDataWarmupConfigUpdate(
  input: DataWarmupConfigUpdate,
  current: DataWarmupConfig,
): void {
  if (Object.keys(input).some((key) => !CONFIG_UPDATE_FIELDS.has(key))
      || !Number.isInteger(input.version)
      || input.version < 1) {
    throw new Error('INVALID_DATA_WARMUP_CONFIGURATION');
  }
  const next = {
    enabled: current.enabled,
    windowDays: input.windowDays ?? current.windowDays,
    rowsPerDay: input.rowsPerDay ?? current.rowsPerDay,
    targetRows: input.targetRows ?? current.targetRows,
    batchSize: input.batchSize ?? current.batchSize,
    batchIntervalMs: input.batchIntervalMs ?? current.batchIntervalMs,
    maxConcurrency: input.maxConcurrency ?? current.maxConcurrency,
    dbConcurrency: input.dbConcurrency ?? current.dbConcurrency,
  };
  validateDataWarmupConfig(next);
}

export function validateDataWarmupEnabledUpdate(input: DataWarmupEnabledUpdate): void {
  if (!Number.isInteger(input.version) || input.version < 1 || typeof input.enabled !== 'boolean') {
    throw new Error('INVALID_DATA_WARMUP_CONFIGURATION');
  }
}

export const DATA_WARMUP_CONFIG_STATEMENTS = [CONFIG_TABLE_STATEMENT] as const;

function readBooleanEnvironment(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('INVALID_DATA_WARMUP_CONFIGURATION');
}

function readIntegerEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error('INVALID_DATA_WARMUP_CONFIGURATION');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('INVALID_DATA_WARMUP_CONFIGURATION');
  return parsed;
}

function toDataWarmupConfig(row: Record<string, unknown>): DataWarmupConfig {
  const config = {
    enabled: Number(row.enabled) === 1,
    windowDays: Number(row.window_days),
    rowsPerDay: Number(row.rows_per_day),
    targetRows: Number(row.target_rows),
    batchSize: Number(row.batch_size),
    batchIntervalMs: Number(row.batch_interval_ms),
    maxConcurrency: Number(row.max_concurrency),
    dbConcurrency: Number(row.db_concurrency),
  };
  validateDataWarmupConfig(config);
  return {
    ...config,
    version: Number(row.version),
    updatedByOperatorId: row.updated_by_operator_id === null || row.updated_by_operator_id === undefined
      ? null : Number(row.updated_by_operator_id),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
