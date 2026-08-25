import { getRunnerEngine } from './runner-engine';
import { getDataWarmupService } from './data-warmup';
import { env } from '../lib/env';
import { loadLifecycleAccounts } from '../lib/lifecycle-accounts';
import pino from 'pino';

const log = pino({ name: 'worker' });

async function main() {
  log.info('Starting traffic-control-plane worker...');

  if (env.TRAFFIC_LIFECYCLE_LOGIN_ENABLED) {
    loadLifecycleAccounts();
  }

  const engine = getRunnerEngine();
  await engine.loadConfigFromDb();
  engine.start();

  if (env.DATA_WARMUP_ENABLED) {
    getDataWarmupService().start();
    log.info('Data warmup started');
  } else {
    log.info('Data warmup is disabled by DATA_WARMUP_ENABLED=false');
  }

  log.info('Worker is running. Press Ctrl+C to stop.');

  process.on('SIGINT', () => {
    log.info('Shutting down worker...');
    engine.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log.info('Shutting down worker...');
    engine.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error({ error: err }, 'Worker failed to start');
  process.exit(1);
});
