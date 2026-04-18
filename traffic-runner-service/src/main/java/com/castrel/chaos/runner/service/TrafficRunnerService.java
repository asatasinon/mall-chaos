package com.castrel.chaos.runner.service;

import com.castrel.chaos.runner.entity.RunnerInventoryResetPolicy;
import com.castrel.chaos.runner.entity.RunnerMixRule;
import com.castrel.chaos.runner.entity.RunnerProfile;
import com.castrel.chaos.runner.model.RunnerConfig;
import com.castrel.chaos.runner.repository.RunnerInventoryResetPolicyRepository;
import com.castrel.chaos.runner.repository.RunnerMixRuleRepository;
import com.castrel.chaos.runner.repository.RunnerProfileRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

@Service
public class TrafficRunnerService {

    private static final Logger log = LoggerFactory.getLogger(TrafficRunnerService.class);

    // ── Sliding window stats ──────────────────────────────────────────────────
    private final Deque<long[]> recentResults = new ArrayDeque<>(); // [timestampMs, success=1/fail=0]
    private static final int WINDOW_SECONDS = 60;
    private final AtomicLong totalRequests = new AtomicLong(0);

    // ── Config (hot-swappable) ────────────────────────────────────────────────
    private final AtomicReference<RunnerConfig> configRef = new AtomicReference<>();
    private volatile double rateMultiplier = 1.0;
    private volatile boolean paused = false;

    // ── Scheduler ────────────────────────────────────────────────────────────
    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> tickFuture;
    private ScheduledExecutorService resetScheduler;
    private ScheduledFuture<?> resetFuture;

    // ── Repos & clients ──────────────────────────────────────────────────────
    @Autowired
    private RunnerProfileRepository profileRepo;

    @Autowired
    private RunnerMixRuleRepository mixRuleRepo;

    @Autowired
    private RunnerInventoryResetPolicyRepository resetPolicyRepo;

    @Value("${services.order-url:http://localhost:8084}")
    private String orderUrl;

    @Value("${services.inventory-url:http://localhost:8083}")
    private String inventoryUrl;

    private RestClient restClient;

    @Autowired
    private RestClient.Builder restClientBuilder;

    @Autowired
    private MeterRegistry meterRegistry;

    private Counter totalCounter;
    private Counter successCounter;
    private Counter failCounter;

    private static final String[] SKUS = buildSkus();
    private static final int USER_COUNT = 20;

    private static String[] buildSkus() {
        String[] arr = new String[50];
        for (int i = 0; i < 50; i++) arr[i] = String.format("SKU-%03d", i + 1);
        return arr;
    }

    @PostConstruct
    public void init() {
        restClient = restClientBuilder.build();
        totalCounter = Counter.builder("runner.request.total").register(meterRegistry);
        successCounter = Counter.builder("runner.request.success").register(meterRegistry);
        failCounter = Counter.builder("runner.request.fail").register(meterRegistry);

        Gauge.builder("runner.qps", this, s -> s.currentQps()).register(meterRegistry);

        // Load config from DB
        loadConfigFromDb();

        // Start engine
        scheduler = Executors.newScheduledThreadPool(4, r -> {
            Thread t = new Thread(r, "runner-tick");
            t.setDaemon(true);
            return t;
        });
        resetScheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "runner-inventory-reset");
            t.setDaemon(true);
            return t;
        });
        scheduleTicks();
        rescheduleInventoryReset();
    }

    private void loadConfigFromDb() {
        RunnerConfig cfg = new RunnerConfig();
        RunnerProfile profile = profileRepo.findById(1L).orElse(null);
        if (profile != null) {
            cfg.setVersion(profile.getVersion());
            cfg.setBaseQps(profile.getBaseQps());
            cfg.setPeakMultiplier(profile.getPeakMultiplier());
            cfg.setCycleMinutes(profile.getCycleMinutes());
            cfg.setJitterPct(profile.getJitterPct());
        } else {
            cfg.setVersion(1); cfg.setBaseQps(5); cfg.setPeakMultiplier(2.0f);
            cfg.setCycleMinutes(10); cfg.setJitterPct(0.1f);
        }

        List<RunnerMixRule> rules = mixRuleRepo.findAll();
        List<RunnerConfig.MixRule> mixRules = rules.stream().map(r -> {
            RunnerConfig.MixRule mr = new RunnerConfig.MixRule();
            mr.setActionType(r.getActionType());
            mr.setRatio(r.getRatio());
            return mr;
        }).collect(Collectors.toList());
        if (mixRules.isEmpty()) {
            RunnerConfig.MixRule mr = new RunnerConfig.MixRule();
            mr.setActionType("ORDER_SUCCESS"); mr.setRatio(1.0f);
            mixRules = List.of(mr);
        }
        cfg.setMixRules(mixRules);
        configRef.set(cfg);
    }

    private synchronized void scheduleTicks() {
        if (tickFuture != null) tickFuture.cancel(false);
        RunnerConfig cfg = configRef.get();
        double qps = cfg.effectiveQps(System.currentTimeMillis()) * rateMultiplier;
        long delayMs = (long) (1000.0 / Math.max(qps, 0.1));
        tickFuture = scheduler.scheduleAtFixedRate(this::tick, 0, delayMs, TimeUnit.MILLISECONDS);
    }

    private void tick() {
        if (paused) return;
        RunnerConfig cfg = configRef.get();
        String action = cfg.pickAction(Math.random());
        try {
            executAction(action);
        } catch (Exception e) {
            log.debug("Runner tick failed: {}", e.getMessage());
        }
    }

    private void executAction(String action) {
        long userId = (long) (Math.random() * USER_COUNT) + 1;
        String sku = SKUS[(int) (Math.random() * SKUS.length)];
        int qty = (int) (Math.random() * 3) + 1;
        String orderNo = "ORD-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 8);

        totalCounter.increment();
        totalRequests.incrementAndGet();
        long now = System.currentTimeMillis();

        boolean success;
        if ("CANCEL".equals(action)) {
            success = true; // simplified
        } else {
            Map<String, Object> req = new LinkedHashMap<>();
            req.put("orderNo", orderNo);
            req.put("userId", userId);
            req.put("sku", sku);
            req.put("qty", qty);
            try {
                Map<?, ?> resp = restClient.post()
                        .uri(orderUrl + "/internal/orders/create")
                        .body(req)
                        .retrieve()
                        .body(Map.class);
                Object data = resp != null ? resp.get("data") : null;
                if (data instanceof Map<?, ?> orderData) {
                    String status = (String) orderData.get("status");
                    success = "PAID".equals(status);
                } else {
                    success = false;
                }
            } catch (Exception e) {
                success = false;
            }
        }

        synchronized (recentResults) {
            recentResults.addLast(new long[]{now, success ? 1 : 0});
            long cutoff = now - WINDOW_SECONDS * 1000L;
            while (!recentResults.isEmpty() && recentResults.peekFirst()[0] < cutoff) {
                recentResults.pollFirst();
            }
        }
        if (success) successCounter.increment();
        else failCounter.increment();
    }

    public void pause() { paused = true; }
    public void resume() { paused = false; }

    public void setRateMultiplier(double multiplier) {
        this.rateMultiplier = multiplier;
        scheduleTicks(); // reschedule with new interval
    }

    @Transactional
    public Map<String, Object> updateConfig(Map<String, Object> req) {
        int reqVersion = ((Number) req.get("version")).intValue();
        int baseQps = ((Number) req.getOrDefault("baseQps", 5)).intValue();
        float peakMultiplier = ((Number) req.getOrDefault("peakMultiplier", 2.0)).floatValue();
        int cycleMinutes = ((Number) req.getOrDefault("cycleMinutes", 10)).intValue();
        float jitterPct = ((Number) req.getOrDefault("jitterPct", 0.1)).floatValue();

        int updated = profileRepo.updateWithVersion(baseQps, peakMultiplier, cycleMinutes, jitterPct, reqVersion);
        if (updated == 0) {
            throw new com.castrel.chaos.common.BizException("VERSION_CONFLICT", "Config version conflict");
        }

        // Atomic replace in-memory config
        RunnerConfig newCfg = new RunnerConfig();
        newCfg.setVersion(reqVersion + 1);
        newCfg.setBaseQps(baseQps);
        newCfg.setPeakMultiplier(peakMultiplier);
        newCfg.setCycleMinutes(cycleMinutes);
        newCfg.setJitterPct(jitterPct);

        RunnerConfig current = configRef.get();
        newCfg.setMixRules(current.getMixRules()); // keep existing mix rules
        configRef.set(newCfg);
        scheduleTicks();

        return Map.of("newVersion", newCfg.getVersion(), "appliedAt", Instant.now().toString());
    }

    public Map<String, Object> getConfigStatus() {
        RunnerConfig cfg = configRef.get();
        return Map.of("dbVersion", cfg.getVersion(), "memVersion", cfg.getVersion(),
                "baseQps", cfg.getBaseQps(), "peakMultiplier", cfg.getPeakMultiplier());
    }

    @Transactional
    public synchronized Map<String, Object> updateInventoryResetSchedule(Map<String, Object> req) {
        RunnerInventoryResetPolicy policy = resetPolicyRepo.findById(1L).orElseGet(this::defaultResetPolicy);
        int reqVersion = ((Number) req.get("version")).intValue();
        if (!Objects.equals(policy.getVersion(), reqVersion)) {
            throw new com.castrel.chaos.common.BizException("VERSION_CONFLICT", "Reset schedule version conflict");
        }

        if (req.containsKey("cron")) {
            String cron = String.valueOf(req.get("cron")).trim();
            try {
                CronExpression.parse(cron);
            } catch (Exception e) {
                throw new com.castrel.chaos.common.BizException("INVALID_CRON", "Invalid cron expression: " + cron);
            }
        }
        if (req.containsKey("timezone")) {
            String timezone = String.valueOf(req.get("timezone")).trim();
            try {
                ZoneId.of(timezone);
            } catch (Exception e) {
                throw new com.castrel.chaos.common.BizException("INVALID_TIMEZONE", "Invalid timezone: " + timezone);
            }
        }

        policy.setEnabled(((Number) req.getOrDefault("enabled", policy.getEnabled())).intValue());
        policy.setCronExpr((String) req.getOrDefault("cron", policy.getCronExpr()));
        policy.setTimezone((String) req.getOrDefault("timezone", policy.getTimezone()));
        policy.setAllowedWindow((String) req.getOrDefault("allowedWindow", policy.getAllowedWindow()));
        policy.setResetScope((String) req.getOrDefault("resetScope", policy.getResetScope()));
        if (req.containsKey("baselineVersion")) {
            policy.setBaselineVersion(((Number) req.get("baselineVersion")).intValue());
        }
        policy.setVersion(reqVersion + 1);
        resetPolicyRepo.save(policy);

        rescheduleInventoryReset();
        return inventoryResetScheduleStatus(policy);
    }

    public synchronized Map<String, Object> getInventoryResetSchedule() {
        RunnerInventoryResetPolicy policy = resetPolicyRepo.findById(1L).orElseGet(this::defaultResetPolicy);
        return inventoryResetScheduleStatus(policy);
    }

    public Map<String, Object> getStatus() {
        long now = System.currentTimeMillis();
        long[] stats = windowStats(now);
        long windowTotal = stats[0];
        long windowSuccess = stats[1];
        double successRate = windowTotal > 0 ? (double) windowSuccess / windowTotal : 0;
        double qps = windowTotal > 0 ? (double) windowTotal / WINDOW_SECONDS : 0;

        return Map.of(
                "running", !paused,
                "currentQps", qps,
                "successRate", successRate,
                "failRate", 1 - successRate,
                "totalRequests", totalRequests.get(),
                "windowSeconds", WINDOW_SECONDS
        );
    }

    private double currentQps() {
        long[] stats = windowStats(System.currentTimeMillis());
        return stats[0] > 0 ? (double) stats[0] / WINDOW_SECONDS : 0;
    }

    private long[] windowStats(long now) {
        long cutoff = now - WINDOW_SECONDS * 1000L;
        long total = 0, success = 0;
        synchronized (recentResults) {
            for (long[] entry : recentResults) {
                if (entry[0] >= cutoff) { total++; success += entry[1]; }
            }
        }
        return new long[]{total, success};
    }

    public void triggerInventoryReset(boolean skipWindow) {
        try {
            RunnerInventoryResetPolicy policy = resetPolicyRepo.findById(1L).orElse(null);
            int baselineVersion = (policy != null && policy.getBaselineVersion() != null)
                    ? policy.getBaselineVersion() : 1;
            String scope = (policy != null && policy.getResetScope() != null)
                    ? policy.getResetScope() : "ALL";

            // Get plan first
            restClient.post().uri(inventoryUrl + "/internal/inventory/reset/plan")
                    .retrieve().body(Map.class);

            // Execute reset
            Map<String, Object> resetReq = Map.of("expectedVersion", baselineVersion, "scope", scope);
            Map<?, ?> result = restClient.post().uri(inventoryUrl + "/internal/inventory/reset")
                    .body(resetReq).retrieve().body(Map.class);
            log.info("Inventory reset executed: {}", result);
        } catch (Exception e) {
            log.error("Inventory reset failed: {}", e.getMessage());
        }
    }

    private synchronized void rescheduleInventoryReset() {
        if (resetFuture != null) resetFuture.cancel(false);

        RunnerInventoryResetPolicy policy = resetPolicyRepo.findById(1L).orElseGet(this::defaultResetPolicy);
        if (!isResetEnabled(policy)) {
            log.info("Inventory reset schedule disabled");
            return;
        }

        String cronExpr = safeCron(policy.getCronExpr());
        ZoneId zone = safeZone(policy.getTimezone());
        CronExpression cron = CronExpression.parse(cronExpr);
        ZonedDateTime now = ZonedDateTime.now(zone);
        ZonedDateTime next = cron.next(now);
        if (next == null) {
            log.warn("No next run time computed for reset cron={}", cronExpr);
            return;
        }

        long delayMs = Math.max(0, Duration.between(Instant.now(), next.toInstant()).toMillis());
        resetFuture = resetScheduler.schedule(this::runScheduledInventoryReset, delayMs, TimeUnit.MILLISECONDS);
        log.info("Inventory reset schedule refreshed: cron={}, timezone={}, nextRunAt={}",
                cronExpr, zone, next.toInstant());
    }

    private void runScheduledInventoryReset() {
        try {
            RunnerInventoryResetPolicy policy = resetPolicyRepo.findById(1L).orElseGet(this::defaultResetPolicy);
            if (isResetEnabled(policy) && isWithinAllowedWindow(policy)) {
                triggerInventoryReset(false);
            } else {
                log.debug("Inventory reset skipped by policy window/enabled check");
            }
        } catch (Exception e) {
            log.error("Scheduled inventory reset execution failed: {}", e.getMessage(), e);
        } finally {
            rescheduleInventoryReset();
        }
    }

    private boolean isResetEnabled(RunnerInventoryResetPolicy policy) {
        return policy != null && Objects.equals(policy.getEnabled(), 1);
    }

    private boolean isWithinAllowedWindow(RunnerInventoryResetPolicy policy) {
        String window = policy.getAllowedWindow();
        if (window == null || !window.contains("-")) return true;

        try {
            String[] parts = window.split("-", 2);
            LocalTime start = LocalTime.parse(parts[0].trim());
            LocalTime end = LocalTime.parse(parts[1].trim());
            LocalTime now = LocalTime.now(safeZone(policy.getTimezone()));

            if (start.equals(end)) return true;
            if (start.isBefore(end)) {
                return !now.isBefore(start) && !now.isAfter(end);
            }
            // Cross-midnight window (e.g., 23:00-06:00)
            return !now.isBefore(start) || !now.isAfter(end);
        } catch (Exception e) {
            log.warn("Invalid allowedWindow '{}', skip window guard", window);
            return true;
        }
    }

    private String safeCron(String cronExpr) {
        String expr = (cronExpr == null || cronExpr.isBlank()) ? "0 */30 * * * *" : cronExpr.trim();
        try {
            CronExpression.parse(expr); // validate
            return expr;
        } catch (Exception e) {
            String fallback = "0 */30 * * * *";
            log.warn("Invalid reset cron '{}', fallback to '{}'", expr, fallback);
            return fallback;
        }
    }

    private ZoneId safeZone(String timezone) {
        try {
            return ZoneId.of((timezone == null || timezone.isBlank()) ? "Asia/Shanghai" : timezone.trim());
        } catch (Exception e) {
            return ZoneId.of("Asia/Shanghai");
        }
    }

    private Map<String, Object> inventoryResetScheduleStatus(RunnerInventoryResetPolicy policy) {
        String cronExpr = safeCron(policy.getCronExpr());
        ZoneId zone = safeZone(policy.getTimezone());
        ZonedDateTime next = null;
        if (isResetEnabled(policy)) {
            next = CronExpression.parse(cronExpr).next(ZonedDateTime.now(zone));
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("enabled", policy.getEnabled());
        data.put("cron", cronExpr);
        data.put("timezone", zone.toString());
        data.put("allowedWindow", policy.getAllowedWindow());
        data.put("resetScope", policy.getResetScope());
        data.put("baselineVersion", policy.getBaselineVersion());
        data.put("version", policy.getVersion());
        data.put("nextRunAt", next != null ? next.toInstant().toString() : null);
        data.put("appliedAt", Instant.now().toString());
        return data;
    }

    private RunnerInventoryResetPolicy defaultResetPolicy() {
        RunnerInventoryResetPolicy policy = new RunnerInventoryResetPolicy();
        policy.setId(1L);
        policy.setEnabled(1);
        policy.setCronExpr("0 */30 * * * *");
        policy.setTimezone("Asia/Shanghai");
        policy.setAllowedWindow("00:00-06:00");
        policy.setResetScope("ALL");
        policy.setBaselineVersion(1);
        policy.setVersion(1);
        return policy;
    }

    @PreDestroy
    public void shutdown() {
        if (scheduler != null) scheduler.shutdownNow();
        if (resetScheduler != null) resetScheduler.shutdownNow();
    }
}
