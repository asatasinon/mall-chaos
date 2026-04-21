import { jsonOk } from '@/lib/api-response';
import { getPool } from '@/lib/db';

const TARGET_ROWS = 30_000_000;

export async function GET() {
  const pool = getPool();

  const countTable = async (table: string) => {
    try {
      const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM ${table}`);
      return Number((rows as any[])[0]?.cnt ?? 0);
    } catch {
      return 0;
    }
  };

  const [priceHistoryCount, behaviorLogCount] = await Promise.all([
    countTable('product_price_history'),
    countTable('user_behavior_log'),
  ]);

  const completed = priceHistoryCount >= TARGET_ROWS && behaviorLogCount >= TARGET_ROWS;

  return jsonOk({
    priceHistoryCount,
    priceHistoryTarget: TARGET_ROWS,
    behaviorLogCount,
    behaviorLogTarget: TARGET_ROWS,
    completed,
    status: completed ? 'COMPLETED' : 'RUNNING',
  });
}
