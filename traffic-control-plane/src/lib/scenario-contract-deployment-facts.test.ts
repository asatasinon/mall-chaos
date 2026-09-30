import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { ALERT_RECEIPT_POLICY_ID } from './scenario-contract';
import { parseScenarioContractDeploymentFacts, type ScenarioContractDeploymentYamlSources } from './scenario-contract-deployment-facts';

const ROOT = path.resolve(process.cwd(), '..');

const PROMETHEUS_CONFIG = `rule_files:
  - "/etc/prometheus/rules/*.yml"
scrape_configs:
  - job_name: "catalog-service"
    static_configs:
      - targets: ["catalog-service:8082"]
        labels:
          service: "catalog-service"
`;

const PROMETHEUS_RULES = `groups:
  - name: fixture
    interval: 30s
    rules:
      - alert: ContractAlert
        expr: |
          sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m])) by (service, uri) > 0.05
        for: 1m
        labels:
          severity: critical
`;

const COMPOSE_ALERTMANAGER = `global:
  resolve_timeout: 5m
route:
  receiver: default-receiver
  group_by: [alertname, severity, service]
  group_wait: 30s
  group_interval: 3m
  repeat_interval: 5m
  routes:
    - receiver: critical-receiver
      match:
        severity: critical
      repeat_interval: 2m
      continue: false
    - receiver: warning-receiver
      match:
        severity: warning
      repeat_interval: 5m
      continue: false
receivers:
  - name: default-receiver
    webhook_configs:
      - url: http://traffic-control-plane:3086/internal/alertmanager/webhook
        send_resolved: true
  - name: critical-receiver
    webhook_configs:
      - url: http://traffic-control-plane:3086/internal/alertmanager/webhook
        send_resolved: true
  - name: warning-receiver
    webhook_configs:
      - url: http://traffic-control-plane:3086/internal/alertmanager/webhook
        send_resolved: true
`;

function indent(value: string, prefix: string): string {
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function fixtureSources(overrides: {
  readonly composeAlertmanager?: string;
  readonly kubernetesRules?: string;
  readonly kubernetesAlertmanager?: string;
} = {}): ScenarioContractDeploymentYamlSources {
  const kubernetesAlertmanager = overrides.kubernetesAlertmanager ?? `global:
  repeat_interval: 5m
  resolve_timeout: 5m
route:
  receiver: default-receiver
  group_by: [alertname, severity, service]
  group_wait: 30s
  group_interval: 3m
  routes:
    - receiver: critical-receiver
      match:
        severity: critical
      repeat_interval: 2m
      continue: false
    - receiver: warning-receiver
      match:
        severity: warning
      repeat_interval: 5m
      continue: false
receivers:
  - name: default-receiver
    webhook_configs:
      - url: http://traffic-control-plane:3086/internal/alertmanager/webhook
        send_resolved: true
  - name: critical-receiver
    webhook_configs:
      - url: http://traffic-control-plane:3086/internal/alertmanager/webhook
        send_resolved: true
  - name: warning-receiver
    webhook_configs:
      - url: http://traffic-control-plane:3086/internal/alertmanager/webhook
        send_resolved: true
`;
  const kubernetesRules = overrides.kubernetesRules ?? PROMETHEUS_RULES;
  return {
    compose: {
      composeFile: `services:
  prometheus:
    volumes:
      - ./infra/prometheus/rules:/etc/prometheus/source-rules:ro
  alertmanager:
    volumes:
      - ./infra/alertmanager:/etc/alertmanager-source:ro
`,
      prometheusConfig: PROMETHEUS_CONFIG,
      prometheusRules: PROMETHEUS_RULES,
      alertmanagerConfig: overrides.composeAlertmanager ?? COMPOSE_ALERTMANAGER,
    },
    kubernetes: {
      prometheusManifest: `apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
data:
  prometheus.yml: |
${indent(PROMETHEUS_CONFIG, '    ')}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prometheus
spec:
  template:
    spec:
      containers:
        - name: prometheus
          volumeMounts:
            - name: prometheus-config
            - name: prometheus-rules
      volumes:
        - name: prometheus-config
          configMap:
            name: prometheus-config
        - name: prometheus-rules
          configMap:
            name: prometheus-alert-rules
`,
      prometheusRulesManifest: `apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-alert-rules
data:
  alert-rules.yml: |
${indent(kubernetesRules, '    ')}
`,
      alertmanagerManifest: `apiVersion: v1
kind: ConfigMap
metadata:
  name: alertmanager-config
data:
  alertmanager.yml: |
${indent(kubernetesAlertmanager, '    ')}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: alertmanager
spec:
  template:
    spec:
      containers:
        - name: alertmanager
          volumeMounts:
            - name: alertmanager-config
      volumes:
        - name: alertmanager-config
          configMap:
            name: alertmanager-config
`,
      workloadManifests: [`apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog-service
spec:
  template:
    metadata:
      labels:
        app: catalog-service
      annotations:
        prometheus.io/scrape: "true"
`],
    },
  };
}

async function versionControlledSources(): Promise<ScenarioContractDeploymentYamlSources> {
  const read = (file: string) => readFile(path.resolve(ROOT, file), 'utf8');
  const kustomizationText = await read('k8s/kustomization.yaml');
  const kustomization = yaml.load(kustomizationText);
  const resources = (kustomization && typeof kustomization === 'object'
    ? (kustomization as Record<string, unknown>).resources
    : null);
  const workloadPaths = Array.isArray(resources)
    ? resources.filter((resource): resource is string => (
      typeof resource === 'string'
      && (resource.startsWith('services/') || resource === 'infra/exporters.yaml')
    ))
    : [];
  const workloadManifests = await Promise.all(workloadPaths.map(
    (resource) => read(path.posix.join('k8s', resource)),
  ));
  const [
    composeFile,
    prometheusConfig,
    prometheusRules,
    alertmanagerConfig,
    prometheusManifest,
    prometheusRulesManifest,
    alertmanagerManifest,
  ] = await Promise.all([
    read('docker-compose.yml'),
    read('infra/prometheus/prometheus.yml'),
    read('infra/prometheus/rules/alert-rules.yml'),
    read('infra/alertmanager/alertmanager.yml'),
    read('k8s/infra/prometheus.yaml'),
    read('k8s/configmap/prometheus-alert-rules.yaml'),
    read('k8s/infra/alertmanager.yaml'),
  ]);
  return {
    compose: { composeFile, prometheusConfig, prometheusRules, alertmanagerConfig },
    kubernetes: {
      prometheusManifest,
      prometheusRulesManifest,
      alertmanagerManifest,
      workloadManifests,
    },
  };
}

test('normalizes version-controlled Prometheus and Alertmanager configuration semantically', () => {
  const facts = parseScenarioContractDeploymentFacts(fixtureSources());
  const compose = facts.prometheus.find(({ variant }) => variant === 'COMPOSE');
  const kubernetes = facts.prometheus.find(({ variant }) => variant === 'KUBERNETES');
  assert.ok(compose);
  assert.ok(kubernetes);
  assert.deepEqual(compose.serviceLabelValues, ['catalog-service']);
  assert.deepEqual(kubernetes.serviceLabelValues, ['catalog-service']);
  assert.deepEqual(compose.rules, kubernetes.rules);

  const alertmanager = facts.alertmanager;
  assert.equal(alertmanager.length, 2);
  assert.equal(alertmanager[0]?.internalReceipt.routeConfigured, true);
  assert.equal(alertmanager[0]?.internalReceipt.receiverConfigured, true);
  assert.equal(alertmanager[0]?.internalReceipt.receiptPolicyId, ALERT_RECEIPT_POLICY_ID);
  assert.equal(alertmanager[0]?.internalReceipt.sendResolved, true);
  assert.equal(alertmanager[0]?.internalReceipt.routeTreeSha256, alertmanager[1]?.internalReceipt.routeTreeSha256);
  assert.equal(facts.agentDeliveryReadiness.state, 'NOT_ENABLED_YET');
  assert.equal(alertmanager[0]?.externalAgent.receiverConfigured, false);

  const serializedFacts = JSON.stringify(facts);
  assert.equal(serializedFacts.includes('sum(rate('), false);
  assert.equal(serializedFacts.includes('http://traffic-control-plane:3086'), false);
  assert.equal(serializedFacts.includes('internal-service-key'), false);
});

test('detects undeclared external Alertmanager destinations without exposing configuration', () => {
  const externalConfig = COMPOSE_ALERTMANAGER.replace(
    '  routes:\n',
    `  routes:\n    - receiver: agent-receiver\n      match:\n        alertname: ContractAlert\n`,
  ).replace(
    'receivers:\n',
    `receivers:\n  - name: agent-receiver\n    webhook_configs:\n      - url: https://agent.example.test/receiver\n        send_resolved: false\n`,
  );
  const facts = parseScenarioContractDeploymentFacts(fixtureSources({ composeAlertmanager: externalConfig }));
  const compose = facts.alertmanager.find(({ variant }) => variant === 'COMPOSE');
  assert.ok(compose);
  assert.equal(compose.externalAgent.childRouteConfigured, true);
  assert.equal(compose.externalAgent.receiverConfigured, true);
  assert.equal(facts.agentDeliveryReadiness.state, 'NOT_ENABLED_YET');
  assert.equal(JSON.stringify(compose).includes('agent.example.test'), false);
  assert.equal(JSON.stringify(compose).includes('agent-receiver'), false);
  assert.equal(externalConfig.includes('agent.example.test'), true);
});

test('parses the tracked Compose and Kubernetes source files without retaining raw YAML or expressions', async () => {
  const facts = parseScenarioContractDeploymentFacts(await versionControlledSources());
  assert.deepEqual(
    facts.prometheus.map(({ variant }) => variant),
    ['COMPOSE', 'KUBERNETES'],
  );
  for (const deployment of facts.prometheus) {
    for (const service of ['node', 'mysql', 'redis']) {
      assert.ok(deployment.serviceLabelValues.includes(service), `${deployment.variant}:${service}`);
    }
  }
  for (const deployment of facts.prometheus) {
    assert.ok(deployment.rules.some(({ alertName }) => alertName === 'HighLatencyP99'), deployment.variant);
    assert.ok(deployment.rules.some(({ alertName }) => alertName === 'NodeDataFilesystemGrowthRateHigh'), deployment.variant);
  }
  for (const deployment of facts.alertmanager) {
    assert.equal(deployment.internalReceipt.routeConfigured, true, deployment.variant);
    assert.equal(deployment.internalReceipt.receiverConfigured, true, deployment.variant);
    assert.equal(deployment.internalReceipt.sendResolved, true, deployment.variant);
    assert.equal(deployment.externalAgent.receiverConfigured, false, deployment.variant);
  }
  const serializedFacts = JSON.stringify(facts);
  assert.equal(serializedFacts.includes('rate(http_server_requests_seconds_count'), false);
  assert.equal(serializedFacts.includes('http://traffic-control-plane:3086'), false);
  assert.equal(serializedFacts.includes('/etc/alertmanager-secret/internal-service-key'), false);
});

test('invalid or incomplete YAML produces only empty normalized facts', () => {
  const facts = parseScenarioContractDeploymentFacts({
    compose: {
      composeFile: 'services: [',
      prometheusConfig: 'scrape_configs: [',
      prometheusRules: 'groups: [',
      alertmanagerConfig: 'route: [',
    },
    kubernetes: {
      prometheusManifest: '---\nkind: ConfigMap\nmetadata: [',
      prometheusRulesManifest: '---\nkind: ConfigMap\nmetadata: [',
      alertmanagerManifest: '---\nkind: ConfigMap\nmetadata: [',
      workloadManifests: [],
    },
  });
  assert.deepEqual(facts.prometheus.map(({ rules }) => rules), [[], []]);
  assert.equal(facts.alertmanager.every(({ internalReceipt }) => (
    internalReceipt.routeConfigured === false && internalReceipt.routeTreeSha256 === null
  )), true);
  assert.equal(facts.agentDeliveryReadiness.state, 'NOT_ENABLED_YET');
});
