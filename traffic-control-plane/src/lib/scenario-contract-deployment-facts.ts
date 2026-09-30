import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import {
  ALERT_RECEIPT_POLICY_ID,
  type AgentDeliveryReadiness,
} from './scenario-contract';
import type {
  ScenarioAlertConfigurationFacts,
  ScenarioAlertmanagerDeploymentFact,
  ScenarioContractDeploymentVariant,
  ScenarioPrometheusDeploymentFact,
  ScenarioPrometheusRuleFact,
} from './scenario-contract-validator';

export interface ScenarioContractDeploymentYamlSources {
  readonly compose: {
    readonly composeFile: string;
    readonly prometheusConfig: string;
    readonly prometheusRules: string;
    readonly alertmanagerConfig: string;
  };
  readonly kubernetes: {
    readonly prometheusManifest: string;
    readonly prometheusRulesManifest: string;
    readonly alertmanagerManifest: string;
    readonly workloadManifests: readonly string[];
  };
}

type PrometheusServiceLabels = {
  readonly configured: boolean;
  readonly values: readonly string[];
};

const SAFE_LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SAFE_LABEL_VALUE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const INTERNAL_WEBHOOK = {
  protocol: 'http:',
  hostname: 'traffic-control-plane',
  port: '3086',
  pathname: '/internal/alertmanager/webhook',
} as const;
const AGENT_DELIVERY_NOT_ENABLED: AgentDeliveryReadiness = { state: 'NOT_ENABLED_YET' };

export function parseScenarioContractDeploymentFacts(
  sources: ScenarioContractDeploymentYamlSources,
): ScenarioAlertConfigurationFacts {
  const composeRoot = parseYaml(sources.compose.composeFile);
  const composePrometheus = parseYaml(sources.compose.prometheusConfig);
  const composePrometheusMountValid = composeHasMount(
    composeRoot,
    'prometheus',
    './infra/prometheus/rules',
    '/etc/prometheus/source-rules',
    true,
  );
  const composeAlertmanagerMountValid = composeHasMount(
    composeRoot,
    'alertmanager',
    './infra/alertmanager',
    '/etc/alertmanager-source',
    true,
  );
  const composeRuleFilesConfigured = hasRuleFileTarget(composePrometheus, '/etc/prometheus/rules/*.yml');
  const composeServiceLabels = readPrometheusServiceLabels(composePrometheus, []);
  const composeRules = composePrometheusMountValid && composeRuleFilesConfigured
    ? parseYaml(sources.compose.prometheusRules)
    : null;
  const composeAlertmanager = composeAlertmanagerMountValid
    ? parseYaml(sources.compose.alertmanagerConfig)
    : null;

  const kubernetesPrometheusDocuments = parseYamlDocuments(sources.kubernetes.prometheusManifest);
  const kubernetesRuleDocuments = parseYamlDocuments(sources.kubernetes.prometheusRulesManifest);
  const kubernetesAlertmanagerDocuments = parseYamlDocuments(sources.kubernetes.alertmanagerManifest);
  const kubernetesPrometheusConfigText = getConfigMapData(
    kubernetesPrometheusDocuments,
    'prometheus-config',
    'prometheus.yml',
  );
  const kubernetesRulesText = getConfigMapData(
    kubernetesRuleDocuments,
    'prometheus-alert-rules',
    'alert-rules.yml',
  );
  const kubernetesAlertmanagerConfigText = getConfigMapData(
    kubernetesAlertmanagerDocuments,
    'alertmanager-config',
    'alertmanager.yml',
  );
  const kubernetesPrometheus = parseYaml(kubernetesPrometheusConfigText);
  const kubernetesRulesReady = kubernetesPrometheusConfigText !== null
    && kubernetesRulesText !== null
    && hasKubernetesConfigMapMount(
      kubernetesPrometheusDocuments,
      'prometheus',
      'prometheus-config',
    )
    && hasKubernetesConfigMapMount(
      kubernetesPrometheusDocuments,
      'prometheus',
      'prometheus-alert-rules',
    )
    && hasRuleFileTarget(kubernetesPrometheus, '/etc/prometheus/rules/*.yml');
  const kubernetesAlertmanagerReady = kubernetesAlertmanagerConfigText !== null
    && hasKubernetesConfigMapMount(
      kubernetesAlertmanagerDocuments,
      'alertmanager',
      'alertmanager-config',
    );
  const kubernetesWorkloads = sources.kubernetes.workloadManifests
    .flatMap(parseYamlDocuments);
  const kubernetesServiceLabels = readPrometheusServiceLabels(
    kubernetesPrometheus,
    kubernetesWorkloads,
  );

  return {
    prometheus: [
      parsePrometheusDeployment(
        'COMPOSE',
        composeRules,
        composeServiceLabels,
        composePrometheusMountValid && composeRuleFilesConfigured,
      ),
      parsePrometheusDeployment(
        'KUBERNETES',
        kubernetesRulesReady ? parseYaml(kubernetesRulesText) : null,
        kubernetesServiceLabels,
        kubernetesRulesReady,
      ),
    ],
    alertmanager: [
      parseAlertmanagerDeployment('COMPOSE', composeAlertmanager),
      parseAlertmanagerDeployment(
        'KUBERNETES',
        kubernetesAlertmanagerReady ? parseYaml(kubernetesAlertmanagerConfigText) : null,
      ),
    ],
    agentDeliveryReadiness: AGENT_DELIVERY_NOT_ENABLED,
  };
}

function parsePrometheusDeployment(
  variant: ScenarioContractDeploymentVariant,
  rulesValue: unknown,
  serviceLabels: PrometheusServiceLabels,
  deploymentReady: boolean,
): ScenarioPrometheusDeploymentFact {
  const groups = getArray(getRecord(rulesValue)?.groups);
  const rules = deploymentReady
    ? groups.flatMap((group) => parsePrometheusGroup(group, serviceLabels.configured))
    : [];
  return {
    variant,
    serviceLabelValues: serviceLabels.values,
    rules: rules.sort((left, right) => compareText(left.alertName, right.alertName)),
  };
}

function parsePrometheusGroup(
  value: unknown,
  serviceLabelConfigured: boolean,
): ScenarioPrometheusRuleFact[] {
  const group = getRecord(value);
  if (!group) return [];
  const groupIntervalSeconds = parseDurationSeconds(group.interval);
  return getArray(group.rules).flatMap((ruleValue) => {
    const rule = getRecord(ruleValue);
    const alertName = readSafeName(rule?.alert);
    const expression = typeof rule?.expr === 'string' ? rule.expr : null;
    if (!rule || !alertName || expression === null) return [];

    const labels = getRecord(rule.labels) ?? {};
    const severity = readSafeName(labels.severity);
    const staticLabels: Record<string, string> = {};
    if (severity !== null) staticLabels.severity = severity;
    const outputLabelNames = collectOutputLabelNames(
      expression,
      Object.keys(labels),
      serviceLabelConfigured,
    );
    return [{
      alertName,
      severity,
      staticLabels,
      outputLabelNames,
      serviceLabelName: serviceLabelConfigured && outputLabelNames.includes('service')
        ? 'service'
        : null,
      forSeconds: parseDurationSeconds(rule.for),
      groupIntervalSeconds,
      expressionSha256: sha256(normalizePrometheusExpression(expression)),
    }];
  });
}

function collectOutputLabelNames(
  expression: string,
  staticLabelNames: readonly string[],
  serviceLabelConfigured: boolean,
): string[] {
  const groupingLabels = new Set<string>();
  for (const match of expression.matchAll(/\bby\s*\(([^)]*)\)/gu)) {
    for (const label of match[1]?.split(',') ?? []) {
      const name = label.trim();
      if (SAFE_LABEL_NAME.test(name)) groupingLabels.add(name);
    }
  }

  const selectorLabels = new Set<string>();
  for (const match of expression.matchAll(/\{([^{}]*)\}/gu)) {
    for (const labelMatch of match[1]?.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:=~|!~|!=|=)/gu) ?? []) {
      const name = labelMatch[1];
      if (name) selectorLabels.add(name);
    }
  }

  const outputLabels = groupingLabels.size > 0 ? groupingLabels : selectorLabels;
  if (serviceLabelConfigured) outputLabels.add('service');
  for (const name of staticLabelNames) {
    if (SAFE_LABEL_NAME.test(name)) outputLabels.add(name);
  }
  return [...outputLabels].sort(compareText);
}

function readPrometheusServiceLabels(
  configValue: unknown,
  workloadDocuments: readonly unknown[],
): PrometheusServiceLabels {
  const config = getRecord(configValue);
  let configured = false;
  const values = new Set<string>();
  for (const scrapeConfigValue of getArray(config?.scrape_configs)) {
    const scrapeConfig = getRecord(scrapeConfigValue);
    if (!scrapeConfig) continue;
    for (const staticConfigValue of getArray(scrapeConfig.static_configs)) {
      const labels = getRecord(getRecord(staticConfigValue)?.labels);
      const service = readSafeName(labels?.service);
      if (service) {
        configured = true;
        values.add(service);
      }
    }
    for (const relabelValue of getArray(scrapeConfig.relabel_configs)) {
      const relabel = getRecord(relabelValue);
      if (relabel?.target_label !== 'service') continue;
      configured = true;
      const sourceLabels = getArray(relabel.source_labels).filter(
        (label): label is string => typeof label === 'string',
      );
      if (sourceLabels.includes('__meta_kubernetes_pod_label_app')) {
        for (const service of readScrapedKubernetesApps(workloadDocuments)) values.add(service);
      } else {
        const replacement = readSafeName(relabel.replacement);
        if (replacement) values.add(replacement);
      }
    }
  }
  return {
    configured,
    values: [...values].sort(compareText),
  };
}

function readScrapedKubernetesApps(documents: readonly unknown[]): string[] {
  const services = new Set<string>();
  for (const value of documents) {
    const document = getRecord(value);
    const podTemplate = getRecord(getRecord(document?.spec)?.template);
    const metadata = getRecord(podTemplate?.metadata);
    const annotations = getRecord(metadata?.annotations);
    const labels = getRecord(metadata?.labels);
    const scrape = annotations?.['prometheus.io/scrape'];
    if (scrape !== true && scrape !== 'true') continue;
    const service = readSafeName(labels?.app);
    if (service) services.add(service);
  }
  return [...services].sort(compareText);
}

function parseAlertmanagerDeployment(
  variant: ScenarioContractDeploymentVariant,
  value: unknown,
): ScenarioAlertmanagerDeploymentFact {
  const document = getRecord(value);
  const rootRoute = getRecord(document?.route);
  const receivers = getArray(document?.receivers)
    .map(getRecord)
    .filter((receiver): receiver is Record<string, unknown> => receiver !== null);
  const receiversByName = new Map(
    receivers.flatMap((receiver) => {
      const name = readSafeName(receiver.name);
      return name === null ? [] : [[name, receiver] as const];
    }),
  );
  const routeTree = rootRoute === null ? [] : flattenAlertRoutes(rootRoute);
  const routeReceiverNames = uniqueSorted([
    readSafeName(rootRoute?.receiver),
    ...routeTree.map(({ receiver }) => receiver),
  ].filter((name): name is string => name !== null));
  const internalReceiversConfigured = routeReceiverNames.length > 0
    && routeReceiverNames.every((name) => {
      const receiver = receiversByName.get(name);
      return receiver !== undefined && getInternalWebhooks(receiver).length > 0;
    });
  const severityRoutes = getArray(rootRoute?.routes).map(getRecord);
  const routeConfigured = readSafeName(rootRoute?.receiver) !== null
    && ['critical', 'warning'].every((severity) => (
      severityRoutes.some((route) => routeMatchesSeverity(route, severity))
    ));
  const sendResolved = internalReceiversConfigured
    && routeReceiverNames.every((name) => {
      const receiver = receiversByName.get(name);
      const webhooks = receiver ? getInternalWebhooks(receiver) : [];
      return webhooks.length > 0 && webhooks.every((webhook) => webhook.send_resolved === true);
    });
  const normalizedRoute = rootRoute === null
    ? null
    : normalizeAlertRoute(
      rootRoute,
      readRecordValue(getRecord(document?.global), 'repeat_interval'),
    );
  const routeTreeSha256 = normalizedRoute === null
    ? null
    : sha256(canonicalJson({
      resolveTimeoutSeconds: parseDurationSeconds(getRecord(document?.global)?.resolve_timeout),
      route: normalizedRoute,
    }));

  const externalReceiverNames = receivers
    .filter(hasExternalNotifier)
    .map((receiver) => readSafeName(receiver.name))
    .filter((name): name is string => name !== null)
    .sort(compareText);
  const externalChildRoutes = routeTree.filter(
    ({ receiver }) => externalReceiverNames.includes(receiver),
  );
  const externalReceiverConfigured = externalReceiverNames.length > 0;
  const externalRouteConfigured = externalChildRoutes.length > 0;
  const internalReceiptValid = routeConfigured
    && internalReceiversConfigured
    && sendResolved
    && routeTreeSha256 !== null;

  return {
    variant,
    internalReceipt: {
      routeConfigured,
      receiverConfigured: internalReceiversConfigured,
      receiptPolicyId: internalReceiptValid ? ALERT_RECEIPT_POLICY_ID : null,
      sendResolved: internalReceiversConfigured ? sendResolved : null,
      routeTreeSha256,
    },
    externalAgent: {
      childRouteConfigured: externalRouteConfigured,
      receiverConfigured: externalReceiverConfigured,
      childRouteName: externalRouteConfigured ? 'UNDECLARED_EXTERNAL_CHILD_ROUTE' : null,
      receiverName: externalReceiverConfigured ? 'UNDECLARED_EXTERNAL_RECEIVER' : null,
      credentialSource: null,
      sendResolved: null,
      routeTreeSha256: externalRouteConfigured ? routeTreeSha256 : null,
    },
  };
}

type AlertRouteFact = { readonly receiver: string; readonly route: Record<string, unknown> };

function flattenAlertRoutes(
  root: Record<string, unknown>,
): AlertRouteFact[] {
  const routes: AlertRouteFact[] = [];
  const visit = (route: Record<string, unknown>) => {
    for (const childValue of getArray(route.routes)) {
      const child = getRecord(childValue);
      if (!child) continue;
      const receiver = readSafeName(child.receiver);
      if (receiver) routes.push({ receiver, route: child });
      visit(child);
    }
  };
  visit(root);
  return routes;
}

function routeMatchesSeverity(route: Record<string, unknown> | null, severity: string): boolean {
  if (getRecord(route?.match)?.severity === severity) return true;
  return getArray(route?.matchers).some(
    (matcher) => typeof matcher === 'string' && new RegExp(`^severity\\s*=\\s*["']${severity}["']$`, 'u').test(matcher.trim()),
  );
}

function getInternalWebhooks(receiver: Record<string, unknown>): Record<string, unknown>[] {
  return getArray(receiver.webhook_configs)
    .map(getRecord)
    .filter((webhook): webhook is Record<string, unknown> => (
      webhook !== null && isInternalWebhook(webhook.url)
    ));
}

function isInternalWebhook(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === INTERNAL_WEBHOOK.protocol
      && url.hostname === INTERNAL_WEBHOOK.hostname
      && url.port === INTERNAL_WEBHOOK.port
      && url.pathname === INTERNAL_WEBHOOK.pathname
      && url.search === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

function hasExternalNotifier(receiver: Record<string, unknown>): boolean {
  return Object.entries(receiver).some(([key, value]) => {
    if (!key.endsWith('_configs')) return false;
    const notifiers = getArray(value).map(getRecord)
      .filter((notifier): notifier is Record<string, unknown> => notifier !== null);
    if (key !== 'webhook_configs') return notifiers.length > 0;
    return notifiers.some((notifier) => !isInternalWebhook(notifier.url));
  });
}

function normalizeAlertRoute(
  route: Record<string, unknown>,
  inheritedRepeatInterval: unknown,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const receiver = readSafeName(route.receiver);
  if (receiver !== null) normalized.receiver = receiver;

  const groupBy = getArray(route.group_by)
    .filter((label): label is string => typeof label === 'string' && SAFE_LABEL_NAME.test(label))
    .sort(compareText);
  if (groupBy.length > 0) normalized.groupBy = groupBy;

  const groupWait = parseDurationSeconds(route.group_wait);
  const groupInterval = parseDurationSeconds(route.group_interval);
  const repeatInterval = parseDurationSeconds(route.repeat_interval ?? inheritedRepeatInterval);
  if (groupWait !== null) normalized.groupWaitSeconds = groupWait;
  if (groupInterval !== null) normalized.groupIntervalSeconds = groupInterval;
  if (repeatInterval !== null) normalized.repeatIntervalSeconds = repeatInterval;
  if (typeof route.continue === 'boolean') normalized.continue = route.continue;

  const match = safeStringMap(route.match);
  const matchRe = safeStringMap(route.match_re);
  if (Object.keys(match).length > 0) normalized.match = match;
  if (Object.keys(matchRe).length > 0) normalized.matchRe = matchRe;
  const matchers = getArray(route.matchers)
    .filter((matcher): matcher is string => typeof matcher === 'string')
    .map((matcher) => matcher.trim())
    .sort(compareText);
  if (matchers.length > 0) normalized.matchers = matchers;

  const children = getArray(route.routes).map(getRecord)
    .filter((child): child is Record<string, unknown> => child !== null)
    .map((child) => normalizeAlertRoute(child, route.repeat_interval ?? inheritedRepeatInterval));
  if (children.length > 0) normalized.routes = children;
  return normalized;
}

function safeStringMap(value: unknown): Record<string, string> {
  const record = getRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key, item]) => SAFE_LABEL_NAME.test(key) && typeof item === 'string')
      .sort(([left], [right]) => compareText(left, right)),
  ) as Record<string, string>;
}

function hasRuleFileTarget(prometheusConfig: unknown, expectedPath: string): boolean {
  return getArray(getRecord(prometheusConfig)?.rule_files).some(
    (path) => path === expectedPath,
  );
}

function composeHasMount(
  composeRoot: unknown,
  serviceName: string,
  expectedSource: string,
  expectedTarget: string,
  readOnly: boolean,
): boolean {
  const service = getRecord(getRecord(getRecord(composeRoot)?.services)?.[serviceName]);
  return getArray(service?.volumes).some((volume) => {
    if (typeof volume !== 'string') return false;
    const [source, target, ...options] = volume.split(':');
    const normalizedSource = source?.replace(/^\.\//u, '');
    return normalizedSource === expectedSource.replace(/^\.\//u, '')
      && target === expectedTarget
      && (!readOnly || options.includes('ro'));
  });
}

function hasKubernetesConfigMapMount(
  documents: readonly unknown[],
  deploymentName: string,
  configMapName: string,
): boolean {
  for (const value of documents) {
    const deployment = getRecord(value);
    if (deployment?.kind !== 'Deployment'
      || getRecord(deployment.metadata)?.name !== deploymentName) continue;
    const spec = getRecord(getRecord(getRecord(deployment.spec)?.template)?.spec);
    const volumes = getArray(spec?.volumes).map(getRecord)
      .filter((volume): volume is Record<string, unknown> => volume !== null);
    const volumeNames = new Set(
      volumes.filter((volume) => getRecord(volume.configMap)?.name === configMapName)
        .map((volume) => volume.name)
        .filter((name): name is string => typeof name === 'string'),
    );
    const containers = getArray(spec?.containers).map(getRecord)
      .filter((container): container is Record<string, unknown> => container !== null);
    return containers.some((container) => getArray(container.volumeMounts).some(
      (mountValue) => {
        const mount = getRecord(mountValue);
        return typeof mount?.name === 'string' && volumeNames.has(mount.name);
      },
    ));
  }
  return false;
}

function getConfigMapData(
  documents: readonly unknown[],
  name: string,
  key: string,
): string | null {
  const configMap = documents.map(getRecord).find((document) => (
    document?.kind === 'ConfigMap' && getRecord(document.metadata)?.name === name
  ));
  const value = getRecord(configMap?.data)?.[key];
  return typeof value === 'string' ? value : null;
}

function parseYaml(value: string | null): unknown {
  if (typeof value !== 'string') return null;
  try {
    return yaml.load(value) ?? null;
  } catch {
    return null;
  }
}

function parseYamlDocuments(value: string): unknown[] {
  try {
    return yaml.loadAll(value);
  } catch {
    return [];
  }
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)$/u);
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
    y: 31536000,
  }[match[2] as 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'y'];
  const seconds = amount * multiplier;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function normalizePrometheusExpression(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function readRecordValue(record: Record<string, unknown> | null, key: string): unknown {
  return record?.[key];
}

function readSafeName(value: unknown): string | null {
  return typeof value === 'string' && SAFE_LABEL_VALUE.test(value) ? value : null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
