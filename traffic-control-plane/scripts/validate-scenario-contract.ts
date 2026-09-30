import { pathToFileURL } from 'node:url';
import {
  executeScenarioContractCli,
  parseScenarioContractCliArguments,
  ScenarioContractCliError,
} from '../src/lib/scenario-contract-cli';
import { ScenarioContractCliFactsError } from '../src/lib/scenario-contract-cli-facts';

export async function mainScenarioContractCli(argv: readonly string[]): Promise<void> {
  try {
    const options = parseScenarioContractCliArguments(argv);
    const result = await executeScenarioContractCli(options);
    process.stdout.write(result.textReport);
    process.exitCode = result.exitCode;
  } catch (error: unknown) {
    if (error instanceof ScenarioContractCliError
      || error instanceof ScenarioContractCliFactsError) {
      process.stderr.write(`${error.code}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void mainScenarioContractCli(process.argv.slice(2));
}
