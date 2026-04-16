package com.castrel.chaos.common;

import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.util.UUID;

public class DistributedLockService {

    private final StringRedisTemplate redis;

    public DistributedLockService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** Try to acquire lock; returns token on success, null on failure. */
    public String tryLock(String key, Duration ttl) {
        String token = UUID.randomUUID().toString();
        Boolean acquired = redis.opsForValue().setIfAbsent(key, token, ttl);
        return Boolean.TRUE.equals(acquired) ? token : null;
    }

    /** Release lock only if token matches (prevents releasing another owner's lock). */
    public void release(String key, String token) {
        String current = redis.opsForValue().get(key);
        if (token != null && token.equals(current)) {
            redis.delete(key);
        }
    }
}
