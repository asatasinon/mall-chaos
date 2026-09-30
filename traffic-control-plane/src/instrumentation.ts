import { readScenarioContractWebConfig } from './lib/scenario-contract-web-config';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  readScenarioContractWebConfig();
}
