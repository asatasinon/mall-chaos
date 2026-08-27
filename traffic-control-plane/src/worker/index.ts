import { getRunnerEngine } from './runner-engine';
import { getDataWarmupService } from './data-warmup';
import { env } from '../lib/env';
import { loadLifecycleAccounts } from '../lib/lifecycle-accounts';
import {
  consumeReplenishmentCommand,
  setCouponReplenishmentStatus,
  setInventoryReplenishmentStatus,
} from '../lib/runtime-state';
import { getCouponReplenishmentScheduler } from './coupon-replenishment';
import { getInventoryReplenishmentScheduler } from './inventory-replenishment';
import { getReportExerciseWorker } from './report-exercise-worker';
import { getTrafficSurgeExecutor } from './traffic-surge-executor';
import { getScenarioExerciseWorkers } from './scenario-exercise-workers';
import pino from 'pino';
import { getFaultRunCoordinator } from '../lib/fault-run-coordinator';
import { deleteExpiredFaultRuns } from '../lib/fault-run-repository';

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
  const reportExerciseWorker = getReportExerciseWorker();
  const trafficSurgeExecutor = getTrafficSurgeExecutor();
  const scenarioExerciseWorkers = getScenarioExerciseWorkers();
  await couponReplenishmentScheduler.start();
  await inventoryReplenishmentScheduler.start();
  reportExerciseWorker.start();
  trafficSurgeExecutor.start();
  scenarioExerciseWorkers.start();
  let processingReplenishmentCommand = false;
  const replenishmentCommandTimer = setInterval(() => {
    if (processingReplenishmentCommand) return;
    processingReplenishmentCommand = true;
    void processReplenishmentCommands(
      couponReplenishmentScheduler,
      inventoryReplenishmentScheduler,
    )
      .catch((error) => {
        log.warn({ error }, 'Failed to poll replenishment commands');
      })
      .finally(() => {
        processingReplenishmentCommand = false;
      });
  }, 1000);
  const inventoryStatusTimer = setInterval(() => {
    void setInventoryReplenishmentStatus(inventoryReplenishmentScheduler.getStatus());
    void setCouponReplenishmentStatus(couponReplenishmentScheduler.getStatus());
  }, 1000);
  const faultRunRecoveryTimer = setInterval(() => {
    void faultRunCoordinator.recoverExpiredRuns().catch((error) => {
      log.warn({ error }, 'Failed to recover expired Fault Runs');
    });
  }, 1000);
  const faultRunRetentionTimer = setInterval(() => {
    void deleteExpiredFaultRuns().catch((error) => {
      log.warn({ error }, 'Failed to delete expired Fault Run records');
    });
  }, 24 * 60 * 60 * 1000);
  await setInventoryReplenishmentStatus(inventoryReplenishmentScheduler.getStatus());
  await setCouponReplenishmentStatus(couponReplenishmentScheduler.getStatus());
  engine.start();

  if (env.DATA_WARMUP_ENABLED) {
    getDataWarmupService().start();
    log.info('Data warmup started');
  } else {
    log.info('Data warmup is disabled by DATA_WARMUP_ENABLED=false');
  }

  log.info('Worker is running. Press Ctrl+C to stop.');

  const shutdown = async () => {
    log.info('Shutting down worker...');
    clearInterval(replenishmentCommandTimer);
    clearInterval(inventoryStatusTimer);
    clearInterval(faultRunRecoveryTimer);
    clearInterval(faultRunRetentionTimer);
    inventoryReplenishmentScheduler.stop();
    await reportExerciseWorker.stop();
    await trafficSurgeExecutor.stop();
    await scenarioExerciseWorkers.stop();
    void setInventoryReplenishmentStatus(inventoryReplenishmentScheduler.getStatus());
    couponReplenishmentScheduler.stop();
    void setCouponReplenishmentStatus(couponReplenishmentScheduler.getStatus());
    await engine.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch((err) => {
  log.error({ error: err }, 'Worker failed to start');
  process.exit(1);
});

async function processReplenishmentCommands(
  couponScheduler: ReturnType<typeof getCouponReplenishmentScheduler>,
  inventoryScheduler: ReturnType<typeof getInventoryReplenishmentScheduler>,
): Promise<void> {
  while (true) {
    const command = await consumeReplenishmentCommand();
    if (!command) return;
    try {
      if (command.type === 'coupon') {
        await couponScheduler.executeCurrentWindow();
      } else {
        await inventoryScheduler.executeCurrentWindow();
      }
      log.info({ type: command.type, correlationId: command.correlationId }, 'Manual replenishment command completed');
    } catch (error) {
      log.error({ type: command.type, correlationId: command.correlationId, error }, 'Manual replenishment command failed');
    }
  }
}
