package com.castrel.chaos.promotion.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.TraceContext;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.promotion.config.DemoCouponPoolProperties;
import com.castrel.chaos.promotion.dto.DemoCouponReplenishmentResult;
import com.castrel.chaos.promotion.dto.PromotionRequest;
import com.castrel.chaos.promotion.dto.PromotionResultDTO;
import com.castrel.chaos.promotion.dto.SkuItem;
import com.castrel.chaos.promotion.dto.CouponCandidateDTO;
import com.castrel.chaos.promotion.entity.Coupon;
import com.castrel.chaos.promotion.entity.Promotion;
import com.castrel.chaos.promotion.repository.CouponRepository;
import com.castrel.chaos.promotion.repository.CouponReservationRepository;
import com.castrel.chaos.promotion.entity.CouponReservation;
import com.castrel.chaos.promotion.repository.PromotionRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.scheduling.annotation.Scheduled;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Map;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

@Service
public class PromotionService {

    private static final BigDecimal MIN_AMOUNT = new BigDecimal("0.01");

    @Autowired
    private PromotionRepository promotionRepository;

    @Autowired
    private DemoCouponPoolProperties demoCouponPoolProperties;

    @Autowired
    private CouponRepository couponRepository;

    @Autowired
    private CouponReservationRepository reservationRepository;

    @Autowired
    private LocalQueryCacheManager localQueryCacheManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private MeterRegistry meterRegistry;

    private Counter calculateCounter;
    private Counter discountTotalCounter;

    @PostConstruct
    void initMetrics() {
        calculateCounter = Counter.builder("promotion.calculate.count")
                .tag("type", "calculate")
                .register(meterRegistry);
        discountTotalCounter = Counter.builder("promotion.discount.total")
                .register(meterRegistry);
    }

    public PromotionResultDTO preview(PromotionRequest req) {
        BigDecimal original = calcOriginal(req.getSkus());
        return applyPromotions(req.getUserId(), original, false, null, req.getOrderId(), req.getCouponId());
    }

        @Transactional
        public DemoCouponReplenishmentResult replenishDemoCouponPool(String runId) {
        validateDemoCouponPoolConfiguration();
        String windowId = validateReplenishmentRunId(runId);
        String correlationId = TraceContext.getTraceId() == null
            ? "coupon-replenish-" + windowId
            : TraceContext.getTraceId();
        LocalDateTime startedAt = LocalDateTime.now();
        writeReplenishmentRun(windowId, correlationId, "RUNNING", startedAt, null,
            0, "started");

        int addedCount = 0;
        int skippedCount = 0;
        int failedCount = 0;
        int promotionCount = 0;
        try {
            if (!demoCouponPoolProperties.isEnabled()) {
            DemoCouponReplenishmentResult disabled = new DemoCouponReplenishmentResult(
                windowId, correlationId, demoCouponPoolProperties.getCustomerIds().size(),
                0, 0, 0, 0);
            writeReplenishmentRun(windowId, correlationId, "COMPLETED", startedAt,
                LocalDateTime.now(), 0, "disabled");
            return disabled;
            }

            LocalDateTime now = LocalDateTime.now();
            List<Promotion> promotions = promotionRepository.findAll().stream()
                .filter(promotion -> demoCouponPoolProperties.getPromotionTypes().stream()
                    .anyMatch(type -> type.equalsIgnoreCase(promotion.getType())))
                .filter(promotion -> isActive(promotion, now))
                .toList();
            promotionCount = promotions.size();

            for (Long customerId : demoCouponPoolProperties.getCustomerIds()) {
            for (Promotion promotion : promotions) {
                if (!claimReplenishmentBatch(windowId, customerId, promotion.getId(), now)) {
                skippedCount++;
                continue;
                }
                long available = couponRepository.countAvailable(customerId, promotion.getId(), now);
                if (available >= demoCouponPoolProperties.getReplenishBelowCount()) {
                skippedCount++;
                markReplenishmentBatchCompleted(windowId, customerId, promotion.getId(), now);
                continue;
                }

                int missing = demoCouponPoolProperties.getTargetAvailableCount() - (int) available;
                for (int index = 0; index < missing; index++) {
                Coupon coupon = new Coupon();
                coupon.setUserId(customerId);
                coupon.setPromotionId(promotion.getId());
                coupon.setStatus(0);
                coupon.setExpireAt(now.plusHours(demoCouponPoolProperties.getValidityHours()));
                couponRepository.save(coupon);
                }
                addedCount += missing;
                markReplenishmentBatchCompleted(windowId, customerId, promotion.getId(), now);
            }
            }

            DemoCouponReplenishmentResult result = new DemoCouponReplenishmentResult(
                windowId, correlationId, demoCouponPoolProperties.getCustomerIds().size(),
                promotionCount, addedCount, skippedCount, failedCount);
            writeReplenishmentRun(windowId, correlationId, "COMPLETED", startedAt,
                LocalDateTime.now(), 0, replenishmentSummary(result));
            return result;
        } catch (RuntimeException exception) {
            failedCount++;
            writeReplenishmentRun(windowId, correlationId, "FAILED", startedAt,
                LocalDateTime.now(), 0, "failed");
            throw exception;
        }
        }

        private boolean claimReplenishmentBatch(
            String windowId, Long customerId, Long promotionId, LocalDateTime now) {
        int inserted = jdbcTemplate.update(
            "INSERT IGNORE INTO coupon_issuance_batches "
                + "(window_id, customer_id, promotion_id, status, created_at, updated_at) "
                + "VALUES (?, ?, ?, 'RUNNING', ?, ?)",
            windowId, customerId, promotionId, now, now);
        if (inserted == 1) {
            return true;
        }
        return jdbcTemplate.update(
            "UPDATE coupon_issuance_batches SET status = 'RUNNING', updated_at = ? "
                + "WHERE window_id = ? AND customer_id = ? AND promotion_id = ? AND status = 'FAILED'",
            now, windowId, customerId, promotionId) == 1;
        }

        private void markReplenishmentBatchCompleted(
            String windowId, Long customerId, Long promotionId, LocalDateTime now) {
        jdbcTemplate.update(
            "UPDATE coupon_issuance_batches SET status = 'COMPLETED', updated_at = ? "
                + "WHERE window_id = ? AND customer_id = ? AND promotion_id = ?",
            now, windowId, customerId, promotionId);
        }

        private void validateDemoCouponPoolConfiguration() {
        if (demoCouponPoolProperties.getCustomerIds() == null
            || demoCouponPoolProperties.getCustomerIds().isEmpty()
            || demoCouponPoolProperties.getPromotionTypes() == null
            || demoCouponPoolProperties.getPromotionTypes().isEmpty()
            || demoCouponPoolProperties.getTargetAvailableCount() < 1
            || demoCouponPoolProperties.getReplenishBelowCount() < 0
            || demoCouponPoolProperties.getReplenishBelowCount()
                > demoCouponPoolProperties.getTargetAvailableCount()
            || demoCouponPoolProperties.getValidityHours() < 1
            || demoCouponPoolProperties.getCustomerIds().stream().anyMatch(id -> id == null || id <= 0)) {
            throw new BizException("DEMO_COUPON_POOL_CONFIG_INVALID",
                "Demo coupon pool configuration is invalid");
        }
        }

        private String validateReplenishmentRunId(String runId) {
        if (runId == null || !runId.matches("[A-Za-z0-9:_-]{1,64}")) {
            throw new BizException("INVALID_REPLENISHMENT_RUN", "A valid replenishment run ID is required");
        }
        return runId;
        }

        private void writeReplenishmentRun(
            String windowId, String correlationId, String status, LocalDateTime startedAt,
            LocalDateTime completedAt, int retryCount, String resultSummary) {
        jdbcTemplate.update(
            "INSERT INTO traffic_replenishment_runs "
                + "(window_id, operation_type, status, started_at, completed_at, retry_count, "
                + "result_summary, correlation_id) VALUES (?, 'DEMO_COUPON_REPLENISH', ?, ?, ?, ?, ?, ?) "
                + "ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = VALUES(completed_at), "
                + "retry_count = VALUES(retry_count), result_summary = VALUES(result_summary), "
                + "correlation_id = VALUES(correlation_id)",
            windowId, status, startedAt, completedAt, retryCount, resultSummary, correlationId);
        }

        private String replenishmentSummary(DemoCouponReplenishmentResult result) {
        return "customers=" + result.customerCount() + ",promotions=" + result.promotionCount()
            + ",added=" + result.addedCount() + ",skipped=" + result.skippedCount()
            + ",failed=" + result.failedCount();
        }

        @Transactional(readOnly = true)
        public List<CouponCandidateDTO> findAvailableCoupons(Long userId) {
        if (userId == null) {
            throw new BizException("CUSTOMER_PRINCIPAL_REQUIRED", "Customer principal is required");
        }
        LocalDateTime now = LocalDateTime.now();
        Map<Long, Promotion> activePromotions = promotionRepository.findAll().stream()
            .filter(promotion -> isActive(promotion, now))
            .filter(promotion -> "DISCOUNT".equals(promotion.getType())
                || "COUPON".equals(promotion.getType()))
            .collect(java.util.stream.Collectors.toMap(Promotion::getId, promotion -> promotion));

        return couponRepository.findByUserIdAndStatus(userId, 0).stream()
            .filter(coupon -> coupon.getExpireAt() == null || coupon.getExpireAt().isAfter(now))
            .filter(coupon -> activePromotions.containsKey(coupon.getPromotionId()))
            .map(coupon -> Map.entry(coupon, activePromotions.get(coupon.getPromotionId())))
            .map(entry -> {
                Coupon coupon = entry.getKey();
                Promotion promotion = entry.getValue();
                return new CouponCandidateDTO(
                    coupon.getId(),
                    promotion.getType(),
                    promotion.getName(),
                    promotion.getMinAmount(),
                    promotion.getDiscount(),
                    promotion.getReduceAmt(),
                    coupon.getExpireAt(),
                    "AVAILABLE");
            })
            .toList();
        }

    @Transactional
    public PromotionResultDTO calculate(PromotionRequest req) {
        if (req.getOrderId() == null || req.getOrderId().isBlank()) {
            throw new BizException("MISSING_ORDER_ID", "orderId is required for calculate");
        }
        // Idempotency check
        String idempotencyKey = "promo:calc:" + req.getOrderId();
        Boolean isNew = redisTemplate.opsForValue().setIfAbsent(idempotencyKey, "1", 24, TimeUnit.HOURS);
        if (Boolean.FALSE.equals(isNew)) {
            // Already calculated — return a consistent preview result (idempotent response)
            BigDecimal original = calcOriginal(req.getSkus());
            return applyPromotions(req.getUserId(), original, false, null, req.getOrderId(), req.getCouponId());
        }

        BigDecimal original = calcOriginal(req.getSkus());
        PromotionResultDTO result = applyPromotions(req.getUserId(), original, true, req.getUserId(),
            req.getOrderId(), req.getCouponId());

        calculateCounter.increment();
        discountTotalCounter.increment(result.getDiscountAmount().doubleValue());
        localQueryCacheManager.cacheIfNeeded("promotion:" + req.getOrderId(), result);
        return result;
    }

    private BigDecimal calcOriginal(List<SkuItem> skus) {
        if (skus == null || skus.isEmpty()) {
            throw new BizException("INVALID_PROMOTION_ITEMS", "At least one SKU is required");
        }
        Map<String, BigDecimal> prices = jdbcTemplate.query(
                "SELECT sku, price FROM products WHERE sku IN (" +
                        String.join(",", skus.stream().map(item -> "?").toList()) + ") AND status = 1",
                skus.stream().map(SkuItem::getSku).toArray(),
                resultSet -> {
                    Map<String, BigDecimal> result = new java.util.HashMap<>();
                    while (resultSet.next()) {
                        result.put(resultSet.getString("sku"), resultSet.getBigDecimal("price"));
                    }
                    return result;
                });
        return skus.stream()
                .map(item -> {
                    BigDecimal price = prices.get(item.getSku());
                    if (price == null || item.getQuantity() <= 0) {
                        throw new BizException("PRODUCT_UNAVAILABLE", "Product unavailable: " + item.getSku());
                    }
                    return price.multiply(BigDecimal.valueOf(item.getQuantity()));
                })
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private PromotionResultDTO applyPromotions(Long userId, BigDecimal original,
                                                boolean lockCoupon, Long lockUserId, String orderId,
                                                Long requestedCouponId) {
        LocalDateTime now = LocalDateTime.now();
        List<Promotion> active = promotionRepository
            .findByEnabledAndEndAtAfterOrEndAtIsNull(1, now).stream()
            .filter(promotion -> isActive(promotion, now))
            .toList();

        List<PromotionResultDTO.AppliedPromotion> applied = new ArrayList<>();
        BigDecimal remaining = original;
        Long usedCouponId = null;
        boolean couponEligible = false;

        // Step 1: apply best FULL_REDUCTION
        Optional<Promotion> bestReduction = active.stream()
                .filter(p -> "FULL_REDUCTION".equals(p.getType()))
                .filter(p -> original.compareTo(p.getMinAmount()) >= 0)
                .findFirst();
        if (bestReduction.isPresent()) {
            Promotion p = bestReduction.get();
            BigDecimal saving = p.getReduceAmt() != null ? p.getReduceAmt() : BigDecimal.ZERO;
            remaining = remaining.subtract(saving);
            PromotionResultDTO.AppliedPromotion ap = new PromotionResultDTO.AppliedPromotion();
            ap.setPromotionId(p.getId());
            ap.setPromotionName(p.getName());
            ap.setType(p.getType());
            ap.setSaving(saving);
            applied.add(ap);
        }

        // A missing coupon id is an explicit no-coupon checkout.
        if (userId != null && requestedCouponId != null) {
            Coupon coupon = lockCoupon
                    ? couponRepository.findByIdForUpdate(requestedCouponId).orElse(null)
                    : couponRepository.findByUserIdAndStatus(userId, 0).stream()
                            .filter(candidate -> requestedCouponId.equals(candidate.getId()))
                            .findFirst()
                            .orElse(null);
            if (coupon == null || !userId.equals(coupon.getUserId())) {
                throw new BizException("COUPON_INELIGIBLE", "Coupon is not eligible for this order");
            }
            if (lockCoupon && coupon.getStatus() != 0) {
                throw new BizException(coupon.getStatus() == 1
                        ? "COUPON_ALREADY_RESERVED" : "COUPON_INELIGIBLE",
                        coupon.getStatus() == 1 ? "Coupon is already reserved" : "Coupon is not eligible");
            }
            if (coupon.getExpireAt() != null && !coupon.getExpireAt().isAfter(now)) {
                throw new BizException("COUPON_INELIGIBLE", "Coupon is expired");
            }
            Optional<Promotion> promoOpt = active.stream()
                    .filter(p -> p.getId().equals(coupon.getPromotionId()))
                    .filter(p -> "DISCOUNT".equals(p.getType()) || "COUPON".equals(p.getType()))
                    .filter(p -> original.compareTo(p.getMinAmount()) >= 0)
                    .findFirst();
            if (promoOpt.isPresent()) {
                couponEligible = true;
                Promotion promo = promoOpt.get();
                BigDecimal saving;
                if ("DISCOUNT".equals(promo.getType())) {
                    BigDecimal discountRate = promo.getDiscount() != null ? promo.getDiscount() : BigDecimal.ONE;
                    saving = remaining.subtract(remaining.multiply(discountRate))
                            .setScale(2, RoundingMode.HALF_UP);
                } else {
                    saving = promo.getReduceAmt() != null ? promo.getReduceAmt() : BigDecimal.ZERO;
                }
                remaining = remaining.subtract(saving);

                if (lockCoupon) {
                    coupon.setStatus(1);
                    coupon.setUsedAt(null);
                    couponRepository.save(coupon);
                    CouponReservation reservation = new CouponReservation();
                    reservation.setCouponId(coupon.getId());
                    reservation.setOrderId(orderId);
                    reservation.setCustomerId(lockUserId);
                    reservation.setStatus("RESERVED");
                    reservation.setOperationId("coupon:" + orderId + ":" + coupon.getId());
                    reservation.setExpiresAt(now.plusMinutes(15));
                    reservation.setCreatedAt(now);
                    reservation.setUpdatedAt(now);
                    reservationRepository.save(reservation);
                    usedCouponId = coupon.getId();
                }

                PromotionResultDTO.AppliedPromotion ap = new PromotionResultDTO.AppliedPromotion();
                ap.setPromotionId(promo.getId());
                ap.setPromotionName(promo.getName());
                ap.setType(promo.getType());
                ap.setSaving(saving);
                applied.add(ap);
            }
            if (!couponEligible) {
                throw new BizException("COUPON_INELIGIBLE", "Coupon is not eligible for this order");
            }
        }

        // Ensure min payment 0.01
        if (remaining.compareTo(MIN_AMOUNT) < 0) {
            remaining = MIN_AMOUNT;
        }

        BigDecimal discount = original.subtract(remaining).setScale(2, RoundingMode.HALF_UP);

        PromotionResultDTO dto = new PromotionResultDTO();
        dto.setOriginalAmount(original.setScale(2, RoundingMode.HALF_UP));
        dto.setDiscountAmount(discount);
        dto.setFinalAmount(remaining.setScale(2, RoundingMode.HALF_UP));
        dto.setAppliedPromotions(applied);
        dto.setUsedCouponId(usedCouponId);
        return dto;
    }

    private boolean isActive(Promotion promotion, LocalDateTime now) {
        return promotion.getEnabled() != null && promotion.getEnabled() == 1
                && (promotion.getStartAt() == null || !promotion.getStartAt().isAfter(now))
                && (promotion.getEndAt() == null || promotion.getEndAt().isAfter(now));
    }

    @Transactional
    public void releaseReservation(String orderId, Long couponId) {
        CouponReservation reservation = reservationRepository.findByOrderIdAndCouponIdForUpdate(orderId, couponId)
                .orElseThrow(() -> new BizException("COUPON_RESERVATION_NOT_FOUND", "Coupon reservation not found"));
        if (!"RESERVED".equals(reservation.getStatus())) return;
        couponRepository.findByIdForUpdate(couponId).ifPresent(coupon -> {
            coupon.setStatus(0);
            coupon.setUsedAt(null);
            couponRepository.save(coupon);
        });
        reservation.setStatus("RELEASED");
        reservation.setUpdatedAt(LocalDateTime.now());
        reservationRepository.save(reservation);
    }

    @Transactional
    public void confirmReservation(String orderId, Long couponId) {
        CouponReservation reservation = reservationRepository.findByOrderIdAndCouponIdForUpdate(orderId, couponId)
                .orElseThrow(() -> new BizException("COUPON_RESERVATION_NOT_FOUND", "Coupon reservation not found"));
        if ("RESERVED".equals(reservation.getStatus())) {
            if (reservation.getExpiresAt() != null
                    && !reservation.getExpiresAt().isAfter(LocalDateTime.now())) {
                throw new BizException("COUPON_RESERVATION_EXPIRED", "Coupon reservation has expired");
            }
            couponRepository.findByIdForUpdate(couponId).ifPresent(coupon -> {
                coupon.setStatus(2);
                coupon.setUsedAt(LocalDateTime.now());
                couponRepository.save(coupon);
            });
            reservation.setStatus("USED");
            reservation.setUpdatedAt(LocalDateTime.now());
            reservationRepository.save(reservation);
        }
    }

    @Scheduled(fixedDelayString = "${promotion.coupon-reservation-cleanup-delay-ms:60000}")
    @Transactional
    public void releaseExpiredReservations() {
        LocalDateTime now = LocalDateTime.now();
        for (CouponReservation reservation : reservationRepository.findExpiredForUpdate(now)) {
            couponRepository.findByIdForUpdate(reservation.getCouponId()).ifPresent(coupon -> {
                if (coupon.getStatus() == 1) {
                    coupon.setStatus(0);
                    coupon.setUsedAt(null);
                    couponRepository.save(coupon);
                }
            });
            reservation.setStatus("RELEASED");
            reservation.setUpdatedAt(now);
            reservationRepository.save(reservation);
        }
    }
}
