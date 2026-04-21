package com.castrel.chaos.promotion.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.cache.LocalQueryCacheManager;
import com.castrel.chaos.common.interceptor.QueryEnrichmentInterceptor;
import com.castrel.chaos.promotion.dto.PromotionRequest;
import com.castrel.chaos.promotion.dto.PromotionResultDTO;
import com.castrel.chaos.promotion.dto.SkuItem;
import com.castrel.chaos.promotion.entity.Coupon;
import com.castrel.chaos.promotion.entity.Promotion;
import com.castrel.chaos.promotion.repository.CouponRepository;
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
        return applyPromotions(req.getUserId(), original, false, null);
    }

    @Transactional
    public PromotionResultDTO calculate(PromotionRequest req) {
        if (req.getOrderId() == null) {
            throw new BizException("MISSING_ORDER_ID", "orderId is required for calculate");
        }
        // Idempotency check
        String idempotencyKey = "promo:calc:" + req.getOrderId();
        Boolean isNew = redisTemplate.opsForValue().setIfAbsent(idempotencyKey, "1", 24, TimeUnit.HOURS);
        if (Boolean.FALSE.equals(isNew)) {
            // Already calculated — return a consistent preview result (idempotent response)
            enrichQueryIfNeeded();
            BigDecimal original = calcOriginal(req.getSkus());
            return applyPromotions(req.getUserId(), original, false, null);
        }

        enrichQueryIfNeeded();
        BigDecimal original = calcOriginal(req.getSkus());
        PromotionResultDTO result = applyPromotions(req.getUserId(), original, true, req.getUserId());

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
                    "SELECT pr.* FROM promotions pr" +
                    " JOIN product_price_history pph ON CONCAT(pph.sku, '') = pr.name" +
                    " WHERE pr.enabled = 1" +
                    " AND pph.effective_at <= NOW()" +
                    " ORDER BY pph.effective_at DESC, pr.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows);
        } else if ("user_behavior_log".equals(joinTable)) {
            jdbcTemplate.queryForList(
                    "SELECT pr.* FROM promotions pr" +
                    " JOIN user_behavior_log ubl ON ubl.action_type = 'PLACE_ORDER'" +
                    " WHERE pr.enabled = 1" +
                    " ORDER BY ubl.created_at DESC, pr.id DESC" +
                    " LIMIT " + limitRows + " OFFSET " + offsetRows);
        }
    }

    private BigDecimal calcOriginal(List<SkuItem> skus) {
        return skus.stream()
                .map(s -> s.getPrice().multiply(BigDecimal.valueOf(s.getQty())))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private PromotionResultDTO applyPromotions(Long userId, BigDecimal original,
                                                boolean lockCoupon, Long lockUserId) {
        List<Promotion> active = promotionRepository
                .findByEnabledAndEndAtAfterOrEndAtIsNull(1, LocalDateTime.now());

        List<PromotionResultDTO.AppliedPromotion> applied = new ArrayList<>();
        BigDecimal remaining = original;
        Long usedCouponId = null;

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

        // Step 2: apply one DISCOUNT coupon for the user
        if (userId != null) {
            List<Coupon> userCoupons = couponRepository.findByUserIdAndStatus(userId, 0);
            for (Coupon coupon : userCoupons) {
                Optional<Promotion> promoOpt = active.stream()
                        .filter(p -> p.getId().equals(coupon.getPromotionId()))
                        .filter(p -> "DISCOUNT".equals(p.getType()) || "COUPON".equals(p.getType()))
                        .findFirst();
                if (promoOpt.isPresent()) {
                    Promotion promo = promoOpt.get();
                    BigDecimal discountRate = promo.getDiscount() != null ? promo.getDiscount() : BigDecimal.ONE;
                    BigDecimal saving = remaining.subtract(remaining.multiply(discountRate)).setScale(2, RoundingMode.HALF_UP);
                    remaining = remaining.subtract(saving);

                    if (lockCoupon) {
                        coupon.setStatus(1);
                        coupon.setUsedAt(LocalDateTime.now());
                        couponRepository.save(coupon);
                        usedCouponId = coupon.getId();
                    }

                    PromotionResultDTO.AppliedPromotion ap = new PromotionResultDTO.AppliedPromotion();
                    ap.setPromotionId(promo.getId());
                    ap.setPromotionName(promo.getName());
                    ap.setType(promo.getType());
                    ap.setSaving(saving);
                    applied.add(ap);
                    break; // only one coupon
                }
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
}
