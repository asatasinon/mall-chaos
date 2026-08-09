import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getPool } from './db';
import { env } from './env';

const yaml: { load(input: string): unknown; dump(input: unknown, options?: Record<string, unknown>): string } = require('js-yaml');

export interface AlertRule {
  id?: number;
  ruleName: string;
  groupName: string;
  intervalSec: number;
  expression: string;
  forDuration: string;
  severity: 'critical' | 'warning' | 'info';
  summary: string;
  description: string;
  enabled: boolean;
}

export interface AlertReceiver {
  id?: number;
  receiverName: string;
  receiverType: 'webhook';
  endpoint: string;
  basicAuthUsername?: string;
  basicAuthPassword?: string;
  basicAuthPasswordSet?: boolean;
  severityMatch: 'all' | 'critical' | 'warning' | 'info';
  sendResolved: boolean;
  enabled: boolean;
}

export interface AlertConfig {
  version: number;
  rules: AlertRule[];
  receivers: AlertReceiver[];
  updatedAt: string | null;
  route: {
    receiver: string;
    groupBy: string[];
    groupWait: string;
    groupInterval: string;
    repeatInterval: string;
    continue: boolean;
    routes: AlertRoute[];
  };
}

export interface AlertRoute {
  receiver: string;
  match: Record<string, string>;
  groupBy?: string[];
  groupWait?: string;
  groupInterval?: string;
  repeatInterval?: string;
  continue: boolean;
}

const DEFAULT_RECEIVER = 'default-receiver';
const INTERNAL_WEBHOOK = 'http://traffic-control-plane:3086/internal/alertmanager/webhook';

async function ensureTables(): Promise<void> {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS alert_config_meta (
    id BIGINT NOT NULL PRIMARY KEY,
    version INT NOT NULL DEFAULT 1,
    route_receiver VARCHAR(128) NOT NULL DEFAULT 'default-receiver',
    group_by_json JSON NOT NULL,
    group_wait VARCHAR(32) NOT NULL DEFAULT '30s',
    group_interval VARCHAR(32) NOT NULL DEFAULT '3m',
    repeat_interval VARCHAR(32) NOT NULL DEFAULT '5m',
    route_continue TINYINT(1) NOT NULL DEFAULT 0,
    child_routes_json JSON NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS alert_rule (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rule_name VARCHAR(128) NOT NULL,
    group_name VARCHAR(128) NOT NULL,
    interval_sec INT NOT NULL DEFAULT 30,
    expression TEXT NOT NULL,
    for_duration VARCHAR(32) NOT NULL DEFAULT '0m',
    severity VARCHAR(16) NOT NULL DEFAULT 'warning',
    summary VARCHAR(512) NOT NULL,
    description TEXT NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    version INT NOT NULL DEFAULT 1,
    UNIQUE KEY uq_alert_rule_name (rule_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS alert_receiver (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    receiver_name VARCHAR(128) NOT NULL,
    receiver_type VARCHAR(32) NOT NULL DEFAULT 'webhook',
    endpoint VARCHAR(1024) NOT NULL,
    severity_match VARCHAR(16) NOT NULL DEFAULT 'all',
    send_resolved TINYINT(1) NOT NULL DEFAULT 1,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    version INT NOT NULL DEFAULT 1,
    UNIQUE KEY uq_alert_receiver_name (receiver_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await addColumn(pool, 'alert_config_meta', 'route_receiver', "VARCHAR(128) NOT NULL DEFAULT 'default-receiver'");
  await addColumn(pool, 'alert_config_meta', 'group_by_json', "JSON NULL");
  await addColumn(pool, 'alert_config_meta', 'group_wait', "VARCHAR(32) NOT NULL DEFAULT '30s'");
  await addColumn(pool, 'alert_config_meta', 'group_interval', "VARCHAR(32) NOT NULL DEFAULT '3m'");
  await addColumn(pool, 'alert_config_meta', 'repeat_interval', "VARCHAR(32) NOT NULL DEFAULT '5m'");
  await addColumn(pool, 'alert_config_meta', 'route_continue', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn(pool, 'alert_config_meta', 'child_routes_json', 'JSON NULL');
  await addColumn(pool, 'alert_receiver', 'basic_auth_username', 'VARCHAR(256)');
  await addColumn(pool, 'alert_receiver', 'basic_auth_password', 'VARCHAR(1024)');
  await pool.query('INSERT IGNORE INTO alert_config_meta (id, version, group_by_json) VALUES (1, 1, ?)', ['["alertname", "severity", "service"]']);
}

async function importSourceConfig(): Promise<void> {
  const pool = getPool();
  const [ruleCount] = await pool.query('SELECT COUNT(*) AS count FROM alert_rule');
  const [receiverCount] = await pool.query('SELECT COUNT(*) AS count FROM alert_receiver');
  const shouldImportRules = Number((ruleCount as any[])[0]?.count) === 0;
  const shouldImportReceivers = Number((receiverCount as any[])[0]?.count) === 0;

  if (shouldImportRules) try {
    const rulesDoc = yaml.load(await fs.readFile(env.ALERT_SOURCE_RULES_PATH, 'utf8')) as any;
    const rules = (rulesDoc?.groups ?? []).flatMap((group: any) =>
      (group.rules ?? []).map((rule: any) => ({
        ruleName: String(rule.alert ?? ''), groupName: String(group.name ?? 'castrel'),
        intervalSec: parseInterval(String(group.interval ?? '30s')),
        expression: String(rule.expr ?? ''), forDuration: String(rule.for ?? '0m'),
        severity: normalizeSeverity(rule.labels?.severity), summary: String(rule.annotations?.summary ?? rule.alert ?? ''),
        description: String(rule.annotations?.description ?? ''), enabled: true,
      })).filter((rule: AlertRule) => rule.ruleName && rule.expression),
    );
    for (const rule of rules) {
      await pool.query(
        `INSERT INTO alert_rule (rule_name, group_name, interval_sec, expression, for_duration, severity, summary, description, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [rule.ruleName, rule.groupName, rule.intervalSec, rule.expression, rule.forDuration, rule.severity, rule.summary, rule.description, rule.enabled],
      );
    }
  } catch {
    // A production image may not contain the source YAML. The UI can still create rules.
  }

  if (shouldImportReceivers) try {
    const managerDoc = yaml.load(await fs.readFile(env.ALERT_SOURCE_MANAGER_PATH, 'utf8')) as any;
    const route = managerDoc?.route ?? {};
    await pool.query(
      `UPDATE alert_config_meta SET route_receiver = ?, group_by_json = ?, group_wait = ?, group_interval = ?, repeat_interval = ?, route_continue = ?, child_routes_json = ? WHERE id = 1`,
      [String(route.receiver ?? DEFAULT_RECEIVER), JSON.stringify(route.group_by ?? ['alertname', 'severity', 'service']), String(route.group_wait ?? '30s'), String(route.group_interval ?? '3m'), String(route.repeat_interval ?? '5m'), false, JSON.stringify(parseRoutes(route.routes))],
    );
    const receivers = (managerDoc?.receivers ?? []).flatMap((receiver: any) =>
      (receiver.webhook_configs ?? []).map((webhook: any) => ({
        receiverName: String(receiver.name ?? DEFAULT_RECEIVER), receiverType: 'webhook' as const,
        endpoint: String(webhook.url ?? ''), severityMatch: receiver.name === 'critical-receiver' ? 'critical' : receiver.name === 'warning-receiver' ? 'warning' : 'all',
        sendResolved: webhook.send_resolved !== false, enabled: true,
        basicAuthUsername: String(webhook.http_config?.basic_auth?.username ?? ''),
        basicAuthPassword: String(webhook.http_config?.basic_auth?.password ?? ''),
      })).filter((receiver: AlertReceiver) => receiver.endpoint),
    );
    for (const receiver of receivers) {
      await pool.query(
        `INSERT IGNORE INTO alert_receiver (receiver_name, receiver_type, endpoint, basic_auth_username, basic_auth_password, severity_match, send_resolved, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [receiver.receiverName, receiver.receiverType, receiver.endpoint, receiver.basicAuthUsername || null, receiver.basicAuthPassword || null, receiver.severityMatch, receiver.sendResolved, receiver.enabled],
      );
    }
  } catch {
    await pool.query(
      `INSERT IGNORE INTO alert_receiver (receiver_name, receiver_type, endpoint, severity_match, send_resolved, enabled)
       VALUES (?, 'webhook', ?, 'all', 1, 1)`,
      [DEFAULT_RECEIVER, INTERNAL_WEBHOOK],
    );
  }

  await ensureDefaultReceiver(pool);
}

async function ensureDefaultReceiver(pool: ReturnType<typeof getPool>): Promise<void> {
  await pool.query(
    `INSERT IGNORE INTO alert_receiver (receiver_name, receiver_type, endpoint, severity_match, send_resolved, enabled)
     VALUES (?, 'webhook', ?, 'all', 1, 1)`,
    [DEFAULT_RECEIVER, INTERNAL_WEBHOOK],
  );
}

export async function loadAlertConfig(includeSecrets = false): Promise<AlertConfig> {
  await ensureTables();
  await importSourceConfig();
  const pool = getPool();
  const [metaRows] = await pool.query('SELECT * FROM alert_config_meta WHERE id = 1');
  const [ruleRows] = await pool.query('SELECT * FROM alert_rule ORDER BY group_name, rule_name');
  const [receiverRows] = await pool.query('SELECT * FROM alert_receiver ORDER BY receiver_name');
  return {
    version: Number((metaRows as any[])[0]?.version ?? 1),
    updatedAt: (metaRows as any[])[0]?.updated_at ? new Date((metaRows as any[])[0].updated_at).toISOString() : null,
    rules: (ruleRows as any[]).map(toRule), receivers: (receiverRows as any[]).map((row) => toReceiver(row, includeSecrets)),
    route: toRoute((metaRows as any[])[0]),
  };
}

export async function saveAlertConfig(input: AlertConfig): Promise<AlertConfig> {
  validateConfig(input);
  const current = await loadAlertConfig();
  const currentWithSecrets = await loadAlertConfig(true);
  if (input.version !== current.version) throw new Error('VERSION_CONFLICT');
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const nextVersion = current.version + 1;
    const [result] = await connection.query('UPDATE alert_config_meta SET version = version + 1 WHERE id = 1 AND version = ?', [input.version]);
    if ((result as any).affectedRows !== 1) throw new Error('VERSION_CONFLICT');
    await connection.query('DELETE FROM alert_rule');
    for (const rule of input.rules.filter((item) => item.enabled)) {
      await connection.query(
        `INSERT INTO alert_rule (rule_name, group_name, interval_sec, expression, for_duration, severity, summary, description, enabled, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [rule.ruleName, rule.groupName, rule.intervalSec, rule.expression, rule.forDuration, rule.severity, rule.summary, rule.description, nextVersion],
      );
    }
    await connection.query('DELETE FROM alert_receiver');
    for (const receiver of input.receivers.filter((item) => item.enabled)) {
      await connection.query(
        `INSERT INTO alert_receiver (receiver_name, receiver_type, endpoint, basic_auth_username, basic_auth_password, severity_match, send_resolved, enabled, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [receiver.receiverName, receiver.receiverType, receiver.endpoint, receiver.basicAuthUsername || null, receiver.basicAuthPassword || currentWithSecrets.receivers.find((item) => item.receiverName === receiver.receiverName)?.basicAuthPassword || null, receiver.severityMatch, receiver.sendResolved, nextVersion],
      );
    }
    await connection.query(
      `UPDATE alert_config_meta SET route_receiver = ?, group_by_json = ?, group_wait = ?, group_interval = ?, repeat_interval = ?, route_continue = ? WHERE id = 1`,
      [input.route.receiver, JSON.stringify(input.route.groupBy), input.route.groupWait, input.route.groupInterval, input.route.repeatInterval, false],
    );
    await connection.query('UPDATE alert_config_meta SET child_routes_json = ? WHERE id = 1', [JSON.stringify(input.route.routes)]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const savedWithSecrets = await loadAlertConfig(true);
  await renderAndReload(savedWithSecrets);
  return loadAlertConfig();
}

export function parseAlertmanagerYaml(source: string, current: AlertConfig): AlertConfig {
  const document = yaml.load(source) as any;
  if (!document || typeof document !== 'object') throw new Error('INVALID_ALERTMANAGER_YAML');
  const route = document.route ?? {};
  const receivers = (document.receivers ?? []).flatMap((receiver: any) =>
    (receiver.webhook_configs ?? []).map((webhook: any) => ({
      receiverName: String(receiver.name ?? DEFAULT_RECEIVER), receiverType: 'webhook' as const,
      endpoint: String(webhook.url ?? ''), severityMatch: 'all' as const,
      sendResolved: webhook.send_resolved !== false, enabled: true,
      basicAuthUsername: String(webhook.http_config?.basic_auth?.username ?? ''),
      basicAuthPassword: String(webhook.http_config?.basic_auth?.password ?? ''),
    })).filter((receiver: AlertReceiver) => receiver.endpoint),
  );
  if (!receivers.length) throw new Error('INVALID_ALERTMANAGER_RECEIVERS');
  const receiverByName = new Map(current.receivers.map((receiver) => [receiver.receiverName, receiver]));
  for (const receiver of receivers) {
    const existing = receiverByName.get(receiver.receiverName);
    receiverByName.set(receiver.receiverName, {
      ...existing,
      ...receiver,
      id: existing?.id,
    });
  }

  return {
    ...current,
    receivers: [...receiverByName.values()],
    route: {
      receiver: String(route.receiver ?? receivers[0].receiverName),
      groupBy: Array.isArray(route.group_by) ? route.group_by.map(String) : ['alertname'],
      groupWait: String(route.group_wait ?? '30s'), groupInterval: String(route.group_interval ?? '3m'),
      repeatInterval: String(route.repeat_interval ?? '5m'), continue: false, routes: parseRoutes(route.routes),
    },
  };
}

export function parsePrometheusRulesYaml(source: string, current: AlertConfig): AlertConfig {
  const document = yaml.load(source) as any;
  if (!document || typeof document !== 'object' || !Array.isArray(document.groups)) throw new Error('INVALID_PROMETHEUS_RULES_YAML');
  const importedRules: AlertRule[] = document.groups.flatMap((group: any) =>
    (Array.isArray(group?.rules) ? group.rules : []).map((rule: any) => ({
      ruleName: String(rule?.alert ?? ''),
      groupName: String(group?.name ?? 'castrel-custom'),
      intervalSec: parseInterval(String(group?.interval ?? '30s')),
      expression: String(rule?.expr ?? ''),
      forDuration: String(rule?.for ?? '0m'),
      severity: normalizeSeverity(rule?.labels?.severity),
      summary: String(rule?.annotations?.summary ?? rule?.alert ?? ''),
      description: String(rule?.annotations?.description ?? ''),
      enabled: true,
    })).filter((rule: AlertRule) => rule.ruleName && rule.expression),
  );
  if (!importedRules.length) throw new Error('INVALID_PROMETHEUS_RULES');

  const ruleByName = new Map(current.rules.map((rule) => [rule.ruleName, rule]));
  for (const rule of importedRules) {
    const existing = ruleByName.get(rule.ruleName);
    ruleByName.set(rule.ruleName, { ...existing, ...rule, id: existing?.id });
  }
  return { ...current, rules: [...ruleByName.values()] };
}

async function renderAndReload(config: AlertConfig): Promise<void> {
  const configDir = path.resolve(env.ALERT_CONFIG_DIR);
  const rulesPath = path.join(configDir, 'prometheus-rules', 'alert-rules.yml');
  const managerPath = path.join(configDir, 'alertmanager', 'alertmanager.yml');
  await fs.mkdir(path.dirname(rulesPath), { recursive: true });
  await fs.mkdir(path.dirname(managerPath), { recursive: true });
  await atomicWrite(rulesPath, yaml.dump(toPrometheusConfig(config), { noRefs: true, lineWidth: 140 }));
  await atomicWrite(managerPath, yaml.dump(toAlertmanagerConfig(config), { noRefs: true, lineWidth: 140 }));
  await reload(env.PROMETHEUS_RELOAD_URL, 'Prometheus');
  await reload(env.ALERTMANAGER_RELOAD_URL, 'Alertmanager');
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, contents, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

async function reload(url: string, service: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error(`${service.toUpperCase()}_RELOAD_UNREACHABLE`);
  }
  if (!response.ok) throw new Error(`${service.toUpperCase()}_RELOAD_FAILED`);
}

function toPrometheusConfig(config: AlertConfig) {
  const groups = new Map<string, any>();
  for (const rule of config.rules.filter((item) => item.enabled)) {
    if (!groups.has(rule.groupName)) groups.set(rule.groupName, { name: rule.groupName, interval: `${rule.intervalSec}s`, rules: [] });
    groups.get(rule.groupName).rules.push({ alert: rule.ruleName, expr: rule.expression, for: rule.forDuration, labels: { severity: rule.severity }, annotations: { summary: rule.summary, description: rule.description } });
  }
  return { groups: [...groups.values()] };
}

function toAlertmanagerConfig(config: AlertConfig) {
  const receivers = config.receivers.filter((item) => item.enabled).map((item) => ({ name: item.receiverName, webhook_configs: [{ url: item.endpoint, send_resolved: item.sendResolved, ...(item.basicAuthUsername && item.basicAuthPassword ? { http_config: { basic_auth: { username: item.basicAuthUsername, password: item.basicAuthPassword } } } : {}) }] }));
  const fallback = config.route.receiver || receivers[0]?.name || DEFAULT_RECEIVER;
  const routes = config.route.routes.map((route) => ({ receiver: route.receiver, match: route.match, ...(route.groupBy?.length ? { group_by: route.groupBy } : {}), ...(route.groupWait ? { group_wait: route.groupWait } : {}), ...(route.groupInterval ? { group_interval: route.groupInterval } : {}), ...(route.repeatInterval ? { repeat_interval: route.repeatInterval } : {}), continue: route.continue }));
  return { global: { resolve_timeout: '5m' }, route: { receiver: fallback, group_by: config.route.groupBy, group_wait: config.route.groupWait, group_interval: config.route.groupInterval, repeat_interval: config.route.repeatInterval, routes }, receivers: receivers.length ? receivers : [{ name: DEFAULT_RECEIVER, webhook_configs: [{ url: INTERNAL_WEBHOOK, send_resolved: true }] }] };
}

function toRule(row: any): AlertRule {
  return { id: Number(row.id), ruleName: row.rule_name, groupName: row.group_name, intervalSec: Number(row.interval_sec), expression: row.expression, forDuration: row.for_duration, severity: normalizeSeverity(row.severity), summary: row.summary, description: row.description, enabled: Boolean(row.enabled) };
}
function toReceiver(row: any, includeSecret: boolean): AlertReceiver {
  return { id: Number(row.id), receiverName: row.receiver_name, receiverType: 'webhook', endpoint: row.endpoint, basicAuthUsername: row.basic_auth_username || undefined, ...(includeSecret ? { basicAuthPassword: row.basic_auth_password || undefined } : { basicAuthPasswordSet: Boolean(row.basic_auth_password) }), severityMatch: row.severity_match, sendResolved: Boolean(row.send_resolved), enabled: Boolean(row.enabled) };
}
function toRoute(row: any): AlertConfig['route'] {
  let groupBy: string[] = ['alertname', 'severity', 'service'];
  try { groupBy = Array.isArray(row?.group_by_json) ? row.group_by_json : JSON.parse(row?.group_by_json || '[]'); } catch { /* use default */ }
  let routes: AlertRoute[] = [];
  try { routes = parseRoutes(Array.isArray(row?.child_routes_json) ? row.child_routes_json : JSON.parse(row?.child_routes_json || '[]')); } catch { /* use default */ }
  return { receiver: row?.route_receiver || DEFAULT_RECEIVER, groupBy: groupBy.length ? groupBy : ['alertname'], groupWait: row?.group_wait || '30s', groupInterval: row?.group_interval || '3m', repeatInterval: row?.repeat_interval || '5m', continue: false, routes };
}
function normalizeSeverity(value: unknown): AlertRule['severity'] {
  return value === 'critical' || value === 'info' ? value : 'warning';
}
function parseInterval(value: string): number {
  const match = value.match(/^(\d+)s$/);
  return match ? Number(match[1]) : 30;
}
function validateConfig(config: AlertConfig): void {
  if (!Array.isArray(config.rules) || !Array.isArray(config.receivers)) throw new Error('INVALID_CONFIG');
  const names = new Set<string>();
  for (const rule of config.rules) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rule.ruleName) || names.has(rule.ruleName) || !rule.expression.trim()) throw new Error('INVALID_RULE');
    names.add(rule.ruleName);
    if (!rule.groupName.trim() || rule.intervalSec < 1 || !/^\d+[smhd]$/.test(rule.forDuration) || !rule.summary.trim()) throw new Error('INVALID_RULE');
  }
  const receiverNames = new Set<string>();
  for (const receiver of config.receivers) {
    if (!/^[A-Za-z0-9_-]+$/.test(receiver.receiverName) || receiverNames.has(receiver.receiverName) || !/^https?:\/\//.test(receiver.endpoint)) throw new Error('INVALID_RECEIVER');
    receiverNames.add(receiver.receiverName);
  }
  if (!config.route?.receiver || !config.route.groupBy.length || !Array.isArray(config.route.routes) || !/^\d+[smhd]$/.test(config.route.groupWait) || !/^\d+[smhd]$/.test(config.route.groupInterval) || !/^\d+[smhd]$/.test(config.route.repeatInterval)) throw new Error('INVALID_ROUTE');
  for (const route of config.route.routes) {
    if (!route.receiver.trim() || !route.match || !Object.keys(route.match).length || !/^[A-Za-z0-9_-]+$/.test(route.receiver)) throw new Error('INVALID_ROUTE');
    if (route.groupWait && !/^\d+[smhd]$/.test(route.groupWait)) throw new Error('INVALID_ROUTE');
    if (route.groupInterval && !/^\d+[smhd]$/.test(route.groupInterval)) throw new Error('INVALID_ROUTE');
    if (route.repeatInterval && !/^\d+[smhd]$/.test(route.repeatInterval)) throw new Error('INVALID_ROUTE');
  }
}

function parseRoutes(routes: unknown): AlertRoute[] {
  if (!Array.isArray(routes)) return [];
  return routes.flatMap((route: any) => {
    if (!route || typeof route !== 'object' || typeof route.receiver !== 'string') return [];
    const match = route.match ?? route.match_re ?? {};
    return [{ receiver: route.receiver, match: typeof match === 'object' ? match : {}, groupBy: Array.isArray(route.group_by) ? route.group_by.map(String) : undefined, groupWait: route.group_wait ? String(route.group_wait) : undefined, groupInterval: route.group_interval ? String(route.group_interval) : undefined, repeatInterval: route.repeat_interval ? String(route.repeat_interval) : undefined, continue: Boolean(route.continue) } satisfies AlertRoute];
  });
}

async function addColumn(pool: ReturnType<typeof getPool>, table: string, column: string, definition: string): Promise<void> {
  try { await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch (error: any) {
    if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
  }
}
