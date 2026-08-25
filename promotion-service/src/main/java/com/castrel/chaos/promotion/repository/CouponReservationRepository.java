package com.castrel.chaos.promotion.repository;

import com.castrel.chaos.promotion.entity.CouponReservation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;
import java.util.Optional;

public interface CouponReservationRepository extends JpaRepository<CouponReservation, Long> {
    Optional<CouponReservation> findByOperationId(String operationId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
        @Query("select r from CouponReservation r where r.orderId = :orderId and r.couponId = :couponId")
        Optional<CouponReservation> findByOrderIdAndCouponIdForUpdate(
            @Param("orderId") String orderId, @Param("couponId") Long couponId);

    Optional<CouponReservation> findByOrderIdAndCouponId(String orderId, Long couponId);
}