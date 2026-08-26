package com.castrel.chaos.promotion.service;

import com.castrel.chaos.common.BizException;
import com.castrel.chaos.common.security.JwtTokenService;
import com.castrel.chaos.promotion.controller.PromotionController;
import com.castrel.chaos.promotion.dto.CouponCandidateDTO;
import com.castrel.chaos.promotion.entity.Coupon;
import com.castrel.chaos.promotion.entity.Promotion;
import com.castrel.chaos.promotion.config.DemoCouponPoolProperties;
import com.castrel.chaos.promotion.repository.CouponIssuanceBatchRepository;
import com.castrel.chaos.promotion.repository.CouponRepository;
import com.castrel.chaos.promotion.repository.CouponReservationRepository;
import com.castrel.chaos.promotion.repository.PromotionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PromotionServiceContractTest {

    @Mock
    private PromotionRepository promotionRepository;

    @Mock
    private CouponRepository couponRepository;

    @Mock
    private CouponReservationRepository reservationRepository;

    @Mock
    private CouponIssuanceBatchRepository issuanceBatchRepository;

    @Mock
    private DemoCouponPoolProperties demoCouponPoolProperties;

    @Mock
    private JdbcTemplate jdbcTemplate;

    @InjectMocks
    private PromotionService promotionService;

    @Test
    void missingCouponIdDoesNotReadOrConsumeCustomerCoupons() {
        when(promotionRepository.findByEnabledAndEndAtAfterOrEndAtIsNull(
                org.mockito.ArgumentMatchers.eq(1), org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of());

        var result = ReflectionTestUtils.invokeMethod(
                promotionService, "applyPromotions", 7L, new BigDecimal("100.00"),
                false, null, "order-1", null);

        assertThat(result).isNotNull();
        verify(couponRepository, never()).findByUserIdAndStatus(7L, 0);
        verify(couponRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void couponPromotionUsesFixedReductionAmount() {
        Promotion promotion = promotion(1L, "COUPON", BigDecimal.ZERO, null, new BigDecimal("10.00"));
        Coupon coupon = coupon(11L, 7L, 1L, LocalDateTime.now().plusDays(1));
        when(promotionRepository.findByEnabledAndEndAtAfterOrEndAtIsNull(
                org.mockito.ArgumentMatchers.eq(1), org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of(promotion));
        when(couponRepository.findByUserIdAndStatus(7L, 0)).thenReturn(List.of(coupon));

        var result = ReflectionTestUtils.invokeMethod(
                promotionService, "applyPromotions", 7L, new BigDecimal("100.00"),
                false, null, "order-1", 11L);

        assertThat(result).extracting("discountAmount").isEqualTo(new BigDecimal("10.00"));
        assertThat(result).extracting("finalAmount").isEqualTo(new BigDecimal("90.00"));
        verify(couponRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void availableCouponQueryFiltersExpiredAndInactivePromotions() {
        Promotion active = promotion(1L, "DISCOUNT", BigDecimal.ZERO, new BigDecimal("0.90"), null);
        Promotion inactive = promotion(2L, "DISCOUNT", BigDecimal.ZERO, new BigDecimal("0.80"), null);
        inactive.setEnabled(0);
        Coupon available = coupon(11L, 7L, 1L, LocalDateTime.now().plusDays(1));
        Coupon expired = coupon(12L, 7L, 2L, LocalDateTime.now().minusMinutes(1));
        Coupon orphan = coupon(13L, 7L, 999L, LocalDateTime.now().plusDays(1));
        when(promotionRepository.findAll()).thenReturn(List.of(active, inactive));
        when(couponRepository.findByUserIdAndStatus(7L, 0)).thenReturn(List.of(available, expired, orphan));

        List<CouponCandidateDTO> result = promotionService.findAvailableCoupons(7L);

        assertThat(result).extracting(CouponCandidateDTO::id).containsExactly(11L);
        assertThat(result.get(0).status()).isEqualTo("AVAILABLE");
    }

    @Test
    void customerCouponApiRequiresGatewayCustomerPrincipal() {
        JwtTokenService tokenService = org.mockito.Mockito.mock(JwtTokenService.class);
        PromotionController controller = new PromotionController();
        ReflectionTestUtils.setField(controller, "promotionService", promotionService);
        ReflectionTestUtils.setField(controller, "jwtTokenService", tokenService);

        assertThatThrownBy(() -> controller.coupons("AVAILABLE", null))
                .isInstanceOf(BizException.class)
                .hasMessage("Customer principal is required");
    }

    @Test
    void expiredReservationIsReleasedExactlyOnce() {
        var reservation = new com.castrel.chaos.promotion.entity.CouponReservation();
        reservation.setCouponId(11L);
        reservation.setStatus("RESERVED");
        reservation.setExpiresAt(LocalDateTime.now().minusMinutes(1));
        when(reservationRepository.findExpiredForUpdate(org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of(reservation));
        Coupon coupon = coupon(11L, 7L, 1L, LocalDateTime.now().plusDays(1));
        coupon.setStatus(1);
        when(couponRepository.findByIdForUpdate(11L)).thenReturn(java.util.Optional.of(coupon));

        promotionService.releaseExpiredReservations();

        assertThat(coupon.getStatus()).isZero();
        assertThat(reservation.getStatus()).isEqualTo("RELEASED");
        verify(couponRepository).save(coupon);
        verify(reservationRepository).save(reservation);
    }

        @Test
        void replenishesOnlyConfiguredCustomersAndPromotionsToTarget() {
        DemoCouponPoolProperties properties = new DemoCouponPoolProperties();
        properties.setCustomerIds(List.of(1L));
        properties.setPromotionTypes(List.of("COUPON"));
        properties.setTargetAvailableCount(3);
        properties.setReplenishBelowCount(2);
        properties.setValidityHours(24);
        ReflectionTestUtils.setField(promotionService, "demoCouponPoolProperties", properties);

        Promotion couponPromotion = promotion(5L, "COUPON", BigDecimal.ZERO, null, new BigDecimal("10.00"));
        Promotion discountPromotion = promotion(6L, "DISCOUNT", BigDecimal.ZERO, new BigDecimal("0.90"), null);
        when(promotionRepository.findAll()).thenReturn(List.of(couponPromotion, discountPromotion));
        when(couponRepository.countAvailable(
            org.mockito.ArgumentMatchers.eq(1L), org.mockito.ArgumentMatchers.eq(5L),
            org.mockito.ArgumentMatchers.any())).thenReturn(1L);
        when(jdbcTemplate.update(org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.any(Object[].class))).thenReturn(1);

        var result = promotionService.replenishDemoCouponPool();

        assertThat(result.customerCount()).isEqualTo(1);
        assertThat(result.promotionCount()).isEqualTo(1);
        assertThat(result.addedCount()).isEqualTo(2);
        assertThat(result.skippedCount()).isZero();
        verify(couponRepository, org.mockito.Mockito.times(2))
            .save(org.mockito.ArgumentMatchers.argThat(coupon ->
                coupon.getUserId().equals(1L)
                    && coupon.getPromotionId().equals(5L)
                    && coupon.getStatus() == 0
                    && coupon.getExpireAt() != null));
        }

        @Test
        void duplicateWindowClaimSkipsWithoutIssuingAnotherCoupon() {
        DemoCouponPoolProperties properties = new DemoCouponPoolProperties();
        properties.setCustomerIds(List.of(1L));
        properties.setPromotionTypes(List.of("COUPON"));
        ReflectionTestUtils.setField(promotionService, "demoCouponPoolProperties", properties);

        Promotion couponPromotion = promotion(5L, "COUPON", BigDecimal.ZERO, null, new BigDecimal("10.00"));
        when(promotionRepository.findAll()).thenReturn(List.of(couponPromotion));
        org.mockito.Mockito.doAnswer(invocation ->
            ((String) invocation.getArgument(0)).contains("INSERT IGNORE") ? 0 : 1)
            .when(jdbcTemplate).update(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any(Object[].class));

        var result = promotionService.replenishDemoCouponPool();

        assertThat(result.addedCount()).isZero();
        assertThat(result.skippedCount()).isEqualTo(1);
        verify(couponRepository, never()).save(org.mockito.ArgumentMatchers.any());
        }

    private Promotion promotion(Long id, String type, BigDecimal minAmount,
                                BigDecimal discount, BigDecimal reduceAmount) {
        Promotion promotion = new Promotion();
        promotion.setId(id);
        promotion.setType(type);
        promotion.setName("test promotion");
        promotion.setMinAmount(minAmount);
        promotion.setDiscount(discount);
        promotion.setReduceAmt(reduceAmount);
        promotion.setEnabled(1);
        return promotion;
    }

    private Coupon coupon(Long id, Long userId, Long promotionId, LocalDateTime expireAt) {
        Coupon coupon = new Coupon();
        coupon.setId(id);
        coupon.setUserId(userId);
        coupon.setPromotionId(promotionId);
        coupon.setStatus(0);
        coupon.setExpireAt(expireAt);
        return coupon;
    }
}