import pino from 'pino';
import { getPool } from '../lib/db';
import { randomUUID } from 'crypto';

const log = pino({ name: 'data-warmup' });

const TARGET_ROWS = 30_000_000;
const BATCH_SIZE = 5_000;
const LOG_INTERVAL = 100_000;
const RETRY_DELAY_MS = 5_000;
const THROTTLE_DELAY_MS = 10;

type PricePoint = {
  sku: string;
  price: number;
};

const SKUS = Array.from({ length: 50 }, (_, i) => `SKU-${String(i + 1).padStart(3, '0')}`);

export class DataWarmupService {
  private started = false;

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    while (true) {
      try {
        await this.ensureTables();
        await this.fillPriceHistory();
        await this.fillBehaviorLog();
        log.info({ targetRows: TARGET_ROWS }, 'Data warmup completed');
        return;
      } catch (error) {
        log.error({ error }, 'Data warmup failed, will retry');
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  private async ensureTables(): Promise<void> {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_price_history (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sku VARCHAR(32) NOT NULL,
        previous_price DECIMAL(10,2) NOT NULL,
        current_price DECIMAL(10,2) NOT NULL,
        change_reason VARCHAR(64) NOT NULL COMMENT 'PROMOTION / COST_ADJUST / SEASONAL / MANUAL',
        operator_id BIGINT NOT NULL DEFAULT 0,
        effective_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sku (sku)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      COMMENT='商品价格变更历史'
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_behavior_log (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        action_type VARCHAR(32) NOT NULL COMMENT 'PAGE_VIEW / ADD_CART / PLACE_ORDER / SEARCH',
        target_id VARCHAR(64) NOT NULL,
        target_type VARCHAR(32) NOT NULL COMMENT 'PRODUCT / ORDER / CATEGORY',
        ip_address VARCHAR(45),
        session_id VARCHAR(64),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      COMMENT='用户行为日志'
    `);
  }

  private async fillPriceHistory(): Promise<void> {
    const pool = getPool();
    let current = await countTable('product_price_history');
    if (current >= TARGET_ROWS) {
      return;
    }

    let pricePoints = await this.loadPricePoints();
    if (pricePoints.length === 0) {
      pricePoints = SKUS.map((sku) => ({ sku, price: randomBetween(29, 2999) }));
    }

    while (current < TARGET_ROWS) {
      const batchSize = Math.min(BATCH_SIZE, TARGET_ROWS - current);
      const values: Array<string | number | Date> = [];
      const placeholders: string[] = [];

      for (let i = 0; i < batchSize; i++) {
        const point = pricePoints[Math.floor(Math.random() * pricePoints.length)];
        const previousPrice = round2(point.price);
        const ratio = Math.random() < 0.5 ? 1 - randomBetween(0.05, 0.2) : 1 + randomBetween(0.05, 0.2);
        const currentPrice = round2(previousPrice * ratio);
        const reason = pickWeighted([
          ['PROMOTION', 0.4],
          ['COST_ADJUST', 0.25],
          ['SEASONAL', 0.25],
          ['MANUAL', 0.1],
        ]);
        const operatorId = Math.floor(Math.random() * 10) + 1;
        const effectiveAt = randomPastDate(3 * 365 * 24 * 3600);

        placeholders.push('(?,?,?,?,?,?)');
        values.push(point.sku, previousPrice, currentPrice, reason, operatorId, effectiveAt);
      }

      await pool.query(
        `INSERT INTO product_price_history (sku, previous_price, current_price, change_reason, operator_id, effective_at)
         VALUES ${placeholders.join(',')}`,
        values,
      );
      current += batchSize;

      if (current % LOG_INTERVAL < batchSize) {
        log.info(
          {
            table: 'product_price_history',
            current,
            target: TARGET_ROWS,
            progressPct: Number(((current / TARGET_ROWS) * 100).toFixed(1)),
          },
          'Warmup progress',
        );
      }

      await sleep(THROTTLE_DELAY_MS);
    }
  }

  private async fillBehaviorLog(): Promise<void> {
    const pool = getPool();
    let current = await countTable('user_behavior_log');
    if (current >= TARGET_ROWS) {
      return;
    }

    while (current < TARGET_ROWS) {
      const batchSize = Math.min(BATCH_SIZE, TARGET_ROWS - current);
      const values: Array<string | number | Date> = [];
      const placeholders: string[] = [];

      for (let i = 0; i < batchSize; i++) {
        const userId = Math.floor(Math.random() * 20) + 1;
        const actionType = pickWeighted([
          ['PAGE_VIEW', 0.6],
          ['ADD_CART', 0.2],
          ['PLACE_ORDER', 0.15],
          ['SEARCH', 0.05],
        ]);

        let targetType = 'PRODUCT';
        let targetId = SKUS[Math.floor(Math.random() * SKUS.length)];
        if (actionType === 'PLACE_ORDER') {
          targetType = 'ORDER';
          targetId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        } else if (actionType === 'SEARCH') {
          targetType = 'CATEGORY';
          targetId = `CAT-${Math.floor(Math.random() * 20) + 1}`;
        }

        const ipAddress = `10.0.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
        const sessionId = randomUUID();
        const createdAt = randomPastDate(365 * 24 * 3600);

        placeholders.push('(?,?,?,?,?,?,?)');
        values.push(userId, actionType, targetId, targetType, ipAddress, sessionId, createdAt);
      }

      await pool.query(
        `INSERT INTO user_behavior_log (user_id, action_type, target_id, target_type, ip_address, session_id, created_at)
         VALUES ${placeholders.join(',')}`,
        values,
      );
      current += batchSize;

      if (current % LOG_INTERVAL < batchSize) {
        log.info(
          {
            table: 'user_behavior_log',
            current,
            target: TARGET_ROWS,
            progressPct: Number(((current / TARGET_ROWS) * 100).toFixed(1)),
          },
          'Warmup progress',
        );
      }

      await sleep(THROTTLE_DELAY_MS);
    }
  }

  private async loadPricePoints(): Promise<PricePoint[]> {
    const pool = getPool();
    const [rows] = await pool.query('SELECT sku, price FROM products WHERE sku IS NOT NULL');
    return (rows as Record<string, unknown>[]).map((row) => ({
      sku: String(row.sku),
      price: Number(row.price),
    }));
  }
}

async function countTable(table: string): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM ${table}`);
  return Number((rows as Record<string, unknown>[])[0]?.cnt ?? 0);
}

function pickWeighted<T extends string>(entries: Array<[T, number]>): T {
  const rand = Math.random();
  let cumulative = 0;
  for (const [value, weight] of entries) {
    cumulative += weight;
    if (rand <= cumulative) {
      return value;
    }
  }
  return entries[0][0];
}

function randomPastDate(maxPastSeconds: number): Date {
  const seconds = Math.floor(Math.random() * maxPastSeconds);
  return new Date(Date.now() - seconds * 1000);
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let singleton: DataWarmupService | null = null;

export function getDataWarmupService(): DataWarmupService {
  if (!singleton) {
    singleton = new DataWarmupService();
  }
  return singleton;
}
