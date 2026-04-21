// Environment configuration for traffic-control-plane

export const env = {
  // Gateway is the ONLY external service traffic-control-plane talks to
  GATEWAY_BASE_URL: process.env.GATEWAY_BASE_URL || 'http://localhost:18080',

  // MySQL for runner config storage
  MYSQL_HOST: process.env.MYSQL_HOST || 'localhost',
  MYSQL_PORT: parseInt(process.env.MYSQL_PORT || '13306', 10),
  MYSQL_USER: process.env.MYSQL_USER || 'castrel',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'castrel',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'castrel',

  // Redis for distributed locking & chaos state
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '16379', 10),

  // Grafana deep links
  GRAFANA_BASE_URL: process.env.GRAFANA_BASE_URL || '',
  TEMPO_BASE_URL: process.env.TEMPO_BASE_URL || '',

  // Worker settings
  WORKER_ENABLED: process.env.WORKER_ENABLED !== 'false',
} as const;
