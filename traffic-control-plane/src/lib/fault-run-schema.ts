import { getPool } from './db';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS fault_run_sequence (
    id TINYINT NOT NULL PRIMARY KEY,
    last_token BIGINT UNSIGNED NOT NULL DEFAULT 0,
    CHECK (id = 1)
  ) ENGINE=InnoDB`,
  `INSERT IGNORE INTO fault_run_sequence (id, last_token) VALUES (1, 0)`,
  `CREATE TABLE IF NOT EXISTS fault_runs (
    fault_run_id CHAR(36) NOT NULL PRIMARY KEY,
    scenario VARCHAR(64) NOT NULL,
    target_service VARCHAR(64) NOT NULL,
    target_operation VARCHAR(128) NOT NULL,
    state VARCHAR(32) NOT NULL,
    parameters_json JSON NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    fencing_token BIGINT UNSIGNED NOT NULL,
    started_at DATETIME(3) NULL,
    expires_at DATETIME(3) NOT NULL,
    stopped_at DATETIME(3) NULL,
    stop_reason VARCHAR(32) NULL,
    recovery_result JSON NULL,
    recovery_error VARCHAR(1024) NULL,
    operator_audit_id BIGINT NULL,
    trace_id VARCHAR(128) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    active_run_guard TINYINT GENERATED ALWAYS AS (
      CASE WHEN state IN ('CREATING', 'ACTIVE', 'RECOVERING') THEN 1 ELSE NULL END
    ) STORED,
    UNIQUE KEY uq_fault_run_idempotency (idempotency_key),
    UNIQUE KEY uq_fault_run_active (active_run_guard),
    INDEX idx_fault_run_state_expiry (state, expires_at),
    INDEX idx_fault_run_scenario_started (scenario, started_at),
    INDEX idx_fault_run_target_service (target_service),
    CHECK (state IN ('CREATING', 'ACTIVE', 'RECOVERING', 'RECOVERED', 'STOPPED', 'FAILED', 'SERVICE_UNAVAILABLE'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS fault_run_events (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    fault_run_id CHAR(36) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_fault_run_event_run FOREIGN KEY (fault_run_id)
      REFERENCES fault_runs(fault_run_id) ON DELETE CASCADE,
    INDEX idx_fault_run_event_time (fault_run_id, created_at, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

let schemaPromise: Promise<void> | null = null;

export function ensureFaultRunSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const pool = getPool();
      for (const statement of SCHEMA_STATEMENTS) await pool.query(statement);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export { SCHEMA_STATEMENTS };
