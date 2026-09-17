-- Low-cardinality Alertmanager firing/resolved receipt evidence.
-- Raw webhook bodies, labels, annotations, and response payloads are not stored.

CREATE TABLE IF NOT EXISTS alert_receipts (
  receipt_id       BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_key      CHAR(64)     NOT NULL,
  fingerprint      VARCHAR(128) NOT NULL,
  alert_status     VARCHAR(16)  NOT NULL,
  receiver         VARCHAR(128) NOT NULL,
  alert_name       VARCHAR(128) NOT NULL,
  severity         VARCHAR(16)  NOT NULL,
  service_name     VARCHAR(128) NULL,
  starts_at        DATETIME(3)  NOT NULL,
  ends_at          DATETIME(3)  NULL,
  received_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_alert_receipt_key (receipt_key),
  INDEX idx_alert_receipt_fingerprint (fingerprint, received_at),
  INDEX idx_alert_receipt_status (alert_status, received_at),
  CHECK (alert_status IN ('firing', 'resolved')),
  CHECK (severity IN ('critical', 'warning', 'info', 'unknown'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
