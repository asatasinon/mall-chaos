-- Phase B report optimization release.
-- Apply this migration together with the optimized application version.
-- The baseline release intentionally omits these indexes and date predicates.

ALTER TABLE user_behavior_log
  ADD INDEX idx_behavior_action_target_created
    (action_type, target_type, created_at, target_id);

ALTER TABLE orders
  ADD INDEX idx_orders_user_created_id
    (user_id, created_at, id);

-- Optimized report predicates:
--   ubl.action_type = 'PAGE_VIEW'
--   ubl.target_type = 'PRODUCT'
--   ubl.created_at >= CURRENT_DATE
--   ubl.created_at < CURRENT_DATE + INTERVAL 1 DAY
--   o.user_id = :customerId
--   o.created_at >= CURRENT_DATE
--   o.created_at < CURRENT_DATE + INTERVAL 1 DAY
-- The optimized order report joins order_items once and groups by order.
