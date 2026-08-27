// Environment configuration for traffic-control-plane

export const env = {
  // Gateway is the ONLY external service traffic-control-plane talks to
  GATEWAY_BASE_URL: process.env.GATEWAY_BASE_URL || 'http://localhost:18080',
  CASTREL_INTERNAL_SERVICE_KEY: process.env.CASTREL_INTERNAL_SERVICE_KEY || '',
  TRAFFIC_LIFECYCLE_ACCOUNTS: process.env.TRAFFIC_LIFECYCLE_ACCOUNTS || '[]',

  // MySQL for runner config storage
  MYSQL_HOST: process.env.MYSQL_HOST || 'localhost',
  MYSQL_PORT: parseInt(process.env.MYSQL_PORT || '13306', 10),
  MYSQL_USER: process.env.MYSQL_USER || 'castrel',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'castrel',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'castrel',

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
} as const;
