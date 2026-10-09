-- Phase 4 Evidence schema for clean-database bootstrap only.
-- This is not an upgrade path for an existing application volume.

CREATE TABLE IF NOT EXISTS evidence_contract_snapshots (
  snapshot_id CHAR(36) NOT NULL PRIMARY KEY,
  source_fault_run_id CHAR(36) NOT NULL,
  scenario VARCHAR(64) NOT NULL,
  contract_schema_version VARCHAR(64) NOT NULL,
  contract_revision VARCHAR(128) NOT NULL,
  contract_hash CHAR(64) NOT NULL,
  contract_json JSON NOT NULL,
  renderer_revision VARCHAR(64) NOT NULL,
  evaluation_revision VARCHAR(64) NOT NULL,
  rendered_plan_hash CHAR(64) NOT NULL,
  rendered_plan_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_evidence_contract_source_run (source_fault_run_id),
  INDEX idx_evidence_contract_scenario_revision (scenario, contract_revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS evidence_query_manifests (
  manifest_id CHAR(36) NOT NULL PRIMARY KEY,
  snapshot_id CHAR(36) NOT NULL,
  source_fault_run_id CHAR(36) NOT NULL,
  scenario VARCHAR(64) NOT NULL,
  manifest_schema_version VARCHAR(64) NOT NULL,
  contract_revision VARCHAR(128) NOT NULL,
  manifest_revision INT UNSIGNED NOT NULL,
  timeline_hash CHAR(64) NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  timeline_json JSON NOT NULL,
  windows_json JSON NOT NULL,
  recipes_json JSON NOT NULL,
  limitations_json JSON NOT NULL,
  source_run_retained TINYINT NOT NULL DEFAULT 1,
  materialized_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_evidence_manifest_source_timeline (source_fault_run_id, timeline_hash),
  UNIQUE KEY uq_evidence_manifest_source_revision (source_fault_run_id, manifest_revision),
  INDEX idx_evidence_manifest_source (source_fault_run_id, manifest_revision),
  INDEX idx_evidence_manifest_contract (contract_revision, materialized_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS evidence_query_attempts (
  attempt_id CHAR(36) NOT NULL PRIMARY KEY,
  manifest_id CHAR(36) NOT NULL,
  source_fault_run_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  state VARCHAR(32) NOT NULL,
  evidence_status VARCHAR(32) NULL,
  operator_audit_id BIGINT NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deadline_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  total_duration_ms INT UNSIGNED NULL,
  failure_code VARCHAR(64) NULL,
  UNIQUE KEY uq_evidence_attempt_idempotency (source_fault_run_id, idempotency_key),
  INDEX idx_evidence_attempt_manifest_time (manifest_id, requested_at),
  INDEX idx_evidence_attempt_run_deadline (source_fault_run_id, state, deadline_at),
  CHECK (state IN ('RUNNING', 'COMPLETED', 'EVIDENCE_UNAVAILABLE', 'FAILED')),
  CHECK (evidence_status IS NULL OR evidence_status IN ('AVAILABLE', 'PARTIAL', 'EVIDENCE_UNAVAILABLE', 'INVALID_QUERY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS evidence_query_attempt_items (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  attempt_id CHAR(36) NOT NULL,
  recipe_id VARCHAR(96) NOT NULL,
  source VARCHAR(24) NOT NULL,
  window_name VARCHAR(24) NOT NULL,
  availability VARCHAR(32) NOT NULL,
  coverage VARCHAR(16) NOT NULL,
  predicate_outcome VARCHAR(16) NOT NULL,
  reason_code VARCHAR(64) NULL,
  duration_ms INT UNSIGNED NULL,
  queried_at DATETIME(3) NULL,
  executed_start_at DATETIME(3) NULL,
  executed_end_at DATETIME(3) NULL,
  UNIQUE KEY uq_evidence_attempt_recipe_window (attempt_id, recipe_id, window_name),
  INDEX idx_evidence_attempt_item_attempt (attempt_id),
  CHECK (source IN ('RUN_EVENT', 'PROMETHEUS', 'LOKI', 'TEMPO', 'BUSINESS_CHECK', 'RESOURCE_CHECK')),
  CHECK (availability IN ('AVAILABLE', 'NO_DATA', 'EVIDENCE_UNAVAILABLE', 'INVALID_QUERY', 'NOT_APPLICABLE')),
  CHECK (coverage IN ('FULL', 'PARTIAL', 'NONE', 'NOT_APPLICABLE')),
  CHECK (predicate_outcome IN ('MET', 'NOT_MET', 'INCONCLUSIVE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS evidence_operator_notes (
  note_id CHAR(36) NOT NULL PRIMARY KEY,
  manifest_id CHAR(36) NOT NULL,
  source_fault_run_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  operator_audit_id BIGINT NOT NULL,
  note_text VARCHAR(2048) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_evidence_note_audit (operator_audit_id),
  UNIQUE KEY uq_evidence_note_idempotency (source_fault_run_id, idempotency_key),
  INDEX idx_evidence_note_manifest_time (manifest_id, created_at, note_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
