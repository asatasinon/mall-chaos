import type { ScenarioContractAdmissionConfig } from './scenario-contract-admission';

export class ScenarioContractWebConfigError extends Error {
  constructor(public readonly code:
    | 'SCENARIO_CONTRACT_VALIDATION_MODE_INVALID'
    | 'SCENARIO_CONTRACT_DEPLOYMENT_SCOPE_INVALID') {
    super(code);
    this.name = 'ScenarioContractWebConfigError';
  }
}

export function parseScenarioContractWebConfig(
  source: Record<string, string | undefined>,
): ScenarioContractAdmissionConfig {
  const validationMode = source.SCENARIO_CONTRACT_VALIDATION_MODE ?? 'warn';
  if (validationMode !== 'warn' && validationMode !== 'enforce') {
    throw new ScenarioContractWebConfigError('SCENARIO_CONTRACT_VALIDATION_MODE_INVALID');
  }

  const deploymentScope = source.SCENARIO_CONTRACT_DEPLOYMENT_SCOPE ?? 'retained';
  if (deploymentScope !== 'disposable' && deploymentScope !== 'retained') {
    throw new ScenarioContractWebConfigError('SCENARIO_CONTRACT_DEPLOYMENT_SCOPE_INVALID');
  }

  return { validationMode, deploymentScope };
}

export function readScenarioContractWebConfig(
  source: Record<string, string | undefined> = process.env,
): ScenarioContractAdmissionConfig {
  return parseScenarioContractWebConfig(source);
}
