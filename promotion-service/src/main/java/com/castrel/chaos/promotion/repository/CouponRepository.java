package com.castrel.chaos.promotion.repository;

import com.castrel.chaos.promotion.entity.Coupon;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CouponRepository extends JpaRepository<Coupon, Long> {

    List<Coupon> findByUserIdAndStatus(Long userId, Integer status);

    Optional<Coupon> findFirstByUserIdAndPromotionIdAndStatus(Long userId, Long promotionId, Integer status);
}
