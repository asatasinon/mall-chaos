-- =============================================================================
-- Castrel Chaos Platform — Full Schema  (Tasks 01-09)
-- =============================================================================
-- Run order: this single file is mounted into /docker-entrypoint-initdb.d/
-- and executed automatically on first MySQL startup.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Version 1 is a clean-install contract. Services must verify this row before
-- accepting readiness or business traffic; migrations are intentionally out of scope.
CREATE TABLE IF NOT EXISTS schema_version (
  id           TINYINT      NOT NULL PRIMARY KEY,
  version      INT          NOT NULL,
  installed_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO schema_version (id, version)
VALUES (1, 1)
ON DUPLICATE KEY UPDATE version = VALUES(version);

-- =============================================================================
-- user-service  (Task 04)
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nickname    VARCHAR(64)  NOT NULL,
    level       TINYINT      NOT NULL DEFAULT 1  COMMENT '1=普通 2=VIP 3=SVIP',
    status      TINYINT      NOT NULL DEFAULT 1  COMMENT '1=正常 0=封禁',
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

INSERT INTO users (nickname, level, status, email) VALUES
  ('Alice',   2, 1, 'alice@example.com'),
  ('Bob',     1, 1, 'bob@example.com'),
  ('Carol',   3, 1, 'carol@example.com'),
  ('David',   1, 1, 'david@example.com'),
  ('Eve',     2, 1, 'eve@example.com'),
  ('Frank',   1, 1, 'frank@example.com'),
  ('Grace',   1, 1, 'grace@example.com'),
  ('Hank',    3, 1, 'hank@example.com'),
  ('Ivy',     1, 1, 'ivy@example.com'),
  ('Jack',    2, 1, 'jack@example.com'),
  ('Karen',   1, 1, 'karen@example.com'),
  ('Leo',     1, 1, 'leo@example.com'),
  ('Mona',    2, 1, 'mona@example.com'),
  ('Nick',    1, 1, 'nick@example.com'),
  ('Olivia',  3, 1, 'olivia@example.com'),
  ('Peter',   1, 1, 'peter@example.com'),
  ('Quinn',   1, 1, 'quinn@example.com'),
  ('Rachel',  2, 1, 'rachel@example.com'),
  ('Sam',     1, 1, 'sam@example.com'),
  ('Tina',    1, 0, 'tina@example.com');

INSERT INTO user_addresses (user_id, is_default, province, city, district, detail, receiver, phone) VALUES
  (1,  1, '广东省', '深圳市', '南山区', '科技园南路1号', 'Alice',  '13800000001'),
  (2,  1, '北京市', '北京市', '朝阳区', '望京SOHO T1',  'Bob',    '13800000002'),
  (3,  1, '上海市', '上海市', '浦东新区', '陆家嘴环路1000号', 'Carol', '13800000003'),
  (4,  1, '浙江省', '杭州市', '西湖区', '文三路477号',  'David',  '13800000004'),
  (5,  1, '广东省', '广州市', '天河区', '体育西路121号','Eve',    '13800000005'),
  (6,  1, '四川省', '成都市', '武侯区', '天府大道1700号','Frank', '13800000006'),
  (7,  1, '湖北省', '武汉市', '洪山区', '珞喻路1037号', 'Grace',  '13800000007'),
  (8,  1, '陕西省', '西安市', '高新区', '科技路6号',    'Hank',   '13800000008'),
  (9,  1, '江苏省', '南京市', '鼓楼区', '汉中路1号',    'Ivy',    '13800000009'),
  (10, 1, '重庆市', '重庆市', '渝北区', '红锦大道3号',  'Jack',   '13800000010'),
  (11, 1, '广东省', '深圳市', '福田区', '深南中路1006号','Karen', '13800000011'),
  (12, 1, '北京市', '北京市', '海淀区', '中关村大街1号','Leo',    '13800000012'),
  (13, 1, '上海市', '上海市', '黄浦区', '南京东路1号',  'Mona',   '13800000013'),
  (14, 1, '浙江省', '宁波市', '鄞州区', '学仕路655号',  'Nick',   '13800000014'),
  (15, 1, '广东省', '东莞市', '南城区', '鸿福路1号',    'Olivia', '13800000015'),
  (16, 1, '福建省', '厦门市', '思明区', '湖滨南路388号','Peter',  '13800000016'),
  (17, 1, '湖南省', '长沙市', '岳麓区', '麓谷大道688号','Quinn',  '13800000017'),
  (18, 1, '天津市', '天津市', '滨海新区', '滨海科技园1号','Rachel','13800000018'),
  (19, 1, '辽宁省', '沈阳市', '沈河区', '中街路168号',  'Sam',    '13800000019'),
  (20, 1, '山东省', '青岛市', '市南区', '香港中路1号',  'Tina',   '13800000020');

-- =============================================================================
-- catalog-service  (Task 05)
-- =============================================================================

CREATE TABLE IF NOT EXISTS products (
    id          BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sku         VARCHAR(32)     NOT NULL,
    name        VARCHAR(128)    NOT NULL,
    price       DECIMAL(10, 2)  NOT NULL,
    status      TINYINT         NOT NULL DEFAULT 1  COMMENT '1=上架 0=下架',
    category    VARCHAR(64),
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sku (sku),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO products (sku, name, price, status, category) VALUES
  ('SKU-001', '无线蓝牙耳机 Pro',        299.00, 1, '数码'),
  ('SKU-002', '便携式移动电源 20000mAh', 149.00, 1, '数码'),
  ('SKU-003', '机械键盘 Cherry MX',       699.00, 1, '数码'),
  ('SKU-004', '4K 显示器 27寸',          1899.00, 1, '数码'),
  ('SKU-005', '人体工学椅',              2499.00, 1, '家居'),
  ('SKU-006', '立式台灯 LED',             129.00, 1, '家居'),
  ('SKU-007', '不锈钢保温杯 500ml',        89.00, 1, '家居'),
  ('SKU-008', '瑜伽垫 PVC 防滑',           79.00, 1, '运动'),
  ('SKU-009', '哑铃 10kg 对',             119.00, 1, '运动'),
  ('SKU-010', '跑步鞋 透气',              389.00, 1, '运动'),
  ('SKU-011', '棉质T恤 纯色',              59.00, 1, '服装'),
  ('SKU-012', '牛仔裤 修身',              199.00, 1, '服装'),
  ('SKU-013', '羽绒服 轻薄',              499.00, 1, '服装'),
  ('SKU-014', '防晒霜 SPF50',              89.00, 1, '美妆'),
  ('SKU-015', '口红 哑光',                149.00, 1, '美妆'),
  ('SKU-016', '洁面乳 氨基酸',             79.00, 1, '美妆'),
  ('SKU-017', '绿茶 明前龙井 100g',        299.00, 1, '食品'),
  ('SKU-018', '坚果礼包 混合装',           129.00, 1, '食品'),
  ('SKU-019', '有机燕麦片 1kg',             49.00, 1, '食品'),
  ('SKU-020', '橄榄油 特级初榨 500ml',      89.00, 1, '食品'),
  ('SKU-021', '无线鼠标 静音',             129.00, 1, '数码'),
  ('SKU-022', 'USB-C 集线器 7合1',         199.00, 1, '数码'),
  ('SKU-023', '网络摄像头 1080P',          249.00, 1, '数码'),
  ('SKU-024', '平板支架 铝合金',            99.00, 1, '数码'),
  ('SKU-025', '手机壳 硅胶防摔',            29.00, 1, '数码'),
  ('SKU-026', '收纳盒 桌面整理',            49.00, 1, '家居'),
  ('SKU-027', '香薰蜡烛 薰衣草',            79.00, 1, '家居'),
  ('SKU-028', '床上四件套 纯棉',           399.00, 1, '家居'),
  ('SKU-029', '空气净化器',                899.00, 1, '家居'),
  ('SKU-030', '电动牙刷 声波',             299.00, 1, '家居'),
  ('SKU-031', '泡沫轴 肌肉放松',            89.00, 1, '运动'),
  ('SKU-032', '运动手环 心率监测',          399.00, 1, '运动'),
  ('SKU-033', '篮球 室内外通用',            129.00, 1, '运动'),
  ('SKU-034', '跳绳 钢丝速跳',              59.00, 1, '运动'),
  ('SKU-035', '登山包 45L',                299.00, 1, '运动'),
  ('SKU-036', '连衣裙 碎花',               189.00, 1, '服装'),
  ('SKU-037', '西装外套 商务',              799.00, 1, '服装'),
  ('SKU-038', '休闲裤 直筒',               149.00, 1, '服装'),
  ('SKU-039', '帆布包 大容量',              99.00, 1, '服装'),
  ('SKU-040', '太阳镜 偏光',               249.00, 1, '服装'),
  ('SKU-041', '精华液 烟酰胺',             199.00, 1, '美妆'),
  ('SKU-042', '眼影盘 大地色',             129.00, 1, '美妆'),
  ('SKU-043', '洗发水 控油',                79.00, 1, '美妆'),
  ('SKU-044', '护手霜 玫瑰',                39.00, 1, '美妆'),
  ('SKU-045', '香水 花香调 50ml',           399.00, 0, '美妆'),
  ('SKU-046', '黑巧克力 72% 100g',           49.00, 1, '食品'),
  ('SKU-047', '蜂蜜 土蜂 500g',             129.00, 1, '食品'),
  ('SKU-048', '咖啡豆 云南 250g',            89.00, 1, '食品'),
  ('SKU-049', '零卡气泡水 12罐装',           69.00, 1, '食品'),
  ('SKU-050', '辣条 经典款 200g',            19.00, 0, '食品');

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

INSERT INTO inventories (sku, available_qty, reserved_qty, version) VALUES
  ('SKU-001',1000,0,0),('SKU-002',1000,0,0),('SKU-003',1000,0,0),
  ('SKU-004',1000,0,0),('SKU-005',1000,0,0),('SKU-006',1000,0,0),
  ('SKU-007',1000,0,0),('SKU-008',1000,0,0),('SKU-009',1000,0,0),
  ('SKU-010',1000,0,0),('SKU-011',1000,0,0),('SKU-012',1000,0,0),
  ('SKU-013',1000,0,0),('SKU-014',1000,0,0),('SKU-015',1000,0,0),
  ('SKU-016',1000,0,0),('SKU-017',1000,0,0),('SKU-018',1000,0,0),
  ('SKU-019',1000,0,0),('SKU-020',1000,0,0),('SKU-021',1000,0,0),
  ('SKU-022',1000,0,0),('SKU-023',1000,0,0),('SKU-024',1000,0,0),
  ('SKU-025',1000,0,0),('SKU-026',1000,0,0),('SKU-027',1000,0,0),
  ('SKU-028',1000,0,0),('SKU-029',1000,0,0),('SKU-030',1000,0,0),
  ('SKU-031',1000,0,0),('SKU-032',1000,0,0),('SKU-033',1000,0,0),
  ('SKU-034',1000,0,0),('SKU-035',1000,0,0),('SKU-036',1000,0,0),
  ('SKU-037',1000,0,0),('SKU-038',1000,0,0),('SKU-039',1000,0,0),
  ('SKU-040',1000,0,0),('SKU-041',1000,0,0),('SKU-042',1000,0,0),
  ('SKU-043',1000,0,0),('SKU-044',1000,0,0),('SKU-045',1000,0,0),
  ('SKU-046',1000,0,0),('SKU-047',1000,0,0),('SKU-048',1000,0,0),
  ('SKU-049',1000,0,0),('SKU-050',1000,0,0);

INSERT INTO inventory_baseline_snapshot (sku, baseline_qty, baseline_version) VALUES
  ('SKU-001',1000,1),('SKU-002',1000,1),('SKU-003',1000,1),
  ('SKU-004',1000,1),('SKU-005',1000,1),('SKU-006',1000,1),
  ('SKU-007',1000,1),('SKU-008',1000,1),('SKU-009',1000,1),
  ('SKU-010',1000,1),('SKU-011',1000,1),('SKU-012',1000,1),
  ('SKU-013',1000,1),('SKU-014',1000,1),('SKU-015',1000,1),
  ('SKU-016',1000,1),('SKU-017',1000,1),('SKU-018',1000,1),
  ('SKU-019',1000,1),('SKU-020',1000,1),('SKU-021',1000,1),
  ('SKU-022',1000,1),('SKU-023',1000,1),('SKU-024',1000,1),
  ('SKU-025',1000,1),('SKU-026',1000,1),('SKU-027',1000,1),
  ('SKU-028',1000,1),('SKU-029',1000,1),('SKU-030',1000,1),
  ('SKU-031',1000,1),('SKU-032',1000,1),('SKU-033',1000,1),
  ('SKU-034',1000,1),('SKU-035',1000,1),('SKU-036',1000,1),
  ('SKU-037',1000,1),('SKU-038',1000,1),('SKU-039',1000,1),
  ('SKU-040',1000,1),('SKU-041',1000,1),('SKU-042',1000,1),
  ('SKU-043',1000,1),('SKU-044',1000,1),('SKU-045',1000,1),
  ('SKU-046',1000,1),('SKU-047',1000,1),('SKU-048',1000,1),
  ('SKU-049',1000,1),('SKU-050',1000,1);

-- =============================================================================
-- order-service  (Task 07)
-- =============================================================================

CREATE TABLE IF NOT EXISTS orders (
    id          BIGINT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_no    VARCHAR(32)    NOT NULL,
    user_id     BIGINT         NOT NULL,
    sku         VARCHAR(32)    NOT NULL,
    qty         INT            NOT NULL DEFAULT 1,
    amount      DECIMAL(10,2)  NOT NULL,
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
-- payment-service  (Task 08)
-- =============================================================================

CREATE TABLE IF NOT EXISTS payments (
    id          BIGINT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
    payment_no  VARCHAR(32)    NOT NULL,
    order_no    VARCHAR(32)    NOT NULL,
    user_id     BIGINT         NOT NULL,
    amount      DECIMAL(10,2)  NOT NULL,
    status      VARCHAR(16)    NOT NULL DEFAULT 'PROCESSING'
                COMMENT 'PROCESSING/SUCCESS/FAILED/TIMEOUT',
    result_code VARCHAR(32)    COMMENT 'SUCCESS/INSUFFICIENT_BALANCE/TIMEOUT/ERROR',
    fail_reason VARCHAR(256),
    trace_id    VARCHAR(64),
    created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payment_no (payment_no),
    INDEX idx_order_no (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- traffic-control-plane  (Task 09)
-- =============================================================================

CREATE TABLE IF NOT EXISTS runner_profile (
    id               BIGINT  NOT NULL AUTO_INCREMENT PRIMARY KEY,
    enabled          TINYINT NOT NULL DEFAULT 1,
    base_qps         INT     NOT NULL DEFAULT 5,
    peak_multiplier  FLOAT   NOT NULL DEFAULT 2.0,
    cycle_minutes    INT     NOT NULL DEFAULT 10,
    jitter_pct       FLOAT   NOT NULL DEFAULT 0.1,
    version          INT     NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO runner_profile (enabled, base_qps, peak_multiplier, cycle_minutes, jitter_pct, version)
VALUES (1, 5, 2.0, 10, 0.1, 1);

CREATE TABLE IF NOT EXISTS runner_mix_rule (
    id           BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    action_type  VARCHAR(32) NOT NULL COMMENT 'ORDER_SUCCESS/CANCEL_ORDER',
    ratio        FLOAT       NOT NULL,
    version      INT         NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO runner_mix_rule (action_type, ratio, version) VALUES
  ('ORDER_SUCCESS', 0.90, 1),
  ('CANCEL_ORDER',  0.10, 1);

CREATE TABLE IF NOT EXISTS runner_time_window (
    id          BIGINT  NOT NULL AUTO_INCREMENT PRIMARY KEY,
    start_time  TIME    NOT NULL,
    end_time    TIME    NOT NULL,
    multiplier  FLOAT   NOT NULL DEFAULT 1.0,
    version     INT     NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS runner_inventory_reset_policy (
    id               BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    enabled          TINYINT     NOT NULL DEFAULT 1,
    cron_expr        VARCHAR(64) NOT NULL DEFAULT '0 */30 * * * *',
    timezone         VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    allowed_window   VARCHAR(32) NOT NULL DEFAULT '00:00-06:00',
    reset_scope      VARCHAR(16) NOT NULL DEFAULT 'ALL',
    baseline_version INT         NOT NULL DEFAULT 1,
    version          INT         NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO runner_inventory_reset_policy
  (enabled, cron_expr, timezone, allowed_window, reset_scope, baseline_version, version)
VALUES (1, '0 */30 * * * *', 'Asia/Shanghai', '00:00-06:00', 'ALL', 1, 1);

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

INSERT INTO alert_config_meta (id, version, group_by_json) VALUES (1, 1, '["alertname", "severity", "service"]');

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
-- Chaos infrastructure tables (shared)
-- =============================================================================

CREATE TABLE IF NOT EXISTS chaos_event_log (
    id             BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    chaos_type     VARCHAR(64) NOT NULL,
    target_service VARCHAR(64) NOT NULL,
    action         VARCHAR(32) NOT NULL COMMENT 'INJECT | RESTORE',
    params         JSON,
    duration_sec   INT,
    trace_id       VARCHAR(64),
    triggered_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- chaos_switch: DB-driven feature-flag table for chaos injection.
-- Each service reads this table on startup to restore any active fault configuration.
-- Operators can toggle chaos without restarting services by flipping `enabled` directly
-- via SQL, or through the /internal/chaos/* REST endpoints (chaos profile only).
CREATE TABLE IF NOT EXISTS chaos_switch (
    service_name     VARCHAR(64)   NOT NULL COMMENT '注入目标服务，对应 spring.application.name',
    scenario         VARCHAR(32)   NOT NULL COMMENT 'slow_sql | memory_leak | deadlock',
    enabled          TINYINT(1)    NOT NULL DEFAULT 0,
    mode             VARCHAR(32)            DEFAULT NULL  COMMENT 'sleep | real（慢 SQL 模式）',
    delay_ms         BIGINT                 DEFAULT 1000,
    inject_rate      DOUBLE                 DEFAULT 1.0,
    duration_sec     INT                    DEFAULT 0,
    auto_disable_at  DATETIME               DEFAULT NULL,
    updated_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (service_name, scenario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Chaos 注入开关表 — 按 service+scenario 维度控制，支持 SQL 直接操作';

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
    id              BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT          NOT NULL,
    promotion_id    BIGINT          NOT NULL,
    status          TINYINT         NOT NULL DEFAULT 0 COMMENT '0=未使用 1=已使用',
    expire_at       DATETIME,
    used_at         DATETIME,
    INDEX idx_user_id (user_id),
    INDEX idx_promotion_id (promotion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed promotions
INSERT INTO promotions (type, name, min_amount, discount, reduce_amt, enabled) VALUES
  ('FULL_REDUCTION', '满200减30',   200.00, NULL,  30.00, 1),
  ('FULL_REDUCTION', '满500减80',   500.00, NULL,  80.00, 1),
  ('DISCOUNT',       '九折券',        0.00, 0.90,   NULL, 1),
  ('DISCOUNT',       '八五折VIP券',   0.00, 0.85,   NULL, 1),
  ('COUPON',         '无门槛满减券',   0.00, NULL,  10.00, 1);

-- Assign 2-3 coupons per user (userId 1-20)
INSERT INTO coupons (user_id, promotion_id, status) VALUES
  (1,3,0),(1,1,0),(1,5,0),(2,3,0),(2,2,0),(3,4,0),(3,1,0),(3,5,0),
  (4,3,0),(4,2,0),(5,4,0),(5,1,0),(6,3,0),(6,5,0),(7,3,0),(7,2,0),
  (8,4,0),(8,1,0),(8,5,0),(9,3,0),(9,2,0),(10,4,0),(10,1,0),
  (11,3,0),(11,5,0),(12,3,0),(12,2,0),(13,4,0),(13,1,0),
  (14,3,0),(14,5,0),(15,4,0),(15,2,0),(16,3,0),(16,1,0),
  (17,3,0),(17,5,0),(18,4,0),(18,2,0),(19,3,0),(19,1,0),
  (20,4,0),(20,5,0);

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

INSERT INTO risk_rules (rule_type, threshold, window_sec, enabled, description) VALUES
  ('FREQ_LIMIT',   10,   60, 1, '同用户60秒内最多10单'),
  ('AMOUNT_LIMIT', 5000, NULL, 1, '单笔最高5000元');

-- fulfillment-service (Task 12)
CREATE TABLE IF NOT EXISTS fulfillments (
    id              BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_id        BIGINT       NOT NULL,
    order_no        VARCHAR(32)  NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'CREATED'
                    COMMENT 'CREATED / PICKING / SHIPPED / DELIVERED / CANCELLED',
    tracking_no     VARCHAR(64),
    carrier         VARCHAR(32)  DEFAULT 'MockExpress',
    shipped_at      DATETIME,
    delivered_at    DATETIME,
    cancel_reason   VARCHAR(256),
    trace_id        VARCHAR(64),
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_order_id (order_id),
    INDEX idx_order_no (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- notification-service (Task 13)
CREATE TABLE IF NOT EXISTS notification_logs (
    id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_type    VARCHAR(32)  NOT NULL COMMENT 'ORDER_CREATED / PAYMENT_SUCCESS / PAYMENT_FAILED / SHIPPING',
    user_id       BIGINT       NOT NULL,
    order_no      VARCHAR(32),
    channel       VARCHAR(16)  NOT NULL DEFAULT 'MOCK',
    status        VARCHAR(16)  NOT NULL DEFAULT 'SENT' COMMENT 'SENT / FAILED',
    payload       JSON,
    trace_id      VARCHAR(64),
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_event_type (event_type),
    INDEX idx_order_no (order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =============================================================================
-- 商品价格变更历史
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_price_history (
    id              BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    sku             VARCHAR(32)     NOT NULL,
    previous_price  DECIMAL(10,2)   NOT NULL,
    current_price   DECIMAL(10,2)   NOT NULL,
    change_reason   VARCHAR(64)     NOT NULL COMMENT 'PROMOTION / COST_ADJUST / SEASONAL / MANUAL',
    operator_id     BIGINT          NOT NULL DEFAULT 0,
    effective_at    DATETIME        NOT NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='商品价格变更历史';

-- =============================================================================
-- 用户行为日志
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_behavior_log (
    id              BIGINT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT          NOT NULL,
    action_type     VARCHAR(32)     NOT NULL COMMENT 'PAGE_VIEW / ADD_CART / PLACE_ORDER / SEARCH',
    target_id       VARCHAR(64)     NOT NULL,
    target_type     VARCHAR(32)     NOT NULL COMMENT 'PRODUCT / ORDER / CATEGORY',
    ip_address      VARCHAR(45),
    session_id      VARCHAR(64),
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='用户行为日志';

-- =============================================================================
-- 存储增长演练记录（仅由固定目标业务服务写入）
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
  COMMENT='存储增长演练记录';

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
  order_id       BIGINT       NOT NULL,
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
  order_id       BIGINT       NOT NULL,
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

CREATE TABLE IF NOT EXISTS order_outbox_events (
  id                 BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id           CHAR(36)     NOT NULL,
  event_type         VARCHAR(64)  NOT NULL,
  aggregate_id       VARCHAR(128) NOT NULL,
  aggregate_version  INT          NOT NULL,
  payload            JSON         NOT NULL,
  occurred_at        DATETIME     NOT NULL,
  schema_version     INT          NOT NULL,
  traceparent        VARCHAR(255),
  trace_id           VARCHAR(64),
  traffic_run_id     VARCHAR(64),
  status             VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
  attempts           INT          NOT NULL DEFAULT 0,
  next_attempt_at    DATETIME,
  published_at       DATETIME,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_outbox_event (event_id),
  INDEX idx_order_outbox_delivery (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_inbox_events (
  event_id       CHAR(36)    NOT NULL PRIMARY KEY,
  event_type     VARCHAR(64) NOT NULL,
  received_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at   DATETIME,
  status         VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
  failure_reason VARCHAR(512)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_outbox_events (
  id                 BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id           CHAR(36)     NOT NULL,
  event_type         VARCHAR(64)  NOT NULL,
  aggregate_id       VARCHAR(128) NOT NULL,
  aggregate_version  INT          NOT NULL,
  payload            JSON         NOT NULL,
  occurred_at        DATETIME     NOT NULL,
  schema_version     INT          NOT NULL,
  traceparent        VARCHAR(255),
  trace_id           VARCHAR(64),
  traffic_run_id     VARCHAR(64),
  status             VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
  attempts           INT          NOT NULL DEFAULT 0,
  next_attempt_at    DATETIME,
  published_at       DATETIME,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payment_outbox_event (event_id),
  INDEX idx_payment_outbox_delivery (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_inbox_events (
  event_id       CHAR(36)    NOT NULL PRIMARY KEY,
  event_type     VARCHAR(64) NOT NULL,
  received_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at   DATETIME,
  status         VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
  failure_reason VARCHAR(512)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS risk_outbox_events (
  id                 BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id           CHAR(36)     NOT NULL,
  event_type         VARCHAR(64)  NOT NULL,
  aggregate_id       VARCHAR(128) NOT NULL,
  aggregate_version  INT          NOT NULL,
  payload            JSON         NOT NULL,
  occurred_at        DATETIME     NOT NULL,
  schema_version     INT          NOT NULL,
  traceparent        VARCHAR(255),
  trace_id           VARCHAR(64),
  traffic_run_id     VARCHAR(64),
  status             VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
  attempts           INT          NOT NULL DEFAULT 0,
  next_attempt_at    DATETIME,
  published_at       DATETIME,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_risk_outbox_event (event_id),
  INDEX idx_risk_outbox_delivery (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS risk_inbox_events (
  event_id       CHAR(36)    NOT NULL PRIMARY KEY,
  event_type     VARCHAR(64) NOT NULL,
  received_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at   DATETIME,
  status         VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
  failure_reason VARCHAR(512)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fulfillment_outbox_events (
  id                 BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id           CHAR(36)     NOT NULL,
  event_type         VARCHAR(64)  NOT NULL,
  aggregate_id       VARCHAR(128) NOT NULL,
  aggregate_version  INT          NOT NULL,
  payload            JSON         NOT NULL,
  occurred_at        DATETIME     NOT NULL,
  schema_version     INT          NOT NULL,
  traceparent        VARCHAR(255),
  trace_id           VARCHAR(64),
  traffic_run_id     VARCHAR(64),
  status             VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
  attempts           INT          NOT NULL DEFAULT 0,
  next_attempt_at    DATETIME,
  published_at       DATETIME,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fulfillment_outbox_event (event_id),
  INDEX idx_fulfillment_outbox_delivery (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fulfillment_inbox_events (
  event_id       CHAR(36)    NOT NULL PRIMARY KEY,
  event_type     VARCHAR(64) NOT NULL,
  received_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at   DATETIME,
  status         VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
  failure_reason VARCHAR(512)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notification_outbox_events (
  id                 BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id           CHAR(36)     NOT NULL,
  event_type         VARCHAR(64)  NOT NULL,
  aggregate_id       VARCHAR(128) NOT NULL,
  aggregate_version  INT          NOT NULL,
  payload            JSON         NOT NULL,
  occurred_at        DATETIME     NOT NULL,
  schema_version     INT          NOT NULL,
  traceparent        VARCHAR(255),
  trace_id           VARCHAR(64),
  traffic_run_id     VARCHAR(64),
  status             VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
  attempts           INT          NOT NULL DEFAULT 0,
  next_attempt_at    DATETIME,
  published_at       DATETIME,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notification_outbox_event (event_id),
  INDEX idx_notification_outbox_delivery (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notification_inbox_events (
  event_id       CHAR(36)    NOT NULL PRIMARY KEY,
  event_type     VARCHAR(64) NOT NULL,
  received_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at   DATETIME,
  status         VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
  failure_reason VARCHAR(512)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipments (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id    BIGINT       NOT NULL,
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
  UNIQUE KEY uq_customer_notification_event (customer_id, event_id),
  INDEX idx_customer_notifications (customer_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS traffic_runs (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  traffic_run_id VARCHAR(64)  NOT NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'RUNNING',
  started_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at       DATETIME,
  created_by     BIGINT,
  UNIQUE KEY uq_traffic_run_id (traffic_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS traffic_actions (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  traffic_run_id VARCHAR(64)  NOT NULL,
  action_id      VARCHAR(64)  NOT NULL,
  customer_id    BIGINT,
  action_type    VARCHAR(64)  NOT NULL,
  status         VARCHAR(16)  NOT NULL,
  order_id       BIGINT,
  payment_id     BIGINT,
  cart_version   INT,
  error_code     VARCHAR(64),
  trace_id       VARCHAR(64),
  latency_ms     BIGINT,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_traffic_action_id (action_id),
  INDEX idx_traffic_actions_run (traffic_run_id, created_at)
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
INSERT INTO user_credentials (user_id, password_hash)
SELECT id, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
FROM users
WHERE email IN ('alice@example.com', 'bob@example.com')
ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash);

INSERT INTO user_roles (user_id, role)
SELECT id, 'CUSTOMER'
FROM users
WHERE email IN ('alice@example.com', 'bob@example.com')
ON DUPLICATE KEY UPDATE role = VALUES(role);

INSERT INTO carts (customer_id, version, status)
SELECT id, 0, 'ACTIVE'
FROM users
WHERE email IN ('alice@example.com', 'bob@example.com')
ON DUPLICATE KEY UPDATE version = carts.version;

INSERT INTO notification_preferences (customer_id)
SELECT id
FROM users
WHERE email IN ('alice@example.com', 'bob@example.com')
ON DUPLICATE KEY UPDATE customer_id = VALUES(customer_id);

INSERT INTO traffic_runs (traffic_run_id, status)
VALUES ('seed-run-v1', 'COMPLETED')
ON DUPLICATE KEY UPDATE status = VALUES(status);
