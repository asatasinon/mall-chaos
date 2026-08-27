package com.castrel.chaos.common.coordination;

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@Service
public class ScenarioRunGuard {

    private static final String KEY_PREFIX = "castrel:scenario-run:fence:";
    private static final DefaultRedisScript<Long> ACCEPT_SCRIPT = new DefaultRedisScript<>(
            "local current = redis.call('GET', KEYS[1]) "
                    + "if current == false or tonumber(ARGV[1]) >= tonumber(current) then "
                    + "redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1 end return 0",
            Long.class);
    private static final DefaultRedisScript<Long> RELEASE_SCRIPT = new DefaultRedisScript<>(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
            Long.class);

    private final StringRedisTemplate redisTemplate;
    private final String serviceName;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "scenario-run-expiry");
        thread.setDaemon(true);
        return thread;
    });
    private final Map<String, CleanupRegistration> cleanups = new ConcurrentHashMap<>();

    public ScenarioRunGuard(
            StringRedisTemplate redisTemplate,
            @Value("${spring.application.name:unknown}") String serviceName) {
        this.redisTemplate = redisTemplate;
        this.serviceName = serviceName;
    }

    public boolean acceptStart(ScenarioRunContext context) {
        context.validate(Instant.now());
        long ttlMillis = Math.max(1, Duration.between(Instant.now(), context.expiresAt()).toMillis());
        Long accepted = redisTemplate.execute(
                ACCEPT_SCRIPT,
                List.of(key()),
                String.valueOf(context.fencingToken()),
                String.valueOf(ttlMillis));
        return Long.valueOf(1L).equals(accepted);
    }

    public void registerCleanup(ScenarioRunContext context, Runnable cleanup) {
        context.validate(Instant.now());
        CleanupRegistration registration = new CleanupRegistration(cleanup, null);
        CleanupRegistration previous = cleanups.put(context.runId(), registration);
        if (previous != null) previous.cancel();
        long delayMillis = Math.max(1, Duration.between(Instant.now(), context.expiresAt()).toMillis());
        ScheduledFuture<?> future = scheduler.schedule(
                () -> release(context, registration), delayMillis, TimeUnit.MILLISECONDS);
        registration.future = future;
    }

    public boolean release(ScenarioRunContext context) {
        return release(context, cleanups.remove(context.runId()));
    }

    public boolean isAccepted(ScenarioRunContext context) {
        try {
            String value = redisTemplate.opsForValue().get(key());
            return value != null && value.equals(String.valueOf(context.fencingToken()));
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    public String serviceName() {
        return serviceName;
    }

    @PreDestroy
    public void shutdown() {
        scheduler.shutdownNow();
        cleanups.clear();
    }

    private boolean release(ScenarioRunContext context, CleanupRegistration registration) {
        if (registration == null || !registration.claim()) return true;
        redisTemplate.execute(RELEASE_SCRIPT, List.of(key()), String.valueOf(context.fencingToken()));
        try {
            registration.cleanup.run();
        } finally {
            cleanups.remove(context.runId(), registration);
        }
        return true;
    }

    private String key() {
        return KEY_PREFIX + serviceName;
    }

    private static final class CleanupRegistration {
        private final Runnable cleanup;
        private volatile ScheduledFuture<?> future;
        private boolean claimed;

        private CleanupRegistration(Runnable cleanup, ScheduledFuture<?> future) {
            this.cleanup = cleanup;
            this.future = future;
        }

        private synchronized boolean claim() {
            if (claimed) return false;
            claimed = true;
            if (future != null) future.cancel(false);
            return true;
        }

        private void cancel() {
            if (future != null) future.cancel(false);
        }
    }
}
