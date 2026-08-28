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
export type ManualWarmupOperation = 'INJECT' | 'CLEANUP';
export type ManualWarmupJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED_GUARD';

const WARMUP_TABLE_NAMES = TABLES.map((table) => table.name);
const MAX_MANUAL_DATES = 31;
const MAX_MANUAL_ROWS_PER_DAY = 1_000_000;

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

export interface ManualWarmupJob {
  id: number;
  operation: ManualWarmupOperation;
  tableName: string;
  dates: string[];
  rowsPerDay: number;
  status: ManualWarmupJobStatus;
  processedDays: number;
  processedRows: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export class DataWarmupService {
  private readonly owner = randomUUID();
  private started = false;
  private stopped = false;
  private leaseHeartbeat: NodeJS.Timeout | null = null;
  private leaseRenewalInFlight = false;
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
        this.startLeaseHeartbeat();
        if (!(await renewLease(this.owner))) throw new Error('DATA_WARMUP_LEASE_LOST');
        await processManualWarmupJobs();
        for (const table of TABLES) {
          await this.processTable(table);
        }
        if (!(await renewLease(this.owner))) throw new Error('DATA_WARMUP_LEASE_LOST');
        await sleep(Math.max(env.DATA_WARMUP_BATCH_INTERVAL_MS, 1000));
      } catch (error) {
        this.stopLeaseHeartbeat();
        this.leaseHeld = false;
        currentLeaseOwner = null;
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
    if (currentRows < env.DATA_WARMUP_ROWS_PER_DAY && !(await isWarmupDateExcluded(table.name, today))) {
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

  private startLeaseHeartbeat(): void {
    if (this.leaseHeartbeat) return;
    this.leaseHeartbeat = setInterval(() => {
      if (!this.leaseHeld || this.leaseRenewalInFlight) return;
      this.leaseRenewalInFlight = true;
      void renewLease(this.owner).then((renewed) => {
        if (renewed) return;
        this.stopLeaseHeartbeat();
        this.leaseHeld = false;
        currentLeaseOwner = null;
        log.warn('Data warmup lease renewal failed');
      }).finally(() => {
        this.leaseRenewalInFlight = false;
      });
    }, Math.max(1000, Math.floor(LEASE_TTL_SEC * 1000 / 3)));
    this.leaseHeartbeat.unref();
  }

  private stopLeaseHeartbeat(): void {
    if (!this.leaseHeartbeat) return;
    clearInterval(this.leaseHeartbeat);
    this.leaseHeartbeat = null;
  }

  private async releaseLease(): Promise<void> {
    this.stopLeaseHeartbeat();
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

export async function loadManualWarmupJobs(limit = 10): Promise<ManualWarmupJob[]> {
  await ensureProgressTable();
  const [rows] = await getPool().query(
    `SELECT id, operation, table_name, dates, rows_per_day, status, processed_days,
            processed_rows, error_message, created_at, started_at, completed_at
       FROM data_warmup_manual_jobs ORDER BY id DESC LIMIT ?`,
    [limit],
  );
  return (rows as Record<string, unknown>[]).map(toManualWarmupJob);
}

export async function enqueueManualWarmupJob(input: {
  operation: ManualWarmupOperation;
  tableName: string;
  dates: string[];
  rowsPerDay: number;
}): Promise<number> {
  validateManualWarmupRequest(input);
  await ensureProgressTable();
  const [result] = await getPool().execute(
    `INSERT INTO data_warmup_manual_jobs (operation, table_name, dates, rows_per_day)
     VALUES (?, ?, ?, ?)`,
    [input.operation, input.tableName, JSON.stringify(input.dates), input.rowsPerDay],
  );
  return Number((result as { insertId?: number }).insertId ?? 0);
}

async function processManualWarmupJobs(): Promise<void> {
  const job = await claimManualWarmupJob();
  if (!job) return;
  const table = TABLES.find((candidate) => candidate.name === job.tableName);
  if (!table) {
    await setManualWarmupJobStatus(job.id, 'FAILED', 'Unsupported warmup table');
    return;
  }
  try {
    if (job.operation === 'INJECT') {
      for (const date of job.dates) {
        await removeWarmupExclusion(table.name, date);
        await ensureCurrentPartition(table, date);
        let inserted = 0;
        while (inserted < job.rowsPerDay) {
          const guardReason = await capacityGuard(table.name, await getTableBytes(table.name));
          if (guardReason) {
            await setManualWarmupJobStatus(job.id, 'PAUSED_GUARD', guardReason);
            await setWarmupStatus(table.name, 'PAUSED_GUARD', guardReason);
            return;
          }
          const batchSize = Math.min(env.DATA_WARMUP_BATCH_SIZE, job.rowsPerDay - inserted);
          await insertWarmupRows(table, date, inserted, batchSize, job.rowsPerDay);
          inserted += batchSize;
          if (!(await renewLease(currentLeaseOwner ?? ''))) throw new Error('DATA_WARMUP_LEASE_LOST');
          await updateManualWarmupJobProgress(job.id, job.dates.indexOf(date), job.dates.indexOf(date) * job.rowsPerDay + inserted);
          await sleep(env.DATA_WARMUP_BATCH_INTERVAL_MS);
        }
        await updateManualWarmupJobProgress(job.id, job.dates.indexOf(date) + 1, (job.dates.indexOf(date) + 1) * job.rowsPerDay);
      }
    } else {
      for (let index = 0; index < job.dates.length; index++) {
        await addWarmupExclusion(table.name, job.dates[index]);
        await dropPartition(table, job.dates[index]);
        await updateManualWarmupJobProgress(job.id, index + 1, 0);
      }
      await refreshProgress(table, todayInShanghai(), null);
    }
    await setManualWarmupJobStatus(job.id, 'COMPLETED', null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setManualWarmupJobStatus(job.id, 'FAILED', message.slice(0, 255));
    throw error;
  }
}

async function claimManualWarmupJob(): Promise<ManualWarmupJob | null> {
  const [rows] = await getPool().query(
    `SELECT id, operation, table_name, dates, rows_per_day, status, processed_days,
            processed_rows, error_message, created_at, started_at, completed_at
       FROM data_warmup_manual_jobs WHERE status = 'QUEUED' ORDER BY id LIMIT 1`,
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  const [result] = await getPool().execute(
    `UPDATE data_warmup_manual_jobs SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP(3), error_message = NULL
       WHERE id = ? AND status = 'QUEUED'`,
    [Number(row.id)],
  );
  if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) return null;
  return { ...toManualWarmupJob(row), status: 'RUNNING', startedAt: new Date().toISOString() };
}

async function setManualWarmupJobStatus(id: number, status: ManualWarmupJobStatus, errorMessage: string | null): Promise<void> {
  await getPool().execute(
    `UPDATE data_warmup_manual_jobs SET status = ?, error_message = ?, completed_at = ? WHERE id = ?`,
    [status, errorMessage, ['COMPLETED', 'FAILED', 'PAUSED_GUARD'].includes(status) ? new Date() : null, id],
  );
}

async function updateManualWarmupJobProgress(id: number, processedDays: number, processedRows: number): Promise<void> {
  await getPool().execute(
    `UPDATE data_warmup_manual_jobs SET processed_days = ?, processed_rows = ? WHERE id = ?`,
    [processedDays, processedRows, id],
  );
}

async function insertWarmupRows(table: typeof TABLES[number], date: string, startIndex: number, rowCount: number, totalRows: number): Promise<void> {
  const values: Array<string | number | Date> = [];
  const placeholders: string[] = [];
  for (let index = 0; index < rowCount; index++) {
    const indexValue = startIndex + index;
    const timestamp = dateTimeInDay(date, indexValue, totalRows);
    if (table.name === 'product_price_history') {
      const sku = SKUS[indexValue % SKUS.length];
      const previous = round2(29 + (indexValue % 2970));
      const current = round2(previous * ((indexValue % 20 < 10) ? 0.9 : 1.1));
      placeholders.push('(?,?,?,?,?,?)');
      values.push(sku, previous, current, 'WARMUP', (indexValue % 20) + 1, timestamp);
    } else {
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
}

function validateManualWarmupRequest(input: {
  operation: ManualWarmupOperation;
  tableName: string;
  dates: string[];
  rowsPerDay: number;
}): void {
  if (!WARMUP_TABLE_NAMES.includes(input.tableName as typeof WARMUP_TABLE_NAMES[number])) throw new Error('INVALID_WARMUP_TABLE');
  if (input.operation !== 'INJECT' && input.operation !== 'CLEANUP') throw new Error('INVALID_WARMUP_OPERATION');
  if (!Array.isArray(input.dates) || input.dates.length < 1 || input.dates.length > MAX_MANUAL_DATES) throw new Error('INVALID_WARMUP_DATES');
  const dates = [...new Set(input.dates)];
  if (dates.length !== input.dates.length || dates.some((date) => !isWarmupDate(date))) throw new Error('INVALID_WARMUP_DATES');
  if (input.operation === 'INJECT' && (!Number.isInteger(input.rowsPerDay) || input.rowsPerDay < 1 || input.rowsPerDay > MAX_MANUAL_ROWS_PER_DAY)) {
    throw new Error('INVALID_WARMUP_ROWS_PER_DAY');
  }
  if (input.operation === 'CLEANUP' && input.rowsPerDay !== 0) throw new Error('INVALID_WARMUP_ROWS_PER_DAY');
}

function isWarmupDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00+08:00`);
  const currentDate = todayInShanghai();
  const normalizedDate = new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIME_ZONE }).format(parsed);
  if (Number.isNaN(parsed.getTime()) || normalizedDate !== date || currentDate < date) return false;
  const windowStart = addDays(currentDate, -(env.DATA_WARMUP_WINDOW_DAYS - 1));
  return date >= windowStart && date <= currentDate;
}

export function parseWarmupDates(value: unknown): string[] {
  const dates = Array.isArray(value) ? value : typeof value === 'string' ? JSON.parse(value) : [];
  if (!Array.isArray(dates) || dates.some((date) => typeof date !== 'string')) {
    throw new Error('INVALID_WARMUP_JOB_DATES');
  }
  return dates;
}

function toManualWarmupJob(row: Record<string, unknown>): ManualWarmupJob {
  return {
    id: Number(row.id), operation: String(row.operation) as ManualWarmupOperation, tableName: String(row.table_name),
    dates: parseWarmupDates(row.dates), rowsPerDay: Number(row.rows_per_day),
    status: String(row.status) as ManualWarmupJobStatus, processedDays: Number(row.processed_days),
    processedRows: Number(row.processed_rows), errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: new Date(String(row.created_at)).toISOString(), startedAt: row.started_at ? new Date(String(row.started_at)).toISOString() : null,
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
  };
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
    await insertWarmupRows(table, date, completed, batchSize, env.DATA_WARMUP_ROWS_PER_DAY);
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
  if (!(await dropPartition(table, expiredDate))) return;
  await getPool().query(
    `UPDATE data_warmup_progress SET expired_partitions_dropped = expired_partitions_dropped + 1 WHERE table_name = ?`,
    [table.name],
  );
}

async function dropPartition(table: typeof TABLES[number], date: string): Promise<boolean> {
  const partitionName = `p${date.replaceAll('-', '')}`;
  const [rows] = await getPool().query(
    `SELECT partition_name FROM information_schema.partitions
      WHERE table_schema = DATABASE() AND table_name = ? AND partition_name = ?`,
    [table.name, partitionName],
  );
  if ((rows as unknown[]).length === 0) return false;
  await getPool().query(`ALTER TABLE ${table.name} DROP PARTITION ${partitionName}`);
  return true;
}

async function findMissingDays(table: typeof TABLES[number], start: string, end: string): Promise<string[]> {
  const [rows] = await getPool().query(
    `SELECT DATE(${table.timeColumn}) AS day_value, COUNT(*) AS row_count
       FROM ${table.name} WHERE ${table.timeColumn} >= ? AND ${table.timeColumn} < DATE_ADD(?, INTERVAL 1 DAY)
         AND NOT EXISTS (SELECT 1 FROM data_warmup_manual_exclusions e WHERE e.table_name = ? AND e.date_value = DATE(${table.timeColumn}))
       GROUP BY DATE(${table.timeColumn})`,
    [start, end, table.name],
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

async function isWarmupDateExcluded(tableName: string, date: string): Promise<boolean> {
  const [rows] = await getPool().query(
    `SELECT 1 FROM data_warmup_manual_exclusions WHERE table_name = ? AND date_value = ? LIMIT 1`,
    [tableName, date],
  );
  return (rows as unknown[]).length > 0;
}

async function addWarmupExclusion(tableName: string, date: string): Promise<void> {
  await getPool().query(
    `INSERT IGNORE INTO data_warmup_manual_exclusions (table_name, date_value) VALUES (?, ?)`,
    [tableName, date],
  );
}

async function removeWarmupExclusion(tableName: string, date: string): Promise<void> {
  await getPool().query(
    `DELETE FROM data_warmup_manual_exclusions WHERE table_name = ? AND date_value = ?`,
    [tableName, date],
  );
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
  await getPool().query(`CREATE TABLE IF NOT EXISTS data_warmup_manual_jobs (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    operation VARCHAR(16) NOT NULL,
    table_name VARCHAR(64) NOT NULL,
    dates JSON NOT NULL,
    rows_per_day INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
    processed_days INT NOT NULL DEFAULT 0,
    processed_rows BIGINT NOT NULL DEFAULT 0,
    error_message VARCHAR(255) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    started_at DATETIME(3) NULL,
    completed_at DATETIME(3) NULL,
    INDEX idx_data_warmup_manual_jobs_status (status, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await getPool().query(`CREATE TABLE IF NOT EXISTS data_warmup_manual_exclusions (
    table_name VARCHAR(64) NOT NULL,
    date_value DATE NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (table_name, date_value)
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

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
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
