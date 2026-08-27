import { env } from './env';
import { parseLifecycleAccounts } from './lifecycle-accounts';

export interface ExerciseAccount {
  label: string;
  email: string;
  password: string;
  expectedCustomerId?: number;
  enabled: boolean;
}

export function loadExerciseAccounts(): ExerciseAccount[] {
  return parseExerciseAccounts(env.TRAFFIC_EXERCISE_ACCOUNTS);
}

export function parseExerciseAccounts(raw: string): ExerciseAccount[] {
  try {
    const accounts = parseLifecycleAccounts(raw);
    const exerciseAccounts = accounts.map((account) => ({ ...account }));
    const sam = exerciseAccounts.find((account) => account.expectedCustomerId === 19
      || account.email === 'sam@example.com');
    if (!sam || sam.expectedCustomerId !== 19 || sam.email !== 'sam@example.com') {
      throw new Error('INVALID_TRAFFIC_EXERCISE_ACCOUNTS');
    }
    return exerciseAccounts;
  } catch {
    throw new Error('INVALID_TRAFFIC_EXERCISE_ACCOUNTS');
  }
}
