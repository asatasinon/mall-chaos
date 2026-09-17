import crypto from 'node:crypto';
import { getPool } from './db';

export type AlertReceiptStatus = 'firing' | 'resolved';

export interface AlertReceiptInput {
  fingerprint: string;
  status: AlertReceiptStatus;
  receiver: string;
  alertName: string;
  severity: 'critical' | 'warning' | 'info' | 'unknown';
  service: string | null;
  startsAt: Date;
  endsAt: Date | null;
}

export interface AlertReceiptSaveResult {
  accepted: number;
  duplicates: number;
}

export const ALERT_RECEIPT_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS alert_receipts (
    receipt_id       BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    receipt_key      CHAR(64)     NOT NULL,
    fingerprint      VARCHAR(128) NOT NULL,
    alert_status     VARCHAR(16)  NOT NULL,
    receiver         VARCHAR(128) NOT NULL,
    alert_name       VARCHAR(128) NOT NULL,
    severity         VARCHAR(16)  NOT NULL,
    service_name     VARCHAR(128) NULL,
    starts_at        DATETIME(3)  NOT NULL,
    ends_at          DATETIME(3)  NULL,
    received_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_alert_receipt_key (receipt_key),
    INDEX idx_alert_receipt_fingerprint (fingerprint, received_at),
    INDEX idx_alert_receipt_status (alert_status, received_at),
    CHECK (alert_status IN ('firing', 'resolved')),
    CHECK (severity IN ('critical', 'warning', 'info', 'unknown'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
] as const;

let schemaPromise: Promise<void> | null = null;

export function ensureAlertReceiptSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const pool = getPool();
      for (const statement of ALERT_RECEIPT_SCHEMA_STATEMENTS) await pool.query(statement);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function saveAlertReceipts(
  receipts: readonly AlertReceiptInput[],
): Promise<AlertReceiptSaveResult> {
  await ensureAlertReceiptSchema();
  const connection = await getPool().getConnection();
  let accepted = 0;
  let duplicates = 0;
  try {
    await connection.beginTransaction();
    for (const receipt of receipts) {
      const receiptKey = createReceiptKey(receipt);
      const [result] = await connection.execute(
        `INSERT INTO alert_receipts
          (receipt_key, fingerprint, alert_status, receiver, alert_name, severity,
           service_name, starts_at, ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE receipt_key = VALUES(receipt_key)`,
        [
          receiptKey,
          receipt.fingerprint,
          receipt.status,
          receipt.receiver,
          receipt.alertName,
          receipt.severity,
          receipt.service,
          receipt.startsAt,
          receipt.endsAt,
        ],
      );
      if (Number((result as { affectedRows?: number }).affectedRows ?? 0) === 1) accepted++;
      else duplicates++;
    }
    await connection.commit();
    return { accepted, duplicates };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function createReceiptKey(receipt: AlertReceiptInput): string {
  return crypto.createHash('sha256')
    .update([
      receipt.fingerprint,
      receipt.status,
      receipt.startsAt.toISOString(),
      receipt.endsAt?.toISOString() ?? '',
    ].join('|'))
    .digest('hex');
}
