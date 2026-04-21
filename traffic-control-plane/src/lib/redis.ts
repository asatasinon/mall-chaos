import Redis from 'ioredis';
import { env } from './env';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
  }
  return redis;
}
