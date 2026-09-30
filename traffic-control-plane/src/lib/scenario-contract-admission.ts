import pino from 'pino';
import { FaultRunRecoveryPolicyInvariantError } from './fault-run-recovery-policy';
import {
  CATALOG_REVISION_PATTERN,
  CatalogRevisionError,
  getCatalogRevision,
} from './fault-run-catalog-revision';
import type { FaultRunScenarioDefinition } from './fault-run-catalog';
import {
  getScenarioContractRevision,
  resolveScenarioContract,
  SCENARIO_CONTRACT_REVISION_PATTERN,
  ScenarioContractRevisionError,
  type ResolvedScenarioContract,
} from './scenario-contract';
import type { ScenarioContractIssueCategory } from './scenario-contract-validator';

export type ScenarioContractValidationMode = 'warn' | 'enforce';
export type ScenarioContractDeploymentScope = 'disposable' | 'retained';

export interface ScenarioContractAdmissionConfig {
  validationMode: ScenarioContractValidationMode;
  deploymentScope: ScenarioContractDeploymentScope;
}

export interface RuntimeScenarioContractIssue {
  category: ScenarioContractIssueCategory;
  code: string;
}

export interface RuntimeScenarioContractValidation {
  contractRevision: string;
  catalogRevision: string;
  issues: readonly RuntimeScenarioContractIssue[];
}

export interface ScenarioContractAdmissionLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export class ScenarioContractAdmissionError extends Error {
  constructor(public readonly code:
    | 'SCENARIO_CONTRACT_INVALID'
    | 'SCENARIO_CONTRACT_DEPLOYMENT_SCOPE_RESTRICTED') {
    super(code);
    this.name = 'ScenarioContractAdmissionError';
  }
}

const admissionLog: ScenarioContractAdmissionLogger = pino({ name: 'scenario-contract-admission' });

export function validateRuntimeContract(
  definition: FaultRunScenarioDefinition,
  normalizedParameters: Readonly<Record<string, number | string>>,
): RuntimeScenarioContractValidation {
  let contract: Readonly<ResolvedScenarioContract>;
  try {
    contract = resolveScenarioContract(definition);
  } catch (error) {
    if (error instanceof FaultRunRecoveryPolicyInvariantError) {
      throw new ScenarioContractAdmissionError('SCENARIO_CONTRACT_INVALID');
    }
    throw error;
  }

  const issues = validateResolvedContract(contract, normalizedParameters);
  let contractRevision: string;
  try {
    contractRevision = getScenarioContractRevision(contract);
  } catch (error) {
    if (error instanceof ScenarioContractRevisionError) {
      throw new ScenarioContractAdmissionError('SCENARIO_CONTRACT_INVALID');
    }
    throw error;
  }
  if (!SCENARIO_CONTRACT_REVISION_PATTERN.test(contractRevision)) {
    throw new ScenarioContractAdmissionError('SCENARIO_CONTRACT_INVALID');
  }
  let catalogRevision: string;
  try {
    catalogRevision = getCatalogRevision();
  } catch (error) {
    if (error instanceof CatalogRevisionError) {
      throw new ScenarioContractAdmissionError('SCENARIO_CONTRACT_INVALID');
    }
    throw error;
  }
  if (!CATALOG_REVISION_PATTERN.test(catalogRevision)) {
    throw new ScenarioContractAdmissionError('SCENARIO_CONTRACT_INVALID');
  }

  return {
    contractRevision,
    catalogRevision,
    issues,
  };
}

export function admitScenarioContract(
  definition: FaultRunScenarioDefinition,
  normalizedParameters: Readonly<Record<string, number | string>>,
  config: ScenarioContractAdmissionConfig,
  logger: ScenarioContractAdmissionLogger = admissionLog,
): RuntimeScenarioContractValidation {
  if ((config.validationMode !== 'warn' && config.validationMode !== 'enforce')
    || (config.deploymentScope !== 'disposable' && config.deploymentScope !== 'retained')) {
    throw new Error('SCENARIO_CONTRACT_ADMISSION_CONFIG_INVALID');
  }
  if (definition.scenario === 'NOTIFICATION_HEAP_PRESSURE'
    && config.deploymentScope !== 'disposable') {
    throw new ScenarioContractAdmissionError('SCENARIO_CONTRACT_DEPLOYMENT_SCOPE_RESTRICTED');
  }

  const validation = validateRuntimeContract(definition, normalizedParameters);
  if (validation.issues.length === 0) return validation;
  if (config.validationMode === 'enforce') {
    throw new ScenarioContractAdmissionError('SCENARIO_CONTRACT_INVALID');
  }

  const categories = new Set(validation.issues.map(({ category }) => category));
  for (const category of categories) {
    logger.warn({
      category,
      scenario: definition.scenario,
      contractRevision: validation.contractRevision,
      mode: config.validationMode,
    }, 'Scenario contract validation warning');
  }
  return validation;
}

function validateResolvedContract(
  contract: Readonly<ResolvedScenarioContract>,
  normalizedParameters: Readonly<Record<string, number | string>>,
): RuntimeScenarioContractIssue[] {
  const issues: RuntimeScenarioContractIssue[] = [];
  const parameterNames = contract.parameters.map(({ name }) => name);
  const parameterNameSet = new Set(parameterNames);
  const consumerEntries = Object.entries(contract.parameterConsumers);
  const consumerNames = new Set(consumerEntries.map(([name]) => name));

  if (contract.schemaVersion !== 'scenario-contract.v1'
    || parameterNameSet.size !== parameterNames.length
    || consumerNames.size !== parameterNameSet.size
    || parameterNames.some((name) => !consumerNames.has(name))
    || consumerEntries.some(([name, consumers]) => (
      !parameterNameSet.has(name)
      || !Array.isArray(consumers)
      || consumers.length === 0
      || new Set(consumers).size !== consumers.length
      || !consumers.includes('ADMISSION')
      || consumers.some((consumer) => !['ADMISSION', 'TARGET_PREPARE', 'WORKER_EXECUTION'].includes(consumer))
    ))
    || parameterNames.some((name) => !Object.prototype.hasOwnProperty.call(normalizedParameters, name))) {
    issues.push({ category: 'invalidParameters', code: 'RUNTIME_PARAMETER_CONTRACT_INVALID' });
  }

  const recipeIds = contract.evidence.recipes.map(({ id }) => id);
  const recipeIdSet = new Set(recipeIds);
  if (contract.evidence.schemaVersion !== 'evidence-contract.v1'
    || recipeIdSet.size !== recipeIds.length
    || contract.evidence.effectRule.recipeIds.length === 0
    || contract.evidence.effectRule.recipeIds.some((id) => !recipeIdSet.has(id))) {
    issues.push({ category: 'missingEvidenceQuery', code: 'RUNTIME_EVIDENCE_CONTRACT_INVALID' });
  }

  if (contract.alert.receiptPolicyId !== 'alert-receipt.v1') {
    issues.push({ category: 'invalidAlertContract', code: 'RUNTIME_ALERT_CONTRACT_INVALID' });
  }
  return issues;
}
