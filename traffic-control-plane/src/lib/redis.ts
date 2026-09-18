import Redis from 'ioredis';
import { env } from './env';

let redis: Redis | null = null;
let closingRedis: Promise<void> | null = null;

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

export async function closeRedis(): Promise<void> {
  if (closingRedis) return closingRedis;
  const currentRedis = redis;
  if (!currentRedis) return;

  if (currentRedis.status === 'wait' || currentRedis.status === 'end') {
    currentRedis.disconnect();
    if (redis === currentRedis) redis = null;
    return;
  }

  const close = currentRedis.quit().then(() => undefined).finally(() => {
    if (redis === currentRedis) redis = null;
    closingRedis = null;
  });
  closingRedis = close;
  return close;
}
