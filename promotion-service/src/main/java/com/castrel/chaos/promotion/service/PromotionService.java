package com.castrel.chaos.promotion.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
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

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
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
    private CouponRepository couponRepository;

    @Autowired
    private CouponReservationRepository reservationRepository;

    @Autowired
    private QueryEnrichmentInterceptor queryEnrichmentInterceptor;

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
        enrichQueryIfNeeded();
        BigDecimal original = calcOriginal(req.getSkus());
        return applyPromotions(req.getUserId(), original, false, null, req.getOrderId(), req.getCouponId());
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
            .map(coupon -> Map.entry(coupon, activePromotions.get(coupon.getPromotionId())))
            .filter(entry -> entry.getValue() != null)
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
            enrichQueryIfNeeded();
            BigDecimal original = calcOriginal(req.getSkus());
            return applyPromotions(req.getUserId(), original, false, null, req.getOrderId(), req.getCouponId());
        }

        enrichQueryIfNeeded();
        BigDecimal original = calcOriginal(req.getSkus());
        PromotionResultDTO result = applyPromotions(req.getUserId(), original, true, req.getUserId(),
            req.getOrderId(), req.getCouponId());

        calculateCounter.increment();
        discountTotalCounter.increment(result.getDiscountAmount().doubleValue());
        localQueryCacheManager.cacheIfNeeded("promotion:" + req.getOrderId(), result);
        return result;
    }

    private void enrichQueryIfNeeded() {
        if (!queryEnrichmentInterceptor.shouldEnrich()) return;
        String joinTable = queryEnrichmentInterceptor.getJoinTable();
        int limitRows = queryEnrichmentInterceptor.getLimitRows();
        int offsetRows = queryEnrichmentInterceptor.getOffsetRows();
        if ("product_price_history".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT pr.*, pph.effective_at AS __pph_effective_at" +
                    " FROM promotions pr" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = pr.name" +
                    " ORDER BY pph.effective_at DESC, pr.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.enabled = 1" +
                    " AND s.__pph_effective_at <= NOW()" +
                    " ORDER BY s.__pph_effective_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        } else if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT s.* FROM (" +
                    " SELECT pr.*, ubl.action_type AS __ubl_action_type, ubl.created_at AS __ubl_created_at" +
                    " FROM promotions pr" +
                    " JOIN user_behavior_log ubl ON TRUE" +
                    " ORDER BY ubl.created_at DESC, pr.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows +
                    ") s" +
                    " WHERE s.enabled = 1" +
                    " AND s.__ubl_action_type = 'PLACE_ORDER'" +
                    " ORDER BY s.__ubl_created_at DESC, s.id DESC" +
                    " LIMIT " + limitRows);
        }
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
}
