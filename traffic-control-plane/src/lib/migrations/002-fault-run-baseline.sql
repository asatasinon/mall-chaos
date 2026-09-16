-- BASELINE_SCHEMA_REVISION=baseline.v1
-- Phase 0 baseline summaries. These tables intentionally do not reference
-- Fault Run or audit rows with foreign keys so summaries survive retention.

CREATE TABLE IF NOT EXISTS scenario_baselines (
  baseline_id                  CHAR(36)     NOT NULL PRIMARY KEY,
  scenario                     VARCHAR(64)  NOT NULL,
  source_fault_run_id          CHAR(36)     NOT NULL,
  capture_status               VARCHAR(32)  NOT NULL,
  catalog_revision             VARCHAR(128) NOT NULL,
  release_revision             VARCHAR(128) NULL,
  deployment_mode              VARCHAR(32)  NOT NULL,
  schema_revision              VARCHAR(64)  NOT NULL,
  data_warmup_enabled          TINYINT      NULL,
  warmup_config                JSON         NULL,
  lifecycle_json               JSON         NOT NULL,
  outcome_json                 JSON         NOT NULL,
  request_summary_json         JSON         NULL,
  resource_budget_json         JSON         NULL,
  resource_observation_json    JSON         NULL,
  observation_summary_json     JSON         NOT NULL,
  alert_summary_json           JSON         NOT NULL,
  known_limitations            JSON         NOT NULL,
  residual_resources           JSON         NOT NULL,
  rollback_procedure           JSON         NOT NULL,
  created_by_operator_audit_id BIGINT       NULL,
  created_at                   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_baseline_source_run (source_fault_run_id),
  INDEX idx_baseline_scenario_revision (scenario, catalog_revision, created_at),
  INDEX idx_baseline_status (capture_status, created_at),
  CHECK (capture_status IN ('COMPLETE', 'COMPLETE_WITH_LIMITATIONS', 'INCOMPLETE', 'CAPTURE_FAILED')),
  CHECK (deployment_mode IN ('local', 'compose', 'kubernetes', 'unknown')),
  CHECK (data_warmup_enabled IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE scenario_baselines
  MODIFY data_warmup_enabled TINYINT NULL;

CREATE TABLE IF NOT EXISTS baseline_pilot_reviews (
  review_id               BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scenario                VARCHAR(64)  NOT NULL,
  catalog_revision        VARCHAR(128) NOT NULL,
  decision                VARCHAR(16)  NOT NULL,
  alert_rules             JSON         NOT NULL,
  evidence_requirements   JSON         NOT NULL,
  retention_snapshot      JSON         NOT NULL,
  remediation_boundary    TEXT         NOT NULL,
  decision_reason         TEXT         NOT NULL,
  operator_audit_id       BIGINT       NOT NULL,
  reviewed_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pilot_review (scenario, catalog_revision),
  CHECK (decision IN ('CANDIDATE', 'SELECTED', 'REJECTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
