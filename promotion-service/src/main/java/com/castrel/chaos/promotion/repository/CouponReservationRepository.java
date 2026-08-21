package com.castrel.chaos.promotion.repository;

import com.castrel.chaos.promotion.entity.CouponReservation;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface CouponReservationRepository extends JpaRepository<CouponReservation, Long> {
    Optional<CouponReservation> findByOperationId(String operationId);
    Optional<CouponReservation> findByOrderIdAndCouponId(String orderId, Long couponId);
}