import mysql from 'mysql2/promise';
import { env } from './env';

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: env.MYSQL_POOL_CONNECTION_LIMIT,
      queueLimit: 0,
    });
  }
  return pool;
}
