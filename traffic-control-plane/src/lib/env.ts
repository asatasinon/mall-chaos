// Environment configuration for traffic-control-plane

export const env = {
  // Gateway is the ONLY external service traffic-control-plane talks to
  GATEWAY_BASE_URL: process.env.GATEWAY_BASE_URL || 'http://localhost:18080',
  CASTREL_INTERNAL_SERVICE_KEY: process.env.CASTREL_INTERNAL_SERVICE_KEY || '',
  NOTIFICATION_RESTART_BROKER_URL: process.env.NOTIFICATION_RESTART_BROKER_URL || 'http://localhost:8095',
  NOTIFICATION_RESTART_BROKER_KEY: process.env.NOTIFICATION_RESTART_BROKER_KEY || '',
  TRAFFIC_LIFECYCLE_ACCOUNTS: process.env.TRAFFIC_LIFECYCLE_ACCOUNTS || '[]',
  TRAFFIC_SCENARIO_ACCOUNTS: process.env.TRAFFIC_SCENARIO_ACCOUNTS
    || '[{"label":"sam","email":"sam@example.com","password":"password","expectedCustomerId":19}]',

  // MySQL for runner config storage
  MYSQL_HOST: process.env.MYSQL_HOST || 'localhost',
  MYSQL_PORT: parseInt(process.env.MYSQL_PORT || '13306', 10),
  MYSQL_USER: process.env.MYSQL_USER || 'castrel',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'castrel',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'castrel',
  MYSQL_POOL_CONNECTION_LIMIT: boundedInteger(process.env.MYSQL_POOL_CONNECTION_LIMIT, 5, 3, 20),

  // Redis for distributed locking and runtime coordination
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '16379', 10),

  // Grafana deep links
  GRAFANA_BASE_URL: process.env.GRAFANA_BASE_URL || '',
  TEMPO_BASE_URL: process.env.TEMPO_BASE_URL || '',

  ALERT_CONFIG_DIR: process.env.ALERT_CONFIG_DIR || '../data',
  ALERT_SOURCE_RULES_PATH: process.env.ALERT_SOURCE_RULES_PATH || '../infra/prometheus/rules/alert-rules.yml',
  ALERT_SOURCE_MANAGER_PATH: process.env.ALERT_SOURCE_MANAGER_PATH || '../infra/alertmanager/alertmanager.yml',
  PROMETHEUS_RELOAD_URL: process.env.PROMETHEUS_RELOAD_URL || 'http://localhost:9090/-/reload',
  ALERTMANAGER_RELOAD_URL: process.env.ALERTMANAGER_RELOAD_URL || 'http://localhost:9093/-/reload',

  // Worker settings
  WORKER_ENABLED: process.env.WORKER_ENABLED !== 'false',
  DATA_WARMUP_ENABLED: process.env.DATA_WARMUP_ENABLED !== 'false',
  DATA_WARMUP_WINDOW_DAYS: parseInt(process.env.DATA_WARMUP_WINDOW_DAYS || '180', 10),
  DATA_WARMUP_ROWS_PER_DAY: parseInt(process.env.DATA_WARMUP_ROWS_PER_DAY || '300000', 10),
  DATA_WARMUP_TARGET_ROWS: parseInt(process.env.DATA_WARMUP_TARGET_ROWS || '54000000', 10),
  DATA_WARMUP_BATCH_SIZE: parseInt(process.env.DATA_WARMUP_BATCH_SIZE || '1000', 10),
  DATA_WARMUP_BATCH_INTERVAL_MS: parseInt(process.env.DATA_WARMUP_BATCH_INTERVAL_MS || '1000', 10),
  DATA_WARMUP_MAX_CONCURRENCY: boundedInteger(process.env.DATA_WARMUP_MAX_CONCURRENCY, 2, 1, 4),
  DATA_WARMUP_DB_CONCURRENCY: boundedInteger(process.env.DATA_WARMUP_DB_CONCURRENCY, 2, 1, 4),
  APP_TIME_ZONE: process.env.APP_TIME_ZONE || 'Asia/Shanghai',
  PRODUCT_DETAIL_REQUEST_TIMEOUT_MS: boundedInteger(
    process.env.PRODUCT_DETAIL_REQUEST_TIMEOUT_MS, 5000, 100, 30_000),
} as const;

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}
