import { jsonError, jsonOk } from '@/lib/api-response';
import { loadWarmupProgress } from '@/worker/data-warmup';
import { env } from '@/lib/env';

export async function GET() {
  try {
    const tables = await loadWarmupProgress();
    return jsonOk({
      status: tables.some((table) => table.status === 'ERROR') ? 'ERROR' : tables.some((table) => table.status === 'BACKFILLING') ? 'BACKFILLING' : tables.some((table) => table.status === 'APPENDING') ? 'APPENDING' : 'ROLLOVER_CLEANUP',
      windowDays: env.DATA_WARMUP_WINDOW_DAYS,
      rowsPerDay: env.DATA_WARMUP_ROWS_PER_DAY,
      targetRows: env.DATA_WARMUP_TARGET_ROWS,
      tables,
    });
  } catch {
    return jsonError(503, 'Data warmup progress is unavailable', 503);
  }
}
