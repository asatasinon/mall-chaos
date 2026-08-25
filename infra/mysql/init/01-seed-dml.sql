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
  (2, 1, 1)
ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), version = VALUES(version);
INSERT INTO alert_config_meta (id, version, group_by_json) VALUES (1, 1, '["alertname", "severity", "service"]');

INSERT INTO promotions (type, name, min_amount, discount, reduce_amt, enabled) VALUES
  ('FULL_REDUCTION', '满200减30',   200.00, NULL,  30.00, 1),
  ('FULL_REDUCTION', '满500减80',   500.00, NULL,  80.00, 1),
  ('DISCOUNT',       '九折券',        0.00, 0.90,   NULL, 1),
  ('DISCOUNT',       '八五折VIP券',   0.00, 0.85,   NULL, 1),
  ('COUPON',         '无门槛满减券',   0.00, NULL,  10.00, 1);
INSERT INTO coupons (user_id, promotion_id, status) VALUES
  (1,3,0),(1,1,0),(1,5,0),(2,3,0),(2,2,0),(3,4,0),(3,1,0),(3,5,0),
  (4,3,0),(4,2,0),(5,4,0),(5,1,0),(6,3,0),(6,5,0),(7,3,0),(7,2,0),
  (8,4,0),(8,1,0),(8,5,0),(9,3,0),(9,2,0),(10,4,0),(10,1,0),
  (11,3,0),(11,5,0),(12,3,0),(12,2,0),(13,4,0),(13,1,0),
  (14,3,0),(14,5,0),(15,4,0),(15,2,0),(16,3,0),(16,1,0),
  (17,3,0),(17,5,0),(18,4,0),(18,2,0),(19,3,0),(19,1,0),
  (20,4,0),(20,5,0);
INSERT INTO risk_rules (rule_type, threshold, window_sec, enabled, description) VALUES
  ('FREQ_LIMIT',   10,   60, 1, '同用户60秒内最多10单'),
  ('AMOUNT_LIMIT', 5000, NULL, 1, '单笔最高5000元');
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
INSERT INTO user_roles (user_id, role)
SELECT id, 'OPERATOR'
FROM users
WHERE email = 'carol@example.com'
ON DUPLICATE KEY UPDATE role = VALUES(role);
INSERT INTO traffic_runs (traffic_run_id, status)
VALUES ('seed-run-v1', 'COMPLETED')
ON DUPLICATE KEY UPDATE status = VALUES(status);
