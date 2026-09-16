import { jsonError, jsonOk } from '@/lib/api-response';
import { loadWarmupProgress } from '@/worker/data-warmup';
import { loadDataWarmupConfig } from '@/lib/data-warmup-config';

export async function GET() {
  try {
    const [tables, config] = await Promise.all([loadWarmupProgress(), loadDataWarmupConfig()]);
    return jsonOk({
      status: config.enabled
        ? tables.some((table) => table.status === 'ERROR') ? 'ERROR'
          : tables.some((table) => table.status === 'BACKFILLING') ? 'BACKFILLING'
            : tables.some((table) => table.status === 'APPENDING') ? 'APPENDING' : 'ROLLOVER_CLEANUP'
        : 'DISABLED',
      config,
      tables,
    });
  } catch {
    return jsonError(503, 'Data warmup progress is unavailable', 503);
  }
}
