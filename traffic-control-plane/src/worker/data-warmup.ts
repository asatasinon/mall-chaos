import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { getPool } from '../lib/db';
import { getRedis } from '../lib/redis';
import { env } from '../lib/env';

const log = pino({ name: 'data-warmup' });
const LEASE_KEY = 'traffic-control-plane:data-warmup:lease';
const LEASE_TTL_SEC = 30;
const TABLES = [
  { name: 'product_price_history', timeColumn: 'effective_at' },
  { name: 'user_behavior_log', timeColumn: 'created_at' },
] as const;
const SKUS = Array.from({ length: 50 }, (_, index) => `SKU-${String(index + 1).padStart(3, '0')}`);

type WarmupStatus = 'BACKFILLING' | 'APPENDING' | 'ROLLOVER_CLEANUP' | 'PAUSED_GUARD' | 'ERROR' | 'DISABLED';

export interface WarmupProgress {
  tableName: string;
  status: WarmupStatus;
  targetRows: number;
  actualRows: number;
  currentDate: string;
  dayTargetRows: number;
  dayCompletedRows: number;
  rowsPerSec: number;
  currentDateRows: number;
  earliestTime: string | null;
  latestTime: string | null;
  tableBytes: number;
  partitions: string[];
  expiredPartitionsDropped: number;
  leaseOwner: string | null;
  guardReason: string | null;
  lastSuccessAt: string | null;
  updatedAt: string;
}

export class DataWarmupService {
  private readonly owner = randomUUID();
  private started = false;
  private stopped = false;
  private leaseHeld = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    void this.runLoop();
  }

  stop(): void {
    this.stopped = true;
    void this.releaseLease();
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      if (!env.DATA_WARMUP_ENABLED) {
        await updateWarmupStatuses('DISABLED', 'DATA_WARMUP_ENABLED=false');
        return;
      }
      try {
        validateWarmupConfiguration();
        await ensureProgressTable();
        if (!(await acquireLease(this.owner))) {
          await clearWarmupLeaseOwners();
          await sleep(Math.max(env.DATA_WARMUP_BATCH_INTERVAL_MS, 1000));
          continue;
        }
        this.leaseHeld = true;
        currentLeaseOwner = this.owner;
        if (!(await renewLease(this.owner))) throw new Error('DATA_WARMUP_LEASE_LOST');
        for (const table of TABLES) {
          await this.processTable(table);
        }
        if (!(await renewLease(this.owner))) throw new Error('DATA_WARMUP_LEASE_LOST');
        await sleep(Math.max(env.DATA_WARMUP_BATCH_INTERVAL_MS, 1000));
      } catch (error) {
        log.error({ error }, 'Data warmup iteration failed');
        await updateWarmupStatuses('ERROR', error instanceof Error ? error.message : String(error));
        await sleep(Math.min(Math.max(env.DATA_WARMUP_BATCH_INTERVAL_MS, 1000) * 5, 30_000));
      }
    }
    await this.releaseLease();
  }

  private async processTable(table: typeof TABLES[number]): Promise<void> {
    const today = todayInShanghai();
    await ensureCurrentPartition(table, today);
    const windowStart = addDays(today, -(env.DATA_WARMUP_WINDOW_DAYS - 1));
    const missingDays = await findMissingDays(table, windowStart, today);
    if (missingDays.length > 0) {
      await setWarmupStatus(table.name, 'BACKFILLING', null);
      for (const date of missingDays) {
        if (await fillDate(table, date)) return;
      }
    }
    const currentRows = await countDateRows(table, today);
    if (currentRows < env.DATA_WARMUP_ROWS_PER_DAY) {
      const [tableRows] = await getPool().query(
        `SELECT data_length + index_length AS table_bytes FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
        [table.name],
      );
      const guardReason = await capacityGuard(table.name, Number((tableRows as Record<string, unknown>[])[0]?.table_bytes ?? 0));
      if (guardReason) {
        await setWarmupStatus(table.name, 'PAUSED_GUARD', guardReason);
        return;
      }
      await setWarmupStatus(table.name, 'APPENDING', null);
      if (await fillDate(table, today)) return;
    }
    await setWarmupStatus(table.name, 'ROLLOVER_CLEANUP', null);
    await dropExpiredPartition(table, windowStart);
    await refreshProgress(table, today, null);
  }

  private async releaseLease(): Promise<void> {
    if (!this.leaseHeld) return;
    const redis = getRedis();
    await redis.connect().catch(() => undefined);
    await redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      LEASE_KEY,
      this.owner,
    ).catch(() => undefined);
    this.leaseHeld = false;
    currentLeaseOwner = null;
  }
}

export async function loadWarmupProgress(): Promise<WarmupProgress[]> {
  await ensureProgressTable();
  const [rows] = await getPool().query(
    `SELECT table_name, status, target_rows, actual_rows, current_date_value,
            day_target_rows, day_completed_rows, rows_per_sec, current_date_rows,
            earliest_time, latest_time, table_bytes, expired_partitions_dropped,
            lease_owner, guard_reason, last_success_at, updated_at
       FROM data_warmup_progress ORDER BY table_name`,
  );
  const progressRows = rows as Record<string, unknown>[];
  const partitionsByTable = new Map<string, string[]>();
  for (const table of TABLES) {
    const [partitionRows] = await getPool().query(
      `SELECT partition_name FROM information_schema.partitions
        WHERE table_schema = DATABASE() AND table_name = ? AND partition_name IS NOT NULL
        ORDER BY partition_ordinal_position`,
      [table.name],
    );
    partitionsByTable.set(table.name, (partitionRows as Record<string, unknown>[])
      .map((row) => String(row.partition_name)));
  }
  return progressRows.map((row) => toProgress(row, partitionsByTable.get(String(row.table_name)) ?? []));
}

async function fillDate(table: typeof TABLES[number], date: string): Promise<boolean> {
  let completed = await countDateRows(table, date);
  if (completed >= env.DATA_WARMUP_ROWS_PER_DAY) {
    await refreshProgress(table, date, null);
    return false;
  }
  const startedAt = Date.now();
  while (completed < env.DATA_WARMUP_ROWS_PER_DAY) {
    const guardReason = await capacityGuard(table.name, await getTableBytes(table.name));
    if (guardReason) {
      await setWarmupStatus(table.name, 'PAUSED_GUARD', guardReason);
      return true;
    }
    const batchSize = Math.min(env.DATA_WARMUP_BATCH_SIZE, env.DATA_WARMUP_ROWS_PER_DAY - completed);
    const values: Array<string | number | Date> = [];
    const placeholders: string[] = [];
    for (let index = 0; index < batchSize; index++) {
      const timestamp = dateTimeInDay(date, index, batchSize);
      if (table.name === 'product_price_history') {
        const sku = SKUS[(completed + index) % SKUS.length];
        const previous = round2(29 + ((completed + index) % 2970));
        const current = round2(previous * (((completed + index) % 20 < 10) ? 0.9 : 1.1));
        placeholders.push('(?,?,?,?,?,?)');
        values.push(sku, previous, current, 'WARMUP', ((completed + index) % 20) + 1, timestamp);
      } else {
        const indexValue = completed + index;
        const isPageView = indexValue % 10 < 7;
        const actionType = isPageView ? 'PAGE_VIEW' : indexValue % 10 < 9 ? 'ADD_CART' : 'PLACE_ORDER';
        const targetType = isPageView || actionType === 'ADD_CART' ? 'PRODUCT' : 'ORDER';
        const targetId = targetType === 'PRODUCT' ? SKUS[indexValue % SKUS.length] : `ORD-WARM-${date.replaceAll('-', '')}-${indexValue}`;
        placeholders.push('(?,?,?,?,?,?,?)');
        values.push((indexValue % 18) + 1, actionType, targetId, targetType,
          `10.0.${indexValue % 256}.${(indexValue % 254) + 1}`, `warm-${date}-${indexValue}`, timestamp);
      }
    }
    const sql = table.name === 'product_price_history'
      ? `INSERT INTO product_price_history (sku, previous_price, current_price, change_reason, operator_id, effective_at) VALUES ${placeholders.join(',')}`
      : `INSERT INTO user_behavior_log (user_id, action_type, target_id, target_type, ip_address, session_id, created_at) VALUES ${placeholders.join(',')}`;
    await getPool().query(sql, values);
    completed += batchSize;
    if (!(await renewLease(currentLeaseOwner ?? ''))) throw new Error('DATA_WARMUP_LEASE_LOST');
    const elapsed = Math.max(1, Date.now() - startedAt);
    await setWarmupStatus(table.name, 'APPENDING', null, {
      currentDate: date,
      dayCompletedRows: completed,
      rowsPerSec: Math.round(completed * 1000 / elapsed),
    });
    await sleep(env.DATA_WARMUP_BATCH_INTERVAL_MS);
  }
  await refreshProgress(table, date, new Date());
  return false;
}

async function ensureCurrentPartition(table: typeof TABLES[number], date: string): Promise<void> {
  const partitionName = `p${date.replaceAll('-', '')}`;
  const [rows] = await getPool().query(
    `SELECT partition_name FROM information_schema.partitions
      WHERE table_schema = DATABASE() AND table_name = ? AND partition_name = ?`,
    [table.name, partitionName],
  );
  if ((rows as unknown[]).length > 0) return;
  const nextDate = addDays(date, 1);
  await getPool().query(
    `ALTER TABLE ${table.name} ADD PARTITION (PARTITION ${partitionName} VALUES LESS THAN ('${nextDate}'))`,
  );
}

async function dropExpiredPartition(table: typeof TABLES[number], windowStart: string): Promise<void> {
  const expiredDate = addDays(windowStart, -1);
  const partitionName = `p${expiredDate.replaceAll('-', '')}`;
  const [rows] = await getPool().query(
    `SELECT partition_name FROM information_schema.partitions
      WHERE table_schema = DATABASE() AND table_name = ? AND partition_name = ?`,
    [table.name, partitionName],
  );
  if ((rows as unknown[]).length === 0) return;
  await getPool().query(`ALTER TABLE ${table.name} DROP PARTITION ${partitionName}`);
  await getPool().query(
    `UPDATE data_warmup_progress SET expired_partitions_dropped = expired_partitions_dropped + 1 WHERE table_name = ?`,
    [table.name],
  );
}

async function findMissingDays(table: typeof TABLES[number], start: string, end: string): Promise<string[]> {
  const [rows] = await getPool().query(
    `SELECT DATE(${table.timeColumn}) AS day_value, COUNT(*) AS row_count
       FROM ${table.name} WHERE ${table.timeColumn} >= ? AND ${table.timeColumn} < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY DATE(${table.timeColumn})`,
    [start, end],
  );
  const counts = new Map((rows as Record<string, unknown>[]).map((row) => [String(row.day_value).slice(0, 10), Number(row.row_count)]));
  const missing: string[] = [];
  for (let index = 0; index < env.DATA_WARMUP_WINDOW_DAYS; index++) {
    const date = addDays(start, index);
    if ((counts.get(date) ?? 0) < env.DATA_WARMUP_ROWS_PER_DAY) missing.push(date);
  }
  return missing;
}

async function countDateRows(table: typeof TABLES[number], date: string): Promise<number> {
  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS row_count FROM ${table.name} WHERE ${table.timeColumn} >= ? AND ${table.timeColumn} < DATE_ADD(?, INTERVAL 1 DAY)`,
    [date, date],
  );
  return Number((rows as Record<string, unknown>[])[0]?.row_count ?? 0);
}

async function ensureProgressTable(): Promise<void> {
  await getPool().query(`CREATE TABLE IF NOT EXISTS data_warmup_progress (
    table_name VARCHAR(64) NOT NULL PRIMARY KEY,
    status VARCHAR(32) NOT NULL,
    target_rows BIGINT NOT NULL,
    actual_rows BIGINT NOT NULL DEFAULT 0,
    current_date_value DATE NOT NULL,
    day_target_rows BIGINT NOT NULL,
    day_completed_rows BIGINT NOT NULL DEFAULT 0,
    rows_per_sec BIGINT NOT NULL DEFAULT 0,
    current_date_rows BIGINT NOT NULL DEFAULT 0,
    earliest_time DATETIME NULL,
    latest_time DATETIME NULL,
    table_bytes BIGINT NOT NULL DEFAULT 0,
    expired_partitions_dropped INT NOT NULL DEFAULT 0,
    lease_owner VARCHAR(64) NULL,
    guard_reason VARCHAR(255) NULL,
    last_success_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const today = todayInShanghai();
  for (const table of TABLES) {
    await getPool().query(
      `INSERT IGNORE INTO data_warmup_progress (table_name, status, target_rows, current_date_value, day_target_rows) VALUES (?, 'BACKFILLING', ?, ?, ?)`,
      [table.name, env.DATA_WARMUP_TARGET_ROWS, today, env.DATA_WARMUP_ROWS_PER_DAY],
    );
  }
}

async function setWarmupStatus(tableName: string, status: WarmupStatus, guardReason: string | null,
                               patch: { currentDate?: string; dayCompletedRows?: number; rowsPerSec?: number } = {}): Promise<void> {
  const fields = ['status = ?', 'guard_reason = ?', 'lease_owner = ?', 'updated_at = CURRENT_TIMESTAMP(3)'];
  const values: unknown[] = [status, guardReason, status === 'PAUSED_GUARD' ? null : currentLeaseOwner];
  if (patch.currentDate) { fields.push('current_date_value = ?'); values.push(patch.currentDate); }
  if (patch.dayCompletedRows !== undefined) { fields.push('day_completed_rows = ?'); values.push(patch.dayCompletedRows); }
  if (patch.rowsPerSec !== undefined) { fields.push('rows_per_sec = ?'); values.push(patch.rowsPerSec); }
  values.push(tableName);
  await getPool().query(`UPDATE data_warmup_progress SET ${fields.join(', ')} WHERE table_name = ?`, values);
}

async function refreshProgress(table: typeof TABLES[number], date: string, lastSuccessAt: Date | null): Promise<void> {
  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS actual_rows, MIN(${table.timeColumn}) AS earliest_time, MAX(${table.timeColumn}) AS latest_time,
            SUM(${table.timeColumn} >= ? AND ${table.timeColumn} < DATE_ADD(?, INTERVAL 1 DAY)) AS current_date_rows
       FROM ${table.name}`,
    [date, date],
  );
  const row = (rows as Record<string, unknown>[])[0] ?? {};
  const bytes = await getTableBytes(table.name);
  const guardReason = await capacityGuard(table.name, bytes);
  await getPool().query(
    `UPDATE data_warmup_progress SET status = ?, actual_rows = ?, current_date_value = ?, current_date_rows = ?,
      day_completed_rows = ?, earliest_time = ?, latest_time = ?, table_bytes = ?,
      guard_reason = ?, lease_owner = ?, last_success_at = COALESCE(?, last_success_at), updated_at = CURRENT_TIMESTAMP(3)
      WHERE table_name = ?`,
    [guardReason ? 'PAUSED_GUARD' : 'APPENDING', Number(row.actual_rows ?? 0), date, Number(row.current_date_rows ?? 0),
      Number(row.current_date_rows ?? 0), row.earliest_time ?? null, row.latest_time ?? null, bytes,
      guardReason, guardReason ? null : currentLeaseOwner, lastSuccessAt, table.name],
  );
}

async function getTableBytes(tableName: string): Promise<number> {
  const [rows] = await getPool().query(
    `SELECT data_length + index_length AS table_bytes FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName],
  );
  return Number((rows as Record<string, unknown>[])[0]?.table_bytes ?? 0);
}

async function updateWarmupStatuses(status: WarmupStatus, reason: string): Promise<void> {
  await ensureProgressTable().catch(() => undefined);
  await getPool().query(
    `UPDATE data_warmup_progress SET status = ?, guard_reason = ?, lease_owner = NULL WHERE table_name IN (?, ?)`,
    [status, reason, TABLES[0].name, TABLES[1].name],
  ).catch(() => undefined);
}

async function clearWarmupLeaseOwners(): Promise<void> {
  await getPool().query(
    `UPDATE data_warmup_progress SET
       status = IF(guard_reason = 'LEASE_NOT_ACQUIRED', 'BACKFILLING', status),
       guard_reason = IF(guard_reason = 'LEASE_NOT_ACQUIRED', NULL, guard_reason),
       lease_owner = NULL
     WHERE table_name IN (?, ?)`,
    [TABLES[0].name, TABLES[1].name],
  ).catch(() => undefined);
}

async function capacityGuard(tableName: string, tableBytes: number): Promise<string | null> {
  if (env.DATA_WARMUP_MAX_TABLE_BYTES > 0 && tableBytes >= env.DATA_WARMUP_MAX_TABLE_BYTES) return `MAX_TABLE_BYTES:${tableName}`;
  if (env.DATA_WARMUP_MIN_FREE_BYTES <= 0 && env.DATA_WARMUP_MIN_FREE_PERCENT <= 0) return null;
  try {
    const [rows] = await getPool().query(
      `SELECT data_free + data_length + index_length AS total_bytes, data_free AS free_bytes FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName],
    );
    const row = (rows as Record<string, unknown>[])[0];
    const free = Number(row?.free_bytes ?? 0);
    const total = Number(row?.total_bytes ?? 0);
    if (free > 0 && env.DATA_WARMUP_MIN_FREE_BYTES > 0 && free < env.DATA_WARMUP_MIN_FREE_BYTES) return 'MIN_FREE_BYTES';
    if (free > 0 && total > 0 && free * 100 < total * env.DATA_WARMUP_MIN_FREE_PERCENT) return 'MIN_FREE_PERCENT';
  } catch {
    return null;
  }
  return null;
}

async function acquireLease(owner: string): Promise<boolean> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  return (await redis.set(LEASE_KEY, owner, 'EX', LEASE_TTL_SEC, 'NX').catch(() => null)) === 'OK';
}

async function renewLease(owner: string): Promise<boolean> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const result = await redis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end",
    1,
    LEASE_KEY,
    owner,
    String(LEASE_TTL_SEC),
  ).catch(() => 0);
  return Number(result) === 1;
}

let currentLeaseOwner: string | null = null;

function toProgress(row: Record<string, unknown>, partitions: string[]): WarmupProgress {
  return {
    tableName: String(row.table_name), status: String(row.status) as WarmupStatus,
    targetRows: Number(row.target_rows), actualRows: Number(row.actual_rows),
    currentDate: String(row.current_date_value).slice(0, 10), dayTargetRows: Number(row.day_target_rows),
    dayCompletedRows: Number(row.day_completed_rows), rowsPerSec: Number(row.rows_per_sec),
    currentDateRows: Number(row.current_date_rows), earliestTime: row.earliest_time ? new Date(String(row.earliest_time)).toISOString() : null,
    latestTime: row.latest_time ? new Date(String(row.latest_time)).toISOString() : null,
    tableBytes: Number(row.table_bytes), partitions, expiredPartitionsDropped: Number(row.expired_partitions_dropped),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null, guardReason: row.guard_reason ? String(row.guard_reason) : null,
    lastSuccessAt: row.last_success_at ? new Date(String(row.last_success_at)).toISOString() : null,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function validateWarmupConfiguration(): void {
  if (env.DATA_WARMUP_WINDOW_DAYS !== 180 || env.DATA_WARMUP_ROWS_PER_DAY !== 500000
      || env.DATA_WARMUP_TARGET_ROWS !== 90000000
      || env.DATA_WARMUP_BATCH_SIZE < 1 || env.DATA_WARMUP_BATCH_SIZE > 5000
      || env.DATA_WARMUP_BATCH_INTERVAL_MS < 0
      || env.DATA_WARMUP_MIN_FREE_PERCENT < 0 || env.DATA_WARMUP_MIN_FREE_PERCENT > 100) {
    throw new Error('INVALID_DATA_WARMUP_CONFIGURATION');
  }
}

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIME_ZONE }).format(new Date());
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateTimeInDay(date: string, index: number, batchSize: number): Date {
  const seconds = Math.floor((index / Math.max(batchSize, 1)) * 86400);
  return new Date(`${date}T00:00:00+08:00`.replace('00:00:00', `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let singleton: DataWarmupService | null = null;

export function getDataWarmupService(): DataWarmupService {
  if (!singleton) singleton = new DataWarmupService();
  return singleton;
}
