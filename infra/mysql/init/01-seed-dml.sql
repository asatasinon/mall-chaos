-- Castrel Chaos Platform - Version 1 seed data DML
-- This file runs after 00-schema-ddl.sql during MySQL first initialization.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO schema_version (id, version)
VALUES (1, 1)
ON DUPLICATE KEY UPDATE version = VALUES(version);
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
  (1,  1, 'Guangdong Province', 'Shenzhen', 'Nanshan District', 'Keji Yuan South Road 1', 'Alice',  '13800000001'),
  (2,  1, 'Beijing Municipality', 'Beijing', 'Chaoyang District', 'Wangjing SOHO T1',  'Bob',    '13800000002'),
  (3,  1, 'Shanghai Municipality', 'Shanghai', 'Pudong New Area', 'Lujiazui Ring Road 1000', 'Carol', '13800000003'),
  (4,  1, 'Zhejiang Province', 'Hangzhou', 'Xihu District', 'Wensan Road 477',  'David',  '13800000004'),
  (5,  1, 'Guangdong Province', 'Guangzhou', 'Tianhe District', 'Tiyu West Road 121','Eve',    '13800000005'),
  (6,  1, 'Sichuan Province', 'Chengdu', 'Wuhou District', 'Tianfu Avenue 1700','Frank', '13800000006'),
  (7,  1, 'Hubei Province', 'Wuhan', 'Hongshan District', 'Luoyu Road 1037', 'Grace',  '13800000007'),
  (8,  1, 'Shaanxi Province', 'Xi''an', 'High-tech Zone', 'Keji Road 6',    'Hank',   '13800000008'),
  (9,  1, 'Jiangsu Province', 'Nanjing', 'Gulou District', 'Hanzhong Road 1',    'Ivy',    '13800000009'),
  (10, 1, 'Chongqing Municipality', 'Chongqing', 'Yubei District', 'Hongjin Avenue 3',  'Jack',   '13800000010'),
  (11, 1, 'Guangdong Province', 'Shenzhen', 'Futian District', 'Shennan Middle Road 1006','Karen', '13800000011'),
  (12, 1, 'Beijing Municipality', 'Beijing', 'Haidian District', 'Zhongguancun Avenue 1','Leo',    '13800000012'),
  (13, 1, 'Shanghai Municipality', 'Shanghai', 'Huangpu District', 'Nanjing East Road 1',  'Mona',   '13800000013'),
  (14, 1, 'Zhejiang Province', 'Ningbo', 'Yinzhou District', 'Xueshi Road 655',  'Nick',   '13800000014'),
  (15, 1, 'Guangdong Province', 'Dongguan', 'Nancheng District', 'Hongfu Road 1',    'Olivia', '13800000015'),
  (16, 1, 'Fujian Province', 'Xiamen', 'Siming District', 'Hubin South Road 388','Peter',  '13800000016'),
  (17, 1, 'Hunan Province', 'Changsha', 'Yuelu District', 'Lugu Avenue 688','Quinn',  '13800000017'),
  (18, 1, 'Tianjin Municipality', 'Tianjin', 'Binhai New Area', 'Binhai Science Park 1','Rachel','13800000018'),
  (19, 1, 'Liaoning Province', 'Shenyang', 'Shenhe District', 'Zhongjie Road 168',  'Sam',   '13800000019'),
  (20, 1, 'Shandong Province', 'Qingdao', 'Shinan District', 'Hong Kong Middle Road 1',  'Tina',   '13800000020');
INSERT INTO products (sku, name, price, status, category) VALUES
  ('SKU-001', 'Wireless Bluetooth Earbuds Pro',        299.00, 1, 'Electronics'),
  ('SKU-002', 'Portable Power Bank 20000mAh', 149.00, 1, 'Electronics'),
  ('SKU-003', 'Mechanical Keyboard Cherry MX',       699.00, 1, 'Electronics'),
  ('SKU-004', '4K Monitor 27-inch',          1899.00, 1, 'Electronics'),
  ('SKU-005', 'Ergonomic Chair',              2499.00, 1, 'Home'),
  ('SKU-006', 'Floor Lamp LED',             129.00, 1, 'Home'),
  ('SKU-007', 'Stainless Steel Thermal Mug 500ml',        89.00, 1, 'Home'),
  ('SKU-008', 'Non-slip PVC Yoga Mat',           79.00, 1, 'Sports'),
  ('SKU-009', 'Dumbbell Pair 10kg',             119.00, 1, 'Sports'),
  ('SKU-010', 'Breathable Running Shoes',              389.00, 1, 'Sports'),
  ('SKU-011', 'Solid Cotton T-shirt',              59.00, 1, 'Clothing'),
  ('SKU-012', 'Slim-fit Jeans',              199.00, 1, 'Clothing'),
  ('SKU-013', 'Lightweight Down Jacket',              499.00, 1, 'Clothing'),
  ('SKU-014', 'Sunscreen SPF50',              89.00, 1, 'Beauty'),
  ('SKU-015', 'Matte Lipstick',                149.00, 1, 'Beauty'),
  ('SKU-016', 'Amino Acid Facial Cleanser',             79.00, 1, 'Beauty'),
  ('SKU-017', 'Pre-rain Dragon Well Green Tea 100g',        299.00, 1, 'Food'),
  ('SKU-018', 'Mixed Nut Gift Box',           129.00, 1, 'Food'),
  ('SKU-019', 'Organic Oatmeal 1kg',             49.00, 1, 'Food'),
  ('SKU-020', 'Extra Virgin Olive Oil 500ml',      89.00, 1, 'Food'),
  ('SKU-021', 'Silent Wireless Mouse',             129.00, 1, 'Electronics'),
  ('SKU-022', 'USB-C 7-in-1 Hub',         199.00, 1, 'Electronics'),
  ('SKU-023', '1080P Webcam',          249.00, 1, 'Electronics'),
  ('SKU-024', 'Aluminum Tablet Stand',            99.00, 1, 'Electronics'),
  ('SKU-025', 'Shockproof Silicone Phone Case',            29.00, 1, 'Electronics'),
  ('SKU-026', 'Desktop Organizer Box',            49.00, 1, 'Home'),
  ('SKU-027', 'Lavender Scented Candle',            79.00, 1, 'Home'),
  ('SKU-028', 'Pure Cotton Bedding Set',           399.00, 1, 'Home'),
  ('SKU-029', 'Air Purifier',                899.00, 1, 'Home'),
  ('SKU-030', 'Sonic Electric Toothbrush',             299.00, 1, 'Home'),
  ('SKU-031', 'Foam Roller for Muscle Relief',            89.00, 1, 'Sports'),
  ('SKU-032', 'Heart Rate Fitness Band',          399.00, 1, 'Sports'),
  ('SKU-033', 'Indoor and Outdoor Basketball',            129.00, 1, 'Sports'),
  ('SKU-034', 'Steel Speed Jump Rope',              59.00, 1, 'Sports'),
  ('SKU-035', 'Hiking Backpack 45L',                299.00, 1, 'Sports'),
  ('SKU-036', 'Floral Dress',               189.00, 1, 'Clothing'),
  ('SKU-037', 'Business Suit Jacket',              799.00, 1, 'Clothing'),
  ('SKU-038', 'Straight-leg Casual Pants',               149.00, 1, 'Clothing'),
  ('SKU-039', 'Large Canvas Tote Bag',              99.00, 1, 'Clothing'),
  ('SKU-040', 'Polarized Sunglasses',               249.00, 1, 'Clothing'),
  ('SKU-041', 'Niacinamide Serum',             199.00, 1, 'Beauty'),
  ('SKU-042', 'Earth-tone Eyeshadow Palette',             129.00, 1, 'Beauty'),
  ('SKU-043', 'Oil-control Shampoo',                79.00, 1, 'Beauty'),
  ('SKU-044', 'Rose Hand Cream',                39.00, 1, 'Beauty'),
  ('SKU-045', 'Floral Fragrance 50ml',           399.00, 0, 'Beauty'),
  ('SKU-046', 'Dark Chocolate 72% 100g',           49.00, 1, 'Food'),
  ('SKU-047', 'Wildflower Honey 500g',             129.00, 1, 'Food'),
  ('SKU-048', 'Yunnan Coffee Beans 250g',            89.00, 1, 'Food'),
  ('SKU-049', 'Zero-calorie Sparkling Water 12-pack',           69.00, 1, 'Food'),
  ('SKU-050', 'Classic Spicy Snack 200g',            19.00, 0, 'Food');
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
INSERT INTO runner_profile
  (enabled, traffic_mode, lifecycle_interval_sec, max_items, max_item_quantity,
   successful_payment_ratio, coupon_usage_ratio, background_actions_enabled, version)
VALUES (1, 'CUSTOMER_LIFECYCLE', 60, 3, 3, 1.0000, 0.0000, 0, 1);
INSERT INTO runner_customer_whitelist (customer_id, enabled, version) VALUES
  (1, 1, 1),
  (2, 1, 1),
  (3, 1, 1),
  (4, 1, 1),
  (5, 1, 1),
  (6, 1, 1),
  (7, 1, 1),
  (8, 1, 1),
  (9, 1, 1),
  (10, 1, 1)
ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), version = VALUES(version);
INSERT INTO alert_config_meta (id, version, group_by_json) VALUES (1, 1, '["alertname", "severity", "service"]');

INSERT INTO promotions (type, name, min_amount, discount, reduce_amt, enabled) VALUES
  ('FULL_REDUCTION', '30 off orders over 200',   200.00, NULL,  30.00, 1),
  ('FULL_REDUCTION', '80 off orders over 500',   500.00, NULL,  80.00, 1),
  ('DISCOUNT',       '10% Off Coupon',        0.00, 0.90,   NULL, 1),
  ('DISCOUNT',       '15% Off VIP Coupon',   0.00, 0.85,   NULL, 1),
  ('COUPON',         '10 Off No-minimum Coupon',   0.00, NULL,  10.00, 1);
INSERT INTO coupons (user_id, promotion_id, status) VALUES
  (1,3,0),(1,1,0),(1,5,0),(2,3,0),(2,2,0),(3,4,0),(3,1,0),(3,5,0),
  (4,3,0),(4,2,0),(5,4,0),(5,1,0),(6,3,0),(6,5,0),(7,3,0),(7,2,0),
  (8,4,0),(8,1,0),(8,5,0),(9,3,0),(9,2,0),(10,4,0),(10,1,0),
  (11,3,0),(11,5,0),(12,3,0),(12,2,0),(13,4,0),(13,1,0),
  (14,3,0),(14,5,0),(15,4,0),(15,2,0),(16,3,0),(16,1,0),
  (17,3,0),(17,5,0),(18,4,0),(18,2,0),(19,3,0),(19,1,0),
  (20,4,0),(20,5,0);
INSERT INTO risk_rules (rule_type, threshold, window_sec, enabled, description) VALUES
  ('FREQ_LIMIT',   10,   60, 1, 'Maximum 10 orders per user within 60 seconds'),
  ('AMOUNT_LIMIT', 5000, NULL, 1, 'Maximum 5000 per order');
INSERT INTO user_credentials (user_id, password_hash)
SELECT id, '$2a$10$Sz3FK6PF9Hyq0oKXECV3JetuZODGMUMUznUhJMzPYaPJD9z5lsgiq'
FROM users
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
INSERT INTO user_roles (user_id, role)
SELECT id, 'OPERATOR'
FROM users
WHERE email = 'carol@example.com'
ON DUPLICATE KEY UPDATE role = VALUES(role);
INSERT INTO traffic_runs (traffic_run_id, status)
VALUES ('seed-run-v1', 'COMPLETED')
ON DUPLICATE KEY UPDATE status = VALUES(status);
