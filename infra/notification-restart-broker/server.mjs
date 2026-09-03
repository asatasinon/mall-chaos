import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import https from 'node:https';

const port = 8095;
const mode = process.env.RESTART_BROKER_MODE === 'kubernetes' ? 'kubernetes' : 'compose';
const brokerKey = process.env.NOTIFICATION_RESTART_BROKER_KEY || '';
const healthUrl = 'http://notification-service:8090/actuator/health';
const deadlineMs = 120_000;
const pollMs = 2_000;

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, { status: 'UP', mode });
  }
  if (request.method !== 'POST' || request.url !== '/restart') {
    return sendJson(response, 404, { error: 'not_found' });
  }
  if (!brokerKey || request.headers['x-restart-broker-key'] !== brokerKey) {
    return sendJson(response, 401, { error: 'unauthorized' });
  }

  try {
    const body = await readJson(request);
    const hasRunId = body.runId !== undefined;
    const hasFencingToken = body.fencingToken !== undefined;
    if (hasRunId !== hasFencingToken
      || (hasRunId && (!isUuid(body.runId) || !isPositiveInteger(body.fencingToken)))
      || Object.keys(body).some((key) => !['runId', 'fencingToken'].includes(key))) {
      return sendJson(response, 400, { error: 'invalid_restart_contract' });
    }
    const startedAt = Date.now();
    const initialHealth = await probeHealth();
    if (initialHealth.healthy) {
      return sendJson(response, 200, {
        accepted: true,
        target: 'notification-service',
        mode,
        restarted: false,
        ...initialHealth,
        elapsedMs: Date.now() - startedAt,
      });
    }
    if (mode === 'compose') await restartComposeContainer();
    else await restartKubernetesDeployment();
    const health = await waitForHealthy();
    return sendJson(response, health.healthy ? 200 : 504, {
      accepted: true,
      target: 'notification-service',
      mode,
      restarted: true,
      ...health,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return sendJson(response, 502, { error: error instanceof Error ? error.message : 'restart_failed' });
  }
});

server.listen(port, '0.0.0.0');

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let value = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      value += chunk;
      if (value.length > 4096) request.destroy(new Error('request_too_large'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(value)); } catch { reject(new Error('invalid_json')); }
    });
    request.on('error', reject);
  });
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function restartComposeContainer() {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['restart', 'castrel-notification'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `docker_restart_${code}`)));
  });
}

async function restartKubernetesDeployment() {
  const namespace = 'castrel';
  const deployment = 'notification-service';
  const current = await kubeRequest('GET', `/apis/apps/v1/namespaces/${namespace}/deployments/${deployment}`);
  const currentAnnotations = current.spec?.template?.metadata?.annotations || {};
  await kubeRequest('PATCH', `/apis/apps/v1/namespaces/${namespace}/deployments/${deployment}`, {
    spec: { template: { metadata: { annotations: {
      ...currentAnnotations,
      'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
    } } } },
  });
}

async function kubeRequest(method, path, body) {
  const token = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const ca = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || '443';
  if (!host) throw new Error('kubernetes_api_unavailable');
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: host, port, path, method, ca, headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/strategic-merge-patch+json' } : {}),
    } }, (response) => {
      let value = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { value += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`kubernetes_api_${response.statusCode}`));
          return;
        }
        try { resolve(value ? JSON.parse(value) : {}); } catch { reject(new Error('invalid_kubernetes_response')); }
      });
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function waitForHealthy() {
  const deadline = Date.now() + deadlineMs;
  let healthStatus = 'DOWN';
  while (Date.now() < deadline) {
    const health = await probeHealth();
    healthStatus = health.healthStatus;
    if (health.healthy) return health;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { healthy: false, healthStatus };
}

async function probeHealth() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    return { healthy: response.ok, healthStatus: response.ok ? 'UP' : `HTTP_${response.status}` };
  } catch {
    return { healthy: false, healthStatus: 'UNREACHABLE' };
  }
}