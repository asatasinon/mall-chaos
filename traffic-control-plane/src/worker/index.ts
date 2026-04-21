import { getRunnerEngine } from './runner-engine';
import { getInventoryResetScheduler } from './inventory-reset';
import { getDataWarmupService } from './data-warmup';
import { env } from '../lib/env';
import pino from 'pino';

const log = pino({ name: 'worker' });

async function main() {
  log.info('Starting traffic-control-plane worker...');

  const engine = getRunnerEngine();
  await engine.loadConfigFromDb();
  engine.start();

  const resetScheduler = getInventoryResetScheduler();
  await resetScheduler.loadPolicy();
  resetScheduler.start();

  if (env.DATA_WARMUP_ENABLED) {
    getDataWarmupService().start();
    log.info('Data warmup started');
  } else {
    log.info('Data warmup is disabled by DATA_WARMUP_ENABLED=false');
  }

  const syncTimer = setInterval(async () => {
    try {
      await resetScheduler.syncIfNeeded();
    } catch (err) {
      log.warn({ error: err }, 'Failed to sync worker control state');
    }
  }, 1000);

  log.info('Worker is running. Press Ctrl+C to stop.');

  process.on('SIGINT', () => {
    log.info('Shutting down worker...');
    clearInterval(syncTimer);
    engine.stop();
    resetScheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log.info('Shutting down worker...');
    clearInterval(syncTimer);
    engine.stop();
    resetScheduler.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error({ error: err }, 'Worker failed to start');
  process.exit(1);
});
