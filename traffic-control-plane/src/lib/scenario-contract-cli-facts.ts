import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import messages from '../i18n/messages';
import { SCENARIO_GROUPS, SCENARIO_META } from '../components/scenarios/meta';
import {
  FaultRunValidationError,
  listScenarioDefinitions,
  NOTIFICATION_STORAGE_MAX_FREE_BYTES,
  NOTIFICATION_STORAGE_MIN_FREE_BYTES,
  TRAFFIC_SURGE_MAX_CONCURRENCY,
  validateScenarioParameters,
  type FaultRunScenario,
  type FaultRunRecoveryPolicy,
} from './fault-run-catalog';
import { getCatalogRevision } from './fault-run-catalog-revision';
import { getTrafficScenarioTarget } from './fault-run-targets';
import {
  resolveScenarioContract,
  type ResolvedScenarioContract,
} from './scenario-contract';
import { parseScenarioContractDeploymentFacts } from './scenario-contract-deployment-facts';
import type {
  ScenarioAlertConfigurationFacts,
  ScenarioContractLocale,
  ScenarioContractValidationInput,
  ScenarioDispatchValidationDescriptor,
  ScenarioI18nFact,
  ScenarioParameterGuardFact,
  ScenarioParameterValidationFact,
  ScenarioRunbookHeadingId,
  ScenarioTargetContractFact,
} from './scenario-contract-validator';
import {
  SCENARIO_CONTRACT_REQUIRED_RUNBOOK_HEADINGS,
} from './scenario-contract-validator';
import { SCENARIO_CONTRACT_RUNBOOK_HEADING_TEXT } from './scenario-contract-runbook-headings';
import {
  RUNBOOK_METADATA,
} from './runbook';
import {
  FAULT_RUN_DRIVER_CAPABILITIES,
  faultRunDrainParticipantForOwner,
} from '../worker/fault-run-driver-capabilities';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const SCENARIO_CONTRACT_REPOSITORY_ROOT = path.resolve(PACKAGE_ROOT, '..');
const LOCALES = ['en', 'zh-CN'] as const satisfies readonly ScenarioContractLocale[];
const SAFE_ARTICLE_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;

const COMPOSE_SOURCES = {
  composeFile: 'docker-compose.yml',
  prometheusConfig: 'infra/prometheus/prometheus.yml',
  prometheusRules: 'infra/prometheus/rules/alert-rules.yml',
  alertmanagerConfig: 'infra/alertmanager/alertmanager.yml',
} as const;

const KUBERNETES_SOURCES = {
  prometheusManifest: 'k8s/infra/prometheus.yaml',
  prometheusRulesManifest: 'k8s/configmap/prometheus-alert-rules.yaml',
  alertmanagerManifest: 'k8s/infra/alertmanager.yaml',
} as const;

export class ScenarioContractCliFactsError extends Error {
  constructor(readonly code: 'STATIC_INPUT_MISSING' | 'STATIC_INPUT_UNREADABLE' | 'STATIC_INPUT_INVALID') {
    super(code);
    this.name = 'ScenarioContractCliFactsError';
  }
}

export interface ScenarioContractCliFacts {
  readonly validationFacts: Omit<
    ScenarioContractValidationInput,
    'stage' | 'sourceCommitSha' | 'requiredCheckIds' | 'checkResults'
  >;
  readonly runbookArticles: readonly {
    readonly scenario: FaultRunScenario;
    readonly articleFile: string;
  }[];
}

export interface ScenarioContractGatewayExpectation {
  readonly schemaVersion: 'scenario-contract-gateway.v1';
  readonly catalogRevision: string;
  readonly operations: readonly {
    readonly scenario: FaultRunScenario;
    readonly operation: string;
    readonly service: string;
    readonly targetPrepare: 'REQUIRED';
    readonly targetRelease: FaultRunRecoveryPolicy['targetRelease'];
    readonly cleanup: FaultRunRecoveryPolicy['cleanup'];
  }[];
}

export async function loadScenarioContractCliFacts(
  repositoryRoot = SCENARIO_CONTRACT_REPOSITORY_ROOT,
): Promise<ScenarioContractCliFacts> {
  const definitions = listScenarioDefinitions()
    .sort((left, right) => compareText(left.scenario, right.scenario));
  const contracts = definitions.map((definition) => resolveScenarioContract(definition));
  const catalogRevision = getCatalogRevision(definitions);
  const [runbookCoverage, alertConfiguration] = await Promise.all([
    readRunbookCoverage(repositoryRoot, contracts),
    readDeploymentAlertConfiguration(repositoryRoot),
  ]);

  return {
    validationFacts: {
      scope: 'STATIC_CONTRACT',
      catalogRevision,
      catalogScenarios: definitions.map(({ scenario }) => scenario),
      contracts,
      dispatchCapabilities: buildDispatchCapabilities(),
      targetFacts: buildTargetFacts(contracts),
      parameterValidationFacts: buildParameterValidationFacts(contracts),
      parameterGuardFacts: buildParameterGuardFacts(contracts),
      evidenceTemplateIds: [...new Set(contracts.flatMap(
        (contract) => contract.evidence.recipes.map(({ template }) => template),
      ))].sort(compareText),
      runbookFacts: runbookCoverage.facts,
      i18nFacts: buildI18nFacts(contracts),
      alertConfiguration,
    },
    runbookArticles: runbookCoverage.articles,
  };
}

export function createScenarioContractValidationInput(
  facts: ScenarioContractCliFacts,
  options: {
    readonly stage: ScenarioContractValidationInput['stage'];
    readonly sourceCommitSha: string | null;
    readonly requiredCheckIds: readonly string[];
    readonly checkResults: ScenarioContractValidationInput['checkResults'];
  },
): ScenarioContractValidationInput {
  return {
    ...facts.validationFacts,
    stage: options.stage,
    sourceCommitSha: options.sourceCommitSha,
    requiredCheckIds: [...options.requiredCheckIds],
    checkResults: [...options.checkResults],
  };
}

export function createScenarioContractGatewayExpectation(
  facts: ScenarioContractCliFacts,
): ScenarioContractGatewayExpectation {
  const { catalogRevision, contracts } = facts.validationFacts;
  return {
    schemaVersion: 'scenario-contract-gateway.v1',
    catalogRevision,
    operations: contracts
      .filter(({ targetLifecycleMode }) => targetLifecycleMode === 'GATEWAY')
      .map((contract) => {
        if (contract.targetPrepare !== 'REQUIRED') {
          throw new ScenarioContractCliFactsError('STATIC_INPUT_INVALID');
        }
        return {
          scenario: contract.scenario,
          operation: contract.targetOperation,
          service: contract.targetService,
          targetPrepare: contract.targetPrepare,
          targetRelease: contract.recoveryPolicy.targetRelease,
          cleanup: contract.recoveryPolicy.cleanup,
        };
      })
      .sort((left, right) => compareText(left.scenario, right.scenario)),
  };
}

async function readRunbookCoverage(
  repositoryRoot: string,
  contracts: readonly ResolvedScenarioContract[],
): Promise<{
  readonly facts: ScenarioContractValidationInput['runbookFacts'];
  readonly articles: readonly { readonly scenario: FaultRunScenario; readonly articleFile: string }[];
}> {
  const results = await Promise.all(contracts.map(async (contract) => {
    const metadata = RUNBOOK_METADATA[contract.scenario];
    const articleFile = metadata?.articleFile;
    const allowlisted = typeof articleFile === 'string' && SAFE_ARTICLE_FILE.test(articleFile);
    const localeContents = await Promise.all(LOCALES.map(async (locale) => {
      const markdown = allowlisted && articleFile
        ? await readOptionalArticle(repositoryRoot, locale, articleFile)
        : null;
      return { locale, markdown };
    }));
    const targetServicePresent = localeContents.every(({ markdown }) => (
      markdown !== null && markdown.includes(contract.targetService)
    ));
    const targetOperationPresent = localeContents.every(({ markdown }) => (
      markdown !== null && markdown.includes(contract.targetOperation)
    ));
    const metadataEntryCount = Object.keys(RUNBOOK_METADATA)
      .filter((scenario) => scenario === contract.scenario).length;

    return {
      article: allowlisted ? { scenario: contract.scenario, articleFile } : null,
      fact: {
        scenario: contract.scenario,
        metadataPresent: metadata !== undefined,
        metadataEntryCount,
        targetService: targetServicePresent ? contract.targetService : null,
        targetOperation: targetOperationPresent ? contract.targetOperation : null,
        locales: localeContents.map(({ locale, markdown }) => ({
          locale,
          allowlisted,
          contentAvailable: markdown !== null && markdown.trim().length > 0,
          headingIds: getRunbookHeadingIds(locale, markdown ?? ''),
        })),
      },
    };
  }));

  return {
    facts: results.map(({ fact }) => fact),
    articles: results.flatMap(({ article }) => (article === null ? [] : [article])),
  };
}

async function readOptionalArticle(
  repositoryRoot: string,
  locale: ScenarioContractLocale,
  articleFile: string,
): Promise<string | null> {
  const filePath = resolveRepositoryFile(
    repositoryRoot,
    path.posix.join('traffic-control-plane', 'src', 'content', 'runbook', locale, articleFile),
  );
  try {
    return await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return null;
    throw new ScenarioContractCliFactsError('STATIC_INPUT_UNREADABLE');
  }
}

function getRunbookHeadingIds(
  locale: ScenarioContractLocale,
  markdown: string,
): ScenarioRunbookHeadingId[] {
  const headings = new Set([...markdown.matchAll(/^##\s+(.+?)\s*$/gmu)]
    .flatMap((match) => (match[1] === undefined ? [] : [match[1].trim()])));
  return SCENARIO_CONTRACT_REQUIRED_RUNBOOK_HEADINGS.filter(
    (id) => headings.has(SCENARIO_CONTRACT_RUNBOOK_HEADING_TEXT[locale][id]),
  );
}

function buildI18nFacts(
  contracts: readonly ResolvedScenarioContract[],
): ScenarioI18nFact[] {
  return contracts.map((contract) => {
    const groupMemberships = SCENARIO_GROUPS.filter(({ scenarios }) => (
      scenarios.includes(contract.scenario)
    ));
    const scenarioMeta = SCENARIO_META[contract.scenario];
    return {
      scenario: contract.scenario,
      scenarioMetaPresent: scenarioMeta !== undefined
        && scenarioMeta.labelKey === contract.scenario
        && scenarioMeta.descriptionKey === contract.scenario,
      groupMembershipCount: groupMemberships.length,
      locales: LOCALES.map((locale) => {
        const scenarioMessages = asRecord(
          asRecord(messages[locale])?.Scenarios,
        );
        const scenarioMetaMessages = asRecord(scenarioMessages?.scenarioMeta);
        const scenarioMessagesForId = asRecord(scenarioMetaMessages?.[contract.scenario]);
        const parameterMessages = asRecord(scenarioMessages?.parameters);
        const recoveryMessages = asRecord(scenarioMessages?.recoveryStrategies);
        const groupMessages = asRecord(scenarioMessages?.groups);
        const group = groupMemberships.length === 1 ? groupMemberships[0] : undefined;
        return {
          locale,
          scenarioLabelPresent: hasText(scenarioMessagesForId?.label),
          scenarioDescriptionPresent: hasText(scenarioMessagesForId?.description),
          recoveryStrategyLabelPresent: hasText(
            recoveryMessages?.[contract.recoveryStrategy],
          ),
          groupLabelPresent: group !== undefined && hasText(groupMessages?.[group.labelKey]),
          parameters: contract.parameters.map(({ name }) => {
            const parameter = asRecord(parameterMessages?.[name]);
            return {
              name,
              labelPresent: hasText(parameter?.label),
              descriptionPresent: hasText(parameter?.description),
            };
          }),
        };
      }),
    };
  });
}

function buildDispatchCapabilities(): ScenarioDispatchValidationDescriptor[] {
  return FAULT_RUN_DRIVER_CAPABILITIES.map((capability) => ({
    name: capability.name,
    drainOwner: capability.drainOwner,
    supportedScenarios: [...capability.supportedScenarios],
    executionState: capability.executionState,
    summaryEventType: capability.summaryEventType,
    terminalSummaryEvent: capability.terminalSummaryEvent,
    drainParticipantRegistered: faultRunDrainParticipantForOwner(capability.drainOwner) !== undefined,
  }));
}

function buildTargetFacts(
  contracts: readonly ResolvedScenarioContract[],
): ScenarioTargetContractFact[] {
  return contracts.map((contract) => {
    if (contract.targetLifecycleMode === 'LOCAL_WORKER') {
      const localTarget = getTrafficScenarioTarget(contract.scenario);
      return {
        scenario: contract.scenario,
        gateway: {
          status: 'ABSENT',
          service: null,
          operation: null,
          paths: { prepare: null, release: null, cleanup: null },
        },
        target: {
          status: 'NOT_APPLICABLE',
          service: null,
          operation: null,
          paths: { prepare: null, release: null, cleanup: null },
        },
        localWorker: {
          status: 'PASSED',
          scenario: contract.scenario,
          source: 'TRAFFIC_SCENARIO_TARGETS',
          service: contract.targetService,
          path: localTarget.path,
        },
        cleanupCapability: {
          status: 'NOT_APPLICABLE',
          policy: 'NONE',
          runScoped: false,
          fenced: false,
          confirmationSupported: false,
          actionOwnerVerified: false,
        },
      };
    }

    // These are Catalog-derived expectations; required Java check artifacts attest real mappings.
    const paths = {
      prepare: contract.targetPrepare === 'REQUIRED'
        ? `/internal/${contract.targetOperation}/prepare`
        : null,
      release: contract.recoveryPolicy.targetRelease === 'REQUIRED'
        ? `/internal/${contract.targetOperation}/release`
        : null,
      cleanup: contract.recoveryPolicy.cleanup !== 'NONE'
        ? `/internal/${contract.targetOperation}/cleanup`
        : null,
    };
    return {
      scenario: contract.scenario,
      gateway: {
        status: 'PASSED',
        service: contract.targetService,
        operation: contract.targetOperation,
        paths,
      },
      target: {
        status: 'PASSED',
        service: contract.targetService,
        operation: contract.targetOperation,
        paths: { ...paths },
      },
      localWorker: {
        status: 'NOT_APPLICABLE',
        scenario: null,
        source: null,
        service: null,
        path: null,
      },
      cleanupCapability: contract.recoveryPolicy.cleanup === 'NONE'
        ? {
          status: 'NOT_APPLICABLE',
          policy: 'NONE',
          runScoped: false,
          fenced: false,
          confirmationSupported: false,
          actionOwnerVerified: false,
        }
        : {
          status: 'PASSED',
          policy: contract.recoveryPolicy.cleanup,
          runScoped: true,
          fenced: true,
          confirmationSupported: true,
          actionOwnerVerified: true,
        },
    };
  });
}

function buildParameterValidationFacts(
  contracts: readonly ResolvedScenarioContract[],
): ScenarioParameterValidationFact[] {
  return contracts.map(({ scenario, parameters }) => {
    const supplied: Record<string, number | string> = {};
    for (const parameter of parameters) {
      if (parameter.default !== undefined) supplied[parameter.name] = parameter.default;
    }
    try {
      validateScenarioParameters(scenario, supplied);
      return { scenario, status: 'PASSED' };
    } catch (error: unknown) {
      if (error instanceof FaultRunValidationError) return { scenario, status: 'FAILED' };
      throw error;
    }
  });
}

function buildParameterGuardFacts(
  contracts: readonly ResolvedScenarioContract[],
): ScenarioParameterGuardFact[] {
  const facts: ScenarioParameterGuardFact[] = [];
  for (const contract of contracts) {
    for (const budget of contract.budgets) {
      if (budget.boundary.kind === 'CATALOG_RULE') {
        facts.push({
          scenario: contract.scenario,
          guardId: budget.boundary.ruleId,
          status: budget.boundary.ruleId === 'CATALOG_LARGE_VALUE_MAX_LOGICAL_BYTES'
            ? 'PASSED' : 'FAILED',
          parameterNames: [...budget.boundary.parameterNames],
        });
      } else if (budget.boundary.kind === 'TARGET_CAPACITY_GUARD') {
        const capacityBoundary = budget.boundary;
        const reserveParameter = contract.parameters.find(
          ({ name }) => name === capacityBoundary.reserveBytesParameter,
        );
        const validReserveBounds = reserveParameter?.min === NOTIFICATION_STORAGE_MIN_FREE_BYTES
          && reserveParameter.max === NOTIFICATION_STORAGE_MAX_FREE_BYTES;
        facts.push({
          scenario: contract.scenario,
          guardId: capacityBoundary.guardId,
          status: validReserveBounds ? 'PASSED' : 'FAILED',
          parameterNames: ['totalBytes', 'minFreeBytes'],
          ...(reserveParameter?.min === undefined ? {} : { minimum: reserveParameter.min }),
          ...(reserveParameter?.max === undefined ? {} : { maximum: reserveParameter.max }),
        });
      }
    }

    if (contract.targetLifecycleMode === 'LOCAL_WORKER') {
      const concurrency = contract.parameters.find(({ name }) => name === 'concurrency');
      const validConcurrency = concurrency?.min === 1
        && concurrency.max === TRAFFIC_SURGE_MAX_CONCURRENCY;
      facts.push({
        scenario: contract.scenario,
        guardId: 'TRAFFIC_SURGE_MAX_CONCURRENCY',
        status: validConcurrency ? 'PASSED' : 'FAILED',
        parameterNames: ['concurrency'],
        ...(concurrency?.min === undefined ? {} : { minimum: concurrency.min }),
        ...(concurrency?.max === undefined ? {} : { maximum: concurrency.max }),
      });
    }
  }
  return facts;
}

async function readDeploymentAlertConfiguration(
  repositoryRoot: string,
): Promise<ScenarioAlertConfigurationFacts> {
  const [
    composeFile,
    prometheusConfig,
    prometheusRules,
    alertmanagerConfig,
    prometheusManifest,
    prometheusRulesManifest,
    alertmanagerManifest,
    kustomizationText,
  ] = await Promise.all([
    readRepositoryText(repositoryRoot, COMPOSE_SOURCES.composeFile),
    readRepositoryText(repositoryRoot, COMPOSE_SOURCES.prometheusConfig),
    readRepositoryText(repositoryRoot, COMPOSE_SOURCES.prometheusRules),
    readRepositoryText(repositoryRoot, COMPOSE_SOURCES.alertmanagerConfig),
    readRepositoryText(repositoryRoot, KUBERNETES_SOURCES.prometheusManifest),
    readRepositoryText(repositoryRoot, KUBERNETES_SOURCES.prometheusRulesManifest),
    readRepositoryText(repositoryRoot, KUBERNETES_SOURCES.alertmanagerManifest),
    readRepositoryText(repositoryRoot, 'k8s/kustomization.yaml'),
  ]);
  const kustomization = loadYaml(kustomizationText);
  const resources = asRecord(kustomization)?.resources;
  if (!Array.isArray(resources) || resources.some((resource) => typeof resource !== 'string')) {
    throw new ScenarioContractCliFactsError('STATIC_INPUT_INVALID');
  }
  const workloadPaths = resources
    .filter((resource): resource is string => (
      typeof resource === 'string'
      && (resource.startsWith('services/') || resource === 'infra/exporters.yaml')
    ))
    .sort(compareText);
  if (workloadPaths.some((resource) => !isSafeRelativePath(resource))) {
    throw new ScenarioContractCliFactsError('STATIC_INPUT_INVALID');
  }
  const workloadManifests = await Promise.all(workloadPaths.map((resource) => (
    readRepositoryText(repositoryRoot, path.posix.join('k8s', resource))
  )));

  return parseScenarioContractDeploymentFacts({
    compose: {
      composeFile,
      prometheusConfig,
      prometheusRules,
      alertmanagerConfig,
    },
    kubernetes: {
      prometheusManifest,
      prometheusRulesManifest,
      alertmanagerManifest,
      workloadManifests,
    },
  });
}

async function readRepositoryText(repositoryRoot: string, relativePath: string): Promise<string> {
  const filePath = resolveRepositoryFile(repositoryRoot, relativePath);
  try {
    return await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    throw new ScenarioContractCliFactsError(
      errorCode(error) === 'ENOENT' ? 'STATIC_INPUT_MISSING' : 'STATIC_INPUT_UNREADABLE',
    );
  }
}

function resolveRepositoryFile(repositoryRoot: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new ScenarioContractCliFactsError('STATIC_INPUT_INVALID');
  }
  const root = path.resolve(repositoryRoot);
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new ScenarioContractCliFactsError('STATIC_INPUT_INVALID');
  }
  return filePath;
}

function isSafeRelativePath(value: string): boolean {
  return !path.posix.isAbsolute(value)
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function loadYaml(source: string): unknown {
  try {
    return yaml.load(source);
  } catch {
    throw new ScenarioContractCliFactsError('STATIC_INPUT_INVALID');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorCode(error: unknown): string | null {
  return error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
