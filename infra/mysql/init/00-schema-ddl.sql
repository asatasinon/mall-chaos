-- Castrel Chaos Platform - Version 1 schema DDL
-- This file runs before 01-seed-dml.sql during MySQL first initialization.

-- =============================================================================
-- Castrel Chaos Platform — Full Schema  (Tasks 01-09)
-- =============================================================================
-- Run order: this single file is mounted into /docker-entrypoint-initdb.d/
-- and executed automatically on first MySQL startup.

SET NAMES utf8mb4;
SET time_zone = '+08:00';

-- Version 1 is a clean-install contract. Services must verify this row before
-- accepting readiness or business traffic; migrations are intentionally out of scope.
CREATE TABLE IF NOT EXISTS schema_version (
  id           TINYINT      NOT NULL PRIMARY KEY,
  version      INT          NOT NULL,
  installed_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =============================================================================
-- user-service  (Task 04)
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nickname    VARCHAR(64)  NOT NULL,
    level       TINYINT      NOT NULL DEFAULT 1  COMMENT '1=Regular 2=VIP 3=SVIP',
    status      TINYINT      NOT NULL DEFAULT 1  COMMENT '1=Active 0=Banned',
    email       VARCHAR(128),
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_addresses (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT       NOT NULL,
    is_default  TINYINT      NOT NULL DEFAULT 0,
    province    VARCHAR(32),
    city        VARCHAR(32),
    district    VARCHAR(32),
    detail      VARCHAR(256),
    receiver    VARCHAR(64),
    phone       VARCHAR(16),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;



-- =============================================================================
-- catalog-service  (Task 05)
-- =============================================================================

CREATE TABLE IF NOT EXISTS products (
    id          BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sku         VARCHAR(32)     NOT NULL,
    name        VARCHAR(128)    NOT NULL,
    price       DECIMAL(10, 2)  NOT NULL,
    status      TINYINT         NOT NULL DEFAULT 1  COMMENT '1=Listed 0=Delisted',
    category    VARCHAR(64),
    media_url   VARCHAR(512),
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sku (sku),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =============================================================================
-- inventory-service  (Task 06)
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventories (
    id            BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sku           VARCHAR(32) NOT NULL,
    available_qty INT         NOT NULL DEFAULT 0,
    reserved_qty  INT         NOT NULL DEFAULT 0,
    version       INT         NOT NULL DEFAULT 0,
    updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_baseline_snapshot (
    id                BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sku               VARCHAR(32) NOT NULL,
    baseline_qty      INT         NOT NULL,
    baseline_version  INT         NOT NULL DEFAULT 1,
    updated_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;



-- =============================================================================
-- order-service  (Task 07)
-- =============================================================================

CREATE TABLE IF NOT EXISTS orders (
    id          BIGINT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_no    VARCHAR(32)    NOT NULL,
    user_id     BIGINT         NOT NULL,
    status      VARCHAR(16)    NOT NULL DEFAULT 'PENDING'
                COMMENT 'PENDING/PAID/FAILED/CANCELLED/COMPLETED',
    payment_id  VARCHAR(64),
    fail_reason VARCHAR(256),
    trace_id    VARCHAR(64),
    created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_order_no (order_no),
    INDEX idx_user_id (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- traffic-control-plane  (Task 09)
-- =============================================================================

CREATE TABLE IF NOT EXISTS runner_profile (
    id                       BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    enabled                  TINYINT NOT NULL DEFAULT 1,
    traffic_mode             VARCHAR(32) NOT NULL DEFAULT 'CUSTOMER_LIFECYCLE',
    lifecycle_interval_sec   TINYINT NOT NULL DEFAULT 60,
    max_items                TINYINT NOT NULL DEFAULT 3,
    max_item_quantity        TINYINT NOT NULL DEFAULT 3,
    successful_payment_ratio DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
    coupon_usage_ratio       DECIMAL(5,4) NOT NULL DEFAULT 0.0000,
    background_actions_enabled TINYINT NOT NULL DEFAULT 0,
    version                  INT NOT NULL DEFAULT 1,
    CONSTRAINT chk_runner_profile_mode CHECK (traffic_mode = 'CUSTOMER_LIFECYCLE'),
    CONSTRAINT chk_runner_profile_interval CHECK (lifecycle_interval_sec IN (60, 30, 20, 10, 5)),
    CONSTRAINT chk_runner_profile_payment_ratio CHECK (successful_payment_ratio BETWEEN 0 AND 1),
    CONSTRAINT chk_runner_profile_coupon_ratio CHECK (coupon_usage_ratio BETWEEN 0 AND 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS runner_customer_whitelist (
    customer_id BIGINT  NOT NULL PRIMARY KEY,
    enabled     TINYINT NOT NULL DEFAULT 1,
    version     INT     NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_runner_customer_user FOREIGN KEY (customer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS traffic_scenario_accounts (
  customer_id BIGINT NOT NULL PRIMARY KEY,
  role       VARCHAR(32) NOT NULL,
  enabled    TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_traffic_scenario_user FOREIGN KEY (customer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- Alert configuration is managed by traffic-control-plane and rendered to
-- Prometheus/Alertmanager files after each successful update.
CREATE TABLE IF NOT EXISTS alert_config_meta (
  id               BIGINT NOT NULL PRIMARY KEY,
  version          INT NOT NULL DEFAULT 1,
  route_receiver   VARCHAR(128) NOT NULL DEFAULT 'default-receiver',
  group_by_json    JSON NULL,
  group_wait       VARCHAR(32) NOT NULL DEFAULT '30s',
  group_interval   VARCHAR(32) NOT NULL DEFAULT '3m',
  repeat_interval  VARCHAR(32) NOT NULL DEFAULT '5m',
  route_continue   TINYINT(1) NOT NULL DEFAULT 0,
  child_routes_json JSON NULL,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS alert_rule (
  id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_name     VARCHAR(128) NOT NULL,
  group_name    VARCHAR(128) NOT NULL,
  interval_sec  INT NOT NULL DEFAULT 30,
  expression    TEXT NOT NULL,
  for_duration  VARCHAR(32) NOT NULL DEFAULT '0m',
  severity      VARCHAR(16) NOT NULL DEFAULT 'warning',
  summary       VARCHAR(512) NOT NULL,
  description   TEXT NOT NULL,
  enabled       TINYINT(1) NOT NULL DEFAULT 1,
  version       INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_alert_rule_name (rule_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS alert_receiver (
  id             BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receiver_name  VARCHAR(128) NOT NULL,
  receiver_type  VARCHAR(32) NOT NULL DEFAULT 'webhook',
  endpoint       VARCHAR(1024) NOT NULL,
  basic_auth_username VARCHAR(256),
  basic_auth_password VARCHAR(1024),
  severity_match VARCHAR(16) NOT NULL DEFAULT 'all',
  send_resolved  TINYINT(1) NOT NULL DEFAULT 1,
  enabled        TINYINT(1) NOT NULL DEFAULT 1,
  version        INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_alert_receiver_name (receiver_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- Phase 2 tables (Tasks 10-13)
-- =============================================================================

-- promotion-service (Task 10)
CREATE TABLE IF NOT EXISTS promotions (
    id          BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    type        VARCHAR(32)     NOT NULL COMMENT 'DISCOUNT / FULL_REDUCTION / COUPON',
    name        VARCHAR(128)    NOT NULL,
    min_amount  DECIMAL(10,2)   NOT NULL DEFAULT 0,
    discount    DECIMAL(4,2),
    reduce_amt  DECIMAL(10,2),
    enabled     TINYINT         NOT NULL DEFAULT 1,
    start_at    DATETIME,
    end_at      DATETIME,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coupons (
    id              BIGINT          NOT NULL AUTO_INCREMENT,
    user_id         BIGINT          NOT NULL,
    promotion_id    BIGINT          NOT NULL,
    status          TINYINT         NOT NULL DEFAULT 0 COMMENT '0=AVAILABLE 1=RESERVED 2=USED',
    expire_at       DATETIME,
    used_at         DATETIME,
  PRIMARY KEY (id),
    INDEX idx_user_id (user_id),
    INDEX idx_promotion_id (promotion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coupon_issuance_batches (
  id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  window_id     VARCHAR(64)  NOT NULL,
  customer_id   BIGINT       NOT NULL,
  promotion_id  BIGINT       NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'COMPLETED',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coupon_issuance_batch (window_id, customer_id, promotion_id),
  INDEX idx_coupon_issuance_status (window_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed promotions

-- Assign 2-3 coupons per user (userId 1-20)

-- risk-service (Task 11)
CREATE TABLE IF NOT EXISTS risk_rules (
    id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rule_type    VARCHAR(32)  NOT NULL COMMENT 'FREQ_LIMIT / AMOUNT_LIMIT / BLACKLIST',
    threshold    INT,
    window_sec   INT,
    enabled      TINYINT      NOT NULL DEFAULT 1,
    description  VARCHAR(256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS risk_events (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT       NOT NULL,
    order_no    VARCHAR(32),
    event_type  VARCHAR(32)  NOT NULL COMMENT 'PRE_CHECK_PASS / PRE_CHECK_REJECT / POST_PAY_FREEZE',
    reason      VARCHAR(256),
    trace_id    VARCHAR(64),
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_order_no (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- =============================================================================
-- Product price change history
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_price_history (
  id              BIGINT          NOT NULL AUTO_INCREMENT,
    sku             VARCHAR(32)     NOT NULL,
    previous_price  DECIMAL(10,2)   NOT NULL,
    current_price   DECIMAL(10,2)   NOT NULL,
    change_reason   VARCHAR(64)     NOT NULL COMMENT 'PROMOTION / COST_ADJUST / SEASONAL / MANUAL',
    operator_id     BIGINT          NOT NULL DEFAULT 0,
    effective_at    DATETIME        NOT NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, effective_at),
    INDEX idx_price_history_sku (sku, effective_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Product price change history';

-- =============================================================================
-- User behavior log
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_behavior_log (
    id              BIGINT          NOT NULL AUTO_INCREMENT,
    user_id         BIGINT          NOT NULL,
    action_type     VARCHAR(32)     NOT NULL COMMENT 'PAGE_VIEW / ADD_CART / PLACE_ORDER / SEARCH',
    target_id       VARCHAR(64)     NOT NULL,
    target_type     VARCHAR(32)     NOT NULL COMMENT 'PRODUCT / ORDER / CATEGORY',
    ip_address      VARCHAR(45),
    session_id      VARCHAR(64),
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='User behavior log';

-- =============================================================================
-- Storage growth records (written only by fixed target business services)
-- =============================================================================
CREATE TABLE IF NOT EXISTS storage_growth_records (
    id                   BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id               VARCHAR(64)   NOT NULL,
    source_service       VARCHAR(64)   NOT NULL,
    payload              BLOB          NOT NULL,
    created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_storage_growth_run_id (run_id),
    INDEX idx_storage_growth_source_service (source_service)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Storage growth records';

-- =============================================================================
-- Castrel Shopfront Version 1 contract tables
-- =============================================================================

ALTER TABLE user_addresses
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD COLUMN default_user_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN is_default = 1 THEN user_id ELSE NULL END
  ) STORED,
  ADD UNIQUE KEY uq_user_default_address (default_user_id);

ALTER TABLE orders
  ADD COLUMN version INT NOT NULL DEFAULT 0,
  ADD COLUMN idempotency_key VARCHAR(128),
  ADD COLUMN subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN address_id BIGINT,
  ADD COLUMN coupon_id BIGINT,
  ADD COLUMN traffic_run_id VARCHAR(64),
  ADD UNIQUE KEY uq_order_idempotency (user_id, idempotency_key);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id       BIGINT       NOT NULL PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  revoked_at    DATETIME,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    BIGINT      NOT NULL,
  role       VARCHAR(32) NOT NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS session_tokens (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT       NOT NULL,
  token_id   CHAR(36)     NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME     NOT NULL,
  revoked_at DATETIME,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_session_token_id (token_id),
  INDEX idx_session_user (user_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS carts (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT      NOT NULL,
  version    INT          NOT NULL DEFAULT 0,
  status     VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_active_cart_customer (customer_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cart_items (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cart_id    BIGINT       NOT NULL,
  sku        VARCHAR(32)  NOT NULL,
  quantity   INT          NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cart_sku (cart_id, sku),
  INDEX idx_cart_items_cart (cart_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id             BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id       BIGINT        NOT NULL,
  sku            VARCHAR(32)   NOT NULL,
  product_name   VARCHAR(128)  NOT NULL,
  quantity       INT           NOT NULL,
  unit_price     DECIMAL(10,2) NOT NULL,
  line_amount    DECIMAL(10,2) NOT NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_item_sku (order_id, sku),
  INDEX idx_order_items_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_address_snapshots (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id    BIGINT       NOT NULL,
  receiver    VARCHAR(64)  NOT NULL,
  phone       VARCHAR(16)  NOT NULL,
  province    VARCHAR(32)  NOT NULL,
  city        VARCHAR(32)  NOT NULL,
  district    VARCHAR(32),
  detail      VARCHAR(256) NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_address_snapshot (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id                BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_no        VARCHAR(64)   NOT NULL,
  order_id          BIGINT        NOT NULL,
  customer_id       BIGINT        NOT NULL,
  amount            DECIMAL(10,2) NOT NULL,
  status            VARCHAR(16)   NOT NULL DEFAULT 'CREATED',
  result_code       VARCHAR(32),
  idempotency_key   VARCHAR(128)  NOT NULL,
  trace_id          VARCHAR(64),
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payment_attempt_no (payment_no),
  UNIQUE KEY uq_payment_attempt_idempotency (order_id, idempotency_key),
  INDEX idx_payment_attempt_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS coupon_reservations (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  coupon_id      BIGINT       NOT NULL,
  order_id       VARCHAR(128) NOT NULL,
  customer_id    BIGINT       NOT NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'RESERVED',
  operation_id   VARCHAR(128) NOT NULL,
  expires_at     DATETIME,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coupon_operation (coupon_id, operation_id),
  UNIQUE KEY uq_coupon_order (coupon_id, order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reservation_id VARCHAR(128) NOT NULL,
  operation_id   VARCHAR(128) NOT NULL,
  order_id       VARCHAR(128) NOT NULL,
  sku            VARCHAR(32)  NOT NULL,
  quantity       INT          NOT NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'RESERVED',
  expires_at     DATETIME,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inventory_reservation (reservation_id, sku),
  UNIQUE KEY uq_inventory_operation (operation_id, sku),
  INDEX idx_inventory_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_replenishment_batches (
  id          BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  window_id   VARCHAR(64) NOT NULL,
  sku         VARCHAR(32) NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'COMPLETED',
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inventory_replenishment_batch (window_id, sku),
  INDEX idx_inventory_replenishment_status (window_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipments (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id    BIGINT       NOT NULL,
  order_no    VARCHAR(32)  NOT NULL,
  customer_id BIGINT       NOT NULL,
  status      VARCHAR(16)  NOT NULL DEFAULT 'FULFILLING',
  tracking_no VARCHAR(64),
  carrier     VARCHAR(32)  NOT NULL DEFAULT 'MockExpress',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shipment_order (order_id),
  INDEX idx_shipment_customer (customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipment_timeline_events (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shipment_id BIGINT       NOT NULL,
  status      VARCHAR(16)  NOT NULL,
  message     VARCHAR(256) NOT NULL,
  occurred_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shipment_timeline_status (shipment_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notification_preferences (
  customer_id BIGINT      NOT NULL PRIMARY KEY,
  email       TINYINT(1)  NOT NULL DEFAULT 1,
  in_app      TINYINT(1)  NOT NULL DEFAULT 1,
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_notifications (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT       NOT NULL,
  event_id    CHAR(36),
  event_type  VARCHAR(64)  NOT NULL,
  title       VARCHAR(128) NOT NULL,
  body        VARCHAR(512) NOT NULL,
  is_read     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at     DATETIME,
  operation_run_id CHAR(36),
  UNIQUE KEY uq_customer_notification_event (customer_id, event_id),
  INDEX idx_customer_notifications (customer_id, is_read, created_at),
  INDEX idx_customer_notifications_operation (operation_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS traffic_runs (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  traffic_run_id VARCHAR(64)  NOT NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'RUNNING',
  config_version INT          NOT NULL DEFAULT 1,
  started_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at       DATETIME,
  created_by     BIGINT,
  UNIQUE KEY uq_traffic_run_id (traffic_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS traffic_actions (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  traffic_run_id VARCHAR(64)  NOT NULL,
  lifecycle_id   CHAR(36),
  action_id      VARCHAR(64)  NOT NULL,
  customer_id    BIGINT,
  action_type    VARCHAR(64)  NOT NULL,
  status         VARCHAR(16)  NOT NULL,
  order_id       BIGINT,
  payment_id     BIGINT,
  cart_version   INT,
  result_code    VARCHAR(64),
  error_code     VARCHAR(64),
  trace_id       VARCHAR(64),
  latency_ms     BIGINT,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_traffic_action_id (action_id),
  INDEX idx_traffic_actions_run (traffic_run_id, created_at),
  INDEX idx_traffic_actions_lifecycle (traffic_run_id, lifecycle_id, created_at),
  INDEX idx_traffic_actions_time (traffic_run_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS traffic_replenishment_runs (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  window_id      VARCHAR(64)  NOT NULL,
  operation_type VARCHAR(40)  NOT NULL,
  status         VARCHAR(16)  NOT NULL,
  started_at     DATETIME     NOT NULL,
  completed_at   DATETIME,
  retry_count    INT          NOT NULL DEFAULT 0,
  result_summary VARCHAR(512),
  correlation_id VARCHAR(64)  NOT NULL,
  UNIQUE KEY uq_replenishment_window (window_id, operation_type),
  INDEX idx_replenishment_status (operation_type, status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS operator_audit_logs (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operator_id    BIGINT,
  action         VARCHAR(128) NOT NULL,
  target         VARCHAR(256),
  parameter_hash VARCHAR(128),
  result         VARCHAR(16)  NOT NULL,
  correlation_id VARCHAR(128),
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_operator_audit_time (created_at),
  INDEX idx_operator_audit_operator (operator_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Version 1 seed identities. Password hashes are BCrypt values for the two
-- documented demo accounts and are never returned by a service API.





