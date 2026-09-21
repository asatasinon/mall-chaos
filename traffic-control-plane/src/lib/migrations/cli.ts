import { closePool } from '../db';
import { applyMigrations, verifyMigrations } from './run';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'verify';
  const result = command === 'apply'
    ? await applyMigrations()
    : command === 'verify'
      ? await verifyMigrations()
      : (() => { throw new Error(`UNKNOWN_MIGRATION_COMMAND:${command}`); })();
  console.log(JSON.stringify(result));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closePool());
