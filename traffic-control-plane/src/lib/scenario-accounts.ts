import { env } from './env';
import { parseLifecycleAccounts } from './lifecycle-accounts';

export interface ScenarioAccount {
  label: string;
  email: string;
  password: string;
  expectedCustomerId?: number;
  enabled: boolean;
}

export function loadScenarioAccounts(): ScenarioAccount[] {
  return parseScenarioAccounts(env.TRAFFIC_SCENARIO_ACCOUNTS);
}

export function parseScenarioAccounts(raw: string): ScenarioAccount[] {
  try {
    const accounts = parseLifecycleAccounts(raw);
    const scenarioAccounts = accounts.map((account) => ({ ...account }));
    const sam = scenarioAccounts.find((account) => account.expectedCustomerId === 19
      || account.email === 'sam@example.com');
    if (!sam || sam.expectedCustomerId !== 19 || sam.email !== 'sam@example.com') {
      throw new Error('INVALID_TRAFFIC_SCENARIO_ACCOUNTS');
    }
    return scenarioAccounts;
  } catch {
    throw new Error('INVALID_TRAFFIC_SCENARIO_ACCOUNTS');
  }
}