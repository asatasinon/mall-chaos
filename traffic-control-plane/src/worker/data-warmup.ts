import pino from 'pino';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
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

type WarmupStatus = 'BACKFILLING' | 'APPENDING' | 'ROLLOVER_CLEANUP' | 'ERROR' | 'DISABLED';
export type ManualWarmupOperation = 'INJECT' | 'CLEANUP';
export type ManualWarmupJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

const WARMUP_TABLE_NAMES = TABLES.map((table) => table.name);
const MAX_MANUAL_DATES = 31;
const MAX_MANUAL_ROWS_PER_DAY = 1_000_000;
const MANUAL_JOB_STALE_AFTER_SEC = 120;

class AsyncMutex {
  private tail = Promise.resolve();

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const warmupMutationLock = new AsyncMutex();

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
  private leaseSessionActive = false;
  private runPromise: Promise<void> | null = null;
  private manualLoopPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> = Promise.resolve();
  private resolveStop: (() => void) | null = null;
  private leaseHeartbeat: NodeJS.Timeout | null = null;
  private leaseRenewalInFlight = false;
  private leaseHeld = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.stopPromise = new Promise<void>((resolve) => { this.resolveStop = resolve; });
    this.runPromise = this.runLoop();
    void this.runPromise;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.leaseSessionActive = false;
    this.resolveStop?.();
    this.resolveStop = null;
    await this.runPromise?.catch(() => undefined);
    await this.releaseLease();
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
          await this.sleepOrStop(Math.max(env.DATA_WARMUP_BATCH_INTERVAL_MS, 1000));
          continue;
        }
        this.leaseHeld = true;
        this.startLeaseHeartbeat();
        if (!(await renewLease(this.owner))) throw new Error('DATA_WARMUP_LEASE_LOST');
        await markWarmupLeaseOwner(this.owner);
        await reclaimStaleManualWarmupJobs();
        await this.runLeaseSession();
      } catch (error) {
        const errorOwner = this.leaseHeld ? this.owner : null;
        this.stopLeaseHeartbeat();
        this.leaseHeld = false;
        log.error({ error }, 'Data warmup iteration failed');
        await updateWarmupStatuses('ERROR', error instanceof Error ? error.message : String(error), errorOwner);
        await this.sleepOrStop(Math.min(Math.max(env.DATA_WARMUP_BATCH_INTERVAL_MS, 1000) * 5, 30_000));
      }
    }
    await this.releaseLease();
  }

  private async runLeaseSession(): Promise<void> {
    this.leaseSessionActive = true;
    this.manualLoopPromise = this.runManualLoop();
    try {
      while (this.canProcess()) {
        for (const table of TABLES) {
          await this.processTable(table);
          if (!this.canProcess()) break;
        }
        if (!this.canProcess()) break;
        if (!(await renewLease(this.owner))) throw new Error('DATA_WARMUP_LEASE_LOST');
        await this.sleepOrStop(Math.max(env.DATA_WARMUP_BATCH_INTERVAL_MS, 1000));
      }
      if (!this.stopped && !this.leaseHeld) throw new Error('DATA_WARMUP_LEASE_LOST');
    } finally {
      this.leaseSessionActive = false;
      await this.manualLoopPromise?.catch((error) => {
        log.error({ error }, 'Manual warmup loop failed');
      });
      this.manualLoopPromise = null;
    }
  }

  private async runManualLoop(): Promise<void> {
    while (this.canProcess()) {
      try {
        await resumeLegacyPausedManualWarmupJobs();
        await processManualWarmupJobs(this.owner, () => this.canProcess());
      } catch (error) {
        if (error instanceof Error && error.message === 'DATA_WARMUP_LEASE_LOST') this.leaseHeld = false;
        log.error({ error }, 'Manual warmup job failed');
      }
      if (this.canProcess()) {
        await this.sleepOrStop(Math.max(env.DATA_WARMUP_BATCH_INTERVAL_MS, 1000));
      }
    }
  }

  private async sleepOrStop(milliseconds: number): Promise<void> {
    await Promise.race([sleep(milliseconds), this.stopPromise]);
  }

  private canProcess(): boolean {
    return !this.stopped && this.leaseSessionActive && this.leaseHeld;
  }

  private async processTable(table: typeof TABLES[number]): Promise<void> {
    if (!this.canProcess()) return;
    const today = todayInShanghai();
    await ensureCurrentPartition(table, today, this.owner);
    if (!this.canProcess()) return;
    const windowStart = addDays(today, -(env.DATA_WARMUP_WINDOW_DAYS - 1));
    const missingDays = await findMissingDays(table, windowStart, today);
    if (!this.canProcess()) return;
    if (missingDays.length > 0) {
      await setWarmupStatus(table.name, 'BACKFILLING', this.owner);
      for (const date of missingDays) {
        if (await fillDate(table, date, this.owner, () => this.canProcess())) return;
        if (!this.canProcess()) return;
      }
    }
    const currentRows = await countDateRows(table, today);
    if (currentRows < env.DATA_WARMUP_ROWS_PER_DAY && !(await isWarmupDateExcluded(table.name, today))) {
      await setWarmupStatus(table.name, 'APPENDING', this.owner);
      if (await fillDate(table, today, this.owner, () => this.canProcess())) return;
    }
    if (!this.canProcess()) return;
    await setWarmupStatus(table.name, 'ROLLOVER_CLEANUP', this.owner);
    await dropExpiredPartition(table, windowStart, this.owner);
    await refreshProgress(table, today, null, this.owner);
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
    await getPool().query(
      `UPDATE data_warmup_progress SET lease_owner = NULL
         WHERE lease_owner = ? AND table_name IN (?, ?)`,
      [this.owner, TABLES[0].name, TABLES[1].name],
    ).catch(() => undefined);
    this.leaseHeld = false;
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

async function processManualWarmupJobs(owner: string, shouldContinue: () => boolean): Promise<void> {
  if (!shouldContinue()) return;
  const job = await claimManualWarmupJob(owner);
  if (!job) return;
  const table = TABLES.find((candidate) => candidate.name === job.tableName);
  if (!table) {
    await setManualWarmupJobStatus(job.id, 'FAILED', 'Unsupported warmup table', owner);
    return;
  }
  try {
    if (job.operation === 'INJECT') {
      for (let dateIndex = job.processedDays; dateIndex < job.dates.length; dateIndex++) {
        if (!shouldContinue()) {
          await requeueManualWarmupJob(job.id, owner);
          return;
        }
        const date = job.dates[dateIndex];
        await removeWarmupExclusion(table.name, date, owner);
        await ensureCurrentPartition(table, date, owner);
        let inserted = dateIndex === job.processedDays
          ? Math.min(Math.max(job.processedRows - dateIndex * job.rowsPerDay, 0), job.rowsPerDay)
          : 0;
        while (inserted < job.rowsPerDay) {
          if (!shouldContinue()) {
            await requeueManualWarmupJob(job.id, owner);
            return;
          }
          const batchSize = Math.min(env.DATA_WARMUP_BATCH_SIZE, job.rowsPerDay - inserted);
          await insertManualWarmupBatch(table, date, dateIndex, inserted, batchSize, job.rowsPerDay, job.id, owner);
          inserted += batchSize;
          if (!(await renewLease(owner))) throw new Error('DATA_WARMUP_LEASE_LOST');
          if (!shouldContinue()) {
            await requeueManualWarmupJob(job.id, owner);
            return;
          }
          await sleep(env.DATA_WARMUP_BATCH_INTERVAL_MS);
        }
        await updateManualWarmupJobProgress(job.id, dateIndex + 1, (dateIndex + 1) * job.rowsPerDay, owner);
      }
    } else {
      for (let index = job.processedDays; index < job.dates.length; index++) {
        if (!shouldContinue()) {
          await requeueManualWarmupJob(job.id, owner);
          return;
        }
        await addWarmupExclusion(table.name, job.dates[index], owner);
        await dropPartition(table, job.dates[index], owner);
        await updateManualWarmupJobProgress(job.id, index + 1, 0, owner);
      }
      await refreshProgress(table, todayInShanghai(), null, owner);
    }
    await setManualWarmupJobStatus(job.id, 'COMPLETED', null, owner);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!shouldContinue() || message === 'DATA_WARMUP_LEASE_LOST') {
      await requeueManualWarmupJob(job.id, owner);
      if (message === 'DATA_WARMUP_LEASE_LOST') throw error;
      return;
    }
    await setManualWarmupJobStatus(job.id, 'FAILED', message.slice(0, 255), owner);
    throw error;
  }
}

async function reclaimStaleManualWarmupJobs(): Promise<void> {
  await getPool().execute(
    `UPDATE data_warmup_manual_jobs
        SET status = 'QUEUED', started_at = NULL, heartbeat_at = NULL, claim_owner = NULL, completed_at = NULL, error_message = NULL
      WHERE status = 'RUNNING'
        AND COALESCE(heartbeat_at, started_at) < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${MANUAL_JOB_STALE_AFTER_SEC} SECOND)`,
  );
}

async function resumeLegacyPausedManualWarmupJobs(): Promise<void> {
  const [rows] = await getPool().query(
    `SELECT id, table_name FROM data_warmup_manual_jobs WHERE status = 'PAUSED_GUARD' ORDER BY id`,
  );
  for (const row of rows as Record<string, unknown>[]) {
    const table = TABLES.find((candidate) => candidate.name === String(row.table_name));
    if (!table) continue;
    await getPool().execute(
      `UPDATE data_warmup_manual_jobs SET status = 'QUEUED', completed_at = NULL, error_message = NULL
         WHERE id = ? AND status = 'PAUSED_GUARD'`,
      [Number(row.id)],
    );
  }
}

async function claimManualWarmupJob(owner: string): Promise<ManualWarmupJob | null> {
  const [rows] = await getPool().query(
    `SELECT id, operation, table_name, dates, rows_per_day, status, processed_days,
            processed_rows, error_message, created_at, started_at, completed_at
       FROM data_warmup_manual_jobs WHERE status = 'QUEUED' ORDER BY id LIMIT 1`,
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  const [result] = await getPool().execute(
    `UPDATE data_warmup_manual_jobs SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP(3), heartbeat_at = CURRENT_TIMESTAMP(3), claim_owner = ?, error_message = NULL
       WHERE id = ? AND status = 'QUEUED'`,
    [owner, Number(row.id)],
  );
  if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) return null;
  return { ...toManualWarmupJob(row), status: 'RUNNING', startedAt: new Date().toISOString() };
}

async function setManualWarmupJobStatus(id: number, status: ManualWarmupJobStatus, errorMessage: string | null, owner: string): Promise<void> {
  await getPool().execute(
    `UPDATE data_warmup_manual_jobs SET status = ?, error_message = ?, heartbeat_at = NULL, claim_owner = NULL, completed_at = ?
       WHERE id = ? AND status = 'RUNNING' AND claim_owner = ?`,
    [status, errorMessage, ['COMPLETED', 'FAILED'].includes(status) ? new Date() : null, id, owner],
  );
}

async function updateManualWarmupJobProgress(id: number, processedDays: number, processedRows: number, owner: string): Promise<void> {
  const [result] = await getPool().execute(
    `UPDATE data_warmup_manual_jobs SET processed_days = ?, processed_rows = ?, heartbeat_at = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND status = 'RUNNING' AND claim_owner = ?`,
    [processedDays, processedRows, id, owner],
  );
  if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) throw new Error('DATA_WARMUP_LEASE_LOST');
}

async function requeueManualWarmupJob(id: number, owner: string): Promise<void> {
  await getPool().execute(
    `UPDATE data_warmup_manual_jobs SET status = 'QUEUED', started_at = NULL, heartbeat_at = NULL, claim_owner = NULL, completed_at = NULL, error_message = NULL
       WHERE id = ? AND status = 'RUNNING' AND claim_owner = ?`,
    [id, owner],
  );
}

async function insertManualWarmupBatch(
  table: typeof TABLES[number], date: string, dateIndex: number, inserted: number, rowCount: number,
  totalRows: number, jobId: number, owner: string,
): Promise<void> {
  await warmupMutationLock.runExclusive(async () => {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      await assertWarmupLeaseOwner(connection, table.name, owner);
      const startIndex = await countDateRows(table, date, connection);
      await insertWarmupRowsUnlocked(
        table, date, startIndex, rowCount, Math.max(totalRows, startIndex + rowCount), connection,
      );
      const [result] = await connection.execute(
        `UPDATE data_warmup_manual_jobs SET processed_days = ?, processed_rows = ?, heartbeat_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND status = 'RUNNING' AND claim_owner = ?`,
        [dateIndex, dateIndex * totalRows + inserted + rowCount, jobId, owner],
      );
      if (Number((result as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
        throw new Error('DATA_WARMUP_LEASE_LOST');
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  });
}

async function insertWarmupRowsUnlocked(
  table: typeof TABLES[number], date: string, startIndex: number, rowCount: number, totalRows: number,
  executor: Pick<PoolConnection, 'query'> = getPool(),
): Promise<void> {
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
  await executor.query(sql, values);
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

export function formatWarmupDate(value: unknown): string {
  if (typeof value === 'string') {
    const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (dateOnly) return dateOnly;
  }
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIME_ZONE }).format(date);
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

async function fillDate(table: typeof TABLES[number], date: string, owner: string, shouldContinue: () => boolean): Promise<boolean> {
  let completed = await countDateRows(table, date);
  if (completed >= env.DATA_WARMUP_ROWS_PER_DAY) {
    await refreshProgress(table, date, null, owner);
    return false;
  }
  const startedAt = Date.now();
  while (completed < env.DATA_WARMUP_ROWS_PER_DAY) {
    if (!shouldContinue()) return true;
    const batchSize = Math.min(env.DATA_WARMUP_BATCH_SIZE, env.DATA_WARMUP_ROWS_PER_DAY - completed);
    const inserted = await insertDailyWarmupRows(table, date, batchSize, owner);
    if (inserted === 0) return false;
    completed += inserted;
    if (!(await renewLease(owner))) throw new Error('DATA_WARMUP_LEASE_LOST');
    if (!shouldContinue()) return true;
    const elapsed = Math.max(1, Date.now() - startedAt);
    await setWarmupStatus(table.name, 'APPENDING', owner, {
      currentDate: date,
      dayCompletedRows: completed,
      rowsPerSec: Math.round(completed * 1000 / elapsed),
    });
    await sleep(env.DATA_WARMUP_BATCH_INTERVAL_MS);
  }
  if (!shouldContinue()) return true;
  await refreshProgress(table, date, new Date(), owner);
  return false;
}

async function insertDailyWarmupRows(table: typeof TABLES[number], date: string, rowCount: number, owner: string): Promise<number> {
  return warmupMutationLock.runExclusive(async () => {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      await assertWarmupLeaseOwner(connection, table.name, owner);
      if (await isWarmupDateExcluded(table.name, date, connection)) {
        await connection.rollback();
        return 0;
      }
      const completed = await countDateRows(table, date, connection);
      if (completed >= env.DATA_WARMUP_ROWS_PER_DAY) {
        await connection.rollback();
        return 0;
      }
      const actualBatchSize = Math.min(rowCount, env.DATA_WARMUP_ROWS_PER_DAY - completed);
      await insertWarmupRowsUnlocked(table, date, completed, actualBatchSize, env.DATA_WARMUP_ROWS_PER_DAY, connection);
      await connection.commit();
      return actualBatchSize;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  });
}

async function ensureCurrentPartition(table: typeof TABLES[number], date: string, owner: string): Promise<void> {
  const partitionName = `p${date.replaceAll('-', '')}`;
  await warmupMutationLock.runExclusive(async () => {
    await assertWarmupLeaseOwner(getPool(), table.name, owner);
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
  });
}

async function dropExpiredPartition(table: typeof TABLES[number], windowStart: string, owner: string): Promise<void> {
  const expiredDate = addDays(windowStart, -1);
  if (!(await dropPartition(table, expiredDate, owner))) return;
  await getPool().query(
    `UPDATE data_warmup_progress SET expired_partitions_dropped = expired_partitions_dropped + 1
       WHERE table_name = ? AND lease_owner = ?`,
    [table.name, owner],
  );
}

async function dropPartition(table: typeof TABLES[number], date: string, owner: string): Promise<boolean> {
  const partitionName = `p${date.replaceAll('-', '')}`;
  return warmupMutationLock.runExclusive(async () => {
    await assertWarmupLeaseOwner(getPool(), table.name, owner);
    const [rows] = await getPool().query(
      `SELECT partition_name FROM information_schema.partitions
        WHERE table_schema = DATABASE() AND table_name = ? AND partition_name = ?`,
      [table.name, partitionName],
    );
    if ((rows as unknown[]).length === 0) return false;
    await getPool().query(`ALTER TABLE ${table.name} DROP PARTITION ${partitionName}`);
    return true;
  });
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

async function countDateRows(
  table: typeof TABLES[number], date: string, executor: Pick<PoolConnection, 'query'> = getPool(),
): Promise<number> {
  const [rows] = await executor.query(
    `SELECT COUNT(*) AS row_count FROM ${table.name} WHERE ${table.timeColumn} >= ? AND ${table.timeColumn} < DATE_ADD(?, INTERVAL 1 DAY)`,
    [date, date],
  );
  return Number((rows as Record<string, unknown>[])[0]?.row_count ?? 0);
}

async function isWarmupDateExcluded(
  tableName: string, date: string, executor: Pick<PoolConnection, 'query'> = getPool(),
): Promise<boolean> {
  const [rows] = await executor.query(
    `SELECT 1 FROM data_warmup_manual_exclusions WHERE table_name = ? AND date_value = ? LIMIT 1`,
    [tableName, date],
  );
  return (rows as unknown[]).length > 0;
}

async function addWarmupExclusion(tableName: string, date: string, owner: string): Promise<void> {
  await warmupMutationLock.runExclusive(async () => {
    await assertWarmupLeaseOwner(getPool(), tableName, owner);
    await getPool().query(
      `INSERT IGNORE INTO data_warmup_manual_exclusions (table_name, date_value) VALUES (?, ?)`,
      [tableName, date],
    );
  });
}

async function removeWarmupExclusion(tableName: string, date: string, owner: string): Promise<void> {
  await warmupMutationLock.runExclusive(async () => {
    await assertWarmupLeaseOwner(getPool(), tableName, owner);
    await getPool().query(
      `DELETE FROM data_warmup_manual_exclusions WHERE table_name = ? AND date_value = ?`,
      [tableName, date],
    );
  });
}

async function assertWarmupLeaseOwner(
  executor: Pick<PoolConnection, 'query'>, tableName: string, owner: string,
): Promise<void> {
  const [rows] = await executor.query(
    `SELECT lease_owner FROM data_warmup_progress WHERE table_name = ? FOR UPDATE`,
    [tableName],
  );
  if (String((rows as Record<string, unknown>[])[0]?.lease_owner ?? '') !== owner) {
    throw new Error('DATA_WARMUP_LEASE_LOST');
  }
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
    heartbeat_at DATETIME(3) NULL,
    claim_owner VARCHAR(64) NULL,
    completed_at DATETIME(3) NULL,
    INDEX idx_data_warmup_manual_jobs_status (status, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await ensureManualWarmupJobColumn('heartbeat_at', 'DATETIME(3) NULL');
  await ensureManualWarmupJobColumn('claim_owner', 'VARCHAR(64) NULL');
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
  await getPool().query(
    `UPDATE data_warmup_progress SET status = 'APPENDING', guard_reason = NULL WHERE status = 'PAUSED_GUARD'`,
  );
}

async function ensureManualWarmupJobColumn(columnName: 'heartbeat_at' | 'claim_owner', definition: string): Promise<void> {
  const [rows] = await getPool().query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'data_warmup_manual_jobs' AND column_name = ? LIMIT 1`,
    [columnName],
  );
  if ((rows as unknown[]).length > 0) return;
  try {
    await getPool().query(`ALTER TABLE data_warmup_manual_jobs ADD COLUMN ${columnName} ${definition}`);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw error;
  }
}

async function setWarmupStatus(tableName: string, status: WarmupStatus, owner: string,
                               patch: { currentDate?: string; dayCompletedRows?: number; rowsPerSec?: number } = {}): Promise<void> {
  const fields = ['status = ?', 'guard_reason = NULL', 'lease_owner = ?', 'updated_at = CURRENT_TIMESTAMP(3)'];
  const values: unknown[] = [status, owner];
  if (patch.currentDate) { fields.push('current_date_value = ?'); values.push(patch.currentDate); }
  if (patch.dayCompletedRows !== undefined) { fields.push('day_completed_rows = ?'); values.push(patch.dayCompletedRows); }
  if (patch.rowsPerSec !== undefined) { fields.push('rows_per_sec = ?'); values.push(patch.rowsPerSec); }
  values.push(tableName, owner);
  await getPool().query(`UPDATE data_warmup_progress SET ${fields.join(', ')} WHERE table_name = ? AND lease_owner = ?`, values);
}

async function refreshProgress(table: typeof TABLES[number], date: string, lastSuccessAt: Date | null, owner: string): Promise<void> {
  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS actual_rows, MIN(${table.timeColumn}) AS earliest_time, MAX(${table.timeColumn}) AS latest_time,
            SUM(${table.timeColumn} >= ? AND ${table.timeColumn} < DATE_ADD(?, INTERVAL 1 DAY)) AS current_date_rows
       FROM ${table.name}`,
    [date, date],
  );
  const row = (rows as Record<string, unknown>[])[0] ?? {};
  const bytes = await getTableBytes(table.name);
  await getPool().query(
    `UPDATE data_warmup_progress SET status = 'APPENDING', actual_rows = ?, current_date_value = ?, current_date_rows = ?,
      day_completed_rows = ?, earliest_time = ?, latest_time = ?, table_bytes = ?,
      guard_reason = NULL, lease_owner = ?, last_success_at = COALESCE(?, last_success_at), updated_at = CURRENT_TIMESTAMP(3)
      WHERE table_name = ? AND lease_owner = ?`,
    [Number(row.actual_rows ?? 0), date, Number(row.current_date_rows ?? 0),
      Number(row.current_date_rows ?? 0), row.earliest_time ?? null, row.latest_time ?? null, bytes,
      owner, lastSuccessAt, table.name, owner],
  );
}

async function getTableBytes(tableName: string): Promise<number> {
  const [rows] = await getPool().query(
    `SELECT data_length + index_length AS table_bytes FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName],
  );
  return Number((rows as Record<string, unknown>[])[0]?.table_bytes ?? 0);
}

async function markWarmupLeaseOwner(owner: string): Promise<void> {
  await getPool().query(
    `UPDATE data_warmup_progress SET lease_owner = ? WHERE table_name IN (?, ?)`,
    [owner, TABLES[0].name, TABLES[1].name],
  );
}

async function updateWarmupStatuses(status: WarmupStatus, reason: string, owner: string | null = null): Promise<void> {
  await ensureProgressTable().catch(() => undefined);
  if (owner) {
    await getPool().query(
      `UPDATE data_warmup_progress SET status = ?, guard_reason = ?, lease_owner = NULL
         WHERE lease_owner = ? AND table_name IN (?, ?)`,
      [status, reason, owner, TABLES[0].name, TABLES[1].name],
    ).catch(() => undefined);
    return;
  }
  await getPool().query(
    `UPDATE data_warmup_progress SET status = ?, guard_reason = ?, lease_owner = NULL WHERE table_name IN (?, ?)`,
    [status, reason, TABLES[0].name, TABLES[1].name],
  ).catch(() => undefined);
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

function toProgress(row: Record<string, unknown>, partitions: string[]): WarmupProgress {
  return {
    tableName: String(row.table_name), status: String(row.status) as WarmupStatus,
    targetRows: Number(row.target_rows), actualRows: Number(row.actual_rows),
    currentDate: formatWarmupDate(row.current_date_value), dayTargetRows: Number(row.day_target_rows),
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
      || env.DATA_WARMUP_BATCH_INTERVAL_MS < 0) {
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
