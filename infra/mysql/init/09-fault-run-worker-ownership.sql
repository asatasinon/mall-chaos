-- Phase 2 Worker ownership and reconciliation schema.
-- Fresh-install parity for traffic-control-plane/src/lib/migrations/005-*.

CREATE TABLE IF NOT EXISTS traffic_control_plane_schema_migrations (
  migration_id VARCHAR(128) NOT NULL PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  applied_by VARCHAR(128) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fault_run_executions (
  fault_run_id CHAR(36) NOT NULL PRIMARY KEY,
  execution_mode VARCHAR(16) NOT NULL,
  owner_id VARCHAR(192) NULL,
  owner_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0,
  lease_acquired_at DATETIME(3) NULL,
  lease_expires_at DATETIME(3) NULL,
  last_heartbeat_at DATETIME(3) NULL,
  lease_lost_at DATETIME(3) NULL,
  reconciled_at DATETIME(3) NULL,
  reconciliation_state VARCHAR(40) NOT NULL DEFAULT 'IDLE',
  drain_state VARCHAR(32) NOT NULL DEFAULT 'IDLE',
  drain_deadline_at DATETIME(3) NULL,
  last_action VARCHAR(64) NULL,
  last_action_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_fault_run_execution_run
    FOREIGN KEY (fault_run_id) REFERENCES fault_runs(fault_run_id) ON DELETE CASCADE,
  INDEX idx_fault_run_execution_lease (lease_expires_at, fault_run_id),
  INDEX idx_fault_run_execution_reconcile (reconciliation_state, lease_expires_at),
  INDEX idx_fault_run_execution_owner (owner_id, owner_epoch),
  CHECK (execution_mode IN ('OBSERVE', 'SHADOW', 'TAKEOVER')),
  CHECK (reconciliation_state IN (
    'IDLE', 'OWNED', 'TAKEOVER_PENDING', 'TAKEN_OVER',
    'RECOVERY_PENDING', 'MANUAL_INTERVENTION_REQUIRED'
  )),
  CHECK (drain_state IN (
    'IDLE', 'OWNED', 'DRAINING', 'DRAINED',
    'DRAIN_TIMEOUT', 'LEASE_LOST', 'NOT_APPLICABLE'
  ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fault_run_actions (
  action_id CHAR(36) NOT NULL PRIMARY KEY,
  fault_run_id CHAR(36) NOT NULL,
  action_type VARCHAR(16) NOT NULL,
  attempt_no SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  action_state VARCHAR(24) NOT NULL,
  requested_by VARCHAR(16) NOT NULL,
  request_idempotency_key VARCHAR(128) NOT NULL,
  operator_audit_id BIGINT NULL,
  dispatch_owner_id VARCHAR(192) NULL,
  dispatch_owner_epoch BIGINT UNSIGNED NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  dispatch_started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  result_summary_json JSON NULL,
  error_code VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_fault_run_action_run
    FOREIGN KEY (fault_run_id) REFERENCES fault_runs(fault_run_id) ON DELETE CASCADE,
  UNIQUE KEY uq_fault_run_action_attempt (fault_run_id, action_type, attempt_no),
  UNIQUE KEY uq_fault_run_action_request (fault_run_id, action_type, request_idempotency_key),
  INDEX idx_fault_run_action_pending (action_state, requested_at),
  INDEX idx_fault_run_action_run_type (fault_run_id, action_type, attempt_no),
  CHECK (action_type IN ('PREPARE', 'RELEASE', 'CLEANUP')),
  CHECK (action_state IN (
    'REQUESTED', 'DISPATCHING', 'CONFIRMED',
    'DEFINITIVE_FAILURE', 'OUTCOME_UNKNOWN', 'CANCELLED'
  )),
  CHECK (requested_by IN ('OPERATOR', 'RECONCILER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
