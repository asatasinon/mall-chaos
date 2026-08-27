-- Create the initial 180-day +08:00 partition window on a fresh database.
-- The application worker performs the daily add/drop rollover after this.

DELIMITER //
CREATE PROCEDURE initialize_warmup_partitions()
BEGIN
  DECLARE partition_count INT DEFAULT 0;
  DECLARE index_value INT DEFAULT 0;
  DECLARE partition_date DATE;
  DECLARE partition_sql LONGTEXT DEFAULT '';

  SELECT COUNT(*) INTO partition_count
    FROM information_schema.partitions
   WHERE table_schema = DATABASE()
     AND table_name = 'product_price_history'
     AND partition_name IS NOT NULL;
  IF partition_count = 0 THEN
    SET index_value = 0;
    WHILE index_value < 180 DO
      SET partition_date = DATE_SUB(CURRENT_DATE, INTERVAL (179 - index_value) DAY);
      SET partition_sql = CONCAT(
        partition_sql,
        IF(index_value = 0, '', ', '),
        'PARTITION p', DATE_FORMAT(partition_date, '%Y%m%d'),
        ' VALUES LESS THAN (''', DATE_FORMAT(DATE_ADD(partition_date, INTERVAL 1 DAY), '%Y-%m-%d'), ''')');
      SET index_value = index_value + 1;
    END WHILE;
    SET @warmup_partition_sql = CONCAT(
      'ALTER TABLE product_price_history PARTITION BY RANGE COLUMNS (effective_at) (',
      partition_sql, ')');
    PREPARE warmup_partition_statement FROM @warmup_partition_sql;
    EXECUTE warmup_partition_statement;
    DEALLOCATE PREPARE warmup_partition_statement;
  END IF;

  SET partition_count = 0;
  SELECT COUNT(*) INTO partition_count
    FROM information_schema.partitions
   WHERE table_schema = DATABASE()
     AND table_name = 'user_behavior_log'
     AND partition_name IS NOT NULL;
  IF partition_count = 0 THEN
    SET index_value = 0;
    SET partition_sql = '';
    WHILE index_value < 180 DO
      SET partition_date = DATE_SUB(CURRENT_DATE, INTERVAL (179 - index_value) DAY);
      SET partition_sql = CONCAT(
        partition_sql,
        IF(index_value = 0, '', ', '),
        'PARTITION p', DATE_FORMAT(partition_date, '%Y%m%d'),
        ' VALUES LESS THAN (''', DATE_FORMAT(DATE_ADD(partition_date, INTERVAL 1 DAY), '%Y-%m-%d'), ''')');
      SET index_value = index_value + 1;
    END WHILE;
    SET @warmup_partition_sql = CONCAT(
      'ALTER TABLE user_behavior_log PARTITION BY RANGE COLUMNS (created_at) (',
      partition_sql, ')');
    PREPARE warmup_partition_statement FROM @warmup_partition_sql;
    EXECUTE warmup_partition_statement;
    DEALLOCATE PREPARE warmup_partition_statement;
  END IF;
END//
DELIMITER ;

CALL initialize_warmup_partitions();
DROP PROCEDURE initialize_warmup_partitions;

CREATE TABLE IF NOT EXISTS data_warmup_progress (
  table_name VARCHAR(64) NOT NULL PRIMARY KEY,
  status VARCHAR(32) NOT NULL,
  target_rows BIGINT NOT NULL,
  actual_rows BIGINT NOT NULL DEFAULT 0,
  current_date_value DATE NOT NULL,
  day_target_rows BIGINT NOT NULL,
  day_completed_rows BIGINT NOT NULL DEFAULT 0,
  rows_per_sec BIGINT NOT NULL DEFAULT 0,
  current_date_rows BIGINT NOT NULL DEFAULT 0,
  earliest_time DATETIME NULL,
  latest_time DATETIME NULL,
  table_bytes BIGINT NOT NULL DEFAULT 0,
  expired_partitions_dropped INT NOT NULL DEFAULT 0,
  lease_owner VARCHAR(64) NULL,
  guard_reason VARCHAR(255) NULL,
  last_success_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;