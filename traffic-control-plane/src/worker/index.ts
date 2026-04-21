import { getRunnerEngine } from './runner-engine';
import { getInventoryResetScheduler } from './inventory-reset';
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

  log.info('Worker is running. Press Ctrl+C to stop.');

  process.on('SIGINT', () => {
    log.info('Shutting down worker...');
    engine.stop();
    resetScheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log.info('Shutting down worker...');
    engine.stop();
    resetScheduler.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error({ error: err }, 'Worker failed to start');
  process.exit(1);
});
