import { getRunnerEngine } from './runner-engine';
import { getDataWarmupService } from './data-warmup';
import { env } from '../lib/env';
import { loadLifecycleAccounts } from '../lib/lifecycle-accounts';
import { getCouponReplenishmentScheduler } from './coupon-replenishment';
import { getInventoryReplenishmentScheduler } from './inventory-replenishment';
import { getReportScenarioWorker } from './report-scenario-worker';
import { getTrafficSurgeExecutor } from './traffic-surge-executor';
import { getScenarioWorkers } from './scenario-workers';
import pino from 'pino';
import { getFaultRunCoordinator } from '../lib/fault-run-coordinator';
import { deleteExpiredFaultRuns } from '../lib/fault-run-repository';
import { getRedis } from '../lib/redis';

const log = pino({ name: 'worker' });

async function main() {
  log.info('Starting traffic-control-plane worker...');

  if (!env.CASTREL_INTERNAL_SERVICE_KEY.trim()) {
    throw new Error('INTERNAL_SERVICE_KEY_REQUIRED');
  }
  loadLifecycleAccounts();

  const engine = getRunnerEngine();
  await engine.loadConfigFromDb();
  const faultRunCoordinator = getFaultRunCoordinator();
  await faultRunCoordinator.scheduleActiveRuns();
  await faultRunCoordinator.recoverExpiredRuns();
  const couponReplenishmentScheduler = getCouponReplenishmentScheduler();
  const inventoryReplenishmentScheduler = getInventoryReplenishmentScheduler();
  const reportScenarioWorker = getReportScenarioWorker();
  const trafficSurgeExecutor = getTrafficSurgeExecutor();
  const scenarioWorkers = getScenarioWorkers();
  const dataWarmupService = getDataWarmupService();
  await couponReplenishmentScheduler.start();
  await inventoryReplenishmentScheduler.start();
  reportScenarioWorker.start();
  trafficSurgeExecutor.start();
  scenarioWorkers.start();
  const faultRunRecoveryTimer = setInterval(() => {
    void faultRunCoordinator.recoverExpiredRuns().catch((error) => {
      log.warn({ error }, 'Failed to recover expired Fault Runs');
    });
  }, 1000);
  const faultRunRetentionTimer = setInterval(() => {
    void runFaultRunRetention().catch((error) => {
      log.warn({ error }, 'Failed to delete expired Fault Run records');
    });
  }, 24 * 60 * 60 * 1000);
  engine.start();

  if (env.DATA_WARMUP_ENABLED) {
    dataWarmupService.start();
    log.info('Data warmup started');
  } else {
    log.info('Data warmup is disabled by DATA_WARMUP_ENABLED=false');
  }

  log.info('Worker is running. Press Ctrl+C to stop.');

  const shutdown = async () => {
    log.info('Shutting down worker...');
    clearInterval(faultRunRecoveryTimer);
    clearInterval(faultRunRetentionTimer);
    inventoryReplenishmentScheduler.stop();
    await reportScenarioWorker.stop();
    await trafficSurgeExecutor.stop();
    await scenarioWorkers.stop();
    couponReplenishmentScheduler.stop();
    await dataWarmupService.stop();
    await engine.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

const FAULT_RUN_RETENTION_LOCK = 'traffic-control-plane:fault-run-retention:lease';

async function runFaultRunRetention(): Promise<void> {
  const redis = getRedis();
  await redis.connect().catch(() => undefined);
  const owner = `retention-${process.pid}`;
  const acquired = await redis.set(FAULT_RUN_RETENTION_LOCK, owner, 'EX', 300, 'NX').catch(() => null);
  if (acquired !== 'OK') return;
  try {
    await deleteExpiredFaultRuns();
  } finally {
    await redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      FAULT_RUN_RETENTION_LOCK,
      owner,
    ).catch(() => undefined);
  }
}

main().catch((err) => {
  log.error({ error: err }, 'Worker failed to start');
  process.exit(1);
});
