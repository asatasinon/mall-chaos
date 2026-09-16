-- Database-owned Data Warmup runtime configuration.
-- The application inserts the first row from strictly validated environment defaults.

CREATE TABLE IF NOT EXISTS data_warmup_config (
  config_id              TINYINT      NOT NULL PRIMARY KEY,
  enabled                TINYINT      NOT NULL,
  window_days            INT          NOT NULL,
  rows_per_day           INT          NOT NULL,
  target_rows            BIGINT       NOT NULL,
  batch_size             INT          NOT NULL,
  batch_interval_ms      INT          NOT NULL,
  max_concurrency        TINYINT      NOT NULL,
  db_concurrency         TINYINT      NOT NULL,
  version                BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_by_operator_id BIGINT       NULL,
  created_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CHECK (config_id = 1),
  CHECK (enabled IN (0, 1)),
  CHECK (window_days BETWEEN 1 AND 365),
  CHECK (rows_per_day BETWEEN 1 AND 1000000),
  CHECK (target_rows = window_days * rows_per_day),
  CHECK (batch_size BETWEEN 1 AND 5000),
  CHECK (batch_interval_ms BETWEEN 0 AND 60000),
  CHECK (max_concurrency BETWEEN 1 AND 4),
  CHECK (db_concurrency BETWEEN 1 AND 4)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

