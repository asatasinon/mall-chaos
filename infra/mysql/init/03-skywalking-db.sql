-- Creates the SkyWalking database and grants access to the castrel user.
-- OAP will auto-create its own tables on first startup (SW_STORAGE_MYSQL_INIT_SQL=true by default).
-- NOTE: This script only runs automatically on first MySQL initialization (empty ./data/mysql).
-- For an already-initialized instance, run manually:
--   docker exec castrel-mysql mysql -uroot -proot < infra/mysql/init/03-skywalking-db.sql

CREATE DATABASE IF NOT EXISTS skywalking DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON skywalking.* TO 'castrel'@'%';
FLUSH PRIVILEGES;
