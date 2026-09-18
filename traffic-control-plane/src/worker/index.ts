import pino from 'pino';
import { createWorkerRuntime, type WorkerShutdownReason } from './worker-runtime';

const log = pino({ name: 'worker' });

async function main(): Promise<void> {
  const runtime = createWorkerRuntime();
  const shutdown = (reason: WorkerShutdownReason): void => {
    void runtime.shutdown(reason).then(
      (exitCode) => {
        process.exitCode = exitCode;
        process.exit(exitCode);
      },
      (error) => {
        log.error({ code: shutdownErrorCode(error) }, 'Worker shutdown failed');
        process.exitCode = 1;
        process.exit(1);
      },
    );
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await runtime.start();
  } catch (error) {
    log.error({ code: shutdownErrorCode(error) }, 'Worker failed to start');
    const shutdownExitCode = await runtime.shutdown('STARTUP_FAILURE');
    process.exitCode = 1;
    process.exit(Math.max(1, shutdownExitCode));
  }
}

function shutdownErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_.:-]{0,95}$/.test(error.message)
    ? error.message
    : 'WORKER_STARTUP_FAILED';
}

void main();
