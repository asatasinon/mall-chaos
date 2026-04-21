-- =============================================================================
-- mysqld-exporter grants for the castrel user
-- Required by prometheus/mysqld_exporter performance_schema scrapers
-- =============================================================================

-- PROCESS: needed for SHOW PROCESSLIST scraper
-- REPLICATION CLIENT: needed for slave_status scraper
-- SELECT on performance_schema: needed for all perf_schema.* scrapers
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'castrel'@'%';
GRANT SELECT ON performance_schema.* TO 'castrel'@'%';

FLUSH PRIVILEGES;
