package com.castrel.chaos.promotion.repository;

import com.castrel.chaos.promotion.entity.Coupon;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;

public interface CouponRepository extends JpaRepository<Coupon, Long> {

    List<Coupon> findByUserIdAndStatus(Long userId, Integer status);

        @Query("select count(c) from Coupon c where c.userId = :userId and c.promotionId = :promotionId "
            + "and c.status = 0 and (c.expireAt is null or c.expireAt > :now)")
        long countAvailable(@Param("userId") Long userId, @Param("promotionId") Long promotionId,
                @Param("now") java.time.LocalDateTime now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Coupon c where c.id = :id")
    Optional<Coupon> findByIdForUpdate(@Param("id") Long id);

    Optional<Coupon> findFirstByUserIdAndPromotionIdAndStatus(Long userId, Long promotionId, Integer status);
}
