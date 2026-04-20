package com.castrel.chaos.runner.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Background service that fills {@code product_price_history} and
 * {@code user_behavior_log} tables with realistic data on startup.
 * Each table is filled to at least 30 million rows. Progress is tracked
 * and queryable via {@link #getProgress()}.
 */
@Service
public class DataWarmupService {

    private static final Logger log = LoggerFactory.getLogger(DataWarmupService.class);

    private static final int TARGET_ROWS = 30_000_000;
    private static final int BATCH_SIZE = 5_000;
    private static final long LOG_INTERVAL = 100_000;
    private static final int SLEEP_BETWEEN_BATCHES_MS = 10;

    private static final String[] SKUS = new String[50];
    private static final BigDecimal[] BASE_PRICES = new BigDecimal[50];
    private static final String[] CHANGE_REASONS = {"PROMOTION", "COST_ADJUST", "SEASONAL", "MANUAL"};
    private static final double[] REASON_WEIGHTS = {0.40, 0.25, 0.25, 0.10};
    private static final String[] ACTION_TYPES = {"PAGE_VIEW", "ADD_CART", "PLACE_ORDER", "SEARCH"};
    private static final double[] ACTION_WEIGHTS = {0.60, 0.20, 0.15, 0.05};
    private static final String[] TARGET_TYPES = {"PRODUCT", "PRODUCT", "ORDER", "CATEGORY"};

    static {
        BigDecimal[] prices = {
                bd(299), bd(149), bd(699), bd(1899), bd(2499), bd(129), bd(89), bd(79), bd(119), bd(389),
                bd(59), bd(199), bd(499), bd(89), bd(149), bd(79), bd(299), bd(129), bd(49), bd(89),
                bd(129), bd(199), bd(249), bd(99), bd(29), bd(49), bd(79), bd(399), bd(899), bd(299),
                bd(89), bd(399), bd(129), bd(59), bd(299), bd(189), bd(799), bd(149), bd(99), bd(249),
                bd(199), bd(129), bd(79), bd(39), bd(399), bd(49), bd(129), bd(89), bd(69), bd(19)
        };
        for (int i = 0; i < 50; i++) {
            SKUS[i] = String.format("SKU-%03d", i + 1);
            BASE_PRICES[i] = prices[i];
        }
    }

    private final JdbcTemplate jdbcTemplate;
    private volatile WarmupProgress progress = new WarmupProgress(0, TARGET_ROWS, 0, TARGET_ROWS, false, "STARTING");

    public DataWarmupService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @PostConstruct
    public void init() {
        Thread warmup = new Thread(this::fillTables, "data-warmup");
        warmup.setDaemon(true);
        warmup.start();
    }

    public WarmupProgress getProgress() {
        return progress;
    }

    // ── fill logic ───────────────────────────────────────────────────────────

    private void fillTables() {
        try {
            long priceCount = countTable("product_price_history");
            long behaviorCount = countTable("user_behavior_log");

            // Fill product_price_history
            progress = new WarmupProgress(priceCount, TARGET_ROWS, behaviorCount, TARGET_ROWS,
                    false, "FILLING_PRICE_HISTORY");
            while (priceCount < TARGET_ROWS) {
                insertPriceHistoryBatch();
                priceCount += BATCH_SIZE;
                if (priceCount % LOG_INTERVAL < BATCH_SIZE) {
                    log.info("[data-warmup] product_price_history: {:,} / {:,} ({:.1f}%)",
                            priceCount, TARGET_ROWS, pct(priceCount));
                }
                progress = new WarmupProgress(priceCount, TARGET_ROWS, behaviorCount, TARGET_ROWS,
                        false, "FILLING_PRICE_HISTORY");
                Thread.sleep(SLEEP_BETWEEN_BATCHES_MS);
            }

            // Fill user_behavior_log
            progress = new WarmupProgress(priceCount, TARGET_ROWS, behaviorCount, TARGET_ROWS,
                    false, "FILLING_BEHAVIOR_LOG");
            while (behaviorCount < TARGET_ROWS) {
                insertBehaviorLogBatch();
                behaviorCount += BATCH_SIZE;
                if (behaviorCount % LOG_INTERVAL < BATCH_SIZE) {
                    log.info("[data-warmup] user_behavior_log: {:,} / {:,} ({:.1f}%)",
                            behaviorCount, TARGET_ROWS, pct(behaviorCount));
                }
                progress = new WarmupProgress(priceCount, TARGET_ROWS, behaviorCount, TARGET_ROWS,
                        false, "FILLING_BEHAVIOR_LOG");
                Thread.sleep(SLEEP_BETWEEN_BATCHES_MS);
            }

            progress = new WarmupProgress(priceCount, TARGET_ROWS, behaviorCount, TARGET_ROWS,
                    true, "COMPLETED");
            log.info("[data-warmup] Completed: both tables >= {} rows", TARGET_ROWS);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("[data-warmup] Interrupted");
        } catch (Exception e) {
            log.error("[data-warmup] Error during data warmup, will retry on next restart", e);
            progress = new WarmupProgress(progress.priceHistoryCount(), TARGET_ROWS,
                    progress.behaviorLogCount(), TARGET_ROWS, false, "ERROR");
        }
    }

    private void insertPriceHistoryBatch() {
        ThreadLocalRandom rng = ThreadLocalRandom.current();
        StringBuilder sql = new StringBuilder(
                "INSERT INTO product_price_history (sku, previous_price, current_price, change_reason, operator_id, effective_at) VALUES ");

        for (int i = 0; i < BATCH_SIZE; i++) {
            if (i > 0) sql.append(',');
            int idx = rng.nextInt(50);
            BigDecimal basePrice = BASE_PRICES[idx];
            double factor = 1.0 + (rng.nextDouble(-0.20, 0.20));
            BigDecimal currentPrice = basePrice.multiply(BigDecimal.valueOf(factor))
                    .setScale(2, RoundingMode.HALF_UP);
            String reason = weightedPick(CHANGE_REASONS, REASON_WEIGHTS, rng);
            int operatorId = rng.nextInt(1, 11);
            long daysAgo = rng.nextLong(0, 365 * 3);
            long hoursOffset = rng.nextLong(0, 24);
            LocalDateTime effectiveAt = LocalDateTime.now()
                    .minusDays(daysAgo).minusHours(hoursOffset);

            sql.append("('").append(SKUS[idx]).append("',")
                    .append(basePrice).append(',')
                    .append(currentPrice).append(",'")
                    .append(reason).append("',")
                    .append(operatorId).append(",'")
                    .append(effectiveAt).append("')");
        }

        jdbcTemplate.execute(sql.toString());
    }

    private void insertBehaviorLogBatch() {
        ThreadLocalRandom rng = ThreadLocalRandom.current();
        StringBuilder sql = new StringBuilder(
                "INSERT INTO user_behavior_log (user_id, action_type, target_id, target_type, ip_address, session_id, created_at) VALUES ");

        for (int i = 0; i < BATCH_SIZE; i++) {
            if (i > 0) sql.append(',');
            long userId = rng.nextLong(1, 21);
            String actionType = weightedPick(ACTION_TYPES, ACTION_WEIGHTS, rng);
            int actionIdx = java.util.Arrays.asList(ACTION_TYPES).indexOf(actionType);
            String targetType = TARGET_TYPES[actionIdx];
            String targetId;
            if ("ORDER".equals(targetType)) {
                targetId = "ORD-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
            } else if ("CATEGORY".equals(targetType)) {
                String[] cats = {"数码", "家居", "运动", "服装", "美妆", "食品"};
                targetId = cats[rng.nextInt(cats.length)];
            } else {
                targetId = SKUS[rng.nextInt(50)];
            }
            String ip = "10.0." + rng.nextInt(256) + "." + rng.nextInt(1, 255);
            String sessionId = UUID.randomUUID().toString();
            long daysAgo = rng.nextLong(0, 365);
            long hoursOffset = rng.nextLong(0, 24);
            LocalDateTime createdAt = LocalDateTime.now()
                    .minusDays(daysAgo).minusHours(hoursOffset);

            sql.append("(").append(userId).append(",'")
                    .append(actionType).append("','")
                    .append(targetId).append("','")
                    .append(targetType).append("','")
                    .append(ip).append("','")
                    .append(sessionId).append("','")
                    .append(createdAt).append("')");
        }

        jdbcTemplate.execute(sql.toString());
    }

    private long countTable(String tableName) {
        Long count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + tableName, Long.class);
        return count != null ? count : 0;
    }

    private static String weightedPick(String[] items, double[] weights, ThreadLocalRandom rng) {
        double r = rng.nextDouble();
        double cum = 0;
        for (int i = 0; i < items.length; i++) {
            cum += weights[i];
            if (r < cum) return items[i];
        }
        return items[items.length - 1];
    }

    private static double pct(long count) {
        return (double) count / TARGET_ROWS * 100;
    }

    private static BigDecimal bd(int val) {
        return BigDecimal.valueOf(val).setScale(2, RoundingMode.UNNECESSARY);
    }
}
